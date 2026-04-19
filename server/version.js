// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.7.23',
    build: 49,
    date: '2026-04-19',
    changelog: 'Post-v2 batch4 b49 v1.7.23 — R-cleanup: zero-error tsc baseline. Fixed 5 pre-existing tsc errors carried forward from v1.7.21 baseline (43b4449), each at the right layer (no silencing). (1) ChartControls.tsx:129 — overlays patch cast realigned to OverlayToggles canonical shape (liq/zs/sr/llv/oflow/ovi). (2) AlertsModal.tsx:5 — dropped dead isSoundMuted import. (3) config.ts:1990 — dropped duplicate isDev in DSL Proxy block (the live one in DEMO block at 2056 remains). (4) useServerSync.ts:184 + types/sync.ts + ws.ts — added WsReconnect to WsMessage union (Phase 3E synthetic reconnect event was emitted via "as unknown as" cast that broke receiver-side narrowing); contract honest at both ends. (5) autotrade.ts:1102 — added missing usePositionsStore import (Phase 3F mirror was using it without importing). tsc --noEmit -p tsconfig.app.json now EXIT 0. vitest 76/76 + vite build OK + full Phase 3+4 harness sweep green (3a-g + hotfix + 4b + 4c). Previous: batch4 b48 v1.7.22 (Phase 4 exchange/env exclusivity completion).'
};
