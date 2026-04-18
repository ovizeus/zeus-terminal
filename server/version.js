// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.6.24',
    build: 11,
    date: '2026-04-18',
    changelog: 'Post-v2 batch2 build 11 — [batch2-M1] _reconAlerted Sets → Maps with 24h TTL in serverAT.js (orphans/slFails/tpFails). Fixes silent-failure risk: previously a persistent SL re-placement failure on the same position seq was alerted once then suppressed forever; now re-pages after 24h. New helper _reconAlertedShouldFire(cat, key) with opportunistic eviction when map.size > 500. Previous builds 8-10: C1, H1/H1.1, H2, L1/L2, L2.1.'
};
