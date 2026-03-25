# Zeus Terminal

AI-powered trading analytics platform for Binance Futures. Private beta — invite-only.

## Architecture

| Layer | Tech |
|-------|------|
| Server | Express 5, Node.js |
| Database | SQLite (better-sqlite3), WAL mode |
| Realtime | WebSocket (ws) + Binance Streams |
| Auth | JWT (HttpOnly cookie), bcrypt, email 2FA |
| Encryption | AES-256-GCM for API keys at rest |
| Process | PM2 (cluster mode) |
| Frontend | Single-page, vanilla JS modules |

## Modules

- **Brain** — Market regime detection, confluence scoring, multi-timeframe analysis
- **AutoTrade (AT)** — Automated trade execution (demo + live), server-side engine
- **Dynamic Stop Loss (DSL)** — 5 preset strategies, server-side management
- **Teacher** — Simulated learning environment with curriculum progression
- **Risk Guard** — Pre-trade validation, daily loss limits, emergency kill switch
- **ARES Watch** — Real-time monitoring with reconciliation alerts
- **Telegram Bot** — Per-user alerts, admin commands, regime notifications

## Quick Start

### Prerequisites

- Node.js >= 18
- npm

### Setup

```bash
# Clone the repository
git clone <repo-url> && cd zeus-terminal

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env — fill in JWT_SECRET, ENCRYPTION_KEY, SMTP, Telegram, etc.

# Generate secrets
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Use output for JWT_SECRET and ENCRYPTION_KEY

# Start (development)
npm start

# Start (production with PM2)
pm2 start ecosystem.config.js
```

The server starts on `http://localhost:3000` by default.

### Required Environment Variables

| Variable | Description |
|----------|-------------|
| `JWT_SECRET` | JWT signing secret (required — server exits without it) |
| `ENCRYPTION_KEY` | 64-char hex key for AES-256-GCM (required for exchange credentials) |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` | Email for 2FA codes |
| `PORT` | Server port (default: 3000) |

See [.env.example](.env.example) for all configuration options.

## Project Structure

```
zeus-terminal/
├── server.js                 # Express app entry point
├── ecosystem.config.js       # PM2 configuration
├── server/
│   ├── config.js             # Environment + runtime config
│   ├── version.js            # Version tracking
│   ├── middleware/
│   │   ├── sessionAuth.js    # JWT cookie authentication
│   │   ├── validate.js       # Order input validation
│   │   ├── rateLimit.js      # Per-user tiered rate limiting
│   │   └── resolveExchange.js # Per-user credential injection
│   ├── routes/
│   │   ├── auth.js           # Login, register, 2FA, admin
│   │   ├── trading.js        # Orders, positions, balance, risk
│   │   ├── exchange.js       # API key management
│   │   ├── sync.js           # Cross-device state sync
│   │   └── userContext.js    # User preferences sync
│   └── services/
│       ├── database.js       # SQLite + migrations + backups
│       ├── encryption.js     # AES-256-GCM encrypt/decrypt
│       ├── binanceSigner.js  # HMAC-SHA256 signing + circuit breaker
│       ├── riskGuard.js      # Pre-trade risk validation
│       ├── serverBrain.js    # Server-side brain cycle
│       ├── serverAT.js       # Server-side AutoTrade engine
│       ├── marketFeed.js     # Binance WS + REST fallback
│       ├── telegram.js       # Telegram alerts
│       └── ...               # logger, audit, metrics, reconciliation
├── public/
│   ├── index.html            # Main app (post-login)
│   ├── login.html            # Auth gate + module showcase
│   └── js/                   # Frontend modules (brain, trading, ui, etc.)
├── data/                     # Runtime data (DB, logs, state)
└── docs/                     # Documentation
```

## Security

- All API keys encrypted at rest (AES-256-GCM with versioned format)
- Prepared statements for all DB queries (no SQL concatenation)
- Helmet with strict CSP, HSTS, X-Frame-Options
- Per-user rate limiting (tiered: critical 15/min, trading 60/min, general 120/min)
- CSRF protection via custom header + origin validation
- 2FA via email with timing-safe code comparison
- Brute-force protection on login and verification endpoints

## Deployment

```powershell
# Deploy to VPS (uses deploy.ps1)
.\deploy.ps1
```

Or manually:

```bash
# Static files only (no restart needed)
scp -r public/* root@<VPS_IP>:/root/zeus-terminal/public/

# Server files (restart required)
scp server.js server/ root@<VPS_IP>:/root/zeus-terminal/
ssh root@<VPS_IP> "cd /root/zeus-terminal && pm2 restart zeus"
```

## Health Check

```bash
curl http://localhost:3000/health
```

Returns DB status, memory usage, disk info, uptime, and version.

## License

Private. All rights reserved.
