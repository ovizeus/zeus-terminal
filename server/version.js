// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.7.26',
    build: 52,
    date: '2026-04-19',
    changelog: 'Post-v2 batch7 b52 v1.7.26 — Phase 6 Brain DEMO/LIVE/TESTNET parity closure. Audit (read-only) immediately after v1.7.25 Bug#3 hotfix found: (1) REAL BUG in client/src/data/klines.ts — multi-symbol scanner hardcoded TP.demoPositions in 6 places (L313, 405, 440, 447, 458, 482) for already-open / max-pos / opposite-direction / DSL-active / DSL-waiting gates, silently misfiring against the wrong list in LIVE/TESTNET; (2) BEHAVIORAL GAP in runAutoTradeCheck — no per-tick re-eval of _executionEnv / _apiConfigured, so revoked creds mid-session let live orders fire until Binance rejects each one. Phase 6B (d3c5260): introduced local _activePosList() helper keyed on getATMode(), replaced all 6 raw reads; scoring / calcSymbolScore / UI table / confluence / Brain compute untouched. Phase 6C (23f53d6): inside runAutoTradeCheck try-block, before data-stall check, added per-tick live-only gate — if _executionEnv===null or !_apiConfigured then _setBR EXEC_LOCKED + 30s-throttled atLog warn + UI lock status + return; toggle-time gate (L96-121) unchanged; demo path unchanged. Phase 6D: docs/BRAIN_PARITY.md documents intended differences (SL/TP basis demo=pre-fill vs live=actual fill, SL/TP retry+_unprotected flag live-only, demo balance auto-replenish <25% threshold deferred review, exec-env toggle-gate intended) and defers Server Brain V2 flip (17 dormant modules gated by MF.SERVER_BRAIN=false) to a dedicated validation phase. Server Brain V2 modules NOT touched. Test sweep: tsc 0, vitest 76/76, vite build OK. Previous: batch6 b51 v1.7.25 (Bug#3 HOTFIX 3-step).'
};
