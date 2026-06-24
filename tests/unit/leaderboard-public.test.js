'use strict';
const { toPublicLeaderboard } = require('../../server/routes/leaderboard');

const users = [
  { userId: 1, email: 'a@secret.io', netPnl: 100, winRate: 0.6, trades: 5 },
  { userId: 2, email: 'b@secret.io', netPnl: 300.0, winRate: 0.7, trades: 8 },
  { userId: 3, email: 'c@secret.io', netPnl: 50, winRate: 0.5, trades: 0 }, // 0 trades -> excluded
];
const profiles = { 1: { display_name: 'Ovi', username: 'zeus_ovi', avatar: 'data:img', accent_color: '#f0c040' }, 2: {} };
const getProfile = (id) => profiles[id] || null;

test('ranks by netPnl desc, excludes 0-trade, marks isYou', () => {
  const lb = toPublicLeaderboard(users, getProfile, 1, 50);
  expect(lb.length).toBe(2);
  expect(lb[0].userId).toBe(2);
  expect(lb[0].rank).toBe(1);
  expect(lb[1].userId).toBe(1);
  expect(lb[1].isYou).toBe(true);
});
test('NEVER leaks email', () => {
  const lb = toPublicLeaderboard(users, getProfile, 1, 50);
  expect(JSON.stringify(lb)).not.toMatch(/secret\.io/);
  expect(lb[0].email).toBeUndefined();
});
test('name fallback display_name -> @username -> Trader N', () => {
  const lb = toPublicLeaderboard(users, getProfile, 9, 50);
  expect(lb.find(r => r.userId === 1).name).toBe('Ovi');
  expect(lb.find(r => r.userId === 2).name).toBe('Trader 2');
});
test('winRate to percent + netPnl rounded 2dp', () => {
  const lb = toPublicLeaderboard([{ userId: 5, netPnl: 12.346, winRate: 0.5, trades: 3 }], () => null, 0, 50);
  expect(lb[0].winRate).toBe(50);
  expect(lb[0].netPnl).toBe(12.35);
});
