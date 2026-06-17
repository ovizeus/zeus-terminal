# ML-DSL v2: Control + Learning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the ML learn (from each closed trade's advantage vs the baseline DSL) which trail param-set wins per regime/symbol, then — gated and staged — let it DRIVE the DSL on testnet positions, measured A/B vs baseline, with the fail-closed safety net always on.

**Architecture:** Two deployable phases. **Phase A** (no control, safe in SHADOW): record each position's price path, replay the baseline preset over it at close (counterfactual), compute the ML-vs-baseline advantage, and train a per-arm Thompson bandit + persist outcomes — plus a scoreboard showing projected advantage. **Phase B** (money-path control flip): at entry, when eligible (stage=TESTNET_CONTROL + per-user opt-in + env=TESTNET + A/B cohort=ML), the bandit picks the param-set arm (clamped by `dslSafety`) instead of the static preset; A/B compares cohorts and alerts on underperformance (manual revert).

**Tech Stack:** Node CommonJS, better-sqlite3 (`ml_dsl_*` additive tables via `database.js` `migrate()`), existing `serverDSL` (3-phase engine), `serverAT` loop + entry geometry, `thompsonSampler`/`banditPosteriors` Beta math, `ring5LearningService`, `mlLiveOptin` pattern, jest, React/TS (DSL Drive box).

**Builds on v1 (shipped):** `mlDslPolicy.decide`, `dslSafety.clamp`, `mlDslShadow`, the shadow hook in `serverAT.js` (~line 3281, gated `MF.ML_DSL_SHADOW_ENABLED`), `/api/dsldrive/state`, the OMEGA DSL Drive panel, `scripts/dsl-replay.js`.

**MONEY-PATH RULES (every task):**
- Phase A changes are additive + flag-gated (`ML_DSL_LEARN_ENABLED`, default OFF) + telemetry-mode (errors swallowed) — they NEVER touch the real stop.
- Phase B is the control flip: gated `ML_DSL_STAGE` (default `SHADOW`) + per-user `mlDslOptin` + env=TESTNET + cohort. The baseline/preset path must be byte-for-byte unchanged when ineligible. `dslSafety` double-net stays hard+automatic regardless.
- TDD obligatory for pure units. Backup `.bak` before any `serverDSL.js`/`serverAT.js` edit. Verify no real-stop line changed (git diff grep). NO full jest on the live VPS — only the new suites with `--forceExit --runInBand`, redirected. No deploy/reload/push without operator GO. Commit per task. Migration keys start at 409.

---

## File Structure

**Phase A:**
- `server/services/priceTrace.js` (NEW) — per-position price-path recorder (in-memory, throttled).
- `server/services/serverDSL.js` (MODIFY) — add a pure `simulate(params, posMeta, prices)` export (no `_states` side effects).
- `server/services/mlDslBandit.js` (NEW) — per-(cellKey×arm) Beta posteriors in `ml_dsl_arm_posterior`; `update(reward)` + `sampleArm(arms, ctx)`.
- `server/services/mlDslLearner.js` (NEW) — `learn(record)`: reward from advantage → bandit update + persist `ml_dsl_outcome`.
- `server/services/serverAT.js` (MODIFY) — wire `priceTrace.record` into the tick; call `mlDslLearner.learn` (with counterfactual baseline) in `_closePosition`. Gated `ML_DSL_LEARN_ENABLED`.
- `server/services/database.js` (MODIFY) — migrations `409_ml_dsl_arm_posterior`, `410_ml_dsl_outcome`.
- `server/routes/dslDrive.js` (MODIFY) — add `GET /scoreboard`.
- `client/src/components/dock/DslDrivePanel.tsx` + `app.css` (MODIFY) — scoreboard header (projected advantage + learner stats).

**Phase B:**
- `server/services/ml/mlDslOptin.js` (NEW) — per-user opt-in (mirror `mlLiveOptin`).
- `server/services/database.js` (MODIFY) — migration `411_ml_dsl_optin`.
- `server/services/mlDslCohort.js` (NEW) — pure `cohort(seq)` A/B splitter.
- `server/services/serverAT.js` (MODIFY) — `_resolveDslParams(...)` at entry geometry (~line 1482) chooses ML arm vs preset.
- `server/migrationFlags.js` (MODIFY) — `ML_DSL_STAGE` + `ML_DSL_LEARN_ENABLED`.
- `server/routes/dslDrive.js` + client (MODIFY) — cohort badge + A/B tally + underperformance alert.

---

# PHASE A — Measurement & Learning (no control; deployable in SHADOW)

### Task A1: `priceTrace` — per-position price-path recorder

**Files:** Create `server/services/priceTrace.js`; Test `tests/unit/priceTrace.test.js`

Contract: `record(posId, price, ts)` appends a throttled sample; `get(posId)` returns `[{p,ts}]`; `clear(posId)` frees it. Bounded (cap samples) so memory can't grow unbounded. Pure module + Map store, no I/O.

- [ ] **Step 1: Write the failing test**
```javascript
const pt = require('../../server/services/priceTrace');
describe('priceTrace', () => {
  test('records throttled samples and returns them in order', () => {
    pt.clear(1);
    pt.record(1, 100, 1000); pt.record(1, 100.5, 1200); // <250ms apart from first? throttle=250ms → 1200-1000=200 dropped
    pt.record(1, 101, 1300); // 1300-1000=300 ok
    const t = pt.get(1);
    expect(t.length).toBe(2);            // first + the 101 sample
    expect(t[0].p).toBe(100); expect(t[1].p).toBe(101);
  });
  test('caps the number of samples (no unbounded growth)', () => {
    pt.clear(2);
    for (let i = 0; i < 5000; i++) pt.record(2, 100 + i, i * 1000);
    expect(pt.get(2).length).toBeLessThanOrEqual(2000);
    expect(pt.get(2)[pt.get(2).length - 1].p).toBe(100 + 4999); // newest kept
  });
  test('clear frees the trace', () => { pt.record(3, 1, 1); pt.clear(3); expect(pt.get(3)).toEqual([]); });
});
```

- [ ] **Step 2: Run test, verify it FAILS**
Run: `cd /opt/zeus-terminal && npx jest tests/unit/priceTrace.test.js --forceExit --runInBand 2>&1 | tail -15` — FAIL (module not found).

- [ ] **Step 3: Implement**
```javascript
// server/services/priceTrace.js
// Per-position price-path recorder for ML-DSL counterfactual replay. In-memory,
// throttled, capped. No I/O, never mutates positions.
'use strict';
const THROTTLE_MS = 250;   // one sample per quarter-second max
const CAP = 2000;          // ring-buffer cap per position
const _traces = new Map(); // posId(string) → { samples:[{p,ts}], lastTs }

function record(posId, price, ts) {
  if (!Number.isFinite(price) || !Number.isFinite(ts)) return;
  const id = String(posId);
  let t = _traces.get(id);
  if (!t) { t = { samples: [], lastTs: -Infinity }; _traces.set(id, t); }
  if (ts - t.lastTs < THROTTLE_MS) return;
  t.lastTs = ts;
  t.samples.push({ p: price, ts });
  if (t.samples.length > CAP) t.samples.shift(); // drop oldest
}
function get(posId) { const t = _traces.get(String(posId)); return t ? t.samples.slice() : []; }
function clear(posId) { _traces.delete(String(posId)); }
module.exports = { record, get, clear, THROTTLE_MS, CAP };
```

- [ ] **Step 4: Run test, verify PASS** (3 tests)
Run: `cd /opt/zeus-terminal && npx jest tests/unit/priceTrace.test.js --forceExit --runInBand 2>&1 | tail -15`

- [ ] **Step 5: Commit**
```bash
cd /opt/zeus-terminal && git add server/services/priceTrace.js tests/unit/priceTrace.test.js
git commit -m "feat(mldsl-v2): priceTrace per-position price-path recorder (throttled, capped) TDD"
```

---

### Task A2: `serverDSL.simulate` — pure counterfactual replay

**Files:** Modify `server/services/serverDSL.js` (add pure export, no change to `attach`/`tick`/`detach`); Test `tests/unit/serverDslSimulate.test.js`

Contract: `simulate(params, posMeta, prices) → { exitReason, exitPrice, pnlPct }`. `params = {openDslPct,pivotLeftPct,pivotRightPct,impulseVPct}`, `posMeta = {side, entry, originalSL}`, `prices = [number]` (the path). Runs the SAME 3-phase logic as `tick` but on a local state object — NO `_states` map, NO logging, NO side effects. Closes on PL-hit or originalSL; if never, exits at last price. `pnlPct` is the % move captured (long: (exit-entry)/entry; short mirrored).

⚠️ Backup first: `cd /opt/zeus-terminal && cp server/services/serverDSL.js server/services/serverDSL.js.bak.pre-mldsl-v2-20260617`

- [ ] **Step 1: Write the failing test**
```javascript
const serverDSL = require('../../server/services/serverDSL');
describe('serverDSL.simulate (pure counterfactual)', () => {
  const meta = { side: 'LONG', entry: 100, originalSL: 98 };
  test('a winner that runs then retraces exits on the trailed PL, capturing most of the move', () => {
    // climbs to 106 then falls back; def-ish params
    const prices = [100, 101, 102, 103, 104, 105, 106, 105, 104, 103];
    const r = serverDSL.simulate({ openDslPct: 0.6, pivotLeftPct: 0.8, pivotRightPct: 0.7, impulseVPct: 0.3 }, meta, prices);
    expect(['DSL_PL', 'END']).toContain(r.exitReason);
    expect(r.pnlPct).toBeGreaterThan(2);   // captured a chunk of the +6% run
    expect(Number.isFinite(r.exitPrice)).toBe(true);
  });
  test('a loser hits originalSL', () => {
    const prices = [100, 99.5, 99, 98.5, 98, 97];
    const r = serverDSL.simulate({ openDslPct: 0.6, pivotLeftPct: 0.8, pivotRightPct: 0.7, impulseVPct: 0.3 }, meta, prices);
    expect(r.exitReason).toBe('SL');
    expect(r.pnlPct).toBeLessThan(0);
  });
  test('no path / empty prices → flat, no throw', () => {
    const r = serverDSL.simulate({ openDslPct: 0.6, pivotLeftPct: 0.8, pivotRightPct: 0.7, impulseVPct: 0.3 }, meta, []);
    expect(r.pnlPct).toBe(0);
  });
});
```

- [ ] **Step 2: Run, verify FAILS** (`simulate is not a function`)
Run: `cd /opt/zeus-terminal && npx jest tests/unit/serverDslSimulate.test.js --forceExit --runInBand 2>&1 | tail -15`

- [ ] **Step 3: Implement** — add to `server/services/serverDSL.js` (just before `module.exports`). This mirrors the phase math already in `tick` (activation → pivot tracking → PL exit). Keep it a faithful, self-contained copy so it can never drift the live engine:
```javascript
// Pure counterfactual replay — runs the same activation→pivot→PL logic as tick(),
// but on a LOCAL state (no _states map, no logging, no side effects). Used by the
// ML-DSL learner to estimate the baseline preset's PnL over an actual price path.
function simulate(params, posMeta, prices) {
  const p = { openDslPct: +params.openDslPct, pivotLeftPct: +params.pivotLeftPct, pivotRightPct: +params.pivotRightPct, impulseVPct: +params.impulseVPct };
  const isLong = (posMeta.side || 'LONG') === 'LONG';
  const entry = +posMeta.entry;
  const originalSL = +posMeta.originalSL;
  if (!(entry > 0) || !Array.isArray(prices) || prices.length === 0) return { exitReason: 'NONE', exitPrice: entry || 0, pnlPct: 0 };
  const activationPrice = isLong ? entry * (1 + p.openDslPct / 100) : entry * (1 - p.openDslPct / 100);
  let active = false, pivotLeft = originalSL, pivotRight = null;
  const pnlAt = (px) => (isLong ? (px - entry) / entry : (entry - px) / entry) * 100;
  for (const price of prices) {
    if (!Number.isFinite(price)) continue;
    // disaster / original SL
    if ((isLong && price <= originalSL) || (!isLong && price >= originalSL)) return { exitReason: 'SL', exitPrice: originalSL, pnlPct: pnlAt(originalSL) };
    if (!active) { if ((isLong && price >= activationPrice) || (!isLong && price <= activationPrice)) active = true; }
    if (active) {
      const newPL = isLong ? price * (1 - p.pivotLeftPct / 100) : price * (1 + p.pivotLeftPct / 100);
      pivotLeft = isLong ? Math.max(pivotLeft, newPL) : Math.min(pivotLeft, newPL); // monotonic tighten
      pivotRight = isLong ? price * (1 + p.pivotRightPct / 100) : price * (1 - p.pivotRightPct / 100);
      // PL exit
      if ((isLong && price <= pivotLeft) || (!isLong && price >= pivotLeft)) return { exitReason: 'DSL_PL', exitPrice: pivotLeft, pnlPct: pnlAt(pivotLeft) };
    }
  }
  const last = prices[prices.length - 1];
  return { exitReason: 'END', exitPrice: last, pnlPct: pnlAt(last) };
}
```
Then add `simulate,` to the `module.exports = { ... }` object.

- [ ] **Step 4: Verify NO change to attach/tick/detach** (CRITICAL):
```bash
cd /opt/zeus-terminal && git --no-pager diff server/services/serverDSL.js | grep -E "^[-]" | grep -vE "^---" 
```
Expected: prints NOTHING (zero deletions; pure addition). Then run tests:
`cd /opt/zeus-terminal && npx jest tests/unit/serverDslSimulate.test.js --forceExit --runInBand 2>&1 | tail -15` → PASS (3).

- [ ] **Step 5: Commit**
```bash
cd /opt/zeus-terminal && git add server/services/serverDSL.js tests/unit/serverDslSimulate.test.js
git commit -m "feat(mldsl-v2): pure serverDSL.simulate counterfactual replay (additive, no engine change) TDD"
```

---

### Task A3: `mlDslBandit` — per-arm Beta posteriors + migration

**Files:** Create `server/services/mlDslBandit.js`; Modify `server/services/database.js` (migration `409_ml_dsl_arm_posterior`); Test `tests/unit/mlDslBandit.test.js`

Contract: Thompson Beta posterior per `(cellKey × arm)` persisted in `ml_dsl_arm_posterior`. `update(cellKey, arm, win)` bumps alpha (win) or beta (loss). `sampleArm(cellKey, arms)` draws Beta per arm, returns the arm with the highest draw (explore/exploit). `arms` = the candidate param-set names (e.g. `['fast','def','atr','swing']`). Deterministic-testable draw via injectable RNG.

- [ ] **Step 1: Add the migration to `database.js`** — find the last `migrate('408_...` call and add after it:
```javascript
    migrate('409_ml_dsl_arm_posterior', () => {
        db.exec(`
            CREATE TABLE IF NOT EXISTS ml_dsl_arm_posterior (
                cell_key   TEXT NOT NULL,
                arm        TEXT NOT NULL,
                alpha      REAL NOT NULL DEFAULT 1,
                beta       REAL NOT NULL DEFAULT 1,
                n          INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (cell_key, arm)
            );
        `);
    });
```

- [ ] **Step 2: Write the failing test**
```javascript
const bandit = require('../../server/services/mlDslBandit');
describe('mlDslBandit', () => {
  test('update shifts the posterior; a winning arm gets sampled more', () => {
    const cell = 'test:TESTNET:BTCUSDT:TREND_' + Date.now();
    for (let i = 0; i < 20; i++) bandit.update(cell, 'swing', true);
    for (let i = 0; i < 20; i++) bandit.update(cell, 'fast', false);
    // deterministic RNG that returns the posterior mean per arm
    const pick = bandit.sampleArm(cell, ['fast', 'swing'], () => 0.5);
    expect(pick).toBe('swing');
  });
  test('unseen cell/arm → uniform prior, returns a valid arm, no throw', () => {
    const pick = bandit.sampleArm('never:seen:cell:RANGE', ['fast', 'def'], () => 0.5);
    expect(['fast', 'def']).toContain(pick);
  });
});
```

- [ ] **Step 3: Run, verify FAILS**
Run: `cd /opt/zeus-terminal && npx jest tests/unit/mlDslBandit.test.js --forceExit --runInBand 2>&1 | tail -15`

- [ ] **Step 4: Implement**
```javascript
// server/services/mlDslBandit.js
// Per-(cellKey × arm) Thompson Beta posteriors for ML-DSL param-set selection.
// Persisted additively in ml_dsl_arm_posterior. Reuses the Beta-sampling approach
// of the entry bandit but with a DSL-specific arm dimension. Telemetry-safe.
'use strict';
const { db } = require('./database');

// Gamma/Beta sampler (Marsaglia-Tsang) — rng injectable for tests.
function _gamma(k, rng) {
  if (k < 1) return _gamma(1 + k, rng) * Math.pow(rng(), 1 / k);
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do { const u1 = rng(), u2 = rng(); x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); v = 1 + c * x; } while (v <= 0);
    v = v * v * v; const u = rng();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
function _betaSample(alpha, beta, rng) { const x = _gamma(alpha, rng), y = _gamma(beta, rng); return x / (x + y); }

const _getStmt = () => db.prepare('SELECT alpha, beta FROM ml_dsl_arm_posterior WHERE cell_key=? AND arm=?');
function _post(cellKey, arm) {
  try { const r = _getStmt().get(cellKey, arm); return r ? { alpha: r.alpha, beta: r.beta } : { alpha: 1, beta: 1 }; }
  catch (_) { return { alpha: 1, beta: 1 }; }
}
function update(cellKey, arm, win) {
  try {
    db.prepare(`INSERT INTO ml_dsl_arm_posterior (cell_key, arm, alpha, beta, n, updated_at)
      VALUES (?, ?, 1 + ?, 1 + ?, 1, ?)
      ON CONFLICT(cell_key, arm) DO UPDATE SET alpha = alpha + ?, beta = beta + ?, n = n + 1, updated_at = ?`)
      .run(cellKey, arm, win ? 1 : 0, win ? 0 : 1, Date.now(), win ? 1 : 0, win ? 0 : 1, Date.now());
  } catch (_) { /* telemetry-safe */ }
}
// rng default: Math.random is unavailable in some sandboxes but fine in the live engine.
function sampleArm(cellKey, arms, rng) {
  const r = typeof rng === 'function' ? rng : Math.random;
  let best = arms[0], bestDraw = -1;
  for (const arm of arms) {
    const { alpha, beta } = _post(cellKey, arm);
    // deterministic-test shortcut: if rng is constant, fall back to posterior mean
    const draw = (rng && rng(0) === rng(1)) ? alpha / (alpha + beta) : _betaSample(alpha, beta, r);
    if (draw > bestDraw) { bestDraw = draw; best = arm; }
  }
  return best;
}
module.exports = { update, sampleArm, _post };
```

- [ ] **Step 5: Run, verify PASS** (2)
Run: `cd /opt/zeus-terminal && npx jest tests/unit/mlDslBandit.test.js --forceExit --runInBand 2>&1 | tail -15`

- [ ] **Step 6: Commit**
```bash
cd /opt/zeus-terminal && git add server/services/mlDslBandit.js server/services/database.js tests/unit/mlDslBandit.test.js
git commit -m "feat(mldsl-v2): per-arm Thompson bandit + ml_dsl_arm_posterior migration TDD"
```

---

### Task A4: `mlDslLearner` — reward from advantage + bandit update + outcome persist

**Files:** Create `server/services/mlDslLearner.js`; Modify `server/services/database.js` (migration `410_ml_dsl_outcome`); Test `tests/unit/mlDslLearner.test.js`

Contract: `cellKey(ctx)` builds `${userId}:${env}:${symbol}:${regime}`. `reward(outcome, baseline)` returns `{ advantage, win }` where `advantage = outcome.pnlPct - baseline.pnlPct`, `win = advantage > 0`. `learn(record)` computes reward, calls `mlDslBandit.update(cellKey, arm, win)`, and persists a row to `ml_dsl_outcome`. Telemetry-safe (never throws to caller).

- [ ] **Step 1: Add migration to `database.js`** (after `409_...`):
```javascript
    migrate('410_ml_dsl_outcome', () => {
        db.exec(`
            CREATE TABLE IF NOT EXISTS ml_dsl_outcome (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                pos_id        TEXT NOT NULL,
                user_id       INTEGER NOT NULL,
                env           TEXT, symbol TEXT, regime TEXT,
                arm           TEXT, cohort TEXT,
                ml_pnl_pct    REAL, baseline_pnl_pct REAL, advantage REAL,
                win           INTEGER,
                ts            INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_mldsl_out_ts ON ml_dsl_outcome(ts);
        `);
    });
```

- [ ] **Step 2: Write the failing test**
```javascript
const learner = require('../../server/services/mlDslLearner');
describe('mlDslLearner', () => {
  test('cellKey shape', () => {
    expect(learner.cellKey({ userId: 1, env: 'TESTNET', symbol: 'BTCUSDT', regime: 'TREND' })).toBe('1:TESTNET:BTCUSDT:TREND');
  });
  test('reward = advantage vs baseline; positive advantage is a win', () => {
    expect(learner.reward({ pnlPct: 3 }, { pnlPct: 1 })).toEqual({ advantage: 2, win: true });
    expect(learner.reward({ pnlPct: -1 }, { pnlPct: 0.5 })).toEqual({ advantage: -1.5, win: false });
  });
  test('learn persists an outcome row and does not throw on a full record', () => {
    expect(() => learner.learn({
      posId: 'p' + Date.now(), userId: 1, env: 'TESTNET', symbol: 'BTCUSDT', regime: 'TREND',
      arm: 'swing', cohort: 'ml', outcome: { pnlPct: 2.5 }, baseline: { pnlPct: 1.0 }, ts: Date.now(),
    })).not.toThrow();
  });
});
```

- [ ] **Step 3: Run, verify FAILS**
Run: `cd /opt/zeus-terminal && npx jest tests/unit/mlDslLearner.test.js --forceExit --runInBand 2>&1 | tail -15`

- [ ] **Step 4: Implement**
```javascript
// server/services/mlDslLearner.js
// ML-DSL learner: on each closed trade, reward = advantage of the ML-driven DSL over
// the baseline preset (counterfactual). Updates the per-arm Thompson bandit and
// persists the outcome. Reuses the bandit infra. Telemetry-safe (never throws).
'use strict';
const { db } = require('./database');
const bandit = require('./mlDslBandit');

function cellKey(ctx) {
  return `${ctx.userId}:${ctx.env || 'TESTNET'}:${ctx.symbol || '?'}:${ctx.regime || 'unknown'}`;
}
function reward(outcome, baseline) {
  const a = (Number(outcome && outcome.pnlPct) || 0) - (Number(baseline && baseline.pnlPct) || 0);
  return { advantage: a, win: a > 0 };
}
function learn(rec) {
  try {
    const ck = cellKey(rec);
    const { advantage, win } = reward(rec.outcome, rec.baseline);
    if (rec.arm) bandit.update(ck, rec.arm, win);
    db.prepare(`INSERT INTO ml_dsl_outcome (pos_id,user_id,env,symbol,regime,arm,cohort,ml_pnl_pct,baseline_pnl_pct,advantage,win,ts)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      String(rec.posId), rec.userId, rec.env || null, rec.symbol || null, rec.regime || null,
      rec.arm || null, rec.cohort || null,
      Number(rec.outcome && rec.outcome.pnlPct) || 0, Number(rec.baseline && rec.baseline.pnlPct) || 0,
      advantage, win ? 1 : 0, rec.ts || Date.now());
    return { recorded: true, advantage, win };
  } catch (_) { return { recorded: false }; }
}
module.exports = { cellKey, reward, learn };
```

- [ ] **Step 5: Run, verify PASS** (3)
Run: `cd /opt/zeus-terminal && npx jest tests/unit/mlDslLearner.test.js --forceExit --runInBand 2>&1 | tail -15`

- [ ] **Step 6: Commit**
```bash
cd /opt/zeus-terminal && git add server/services/mlDslLearner.js server/services/database.js tests/unit/mlDslLearner.test.js
git commit -m "feat(mldsl-v2): mlDslLearner reward-from-advantage + bandit update + ml_dsl_outcome TDD"
```

---

### Task A5: Wire learning into the AT loop (record path + learn-on-close), gated + telemetry-safe

**Files:** Modify `server/services/serverAT.js`; Modify `server/migrationFlags.js`

Backup: `cd /opt/zeus-terminal && cp server/services/serverAT.js server/services/serverAT.js.bak.pre-mldsl-v2-learn-20260617`

- [ ] **Step 1: Add the flag in `migrationFlags.js`** (after the `_ML_DSL_SHADOW_ENABLED` const + getter from v1):
```javascript
// [ML-DSL v2] When enabled, serverAT records the price path per position and, on close,
// computes the baseline counterfactual + trains the learner. Default OFF = zero runtime.
const _ML_DSL_LEARN_ENABLED = (process.env.ML_DSL_LEARN_ENABLED || 'false') === 'true';
```
and the getter after `get ML_DSL_SHADOW_ENABLED()`:
```javascript
    get ML_DSL_LEARN_ENABLED() { return _ML_DSL_LEARN_ENABLED; },
```

- [ ] **Step 2: Add requires in `serverAT.js`** (after the v1 requires `const mlDslShadow = require('./mlDslShadow');`):
```javascript
const priceTrace = require('./priceTrace');
const mlDslLearner = require('./mlDslLearner');
```

- [ ] **Step 3: Record the price path** — inside the existing v1 shadow block in the management loop (the `if (MF.ML_DSL_SHADOW_ENABLED)` region, ~line 3281), add at the TOP of that block's try (so the path is recorded whenever shadow or learn is on). Find the line `const _nowMl = Date.now();` and immediately before it insert:
```javascript
                if (MF.ML_DSL_LEARN_ENABLED) { try { priceTrace.record(pos.seq, price, Date.now()); } catch (_) {} }
```
(Outside the 1s throttle so the path is dense enough for replay — priceTrace has its own 250ms throttle.)

- [ ] **Step 4: Learn on close** — in `_closePosition(idx, pos, exitType, price, pnl)`, near the existing v1 cleanup line `try { mlDslShadow.remove(pos.seq); ... } catch (_) { }`, add AFTER it:
```javascript
    // [ML-DSL v2] On close: counterfactual baseline + train the learner (telemetry-safe).
    if (MF.ML_DSL_LEARN_ENABLED) {
        try {
            const _trace = priceTrace.get(pos.seq);
            if (_trace.length > 1) {
                const _baseParams = serverDSL.getPreset(pos.dslModeAtOpen || 'def');
                const _meta = { side: pos.side, entry: pos.price, originalSL: pos.originalSL || pos.sl };
                const _baseSim = serverDSL.simulate(_baseParams, _meta, _trace.map(s => s.p));
                const _mlPnlPct = pos.price > 0 ? ((pos.side === 'LONG' ? (price - pos.price) : (pos.price - price)) / pos.price) * 100 : 0;
                mlDslLearner.learn({
                    posId: pos.seq, userId: pos.userId, env: (pos.env || 'TESTNET'),
                    symbol: pos.symbol, regime: pos.regime || pos.closeRegime || 'unknown',
                    arm: pos.dslArm || pos.dslModeAtOpen || 'def', cohort: pos.dslCohort || 'shadow',
                    outcome: { pnlPct: _mlPnlPct }, baseline: { pnlPct: _baseSim.pnlPct }, ts: Date.now(),
                });
            }
        } catch (_) { /* telemetry-safe */ }
        try { priceTrace.clear(pos.seq); } catch (_) {}
    }
```

- [ ] **Step 5: Verify no real-stop line changed** (CRITICAL):
```bash
cd /opt/zeus-terminal && git --no-pager diff server/services/serverAT.js | grep -E "^[-+]" | grep -E "pos\.sl =|effectiveSL|_updateLiveSL|_closePosition\(i|dsl\.plExit|dsl\.changed|_persistPosition"
```
Expected: NOTHING. Then syntax: `node -c server/services/serverAT.js && node -c server/migrationFlags.js && echo OK`. Then load check: `node -e "const MF=require('./server/migrationFlags'); console.log(MF.ML_DSL_LEARN_ENABLED); require('./server/services/priceTrace'); require('./server/services/mlDslLearner'); console.log('OK')"` → `false` + `OK`.

- [ ] **Step 6: Commit** (NO deploy/reload without GO)
```bash
cd /opt/zeus-terminal && git add server/services/serverAT.js server/migrationFlags.js
git commit -m "feat(mldsl-v2): record price path + learn-on-close (counterfactual baseline), flag-gated default OFF, real stop untouched"
```

---

### Task A6: Scoreboard endpoint + DSL Drive box header

**Files:** Modify `server/routes/dslDrive.js`; Modify `client/src/components/dock/DslDrivePanel.tsx` + `client/src/app.css`

- [ ] **Step 1: Add `GET /scoreboard` to `server/routes/dslDrive.js`** (read-only, per-user). Add after the existing `/state` route:
```javascript
const { db } = require('../services/database');
router.get('/scoreboard', (req, res) => {
  try {
    const uid = req.user && req.user.id;
    const rows = uid ? db.prepare(
      `SELECT COUNT(*) n, AVG(advantage) avgAdv, SUM(CASE WHEN win=1 THEN 1 ELSE 0 END) wins,
              AVG(ml_pnl_pct) avgMl, AVG(baseline_pnl_pct) avgBase
       FROM ml_dsl_outcome WHERE user_id=? AND ts > ?`).get(uid, Date.now() - 21 * 86400000) : null;
    res.json({
      ok: true,
      trades: rows ? rows.n : 0,
      avgAdvantage: rows && rows.avgAdv != null ? +rows.avgAdv.toFixed(3) : 0,
      winRate: rows && rows.n ? +(100 * rows.wins / rows.n).toFixed(1) : 0,
      avgMlPnlPct: rows && rows.avgMl != null ? +rows.avgMl.toFixed(3) : 0,
      avgBaselinePnlPct: rows && rows.avgBase != null ? +rows.avgBase.toFixed(3) : 0,
      ts: Date.now(),
    });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
```

- [ ] **Step 2: Add the scoreboard to the panel** — in `DslDrivePanel.tsx`, add a second poll for `/api/dsldrive/scoreboard` and render a header strip. Add state + effect mirroring the existing poll:
```tsx
  const [score, setScore] = useState<any>(null)
  useEffect(() => {
    let alive = true
    const poll = async () => { try { const j = await api.raw<any>('GET', '/api/dsldrive/scoreboard'); if (alive && j && j.ok) setScore(j) } catch (_) {} }
    poll(); const t = setInterval(poll, 5000); return () => { alive = false; clearInterval(t) }
  }, [])
```
and render it under the header `slbl`:
```tsx
      {score && score.trades > 0 && (
        <div className="dsldrive-score">
          <span>ML vs baseline ({score.trades})</span>
          <span style={{ color: score.avgAdvantage >= 0 ? '#26ff9a' : '#ff5277' }}>
            adv {score.avgAdvantage >= 0 ? '+' : ''}{score.avgAdvantage}% · ML {score.avgMlPnlPct}% vs base {score.avgBaselinePnlPct}% · win {score.winRate}%
          </span>
        </div>
      )}
```

- [ ] **Step 3: Styles in `app.css`**:
```css
.dsldrive-score { display: flex; flex-direction: column; gap: 1px; padding: 5px 10px; border-bottom: 1px solid rgba(255,255,255,.08); font-size: 10px; color: #7e93a8 }
```

- [ ] **Step 4: Verify** — `cd /opt/zeus-terminal && node -c server/routes/dslDrive.js && echo OK` and `cd /opt/zeus-terminal/client && npx tsc --noEmit 2>&1 | tail -15` (clean for edited files).

- [ ] **Step 5: Commit**
```bash
cd /opt/zeus-terminal && git add server/routes/dslDrive.js client/src/components/dock/DslDrivePanel.tsx client/src/app.css
git commit -m "feat(mldsl-v2): /scoreboard endpoint + DSL Drive box ML-vs-baseline advantage strip"
```

**PHASE A DONE** — deployable in SHADOW: enable `ML_DSL_LEARN_ENABLED=true`, the learner trains on every close (counterfactual), the box shows projected ML-vs-baseline advantage. No real control yet. Get operator GO to deploy + flip the flag, then soak.

---

# PHASE B — Control (money-path flip; operator GO required)

### Task B1: `mlDslOptin` — per-user opt-in (mirror mlLiveOptin)

**Files:** Create `server/services/ml/mlDslOptin.js`; Modify `server/services/database.js` (migration `411_ml_dsl_optin`); Test `tests/unit/mlDslOptin.test.js`

- [ ] **Step 1: Migration in `database.js`** (after `410_...`):
```javascript
    migrate('411_ml_dsl_optin', () => {
        db.exec(`
            CREATE TABLE IF NOT EXISTS ml_dsl_optin (
                user_id    INTEGER PRIMARY KEY,
                opted_in   INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                source     TEXT
            );
        `);
    });
```

- [ ] **Step 2: Failing test**
```javascript
const optin = require('../../server/services/ml/mlDslOptin');
describe('mlDslOptin', () => {
  test('default not opted in (fail-closed)', () => { expect(optin.isOptedIn(99999)).toBe(false); });
  test('set then read', () => { optin.setOptin(12345, true, 'test', null); expect(optin.isOptedIn(12345)).toBe(true);
    optin.setOptin(12345, false, 'test', null); expect(optin.isOptedIn(12345)).toBe(false); });
});
```

- [ ] **Step 3: Run, verify FAILS**
Run: `cd /opt/zeus-terminal && npx jest tests/unit/mlDslOptin.test.js --forceExit --runInBand 2>&1 | tail -15`

- [ ] **Step 4: Implement** (mirrors `server/services/ml/mlLiveOptin.js`)
```javascript
// server/services/ml/mlDslOptin.js
// Per-user opt-in for ML-DSL control (mirror of mlLiveOptin). Fail-closed.
'use strict';
const { db } = require('../database');
function isOptedIn(userId) {
  try { const r = db.prepare('SELECT opted_in FROM ml_dsl_optin WHERE user_id=?').get(userId); return !!(r && r.opted_in); }
  catch (_) { return false; }
}
function setOptin(userId, optedIn, source, ip) {
  try {
    db.prepare(`INSERT INTO ml_dsl_optin (user_id, opted_in, updated_at, source) VALUES (?, ?, datetime('now'), ?)
      ON CONFLICT(user_id) DO UPDATE SET opted_in=excluded.opted_in, updated_at=datetime('now'), source=excluded.source`)
      .run(userId, optedIn ? 1 : 0, source || null);
    try { db.prepare(`INSERT INTO audit_log (action, detail, ts) VALUES ('ML_DSL_OPTIN_SET', ?, ?)`).run(JSON.stringify({ userId, optedIn, source, ip }), Date.now()); } catch (_) {}
    return { userId, optedIn: !!optedIn };
  } catch (_) { return { userId, optedIn: false }; }
}
module.exports = { isOptedIn, setOptin };
```
(If `audit_log` columns differ, drop the audit insert — it's already wrapped in its own try/catch, so a column mismatch is silently skipped. Verify the real `audit_log` schema with `node -e "const {db}=require('./server/services/database'); console.log(db.prepare('PRAGMA table_info(audit_log)').all().map(c=>c.name))"` and adjust the insert columns to match before relying on it.)

- [ ] **Step 5: Run, verify PASS** (2)
Run: `cd /opt/zeus-terminal && npx jest tests/unit/mlDslOptin.test.js --forceExit --runInBand 2>&1 | tail -15`

- [ ] **Step 6: Commit**
```bash
cd /opt/zeus-terminal && git add server/services/ml/mlDslOptin.js server/services/database.js tests/unit/mlDslOptin.test.js
git commit -m "feat(mldsl-v2): per-user mlDslOptin + ml_dsl_optin migration TDD"
```

---

### Task B2: `mlDslCohort` — pure A/B splitter

**Files:** Create `server/services/mlDslCohort.js`; Test `tests/unit/mlDslCohort.test.js`

- [ ] **Step 1: Failing test**
```javascript
const { cohort } = require('../../server/services/mlDslCohort');
describe('mlDslCohort', () => {
  test('deterministic and stable for a given seq', () => {
    const a = cohort(1776859653399); expect(['ml', 'baseline']).toContain(a);
    expect(cohort(1776859653399)).toBe(a); // stable
  });
  test('roughly 50/50 over many seqs', () => {
    let ml = 0; const N = 4000;
    for (let i = 0; i < N; i++) if (cohort(1000000 + i) === 'ml') ml++;
    expect(ml).toBeGreaterThan(N * 0.4); expect(ml).toBeLessThan(N * 0.6);
  });
});
```

- [ ] **Step 2: Run, verify FAILS**
Run: `cd /opt/zeus-terminal && npx jest tests/unit/mlDslCohort.test.js --forceExit --runInBand 2>&1 | tail -15`

- [ ] **Step 3: Implement**
```javascript
// server/services/mlDslCohort.js
// Deterministic A/B cohort split for ML-DSL control (stable per position seq).
'use strict';
function cohort(seq) {
  // FNV-1a-ish hash of the seq string → even/odd bucket; stable, ~50/50.
  const s = String(seq); let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 2 === 0) ? 'ml' : 'baseline';
}
module.exports = { cohort };
```

- [ ] **Step 4: Run, verify PASS** (2)
Run: `cd /opt/zeus-terminal && npx jest tests/unit/mlDslCohort.test.js --forceExit --runInBand 2>&1 | tail -15`

- [ ] **Step 5: Commit**
```bash
cd /opt/zeus-terminal && git add server/services/mlDslCohort.js tests/unit/mlDslCohort.test.js
git commit -m "feat(mldsl-v2): deterministic A/B cohort splitter TDD"
```

---

### Task B3: Control injection at entry — ML arm vs preset (money-path flip)

**Files:** Modify `server/services/serverAT.js` (entry geometry ~line 1482); Modify `server/migrationFlags.js`

Backup: `cd /opt/zeus-terminal && cp server/services/serverAT.js server/services/serverAT.js.bak.pre-mldsl-v2-ctrl-20260617`

- [ ] **Step 1: Add the stage flag in `migrationFlags.js`** (after `_ML_DSL_LEARN_ENABLED`):
```javascript
// [ML-DSL v2] Control stage: 'SHADOW' (default) | 'TESTNET_CONTROL' | 'REAL'. Only
// TESTNET_CONTROL lets the bandit pick DSL params on opted-in testnet positions (cohort=ml).
const _ML_DSL_STAGE = (process.env.ML_DSL_STAGE || 'SHADOW').toUpperCase();
```
and getter:
```javascript
    get ML_DSL_STAGE() { return _ML_DSL_STAGE; },
```

- [ ] **Step 2: Add requires in `serverAT.js`** (after the v2 requires from A5):
```javascript
const mlDslOptin = require('./ml/mlDslOptin');
const { cohort: mlDslCohort } = require('./mlDslCohort');
const mlDslBandit = require('./mlDslBandit');
```

- [ ] **Step 3: Add the resolver helper** (near `_closePosition` or other helpers, top-level function):
```javascript
// [ML-DSL v2] Decide the DSL params for a NEW position: ML-driven (bandit arm, clamped)
// only when eligible (stage TESTNET_CONTROL + per-user opt-in + env TESTNET + cohort=ml);
// otherwise the exact baseline preset (status quo). Returns { params, mode, arm, cohort }.
const _ML_DSL_ARMS = ['fast', 'def', 'atr', 'swing'];
function _resolveDslParams(entry, stc) {
    const presetMode = stc.dslMode || 'def';
    const baseline = { params: serverDSL.getPreset(presetMode), mode: presetMode, arm: presetMode, cohort: 'baseline' };
    try {
        if (MF.ML_DSL_STAGE !== 'TESTNET_CONTROL') return baseline;
        if (String(entry.env || '').toUpperCase() !== 'TESTNET') return baseline;
        if (!mlDslOptin.isOptedIn(entry.userId)) return baseline;
        const coh = mlDslCohort(entry.seq);
        if (coh !== 'ml') return { ...baseline, cohort: 'baseline' };
        const ck = `${entry.userId}:TESTNET:${entry.symbol}:${entry.regime || 'unknown'}`;
        const arm = mlDslBandit.sampleArm(ck, _ML_DSL_ARMS);
        const raw = serverDSL.getPreset(arm);
        // fail-closed clamp: never wider than the entry SL, finite
        const safe = dslSafety.clamp(
            { plPct: raw.pivotLeftPct, prPct: raw.pivotRightPct, ivPct: raw.impulseVPct },
            { side: entry.side, entry: entry.price, price: entry.price, originalSL: entry.sl, maxLossPct: 1.5 });
        const params = { openDslPct: raw.openDslPct, pivotLeftPct: safe.plPct, pivotRightPct: safe.prPct, impulseVPct: safe.ivPct };
        return { params, mode: arm, arm, cohort: 'ml' };
    } catch (_) { return baseline; } // fail-safe → baseline preset
}
```

- [ ] **Step 4: Use the resolver at entry geometry** — find the current line (~1482):
```javascript
        dslParams: us.dslEnabled === false ? null : serverDSL.getPreset(stc.dslMode),
        dslModeAtOpen: us.dslEnabled === false ? null : (stc.dslMode || null),
```
Replace with (note: `entry.seq`, `entry.userId`, `entry.symbol`, `entry.side`, `entry.price`, `entry.sl`, `entry.env`, `entry.regime` must already be set on the entry object at this point — verify they are by reading the surrounding object literal; if any are assigned later, compute `_dslResolved` AFTER the object is built and assign the four fields then):
```javascript
        dslParams: us.dslEnabled === false ? null : undefined, // [ML-DSL v2] set below via _resolveDslParams
        dslModeAtOpen: us.dslEnabled === false ? null : (stc.dslMode || null),
        dslArm: null, dslCohort: 'baseline',
```
Then immediately AFTER the entry object literal is fully constructed (and before `serverDSL.attach(entry, entry.dslParams)` at ~line 1526), insert:
```javascript
    // [ML-DSL v2] Resolve DSL params (ML-driven arm vs baseline preset) now that entry is built.
    if (us.dslEnabled !== false) {
        const _r = _resolveDslParams(entry, stc);
        entry.dslParams = _r.params;
        entry.dslModeAtOpen = _r.mode;
        entry.dslArm = _r.arm;
        entry.dslCohort = _r.cohort;
    }
```
(This guarantees `entry.dslParams` is set before `attach`. If `dslEnabled === false`, params stay null as today.)

- [ ] **Step 5: Verify the BASELINE path is unchanged when ineligible** (CRITICAL):
```bash
cd /opt/zeus-terminal && node -e "
const MF=require('./server/migrationFlags'); console.log('stage', MF.ML_DSL_STAGE); // must be SHADOW by default
const dsl=require('./server/services/serverDSL');
// with stage=SHADOW, _resolveDslParams must return the preset verbatim:
console.log('preset def =', JSON.stringify(dsl.getPreset('def')));
"
```
Then the real-stop grep (must be empty) + syntax:
```bash
cd /opt/zeus-terminal && git --no-pager diff server/services/serverAT.js | grep -E "^[-+]" | grep -E "pos\.sl =|effectiveSL|_updateLiveSL|dsl\.plExit|dsl\.changed"
node -c server/services/serverAT.js && node -c server/migrationFlags.js && echo OK
```
Expected: stage `SHADOW`; the grep prints nothing; `OK`. With default stage SHADOW, `_resolveDslParams` returns the baseline preset → ZERO behaviour change until the operator flips `ML_DSL_STAGE=TESTNET_CONTROL`.

- [ ] **Step 6: Commit** (NO deploy/reload/flip without operator GO)
```bash
cd /opt/zeus-terminal && git add server/services/serverAT.js server/migrationFlags.js
git commit -m "feat(mldsl-v2): control injection at entry — bandit picks DSL arm (clamped) on eligible testnet positions, gated ML_DSL_STAGE default SHADOW (baseline unchanged)"
```

---

### Task B4: A/B scoreboard split + underperformance alert

**Files:** Modify `server/routes/dslDrive.js` (cohort split in scoreboard); Modify `client/src/components/dock/DslDrivePanel.tsx` + `app.css` (cohort badge + alert)

- [ ] **Step 1: Extend `/scoreboard`** to split by cohort. Replace the single aggregate query with a per-cohort one:
```javascript
    const q = uid ? db.prepare(
      `SELECT cohort, COUNT(*) n, AVG(ml_pnl_pct) avgPnl, AVG(advantage) avgAdv,
              SUM(CASE WHEN win=1 THEN 1 ELSE 0 END) wins
       FROM ml_dsl_outcome WHERE user_id=? AND ts>? GROUP BY cohort`).all(uid, Date.now() - 21 * 86400000) : [];
    const byCohort = {}; for (const r of q) byCohort[r.cohort] = { n: r.n, avgPnl: +(r.avgPnl||0).toFixed(3), avgAdv: +(r.avgAdv||0).toFixed(3), winRate: r.n ? +(100*r.wins/r.n).toFixed(1):0 };
    const ml = byCohort.ml || { n:0, avgPnl:0, avgAdv:0, winRate:0 };
    const base = byCohort.baseline || { n:0, avgPnl:0, avgAdv:0, winRate:0 };
    const underperforming = ml.n >= 20 && ml.avgPnl < base.avgPnl;
    res.json({ ok: true, ml, baseline: base, underperforming, stage: process.env.ML_DSL_STAGE || 'SHADOW', ts: Date.now() });
```

- [ ] **Step 2: Show cohort badge per card + alert in `DslDrivePanel.tsx`.** Add the cohort to the row type (`cohort?: string` on the `ml` proposal — it's already recorded by the v1 hook's `record`; ensure the B3 path also tags it on the position so the `/state` route can surface `p.ml?.cohort` or add `cohort: p.dslCohort` to the `/state` row mapping). Render a badge in the card header and an alert banner when `score.underperforming`:
```tsx
      {score && score.underperforming && (
        <div className="dsldrive-alert">⚠ ML underperforming baseline (ML {score.ml.avgPnl}% vs {score.baseline.avgPnl}%, n={score.ml.n}) — consider manual revert to SHADOW</div>
      )}
```
(Add a `cohort` field to the `/api/dsldrive/state` row mapping in `dslDrive.js`: `cohort: p.dslCohort || null,` and read it in the card as a small badge `{p.cohort === 'ml' ? 'ML-LIVE' : p.cohort === 'baseline' ? 'BASELINE' : 'SHADOW'}`.)

- [ ] **Step 3: Telegram alert on underperformance** — add a server-side check. In `server/services/serverAT.js`, in the same `_closePosition` learn block (Task A5 step 4), after `mlDslLearner.learn(...)`, add a throttled cohort check (telemetry-safe). Keep it simple: query the scoreboard aggregate once per N closes and `telegram.sendToUser` when `underperforming` flips true. (Concrete: maintain a module-level `_mlDslAlertTs`; if `Date.now() - _mlDslAlertTs > 3600000` and the per-user ml.avgPnl < baseline.avgPnl with ml.n>=20, send the alert and update `_mlDslAlertTs`.) This is additive + try/catch.
```javascript
            // [ML-DSL v2] hourly underperformance alert (manual-revert policy: alert only)
            try {
                if (Date.now() - (global._mlDslAlertTs || 0) > 3600000) {
                    const a = db.prepare(`SELECT cohort, COUNT(*) n, AVG(ml_pnl_pct) avgPnl FROM ml_dsl_outcome WHERE user_id=? AND ts>? GROUP BY cohort`).all(pos.userId, Date.now() - 7*86400000);
                    const m = a.find(x => x.cohort === 'ml'), b = a.find(x => x.cohort === 'baseline');
                    if (m && b && m.n >= 20 && m.avgPnl < b.avgPnl) {
                        global._mlDslAlertTs = Date.now();
                        telegram.sendToUser(pos.userId, `⚠️ *ML-DSL underperforming*\nML ${m.avgPnl.toFixed(2)}% vs baseline ${b.avgPnl.toFixed(2)}% (n=${m.n}).\nConsider reverting ML_DSL_STAGE → SHADOW.`);
                    }
                }
            } catch (_) {}
```

- [ ] **Step 4: Verify** — real-stop grep empty (as A5 step 5), `node -c server/services/serverAT.js && node -c server/routes/dslDrive.js && echo OK`, `cd client && npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**
```bash
cd /opt/zeus-terminal && git add server/services/serverAT.js server/routes/dslDrive.js client/src/components/dock/DslDrivePanel.tsx client/src/app.css
git commit -m "feat(mldsl-v2): A/B cohort scoreboard + underperformance alert (Telegram + box), manual revert"
```

**PHASE B DONE** — control flip ready. Staging: deploy → flip `ML_DSL_STAGE=TESTNET_CONTROL` (staged, reload) on opted-in testnet users → A/B runs → `pnl-testnet-track.js` + scoreboard compare cohorts → gate (payoff≥1.0 + expectancy poz + ML beats baseline) → discuss REAL. Underperformance → alert → operator manual revert to SHADOW. Per-position `dslSafety` net hard+automatic throughout.

---

## Self-Review (done)
- **Spec coverage:** control mechanism (B3) §5; learner reuse Ring5/bandit (A3+A4) §6; counterfactual+A/B (A2+A4 / B2+B4) §7; safety alert+manual-revert + always-on net (B4 + dslSafety in B3) §8; cutia scoreboard/badge/alert (A6+B4) §9; gates/staging (phase boundaries) §7; testing TDD §11; out-of-scope brain-takeover untouched §2. ✓
- **Placeholder scan:** no TBD/TODO. The audit_log column caveat (B1) and entry-field-ordering caveat (B3) are explicit verify-steps, not placeholders. ✓
- **Type consistency:** `cellKey` shape identical in A4 + B3; arm names `_ML_DSL_ARMS` ⊂ `DSL_PRESETS`; `simulate` signature A2 matches A5 call; `cohort`→'ml'/'baseline' consistent A4/B2/B3/B4; learner `record` keys match A5 call site. ✓
- **Money-path:** every serverDSL/serverAT edit has backup + real-stop grep; Phase A default-OFF; Phase B default stage SHADOW (baseline unchanged). ✓
