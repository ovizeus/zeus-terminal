// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.6.24',
    build: 15,
    date: '2026-04-18',
    changelog: 'Post-v2 batch3-A build 15 — ChartControls indicator panel reshape. OVI, LIQ, SUPREMUS, S/R and LLV removed from Row 2/Row 3 top toolbar and moved into the SELECT INDICATOR list (☰ panel). Each entry in the list now carries optional settingsModal/isOverlay/modalOnly flags: overlays route through togOvr, OVI is modal-only (OPEN button), and a ⚙️ gear next to every flagged row opens the existing settings modal. No logic changes — underlying overlays.*/indicators.* stores and per-indicator modals untouched. Next: per-indicator settings modals for the remaining 17 entries (batch3-B..F).'
};
