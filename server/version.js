// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.7.13',
    build: 39,
    date: '2026-04-19',
    changelog: 'Post-v2 batch3-W b39 v1.7.13 LIVE TRADING TRIPLE FIX — three cascading bugs surfaced during live testnet trading: (1) setMode cross-mode gate blocked live→demo whenever demo positions existed (batch3-V left this defensive check contrary to per-position mode design). Now fully removed — per-position `mode` field is authoritative, engine-mode switch is UI routing only. (2) /api/order/place only registered manual positions when Binance returned status=FILLED, but Futures testnet MARKET orders frequently return status=NEW (fill materializes async), so positions were opened on the exchange but never tracked by Zeus. Now NEW/PARTIALLY_FILLED/FILLED all trigger registerManualPosition; a deferred getOrder fetch (1.5s) patches real avgPrice/executedQty via new patchPositionFill once the fill completes. (3) marketDataTrading._executeLiveManualOrder and liveApi.liveApiSyncState only mutated legacy TP.livePositions, without calling usePositionsStore.syncSnapshot({ livePositions }), so React PositionTable/AT/ZeusDock never saw live positions (only demo path syncs to the store). Both sites now emit a syncSnapshot after mutating TP.livePositions. Net: manual live orders open on Binance AND register in Zeus AND render in React UI, and live→demo switch works with any mix of demo positions open. Previous: batch3-V b38 v1.7.12 (demo→live switch bug fix — preLiveChecklist + setMode only gate on live positions), batch3-U b37 v1.7.11 (Brain/DSL/AT mode propagation).'
};
