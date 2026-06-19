# DSL R:R / Loss-Side Exit — Offline Proof Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Prove on REAL historical trades whether a loss-side early-exit (cap the left tail) improves expectancy/R:R, and find the optimal cut threshold — BEFORE touching any live or shadow execution.

**Architecture:** Two pure, unit-tested helpers (`_cappedPnl` = a trade's PnL if it had been cut at X% adverse excursion; `_rrStats` = WR/avgWin/avgLoss/R:R/expectancy of a PnL set) + an offline read-only backtest script that sweeps cut thresholds over the existing closed trades and reports the R:R/expectancy curve. Read-only DB; zero money-path; zero execution change.

**Tech Stack:** Node CommonJS, better-sqlite3 (readonly), vitest-style is N/A (server-side) → jest for the pure helpers, run as `sudo -u zeus`.

**Rules:** TDD for the pure helpers; run server tests `sudo -u zeus npx jest <path> --forceExit --runInBand` (NEVER full suite on live VPS, NEVER as root); the backtest script opens the DB **readonly**; no commits to live data. This whole plan is offline analysis — no flags, no deploy, no money-path.

---

## Files
- **Create:** `server/services/dslRrSim.js` — pure helpers `_cappedPnl(trade, cutPct)` + `_rrStats(pnls)`. Exported for tests + the script.
- **Create:** `tests/unit/server/services/dslRrSim.test.js` — TDD for both helpers (jest, under tests/unit per jest.config).
- **Create:** `scripts/dsl-rr-backtest.js` — read-only offline sweep over `at_closed`, prints the R:R/expectancy curve by cut threshold + by side.

---

## Task 1: `_cappedPnl` — a trade's PnL if cut at X% adverse (TDD)

The physical model: a position's notional = `margin × lev`. A `cutPct` adverse price move loses `cutPct × notional`. A cut fires the moment price first reaches `cutPct` adverse — so if the trade's worst adverse excursion (`minAdverse`) reached `cutPct`, the trade exits there for a capped loss; otherwise it keeps its actual `closePnl`. For a LONG, `minAdverse = (entry − minPrice)/entry`; for a SHORT, `(maxPrice − entry)/entry`.

**Files:** Create `server/services/dslRrSim.js`; Test `tests/unit/server/services/dslRrSim.test.js`

- [ ] **Step 1: Write the failing test** — create `tests/unit/server/services/dslRrSim.test.js`:

```js
const { _cappedPnl } = require('../../../../server/services/dslRrSim');

// notional = margin*lev = 100*10 = 1000. A 1% adverse cut loses 1% * 1000 = 10.
const longTrade = { side: 'LONG', entry: 100, minPrice: 97, maxPrice: 105, closePnl: 40, margin: 100, lev: 10 };
const longLoser = { side: 'LONG', entry: 100, minPrice: 95, maxPrice: 101, closePnl: -46, margin: 100, lev: 10 };
const shortTrade = { side: 'SHORT', entry: 100, minPrice: 96, maxPrice: 102, closePnl: 30, margin: 100, lev: 10 };

describe('_cappedPnl', () => {
  it('caps a loser that breached the cut at -cutPct*notional', () => {
    // loser reached 5% adverse (min 95); cut at 2% → exits at -2%*1000 = -20 (better than -46)
    expect(_cappedPnl(longLoser, 0.02)).toBe(-20);
  });
  it('cuts a WINNER that dipped past the cut (give-back) into a capped loss', () => {
    // winner dipped to 3% adverse (min 97) before winning; cut at 2% → it would have been stopped at -20
    expect(_cappedPnl(longTrade, 0.02)).toBe(-20);
  });
  it('leaves a trade UNCHANGED if it never reached the cut level', () => {
    // winner min 97 = 3% adverse; cut at 5% never hit → keep actual +40
    expect(_cappedPnl(longTrade, 0.05)).toBe(40);
    // loser min 95 = 5% adverse; cut at 8% never hit → keep actual -46
    expect(_cappedPnl(longLoser, 0.08)).toBe(-46);
  });
  it('handles SHORT adverse excursion (maxPrice side)', () => {
    // short reached 2% adverse (max 102); cut at 2% → -2%*1000 = -20
    expect(_cappedPnl(shortTrade, 0.02)).toBe(-20);
    // cut at 3% never hit → keep +30
    expect(_cappedPnl(shortTrade, 0.03)).toBe(30);
  });
  it('returns null when required fields are missing (skip in aggregation)', () => {
    expect(_cappedPnl({ side: 'LONG', entry: 100, closePnl: -10 }, 0.02)).toBeNull(); // no minPrice/margin/lev
  });
});
```

- [ ] **Step 2: Run to verify fail**

```
cd /opt/zeus-terminal && sudo -u zeus npx jest tests/unit/server/services/dslRrSim.test.js --forceExit --runInBand 2>&1 | tail -15
```
Expected: FAIL — `_cappedPnl is not a function`.

- [ ] **Step 3: Implement** — create `server/services/dslRrSim.js`:

```js
// DSL R:R offline sim helpers — pure, no I/O. Used by the offline backtest + (later) shadow.

// PnL of a trade if it had been cut the moment price reached `cutPct` adverse excursion.
// Cut fires iff the trade's worst adverse excursion reached cutPct → capped loss = -cutPct*notional.
// Otherwise the trade keeps its actual closePnl. Returns null if inputs are insufficient.
function _cappedPnl(t, cutPct) {
  if (!t || typeof cutPct !== 'number' || cutPct <= 0) return null;
  const entry = +t.entry, margin = +t.margin, lev = +t.lev, closePnl = +t.closePnl;
  if (!isFinite(entry) || entry <= 0 || !isFinite(margin) || !isFinite(lev) || !isFinite(closePnl)) return null;
  const side = String(t.side || '').toUpperCase();
  let minAdverse;
  if (side === 'LONG') {
    const minP = +t.minPrice; if (!isFinite(minP)) return null;
    minAdverse = (entry - minP) / entry;
  } else if (side === 'SHORT') {
    const maxP = +t.maxPrice; if (!isFinite(maxP)) return null;
    minAdverse = (maxP - entry) / entry;
  } else return null;
  if (minAdverse >= cutPct) return -(cutPct * margin * lev);
  return closePnl;
}

module.exports = { _cappedPnl };
```

- [ ] **Step 4: Run to verify pass**

```
cd /opt/zeus-terminal && sudo -u zeus npx jest tests/unit/server/services/dslRrSim.test.js --forceExit --runInBand 2>&1 | tail -8
```
Expected: PASS (5 cases).

- [ ] **Step 5: Commit**

```
git add server/services/dslRrSim.js tests/unit/server/services/dslRrSim.test.js
git commit -m "feat(dsl): _cappedPnl pure helper (loss-side cut sim) with tests"
```

---

## Task 2: `_rrStats` — WR / R:R / expectancy of a PnL set (TDD)

**Files:** Modify `server/services/dslRrSim.js`; Modify `tests/unit/server/services/dslRrSim.test.js`

- [ ] **Step 1: Write the failing test** — append:

```js
const { _rrStats } = require('../../../../server/services/dslRrSim');

describe('_rrStats', () => {
  it('computes WR, avgWin, avgLoss, RR, expectancy', () => {
    const s = _rrStats([10, 20, -30, -10]); // 2 wins (avg 15), 2 losses (avg -20)
    expect(s.n).toBe(4);
    expect(s.wr).toBeCloseTo(0.5, 5);
    expect(s.avgWin).toBeCloseTo(15, 5);
    expect(s.avgLoss).toBeCloseTo(-20, 5);
    expect(s.rr).toBeCloseTo(0.75, 5);          // 15 / 20
    expect(s.expectancy).toBeCloseTo(-2.5, 5);  // (10+20-30-10)/4
  });
  it('handles empty / all-win / all-loss safely', () => {
    expect(_rrStats([]).n).toBe(0);
    expect(_rrStats([5, 5]).avgLoss).toBe(0);
    expect(_rrStats([-5]).avgWin).toBe(0);
    expect(_rrStats([-5]).rr).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify fail**

```
cd /opt/zeus-terminal && sudo -u zeus npx jest tests/unit/server/services/dslRrSim.test.js --forceExit --runInBand 2>&1 | tail -10
```
Expected: FAIL — `_rrStats is not a function`.

- [ ] **Step 3: Implement** — add to `server/services/dslRrSim.js` (and export):

```js
// WR / avgWin / avgLoss / R:R / expectancy of a list of PnL numbers (treats 0 as a loss).
function _rrStats(pnls) {
  const arr = (pnls || []).filter(p => typeof p === 'number' && isFinite(p));
  const n = arr.length;
  if (!n) return { n: 0, wr: 0, avgWin: 0, avgLoss: 0, rr: 0, expectancy: 0 };
  const wins = arr.filter(p => p > 0), losses = arr.filter(p => p <= 0);
  const avgWin = wins.length ? wins.reduce((s, p) => s + p, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((s, p) => s + p, 0) / losses.length : 0;
  const rr = avgLoss !== 0 ? avgWin / Math.abs(avgLoss) : 0;
  const expectancy = arr.reduce((s, p) => s + p, 0) / n;
  return { n, wr: wins.length / n, avgWin, avgLoss, rr, expectancy };
}

module.exports = { _cappedPnl, _rrStats };
```

- [ ] **Step 4: Run to verify pass**

```
cd /opt/zeus-terminal && sudo -u zeus npx jest tests/unit/server/services/dslRrSim.test.js --forceExit --runInBand 2>&1 | tail -8
```
Expected: PASS (all).

- [ ] **Step 5: Commit**

```
git add server/services/dslRrSim.js tests/unit/server/services/dslRrSim.test.js
git commit -m "feat(dsl): _rrStats pure helper (WR/RR/expectancy) with tests"
```

---

## Task 3: Offline backtest — sweep cut thresholds over real trades (read-only proof)

**Files:** Create `scripts/dsl-rr-backtest.js`

- [ ] **Step 1: Write the script** — create `scripts/dsl-rr-backtest.js`:

```js
// Read-only offline proof: for a sweep of loss-side cut thresholds, recompute R:R/expectancy
// over the real engine-testnet closed trades, vs the baseline (no cut). Quantifies the
// avgLoss reduction vs winner give-back, per side, and finds the expectancy-optimal cut.
const Database = require('better-sqlite3');
const path = require('path');
const { _cappedPnl, _rrStats } = require('../server/services/dslRrSim');

const db = new Database(path.join(__dirname, '..', 'data', 'zeus.db'), { readonly: true });

// Build the trade list from at_closed (engine testnet, with the fields the sim needs).
const trades = [];
for (const r of db.prepare('SELECT data FROM at_closed').all()) {
  let d; try { d = JSON.parse(r.data); } catch (_) { continue; }
  if (String(d.env || '').toUpperCase() !== 'TESTNET') continue;
  if (d.mode !== 'live' && !d.autoTrade) continue;
  if (!isFinite(+d.closePnl)) continue;
  trades.push({
    side: String(d.side || '').toUpperCase(),
    entry: +d.entry, minPrice: +d._minPrice, maxPrice: +d._maxPrice,
    closePnl: +d.closePnl, margin: +d.margin, lev: +d.lev,
  });
}

function sweep(list, label) {
  const base = _rrStats(list.map(t => t.closePnl));
  console.log(`\n=== ${label} (n=${list.length}) ===`);
  console.log(`  BASELINE  WR=${(base.wr*100).toFixed(0)}% RR=${base.rr.toFixed(2)} exp=${base.expectancy.toFixed(1)} avgWin=${base.avgWin.toFixed(1)} avgLoss=${base.avgLoss.toFixed(1)}`);
  let best = { cut: null, exp: base.expectancy };
  for (const cut of [0.005, 0.0075, 0.01, 0.0125, 0.015, 0.0175, 0.02, 0.025, 0.03]) {
    const pnls = list.map(t => { const c = _cappedPnl(t, cut); return c == null ? t.closePnl : c; });
    const s = _rrStats(pnls);
    if (s.expectancy > best.exp) best = { cut, exp: s.expectancy };
    console.log(`  cut=${(cut*100).toFixed(2)}%  WR=${(s.wr*100).toFixed(0)}% RR=${s.rr.toFixed(2)} exp=${s.expectancy.toFixed(1)} avgWin=${s.avgWin.toFixed(1)} avgLoss=${s.avgLoss.toFixed(1)}`);
  }
  console.log(`  → BEST cut for expectancy: ${best.cut == null ? 'none (baseline best)' : (best.cut*100).toFixed(2)+'%'} (exp ${best.exp.toFixed(1)})`);
}

const usable = trades.filter(t => _cappedPnl(t, 0.02) !== null);
console.log(`Total engine-testnet closed=${trades.length}  usable (have entry/min/max/margin/lev)=${usable.length}`);
sweep(usable, 'ALL');
sweep(usable.filter(t => t.side === 'LONG'), 'LONG');
sweep(usable.filter(t => t.side === 'SHORT'), 'SHORT');
```

- [ ] **Step 2: Run the offline proof**

```
cd /opt/zeus-terminal && sudo -u zeus /usr/local/bin/node scripts/dsl-rr-backtest.js 2>&1 | head -50
```
Expected: a table per side showing, for each cut threshold, WR/RR/expectancy/avgWin/avgLoss, plus the expectancy-optimal cut. **Read the result:** does any cut threshold raise LONG expectancy above the baseline (−16.1)? By how much, and what is the winner give-back (WR drop)? This is the go/no-go evidence for the loss-side approach.

- [ ] **Step 3: Commit the harness**

```
git add scripts/dsl-rr-backtest.js
git commit -m "feat(dsl): offline R:R backtest harness — loss-side cut sweep over real trades"
```

- [ ] **Step 4: Interpret + decide (no code)**

Summarize for the operator: the optimal cut, the expectancy/R:R improvement, the winner give-back, and whether LONG can be brought toward breakeven. If positive → proceed to the SHADOW integration plan (separate). If the proof shows a uniform cut hurts winners too much → the next step is the *context-aware* smart cut (`_shouldEarlyExit`), since a blind cut isn't enough.

---

## Rollback
Entirely offline/read-only — nothing to roll back. The two helpers are new isolated files; the script is read-only.

## Self-review
- **Spec coverage:** the spec's "offline backtest harness — confirm it reduces avgLoss / raises R:R, quantify winner give-back" → Tasks 1-3 ✓. `_rrStats` matches the spec's R:R/expectancy math ✓. `_cappedPnl` = the loss-side cut sim ✓. The live SHADOW integration (spec §components 1,2 live path) is deliberately a SEPARATE follow-up plan, gated on Task 3's result (the spec's promotion-gate discipline) — noted in Task 3 Step 4.
- **Type consistency:** `_cappedPnl(trade, cutPct)` and `_rrStats(pnls)` signatures + return shapes ({n,wr,avgWin,avgLoss,rr,expectancy}) consistent across tasks + script.
- **Placeholder scan:** every step has concrete code/commands. The trade-field names (side/entry/_minPrice/_maxPrice/closePnl/margin/lev) come from the verified at_closed.data JSON; the script skips trades missing any (usable filter).
