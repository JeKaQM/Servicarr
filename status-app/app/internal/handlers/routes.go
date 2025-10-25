package handlers

import (
	"net/http"
	"status/app/internal/alerts"
	"status/app/internal/auth"
	"status/app/internal/models"
	"status/app/internal/security"
)

// SetupRoutes configures all HTTP routes and middlewares
func SetupRoutes(authMgr *auth.Auth, alertMgr *alerts.Manager, services []*models.Service) http.Handler {
	// Public API routes (with rate limiting)
	api := http.NewServeMux()
	api.HandleFunc("/api/check", HandleCheck(services))
	api.HandleFunc("/api/metrics", HandleMetrics())

	// Admin API routes (with authentication)
	authAPI := http.NewServeMux()
	authAPI.HandleFunc("/api/admin/ingest-now", authMgr.RequireAuth(HandleIngestNow(services)))
	authAPI.HandleFunc("/api/admin/reset-recent", authMgr.RequireAuth(HandleResetRecent()))
	authAPI.HandleFunc("/api/admin/check", authMgr.RequireAuth(HandleAdminCheck(services)))
	authAPI.HandleFunc("/api/admin/toggle-monitoring", authMgr.RequireAuth(HandleToggleMonitoring(services)))
	authAPI.HandleFunc("/api/admin/blocks", authMgr.RequireAuth(HandleListBlocks()))
	authAPI.HandleFunc("/api/admin/unblock", authMgr.RequireAuth(HandleUnblockIP()))
	authAPI.HandleFunc("/api/admin/clear-blocks", authMgr.RequireAuth(HandleClearAllBlocks()))
	authAPI.HandleFunc("/api/admin/alerts/config", authMgr.RequireAuth(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			HandleGetAlertsConfig(alertMgr)(w, r)
		} else if r.Method == http.MethodPost {
			HandleSaveAlertsConfig(alertMgr)(w, r)
		} else {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	}))
	authAPI.HandleFunc("/api/admin/alerts/test", authMgr.RequireAuth(HandleTestEmail(alertMgr)))

	// Auth routes
	authAPI.HandleFunc("/api/me", HandleWhoAmI(authMgr))
	authAPI.HandleFunc("/api/login", HandleLogin(authMgr))
	authAPI.HandleFunc("/api/logout", HandleLogout(authMgr))

	// Main router
	mux := http.NewServeMux()
	mux.Handle("/api/admin/", security.RateLimit(authAPI))
	mux.Handle("/api/login", security.RateLimit(http.HandlerFunc(HandleLogin(authMgr))))
	mux.Handle("/api/logout", security.RateLimit(http.HandlerFunc(HandleLogout(authMgr))))
	mux.Handle("/api/me", security.RateLimit(http.HandlerFunc(HandleWhoAmI(authMgr))))
	mux.Handle("/api/", security.RateLimit(api))
	mux.HandleFunc("/static/", HandleStatic())
	mux.HandleFunc("/favicon.ico", HandleFavicon())
	mux.Handle("/", security.CheckIPBlock(http.HandlerFunc(HandleIndex(authMgr))))

	return mux
}
