// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.6.25',
    build: 18,
    date: '2026-04-18',
    changelog: 'Post-v2 batch3-C b18 — EMA extended to 4 periods (p3/p4) + overlay-toggle hardening. IND_SETTINGS.ema now has p1/p2/p3/p4 in both client state.ts and public/legacy state.js; openIndSettings shows all four Period inputs (labels p3=Period 3, p4=Period 4). marketDataChart.initCharts creates two new line series (w.ema3S #00ff88, w.ema4S #ff66cc) and renderChart feeds them from IND_SETTINGS.ema.p3/p4 (0 = hidden). engine/indicators applyIndVisibility toggles ema3S/ema4S visibility with ema. phase1Adapters seeds w.ema3S/w.ema4S = null before initCharts runs to keep typeof checks safe. PanelShell chart legend shows EMA P1/P2/P3/P4 with matching colors. ChartControls togOvr now trusts legacy w.S.overlays[key] as source of truth (reads the new value AFTER togOvrFn runs so React state can never lag behind the legacy store), and the sync useEffect mirrors w.S.overlays → React store every 2s so toggles that mutate only the legacy side (persistence, cross-module bumps) show up in the React UI within ≤2s. Previous builds 8-17.'
};
