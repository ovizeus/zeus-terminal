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

---

# v2 — Hardening layers (operator + review) + technical corrections to real codebase

Operator + secondary review added defensive layers; this section integrates ALL of them and corrects the proposed pseudocode against the **real** Zeus codebase (verified live). Architecture of the 8 layers is accepted in full; the implementation specifics below override the pseudocode where it diverged.

## The 8 defensive layers (final, mandatory)
1. **Double-read confirmation (debounce).** An external position must appear in **2 consecutive recon reads** (snapshot match in a volatile `adoptionDebounceCache` keyed `userId:exchange:env`) before adoption OR before tripping the mass circuit-breaker. Kills false-positives from a single API glitch (e.g. the Binance 418 we hit). First detection caches + waits for the next poll.
2. **Telegram notify on EVERY adoption** (not only mass) — `telegram.sendToUser(uid, …)` with symbol/side/qty/SL-status. Full transparency on the operator's account.
3. **Respect `globalHalt` — write-freeze.** If `globalHalt` is armed, adoption is **blocked** (log + skip). System is in manual-intervention state; never auto-write.
4. **DB-level idempotency backstop.** In-memory check first (does `_positions` already hold this `user/symbol/side/mode` OPEN?); the partial UNIQUE index `idx_at_pos_user_sym_side_mode_open` is the final backstop — a duplicate INSERT throws `SQLITE_CONSTRAINT` → caught + treated as already-adopted. Survives restart-mid-adoption.
5. **Sanity-reject (not just sanitize).** Reject the position BEFORE opening the txn if `qty<=0 / NaN`, `entryPrice<=0 / NaN`, or missing `symbol/side`. Circuit-breaker catches the COUNT; this catches per-position GARBAGE.
6. **Mass-adoption circuit breaker.** If confirmed external positions for `(user, exchange)` exceed a configurable threshold (default **3**) → **block adoption**, `setGlobalHalt(true, uid, reason)`, `telegram.alertCritical`. Manual review beats auto-adopting a mass-polluted account.
7. **"Adopted but unprotected" watchdog.** If a protective SL could not be placed (and we didn't halt), register with `_watchdogLiveNoSL` → continuous alert until protected or closed.
8. **Concurrency mutex (per `userId:exchange:env`).** A shared in-memory lock both `recoveryBoot` AND `_runReconciliation` respect (bail-out if held; release in `finally`). Complements the existing global `_reconRunning` guard (which covers only `_runReconciliation`, NOT `recoveryBoot`) — prevents boot + periodic recon racing the same account.

## Technical corrections vs the proposed pseudocode (verified against live code)
- **C1 (critical): adoption must mutate in-memory `_positions`, not only the DB.** `getLivePositions` (serverAT.js:3034) reads `_positions` (in-memory). Adoption MUST: `const seq = ++us.seq; const entry = {…}; _positions.push(entry); _persistPosition(entry);` (serverAT.js pattern at 1198/1257, 3887/3952). It therefore lives **inside serverAT** (e.g. `serverAT.adoptExternalPosition(uid, exchange, pos)`), called by `recoveryBoot` + `_runReconciliation`. A detached DB-only INSERT would NOT fix the display (the exact bug).
- **C2 (critical): better-sqlite3 transactions are SYNCHRONOUS.** Use `db.transaction(() => { … })()` (pattern: database.js:50/209/223/245), NOT `await db.transaction(async …)`. The async SL exchange call must run **OUTSIDE** the txn.
- **C3: reuse real persistence.** `_persistPosition(entry)` → `db.atSavePosition(entry)` (`atUpsertPos`, columns `seq,data,status,user_id`) + `_broadcastPositions`. Real column is `user_id`. Position object carries `exchange/env/source` in its JSON.
- **C4: keep the protective SL (Option 1 = "has auto-SL").** Reuse `_handleExchangeOnlyPosition` (2% adverse SL). **Ordering to avoid the corrupt "row-without-SL" state:** (a) if the exchange position already has an SL → adopt with its `slOrderId`; else place the protective SL (async) → get `slOrderId`; (b) atomic sync txn: `_positions.push` + `_persistPosition` with `slOrderId`. If SL placement fails → `setGlobalHalt` + `alertCritical`, do NOT insert (position stays on exchange, halted + alerted, operator intervenes). If the txn then hits the UNIQUE backstop → the placed SL is harmless (protective) and next recon is idempotent.
- **C5: wire to real services** — `setGlobalHalt(active, byUserId, reason)` (serverAT.js:328), `telegram.sendToUser`/`alertCritical`, `_watchdogLiveNoSL`, `exchangeOps.getPositions(uid,{exchangeOverride:exchange})`.
- **C6: the layer-8 mutex is retained** as above (coordinates boot + periodic; finer than `_reconRunning`).

## Un-adopt (manual reversal) — confirmed
A clean exit for a wrong adoption: mark the row CLOSED in the DB with `externalSync:false`, **no destructive exchange call** (the operator manages the exchange side). Exposed as an operator action.

## Pre-Code Protocol (applied — final)
1. **Requirements:** all 8 layers + concurrency mutex mapped; Option-1 (manual mgmt, DSL/trailing OFF, autoTrade:0); exchange = source of truth, DB = persistence registry.
2. **Security:** strict numeric/string validation pre-insert; **parameterized prepared statements only** (existing `atUpsertPos`); adoption bound to the credential-owner `userId`; un-adopt is local-only (no exchange writes).
3. **Impact:** extends `recoveryBoot.js` + a new `serverAT.adoptExternalPosition`; **0 breaking changes** (at_positions schema unchanged; `source:'external'`/`externalSync` stored in the flexible `data` JSON; native flows ignore `external` rows for autonomous decisions).
4. **Edge cases:** API glitch → double-read evicts unconfirmed snapshot, no DB change; garbage data → sanity-reject before txn; position closed mid-recon → qty>0 re-check aborts; restart mid-adoption → ACID txn + UNIQUE backstop; SL-fail → halt + watchdog.
5. **Pseudocode → real:** see C1–C6 (adoption inside serverAT, sync txn, real helpers, SL-then-insert ordering).
