// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.6.24',
    build: 12,
    date: '2026-04-18',
    changelog: 'Post-v2 batch2 build 12 — [batch2-M2] CSRF Origin strict on sendBeacon endpoints (/api/client-error, /api/sync/state, /api/sync/user-context). Previously `if (origin && !allowed...)` short-circuited on empty Origin, accepting POSTs from non-browser clients; now absent Origin returns 403 "origin required". Modern browsers always set Origin on POST. Previous builds 8-11: C1, H1/H1.1, H2, L1/L2, L2.1, batch2-M1 (_reconAlerted 24h TTL).'
};
