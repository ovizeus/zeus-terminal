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

describe('computeLeaderboard', () => {
  const now = 2_000_000_000_000;
  const users = [
    { id: 1, email: 'a@x.io', role: 'admin', lastActiveAt: now - 60000, engineActive: true },
    { id: 2, email: 'b@x.io', role: 'user', lastActiveAt: now - 9999999, engineActive: false },
  ];
  const closed = [
    { userId: 1, env: 'TESTNET', closePnl: 10, closeReason: 'DSL_PL', ts: now - 7200000, closeTs: now - 6600000, qty: 1, price: 100, lev: 10 },
    { userId: 1, env: 'TESTNET', closePnl: -4, closeReason: 'HIT_SL', ts: now - 3600000, closeTs: now - 3300000, qty: 1, price: 100, lev: 10 },
    { userId: 1, env: 'REAL',    closePnl: 999, closeReason: 'DSL_PL', ts: now - 100000, closeTs: now - 50000, qty: 1, price: 100, lev: 10 },
    { userId: 1, env: 'TESTNET', closePnl: 5, closeReason: 'ENTRY_FAILED_X', ts: now, closeTs: now, qty: 0, price: 100, lev: 10 },
    { userId: 2, env: 'TESTNET', closePnl: 2, closeReason: 'HIT_TP', ts: now - 1800000, closeTs: now - 1700000, qty: 2, price: 50, lev: 5 },
  ];
  const opens = [{ userId: 1, env: 'TESTNET', unrealizedPnl: 3.5, notional: 1000, lev: 10 }];
  const balances = { 1: 2000, 2: 500 };
  const res = lb.computeLeaderboard(closed, opens, balances, users, { env: 'TESTNET', window: 'all', now });

  test('env filter + ranking', () => {
    expect(res.users.map(u => u.userId)).toEqual([1, 2]);
    expect(res.users[0].netPnl).toBeCloseTo(6, 6);
    expect(res.users[1].netPnl).toBeCloseTo(2, 6);
  });
  test('gross profit/loss + profit factor', () => {
    const u1 = res.users[0];
    expect(u1.grossProfit).toBeCloseTo(10, 6);
    expect(u1.grossLoss).toBeCloseTo(4, 6);
    expect(u1.profitFactor).toBeCloseTo(2.5, 6);
  });
  test('winRate / trades / best / worst', () => {
    const u1 = res.users[0];
    expect(u1.trades).toBe(2); expect(u1.wins).toBe(1); expect(u1.winRate).toBeCloseTo(0.5, 6);
    expect(u1.bestTrade).toBeCloseTo(10, 6); expect(u1.worstTrade).toBeCloseTo(-4, 6);
  });
  test('avgTimeInTradeMin from ts/closeTs', () => { expect(res.users[0].avgTimeInTradeMin).toBeCloseTo(7.5, 3); });
  test('maxDrawdown', () => { expect(res.users[0].maxDrawdown).toBeCloseTo(4, 6); });
  test('currentStreak last trade loss -> -1', () => { expect(res.users[0].currentStreak).toBe(-1); });
  test('fees estimated when no stored fee', () => {
    const u1 = res.users[0];
    expect(u1.commissions).toBeCloseTo(0, 6);
    expect(u1.commissionsEst).toBeCloseTo(0.16, 4);
    expect(u1.feeEstimated).toBe(true);
    expect(u1.netAfterFees).toBeCloseTo(6 - 0.16, 4);
  });
  test('live fields', () => {
    const u1 = res.users[0];
    expect(u1.unrealizedPnl).toBeCloseTo(3.5, 6); expect(u1.openCount).toBe(1);
    expect(u1.exposure).toBeCloseTo(1000, 6); expect(u1.balance).toBeCloseTo(2000, 6);
    expect(u1.equity).toBeCloseTo(2003.5, 6); expect(u1.online).toBe(true);
    expect(u1.engineActive).toBe(true); expect(res.users[1].online).toBe(false);
  });
  test('stored fee summed as real', () => {
    const withFee = [{ userId: 9, env: 'TESTNET', closePnl: 10, closeReason: 'DSL_PL', ts: now - 600000, closeTs: now - 300000, qty: 1, price: 100, lev: 10, fee: 0.5 }];
    const r = lb.computeLeaderboard(withFee, [], {}, [{ id: 9, email: 'c@x.io', role: 'user', lastActiveAt: 0, engineActive: false }], { env: 'TESTNET', window: 'all', now });
    expect(r.users[0].commissions).toBeCloseTo(0.5, 6);
    expect(r.users[0].commissionsEst).toBeCloseTo(0, 6);
    expect(r.users[0].feeEstimated).toBe(false);
  });
  test('window filter uses closeTs', () => {
    const r7 = lb.computeLeaderboard(closed, opens, balances, users, { env: 'TESTNET', window: '7d', now });
    expect(r7.users[0].trades).toBe(2);
    const rToday = lb.computeLeaderboard(
      [{ userId: 1, env: 'TESTNET', closePnl: 1, closeReason: 'DSL_PL', ts: now - 200000000, closeTs: now - 200000000, qty: 1, price: 100, lev: 10 }],
      [], {}, users, { env: 'TESTNET', window: 'today', now });
    expect(rToday.users[0].trades).toBe(0);
  });
  test('zero-activity users still listed', () => {
    const r = lb.computeLeaderboard([], [], {}, users, { env: 'REAL', window: 'all', now });
    expect(r.users.length).toBe(2);
    expect(r.users.every(u => u.trades === 0)).toBe(true);
  });
});

describe('computeLeaderboard — review gaps', () => {
  const now = 2_000_000_000_000;
  test('profitFactor 0 when no trades', () => {
    const r = lb.computeLeaderboard([], [], {}, [{ id: 1, email: 'z@x.io', role: 'user', lastActiveAt: 0, engineActive: false }], { env: 'TESTNET', window: 'all', now });
    expect(r.users[0].profitFactor).toBe(0);
  });
  test('currentStreak counts a winning run from the end', () => {
    const mk = (pnl, i) => ({ userId: 1, env: 'TESTNET', closePnl: pnl, closeReason: 'DSL_PL', ts: now - (10 - i) * 60000, closeTs: now - (9 - i) * 60000, qty: 1, price: 100, lev: 10 });
    const rows = [mk(-3, 0), mk(2, 1), mk(4, 2)]; // loss then two wins
    const r = lb.computeLeaderboard(rows, [], {}, [{ id: 1, email: 'a@x.io', role: 'user', lastActiveAt: 0, engineActive: false }], { env: 'TESTNET', window: 'all', now });
    expect(r.users[0].currentStreak).toBe(2);
  });
  test('row without closeTs counts only in the all window', () => {
    const u = [{ id: 1, email: 'a@x.io', role: 'user', lastActiveAt: 0, engineActive: false }];
    const row = [{ userId: 1, env: 'TESTNET', closePnl: 5, closeReason: 'DSL_PL', ts: now - 60000, qty: 1, price: 100, lev: 10 }]; // no closeTs
    expect(lb.computeLeaderboard(row, [], {}, u, { env: 'TESTNET', window: 'today', now }).users[0].trades).toBe(0);
    expect(lb.computeLeaderboard(row, [], {}, u, { env: 'TESTNET', window: 'all', now }).users[0].trades).toBe(1);
  });
});
