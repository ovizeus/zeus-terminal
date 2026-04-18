// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.6.24',
    build: 16,
    date: '2026-04-18',
    changelog: 'Post-v2 batch3-A.1 build 16 — OVI gains an on/off toggle like the other overlays (user feedback on batch3-A). OverlayToggles gets an ovi:boolean field in market.ts; both default overlays states (core/state.ts + stores/marketStore.ts) initialise ovi:false; data/marketDataOverlays togOvr handles the new case by mirroring overlays.ovi into legacy S.oviOn and calling oviReadSettings + renderOviLiquid / clearOviLiquid. ChartControls OVI row flipped from modalOnly to isOverlay so it renders as ⚙️ + toggle like LIQ/SUPREMUS/S/R/LLV. Previous builds 8-15: C1, H1/H1.1, H2, L1/L2, L2.1, batch2-M1/M2/L1/L2, batch3-A.'
};
