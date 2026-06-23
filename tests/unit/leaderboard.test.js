'use strict';
const lb = require('../../server/services/leaderboard');

describe('leaderboard pure helpers', () => {
  test('estimateFee = |notional| * takerRate * roundTrips (default 0.04% x2)', () => {
    expect(lb.estimateFee(10000)).toBeCloseTo(8, 6);
    expect(lb.estimateFee(-5000)).toBeCloseTo(4, 6);
    expect(lb.estimateFee(0)).toBe(0);
    expect(lb.estimateFee('x')).toBe(0);
  });
  test('_normalizeTs treats sub-1e12 values as seconds, passes ms through, rejects junk', () => {
    expect(lb._normalizeTs(1782225300177)).toBe(1782225300177);
    expect(lb._normalizeTs(1782225300)).toBe(1782225300000);
    expect(lb._normalizeTs(0)).toBeNull();
    expect(lb._normalizeTs(null)).toBeNull();
  });
  test('_windowStart returns correct cutoff (all=0)', () => {
    const now = 2_000_000_000_000;
    expect(lb._windowStart('all', now)).toBe(0);
    expect(lb._windowStart('today', now)).toBe(now - 86400000);
    expect(lb._windowStart('7d', now)).toBe(now - 7 * 86400000);
    expect(lb._windowStart('30d', now)).toBe(now - 30 * 86400000);
    expect(lb._windowStart('garbage', now)).toBe(0);
  });
});
