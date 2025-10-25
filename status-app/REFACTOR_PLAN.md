# Servicarr Refactoring Plan

## Current State
- Single `app/main.go` file with 1404 lines
- All code (models, database, auth, security, handlers) in one file

## Proposed Structure

```
app/
├── main.go                      # Entry point (~100 lines)
├── internal/
│   ├── models/
│   │   └── models.go            # ✅ CREATED - All struct definitions
│   ├── config/
│   │   └── config.go            # ✅ CREATED - Environment loading, service configs
│   ├── database/
│   │   └── database.go          # ✅ CREATED - DB init, schema, queries
│   ├── auth/
│   │   └── auth.go              # ✅ CREATED - Sessions, CSRF, authentication
│   ├── security/
│   │   └── security.go          # ✅ CREATED - Rate limiting, IP blocking, headers
│   ├── alerts/
│   │   └── alerts.go            # ✅ CREATED - Email alerts, HTML templates
│   ├── checker/
│   │   └── checker.go           # ✅ CREATED - Service health checks
│   └── handlers/
│       ├── api.go               # TODO - Public API handlers (check, metrics)
│       ├── admin.go             # TODO - Admin API handlers
│       ├── auth_handlers.go     # TODO - Login/logout/whoami handlers
│       └── static.go            # TODO - Static file serving
```

## Files Already Created

### ✅ models/models.go
- Service
- LiveResult, LivePayload
- AlertConfig
- ServiceStatus
- BlockInfo

### ✅ config/config.go
- Config struct
- Load() function
- Environment variable helpers
- Service configuration loading

### ✅ database/database.go
- Init() - Database initialization
- EnsureSchema() - Table creation
- InsertSample() - Record service checks
- LoadAlertConfig() - Load alert settings
- SaveAlertConfig() - Save alert settings
- GetServiceDisabledState() - Check if service disabled
- SetServiceDisabledState() - Update service state

### ✅ auth/auth.go
- Auth struct with session management
- SetCSRFCookie() - CSRF token generation
- VerifyCSRF() - CSRF validation
- MakeSessionCookie() - Create authenticated session
- ClearSessionCookie() - Logout
- ParseSession() - Validate session
- RequireAuth() - Authentication middleware

### ✅ security/security.go
- SecureHeaders() - CSP and security headers middleware
- RateLimit() - Token bucket rate limiting
- CheckIPBlock() - IP blocking middleware  
- ClientIP() - Extract client IP from request
- GetIPBlock() - Check if IP is blocked
- LogFailedLoginAttempt() - Record failed logins
- ClearIPBlock() - Unblock an IP
- ClearAllIPBlocks() - Remove all blocks
- ListBlockedIPs() - Get all blocked IPs

### ✅ alerts/alerts.go
- Manager struct
- SendEmail() - Send SMTP emails
- CheckAndSendAlerts() - Monitor status changes
- CreateHTMLEmail() - Generate styled email templates

### ✅ checker/checker.go
- HTTPCheck() - Perform HTTP/TCP health checks
- FindServiceByKey() - Lookup service by key

## Next Steps

### 1. Create handlers/api.go
Extract from main.go:
- handleCheck() - GET /api/check
- handleMetrics() - GET /api/metrics

### 2. Create handlers/admin.go
Extract from main.go:
- handleIngestNow() - Force check all services
- handleResetRecent() - Clear incidents
- handleAdminCheck() - Check single service
- handleToggleMonitoring() - Enable/disable service
- handleListBlocks() - List blocked IPs
- handleUnblockIP() - Unblock an IP
- handleGetAlertsConfig() - Get alert config
- handleSaveAlertsConfig() - Save alert config
- handleTestEmail() - Send test email
- clearIPBlocks() - Clear all blocks

### 3. Create handlers/auth_handlers.go
Extract from main.go:
- handleWhoAmI() - Check authentication status
- handleLogin() - User login
- handleLogout() - User logout

### 4. Create handlers/static.go
Extract from main.go:
- serveIndex() - Serve main HTML
- serveStatic() - Serve static files (JS, CSS, images)

### 5. Refactor main.go
Simplify to:
```go
package main

import (
    "log"
    "net/http"
    "time"
    
    "status/app/internal/config"
    "status/app/internal/database"
    "status/app/internal/auth"
    "status/app/internal/security"
    "status/app/internal/alerts"
    "status/app/internal/checker"
    "status/app/internal/handlers"
)

func main() {
    // Load configuration
    cfg, err := config.Load()
    if err != nil {
        log.Fatal(err)
    }
    
    // Initialize database
    if err := database.Init(cfg.DBPath); err != nil {
        log.Fatal(err)
    }
    
    // Initialize auth
    authMgr := auth.NewAuth(cfg.AuthUser, cfg.AuthHash, cfg.HmacSecret, cfg.InsecureDev, cfg.SessionMaxAgeS)
    
    // Initialize alerts
    alertMgr := alerts.NewManager()
    
    // Convert service configs to services
    services := convertToServices(cfg.ServiceConfigs)
    loadServiceStates(services)
    
    // Start scheduler
    if cfg.EnableScheduler {
        go runScheduler(services, alertMgr, cfg.PollInterval)
    }
    
    // Setup routes
    mux := handlers.SetupRoutes(authMgr, alertMgr, services)
    
    // Apply middlewares
    handler := security.SecureHeaders(mux)
    
    // Start server
    srv := &http.Server{
        Addr:              ":" + cfg.Port,
        Handler:           handler,
        ReadHeaderTimeout: 5 * time.Second,
        ReadTimeout:       10 * time.Second,
        WriteTimeout:      15 * time.Second,
        IdleTimeout:       60 * time.Second,
    }
    
    log.Printf("listening on :%s", cfg.Port)
    log.Fatal(srv.ListenAndServe())
}
```

## Benefits of This Structure

1. **Separation of Concerns**: Each package has a single responsibility
2. **Testability**: Easy to unit test individual packages
3. **Maintainability**: Changes are localized to specific files
4. **Readability**: Much easier to find and understand code
5. **Scalability**: Easy to add new features without cluttering main
6. **Best Practices**: Follows Go project layout conventions
7. **Docker-Friendly**: Internal packages ensure proper encapsulation

## Migration Strategy

Since ~80% of the refactoring is complete, the remaining work involves:
1. Creating the 4 handler files (extracting from current main.go)
2. Rewriting main.go to use the new packages
3. Testing to ensure everything works
4. Committing the refactored code

Would you like me to continue with creating the handler files and new main.go?
