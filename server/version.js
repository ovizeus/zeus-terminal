// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.7.20',
    build: 46,
    date: '2026-04-19',
    changelog: 'Post-v2 batch4 b46 v1.7.20 — Phase 2C: client consumer migration to canonical executionEnv. All env-display sites now read the server-truth executionEnv (DEMO|TESTNET|REAL|null) + executionBlockedReason (NO_ACTIVE_API_CREDENTIALS|INVALID_ACTIVE_API_CONFIGURATION|null) instead of the legacy resolvedEnv with false REAL/DEMO inferral. 17 client files migrated: types/sync.ts, stores/uiStore.ts, hooks/useServerSync.ts (uses ?? to preserve null), core/state.ts (adds w._executionEnv + w._executionBlockedReason mirrors), core/bootstrapError.ts (StatusBar), core/bootstrapMisc.ts (welcome modal), data/marketDataTrading.ts (3 sites), trading/positions.ts (entry/exit popup), trading/autotrade.ts (3 sites + LIVE MODE LOCKED guard), trading/dsl.ts (+ AT/PAPER LOCKED), engine/arianova.ts (3 sites), ui/modebar.ts, ui/pageview.ts, components/dock/ManualTradePanel.tsx, components/dock/AutoTradePanel.tsx, components/layout/PanelShell.tsx, components/layout/ModeBar.tsx. Coherent label "LOCKED" everywhere + warning "LIVE MODE LOCKED: <reason>". Legacy resolvedEnv intentionally preserved in payload/store/mirror as compat — no patched consumer reads it. 60/60 Phase 2C harness PASS + all prior regressions green (1A 23/23, 1B 12/12, 2A 26/26, hotfix 34/34, 2B 24/24, jest 161/161 = 341 PASS total). Previous: batch4 b45 v1.7.19 (Phase 2B: canonical server _resolveExecutionEnv + executionEnv/executionBlockedReason on getFullState + preLiveChecklist stable code — server-only, no client patches).'
};
