# Admin User Leaderboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin-only "🏆 Leaderboard" tab ranking all users by real, env-scoped, windowed PnL with profit/loss, win-rate, profit factor, fees, avg time-in-trade, live unrealized/equity, drawdown, streak, and online/engine status.

**Architecture:** A PURE compute core (`computeLeaderboard`) unit-tested with synthetic data; a thin impure adapter (`gatherLeaderboardData`) that reads `at_closed` + open positions + balances + users and calls the core; a thin admin endpoint `GET /api/admin/leaderboard`; a React tab in the existing admin Users section. One isolated additive money-path task persists real commission at close.

**Tech Stack:** Node CommonJS (`server/`), better-sqlite3 (`data/zeus.db`), jest (`sudo -u zeus npx jest <file> --forceExit --runInBand`), React + Zustand + Vite (`client/`, build `cd client && npm run build`). Spec: `docs/superpowers/specs/2026-06-23-admin-leaderboard-design.md`.

**Conventions (from the codebase):**
- Run server tests as the `zeus` user, never root: `sudo -u zeus npx jest tests/unit/<file>.test.js --forceExit --runInBand 2>&1 | tail -20`.
- Admin routes use `_requireAuth, _requireAdmin` (see `server/routes/admin.js:10-22`).
- `at_closed` blob is the full position object JSON; key fields: `userId, env, closePnl, closeReason, ts (open ms), closeTs (close ms), qty, price, lev`. The `closed_at` COLUMN has mixed units — DO NOT use it; use blob `closeTs`.
- `serverAT.getOpenPositions(uid)` returns enriched open positions; `exchangeOps.getBalance(uid)` returns `{walletBalance, availableBalance}`.

---

## File Structure

- **Create** `server/services/leaderboard.js` — `estimateFee` (pure), `computeLeaderboard` (pure), `gatherLeaderboardData` (impure adapter). One responsibility: leaderboard aggregation.
- **Create** `tests/unit/leaderboard.test.js` — the pure-core suite.
- **Modify** `server/routes/admin.js` — add `GET /leaderboard` (thin).
- **Create** `client/src/components/admin/sections/LeaderboardTab.tsx` — the tab view (table + env toggle + window selector).
- **Modify** `client/src/components/admin/sections/UsersSection.tsx` — add a Users | Leaderboard tab switch.
- **Modify** `server/services/serverAT.js` — Task 7 only: persist real `fee` at live close (additive, fail-safe).

---

## Task 1: Pure helpers — `estimateFee`, `_normalizeTs`, `_windowStart`

**Files:**
- Create: `server/services/leaderboard.js`
- Test: `tests/unit/leaderboard.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/leaderboard.test.js
'use strict';
const lb = require('../../server/services/leaderboard');

describe('leaderboard pure helpers', () => {
  test('estimateFee = |notional| * takerRate * roundTrips (default 0.04% x2)', () => {
    expect(lb.estimateFee(10000)).toBeCloseTo(8, 6);      // 10000*0.0004*2
    expect(lb.estimateFee(-5000)).toBeCloseTo(4, 6);      // abs
    expect(lb.estimateFee(0)).toBe(0);
    expect(lb.estimateFee('x')).toBe(0);                  // non-numeric safe
  });

  test('_normalizeTs treats sub-1e12 values as seconds, passes ms through, rejects junk', () => {
    expect(lb._normalizeTs(1782225300177)).toBe(1782225300177); // ms passthrough
    expect(lb._normalizeTs(1782225300)).toBe(1782225300000);    // seconds -> ms
    expect(lb._normalizeTs(0)).toBeNull();
    expect(lb._normalizeTs(null)).toBeNull();
  });

  test('_windowStart returns correct cutoff (all=0)', () => {
    const now = 2_000_000_000_000;
    expect(lb._windowStart('all', now)).toBe(0);
    expect(lb._windowStart('today', now)).toBe(now - 86400000);
    expect(lb._windowStart('7d', now)).toBe(now - 7 * 86400000);
    expect(lb._windowStart('30d', now)).toBe(now - 30 * 86400000);
    expect(lb._windowStart('garbage', now)).toBe(0); // default all
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /opt/zeus-terminal && sudo -u zeus npx jest tests/unit/leaderboard.test.js --forceExit --runInBand 2>&1 | tail -15`
Expected: FAIL — `Cannot find module '../../server/services/leaderboard'`.

- [ ] **Step 3: Write minimal implementation**

```js
// server/services/leaderboard.js
'use strict';

// Estimated round-trip taker fee from notional (used only when a real fill fee
// is not stored — see gatherLeaderboardData). Default Binance USDT-M taker 0.04% x2.
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

module.exports = { estimateFee, _normalizeTs, _windowStart };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /opt/zeus-terminal && sudo -u zeus npx jest tests/unit/leaderboard.test.js --forceExit --runInBand 2>&1 | tail -8`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd /opt/zeus-terminal && git add server/services/leaderboard.js tests/unit/leaderboard.test.js
git commit -m "feat(admin-leaderboard): pure helpers estimateFee/_normalizeTs/_windowStart (TDD)"
```

---

## Task 2: `_isCountedTrade` — noise exclusion

**Files:**
- Modify: `server/services/leaderboard.js`
- Test: `tests/unit/leaderboard.test.js`

- [ ] **Step 1: Write the failing test** (append to the test file)

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /opt/zeus-terminal && sudo -u zeus npx jest tests/unit/leaderboard.test.js -t _isCountedTrade --forceExit --runInBand 2>&1 | tail -12`
Expected: FAIL — `lb._isCountedTrade is not a function`.

- [ ] **Step 3: Implement** (add to `leaderboard.js`, export it)

```js
// Non-trade close reasons that must never count toward PnL/fees.
const _NOISE_REASON = /^(ENTRY_FAILED|RECON_PHANTOM|RESET|MANUAL_CLIENT|Close All Manual|TEST|TEST_GHOST|EXTERNAL_CLOSE)/i;

function _isCountedTrade(row) {
  if (!row) return false;
  if (_NOISE_REASON.test(String(row.closeReason || ''))) return false;
  if (!Number.isFinite(Number(row.closePnl))) return false;
  if (!(Number(row.qty) > 0)) return false;
  return true;
}
```

Add `_isCountedTrade` to `module.exports`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd /opt/zeus-terminal && sudo -u zeus npx jest tests/unit/leaderboard.test.js -t _isCountedTrade --forceExit --runInBand 2>&1 | tail -8`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd /opt/zeus-terminal && git add server/services/leaderboard.js tests/unit/leaderboard.test.js
git commit -m "feat(admin-leaderboard): _isCountedTrade noise exclusion (TDD)"
```

---

## Task 3: `computeLeaderboard` — the pure aggregation core

**Files:**
- Modify: `server/services/leaderboard.js`
- Test: `tests/unit/leaderboard.test.js`

**Signature:**
```
computeLeaderboard(closedRows, openPositions, balances, users, opts) -> { env, window, generatedAt, users:[row], totals }
  closedRows:   [{ userId, env, closePnl, closeReason, ts, closeTs, qty, price, lev, fee? }]
  openPositions:[{ userId, env, unrealizedPnl, notional, lev }]
  balances:     { [userId]: walletBalanceNumber }
  users:        [{ id, email, role, lastActiveAt, engineActive }]
  opts:         { env, window, now, onlineMs=300000 }
per-user row fields: userId,email,role, netPnl,grossProfit,grossLoss,profitFactor,
  trades,wins,winRate, bestTrade,worstTrade,avgTrade, maxDrawdown,currentStreak,
  avgTimeInTradeMin, commissions,commissionsEst,feeEstimated(bool),netAfterFees,
  unrealizedPnl,openCount,exposure,avgLeverage,liquidations, balance,equity,
  online,engineActive,lastActiveAt,lastTradeAt, pnlSpark[]
```

- [ ] **Step 1: Write the failing test** (append)

```js
describe('computeLeaderboard', () => {
  const now = 2_000_000_000_000; // fixed ms anchor
  const users = [
    { id: 1, email: 'a@x.io', role: 'admin', lastActiveAt: now - 60000, engineActive: true },   // online
    { id: 2, email: 'b@x.io', role: 'user', lastActiveAt: now - 9999999, engineActive: false },  // offline
  ];
  // uid1 TESTNET: +10 (win), -4 (loss); uid2 TESTNET: +2 (win). uid1 also a REAL row that must be filtered out.
  const closed = [
    { userId: 1, env: 'TESTNET', closePnl: 10, closeReason: 'DSL_PL', ts: now - 7200000, closeTs: now - 6600000, qty: 1, price: 100, lev: 10 }, // 10 min
    { userId: 1, env: 'TESTNET', closePnl: -4, closeReason: 'HIT_SL', ts: now - 3600000, closeTs: now - 3300000, qty: 1, price: 100, lev: 10 }, // 5 min
    { userId: 1, env: 'REAL',    closePnl: 999, closeReason: 'DSL_PL', ts: now - 100000, closeTs: now - 50000, qty: 1, price: 100, lev: 10 },   // filtered (env)
    { userId: 1, env: 'TESTNET', closePnl: 5, closeReason: 'ENTRY_FAILED_X', ts: now, closeTs: now, qty: 0, price: 100, lev: 10 },             // filtered (noise)
    { userId: 2, env: 'TESTNET', closePnl: 2, closeReason: 'HIT_TP', ts: now - 1800000, closeTs: now - 1700000, qty: 2, price: 50, lev: 5 },
  ];
  const opens = [{ userId: 1, env: 'TESTNET', unrealizedPnl: 3.5, notional: 1000, lev: 10 }];
  const balances = { 1: 2000, 2: 500 };
  const res = lb.computeLeaderboard(closed, opens, balances, users, { env: 'TESTNET', window: 'all', now });

  test('env filter + ranking: uid1 first (net +6), uid2 second (net +2)', () => {
    expect(res.users.map(u => u.userId)).toEqual([1, 2]);
    expect(res.users[0].netPnl).toBeCloseTo(6, 6);   // 10 - 4 (REAL 999 excluded)
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
    expect(u1.trades).toBe(2);
    expect(u1.wins).toBe(1);
    expect(u1.winRate).toBeCloseTo(0.5, 6);
    expect(u1.bestTrade).toBeCloseTo(10, 6);
    expect(u1.worstTrade).toBeCloseTo(-4, 6);
  });
  test('avgTimeInTradeMin from ts/closeTs (10min + 5min -> 7.5)', () => {
    expect(res.users[0].avgTimeInTradeMin).toBeCloseTo(7.5, 3);
  });
  test('maxDrawdown on cumulative curve (peak 10 then -4 -> DD 4)', () => {
    expect(res.users[0].maxDrawdown).toBeCloseTo(4, 6);
  });
  test('currentStreak: last trade was a loss -> -1', () => {
    expect(res.users[0].currentStreak).toBe(-1);
  });
  test('fees estimated when no stored fee (notional=qty*price; round-trip est)', () => {
    const u1 = res.users[0];
    // two counted trades, each notional 100 -> est 100*0.0004*2 = 0.08 each -> 0.16
    expect(u1.commissions).toBeCloseTo(0, 6);
    expect(u1.commissionsEst).toBeCloseTo(0.16, 4);
    expect(u1.feeEstimated).toBe(true);
    expect(u1.netAfterFees).toBeCloseTo(6 - 0.16, 4);
  });
  test('live: unrealized, equity, exposure, online/engine', () => {
    const u1 = res.users[0];
    expect(u1.unrealizedPnl).toBeCloseTo(3.5, 6);
    expect(u1.openCount).toBe(1);
    expect(u1.exposure).toBeCloseTo(1000, 6);
    expect(u1.balance).toBeCloseTo(2000, 6);
    expect(u1.equity).toBeCloseTo(2003.5, 6);
    expect(u1.online).toBe(true);
    expect(u1.engineActive).toBe(true);
    expect(res.users[1].online).toBe(false);
  });
  test('stored fee is summed as real (not estimated) when present', () => {
    const withFee = [{ userId: 9, env: 'TESTNET', closePnl: 10, closeReason: 'DSL_PL', ts: now - 600000, closeTs: now - 300000, qty: 1, price: 100, lev: 10, fee: 0.5 }];
    const r = lb.computeLeaderboard(withFee, [], {}, [{ id: 9, email: 'c@x.io', role: 'user', lastActiveAt: 0, engineActive: false }], { env: 'TESTNET', window: 'all', now });
    expect(r.users[0].commissions).toBeCloseTo(0.5, 6);
    expect(r.users[0].commissionsEst).toBeCloseTo(0, 6);
    expect(r.users[0].feeEstimated).toBe(false);
  });
  test('window filter uses closeTs not the mixed-unit column', () => {
    const r7 = lb.computeLeaderboard(closed, opens, balances, users, { env: 'TESTNET', window: '7d', now });
    expect(r7.users[0].trades).toBe(2); // both within 7d
    const rToday = lb.computeLeaderboard(
      [{ userId: 1, env: 'TESTNET', closePnl: 1, closeReason: 'DSL_PL', ts: now - 200000000, closeTs: now - 200000000, qty: 1, price: 100, lev: 10 }],
      [], {}, users, { env: 'TESTNET', window: 'today', now });
    expect(rToday.users[0].trades).toBe(0); // older than 24h, excluded
  });
  test('zero-activity users still listed, sorted last', () => {
    const r = lb.computeLeaderboard([], [], {}, users, { env: 'REAL', window: 'all', now });
    expect(r.users.length).toBe(2);
    expect(r.users.every(u => u.trades === 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /opt/zeus-terminal && sudo -u zeus npx jest tests/unit/leaderboard.test.js -t computeLeaderboard --forceExit --runInBand 2>&1 | tail -15`
Expected: FAIL — `lb.computeLeaderboard is not a function`.

- [ ] **Step 3: Implement** (add to `leaderboard.js`, export it)

```js
function _drawdownAndStreak(pnls) {
  // pnls in close-time order. maxDrawdown on cumulative; streak = signed run from the end.
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

function computeLeaderboard(closedRows, openPositions, balances, users, opts) {
  const o = opts || {};
  const env = o.env || 'TESTNET';
  const window = o.window || 'all';
  const now = Number.isFinite(o.now) ? o.now : Date.now();
  const onlineMs = Number.isFinite(o.onlineMs) ? o.onlineMs : 300000;
  const cutoff = _windowStart(window, now);

  // index counted, env- and window-matched closed rows by user (ordered by closeTs)
  const byUser = new Map();
  const ensure = (uid) => { if (!byUser.has(uid)) byUser.set(uid, []); return byUser.get(uid); };
  const counted = (closedRows || []).filter(r => r && r.env === env && _isCountedTrade(r));
  for (const r of counted) {
    const ct = _normalizeTs(r.closeTs) || _normalizeTs(r.ts);
    if (ct == null || ct < cutoff) continue;
    ensure(r.userId).push({ ...r, _closeMs: ct, _openMs: _normalizeTs(r.ts) });
  }

  // live aggregates per user (env-matched)
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

    // fees: sum real stored fee; estimate the rest from notional
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

// downsampled cumulative-PnL series for an inline sparkline (<=40 points)
function _spark(pnls) {
  if (!pnls.length) return [];
  const cum = []; let c = 0;
  for (const p of pnls) { c += p; cum.push(+c.toFixed(4)); }
  const step = Math.max(1, Math.ceil(cum.length / 40));
  return cum.filter((_, i) => i % step === 0);
}
```

Add `computeLeaderboard` (and keep helpers) to `module.exports`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd /opt/zeus-terminal && sudo -u zeus npx jest tests/unit/leaderboard.test.js --forceExit --runInBand 2>&1 | tail -12`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
cd /opt/zeus-terminal && git add server/services/leaderboard.js tests/unit/leaderboard.test.js
git commit -m "feat(admin-leaderboard): computeLeaderboard pure core — full metric set (TDD)"
```

---

## Task 4: `gatherLeaderboardData` adapter + admin endpoint

**Files:**
- Modify: `server/services/leaderboard.js` (add impure adapter)
- Modify: `server/routes/admin.js` (add route)
- Test: `tests/unit/leaderboard-endpoint.test.js` (smoke via supertest-free direct call)

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/leaderboard-endpoint.test.js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /opt/zeus-terminal && sudo -u zeus npx jest tests/unit/leaderboard-endpoint.test.js --forceExit --runInBand 2>&1 | tail -10`
Expected: FAIL — `lb.gatherLeaderboardData is not a function`.

- [ ] **Step 3: Implement the adapter** (add to `leaderboard.js`)

```js
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

// Live data sources (kept tiny + isolated; not unit-tested — covered by the adapter test via injection).
function _liveDeps() {
  const db = require('./database').db;
  const serverAT = require('./serverAT');
  return {
    getClosedRows(env, cutoff) {
      // Pull only recent rows when windowed; 'all' (cutoff 0) reads the table.
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
          out.push({ userId: uid, env: p.env, unrealizedPnl: Number(p.unrealizedPnL || p.unrealizedPnl) || 0, notional, lev: p.lev });
        }
      }
      return out;
    },
    async getBalances(openPositions, env) {
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
```

Add `gatherLeaderboardData` to `module.exports`.

> Note: if `serverAT.isEngineActive` does not exist, `engineActive` defaults to `false` (the `typeof` guard handles it). A follow-up can wire a real engine-active probe; the leaderboard does not block on it.

- [ ] **Step 4: Run adapter test to verify it passes**

Run: `cd /opt/zeus-terminal && sudo -u zeus npx jest tests/unit/leaderboard-endpoint.test.js --forceExit --runInBand 2>&1 | tail -8`
Expected: PASS.

- [ ] **Step 5: Add the admin route** — in `server/routes/admin.js`, insert before `module.exports = router;`:

```js
// GET /api/admin/leaderboard?env=REAL|TESTNET|DEMO&window=today|7d|30d|all
// Read-only aggregated ranking of all users. ~10s server cache per (env,window).
router.get('/leaderboard', _requireAuth, _requireAdmin, async (req, res) => {
    const env = ['REAL', 'TESTNET', 'DEMO'].includes(String(req.query.env)) ? String(req.query.env) : 'TESTNET';
    const window = ['today', '7d', '30d', 'all'].includes(String(req.query.window)) ? String(req.query.window) : 'all';
    try {
        const data = await require('../services/leaderboard').gatherLeaderboardData({ env, window });
        return res.json(data);
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
});
```

- [ ] **Step 6: Verify route loads (syntax + mount)**

Run: `cd /opt/zeus-terminal && sudo -u zeus node --check server/routes/admin.js && sudo -u zeus node --check server/services/leaderboard.js && echo OK`
Expected: `OK`.

- [ ] **Step 7: Commit**

```bash
cd /opt/zeus-terminal && git add server/services/leaderboard.js server/routes/admin.js tests/unit/leaderboard-endpoint.test.js
git commit -m "feat(admin-leaderboard): gatherLeaderboardData adapter + GET /api/admin/leaderboard (TDD)"
```

---

## Task 5: Client — Leaderboard tab in the admin Users section

**Files:**
- Create: `client/src/components/admin/sections/LeaderboardTab.tsx`
- Modify: `client/src/components/admin/sections/UsersSection.tsx` (add tab switch)

- [ ] **Step 1: Create the tab component**

```tsx
// client/src/components/admin/sections/LeaderboardTab.tsx
import { useEffect, useState } from 'react'
import { api } from '../../../services/api'
import { useAdminStore } from '../../../stores/adminStore'

type Row = {
  userId: number; email: string; role: string
  netPnl: number; grossProfit: number; grossLoss: number; profitFactor: number
  trades: number; winRate: number; avgTimeInTradeMin: number
  commissions: number; commissionsEst: number; feeEstimated: boolean; netAfterFees: number
  unrealizedPnl: number; openCount: number; equity: number; maxDrawdown: number; currentStreak: number
  online: boolean; engineActive: boolean; pnlSpark: number[]
}
type Board = { ok: boolean; env: string; window: string; users: Row[]; totals: { netPnl: number; online: number; users: number } }

const ENVS = ['TESTNET', 'REAL', 'DEMO'] as const
const WINDOWS = [['today', 'Today'], ['7d', '7d'], ['30d', '30d'], ['all', 'All']] as const
const money = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(2)
const col = (x: number) => (x >= 0 ? '#26ff9a' : '#ff5277')

export function LeaderboardTab() {
  const [env, setEnv] = useState<typeof ENVS[number]>('TESTNET')
  const [window, setWindow] = useState<string>('all')
  const [board, setBoard] = useState<Board | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<keyof Row>('netPnl')
  const setSelectedUser = useAdminStore((s) => s.setSelectedUser)

  useEffect(() => {
    let alive = true
    const poll = async () => {
      try { const j = await api.raw<Board>('GET', `/api/admin/leaderboard?env=${env}&window=${window}`); if (alive && j) { setBoard(j); setErr(null) } }
      catch (e) { if (alive) setErr(e instanceof Error ? e.message : String(e)) }
    }
    poll(); const t = setInterval(poll, 10000)
    return () => { alive = false; clearInterval(t) }
  }, [env, window])

  const rows = board ? [...board.users].sort((a, b) => (Number(b[sortKey]) || 0) - (Number(a[sortKey]) || 0)) : []

  return (
    <div className="lb-panel">
      <div className="lb-controls">
        <div className="lb-seg">{ENVS.map((e) => <button key={e} className={env === e ? 'on' : ''} onClick={() => setEnv(e)}>{e}</button>)}</div>
        <div className="lb-seg">{WINDOWS.map(([w, lbl]) => <button key={w} className={window === w ? 'on' : ''} onClick={() => setWindow(w)}>{lbl}</button>)}</div>
        {board && <span className="lb-meta">{board.totals.online} online · {board.totals.users} users · net {money(board.totals.netPnl)}</span>}
      </div>
      {err && <div className="lb-empty">offline — {err}</div>}
      {env === 'REAL' && board && board.users.every((u) => u.trades === 0) && <div className="lb-empty">No REAL trades yet — REAL trading not enabled</div>}
      <table className="lb-table">
        <thead><tr>
          <th>#</th><th>User</th>
          {([['netPnl', 'Net'], ['grossProfit', 'Profit'], ['grossLoss', 'Loss'], ['winRate', 'WR'], ['profitFactor', 'PF'], ['trades', 'Trades'], ['avgTimeInTradeMin', 'Avg min'], ['commissionsEst', 'Fees'], ['equity', 'Equity'], ['unrealizedPnl', 'uPnL'], ['openCount', 'Open'], ['maxDrawdown', 'MaxDD'], ['currentStreak', 'Streak']] as [keyof Row, string][]).map(([k, lbl]) => (
            <th key={k} className="lb-sortable" onClick={() => setSortKey(k)}>{lbl}{sortKey === k ? ' ▾' : ''}</th>
          ))}
        </tr></thead>
        <tbody>
          {rows.map((u, i) => (
            <tr key={u.userId} className="lb-row" onClick={() => setSelectedUser(u.userId)}>
              <td>{i + 1}</td>
              <td><span className={u.online ? 'lb-dot on' : 'lb-dot'} />{u.email}{u.engineActive ? ' ⚙️' : ''}</td>
              <td style={{ color: col(u.netPnl) }}>{money(u.netPnl)}</td>
              <td style={{ color: '#26ff9a' }}>{u.grossProfit.toFixed(2)}</td>
              <td style={{ color: '#ff5277' }}>-{u.grossLoss.toFixed(2)}</td>
              <td>{Math.round(u.winRate * 100)}%</td>
              <td>{u.profitFactor === Infinity ? '∞' : u.profitFactor.toFixed(2)}</td>
              <td>{u.trades}</td>
              <td>{u.avgTimeInTradeMin.toFixed(1)}</td>
              <td>{u.feeEstimated ? '≈' : ''}{(u.commissions + u.commissionsEst).toFixed(2)}</td>
              <td>{u.equity.toFixed(2)}</td>
              <td style={{ color: col(u.unrealizedPnl) }}>{money(u.unrealizedPnl)}</td>
              <td>{u.openCount}</td>
              <td style={{ color: '#ff5277' }}>{u.maxDrawdown.toFixed(2)}</td>
              <td style={{ color: col(u.currentStreak) }}>{u.currentStreak > 0 ? `+${u.currentStreak}W` : u.currentStreak < 0 ? `${-u.currentStreak}L` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 2: Add the tab switch in `UsersSection.tsx`**

At the top of the `UsersSection` component body, add state:
```tsx
  const [tab, setTab] = useState<'users' | 'leaderboard'>('users')
```
Import the tab + LeaderboardTab at the top of the file:
```tsx
import { LeaderboardTab } from './LeaderboardTab'
```
Immediately inside the section's outer wrapper (before the existing users UI), add the switch and short-circuit:
```tsx
      <div className="lb-tabs">
        <button className={tab === 'users' ? 'on' : ''} onClick={() => setTab('users')}>Users</button>
        <button className={tab === 'leaderboard' ? 'on' : ''} onClick={() => setTab('leaderboard')}>🏆 Leaderboard</button>
      </div>
      {tab === 'leaderboard' && <LeaderboardTab />}
      {tab === 'users' && (
        <>
          {/* existing UsersSection body */}
        </>
      )}
```
(Wrap the existing returned users markup in the `{tab === 'users' && (<> ... </>)}` block. Keep all existing logic intact.)

- [ ] **Step 3: Add minimal CSS** — append to `client/src/app.css`:

```css
.lb-tabs { display:flex; gap:8px; margin-bottom:10px; }
.lb-tabs button, .lb-seg button { background:rgba(10,15,22,.6); border:1px solid #1a2530; color:#7a9ab8; border-radius:6px; padding:4px 10px; cursor:pointer; font-size:11px; }
.lb-tabs button.on, .lb-seg button.on { color:#fff; border-color:#3a5a78; background:#16222e; }
.lb-controls { display:flex; gap:14px; align-items:center; flex-wrap:wrap; margin-bottom:10px; }
.lb-seg { display:flex; gap:4px; }
.lb-meta { font-size:11px; color:#7a9ab8; }
.lb-table { width:100%; border-collapse:collapse; font-size:11px; }
.lb-table th, .lb-table td { padding:5px 8px; text-align:right; border-bottom:1px solid #11202b; white-space:nowrap; }
.lb-table th:nth-child(2), .lb-table td:nth-child(2) { text-align:left; }
.lb-sortable { cursor:pointer; color:#7a9ab8; }
.lb-row { cursor:pointer; }
.lb-row:hover { background:rgba(26,37,48,.5); }
.lb-dot { display:inline-block; width:7px; height:7px; border-radius:50%; background:#445; margin-right:6px; }
.lb-dot.on { background:#26ff9a; }
.lb-empty { color:#5a6a7a; font-size:12px; padding:10px; }
```

- [ ] **Step 4: Build the client**

Run: `cd /opt/zeus-terminal/client && npm run build 2>&1 | tail -6`
Expected: `✓ built` with no TS errors referencing LeaderboardTab/UsersSection.

- [ ] **Step 5: Commit**

```bash
cd /opt/zeus-terminal && git add client/src/components/admin/sections/LeaderboardTab.tsx client/src/components/admin/sections/UsersSection.tsx client/src/app.css client/dist
git commit -m "feat(admin-leaderboard): Leaderboard tab UI (env/window toggle, sortable, drawer drill-in)"
```

---

## Task 6: Deploy + live verification (shadow, read-only)

**Files:** none (deploy)

- [ ] **Step 1: Bump version** — `server/version.js`: build → next (e.g. 163), version patch bump, add a one-line changelog entry describing the admin leaderboard. Then validate:

Run: `cd /opt/zeus-terminal && sudo -u zeus node -e "const v=require('./server/version.js'); if(typeof v.version!=='string'||typeof v.build!=='number'||typeof v.changelog!=='string') throw new Error('bad'); console.log('OK', v.version, v.build)"`
Expected: `OK <version> <build>`.

- [ ] **Step 2: Reload**

Run: `cd /opt/zeus-terminal && sudo -u zeus bash -lc 'pm2 reload zeus --update-env' && sleep 4 && curl -s -o /dev/null -w "health=%{http_code}\n" http://localhost:3000/api/health`
Expected: `health=401` (server up, auth-gated) and no boot errors in `data/logs/pm2-err.log`.

- [ ] **Step 3: Verify the endpoint computes (admin-auth via an existing admin session token, or confirm shape against the live DB)**

Run a read-only DB-backed sanity that mirrors the adapter:
```bash
cd /opt/zeus-terminal && sudo -u zeus node -e "
const lb=require('./server/services/leaderboard');
lb.gatherLeaderboardData({env:'TESTNET',window:'all'}).then(r=>{
  console.log('users:', r.users.length, '| top:', r.users.slice(0,3).map(u=>u.email+' net='+u.netPnl.toFixed(2)+' trades='+u.trades+' fees'+(u.feeEstimated?'≈':'')+'='+(u.commissions+u.commissionsEst).toFixed(2)+' avgMin='+u.avgTimeInTradeMin.toFixed(1)));
}).catch(e=>console.log('ERR',e.message));
"
```
Expected: a ranked list with real testnet numbers (net PnL, trades, fees, avg time-in-trade) — confirming the whole chain end-to-end.

- [ ] **Step 4: Commit + push**

```bash
cd /opt/zeus-terminal && git add server/version.js && git commit -m "chore: bump version — admin leaderboard (bXXX)" && git push
```

---

## Task 7 (isolated money-path): persist REAL commission at close

**Goal:** Store the real summed fill commission as an additive `fee` field on the `at_closed` blob so the leaderboard sums real fees going forward (historical/demo stay `≈` estimates). Additive, fail-safe, never blocks a close.

**Files:**
- Modify: `server/services/serverAT.js` — at the live-close persistence point (`_persistClose` / the live-exit path that already has fill data), set `pos.fee` from the exchange fill commission before archive.

- [ ] **Step 1: Locate the live-close fill point** — read `server/services/serverAT.js` around `_persistClose` (≈ line 517) and `_handleLiveExit` (≈ line 2177). Identify where, for a `mode==='live'` close, the realized fill is known (or where `exchangeOps`/`binanceOps.getUserTrades` is already consulted). The commission source is `binanceOps` fill `commission` (mapped as `fee` at `binanceOps.js:706`).

- [ ] **Step 2: Write the failing test** — `tests/unit/serverAT-fee-capture.test.js`:

```js
'use strict';
// Pure helper test: _sumFillCommission([...fills]) -> total abs commission.
const serverAT = require('../../server/services/serverAT');
test('_sumFillCommission sums absolute commission across fills', () => {
  expect(serverAT._sumFillCommission([{ fee: 0.2 }, { fee: 0.3 }, { fee: '0.1' }])).toBeCloseTo(0.6, 6);
  expect(serverAT._sumFillCommission([])).toBe(0);
  expect(serverAT._sumFillCommission(null)).toBe(0);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd /opt/zeus-terminal && sudo -u zeus npx jest tests/unit/serverAT-fee-capture.test.js --forceExit --runInBand 2>&1 | tail -8`
Expected: FAIL — `_sumFillCommission is not a function`.

- [ ] **Step 4: Implement** — add the pure helper to `serverAT.js` and export it:

```js
function _sumFillCommission(fills) {
  if (!Array.isArray(fills)) return 0;
  return fills.reduce((s, f) => s + Math.abs(Number(f && f.fee) || 0), 0);
}
```
Then, at the live-close point (where a position with `mode==='live'` is finalized and fill data is available), set `pos.fee = _sumFillCommission(fills)` BEFORE `_persistClose`/archive, inside a `try/catch` so any error is swallowed and never blocks the close. (Exact insertion line determined in Step 1; the field is additive — no schema change since `at_closed.data` is free-form JSON.)

- [ ] **Step 5: Run to verify it passes + targeted serverAT regression**

Run: `cd /opt/zeus-terminal && sudo -u zeus npx jest tests/unit/serverAT-fee-capture.test.js --forceExit --runInBand 2>&1 | tail -8`
Expected: PASS. Then run any existing serverAT close-path test file if present.

- [ ] **Step 6: Commit**

```bash
cd /opt/zeus-terminal && git add server/services/serverAT.js tests/unit/serverAT-fee-capture.test.js
git commit -m "feat(admin-leaderboard): capture real fill commission as at_closed.fee at live close (additive, fail-safe)"
```

> After Task 7 deploys, new live closes carry a real `fee`; the leaderboard's `commissions` (real) grows and `commissionsEst` (≈) applies only to historical/demo. Verify by re-running the Task 6 Step 3 sanity after a few live closes — at least one user should show a non-`≈` fee.

---

## Self-Review (completed)

- **Spec coverage:** placement/tab (T5) ✓; env toggle + window (T3 logic, T4 endpoint, T5 UI) ✓; full metric set incl. avgTimeInTrade (T3) ✓ and commissions real+est (T3 + T7) ✓; online/engine (T3) ✓; closed_at mixed-units gotcha (T1 `_normalizeTs` + T3 closeTs windowing test) ✓; noise exclusion (T2) ✓; drawdown/streak/profitFactor/spark (T3) ✓; cache (T4) ✓; drawer drill-in (T5) ✓; honest REAL-empty state (T5) ✓; deploy+verify (T6) ✓.
- **Placeholders:** none — every code step has complete code; the only deferred specifics (Task 7 exact insertion line) are explicitly resolved by reading named functions at given line anchors.
- **Type consistency:** `computeLeaderboard` row fields used in T5 (`netPnl, grossProfit, grossLoss, profitFactor, trades, winRate, avgTimeInTradeMin, commissions, commissionsEst, feeEstimated, equity, unrealizedPnl, openCount, maxDrawdown, currentStreak, online, engineActive, pnlSpark, email, userId`) all match the T3 return object. `gatherLeaderboardData` shape (`{ok, env, window, generatedAt, users, totals}`) matches the T4 endpoint + T5 `Board` type.
