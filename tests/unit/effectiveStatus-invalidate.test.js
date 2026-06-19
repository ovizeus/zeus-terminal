'use strict';

// [AUDIT-20260619 P3] effectiveStatus.invalidate used `k.includes(cellKey)` which
// substring-matches: invalidating user 1's cell ("1:DEMO:BTC:TREND") ALSO deleted
// user 21's cell ("21:DEMO:BTC:TREND".includes("1:DEMO:BTC:TREND") === true) → cross-
// user cache over-eviction. The L4 cellKey passed by the only caller is always the
// full key, so exact `k === cellKey` is sufficient; the includes branch only ever
// matched OTHER users' longer keys (never parent levels, which are shorter).

jest.doMock('../../server/services/ml/_ring5/banditPosteriors', () => ({
  walkHierarchy: () => ({ level: 4, cellKey: 'x', alpha: 2, beta: 3, observationCount: 5 }),
}));

const es = require('../../server/services/ml/_ring5/effectiveStatus');

describe('effectiveStatus.invalidate — exact key, no cross-user over-eviction', () => {
  test('invalidating user 1 does NOT evict user 21 (substring collision)', () => {
    const now = 1_000_000;
    es.resolve({ userId: 1, env: 'DEMO', symbol: 'BTC', regime: 'TREND', nowTs: now });   // miss → cached
    es.resolve({ userId: 21, env: 'DEMO', symbol: 'BTC', regime: 'TREND', nowTs: now });  // miss → cached

    es.invalidate({ cellKey: '1:DEMO:BTC:TREND' });

    // user 21 must STILL be cached (the bug evicted it):
    const r21 = es.resolve({ userId: 21, env: 'DEMO', symbol: 'BTC', regime: 'TREND', nowTs: now });
    expect(r21.cacheHit).toBe(true);

    // user 1 must be gone (correctly invalidated):
    const r1 = es.resolve({ userId: 1, env: 'DEMO', symbol: 'BTC', regime: 'TREND', nowTs: now });
    expect(r1.cacheHit).toBe(false);
  });
});
