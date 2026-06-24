'use strict';
// [2026-06-24] User-facing leaderboard (Phase 2). Reuses the tested computeLeaderboard via
// gatherLeaderboardData, then exposes ONLY public fields joined with each user's public profile
// (display name / @username / avatar / accent). NEVER exposes email or anything sensitive.
const express = require('express');
const router = express.Router();
const db = require('../services/database');
const { gatherLeaderboardData } = require('../services/leaderboard');

// Pure mapper — easy to unit test. `getProfile(id)` returns the public profile row (or null).
function toPublicLeaderboard(users, getProfile, myId, limit) {
  return (users || [])
    .filter((u) => u && u.trades > 0)
    .sort((a, b) => (b.netPnl || 0) - (a.netPnl || 0))
    .slice(0, limit || 50)
    .map((u, i) => {
      const p = getProfile(u.userId) || {};
      const name = p.display_name || (p.username ? '@' + p.username : 'Trader ' + u.userId);
      return {
        rank: i + 1,
        userId: u.userId,
        name,
        username: p.username || null,
        avatar: p.avatar || null,
        accent: p.accent_color || null,
        netPnl: Math.round((Number(u.netPnl) || 0) * 100) / 100,
        winRate: Math.round((Number(u.winRate) || 0) * 100),
        trades: u.trades,
        isYou: u.userId === myId,
      };
    });
}

router.get('/', async (req, res) => {
  if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'auth' });
  const env = ['REAL', 'TESTNET', 'DEMO'].includes(req.query.env) ? req.query.env : 'DEMO';
  const window = ['today', '7d', '30d', 'all'].includes(req.query.window) ? req.query.window : 'all';
  try {
    const data = await gatherLeaderboardData({ env, window });
    const lb = toPublicLeaderboard(data.users, (id) => db.getUserProfileById(id), req.user.id, 50);
    res.json({ ok: true, env, window, leaderboard: lb });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'leaderboard_failed' });
  }
});

module.exports = router;
module.exports.toPublicLeaderboard = toPublicLeaderboard;
