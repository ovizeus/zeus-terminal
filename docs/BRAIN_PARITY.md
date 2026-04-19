# Brain DEMO ↔ LIVE/TESTNET Parity — Phase 6 Closure

**Version:** v1.7.26 (pending bump at end of Phase 6D)
**Date:** 2026-04-19
**Scope:** Brain signal path and Brain→AT handoff. Confirms parity after Phase 6B/6C fixes and documents intended differences.

## Status

- **Confirmed current bugs from audit: CLOSED.**
  - Multi-symbol client-side gates on LIVE/TESTNET used `TP.demoPositions` in 6 places (klines.ts:313, 405, 440, 447, 458, 482). Fixed in Phase 6B — commit `d3c5260` — now use `_activePosList()` helper keyed on `getATMode()`.
  - `runAutoTradeCheck` did not re-evaluate `_executionEnv` / `_apiConfigured` per tick; if creds became invalid mid-session, live orders kept firing until Binance rejected. Fixed in Phase 6C — commit `23f53d6` — new gate inside tick returns early with `EXEC_LOCKED` + throttled warn + UI status.

- **Confirmed parity at runtime for current (MF.SERVER_BRAIN=false, MF.CLIENT_BRAIN=true) configuration.**

## Intended differences (NOT bugs)

### SL/TP basis
- **Demo:** SL/TP computed from pre-fill entry price.
- **Live/Testnet:** SL/TP recomputed from actual fill price (`avgPrice`) after exchange returns.
- **Rationale:** Live must reflect actual slippage; demo is an approximation. `autotrade.ts:1053–1056`.
- **Implication:** In fast markets, demo's reported R:R slightly overstates what the identical live trade would achieve.

### Exchange SL/TP retries + `_unprotected` flag
- **Demo:** local SL/TP only, no retry (cannot fail).
- **Live/Testnet:** up to 3× retry per SL and per TP; if exhausted, `pos._unprotected=true` + critical alert.
- **Rationale:** Network/exchange errors can leave a real position without protection — user must know. `autotrade.ts:1117–1144`.

### Balance semantics
- **Demo:** `TP.demoBalance` (client-side, persisted via ZState/sync).
- **Live/Testnet:** `TP.liveBalance` sourced from exchange via `liveApiSyncState()`.
- **Demo auto-replenish:** `server/services/serverAT.js:396–407` resets `demoBalance` to $10k if it falls below 25% after a live session ends. **Intended behavior — deferred review.** Acknowledged as a UX trap that could mask skill regression vs live but not a parity bug. Not changed in Phase 6.

### Execution-env toggle gate
- **Demo:** AT can always be toggled on.
- **Live/Testnet:** toggling AT on requires `w._apiConfigured` true AND `w._executionEnv !== null`. Confirm dialog differentiates "Enable AutoTrade in TESTNET Mode?" vs "…in LIVE Mode?". `autotrade.ts:96–121`.
- **Plus (Phase 6C):** same check re-applied per tick to stop already-enabled AT from firing when env revokes.

### Order network path
- **Demo:** no network call; local state only.
- **Live/Testnet:** `liveApiPlaceOrder` → server `/api/order/place` (server lock + dedup + idempotency from Bug#3 hotfix) → Binance testnet/real route resolved by per-user `credentialStore` creds.mode.

## Deferred / out of Phase 6 scope

### Server Brain V2 modules (dormant)
`server/services/serverBrain.js` plus 17 V2 support modules (Reflection, Journal, KNN, SessionProfile, DrawdownGuard, CorrelationGuard, AdaptiveSizing, VolatilityEngine, Calibration, PendingEntry, MultiEntry, Structure, Liquidity, Orderflow, Sentiment, RegimeParams) exist but are gated by `MF.SERVER_BRAIN` — currently `false` in `data/migration_flags.json`. Mutex in `server/migrationFlags.js:48` prevents server+client brain running simultaneously. These modules are NOT in the current execution path for either demo or live.

**Flip to `MF.SERVER_BRAIN=true` is NOT part of Phase 6.** Doing so will change Brain decisions substantially in both modes simultaneously (new modifiers: Reflection penalty, Journal adaptive modifier, KNN pattern match, Session profile blocking, adaptive sizing, etc.) and will require a dedicated validation phase. Tracked separately in `project_phase2_server_migration.md`.

### Notes for future flip
When `MF.SERVER_BRAIN` is flipped:
- Expect confluence/fusion scores to shift (weighted by V2 modifiers).
- Expect fewer entries during user-specific worst-performance windows (SessionProfile).
- Expect pending-entry behavior (wait for pullback) to appear — client AT does not mirror this.
- Per-user learning (Journal adaptive, KNN) will diverge user-to-user over time.
- Validation must compare a symbol/time window's decision sequence client-brain vs server-brain under identical market data before rollout.

## Files touched in Phase 6

- Phase 6B: `client/src/data/klines.ts` (+15 −7) — commit `d3c5260`
- Phase 6C: `client/src/trading/autotrade.ts` (+18) — commit `23f53d6`
- Phase 6D: this file (new) — commit TBD at deploy time

No server code touched. No dormant modules touched. No scoring/confluence/UI changed.

## Audit trail

Original audit conducted 2026-04-19 immediately after Bug#3 hotfix (v1.7.25 b51). Audit output: parity PARTIAL; 1 real bug, 1 behavioral gap, 3 intended differences. Phase 6 closes the 2 real issues and documents the 3 intended differences in this file.
