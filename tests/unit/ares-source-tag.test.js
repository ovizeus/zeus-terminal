'use strict';

// [AUDIT-20260619 P1-2] ARES client auto-entries bypassed the server-side
// double-execution backstop. POST /api/order/place rejects client-originated
// AUTO opens when the server fully owns entries (ownership.shouldRejectClientAutoOrder),
// but it only fires on source==='auto'. AT stamps source:'auto' (autotrade.ts) and
// IS caught; aresPlaceOrder (liveApi.ts) omitted `source`, so an ARES order slipped
// the 409 — leaving ARES single-layer where AT is double-layer.
//
// These tests pin the server-side contract the client must satisfy: an ARES order
// MUST be tagged source:'auto' so the existing 409 backstop covers it too.

const { shouldRejectClientAutoOrder } = require('../../server/services/ownership');

describe('ARES order source tag — server double-execution backstop', () => {
  test('ARES auto order tagged source:auto IS rejected when server owns entries', () => {
    expect(shouldRejectClientAutoOrder({ serverOwnsEntries: true, source: 'auto', reduceOnly: false })).toBe(true);
  });

  test('untagged order (the historical ARES bug) is NOT caught — regression guard', () => {
    // Documents WHY the client fix is required: without source, the backstop is blind.
    expect(shouldRejectClientAutoOrder({ serverOwnsEntries: true, source: undefined, reduceOnly: false })).toBe(false);
  });

  test('ARES reduceOnly close is never rejected (kill/exit must always work)', () => {
    expect(shouldRejectClientAutoOrder({ serverOwnsEntries: true, source: 'auto', reduceOnly: true })).toBe(false);
  });
});
