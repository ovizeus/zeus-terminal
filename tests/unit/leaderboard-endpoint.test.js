'use strict';
const lb = require('../../server/services/leaderboard');

test('gatherLeaderboardData returns a computeLeaderboard-shaped object (injected deps)', async () => {
  const now = 2_000_000_000_000;
  const deps = {
    getClosedRows: () => [{ userId: 1, env: 'TESTNET', closePnl: 5, closeReason: 'DSL_PL', ts: now - 600000, closeTs: now - 300000, qty: 1, price: 100, lev: 10 }],
    getOpenPositions: () => [{ userId: 1, env: 'TESTNET', unrealizedPnl: 2, notional: 1000, lev: 10 }],
    getBalances: () => ({ 1: 1000 }),
    getUsers: () => [{ id: 1, email: 'a@x.io', role: 'admin', lastActiveAt: now, engineActive: true }],
    now,
  };
  const res = await lb.gatherLeaderboardData({ env: 'TESTNET', window: 'all' }, deps);
  expect(res.ok).toBe(true);
  expect(res.users[0].userId).toBe(1);
  expect(res.users[0].netPnl).toBeCloseTo(5, 6);
  expect(res.users[0].unrealizedPnl).toBeCloseTo(2, 6);
});
