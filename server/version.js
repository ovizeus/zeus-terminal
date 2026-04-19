// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.7.28',
    build: 54,
    date: '2026-04-19',
    changelog: 'Post-v2 batch8 b54 v1.7.28 — Phase 8 LIVE NUCLEAR REMEDIATION — 16 sub-batches (8A1..8E) addressing every live-affecting finding from the prior audit. Single deploy at end; per sub-batch: backup + targeted change + tsc+vitest green. Highlights: [8A1] reconnect re-pulls AT state + settings + ARES + sync.state + resetSnapshotTs; [8A2] settings.changed coalesce via _pendingTs queue; [8A3] logout in-place resets window.TP to defaults (17 fields) before redirect; [8A4] boot mirrors server-first hydration for ARES; [8B1] _applyServerATState atomic barrier — arrays→locals→single _merging write block→renderLivePositions after; [8B2] positions re-pull on reconnect; [8B3] _mapServerPos autoTrade fallback chain preserves client-only fields; [8B4] replaceAll resurrection guard uses _zeusRecentlyClosed + _syncClosedIds; [8B5] resetSnapshotTs API for clock-rewind tolerance; [8C1] upward reclassify requires strict server autoTrade=true + sourceMode∈{auto,undef} + 3s age; [8C2] _dslReassignId helper + window mirror for id-change reattach; [8C3] server _DUP_MIN_AGE_MS=10000 defers phantom-merged dup-close while any seq <10s old; [8C4] manual LIVE SL/TP 3x retry + _unprotected flag + siren toast; [8D1] mscan server-single-source-of-truth — panel reads/writes settingsStore only, LS mirror maintained by _syncToWindow for legacy klines.ts; [8D2] settings optimistic concurrency — ifUpdatedAt guard, server 409 on stale write with current_settings, client refreshes without auto-retry (+ 3 new vitest). Test sweep: tsc 0, vitest 79/79 (+3 new), vite build OK. Previous: batch8 b53 v1.7.27 (Manual AT DSL parity GAP-1).'
};
