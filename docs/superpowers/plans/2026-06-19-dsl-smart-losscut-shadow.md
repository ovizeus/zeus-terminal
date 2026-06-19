# DSL Drive — Smart Loss-Side Cut (Shadow) + Visual — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a smart context-aware loss-side early-exit running in SHADOW (cut a loser only when adverse AND not recovering — sparing dip-then-recover winners), record its counterfactual R:R, and surface it visually (numbers + cumulative-advantage sparkline) in the DSL Drive panel. Zero live execution change.

**Architecture:** Pure decision/replay helpers in `server/services/dslRrSim.js` (TDD), wired at trade-close into the existing ML-DSL shadow path (records a `cohort='lossside'` row in `ml_dsl_outcome`, no migration), exposed via the existing `/api/dsldrive/scoreboard` route, rendered as a card + inline SVG sparkline in `DslDrivePanel.tsx`. Flag-gated `ML_DSL_LOSSSIDE_SHADOW` (default OFF), fail-closed.

**Tech Stack:** Node CommonJS (jest, run `sudo -u zeus`), React/Zustand client (vitest), better-sqlite3.

**Rules:** TDD for pure logic; never full jest on live VPS; backup before server edits; build client `sudo -u zeus npm run build` + `chown -R zeus:zeus public/app`; validate version.js with `node -e require` BEFORE pm2 reload; GO before deploy. The flag defaults OFF → enabling shadow is an operator decision; live control is OUT OF SCOPE.

---

## Files
- **Modify:** `server/services/dslRrSim.js` — add `_recovering`, `_shouldEarlyExit`, `_smartCutPnlPct` (pure). Tests in existing `tests/unit/server/services/dslRrSim.test.js`.
- **Modify:** `server/migrationFlags.js` — add `ML_DSL_LOSSSIDE_SHADOW: false` + getter.
- **Modify:** `server/services/serverAT.js` — at close, beside the existing ML-DSL shadow block, compute the smart-cut counterfactual + write `ml_dsl_outcome` cohort='lossside' (flag-gated).
- **Modify:** the `/api/dsldrive/scoreboard` route — add a `lossSide` stats block + sparkline series.
- **Modify:** `client/src/components/dock/DslDrivePanel.tsx` (+ app.css) — Smart Loss-Cut card + sparkline.
- **Modify:** `server/version.js` (bump at deploy).

---

## Task 1: `_recovering` + `_shouldEarlyExit` pure primitives (TDD)

**Files:** Modify `server/services/dslRrSim.js`; Modify `tests/unit/server/services/dslRrSim.test.js`

- [ ] **Step 1: Write the failing test** — append to `tests/unit/server/services/dslRrSim.test.js`:

```js
const { _recovering, _shouldEarlyExit } = require('../../../../server/services/dslRrSim');

describe('_recovering', () => {
  it('LONG recovers when price bounces off the low beyond eps', () => {
    expect(_recovering(100.6, 100, 'LONG', 0.005)).toBe(true);  // 100.6 > 100*(1.005)=100.5
    expect(_recovering(100.4, 100, 'LONG', 0.005)).toBe(false); // 100.4 < 100.5
  });
  it('SHORT recovers when price drops off the high beyond eps', () => {
    expect(_recovering(99.4, 100, 'SHORT', 0.005)).toBe(true);  // 99.4 < 100*(0.995)=99.5
    expect(_recovering(99.6, 100, 'SHORT', 0.005)).toBe(false);
  });
});

describe('_shouldEarlyExit', () => {
  it('cuts when adverse past threshold AND not recovering', () => {
    expect(_shouldEarlyExit({ adversePct: 0.012, recovering: false, threshold: 0.01 })).toBe(true);
  });
  it('holds when adverse but recovering (spare the dip-then-recover winner)', () => {
    expect(_shouldEarlyExit({ adversePct: 0.012, recovering: true, threshold: 0.01 })).toBe(false);
  });
  it('holds when not yet adverse', () => {
    expect(_shouldEarlyExit({ adversePct: 0.005, recovering: false, threshold: 0.01 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify fail**

```
cd /opt/zeus-terminal && sudo -u zeus npx jest tests/unit/server/services/dslRrSim.test.js --forceExit --runInBand 2>&1 | tail -10
```
Expected: FAIL — `_recovering is not a function`.

- [ ] **Step 3: Implement** — add to `server/services/dslRrSim.js` (before `module.exports`, then extend exports):

```js
// Is the position improving from its worst adverse extreme by more than eps?
// LONG: price bounced up off the running low. SHORT: price dropped off the running high.
function _recovering(currentPrice, extremeSoFar, side, eps) {
  const c = +currentPrice, e = +extremeSoFar, ep = +eps || 0;
  if (!isFinite(c) || !isFinite(e) || e <= 0) return false;
  return String(side).toUpperCase() === 'LONG'
    ? c > e * (1 + ep)
    : c < e * (1 - ep);
}

// Cut iff adverse past the threshold AND not recovering.
function _shouldEarlyExit(o) {
  if (!o || typeof o.adversePct !== 'number' || typeof o.threshold !== 'number') return false;
  return o.adversePct >= o.threshold && o.recovering === false;
}
```
And update the exports line to include them:
```js
module.exports = { _cappedPnl, _rrStats, _recovering, _shouldEarlyExit };
```

- [ ] **Step 4: Run to verify pass**

```
cd /opt/zeus-terminal && sudo -u zeus npx jest tests/unit/server/services/dslRrSim.test.js --forceExit --runInBand 2>&1 | grep "Tests:"
```
Expected: PASS (all, +7 new).

- [ ] **Step 5: Commit**

```
git add server/services/dslRrSim.js tests/unit/server/services/dslRrSim.test.js
git commit -m "feat(dsl): _recovering + _shouldEarlyExit smart-cut primitives with tests"
```

---

## Task 2: `_smartCutPnlPct` — replay a price path through the smart cut (TDD)

Walk the recorded price path; track the adverse extreme; the first step where `_shouldEarlyExit` fires, the counterfactual exits there (PnL% = price move from entry); if it never fires, keep the baseline PnL%.

**Files:** Modify `server/services/dslRrSim.js`; Modify the test file.

- [ ] **Step 1: Write the failing test** — append:

```js
const { _smartCutPnlPct } = require('../../../../server/services/dslRrSim');
const cfg = { side: 'LONG', entry: 100, threshold: 0.01, recoverEps: 0.003, baselinePnlPct: 0 };

describe('_smartCutPnlPct', () => {
  it('cuts a loser that goes adverse and keeps falling (caps the loss near -threshold)', () => {
    // path falls straight through -1% and beyond, never recovering
    const pnl = _smartCutPnlPct([100, 99.5, 99.0, 98.5, 98.0], cfg);
    expect(pnl).toBeLessThanOrEqual(-0.0099);   // exited ~-1%
    expect(pnl).toBeGreaterThan(-0.016);        // not the full -2% drop
  });
  it('spares a dip-then-recover winner (returns the baseline, not a cut)', () => {
    // dips to -1.2% but bounces back and the trade ultimately won (+2% baseline)
    const pnl = _smartCutPnlPct([100, 98.8, 99.6, 101, 102], { ...cfg, baselinePnlPct: 0.02 });
    expect(pnl).toBe(0.02); // recovery detected before/at the adverse point → no cut → baseline kept
  });
  it('keeps baseline when never adverse past threshold', () => {
    expect(_smartCutPnlPct([100, 100.2, 100.5, 101], { ...cfg, baselinePnlPct: 0.01 })).toBe(0.01);
  });
});
```

- [ ] **Step 2: Run to verify fail**

```
cd /opt/zeus-terminal && sudo -u zeus npx jest tests/unit/server/services/dslRrSim.test.js --forceExit --runInBand 2>&1 | tail -10
```
Expected: FAIL — `_smartCutPnlPct is not a function`.

- [ ] **Step 3: Implement** — add to `server/services/dslRrSim.js` + export:

```js
// Replay a price path through the smart cut. Returns the counterfactual PnL fraction
// (price move from entry) if the cut fires; otherwise the supplied baselinePnlPct.
function _smartCutPnlPct(pricePath, cfg) {
  if (!Array.isArray(pricePath) || pricePath.length === 0 || !cfg) return cfg && cfg.baselinePnlPct || 0;
  const side = String(cfg.side).toUpperCase();
  const entry = +cfg.entry, threshold = +cfg.threshold, eps = +cfg.recoverEps || 0;
  const baseline = +cfg.baselinePnlPct || 0;
  if (!isFinite(entry) || entry <= 0 || !isFinite(threshold)) return baseline;
  let extreme = side === 'LONG' ? Infinity : -Infinity;
  for (const raw of pricePath) {
    const p = +raw; if (!isFinite(p)) continue;
    extreme = side === 'LONG' ? Math.min(extreme, p) : Math.max(extreme, p);
    const adversePct = side === 'LONG' ? (entry - p) / entry : (p - entry) / entry;
    const recovering = _recovering(p, extreme, side, eps);
    if (_shouldEarlyExit({ adversePct, recovering, threshold })) {
      return side === 'LONG' ? (p - entry) / entry : (entry - p) / entry; // exit here
    }
  }
  return baseline; // never cut → keep the real outcome
}
```
Update exports: `module.exports = { _cappedPnl, _rrStats, _recovering, _shouldEarlyExit, _smartCutPnlPct };`

- [ ] **Step 4: Run to verify pass**

```
cd /opt/zeus-terminal && sudo -u zeus npx jest tests/unit/server/services/dslRrSim.test.js --forceExit --runInBand 2>&1 | grep "Tests:"
```
Expected: PASS (all).

- [ ] **Step 5: Commit**

```
git add server/services/dslRrSim.js tests/unit/server/services/dslRrSim.test.js
git commit -m "feat(dsl): _smartCutPnlPct path-replay (smart loss-cut counterfactual) with tests"
```

---

## Task 3: Flag + shadow recording at trade-close

**Files:** Modify `server/migrationFlags.js`; Modify `server/services/serverAT.js`

- [ ] **Step 1: Add the flag** — in `server/migrationFlags.js`, after `ML_DSL_SHADOW_ENABLED` (grep for it), add to the defaults object `ML_DSL_LOSSSIDE_SHADOW: false,` (with a comment: shadow-only smart loss-side cut counterfactual; default OFF; live control out of scope) + a getter `get ML_DSL_LOSSSIDE_SHADOW() { return flags.ML_DSL_LOSSSIDE_SHADOW; },`. Verify: `node -e "console.log(require('./server/migrationFlags').getAll().ML_DSL_LOSSSIDE_SHADOW)"` → `false`.

- [ ] **Step 2: Locate the close-time ML-DSL shadow block** — in `server/services/serverAT.js`, find the `if (MF.ML_DSL_LEARN_ENABLED) { ... mlDslLearner.learn({...}) }` block at trade close (~line 2470-2481) and the recorded price trace (`priceTrace.record` ~3366). Read how the trace is retrieved at close (the per-position price path) and how `pos.entry`/`pos.side`/baseline pnlPct are available there.

- [ ] **Step 3: Add the smart-cut recording** — beside that block, add (flag-gated):

```js
// [ML-DSL loss-side, 2026-06-19] shadow-only smart-cut counterfactual. Never touches the
// real stop/close. Records a cohort='lossside' row for the DSL Drive visual + R:R proof.
if (MF.ML_DSL_LOSSSIDE_SHADOW) {
  try {
    const dslRrSim = require('./dslRrSim');
    const path = priceTrace.get(pos.seq);            // recorded price path (use the real getter found in Step 2)
    if (Array.isArray(path) && path.length > 1 && pos.entry > 0) {
      const baselinePnlPct = Number(pos.closePnlPct);  // real realized pnl fraction (use the real field found in Step 2)
      const smartPnlPct = dslRrSim._smartCutPnlPct(path, {
        side: pos.side, entry: pos.entry, threshold: 0.0075, recoverEps: 0.003, baselinePnlPct,
      });
      const advantage = smartPnlPct - baselinePnlPct;
      db.db.prepare(`INSERT INTO ml_dsl_outcome (pos_id,user_id,env,symbol,regime,arm,cohort,ml_pnl_pct,baseline_pnl_pct,advantage,win,ts)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        pos.seq, pos.userId, pos.env || 'TESTNET', pos.symbol, pos.regime || pos.closeRegime || '', pos.side,
        'lossside', smartPnlPct, baselinePnlPct, advantage, advantage > 0 ? 1 : 0, Date.now());
    }
  } catch (_) { /* shadow must never affect the live close */ }
}
```
Note: use the EXACT price-path getter, baseline-pnl-fraction field, and `db` handle found in Step 2 (the snippet uses placeholders `priceTrace.get` / `pos.closePnlPct` — replace with the real ones). If the realized pnl fraction isn't directly available, derive it as `(exitPrice - entry)/entry` for LONG (symmetric for SHORT) from the close data.

- [ ] **Step 4: Backup + sanity** — `cp server/services/serverAT.js server/services/serverAT.js.bak-lossside` before editing; after, `node -e "require('./server/services/serverAT.js'); console.log('serverAT requires OK')"`.

- [ ] **Step 5: Commit**

```
git add server/migrationFlags.js server/services/serverAT.js
git commit -m "feat(dsl): ML_DSL_LOSSSIDE_SHADOW flag + close-time smart-cut counterfactual recording (cohort=lossside)"
rm -f server/services/serverAT.js.bak-lossside
```

---

## Task 4: `/api/dsldrive/scoreboard` — lossSide stats + sparkline series

**Files:** Modify the route that serves `/api/dsldrive/scoreboard` (grep `dsldrive/scoreboard` in `server/routes/`).

- [ ] **Step 1: Locate the route** — `grep -rn "dsldrive/scoreboard" server/routes server.js`. Read its current response shape.

- [ ] **Step 2: Add the lossSide block** — in the handler, query `ml_dsl_outcome WHERE cohort='lossside'` (scope to the requesting user where the route already scopes), and compute with the existing helper:

```js
const dslRrSim = require('../services/dslRrSim');
const rows = db.db.prepare(`SELECT ml_pnl_pct, baseline_pnl_pct, advantage, ts FROM ml_dsl_outcome WHERE cohort='lossside' AND user_id=? ORDER BY ts ASC`).all(req.user.id);
const smart = dslRrSim._rrStats(rows.map(r => r.ml_pnl_pct));
const base = dslRrSim._rrStats(rows.map(r => r.baseline_pnl_pct));
// cumulative-advantage sparkline series (downsample to <= 60 points)
let cum = 0; const series = rows.map(r => (cum += r.advantage));
const step = Math.max(1, Math.ceil(series.length / 60));
const spark = series.filter((_, i) => i % step === 0);
const lossSide = {
  n: rows.length,
  rr: +smart.rr.toFixed(2), rrBaseline: +base.rr.toFixed(2),
  expDelta: +(smart.expectancy - base.expectancy).toFixed(4),
  avgLossSmart: +smart.avgLoss.toFixed(4), avgLossBaseline: +base.avgLoss.toFixed(4),
  wrSmart: +(smart.wr * 100).toFixed(0), wrBaseline: +(base.wr * 100).toFixed(0),
  cumAdvantage: +cum.toFixed(4), spark,
};
```
and include `lossSide` in the JSON response (e.g. `res.json({ ok: true, ...existing, lossSide })`).

- [ ] **Step 3: Sanity** — reload not required for a route file change until deploy; run the existing dsldrive route test if one exists, else verify the file requires: `node -e "require('./server/routes/<file>.js'); console.log('route OK')"`.

- [ ] **Step 4: Commit**

```
git add server/routes/<file>.js
git commit -m "feat(dsl): scoreboard lossSide R:R block + cumulative-advantage sparkline series"
```

---

## Task 5: DSL Drive visual — Smart Loss-Cut card + sparkline

**Files:** Modify `client/src/components/dock/DslDrivePanel.tsx`, `client/src/app.css`

- [ ] **Step 1: Read the panel** — see how it consumes `/api/dsldrive/scoreboard` (the `score` state, ~line 29/49). The new `lossSide` block is on that response.

- [ ] **Step 2: Add the card** — render, when `score?.lossSide` exists and `n>0`, a card:

```tsx
{score?.lossSide && score.lossSide.n > 0 ? (
  <div className="dsl-losscut-card">
    <h4>🛡️ Smart Loss-Cut <span className="dsl-shadow-tag">SHADOW</span></h4>
    <div className="dsl-losscut-verdict">
      R:R {score.lossSide.rr} vs {score.lossSide.rrBaseline} · Δexp {score.lossSide.expDelta >= 0 ? '+' : ''}{score.lossSide.expDelta} · N={score.lossSide.n} · not yet live
    </div>
    <div className="dsl-losscut-rows">
      <span>avgLoss {score.lossSide.avgLossSmart} vs {score.lossSide.avgLossBaseline}</span>
      <span>WR {score.lossSide.wrSmart}% vs {score.lossSide.wrBaseline}%</span>
    </div>
    <Sparkline data={score.lossSide.spark} />
  </div>
) : (
  <div className="dsl-losscut-card dsl-muted">🛡️ Smart Loss-Cut (shadow) — no data yet</div>
)}
```
And a tiny inline-SVG `Sparkline` component (in the same file):
```tsx
function Sparkline({ data }: { data: number[] }) {
  if (!data || data.length < 2) return null;
  const w = 180, h = 32, min = Math.min(...data), max = Math.max(...data), rng = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / rng) * h}`).join(' ');
  const up = data[data.length - 1] >= data[0];
  return (
    <svg className="dsl-spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={up ? '#00d97a' : '#ff6680'} strokeWidth="1.5" />
    </svg>
  );
}
```

- [ ] **Step 3: CSS** — back up app.css, append:

```css
/* [2026-06-19] DSL Drive smart loss-cut card */
.dsl-losscut-card { margin-top:8px; padding:10px 12px; background:rgba(10,15,22,.6); border:1px solid #1a2530; border-radius:8px; }
.dsl-losscut-card h4 { margin:0 0 6px; font-size:11px; letter-spacing:.4px; color:#7a9ab8; text-transform:uppercase; }
.dsl-shadow-tag { font-size:9px; color:#f0b429; border:1px solid #f0b42955; border-radius:8px; padding:1px 5px; margin-left:6px; }
.dsl-losscut-verdict { font-size:12px; color:#c8d6e5; margin-bottom:4px; }
.dsl-losscut-rows { display:flex; gap:12px; font-size:10px; color:#7a9ab8; margin-bottom:6px; }
.dsl-spark { display:block; }
.dsl-losscut-card.dsl-muted { color:#5a6a7a; font-size:11px; }
```

- [ ] **Step 4: Build**

```
cd /opt/zeus-terminal/client && sudo -u zeus npm run build 2>&1 | grep -E "built in|error TS" | head
cd /opt/zeus-terminal && chown -R zeus:zeus public/app && rm -f client/src/app.css.bak*
```
Expected: built clean.

- [ ] **Step 5: Commit**

```
git add client/src/components/dock/DslDrivePanel.tsx client/src/app.css
git commit -m "feat(dsl): Smart Loss-Cut card + cumulative-advantage sparkline in DSL Drive"
```

---

## Task 6: Verify + deploy (GO gate)

- [ ] **Step 1: Reload** — `cd /opt/zeus-terminal && node -e "require('./server/version.js')" && sudo -u zeus pm2 reload zeus && sleep 3 && curl -s -o /dev/null -w "health=%{http_code}\n" http://localhost:3000/api/health` (expect 401 = up).

- [ ] **Step 2: Headless** — mint uid=1 token, open DSL Drive (`[data-dock="dsl-drive"]`), assert the Smart Loss-Cut card renders (with the flag OFF it shows "no data yet" gracefully), 0 page/console errors, screenshot.

- [ ] **Step 3: (operator-gated) Enable shadow** — with operator GO, set `ML_DSL_LOSSSIDE_SHADOW=true` via the admin flags API (or data/migration_flags.json) + reload, so it begins recording cohort='lossside' on the next closes. Confirm rows appear: `node -e "const D=require('better-sqlite3');const db=new D('data/zeus.db',{readonly:true});console.log(db.prepare(\"SELECT COUNT(*) n FROM ml_dsl_outcome WHERE cohort='lossside'\").get())"`.

- [ ] **Step 4: Bump version.js** (build+version) — changelog: smart loss-side cut shadow + DSL Drive visual; validate with `node -e require` BEFORE reload.

- [ ] **Step 5: Final build + chown + reload + commit + push (GET OPERATOR GO FIRST).**

---

## Rollback
Flag `ML_DSL_LOSSSIDE_SHADOW=false` + reload → no recording, zero behavior. The UI card hides when no data. Revert the commits to remove entirely. No live execution ever changed.

## Self-review
- **Spec coverage:** `_shouldEarlyExit` (T1) ✓; `_recovering` (T1) ✓; smart-cut counterfactual replay (T2 `_smartCutPnlPct`) ✓; shadow recording cohort='lossside' + flag (T3) ✓; scoreboard lossSide + sparkline series (T4) ✓; DSL Drive card + sparkline (T5) ✓; flag-gated/fail-closed (T3 try-catch + default OFF) ✓; verify+deploy gate (T6) ✓. Live control deliberately out of scope ✓.
- **Type consistency:** `_smartCutPnlPct(pricePath, cfg{side,entry,threshold,recoverEps,baselinePnlPct})`, `_shouldEarlyExit({adversePct,recovering,threshold})`, `_recovering(price,extreme,side,eps)` — signatures consistent across tasks. `ml_dsl_outcome` columns match the verified schema. `lossSide` JSON shape consistent between T4 (producer) and T5 (consumer).
- **Placeholder note:** T3 Step 3 uses placeholder field names (`priceTrace.get`, `pos.closePnlPct`) explicitly flagged to be replaced with the real getters found in Step 2 — this is required because the exact recorded-trace API is read at implementation time; the structure + the pure helpers are fully specified.
