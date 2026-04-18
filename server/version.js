// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.6.24',
    build: 14,
    date: '2026-04-18',
    changelog: 'Post-v2 batch2 build 14 — [batch2-L2] _clientErrorLastTs opportunistic eviction in server.js. When the throttle Map grows past 200 entries, entries older than 1h TTL are swept in-place on the next /api/client-error POST, keeping memory bounded by active-user count. Post-v2 batch2 CLOSED (M1+M2+L1+L2). Previous builds 8-13: C1, H1/H1.1, H2, L1/L2, L2.1, batch2-M1, batch2-M2, batch2-L1.'
};
