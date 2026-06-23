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

describe('_isCountedTrade', () => {
  const ok = (closeReason, closePnl = 1, qty = 0.5) => lb._isCountedTrade({ closeReason, closePnl, qty });
  test('counts real filled trades', () => {
    for (const r of ['DSL_PL', 'HIT_SL', 'HIT_TP', 'LIQUIDATED', 'SMART_CUT', 'DSL_TTP', 'Manual close', 'AUTO SL 🛑', 'Emergency Stop']) {
      expect(ok(r)).toBe(true);
    }
  });
  test('excludes non-trade noise', () => {
    for (const r of ['ENTRY_FAILED_INSUFFICIENT_MARGIN', 'RECON_PHANTOM', 'RECON_PHANTOM_STALE_EMPTY', 'RESET', 'MANUAL_CLIENT', 'Close All Manual', 'TEST', 'TEST_GHOST', 'EXTERNAL_CLOSE']) {
      expect(ok(r)).toBe(false);
    }
  });
  test('excludes rows with no real fill or non-numeric pnl', () => {
    expect(lb._isCountedTrade({ closeReason: 'DSL_PL', closePnl: 5, qty: 0 })).toBe(false);
    expect(lb._isCountedTrade({ closeReason: 'DSL_PL', closePnl: null, qty: 1 })).toBe(false);
  });
});
