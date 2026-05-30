# P-A — Position Adoption & Display Unification — Design Spec

**Date:** 2026-05-30  ·  **Sub-project:** P-A (first of the server-side migration: P-A positions → P-B execution → P-C persistence).
**Status:** design approved by operator (adoption management = Option 1); awaiting spec review → writing-plans.

## Problem (verified in the mega-audit)

A real exchange position (Bybit/Binance) that is NOT a tracked `at_positions` row is **invisible and non-persistent** in Zeus: it flashes on refresh then vanishes (~1s). Three root causes:

1. **Display reads DB only.** `serverAT.getLivePositions(userId)` (serverAT.js:3034) returns `_positions.filter(p => p.userId===userId && p.mode==='live')` — the in-memory set loaded from `at_positions`. It does NOT consult the exchange. An exchange position with no DB row is never in `_positions` → never sent to the client → the poll (`/api/at/state` → `getFullState` → `getLivePositions`) overwrites the brief exchange-flash and it disappears.
2. **No adoption.** `recoveryBoot.js` step 3c (recoveryBoot.js:282-307) detects "position on exchange, not in DB" and only places a protective auto-SL via `_handleExchangeOnlyPosition` (recoveryBoot.js:373-448) — it does NOT create an `at_positions` row. So the position stays untracked, undisplayed, unmanageable.
3. **Duplicate paper labeling.** `registerManualPosition` (serverAT.js:3915) stamps `mode: data.mode || us.engineMode`. A testnet order while `engineMode` is `live` → `mode='live'`; while `demo` → `mode='demo'`. `getDemoPositions` (serverAT.js:3079) returns `mode!=='live'`, `getLivePositions` returns `mode==='live'`. A testnet position can surface in both the demo and live client arrays → the DSL panel shows it twice (PAPER DEMO + PAPER TESTNET).

## Goal

Real exchange positions — opened via Zeus OR externally, including ones whose DB row was lost — are **adopted into tracking**, so they **persist, display with live price/PnL, and are closeable + SL-settable from Zeus**. The duplicate-paper labeling is eliminated. Money-path safe (no double execution, no margin double-count, fail-closed on protection failure).

## Design

### Unit 1 — Adoption (server, money-path)
**Where:** `recoveryBoot.js` step 3c (boot) + `serverAT._runReconciliation` (periodic ~60s) — both already query `exchangeOps.getPositions(uid, {exchangeOverride})` and build a held-map.
**What:** when a held exchange position has no matching tracked row, create one:
- Allocate `seq` (per-user `++us.seq`), insert an `at_positions` row + push to `_positions`:
  - `status:'OPEN'`, `mode:'live'`, `env:` resolved from creds (`TESTNET`|`REAL`), `exchange:` the held exchange.
  - `symbol/side/qty/price(entry)` from the held position; `source:'external'`, `externalSync:true`, `autoTrade:false`, `sourceMode:'manual'`.
  - `live:{ status:'LIVE', mainOrderId:null, slOrderId:<from auto-SL>, tpOrderId:null, avgPrice, executedQty }`.
  - `dslParams:null` (DSL OFF initially — Option 1).
- Place/confirm the protective auto-SL (reuse `_handleExchangeOnlyPosition`); record its `slOrderId` in the row. If SL fails → keep current behavior (arm `globalHalt` + CRITICAL alert).
- Audit: `POSITION_ADOPTED` row.
**Guards (defense-in-depth):**
- **Idempotent:** never adopt if a tracked row already matches (userId, exchange, symbol, side). Re-running recon must not duplicate.
- **Still-open check:** re-verify the position is open on the exchange immediately before adoption + SL (avoid adopting a just-closed external).
- **userId isolation:** adopt only under the credential owner's userId (recon already loops per user).
- **No DSL/trailing** on adopted rows (Option 1) — operator manages manually.

### Unit 2 — Display unification (server)
`getLivePositions` already includes any `mode:'live'` tracked row, so adopted positions appear automatically once Unit 1 creates them. No change to the read filter is required beyond ensuring adopted rows are `mode:'live'`. (Exchange remains the source of truth for "what is open"; the DB row is the tracked mirror.)

### Unit 3 — Duplicate fix (server, money-path-adjacent)
Make `mode` reflect the EXECUTION reality, not the engine toggle:
- Any order that hits a real exchange (creds present, `env` ∈ {TESTNET, REAL}) → `mode:'live'` (+ correct `env`).
- Paper/simulated (no exchange round-trip) → `mode:'demo'`.
Then `getDemoPositions` (`mode!=='live'`) excludes testnet, `getLivePositions` includes it once → exactly one bucket. Touch-point: `registerManualPosition` / `_registerManualPositionLegacy` (serverAT.js:3915) + verify the client merge (liveApi.ts) doesn't re-add.

### Error handling / edge cases
- Exchange read fails during recon → skip adoption this cycle (do NOT delete tracked rows on a transient read error); log + retry next cycle. Fail-closed: never orphan/close on an empty read that errored.
- Position closed externally between detection and SL → still-open check aborts adoption; if a row was already created, next recon reconciles it to CLOSED.
- Partial fill / qty mismatch vs an existing row → update the tracked row's qty from the exchange (exchange is truth), don't create a second row.
- Two recon passes racing → idempotency key (userId, exchange, symbol, side) + the per-user lock.

### Testing (TDD)
- Adoption creates a tracked OPEN row + the position appears in `getLivePositions` (unit: mock exchangeOps held position, assert row + getLivePositions includes it).
- Idempotency: running adoption twice on the same held position creates exactly one row.
- Duplicate fix: a testnet registration yields `mode:'live'` and appears only in `getLivePositions`, not `getDemoPositions`.
- Transient read error → no adoption, no deletion of existing rows.
- SL-fail on adoption → `globalHalt` armed (existing behavior preserved).
- Swap-back on each.

## Out of scope (later sub-projects)
- Server-side AT/Brain execution + the client carve-out lockout (P-B, path B incremental).
- Full settings/UI persistence of the 17 client-local items (P-C).
- Automatic DSL/trailing on adopted positions (deliberately Option-1-off; revisit post-P-B).

## Money-path risk summary
Adoption creates tracked positions from exchange state + places SL. Mitigated by: still-open re-check, idempotency, userId isolation, `source:'external'` marking, DSL-off, fail-closed on read errors, and preserving the existing SL-fail→halt guard. No new execution path (no orders placed except the protective SL that already exists today).
