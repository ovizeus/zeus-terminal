# Changelog

All notable changes to Zeus Terminal are documented in this file.

## [1.2.1] — 2026-03-24

### Security

- Rate limited `/verify-code` endpoint (10 attempts / 15 min per IP)
- `sessionAuth` DB error now returns 503 instead of silently allowing requests
- `credentialStore` try/catch around decrypt — returns null on failure
- Encryption key versioning (`v1:` prefix) with backward-compatible decrypt
- VPS `.env` permissions hardened to `chmod 600`
- Admin panel XSS fix — `innerHTML` replaced with `textContent` for user emails
- Admin onclick injection fix — inline handlers replaced with `addEventListener`

### Added

- `:focus-visible` outlines on buttons and interactive links (accessibility)
- `#adminStatus` element — admin login status without overwriting brand
- Ticker strip WebSocket retry limit (5x) with auto-hide on failure
- Forgot-password fields cleared on "Back to login"
- Expanded `.gitignore` (data/, DB files, build artifacts, IDE, OS files)
- `README.md` with architecture, setup, deployment instructions
- `CHANGELOG.md`

### Changed

- manifest.json description updated to "AI trading analytics platform — private beta"
- SW offline message changed from Romanian to English
- index.html brand title aligned with login page
- All emojis removed from login.html (buttons, headings, JS messages — 19 locations)
- Forgot-password form uses standard `.form-group` CSS classes (no inline styles)
- Last feat-card no longer stretches full-width in grid
- Subtitle text bumped from 7.5px/8.5px to 9.5px/10px
- Toggle text changed to invite-only language ("Need access?" / "Request an invite")
- Footer uses `margin-top: auto` via body flexbox (sticky bottom)

## [1.2.0] — 2026-03-18

### Added

- ARIA 4.0 — 25+ pattern detectors (Smart Money, Candle Power, Momentum Intel)
- NOVA live correlation engine
- Pattern history tracking

## [1.1.0] — 2026-03-10

### Added

- Server-side Brain engine (observation mode)
- Server-side AutoTrade (demo + live, per-user isolation)
- Dynamic Stop Loss server-side management
- Per-user Telegram bot with polling
- Reconciliation service (position verification vs exchange)

## [1.0.0] — 2026-02-28

### Added

- Initial release
- Express 5 server with SQLite database
- JWT authentication with email 2FA
- AES-256-GCM encryption for API keys
- Binance Futures integration (testnet + mainnet)
- Risk guard with daily loss limits
- Login page with module showcase
- PM2 deployment configuration
