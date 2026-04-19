// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.7.14',
    build: 40,
    date: '2026-04-19',
    changelog: 'Post-v2 batch3-W-hotfix b40 v1.7.14 MANUAL PANEL ENGINE/EXCHANGE MODE SEPARATION — after b39 deploy, live manual orders opened on Binance and got registered server-side but were NOT rendered in the Manual panel, demo positions disappeared from the Manual panel when testnet API was configured, and the PLACE button stayed stuck on "Placing…". Single root cause across all three: ManualTradePanel.tsx read `exchangeMode` ("testnet"|"live"|null) as if it were the engine mode. With testnet API configured, exchangeMode==="testnet" for both demo AND live engine states, so `gMode` matched neither "demo" nor "live" position filters — positions vanished from the OPEN POSITIONS list, EXCHANGE POSITIONS section stayed hidden (isLiveMode=false), and balance rendered demoBalance instead of Binance balance. Fix: ManualTradePanel now reads `engineMode` from useATStore as the authoritative toggle; exchangeMode is used only to decorate labels (TESTNET vs REAL). PLACE button stuck-on-"Placing…" cause: legacy marketDataTrading._executeLiveManualOrder mutated execBtn.textContent directly; React would skip the DOM update on re-render since the virtual DOM text had not changed. Fix: added uiStore.isPlacingLive flag set true/false around the /api/order/place round-trip; button text is now React-owned ("⏳ PLACING…" while in-flight, disabled). Previous: batch3-W b39 v1.7.13 (ModeBar rewrite + live trading triple fix).'
};
