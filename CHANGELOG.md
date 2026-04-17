# Changelog

All notable changes to Zeus Terminal are documented in this file.

## [2.0.0] — 2026-04-17

Commit `050ba57` on branch `recovery/zero-tail-finish`. Tag: `v2.0.0`.

### Architecture — what actually shipped

This release completed the multi-phase effort to replace the legacy vanilla-JS
single-page app with a React SPA shell backed by Zustand stores and a SQLite
user-context layer. The shell, routing, auth, theme, settings, positions UI
and most state management are genuine React + store ownership.

The older engine code (`brain`, `orderflow`, `forecast`, `signals`, `ARES`,
`AUB`, `indicators`, `teacher`, `postmortem`, `arianova`) was ported 1:1 from
JavaScript into TypeScript and still executes imperatively: it reads/writes
the DOM directly and publishes HTML fragments that a few panels render via
`dangerouslySetInnerHTML`. A bridge layer (`client/src/bridge/`) wires those
engines onto React-rendered DOM nodes after each paint, re-attaches `onclick`
handlers for shell-rendered buttons, and exposes ported modules on `window.*`
for in-engine consumers. The bridge is intentional, documented, and required
for the release — but it is a live imperative layer, not a thin shim.

In short: this is a **React shell + Zustand stores + ported TS engines that
still write DOM through a bridge**. It is not a fully React-canonical render
tree.

### Phase / lot closure

- Phase 0..9 + 5.1 + hotfix — closed per `migration/phase-0N-post` tags.
- R1..R16 zero-tail recovery — closed per `migration/R*-{pre,post}` tags.
- R12 Phase 8.1 FS prune (this release) — SQLite is sole source of truth for
  14 `user_ctx_data` sections; FS holds only 5 fs-only sections
  (`uiContext, panels, uiScale, settings, aresData`). Boot-time prune strips
  stale SQLite keys from FS files and deletes retired `.bakN` rotation files.
  Observed at deploy: stripped 14 sections, deleted 5 `.bakN`,
  `user_ctx/2.json` shrank 57 904 B → 4 920 B.

### Per-user isolation — where it holds and where it doesn't

Backend isolation is per-user end-to-end (WS broadcast scoped by `userId`,
all routes guarded by `sessionAuth` + `req.user.id`, SQLite tables keyed by
`user_id`). Browser-side `localStorage` keys are **not** user-scoped; a
second user on the same browser inherits the first user's local preferences
and engine caches. Two SQLite artifacts remained under-scoped at tag time:
one `at_state.user_id IS NULL` row (`brain:cooldowns`) and `regime_history`
with no `user_id` column. These are known items in the post-v2 register,
not release blockers.

### Known debt carried past this tag

- Engine-produced HTML rendered via `dangerouslySetInnerHTML` in `AUBPanel`
  (3x), `AutoTradePanel` (2x), `DSLZonePanel`, `AnalysisSections`.
- ~594 direct DOM writes across `client/src/engine/`, `data/`, `trading/`.
- ~785 `(w as any)` / `w.x = …` bindings in the client (the bridge surface).
- `localStorage` keys not user-scoped (see above).
- Client postmortem section growing past the 64 KB server guard
  (repeated `Rejected section postmortem — too large` in logs).
- Repo debris: `_diff_*.txt`, `audit-*.png`, `_check_schema.js`,
  `public/js/index_original.html`, legacy bundles under `public/js/`,
  `client/public/js/`.

### Tag message alignment

The annotated tag message says *"React canonical migration + zero-tail
recovery"*. Read that as the shell/stores/auth/positions parts — the engine
rendering is still bridge-driven and scheduled for follow-up in
`post-v2/real-finish`.

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
