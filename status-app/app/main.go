package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
	"golang.org/x/crypto/bcrypt"
	_ "modernc.org/sqlite"
)

///////////////////////////////////////////////////////////////////////////////////////////////////
// Types & Globals
///////////////////////////////////////////////////////////////////////////////////////////////////

type Service struct {
	Key       string
	Label     string
	URL       string
	Timeout   time.Duration
	MinOK     int
	MaxOK     int
	Disabled  bool `json:"disabled"`
}
type LiveResult struct {
	Label    string `json:"label"`
	OK       bool   `json:"ok"`
	Status   int    `json:"status"`
	MS       *int   `json:"ms,omitempty"`
	Disabled bool   `json:"disabled"`
}
type LivePayload struct {
	T      time.Time             `json:"t"`
	Status map[string]LiveResult `json:"status"`
}

var (
	db             *sql.DB
	services       []Service
	authUser       string
	authHash       []byte
	hmacSecret     []byte
	insecureDev    bool
	sessionMaxAgeS int
)

///////////////////////////////////////////////////////////////////////////////////////////////////
// Helpers
///////////////////////////////////////////////////////////////////////////////////////////////////

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
func envInt(k string, def int) int {
	if v := os.Getenv(k); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}
func envBool(k string, def bool) bool {
	v := strings.ToLower(getenv(k, ""))
	if v == "" {
		return def
	}
	return v == "1" || v == "true" || v == "yes"
}
func envDurSecs(k string, def int) time.Duration { return time.Duration(envInt(k, def)) * time.Second }

func clientIP(r *http.Request) string {
	xff := r.Header.Get("X-Forwarded-For")
	if xff != "" {
		parts := strings.Split(xff, ",")
		return strings.TrimSpace(parts[0])
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return host
	}
	return r.RemoteAddr
}
func findServiceByKey(key string) *Service {
	for i := range services {
		if services[i].Key == key {
			return &services[i]
		}
	}
	return nil
}

///////////////////////////////////////////////////////////////////////////////////////////////////
// Security: headers, rate-limit, CSRF, sessions
///////////////////////////////////////////////////////////////////////////////////////////////////

func secureHeaders(next http.Handler) http.Handler {
	const csp = "default-src 'none'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://cdn.jsdelivr.net; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", csp)
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
		next.ServeHTTP(w, r)
	})
}

type rlEntry struct{ tokens int; last time.Time }
var rl = map[string]*rlEntry{}

type BlockInfo struct {
	IP        string
	Attempts  int
	ExpiresAt string
}

func getIPBlock(ip string) (*BlockInfo, error) {
	var block BlockInfo
	err := db.QueryRow(`SELECT ip_address, attempts, expires_at 
		FROM ip_blocks 
		WHERE ip_address = ? AND blocked_at IS NOT NULL AND expires_at > datetime('now')`, ip).Scan(&block.IP, &block.Attempts, &block.ExpiresAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &block, nil
}

func isIPBlocked(ip string) bool {
	var blockedAt sql.NullString
	err := db.QueryRow(`SELECT blocked_at FROM ip_blocks 
		WHERE ip_address = ? AND expires_at > datetime('now')`, ip).Scan(&blockedAt)
	
	return err == nil && blockedAt.Valid // Only blocked if blocked_at is set
}

func logFailedLoginAttempt(ip string) {
	// First, delete any expired blocks for this IP
	db.Exec(`DELETE FROM ip_blocks WHERE ip_address = ? AND expires_at <= datetime('now')`, ip)
	
	// Check if there's an existing non-expired record
	var attempts int
	var blockedAt sql.NullString
	err := db.QueryRow(`SELECT attempts, blocked_at FROM ip_blocks 
		WHERE ip_address = ?`, ip).Scan(&attempts, &blockedAt)
	
	if err == nil {
		newAttempts := attempts + 1
		// Update existing record, block after 3 attempts
		_, _ = db.Exec(`UPDATE ip_blocks 
			SET attempts = ?,
				blocked_at = CASE WHEN ? > 3 THEN datetime('now') ELSE NULL END,
				expires_at = datetime('now', '+24 hours'),
				reason = 'Failed login attempts'
			WHERE ip_address = ?`, newAttempts, newAttempts, ip)
	} else {
		// Create completely new record
		_, _ = db.Exec(`INSERT INTO ip_blocks (ip_address, blocked_at, attempts, expires_at, reason)
			VALUES (?, NULL, 1, datetime('now', '+24 hours'), 'Failed login attempts')`,
			ip)
	}
}

func clearIPBlock(ip string) error {
	_, err := db.Exec(`DELETE FROM ip_blocks WHERE ip_address = ?`, ip)
	return err
}

func listBlockedIPs() ([]map[string]interface{}, error) {
	rows, err := db.Query(`
		SELECT ip_address, blocked_at, attempts, expires_at, reason 
		FROM ip_blocks 
		WHERE expires_at > datetime('now')
		ORDER BY blocked_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	results := make([]map[string]interface{}, 0)
	for rows.Next() {
		var ip, expiresAt string
		var blockedAt, reason sql.NullString
		var attempts int
		if err := rows.Scan(&ip, &blockedAt, &attempts, &expiresAt, &reason); err != nil {
			continue
		}
		
		blockedAtStr := blockedAt.String
		if !blockedAt.Valid {
			blockedAtStr = expiresAt // fallback to expires_at if blocked_at is NULL
		}
		
		reasonStr := reason.String
		if !reason.Valid {
			reasonStr = "Too many failed login attempts"
		}
		
		results = append(results, map[string]interface{}{
			"ip": ip,
			"blocked_at": blockedAtStr,
			"attempts": attempts,
			"expires_at": expiresAt,
			"reason": reasonStr,
		})
	}
	return results, nil
}

func serveBlockedPage(w http.ResponseWriter, r *http.Request, block *BlockInfo) {
	// Set block info in URL parameters
	q := url.Values{}
	q.Set("ip", block.IP)
	q.Set("attempts", strconv.Itoa(block.Attempts))
	q.Set("expires", block.ExpiresAt)
	
	// Redirect to blocked page with params
	http.Redirect(w, r, "/static/blocked.html?"+q.Encode(), http.StatusSeeOther)
}

func rateLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := clientIP(r)
		
		// Check if IP is blocked
		if block, err := getIPBlock(ip); block != nil {
			// For API requests, return JSON
			if strings.HasPrefix(r.URL.Path, "/api/") {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusForbidden)
				json.NewEncoder(w).Encode(map[string]interface{}{
					"error": "access_blocked",
					"message": "Your access has been temporarily blocked due to excessive failed login attempts",
					"expires_at": block.ExpiresAt,
				})
				return
			}
			
			// For web requests, show blocked page
			serveBlockedPage(w, r, block)
			return
		} else if err != nil {
			log.Printf("error checking IP block: %v", err)
		}

		e := rl[ip]
		now := time.Now()
		if e == nil {
			e = &rlEntry{tokens: 10, last: now}
			rl[ip] = e
		}
		refill := int(now.Sub(e.last).Seconds())
		if refill > 0 {
			e.tokens += refill
			if e.tokens > 10 {
				e.tokens = 10
			}
			e.last = now
		}
		if e.tokens <= 0 {
			http.Error(w, "too many requests", http.StatusTooManyRequests)
			return
		}
		e.tokens--
		next.ServeHTTP(w, r)
	})
}

// IP blocking check only (no rate limiting)
func checkIPBlock(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := clientIP(r)
		
		// Check if IP is blocked
		if block, err := getIPBlock(ip); block != nil {
			// For API requests, return JSON
			if strings.HasPrefix(r.URL.Path, "/api/") {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusForbidden)
				json.NewEncoder(w).Encode(map[string]interface{}{
					"error": "access_blocked",
					"message": "Your access has been temporarily blocked due to excessive failed login attempts",
					"expires_at": block.ExpiresAt,
				})
				return
			}
			
			// For web requests, show blocked page
			serveBlockedPage(w, r, block)
			return
		} else if err != nil {
			log.Printf("error checking IP block: %v", err)
		}
		
		next.ServeHTTP(w, r)
	})
}

// CSRF (double-submit cookie)
func setCSRFCookie(w http.ResponseWriter) (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	val := base64.RawURLEncoding.EncodeToString(b)
	c := &http.Cookie{
		Name:     "csrf",
		Value:    val,
		Path:     "/",
		MaxAge:   sessionMaxAgeS,
		HttpOnly: false,
		SameSite: http.SameSiteLaxMode,
		Secure:   !insecureDev,
	}
	http.SetCookie(w, c)
	return val, nil
}
func verifyCSRF(r *http.Request) bool {
	cookieVal := ""
	if c, err := r.Cookie("csrf"); err == nil {
		cookieVal = c.Value
	}
	headerVal := r.Header.Get("X-CSRF-Token")
	return cookieVal != "" && headerVal != "" && cookieVal == headerVal
}

// Sessions (stateless HMAC cookie)
func sign(b []byte) string {
	m := hmac.New(sha256.New, hmacSecret)
	m.Write(b)
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}
func makeSessionCookie(w http.ResponseWriter, username string, maxAge time.Duration) error {
	exp := time.Now().Add(maxAge).Unix()
	payload := fmt.Sprintf(`{"u":"%s","exp":%d}`, username, exp)
	sig := sign([]byte(payload))
	val := base64.RawURLEncoding.EncodeToString([]byte(payload)) + "." + sig
	c := &http.Cookie{
		Name:     "sess",
		Value:    val,
		Path:     "/",
		MaxAge:   int(maxAge.Seconds()),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   !insecureDev,
	}
	http.SetCookie(w, c)
	_, _ = setCSRFCookie(w)
	return nil
}
func clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{Name: "sess", Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: !insecureDev})
	http.SetCookie(w, &http.Cookie{Name: "csrf", Value: "", Path: "/", MaxAge: -1, HttpOnly: false, SameSite: http.SameSiteLaxMode, Secure: !insecureDev})
}
type session struct {
	U   string `json:"u"`
	Exp int64  `json:"exp"`
}
func parseSession(r *http.Request) (*session, error) {
	c, err := r.Cookie("sess")
	if err != nil || c.Value == "" {
		return nil, errors.New("no session")
	}
	parts := strings.Split(c.Value, ".")
	if len(parts) != 2 {
		return nil, errors.New("bad cookie")
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, errors.New("decode")
	}
	want := parts[1]
	if sign(raw) != want {
		return nil, errors.New("bad sig")
	}
	var s session
	if err := json.Unmarshal(raw, &s); err != nil {
		return nil, errors.New("json")
	}
	if time.Now().Unix() > s.Exp {
		return nil, errors.New("expired")
	}
	return &s, nil
}
func requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, err := parseSession(r); err != nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if !verifyCSRF(r) && r.Method != http.MethodGet {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		next(w, r)
	}
}

///////////////////////////////////////////////////////////////////////////////////////////////////
// Checks
///////////////////////////////////////////////////////////////////////////////////////////////////

func httpCheck(url string, timeout time.Duration, minOK, maxOK int) (ok bool, code int, ms *int, errStr string) {
	if strings.HasPrefix(url, "tcp://") {
		addr := strings.TrimPrefix(url, "tcp://")
		t0 := time.Now()
		conn, err := net.DialTimeout("tcp", addr, timeout)
		d := int(time.Since(t0).Milliseconds())
		ms = &d
		if err != nil {
			log.Printf("tcp check error addr=%s err=%v", addr, err)
			return false, 0, nil, err.Error()
		}
		_ = conn.Close()
		return true, 0, ms, ""
	}
	client := &http.Client{Timeout: timeout}
	t0 := time.Now()
	resp, err := client.Get(url)
	d := int(time.Since(t0).Milliseconds())
	ms = &d
	if err != nil {
		log.Printf("http check error url=%s err=%v", url, err)
		return false, 0, nil, err.Error()
	}
	defer resp.Body.Close()
	ok = resp.StatusCode >= minOK && resp.StatusCode <= maxOK
	return ok, resp.StatusCode, ms, ""
}

///////////////////////////////////////////////////////////////////////////////////////////////////
// DB
///////////////////////////////////////////////////////////////////////////////////////////////////

func ensureSchema() error {
	_, err := db.Exec(`
CREATE TABLE IF NOT EXISTS samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  taken_at TEXT NOT NULL,
  service_key TEXT NOT NULL,
  ok INTEGER NOT NULL,
  http_status INTEGER,
  latency_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_samples_taken ON samples(taken_at);
CREATE INDEX IF NOT EXISTS idx_samples_service ON samples(service_key);

CREATE TABLE IF NOT EXISTS ip_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_address TEXT NOT NULL,
  blocked_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT NOT NULL,
  reason TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ip_blocks_ip ON ip_blocks(ip_address);
CREATE INDEX IF NOT EXISTS idx_ip_blocks_expires ON ip_blocks(expires_at);

CREATE TABLE IF NOT EXISTS service_state (
  service_key TEXT PRIMARY KEY,
  disabled INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);
`)
	return err
}
func insertSample(ts time.Time, key string, ok bool, status int, ms *int) {
	_, _ = db.Exec(`INSERT INTO samples (taken_at,service_key,ok,http_status,latency_ms)
VALUES (?,?,?,?,?)`,
		ts.UTC().Format(time.RFC3339),
		key,
		map[bool]int{true: 1, false: 0}[ok],
		status,
		func() any {
			if ms == nil {
				return nil
			}
			return *ms
		}(),
	)
}

///////////////////////////////////////////////////////////////////////////////////////////////////
// Config / Services
///////////////////////////////////////////////////////////////////////////////////////////////////

func loadServicesFromEnv() []Service {
	plexURL := getenv("PLEX_BASE_URL", "")
	plexToken := getenv("PLEX_TOKEN", "")
	plexIdentity := ""
	if plexURL != "" && plexToken != "" {
		plexURL = strings.TrimSuffix(plexURL, "/")
		plexIdentity = plexURL + "/identity?X-Plex-Token=" + plexToken
	}
	return []Service{
		{
			Key:     "server",
			Label:   "Server",
			URL:     getenv("SERVER_HEALTH_URL", "tcp://10.0.0.2:22"),
			Timeout: envDurSecs("SERVER_TIMEOUT_SECS", 4),
			MinOK:   envInt("SERVER_OK_MIN", 200),
			MaxOK:   envInt("SERVER_OK_MAX", 399),
		},
		{
			Key:     "plex",
			Label:   "Plex",
			URL:     getenv("PLEX_IDENTITY_URL", plexIdentity),
			Timeout: envDurSecs("PLEX_TIMEOUT_SECS", 5),
			MinOK:   envInt("PLEX_OK_MIN", 200),
			MaxOK:   envInt("PLEX_OK_MAX", 399),
		},
		{
			Key:     "overseerr",
			Label:   "Overseerr",
			URL:     getenv("OVERSEERR_STATUS_URL", "http://10.0.0.2:5055/api/v1/status"),
			Timeout: envDurSecs("OVERSEERR_TIMEOUT_SECS", 4),
			MinOK:   envInt("OVERSEERR_OK_MIN", 200),
			MaxOK:   envInt("OVERSEERR_OK_MAX", 399),
		},
	}
}

// Load disabled state from database for all services
func loadServiceStates() {
	for i, s := range services {
		var disabled int
		err := db.QueryRow(`SELECT disabled FROM service_state WHERE service_key = ?`, s.Key).Scan(&disabled)
		if err == nil {
			services[i].Disabled = disabled != 0
		}
	}
}

///////////////////////////////////////////////////////////////////////////////////////////////////
// Public API
///////////////////////////////////////////////////////////////////////////////////////////////////

func handleCheck(w http.ResponseWriter, r *http.Request) {
	now := time.Now().UTC()
	out := LivePayload{T: now, Status: map[string]LiveResult{}}
	for _, s := range services {
		if s.Disabled {
			// Include disabled services in response
			out.Status[s.Key] = LiveResult{Label: s.Label, OK: false, Status: 0, MS: nil, Disabled: true}
			continue
		}
		ok, code, ms, _ := httpCheck(s.URL, s.Timeout, s.MinOK, s.MaxOK)
		out.Status[s.Key] = LiveResult{Label: s.Label, OK: ok, Status: code, MS: ms, Disabled: false}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}

func handleMetrics(w http.ResponseWriter, r *http.Request) {
	hours := envInt("DEFAULT_WINDOW_HOURS", 24)
	if q := r.URL.Query().Get("hours"); q != "" {
		if n, err := strconv.Atoi(q); err == nil {
			if n < 1 {
				n = 1
			}
			if n > 24*90 {
				n = 24 * 90
			}
			hours = n
		}
	}
	since := time.Now().UTC().Add(-time.Duration(hours) * time.Hour).Format(time.RFC3339)

	rows, err := db.Query(`
WITH hourly AS (
  SELECT service_key,
         substr(taken_at,1,13) || ':00:00Z' AS hour_bin,
         SUM(ok) AS up_count,
         COUNT(*) AS total_count
  FROM samples
  WHERE taken_at >= ?
  GROUP BY service_key, hour_bin
)
SELECT service_key, hour_bin, up_count, total_count
FROM hourly ORDER BY hour_bin ASC`, since)
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	series := map[string][]map[string]any{}
	for rows.Next() {
		var key, hb string
		var up, total int
		_ = rows.Scan(&key, &hb, &up, &total)
		u := 0
		if total > 0 {
			u = int((float64(up)/float64(total))*100 + 0.5)
		}
		series[key] = append(series[key], map[string]any{"hour": hb, "uptime": u})
	}

	overall := map[string]float64{}
	for _, s := range services {
		var up, total sql.NullInt64
		_ = db.QueryRow(`SELECT SUM(ok), COUNT(*) FROM samples WHERE service_key=? AND taken_at >= ?`, s.Key, since).Scan(&up, &total)
		if total.Valid && total.Int64 > 0 {
			overall[s.Key] = float64(up.Int64) * 100.0 / float64(total.Int64)
		}
	}

	downs := []map[string]any{}
	rows2, err := db.Query(`SELECT taken_at, service_key, http_status
                             FROM samples
                             WHERE ok=0 AND taken_at >= datetime('now','-24 hours')
                             ORDER BY taken_at DESC LIMIT 50`)
	if err == nil {
		defer rows2.Close()
		for rows2.Next() {
			var ts, key string
			var st sql.NullInt64
			_ = rows2.Scan(&ts, &key, &st)
			downs = append(downs, map[string]any{"taken_at": ts, "service_key": key, "http_status": st.Int64})
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"window_hours": hours,
		"series":       series,
		"overall":      overall,
		"downs":        downs,
	})
}

///////////////////////////////////////////////////////////////////////////////////////////////////
// Admin API
///////////////////////////////////////////////////////////////////////////////////////////////////

func handleIngestNow(w http.ResponseWriter, r *http.Request) {
	now := time.Now().UTC()
	for _, s := range services {
		// Skip disabled services
		if s.Disabled {
			continue
		}
		ok, code, ms, _ := httpCheck(s.URL, s.Timeout, s.MinOK, s.MaxOK)
		insertSample(now, s.Key, ok, code, ms)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"saved": true, "t": now})
}

func handleResetRecent(w http.ResponseWriter, r *http.Request) {
	_, err := db.Exec(`DELETE FROM samples WHERE ok=0 AND taken_at >= datetime('now','-24 hours')`)
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"deleted_recent_incidents": true})
}

// NEW: per-service forced check (also persists a sample)
func handleAdminCheck(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Service string `json:"service"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Service == "" {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	s := findServiceByKey(req.Service)
	if s == nil {
		http.Error(w, "unknown service", http.StatusNotFound)
		return
	}
	if s.Disabled {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(LiveResult{Label: s.Label, OK: false, Status: 0})
		return
	}
	now := time.Now().UTC()
	ok, code, ms, _ := httpCheck(s.URL, s.Timeout, s.MinOK, s.MaxOK)
	insertSample(now, s.Key, ok, code, ms)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(LiveResult{Label: s.Label, OK: ok, Status: code, MS: ms})
}

func handleToggleMonitoring(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Service string `json:"service"`
		Enable  bool   `json:"enable"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Service == "" {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	s := findServiceByKey(req.Service)
	if s == nil {
		http.Error(w, "unknown service", http.StatusNotFound)
		return
	}
	s.Disabled = !req.Enable
	
	// Persist to database
	disabled := 0
	if s.Disabled {
		disabled = 1
	}
	_, _ = db.Exec(`
		INSERT INTO service_state (service_key, disabled, updated_at) 
		VALUES (?, ?, datetime('now'))
		ON CONFLICT(service_key) DO UPDATE SET disabled=?, updated_at=datetime('now')
	`, req.Service, disabled, disabled)
	
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"service": s.Key,
		"enabled": !s.Disabled,
	})
}

///////////////////////////////////////////////////////////////////////////////////////////////////
// Auth API
///////////////////////////////////////////////////////////////////////////////////////////////////

func handleWhoAmI(w http.ResponseWriter, r *http.Request) {
	type resp struct {
		Authenticated bool   `json:"authenticated"`
		User          string `json:"user,omitempty"`
	}
	me := resp{Authenticated: false}
	
	if s, err := parseSession(r); err == nil {
		me.Authenticated = true
		me.User = s.U
	}
	
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(me)
}

func handleLogin(w http.ResponseWriter, r *http.Request) {
	type creds struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	var c creds
	if err := json.NewDecoder(r.Body).Decode(&c); err != nil {
		log.Printf("login: decode error: %v", err)
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	ip := clientIP(r)
	if isIPBlocked(ip) {
		log.Printf("login: IP blocked: %s", ip)
		http.Error(w, "access denied - too many failed attempts", http.StatusForbidden)
		return
	}

	if c.Username != authUser {
		log.Printf("login: wrong username from %s", ip)
		logFailedLoginAttempt(ip)
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	
	if bcrypt.CompareHashAndPassword(authHash, []byte(c.Password)) != nil {
		log.Printf("login: wrong password for user %s from %s", c.Username, ip)
		logFailedLoginAttempt(ip)
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	log.Printf("login: success for user %s from %s", c.Username, ip)
	_ = makeSessionCookie(w, c.Username, time.Duration(sessionMaxAgeS)*time.Second)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
}

func handleListBlocks(w http.ResponseWriter, r *http.Request) {
	blocks, err := listBlockedIPs()
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"blocks": blocks,
	})
}

func handleUnblockIP(w http.ResponseWriter, r *http.Request) {
	var req struct {
		IP string `json:"ip"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.IP == "" {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	if err := clearIPBlock(req.IP); err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"unblocked": req.IP,
	})
}

func handleLogout(w http.ResponseWriter, r *http.Request) {
	clearSessionCookie(w)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
}

///////////////////////////////////////////////////////////////////////////////////////////////////
// UI
///////////////////////////////////////////////////////////////////////////////////////////////////

func serveIndex(w http.ResponseWriter, r *http.Request) {
	// Set CSRF token cookie on every page load (for login form)
	_, _ = setCSRFCookie(w)
	http.ServeFile(w, r, "web/templates/index.html")
}
func serveStatic(w http.ResponseWriter, r *http.Request) {
	// Set cache control headers to prevent caching
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")

	switch {
	case strings.HasSuffix(r.URL.Path, "/app.js"):
		w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
		http.ServeFile(w, r, "web/static/js/app.js")
	case strings.HasSuffix(r.URL.Path, "/blocks.js"):
		w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
		http.ServeFile(w, r, "web/static/js/blocks.js")
	case strings.HasSuffix(r.URL.Path, "/utils.js"):
		w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
		http.ServeFile(w, r, "web/static/js/utils.js")
	case strings.HasSuffix(r.URL.Path, "/main.css"):
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
		http.ServeFile(w, r, "web/static/css/main.css")
	case strings.HasSuffix(r.URL.Path, "/blocks.css"):
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
		http.ServeFile(w, r, "web/static/css/blocks.css")
	case strings.HasSuffix(r.URL.Path, "/blocked.html"):
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		http.ServeFile(w, r, "web/templates/blocked.html")
	case strings.HasSuffix(r.URL.Path, "/plex.svg"):
		w.Header().Set("Content-Type", "image/svg+xml; charset=utf-8")
		http.ServeFile(w, r, "web/static/images/plex.svg")
	case strings.HasSuffix(r.URL.Path, "/overseerr.svg"):
		w.Header().Set("Content-Type", "image/svg+xml; charset=utf-8")
		http.ServeFile(w, r, "web/static/images/overseerr.svg")
	case strings.HasSuffix(r.URL.Path, "/server.svg"):
		w.Header().Set("Content-Type", "image/svg+xml; charset=utf-8")
		http.ServeFile(w, r, "web/static/images/server.svg")
	case strings.HasSuffix(r.URL.Path, "/favicon.svg"):
		w.Header().Set("Content-Type", "image/svg+xml; charset=utf-8")
		http.ServeFile(w, r, "web/static/images/favicon.svg")
	default:
		http.NotFound(w, r)
	}
}

///////////////////////////////////////////////////////////////////////////////////////////////////
// main
///////////////////////////////////////////////////////////////////////////////////////////////////

func clearIPBlocks(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	result, err := db.Exec("DELETE FROM ip_blocks")
	if err != nil {
		http.Error(w, "Failed to clear IP blocks", http.StatusInternalServerError)
		return
	}

	affected, err := result.RowsAffected()
	if err != nil {
		http.Error(w, "Failed to get affected rows count", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message": fmt.Sprintf("Successfully cleared %d IP blocks", affected),
		"cleared": affected,
	})
}

func main() {
	_ = godotenv.Load()

	// Auth config
	authUser = getenv("AUTH_USER", "admin")
	if hp := getenv("AUTH_PASSWORD_BCRYPT", ""); hp != "" {
		authHash = []byte(hp)
	} else {
		pw := getenv("AUTH_PASSWORD", "")
		if pw == "" {
			log.Fatal("missing AUTH_PASSWORD or AUTH_PASSWORD_BCRYPT")
		}
		h, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
		if err != nil {
			log.Fatal(err)
		}
		authHash = h
	}
	insecureDev = envBool("INSECURE_DEV", true)  // Default to true for development (set to false in production with HTTPS)
	sessionMaxAgeS = envInt("SESSION_MAX_AGE_SECONDS", 86400)
	secret := getenv("AUTH_SECRET", "")
	if len(secret) < 32 {
		log.Fatal("AUTH_SECRET must be at least 32 bytes (use a long random string)")
	}
	hmacSecret = []byte(secret)

	services = loadServicesFromEnv()
	poll := envDurSecs("POLL_SECONDS", 60)
	dbPath := getenv("DB_PATH", "./uptime.db")
	enableScheduler := strings.ToLower(getenv("ENABLE_SCHEDULER", "true")) == "true"
	port := getenv("PORT", "4555")

	// DB
	var err error
	db, err = sql.Open("sqlite", dbPath)
	if err != nil {
		log.Fatal(err)
	}
	if err := ensureSchema(); err != nil {
		log.Fatal(err)
	}
	
	// Load service disabled states from database
	loadServiceStates()

	// Scheduler
	if enableScheduler {
		go func() {
			t := time.NewTicker(poll)
			defer t.Stop()
			log.Printf("scheduler: every %s", poll)
			for {
				now := time.Now().UTC()
				for _, s := range services {
					// Skip disabled services
					if s.Disabled {
						continue
					}
					ok, code, ms, _ := httpCheck(s.URL, s.Timeout, s.MinOK, s.MaxOK)
					insertSample(now, s.Key, ok, code, ms)
				}
				<-t.C
			}
		}()
	}

	// Routers
	api := http.NewServeMux()
	api.HandleFunc("/api/check", handleCheck)
	api.HandleFunc("/api/metrics", handleMetrics)

	authAPI := http.NewServeMux()
	authAPI.HandleFunc("/api/admin/ingest-now", requireAuth(handleIngestNow))
	authAPI.HandleFunc("/api/admin/reset-recent", requireAuth(handleResetRecent))
	authAPI.HandleFunc("/api/admin/check", requireAuth(handleAdminCheck))
	authAPI.HandleFunc("/api/admin/toggle-monitoring", requireAuth(handleToggleMonitoring))
	authAPI.HandleFunc("/api/admin/blocks", requireAuth(handleListBlocks))
	authAPI.HandleFunc("/api/admin/unblock", requireAuth(handleUnblockIP))
	authAPI.HandleFunc("/api/admin/clear-blocks", requireAuth(clearIPBlocks))
	authAPI.HandleFunc("/api/me", handleWhoAmI)
	authAPI.HandleFunc("/api/login", handleLogin)
	authAPI.HandleFunc("/api/logout", handleLogout)

	mux := http.NewServeMux()
	mux.Handle("/api/admin/", rateLimit(authAPI))         // admin routes (auth enforced inside)
	mux.Handle("/api/login", rateLimit(http.HandlerFunc(handleLogin)))
	mux.Handle("/api/logout", rateLimit(http.HandlerFunc(handleLogout)))
	mux.Handle("/api/me", rateLimit(http.HandlerFunc(handleWhoAmI)))
	mux.Handle("/api/", rateLimit(api))                   // public API (rate-limited)
	mux.HandleFunc("/static/", serveStatic)
	mux.HandleFunc("/favicon.ico", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/x-icon")
		http.ServeFile(w, r, "web/static/images/favicon.ico")
	})
	// Main page: check IP blocking but no rate limiting
	mux.Handle("/", checkIPBlock(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { serveIndex(w, r) })))

	// Server with timeouts + security headers
	handler := secureHeaders(mux)
	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	log.Printf("listening on :%s", port)
	log.Fatal(srv.ListenAndServe())
}