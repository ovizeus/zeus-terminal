// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.6.24',
    build: 17,
    date: '2026-04-18',
    changelog: 'Post-v2 batch3-B build 17 — professional settings for every indicator in SELECT INDICATOR. IND_SETTINGS gets obv.smoothing, vwap.{stdDev,stdDev2}, cvd.smoothing defaults in both public/legacy/js/core/state.js and client/src/core/state.ts. engine/indicators.ts openIndSettings now renders pivot.type as <select> (standard/fibonacci/camarilla/woodie/demark) and fib.levels as a CSV text input; applyIndSettings parses both back (levels → number[]); smoothing=0 is now a valid value. _updateMACDChart reads fast/slow/signal from IND_SETTINGS.macd instead of hardcoded 12/26/9. updateOBV applies SMA(smoothing) when >1. renderVWAP/calcVWAPBands honours stdDev/stdDev2 multipliers on the inner/outer bands. marketDataChart CVD path applies SMA when IND_SETTINGS.cvd.smoothing > 1. ChartControls IND_LIST gets hasGenericSettings:true on the 17 original indicators; the gear renders for both custom-modal overlays and generic-settings rows, routing to openIndSettings(id) for the latter. Previous builds 8-16.'
};
