# 🚀 Quick Start Guide

## Installation & Setup (< 5 minutes)

### 1. Clone/Download Project
```bash
cd status-app
```

### 2. Generate Required Values

**Generate AUTH_SECRET** (random 32+ byte string):
```bash
# On Linux/Mac:
openssl rand -base64 32

# On Windows PowerShell:
[System.Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

**Choose AUTH_PASSWORD** (minimum 8 characters):
```
Example: MySecurePass123!
```

### 3. Create .env File
```bash
cp .env.example .env
```

Edit `.env` with your values:
```dotenv
AUTH_PASSWORD=MySecurePass123!
AUTH_SECRET=your_generated_secret_here

# At least one service URL:
SERVER_HEALTH_URL=tcp://192.168.1.1:22
# or
OVERSEERR_STATUS_URL=http://192.168.1.1:5055/api/v1/status
# or
PLEX_BASE_URL=https://plex.example.com
PLEX_TOKEN=your_token_here
```

### 4. Run with Docker
```bash
docker-compose -f deploy/docker-compose.yml up -d
```

### 5. Access Dashboard
- Open browser: `http://localhost:4555`
- Login with `admin` / `MySecurePass123!`

## ✅ Verify It's Working

```bash
# Check health
curl http://localhost:4555/api/check

# View logs
docker-compose -f deploy/docker-compose.yml logs -f status

# Access admin features (login first)
curl http://localhost:4555/api/admin/ingest-now
```

## 📋 Configuration Examples

### Monitor Local SSH Server
```dotenv
SERVER_HEALTH_URL=tcp://192.168.1.1:22
SERVER_TIMEOUT_SECS=4
```

### Monitor Plex
```dotenv
PLEX_BASE_URL=https://plex.example.com
PLEX_TOKEN=xxxxx  # Get from https://www.plex.tv/claim
PLEX_TIMEOUT_SECS=5
```

### Monitor Overseerr
```dotenv
OVERSEERR_STATUS_URL=http://192.168.1.1:5055/api/v1/status
OVERSEERR_TIMEOUT_SECS=4
```

### Production HTTPS
```bash
# Use reverse proxy (nginx example):
server {
    listen 443 ssl http2;
    server_name status.example.com;
    
    ssl_certificate /etc/ssl/certs/cert.pem;
    ssl_certificate_key /etc/ssl/private/key.pem;
    
    location / {
        proxy_pass http://localhost:4555;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Then set `INSECURE_DEV=false` in .env

## 🔑 Features

### Public Dashboard
- View real-time service status
- View uptime metrics (last 24 hours)
- View recent incidents
- Mobile-friendly interface

### Admin Login
- Manual health check trigger
- Enable/disable service monitoring
- Bulk data ingestion
- Reset recent incidents
- Manage IP blocks (blocked after 3 failed login attempts)

### Security
- Auto-blocks IP after 3 failed logins (24 hours)
- Rate limited (10 req/sec per IP)
- Session timeout (24 hours)
- CSRF protection
- Secure cookies

## 🆘 Troubleshooting

### Can't login
- Check `AUTH_PASSWORD` length (minimum 8 chars)
- Check `AUTH_SECRET` length (minimum 32 bytes)
- View logs: `docker-compose logs status`
- Try from different IP if blocked (wait 24h or clear block from previous session)

### Services not monitoring
- Check service URLs are correct in .env
- Check network connectivity (firewall, routing)
- View logs for error messages

### Mobile login issues
- Tested on iOS Safari 15+ and Android Chrome
- Ensure cookies are enabled
- Try private/incognito window
- Check browser console for errors

## 📚 More Documentation

- **DOCKER_GUIDE.md** - Detailed Docker deployment
- **PRODUCTION_READY.md** - Full feature list and deployment checklist
- **MOBILE_LOGIN_ANALYSIS.md** - Mobile debugging info
- **iOS_DEBUG_GUIDE.md** - Advanced troubleshooting

## 🎯 Next Steps

1. ✅ Get app running (`docker-compose up`)
2. ✅ Configure service URLs in .env
3. ✅ Login and verify dashboard
4. ✅ Test admin features
5. ✅ Set up HTTPS with reverse proxy (production)

---

**Need help?** Check the documentation files or view logs:
```bash
docker-compose -f deploy/docker-compose.yml logs -f status
```

**Production ready**: See PRODUCTION_READY.md for deployment checklist.
