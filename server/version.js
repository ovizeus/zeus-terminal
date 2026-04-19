// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.7.29',
    build: 55,
    date: '2026-04-19',
    changelog: 'Post-v2 batch9 b55 v1.7.29 — Phase 9 POSITION OWNERSHIP + PANEL PARITY REMEDIATION — 7 sub-batches fixing the 5 bugs the user reported after Phase 8 deploy (AT pos showing in Manual, 2-pos phantom open, AT/DSL flicker, x1 default, card markup divergence). [9A1] _mapServerPos drops the mode==="live"?"auto":"assist" heuristic — ownership resolution is now: server explicit → existingPos → derive from autoTrade/sourceMode → conservative "manual" default. autoTrade default flipped from true→false so unidentified positions never silently claim AT. [9A2] lev fallback prefers existingPos.lev so minimal snapshots no longer flash x1 for positions opened at x10/x20. [9B1] Panel filters strictly complementary — AT = autoTrade===true, Manual = autoTrade!==true; every position in exactly one panel. [9C1+9C2] Server registerManualPosition accepts clientReqId idempotency token + stamps onto entry; getOpenPositions normalizes sourceMode/autoTrade/controlMode/lev for legacy SQLite rows so wire contract is uniform. [9D1] Manual demo open — _demoOrderInFlight synchronous re-entry guard + _DEMO_ORDER_COOLDOWN_MS + clientReqId on POST payload. Server folds retry onto existing seq instead of double-registering. Fixes the "2 positions appear, one disappears" bug. [9E1] AT panel innerHTML template rewritten to match DemoPositionRow/LivePositionRow structure (pos-row class, Entry|Now inline, Margin/Notional/Fees/ROE, SL/TP inputs+SAVE) with PARTIAL/ADD-ON in a separate action row. savePosSLTP handler imported directly. [9F1] Manual DSL param readers prefer persisted TC over display:none DOM inputs so tuning survives reload. Test sweep: tsc 0, vitest 79/79, vite build OK. Previous: batch8 b54 v1.7.28 (Phase 8 nuclear remediation 16 sub-batches).'
};
