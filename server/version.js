// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.6.24',
    build: 13,
    date: '2026-04-18',
    changelog: 'Post-v2 batch2 build 13 — [batch2-L1] _orphanPending stale-entry eviction in serverAT.js. On each recon cycle, entries older than 3 cycles (180s) without a second detection are removed, preventing unbounded Map growth when users close orphans manually between recon cycles. Previous builds 8-12: C1, H1/H1.1, H2, L1/L2, L2.1, batch2-M1, batch2-M2.'
};
