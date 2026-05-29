# Multi-Exchange One-Click Switch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Steps use `- [ ]`. This is a MONEY-PATH feature: every task is TDD (test→red→green), backup the file before editing (`*.bak.pre-<task>-<date>`), and show code before commit (operator rule). Bite-sized code for Phases 2-5 is authored AT EXECUTION against the live file (read the file first), since exact diffs depend on current code; this plan fixes the interfaces, files, tasks, tests, and sequence "to the millimetre".

**Goal:** Per-user one-click switch of the active exchange (Binance ⇄ Bybit ⇄ future OKX/MEXC/Hyperliquid), uniform across demo/testnet/real. New decisions (brain/AT/ML/manual) route to the active exchange; open positions on other exchanges stay DSL-managed on their own exchange exactly as if active, with a per-exchange label on every order.

**Architecture:** Introduce `activeExchange` (new orders) vs `managedExchanges` (active ∪ exchanges-with-open-positions) in feedManager. serverAT routes new entries to active, close/SL/TP/DSL to `position.exchange`, and tells feedManager when a position opens/closes so an exchange stays "managed" (creds+feed alive) until its last position closes. DSL runs cross-exchange concurrently. Client shows all positions cross-exchange with exchange badges + a Switch button.

**Tech Stack:** Node.js + better-sqlite3 + PM2 (server), React + TS + Vite (client), Jest (server tests), vitest (client). Spec: `docs/superpowers/specs/2026-05-29-multi-exchange-switch-design.md`.

---

## Interfaces (contracts locked here — all phases depend on these)

**feedManager (Phase 1):**
- `setActiveExchange(uid, exchange)` → sets active; previous active stays in managed IF it has open positions, else its feed grace-stops.
- `getActiveExchange(uid)` → string | null.
- `getManagedExchanges(uid)` → string[] (active ∪ exchanges with open positions).
- `markPositionOpen(uid, exchange)` / `markPositionClosed(uid, exchange)` → maintain per-(uid,exchange) open-position counts; an exchange with count>0 is "managed" (feed+creds kept alive) even when not active.
- `isManaged(uid, exchange)` → bool.

**serverAT (Phase 2/3):**
- New entry resolves target exchange = `feedManager.getActiveExchange(uid)`; refuse new entry on a non-active managed exchange ("blocked — not the active exchange").
- Close/SL/TP/DSL use `position.exchange` (already stamped at entry).
- On position open → `feedManager.markPositionOpen(uid, position.exchange)`; on close → `markPositionClosed`.
- Every position/order carries `exchange` (already stamped — verify) used as the UI label key.

**Client (Phase 5):** positions store aggregates across exchanges; each row has `exchange`; Switch action → `POST /api/exchange/switch {exchange}`.

---

## File structure

- `server/services/feedManager.js` — active/managed model + position-count tracking (Phase 1).
- `server/routes/exchange.js` — `POST /api/exchange/switch` (confirm-flow, replace 409 block) (Phase 2).
- `server/services/serverAT.js` — entry routing to active; markPositionOpen/Closed wiring; non-active-entry guard (Phase 2/3).
- `server/services/serverBrain.js` — dispatch new decisions only to active exchange (Phase 3).
- `server/services/serverDSL.js` — confirm cross-exchange concurrent management + per-order exchange tag (Phase 3).
- `server/migrationFlags.js` — revise SERVER_AT_DEMO/BYBIT mutex for uniform modes (Phase 4).
- Client positions panel + DSL UI + Exchange settings (Switch button/dialog) (Phase 5).

---

## PHASE 1 — feedManager active/managed model (server, self-contained, START HERE)

Pure-ish state model + unit-testable with the existing mocked-feed test harness (`tests/unit/feedManager.test.js` already mocks marketFeed/bybitFeed). No real exchange calls.

### Task 1.1: position-count tracking (markPositionOpen / markPositionClosed / isManaged)

**Files:** Modify `server/services/feedManager.js`; Test: `tests/unit/feedManager-managed.test.js` (create). Backup feedManager first.

- [ ] **Step 1 — failing test:**
```js
const fm = require('../../server/services/feedManager');
beforeEach(() => fm._resetForTest());
test('exchange with open positions is managed even when not active', () => {
  fm.activateForUser(1, 'binance');
  fm.markPositionOpen(1, 'binance');
  fm.setActiveExchange(1, 'bybit');           // switch away
  expect(fm.getActiveExchange(1)).toBe('bybit');
  expect(fm.isManaged(1, 'binance')).toBe(true);   // still managed (has position)
  expect(fm.getManagedExchanges(1).sort()).toEqual(['binance', 'bybit']);
});
test('exchange drops from managed when last position closes', () => {
  fm.activateForUser(1, 'binance');
  fm.markPositionOpen(1, 'binance');
  fm.setActiveExchange(1, 'bybit');
  fm.markPositionClosed(1, 'binance');
  expect(fm.isManaged(1, 'binance')).toBe(false);
  expect(fm.getManagedExchanges(1)).toEqual(['bybit']);
});
test('active exchange is always managed even with no positions', () => {
  fm.setActiveExchange(1, 'bybit');
  expect(fm.isManaged(1, 'bybit')).toBe(true);
});
```
- [ ] **Step 2 — run → FAIL** (`npx jest tests/unit/feedManager-managed.test.js --forceExit`): markPositionOpen/setActiveExchange/getManagedExchanges/isManaged undefined.
- [ ] **Step 3 — implement** in feedManager.js: a `_posCounts` Map keyed `uid|exchange`→int; `markPositionOpen`/`markPositionClosed` (clamp ≥0); `setActiveExchange(uid,ex)` (set `_userExchange`, ensure feed started for ex via existing _startFeed/_cancelGrace, grace-stop the previous active ONLY if its posCount==0); `getActiveExchange`=_userExchange.get; `getManagedExchanges` = unique of [active] + exchanges with posCount>0; `isManaged`=active||posCount>0. Keep existing activate/deactivate working.
- [ ] **Step 4 — run → PASS** + full `tests/unit/feedManager.test.js` (no regression on existing 18).
- [ ] **Step 5 — commit** `feat(feedManager): active vs managed exchange model + position-count tracking`.

### Task 1.2: switch keeps old feed alive while it has positions
- [ ] Test: after `setActiveExchange` away from an exchange WITH posCount>0, that feed is NOT stopped (assert mock feed.stop NOT called for it); WITHOUT positions, it grace-stops (assert _scheduleGrace). Red → implement the grace gating in setActiveExchange → green → commit.

**Phase 1 deliverable:** feedManager exposes active/managed + position tracking, fully unit-tested, no runtime wiring yet (safe).

---

## PHASE 2 — switch route + entry routing (server)

### Task 2.1: `POST /api/exchange/switch` route (replace 409 block)
**Files:** `server/routes/exchange.js` (the current 409-on-positions block ~lines 157/176). Backup first. Authored at execution against live code.
- Behavior: `POST /api/exchange/switch {exchange}` → validate exchange ∈ SUPPORTED + user has creds for it → call `feedManager.setActiveExchange(uid, exchange)` → return `{ok:true, active, managed, openPositionsOnPrevious:[{exchange,count}]}`. The confirm dialog is client-side (Phase 5); the route just performs the switch + returns the open-position summary so the client can confirm-then-call. Replace the hard "disconnect first" 409 with this.
- TDD via supertest (pattern: existing e2e tests) OR a pure `_buildSwitchResult(uid)` helper unit-tested (preferred — avoids the auth/creds harness): given active+managed+posCounts → returns the summary object. Red → implement → green → commit `feat(exchange): /switch route + summary (replaces one-exchange block)`.

### Task 2.2: new-entry routing to active exchange + non-active guard
**Files:** `server/services/serverAT.js` entry path. Backup first.
- Pure helper `_resolveEntryExchange(uid)` = `feedManager.getActiveExchange(uid)`; guard: refuse a new entry whose target exchange ≠ active (`ENTRY_BLOCKED_NOT_ACTIVE_EXCHANGE`). TDD the pure guard (`_isEntryAllowedOnExchange(target, active)` → target===active). Wire into the entry path. Red→green→commit.

### Task 2.3: markPositionOpen/Closed wiring
**Files:** `server/services/serverAT.js` (where positions are pushed to `_positions` on open + `_closePosition`/`_handleLiveExit` on close). Backup first.
- On open (entry registered LIVE) → `feedManager.markPositionOpen(uid, entry.exchange)`. On close → `markPositionClosed(uid, pos.exchange)`. Verify `entry.exchange`/`pos.exchange` is stamped (it is — Phase 12.A); if missing for any path, stamp it. TDD via the s6/positions test hooks. Red→green→commit.

---

## PHASE 3 — brain/ML dispatch + DSL cross-exchange + labels (server)

### Task 3.1: serverBrain dispatches new decisions only to active exchange
**Files:** `server/services/serverBrain.js` (the dispatch where it hands decisions to serverAT). Authored at execution. TDD the dispatch-target resolution (uses feedManager.getActiveExchange). Red→green→commit.

### Task 3.2: DSL cross-exchange concurrency + per-order exchange tag
**Files:** `server/services/serverDSL.js`. Read fully at execution. Confirm DSL keys by `symbol|exchange` (memory: regime already does) so Binance + Bybit positions trail concurrently; ensure each DSL entry carries `exchange`; expose it for the UI. TDD the keying + tag. Red→green→commit. (No behavior change to a single-exchange setup — additive.)

---

## PHASE 4 — uniform-mode mutex revision (server)

### Task 4.1: revise SERVER_AT_DEMO/BYBIT mutex
**Files:** `server/migrationFlags.js:203-246` (validation). Backup first.
- Per spec: demo (simulated) coexists with one real exchange env. Remove/loosen `SERVER_AT_DEMO && BYBIT_TESTNET_ENABLED` (line 238) and `SERVER_AT_DEMO && BYBIT_LIVE_ENABLED` (236) so modes are uniform; KEEP the genuine safety mutexes (BYBIT_TESTNET && BYBIT_LIVE both true; BYBIT_LIVE && DRY_RUN_ONLY). TDD the validateFlags function with the new allowed/forbidden combos. Red→green→commit.

---

## PHASE 5 — client (positions panel, DSL labels, Switch button)

### Task 5.1: positions store aggregates cross-exchange + exchange field
**Files:** client positions store + `/api/positions`/WS shape. Read at execution. TDD (vitest) the store reducer keeps positions from all managed exchanges + each has `exchange`. Red→green→commit.

### Task 5.2: positions panel per-exchange badge + close routing
**Files:** client positions panel component. Each row badge (🟡 BINANCE / 🟣 BYBIT / …); close routes to `position.exchange`. vitest + manual smoke. Commit.

### Task 5.3: DSL UI per-order exchange label
**Files:** client DSL panel. Show exchange badge per DSL order. Commit.

### Task 5.4: Switch button + confirm dialog
**Files:** client Exchange settings UI. Replace "disconnect first" with one-click Switch per exchange → on click, if `/switch` summary shows open positions on current → confirm dialog ("Switch to X? Y has N open positions — they stay active + DSL-managed") → confirm calls `/switch`. vitest + manual smoke. Commit. Client rebuild (`npm run build` → public/app) + PM2 reload.

---

## Sequencing & dependencies

1 (feedManager model) → 2 (route+routing, needs 1) → 3 (brain/DSL, needs 2) → 4 (mutex, independent, can parallel) → 5 (client, needs 1-3 server endpoints). Deploy after each server phase (PM2 reload, graceful now works). Bybit execution enablement (BYBIT flags + canary) is a SEPARATE operator step after the switch UX lands.

## Self-review notes
- Spec coverage: active/managed (P1), switch-block-not-disconnect (P1.2+P2.1), new→active routing (P2.2/P3.1), close/SL/TP→pos.exchange + old-position DSL-as-if-active (P2.3/P3.2), per-exchange labels (P3.2/P5.2/5.3), uniform modes/mutex (P4), positions panel + manual close cross-exchange (P5). ✅
- Money-path: TDD + backup + show-before-commit per task; pure helpers unit-tested, wiring authored against live files at execution.
- Real-money flip + Bybit execution enablement = out of scope (separate gated steps).
