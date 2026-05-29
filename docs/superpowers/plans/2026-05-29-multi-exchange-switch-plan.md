# Multi-Exchange One-Click Switch — Implementation Plan (CORRECTED v2)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, operator chose). Each task = TDD (test→red→green) + backup file before edit (`*.bak.pre-<task>-<date>`) + show code before commit (operator money-path rule). Bite-sized code for UI/large-file tasks is authored AT EXECUTION against the live file.

**Goal:** Per-user one-click switch of the active exchange (Binance ⇄ Bybit ⇄ future OKX/MEXC/Hyperliquid), uniform demo/testnet/real. New decisions (brain/AT/ML/manual) → active exchange; open positions on other exchanges stay DSL-managed on their own exchange exactly as if active, with a per-exchange label on every order.

**Architecture (CORRECTED after code verification 2026-05-29):** Active exchange is already `exchange_accounts.is_active` (DB); `/api/exchange/switch` already toggles it (exchange.js:370). The REAL gap: `credentialStore.getExchangeCreds(userId)` only loads the ACTIVE row → serverAT uses it for EVERY op (entry AND close/SL/DSL) → managing an old-exchange position after switch routes to the WRONG (new active) exchange. **Core fix = per-position creds routing:** new primitive `getExchangeCredsFor(userId, exchange)` + serverAT uses it (keyed by `position.exchange`, already stamped at serverAT.js:1176) for all close/SL/TP/DSL ops, while entries use the active creds. Switch stops blocking on open positions and keeps the old account row connected (is_active=0, not deleted) so its positions stay manageable.

**Tech Stack:** Node + better-sqlite3 + PM2; React+TS+Vite; Jest (server), vitest (client). Spec: `docs/superpowers/specs/2026-05-29-multi-exchange-switch-design.md`.

---

## Verified facts (from code, drives this plan)
- `credentialStore.getExchangeCreds(userId)` = ACTIVE row only (`db.getExchangeAccount` + decrypt) — credentialStore.js:34.
- serverAT uses `getExchangeCreds(userId)` for all ops (676, 798, 1163, 1266) — no per-position creds.
- `exchangeOps` already has `exchangeOverride` (exchangeOps.js:111) to pick ops module per exchange — but needs the right CREDS too.
- `entry.exchange` IS stamped at entry (serverAT.js:1176 from `_entryCreds.exchange`). `position.exchange` available.
- `/api/exchange/switch` EXISTS (exchange.js:370): validates target, NO_TARGET_CREDENTIALS check, **409 OPEN_POSITIONS block at ~416** (the thing to change), `serverBrain._markPendingSwitch`, toggles `is_active`.
- `serverDSL.attach(position, params)` keyed by `position.seq`; stores userId/symbol/side/SL — **NO exchange field** (serverDSL.js:78-96).
- serverBrain dispatches via `serverAT.processBrainDecision(...)` (serverBrain.js:852); exchange resolved inside serverAT via active creds.
- Client already has `positionsStore.ts`, `dslStore.ts`, `multiExchangeStore.ts`, `PositionTable.tsx`, `MultiExchangePage.tsx`, `liveApi.ts` — build ON these.

---

## PHASE 1 — `getExchangeCredsFor(userId, exchange)` (FOUNDATION, START HERE)

**Files:** `server/services/credentialStore.js` (+ a `db.getExchangeAccountByExchange` query in database.js if absent); Test: `tests/unit/credsFor.test.js`. Backup both.

- [ ] Step 1 — failing test: `getExchangeCredsFor(uid, 'bybit')` returns the bybit row's creds even when binance is the active row; returns null if no such connected account; existing `getExchangeCreds` (active) unchanged.
- [ ] Step 2 — run → FAIL (function undefined).
- [ ] Step 3 — implement: extract the decrypt-from-account body of getExchangeCreds into `_credsFromAccount(account, userId)`; `getExchangeCreds(uid)` = `_credsFromAccount(db.getExchangeAccount(uid), uid)`; add `db.getExchangeAccountByExchange(uid, exchange)` (SELECT … WHERE user_id=? AND exchange=? AND status='verified'/'connected' LIMIT 1); `getExchangeCredsFor(uid, exchange)` = `_credsFromAccount(that, uid)`. Export `getExchangeCredsFor`.
- [ ] Step 4 — run → PASS + no regression on existing cred tests.
- [ ] Step 5 — commit `feat(creds): getExchangeCredsFor(userId, exchange) — per-exchange credential load`.

## PHASE 2 — serverAT per-position creds routing (THE core fix)

**Files:** `server/services/serverAT.js` (close/SL/TP/DSL paths that call `getExchangeCreds(userId)`); Test: extend serverAT test hooks. Backup.

- [ ] Pure helper `_credsForPosition(userId, pos)` = `pos.exchange ? getExchangeCredsFor(userId, pos.exchange) : getExchangeCreds(userId)`. TDD it (mock both creds fns).
- [ ] Replace `getExchangeCreds(userId)` with `_credsForPosition(userId, pos)` in the EXIT/SL/TP/DSL-close paths (the recon/close/_handleLiveExit/DSL-trigger sites — NOT the entry path 1163, which stays active-creds). Identify each call site at execution; entry keeps active creds.
- [ ] Verify close/SL routes to `pos.exchange` (test: a bybit position closes via bybit creds even when binance active). Red→green→commit `fix(serverAT): close/SL/TP/DSL use per-position exchange creds`.
- [ ] Wire `feedManager.markPositionOpen/Closed` (Phase 5) at open/close so old exchange's feed stays alive while it has positions.

## PHASE 3 — switch route: stop blocking, keep old account connected

**Files:** `server/routes/exchange.js:370-` (the /switch route, 409 block ~416). Backup.

- [ ] Replace the **409 OPEN_POSITIONS block** with: allow the switch; return `{ok:true, from, to, openPositionsOnPrevious:[{exchange,count}]}` (summary so client confirms). Keep the old account row CONNECTED (is_active=0, do NOT disconnect/delete) so its positions stay manageable via getExchangeCredsFor. Preserve `_markPendingSwitch` + is_active toggle. Keep NO_TARGET_CREDENTIALS check.
- [ ] TDD a pure `_switchSummary(uid)` helper (active + per-exchange open-position counts from at_positions) → unit test. Wire into route. Red→green→commit `feat(exchange): switch keeps old positions managed (no open-position block)`.

## PHASE 4 — serverDSL exchange tag + new-decision routing to active

**Files:** `server/services/serverDSL.js` (attach), `server/services/serverAT.js` (entry uses active — confirm), `server/services/serverBrain.js` (dispatch). Backup.

- [ ] `serverDSL.attach` stores `exchange: position.exchange` in DSL state + exposes it via getState (for the UI label + so any DSL-driven close knows the exchange). TDD attach carries exchange.
- [ ] Confirm new entries (brain/AT/ML) use ACTIVE creds (getExchangeCreds) so they target the active exchange — add a guard test. Red→green→commit `feat(serverDSL): per-position exchange tag; new entries pinned to active exchange`.

## PHASE 5 — feedManager keep-feed-for-managed

**Files:** `server/services/feedManager.js`; Test: `tests/unit/feedManager-managed.test.js`. Backup.

- [ ] Add per-(uid,exchange) open-position count: `markPositionOpen/markPositionClosed/isManaged`; on switch-away, keep the old exchange's feed alive if its count>0 (grace-stop only at count 0). TDD (existing mocked-feed harness). Red→green→commit `feat(feedManager): keep feed alive for exchanges with open positions`.

## PHASE 6 — uniform-mode mutex revision

**Files:** `server/migrationFlags.js:203-246`. Backup.

- [ ] Loosen `SERVER_AT_DEMO && BYBIT_TESTNET_ENABLED` (238) + `SERVER_AT_DEMO && BYBIT_LIVE_ENABLED` (236) so demo (simulated) coexists with one real exchange env; KEEP `BYBIT_TESTNET && BYBIT_LIVE` (215) + `BYBIT_LIVE && DRY_RUN_ONLY` (221). TDD validateFlags new combos. Red→green→commit.

## PHASE 7 — client (build on existing multi-exchange UI)

**Files:** `client/src/stores/positionsStore.ts` (cross-exchange + exchange field), `PositionTable.tsx` (per-exchange badge + close→pos.exchange), `dslStore.ts`/DSL panel (exchange label), `MultiExchangePage.tsx`/`multiExchangeStore.ts` (Switch confirm dialog using `/switch` summary, replace any "disconnect first" copy). vitest per store/component + client rebuild (`npm run build`→public/app) + PM2 reload.

---

## Sequencing
P1 (creds primitive) → P2 (per-position routing, needs P1) → P3 (switch route) → P4 (DSL tag + active pin) → P5 (feed lifecycle) → P6 (mutex, parallel-able) → P7 (client, needs P1-P5 endpoints). Deploy (PM2 reload) after each server phase. Bybit execution enablement (BYBIT flags + canary) = separate operator step AFTER this lands.

## Self-review
- Spec coverage: per-position close/SL "as if active" (P1+P2+P4-tag), new→active (P2 entry-stays-active + P4 guard), switch-no-block + keep-managed (P3+P5), labels (P4 tag + P7), uniform mutex (P6), cross-exchange panel + manual close (P7). ✅
- Corrected mechanism: active=is_active(DB)+getExchangeCreds; NEW getExchangeCredsFor for per-position routing (was wrongly feedManager-centric in v1).
- Money-path: TDD + backup + show-before-commit each task. Real-money flip + Bybit execution enablement out of scope.
