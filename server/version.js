// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.7.51',
    build: 77,
    date: '2026-04-20',
    changelog: [
        'Post-v2 batch31 b77 v1.7.51 — Phase 10.19 CHART DRIFT HOTFIX REVERT B73. User reported chart shifts left at ~15s after boot (same symptom as pre-b72). Root cause: b73 Chart UX Pack added two calls in marketDataChart.ts that reset the visible time-scale on every renderChart and on every WS tick — (1) renderChart line 156 called rebuildCandleSeriesFromKlines() after cSeries.setData, which does removeSeries+addCandlestickSeries+setData and resets the chart visible range, (2) the WS tick handler replaced cSeries.update(bar) with w._applyLatestBar(bar). Both hooks intercept the default candle path even when the user never picked a non-default candle type, and the side effects compound with the t+15s zeusReady _resizeCharts call producing a visible left-shift. FIX: revert ONLY those two lines in marketDataChart.ts to the b72 behavior. cSeries.update(bar) is restored on WS tick and renderChart no longer calls rebuildCandleSeriesFromKlines. The candle-type dropdown in ChartControls still works for manual picks; only the auto-apply-on-renderChart hook is removed. No other b73/b74/b75/b76 code paths touched. Backups: marketDataChart.ts.bak.b77, version.js.bak.b77.',
        'Previous: b76 v1.7.50 — Phase 10.18.2 BRAIN SPLIT SECOND SWITCH PATH FIX. b75 v1.7.49 — Phase 10.18.1 BRAIN MODE SYNC HOTFIX. b74 v1.7.48 — Phase 10.18 BRAIN DEMO/LIVE NAMESPACE SPLIT. b73 v1.7.47 — Phase 10.17 CHART UX PACK. b72 v1.7.46 — Phase 10.16 DESKTOP CHART WIDTH DRIFT FIX. b71 v1.7.45 — Phase 10.15 REGIME HISTORY 500 FIX. b70 v1.7.44 — Phase 10.14 LIQUIDITY MAGNET PANEL EN-ONLY. b69 v1.7.43 — Phase 10.13 SECURITY HARDENING. b68 v1.7.42 — Phase 10.12 ADAPTIVE TOGGLE TRULY WIRED. b67 v1.7.41 — Phase 10.11 ADAPTIVE CONTROL UI SYNC TO BRAIN STORE. b66 v1.7.40 — Phase 10.10 BRAIN PANELS COLLAPSE STATE PERSIST.'
    ].join(' '),
};
