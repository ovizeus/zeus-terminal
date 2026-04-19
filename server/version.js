// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.7.27',
    build: 53,
    date: '2026-04-19',
    changelog: 'Post-v2 batch8 b53 v1.7.27 — Manual AT Position Parity GAP-1 fix. Follow-up to v1.7.26 Phase 6 Brain parity closure. Audit (read-only) on manual position flow DEMO vs LIVE found: client-side _buildManualPosition is 1:1 symmetric across modes, but server-side divergence existed — manual DEMO sent user-computed dslParams via /api/at/register-manual while manual LIVE order route /api/order/place never forwarded dslParams, so server fell back to DSL_DEFAULTS for manual LIVE positions. Impact: if user changed DSL mode from default (fast/swing/etc.), server DSL engine managed manual LIVE positions with wrong preset while client DSL ran with correct user params. Fix (3 files): client/src/trading/liveApi.ts manualLivePlaceOrder now forwards body.dslParams when provided; client/src/data/marketDataTrading.ts _executeLiveManualOrder pre-computes DSL preset from same DOM inputs used by _buildManualPosition (null if DSL OFF, object otherwise) and passes via manualLivePlaceOrder; server/routes/trading.js registerManualPosition call now reads req.body.dslParams (undefined preserves legacy DSL_DEFAULTS fallback, null triggers DSL OFF path in serverAT). No scoring/confluence/UI/brain logic touched. Server Brain V2 still dormant. Intended differences unchanged (SL/TP basis, retries, balance semantics per docs/BRAIN_PARITY.md). Test sweep: tsc 0, vitest 76/76, vite build OK. Previous: batch7 b52 v1.7.26 (Phase 6 Brain parity closure).'
};
