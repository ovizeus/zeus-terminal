// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.7.15',
    build: 41,
    date: '2026-04-19',
    changelog: 'Post-v2 batch3-W-hotfix2 b41 v1.7.15 LIVE BALANCE AUTO-FETCH — after b40, Manual panel correctly showed "BAL (TESTNET): $0.00" because engine-mode switching via ModeBar never triggered a Binance balance fetch. Only connectLiveAPI() (user-click in Settings → Exchange API) set TP.liveConnected=true and ran liveApiSyncState; switchGlobalMode/_executeGlobalModeSwitch did not. With balance stuck at 0, orders were rejected client-side with "Insufficient live balance". Fix: _applyGlobalModeUI now flips TP.liveConnected=true and fires one liveApiSyncState() on the first demo→live transition when _apiConfigured is true. Idempotent — subsequent calls skip the sync; the periodic 120s livePosSync keeps balance fresh from then on. This path runs both on user-driven mode switch and on page-load state init, so refreshing the page while already in live mode also populates balance. Previous: batch3-W-hotfix b40 v1.7.14 (Manual panel engine/exchange mode separation).'
};
