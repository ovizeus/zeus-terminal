# Changelog

All notable changes to Zeus Terminal are documented in this file.

---

## Post-v2 patch history (1.7.x series)

Imported from `server/version.js` changelog array on 2026-05-08 per Working Rule 1 (changelog discipline). `server/version.js` retains only the latest 3 entries (current + 2 anterioare). Older patch entries below, reverse chronological.

### v1.7.65 — b91 (P0 REPAIR R6 — per-env brain namespace WS race fix)

Surgical client-side reorder of `_usFlush` relative to POST /api/at/mode. Bug: `client/src/data/marketDataTrading.ts::_executeGlobalModeSwitch` called `window._usFlush()` INSIDE the `.then()` of POST /api/at/mode, on the assumption that AT.mode + useATStore.mode were still the OLD mode at flush time. WS at_update frame races ahead of HTTP response and flips AT.mode / AT._serverMode / useATStore.mode to NEW mode BEFORE `.then` fires. `_currentATModeKey()` returns NEW mode, so `_usSave` writes outgoing mode's flat values into WRONG brain slot. Fix: move `_usFlush()` BEFORE the POST. Removes R5-DBG* temporary instrumentation. Tests: client tsc clean, vite build clean (736ms). User confirmed brain/profile/DSL persistă correct per demo/live după switch.

### v1.7.64 — b90 (P0 REPAIR R5 — per-env brain namespace persistence)

Server-side defensive deep-merge for USER_SETTINGS.brain. Bug: `server/routes/trading.js:536` (POST /api/user/settings) used shallow spread `{...existing, ...clean}` which replaced the `brain` key wholesale — partial payloads silently wiped the other namespace în DB. Fix: rebuild `merged.brain = { live: {...existing.live, ...clean.live}, demo: {...existing.demo, ...clean.demo} }`. Tests: jest 161/161, client tsc, probe-s2 29/29, probe-s2c 10/10. Backup: `trading.js.bak.r5`.

### v1.7.63 — b89 (P0 REPAIR R1→R4 — AT→MANUAL + per-env Brain/DSL regressions)

Strict surgical repair. **R1**: `serverAT.js _normalizePositionRow(p)` helper extracted once and reused by getOpenPositions / getDemoPositions / getLivePositions / _broadcastPositions so all four read paths emit Phase 9C2 defensive fields (autoTrade, sourceMode, controlMode, lev, dsl). Commit `ac4c1ff`. **R2**: `server.js /api/at/register-manual` strict whitelist forwarding of `source` ("auto"|"manual", defaults "manual") + `clientReqId`. Commit `2780151`. **R3**: `client/src/engine/brain.ts _applyDslMode` adds `_usScheduleSave()` call (parity cu _applyModeSwitch / _applyProfileSwitch). Commit `707bb9a`. **R4**: `client/src/stores/settingsStore.ts loadFromServer` calls `_reapplyBrainCfgForCurrentMode()` after `_projectAll(merged)` to re-hydrate window.S / useBrainStore / useDslStore / DOM radios from correct per-mode slot. Idempotent. Commit `2cb0faa`. Tests: tsc, vite build (769ms), jest 161/161, probe-s2 29/29, probe-s2c 10/10.

### v1.7.62 — b88 (Phase 2 S2.C GLOBAL PANIC COMPLETION)

S2 introduced PANIC at brain-driven entry only. S2.C closes the gap on every manual/server path that creates NEW live exposure. Strict additive. Gates: **C1** POST /api/order/place after tradingEnabled, audit `ORDER_BLOCKED_GLOBAL_HALT`. **C2** `serverAT.registerManualPosition` when mode === "live" — blocks before seq allocation; DEMO unaffected. **C3** POST /api/order/modify, audit `ORDER_MODIFY_BLOCKED_GLOBAL_HALT`. **C4** POST /api/addon, audit `ADDON_BLOCKED_GLOBAL_HALT`. Permissive: POST /api/manual/protection (existing position, no new size). Tests: jest 161/161, probe-s2 29/29, probe-s2c 10/10. Files: `server/routes/trading.js` (+23 LOC), `server/services/serverAT.js` (+6 LOC).

### v1.7.61 — b87 (Phase 2 S2 IDEMPOTENCY + GLOBAL PANIC HALT)

Two strict additive server-side changes; zero changes to Brain / DSL / decision semantics / schema / client. **S2.A**: Decision idempotency end-to-end on brain-driven live-entry path. processBrainDecision stamps cu crypto-random 8-hex `decisionId`. `_executeLiveEntry` derives `newClientOrderId = SAT_<seq>_<decisionId>` (stable, ≤36 chars Binance limit) — retries produce SAME token so Binance dedups. After MAIN order POST succeeds, `entry.live = { status:"MAIN_PLACED", mainOrderId, clientOrderId, decisionId }` persisted BEFORE SL/TP attempts. Rehydrate-and-reexecute short-circuits dacă `entry.live.mainOrderId` already set. **S2.B**: Global PANIC halt — cross-user entry kill switch persisted în `at_state` under key "global:halt". serverAT exports isGlobalHaltActive()/getGlobalHaltState()/setGlobalHalt. Read-failure defaults to HALTED (fail-safe). Gate la TWO points (top of processBrainDecision + top of _executeLiveEntry; in-flight zombie-cleans cu closeReason=GLOBAL_HALT_INFLIGHT). New endpoints: GET /api/panic, POST /api/panic body `{active:boolean,reason?:string}` — role==="admin" gate. Tests: jest 161/161, probe-s2 29/29.

### v1.7.60 — b86 (Phase 2 S1 FOUNDATION — Warm-start + Resume + Mutex FAIL)

**S1.A**: WS at_update warm-start on accept. **S1.B**: GET /api/at/resume canonical per-user rebuild endpoint. **S1.C**: `migrationFlags.js` startup FAIL on mutex violation + `set()` rejects instead of coerce. Files: server.js, server/migrationFlags.js, server/version.js.

### v1.7.59 — b85 (Phase 12.A Batch H CLEANUP)

2 last hardcoded Binance fallbacks removed; exchange/env UX stack A–H closed.

### v1.7.58 — b84 (Phase 12.A EXCHANGE/API UX STACK — Batches A–G)

End-to-end elimination of hardcoded "Binance" identity across the app: every surface derives exchange + env from server truth. **Batch A**: typed WS frame `exchange.changed` emitted by /api/exchange/{save,disconnect,verify} și ca warm-start pe every WS accept. **Batch B**: `useServerSync` maps `exchange.changed` + `at_update` payload în `useUiStore` (activeExchange, executionEnv, exchangeMode, apiConfigured, executionBlockedReason). **Batch C**: hardcoded "binance" defaults removed from positionsStore.liveExchange + TP.liveExchange + logout reset — type widened la `"binance"|"bybit"|null`. **Batch D**: dynamic exchange labels on AutoTradePanel (D1), ModeBar (D2), ManualTradePanel (D3), StatusBar (D4 — LIVE→REAL display map + exchange suffix), PositionRows + ARES PositionsList chips (D5). **Batch E**: global Header badge (E1); SettingsHubModal conflict previews tightened (E2); REAL disconnect confirm cu 4-bullet warning (E3). **Batch F**: REAL manual order pre-place confirm dialog. **Batch G**: history snapshot of exchange + env at open — serverAT stamps both entry sites; journal projects + whitelists them; JournalEntry/CSV export carry the snapshot. Zero schema migration. All UI strings în English.

### v1.7.57 — b83 (Phase 11.9 MARKET RADAR MOBILE MARQUEE FINAL FIX)

JS rAF-based final fix.

### v1.7.56 — b82 (Phase 11.8 MARKET RADAR MOBILE MARQUEE FIX)

mask-image → pseudo-elements.

### v1.7.55 — b81 (Phase 11.7 MARKET RADAR BUGFIX)

radarCache + snapshot warm-start + mobile marquee.

### v1.7.54 — b80 (Phase 11 UI SURGICAL MOVE + MARKET RADAR)

Plus brief-history bundle:
- b79 v1.7.53 — DSL PER-MODE + TOAST HOTFIX
- b78 v1.7.52 — BRAIN/AT/DSL FULL PER-MODE SPLIT
- b77 v1.7.51 — CHART DRIFT HOTFIX REVERT B73
- b76 v1.7.50 — BRAIN SPLIT SECOND SWITCH PATH FIX
- b75 v1.7.49 — BRAIN MODE SYNC HOTFIX
- b74 v1.7.48 — BRAIN DEMO/LIVE NAMESPACE SPLIT
- b73 v1.7.47 — CHART UX PACK

---

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
