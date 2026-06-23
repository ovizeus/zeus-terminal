'use strict';

// Estimated round-trip taker fee from notional (used only when a real fill fee
// is not stored). Default Binance USDT-M taker 0.04% x2.
function estimateFee(notional, roundTrips = 2, takerRate = 0.0004) {
  const n = Number(notional);
  if (!Number.isFinite(n)) return 0;
  return Math.abs(n) * takerRate * roundTrips;
}

// Reliable epoch-ms: legacy values below 1e12 are seconds. Junk -> null.
function _normalizeTs(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1e12 ? n * 1000 : n;
}

function _windowStart(window, now) {
  if (window === 'today') return now - 86400000;
  if (window === '7d') return now - 7 * 86400000;
  if (window === '30d') return now - 30 * 86400000;
  return 0; // 'all' / default
}

const _NOISE_REASON = /^(ENTRY_FAILED|RECON_PHANTOM|RESET|MANUAL_CLIENT|Close All Manual|TEST|TEST_GHOST|EXTERNAL_CLOSE)/i;

function _isCountedTrade(row) {
  if (!row) return false;
  if (_NOISE_REASON.test(String(row.closeReason || ''))) return false;
  if (row.closePnl === null || row.closePnl === undefined || row.closePnl === '') return false;
  if (!Number.isFinite(Number(row.closePnl))) return false;
  if (!(Number(row.qty) > 0)) return false;
  return true;
}

function _drawdownAndStreak(pnls) {
  let cum = 0, peak = 0, maxDD = 0;
  for (const p of pnls) { cum += p; if (cum > peak) peak = cum; const dd = peak - cum; if (dd > maxDD) maxDD = dd; }
  let streak = 0;
  for (let i = pnls.length - 1; i >= 0; i--) {
    const s = pnls[i] > 0 ? 1 : pnls[i] < 0 ? -1 : 0;
    if (s === 0) break;
    if (streak === 0) streak = s;
    else if (Math.sign(streak) === s) streak += s;
    else break;
  }
  return { maxDrawdown: maxDD, currentStreak: streak };
}

function _spark(pnls) {
  if (!pnls.length) return [];
  const cum = []; let c = 0;
  for (const p of pnls) { c += p; cum.push(+c.toFixed(4)); }
  const step = Math.max(1, Math.ceil(cum.length / 40));
  return cum.filter((_, i) => i % step === 0 || i === cum.length - 1);
}

function computeLeaderboard(closedRows, openPositions, balances, users, opts) {
  const o = opts || {};
  const env = o.env || 'TESTNET';
  const window = o.window || 'all';
  const now = Number.isFinite(o.now) ? o.now : Date.now();
  const onlineMs = Number.isFinite(o.onlineMs) ? o.onlineMs : 300000;
  const cutoff = _windowStart(window, now);

  const byUser = new Map();
  const ensure = (uid) => { if (!byUser.has(uid)) byUser.set(uid, []); return byUser.get(uid); };
  const counted = (closedRows || []).filter(r => r && r.env === env && _isCountedTrade(r));
  for (const r of counted) {
    const ct = _normalizeTs(r.closeTs);
    if (ct == null) { if (cutoff > 0) continue; }   // no closeTs -> only the 'all' window (cutoff 0)
    else if (ct < cutoff) continue;
    ensure(r.userId).push({ ...r, _closeMs: ct || _normalizeTs(r.ts) || 0, _openMs: _normalizeTs(r.ts) });
  }

  const liveByUser = new Map();
  for (const p of (openPositions || [])) {
    if (!p || p.env !== env) continue;
    const l = liveByUser.get(p.userId) || { unrealizedPnl: 0, openCount: 0, exposure: 0, levSum: 0 };
    l.unrealizedPnl += Number(p.unrealizedPnl) || 0;
    l.openCount += 1;
    l.exposure += Math.abs(Number(p.notional) || 0);
    l.levSum += Number(p.lev) || 0;
    liveByUser.set(p.userId, l);
  }

  const rows = (users || []).map(u => {
    const trades = (byUser.get(u.id) || []).slice().sort((a, b) => a._closeMs - b._closeMs);
    const pnls = trades.map(t => Number(t.closePnl));
    const netPnl = pnls.reduce((s, p) => s + p, 0);
    const grossProfit = pnls.filter(p => p > 0).reduce((s, p) => s + p, 0);
    const grossLoss = Math.abs(pnls.filter(p => p < 0).reduce((s, p) => s + p, 0));
    const wins = pnls.filter(p => p > 0).length;
    const durations = trades.filter(t => t._openMs && t._closeMs).map(t => (t._closeMs - t._openMs) / 60000);
    const liquidations = trades.filter(t => /LIQUIDATED/i.test(t.closeReason || '')).length;

    let commissions = 0, commissionsEst = 0, anyEstimated = false;
    for (const t of trades) {
      if (Number.isFinite(Number(t.fee))) { commissions += Number(t.fee); }
      else { commissionsEst += estimateFee((Number(t.qty) || 0) * (Number(t.price) || 0)); anyEstimated = true; }
    }

    const { maxDrawdown, currentStreak } = _drawdownAndStreak(pnls);
    const live = liveByUser.get(u.id) || { unrealizedPnl: 0, openCount: 0, exposure: 0, levSum: 0 };
    const balance = Number(balances && balances[u.id]) || 0;
    const lastActiveAt = Number(u.lastActiveAt) || 0;

    return {
      userId: u.id, email: u.email, role: u.role,
      netPnl, grossProfit, grossLoss,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0),
      trades: trades.length, wins, winRate: trades.length ? wins / trades.length : 0,
      bestTrade: pnls.length ? Math.max(...pnls) : 0,
      worstTrade: pnls.length ? Math.min(...pnls) : 0,
      avgTrade: trades.length ? netPnl / trades.length : 0,
      maxDrawdown, currentStreak,
      avgTimeInTradeMin: durations.length ? durations.reduce((s, d) => s + d, 0) / durations.length : 0,
      commissions, commissionsEst, feeEstimated: anyEstimated,
      netAfterFees: netPnl - (commissions + commissionsEst),
      unrealizedPnl: live.unrealizedPnl, openCount: live.openCount, exposure: live.exposure,
      avgLeverage: live.openCount ? live.levSum / live.openCount : 0,
      liquidations,
      balance, equity: balance + live.unrealizedPnl,
      online: lastActiveAt > 0 && (now - lastActiveAt) < onlineMs,
      engineActive: !!u.engineActive,
      lastActiveAt,
      lastTradeAt: trades.length ? trades[trades.length - 1]._closeMs : 0,
      pnlSpark: _spark(pnls),
    };
  });

  rows.sort((a, b) => b.netPnl - a.netPnl);
  const totals = {
    netPnl: rows.reduce((s, r) => s + r.netPnl, 0),
    unrealizedPnl: rows.reduce((s, r) => s + r.unrealizedPnl, 0),
    online: rows.filter(r => r.online).length,
    users: rows.length,
  };
  return { env, window, generatedAt: now, users: rows, totals };
}

// Impure adapter. Deps are injectable for tests; in production they default to
// the live DB / serverAT / exchangeOps. Read-only. Caches ~10s per (env,window).
const _cache = new Map(); // key `${env}:${window}` -> { ts, data }
const CACHE_MS = 10000;

async function gatherLeaderboardData(opts, deps) {
  const env = (opts && opts.env) || 'TESTNET';
  const window = (opts && opts.window) || 'all';
  const now = (deps && Number.isFinite(deps.now)) ? deps.now : Date.now();
  const key = `${env}:${window}`;
  if (!deps) {
    const hit = _cache.get(key);
    if (hit && (now - hit.ts) < CACHE_MS) return hit.data;
  }
  const d = deps || _liveDeps();
  const closedRows = await d.getClosedRows(env, _windowStart(window, now));
  const openPositions = await d.getOpenPositions();
  const balances = await d.getBalances(openPositions, env);
  const users = await d.getUsers();
  const computed = computeLeaderboard(closedRows, openPositions, balances, users, { env, window, now });
  const data = { ok: true, ...computed };
  if (!deps) _cache.set(key, { ts: now, data });
  return data;
}

// Live data sources (kept tiny + isolated; covered by the adapter test via injection).
function _liveDeps() {
  const db = require('./database').db;
  const serverAT = require('./serverAT');
  return {
    getClosedRows(env) {
      const rows = db.prepare('SELECT data FROM at_closed').all();
      const out = [];
      for (const r of rows) {
        let p; try { p = JSON.parse(r.data); } catch (_) { continue; }
        if (!p || p.env !== env) continue;
        out.push({ userId: p.userId, env: p.env, closePnl: p.closePnl, closeReason: p.closeReason, ts: p.ts, closeTs: p.closeTs, qty: p.qty, price: p.price, lev: p.lev, fee: p.fee });
      }
      return out;
    },
    getOpenPositions() {
      const ids = db.prepare("SELECT DISTINCT user_id FROM at_positions WHERE status='OPEN'").all().map(r => r.user_id);
      const out = [];
      for (const uid of ids) {
        for (const p of (serverAT.getOpenPositions(uid) || [])) {
          const notional = (Number(p.qty) || 0) * (Number(p.price) || 0);
          out.push({ userId: uid, env: p.env, unrealizedPnl: Number(p.unrealizedPnL != null ? p.unrealizedPnL : p.unrealizedPnl) || 0, notional, lev: p.lev });
        }
      }
      return out;
    },
    async getBalances(openPositions) {
      const bal = {};
      const ids = [...new Set((openPositions || []).map(p => p.userId))];
      for (const uid of ids) {
        try { const b = await require('./exchangeOps').getBalance(uid); bal[uid] = b ? parseFloat(b.walletBalance != null ? b.walletBalance : (b.balance || 0)) : 0; }
        catch (_) { bal[uid] = 0; }
      }
      return bal;
    },
    getUsers() {
      const rows = db.prepare('SELECT id, email, role, last_active_at FROM users').all();
      const serverAT2 = require('./serverAT');
      return rows.map(u => ({
        id: u.id, email: u.email, role: u.role,
        lastActiveAt: u.last_active_at ? new Date(u.last_active_at).getTime() : 0,
        engineActive: typeof serverAT2.isEngineActive === 'function' ? !!serverAT2.isEngineActive(u.id) : false,
      }));
    },
  };
}

module.exports = { estimateFee, _normalizeTs, _windowStart, _isCountedTrade, computeLeaderboard, gatherLeaderboardData };
