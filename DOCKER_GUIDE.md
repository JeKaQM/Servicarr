# Status Page - Docker Deployment Guide

## Quick Start

### Prerequisites
- Docker and Docker Compose installed
- A `.env` file with configuration (copy from `.env.example`)

### Building the Image

```bash
cd status-app
docker-compose -f deploy/docker-compose.yml build
```

### Running the Container

```bash
docker-compose -f deploy/docker-compose.yml up -d
```

The service will be available at `http://localhost:4555`

### Configuration

Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```dotenv
# Required
AUTH_PASSWORD=your_secure_password
AUTH_SECRET=generate_a_random_string_at_least_32_bytes_long

# Service URLs (at least one required)
SERVER_HEALTH_URL=tcp://your-server:22
OVERSEERR_STATUS_URL=http://your-overseerr:5055/api/v1/status
PLEX_BASE_URL=https://plex.example.com
PLEX_TOKEN=your_plex_token

# Optional
POLL_SECONDS=60
ENABLE_SCHEDULER=true
PORT=4555
TZ=Europe/London
INSECURE_DEV=false  # Set to true only for local HTTP development
```

## Environment Variables

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `AUTH_USER` | No | `admin` | Login username |
| `AUTH_PASSWORD` | Yes | - | Login password (minimum 8 characters) |
| `AUTH_SECRET` | Yes | - | Random secret key (minimum 32 bytes) for session signing |
| `PORT` | No | `4555` | HTTP listen port |
| `DB_PATH` | No | `/data/uptime.db` | Database file location |
| `POLL_SECONDS` | No | `60` | Health check interval |
| `ENABLE_SCHEDULER` | No | `true` | Enable background scheduler |
| `TZ` | No | `Europe/London` | Timezone for timestamps |
| `INSECURE_DEV` | No | `false` | Allow HTTP cookies (dev only) |

### Service URLs

You can configure any combination of the following services:

- **Server**: TCP/HTTP health check (e.g., SSH reachability)
  - `SERVER_HEALTH_URL=tcp://192.168.1.1:22`
  - `SERVER_TIMEOUT_SECS=4`

- **Plex**: Requires token
  - `PLEX_BASE_URL=https://plex.example.com`
  - `PLEX_TOKEN=your_token`
  - `PLEX_TIMEOUT_SECS=5`

- **Overseerr**: Status API endpoint
  - `OVERSEERR_STATUS_URL=http://192.168.1.1:5055/api/v1/status`
  - `OVERSEERR_TIMEOUT_SECS=4`

## Usage

### Access the Dashboard
- **URL**: `http://localhost:4555`
- **Public View**: Available without authentication
- **Admin View**: Login with configured credentials

### Admin Features
- View detailed uptime metrics
- Manually trigger health checks
- Enable/disable service monitoring
- View and manage IP blocks (after 3 failed login attempts)
- Ingest all services immediately
- Reset recent incidents

## Security Features

### IP Rate Limiting
- 3 failed login attempts per IP = 24-hour block
- Rate limit: 10 requests/second per IP
- Automatic clearing after 24 hours

### Authentication
- HMAC-SHA256 session signing
- CSRF token protection (double-submit cookie)
- HttpOnly, SameSite cookies
- Secure flag in production (HTTPS)

### SSL/TLS in Production
For production deployment, use a reverse proxy (nginx, Caddy) with:
```
reverse_proxy localhost:4555
```

Then set `INSECURE_DEV=false` to enable secure cookies.

## Data Persistence

Database file is stored in Docker volume `status_data` mounted at `/data`.

To backup:
```bash
docker-compose -f deploy/docker-compose.yml exec status sqlite3 /data/uptime.db ".dump" > backup.sql
```

To restore:
```bash
docker-compose -f deploy/docker-compose.yml exec status sqlite3 /data/uptime.db < backup.sql
```

## Monitoring

### Health Check
```bash
curl http://localhost:4555/api/check
```

### View Logs
```bash
docker-compose -f deploy/docker-compose.yml logs -f status
```

### Database Cleanup
Database automatically cleans up expired IP blocks (24-hour expiration).

## Troubleshooting

### Login Not Working
1. Check `AUTH_PASSWORD` is set (minimum 8 characters)
2. Check `AUTH_SECRET` is set (minimum 32 bytes)
3. View logs: `docker-compose logs status`
4. Check browser console for errors

### Services Not Checking
1. Verify service URLs are correct and reachable
2. Check timeout values
3. View logs for HTTP errors
4. Ensure scheduler is enabled: `ENABLE_SCHEDULER=true`

### Mobile Issues
- The app is optimized for iOS Safari 15+, Android Chrome
- Use responsive design optimizations (included)
- Login timeout: 10 seconds (adjustable in code)

## Production Deployment

For Docker Hub deployment:

1. Build the image:
```bash
docker build -f deploy/Dockerfile -t yourname/status:1.0.0 .
```

2. Push to Docker Hub:
```bash
docker push yourname/status:1.0.0
```

3. Deploy:
```bash
docker run -d \
  --name status \
  -p 4555:4555 \
  -v status_data:/data \
  --env-file .env \
  --restart unless-stopped \
  yourname/status:1.0.0
```

## License

All rights reserved. See LICENSE file for details.
