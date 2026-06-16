# OMEGA Waves 4-8 — Completion Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all remaining work from the original ML v3 8-wave roadmap (2026-05-14 acceptance), then run multi-day soak validation.

**Architecture:** Additive-first ordering — net-new modules (R3B Conformal, R1 Constitution, R7 Audit) before touching hot paths (R4 Exposure unified). UX polish last (zero risk to brain). Each wave is independently shippable with own commit/tag; operator can stop between waves.

**Tech Stack:** Node.js, better-sqlite3, jest --forceExit, Express, React/Vite/TypeScript (UI bits).

**Branch:** `omega/wave-1-foundation` (current). **Backup convention:** `.bak.pre-wave<N>-20260518` per edited file.

---

## Execution Order (operator can stop between waves)

| # | Wave | Subsystem | Risk | Effort |
|---|---|---|---|---|
| 1 | Wave 4 delta | R3B Conformal/OOD detection | low (additive ML module) | ~3-4h |
| 2 | Wave 5 delta | R1 Constitution enforcement engine | low (wraps decisions) | ~2-3h |
| 3 | Wave 7 delta a | R7 inter-ring communication audit | low (observability) | ~2h |
| 4 | Wave 7 delta b | Unified Audit Trail (chained hash) | low (additive layer) | ~3h |
| 5 | Wave 6 delta | Exposure manager unified + exactly-once | **medium** (hot path) | ~3-4h |
| 6 | Wave 8 polish | DD gauge + confidence display + greetings + report card | low (UI) | ~3-4h |
| 7 | Soak | 7-day live observation + verdict | n/a | passive |

**Discipline preserved throughout:**
- TDD strict — failing test FIRST, then implementation
- Backup before any hot-path edit
- Per-task commit + push + PM2 reload
- After each wave: tag (`omega-wave<N>-delta-COMPLETE-YYYYMMDD-HHMMSS`)
- Phase 2 fusion math UNTOUCHED (Day 32+ contract)
- Operator's LLM safety stance preserved (no reintroduction of "no advice" guard)

---

## WAVE 4 DELTA — R3B Conformal Prediction + OOD Detection

### Architecture

R3B = Brain Safety layer. Current Zeus has confluence + regime + reflection gate, but lacks:
- **Conformal Prediction intervals** — given a decision confidence, output statistically-valid prediction interval (e.g., "95% confidence price moves ±2.3% over next 4h based on regime+volatility")
- **Out-Of-Distribution detection** — flag when current feature snapshot is unlike training distribution (e.g., regime never seen, volatility outlier, indicator combo unprecedented)

Both are pure additive observability — they don't BLOCK trades, just attach validity metadata to decisions. Brain consumer can later gate on OOD score > threshold.

### File structure

| File | Responsibility |
|---|---|
| `server/services/ml/R3B_safety/conformalPrediction.js` | Split CP intervals on regime+confidence, returns {lower, upper, validity}. Stateful: maintains calibration buffer of last N=200 outcomes per regime. |
| `server/services/ml/R3B_safety/oodDetector.js` | Mahalanobis distance + feature-bin histograms. Returns {score 0-1, isOOD, novelFeatures}. Trained on last 1000 brain snapshots. |
| `server/services/ml/R3B_safety/index.js` | Public surface — `evaluate(snapshot)` → `{cp, ood}` |
| `tests/unit/r3bConformal.test.js` | CP coverage tests (target 90-95% empirical) |
| `tests/unit/r3bOOD.test.js` | OOD detection on synthetic outliers |
| Migration `375_ml_r3b_calibration_buffer` | Persisted CP residuals + OOD histograms |

### Task 4.1: Migration `375_ml_r3b_calibration_buffer`

**Files:**
- Modify: `server/services/database.js` (append migration at end, before user methods)
- Test: `tests/unit/r3bMigration.test.js` (new)

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r3b-mig-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
const { db } = require('../../server/services/database');

describe('migration 375_ml_r3b_calibration_buffer', () => {
    test('table ml_r3b_calibration exists with required columns', () => {
        const cols = db.prepare("PRAGMA table_info(ml_r3b_calibration)").all().map(r => r.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'regime', 'confidence_bucket', 'residual', 'outcome', 'ts'
        ]));
    });
    test('table ml_r3b_ood_histogram exists', () => {
        const cols = db.prepare("PRAGMA table_info(ml_r3b_ood_histogram)").all().map(r => r.name);
        expect(cols).toEqual(expect.arrayContaining([
            'feature_name', 'bin_id', 'count', 'updated_at'
        ]));
    });
    test('index on regime+ts for calibration buffer', () => {
        const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='ml_r3b_calibration'").all();
        expect(idx.some(r => r.name.includes('regime'))).toBe(true);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/zeus-terminal && npx jest tests/unit/r3bMigration.test.js --forceExit`
Expected: FAIL with "no such table: ml_r3b_calibration"

- [ ] **Step 3: Add migration**

Append in `server/services/database.js` after migration 374:

```js
// [Wave 4] R3B Safety — calibration buffer for Conformal Prediction +
// OOD detection feature histograms. Buffer keeps last N residuals per
// (regime, confidence_bucket); OOD histogram tracks feature bin counts.
migrate('375_ml_r3b_calibration_buffer', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_r3b_calibration (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            regime            TEXT NOT NULL,
            confidence_bucket INTEGER NOT NULL,
            residual          REAL NOT NULL,
            outcome           REAL NOT NULL,
            ts                INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
        );
        CREATE INDEX IF NOT EXISTS idx_r3b_calib_regime_ts
            ON ml_r3b_calibration(regime, ts);
        CREATE TABLE IF NOT EXISTS ml_r3b_ood_histogram (
            feature_name TEXT NOT NULL,
            bin_id       INTEGER NOT NULL,
            count        INTEGER NOT NULL DEFAULT 0,
            updated_at   INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
            PRIMARY KEY (feature_name, bin_id)
        );
    `);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /root/zeus-terminal && npx jest tests/unit/r3bMigration.test.js --forceExit`
Expected: PASS 3/3

- [ ] **Step 5: Commit**

```bash
git add server/services/database.js tests/unit/r3bMigration.test.js
git commit -m "feat(r3b): migration 375 — calibration buffer + OOD histogram"
```

### Task 4.2: `conformalPrediction.js` — split CP intervals

**Files:**
- Create: `server/services/ml/R3B_safety/conformalPrediction.js`
- Test: `tests/unit/conformalPrediction.test.js` (new)

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r3b-cp-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
const { db } = require('../../server/services/database');
const cp = require('../../server/services/ml/R3B_safety/conformalPrediction');

function seedResidual(regime, conf, residual, outcome) {
    db.prepare(`INSERT INTO ml_r3b_calibration (regime, confidence_bucket, residual, outcome, ts) VALUES (?, ?, ?, ?, ?)`)
       .run(regime, conf, residual, outcome, Date.now());
}

describe('conformalPrediction', () => {
    beforeEach(() => db.prepare("DELETE FROM ml_r3b_calibration").run());

    test('cold start (< 30 samples) returns wide default interval', () => {
        const r = cp.predictInterval({ regime: 'TREND', confidence: 75, predicted: 0.8 });
        expect(r.coldStart).toBe(true);
        expect(r.upper - r.lower).toBeGreaterThan(0.3); // wide
    });

    test('with 100 calibration samples returns tight interval', () => {
        for (let i = 0; i < 100; i++) {
            seedResidual('TREND', 7, (Math.random() - 0.5) * 0.04, Math.random()); // ±2% residuals
        }
        const r = cp.predictInterval({ regime: 'TREND', confidence: 75, predicted: 0.8 });
        expect(r.coldStart).toBe(false);
        expect(r.upper - r.lower).toBeLessThan(0.1); // tight
        expect(r.lower).toBeLessThan(0.8);
        expect(r.upper).toBeGreaterThan(0.8);
    });

    test('recordOutcome appends to calibration buffer', () => {
        cp.recordOutcome({ regime: 'RANGE', confidence: 60, predicted: 0.5, actual: 0.52 });
        const rows = db.prepare("SELECT * FROM ml_r3b_calibration").all();
        expect(rows.length).toBe(1);
        expect(rows[0].regime).toBe('RANGE');
        expect(Math.abs(rows[0].residual - 0.02)).toBeLessThan(0.001);
    });

    test('buffer caps at MAX_PER_BUCKET (200) per regime', () => {
        for (let i = 0; i < 250; i++) cp.recordOutcome({ regime: 'TREND', confidence: 70, predicted: 0.5, actual: 0.5 });
        const count = db.prepare("SELECT COUNT(*) AS n FROM ml_r3b_calibration WHERE regime='TREND'").get().n;
        expect(count).toBeLessThanOrEqual(200);
    });

    test('different regimes have isolated buffers', () => {
        for (let i = 0; i < 50; i++) seedResidual('TREND', 7, 0.01, 0.5);
        for (let i = 0; i < 50; i++) seedResidual('RANGE', 5, 0.05, 0.5);
        const trendInterval = cp.predictInterval({ regime: 'TREND', confidence: 70, predicted: 0.8 });
        const rangeInterval = cp.predictInterval({ regime: 'RANGE', confidence: 50, predicted: 0.8 });
        // Range has wider residuals → wider interval
        expect(rangeInterval.upper - rangeInterval.lower).toBeGreaterThan(trendInterval.upper - trendInterval.lower);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/zeus-terminal && npx jest tests/unit/conformalPrediction.test.js --forceExit`
Expected: FAIL with "Cannot find module .../R3B_safety/conformalPrediction"

- [ ] **Step 3: Implement `conformalPrediction.js`**

```js
'use strict';

// [Wave 4] Conformal Prediction split CP — given regime + confidence, returns
// statistically valid prediction interval at target coverage (90%).
//
// Method: Split conformal — per-regime calibration buffer holds last N residuals
// (actual - predicted). Interval = predicted ± quantile_{1-α}(|residuals|).
// Cold start (< MIN_SAMPLES): wide default interval ±0.20 (50% of [0,1] range).
// Buffer capped at MAX_PER_BUCKET via FIFO eviction (oldest deleted on overflow).

const { db } = require('../../database');

const TARGET_ALPHA = 0.1;        // 90% coverage
const MIN_SAMPLES = 30;          // below this → cold start
const MAX_PER_BUCKET = 200;      // buffer cap per regime
const DEFAULT_HALF_WIDTH = 0.20; // cold-start fallback

function _bucketConfidence(c) {
    // Bucket confidence into 0-9 (10 buckets of width 10).
    return Math.max(0, Math.min(9, Math.floor((c || 0) / 10)));
}

function _quantile(sortedAbsResiduals, alpha) {
    if (sortedAbsResiduals.length === 0) return DEFAULT_HALF_WIDTH;
    const idx = Math.ceil((1 - alpha) * (sortedAbsResiduals.length + 1)) - 1;
    return sortedAbsResiduals[Math.max(0, Math.min(idx, sortedAbsResiduals.length - 1))];
}

function predictInterval({ regime, confidence, predicted }) {
    const rows = db.prepare(
        `SELECT residual FROM ml_r3b_calibration WHERE regime = ? ORDER BY ts DESC LIMIT ?`
    ).all(regime, MAX_PER_BUCKET);

    if (rows.length < MIN_SAMPLES) {
        return {
            lower: Math.max(0, predicted - DEFAULT_HALF_WIDTH),
            upper: Math.min(1, predicted + DEFAULT_HALF_WIDTH),
            halfWidth: DEFAULT_HALF_WIDTH,
            sampleSize: rows.length,
            coldStart: true,
            validity: 'cold_start',
        };
    }

    const abs = rows.map(r => Math.abs(r.residual)).sort((a, b) => a - b);
    const halfWidth = _quantile(abs, TARGET_ALPHA);
    return {
        lower: Math.max(0, predicted - halfWidth),
        upper: Math.min(1, predicted + halfWidth),
        halfWidth,
        sampleSize: rows.length,
        coldStart: false,
        validity: 'cp_split',
    };
}

function recordOutcome({ regime, confidence, predicted, actual }) {
    const residual = (actual || 0) - (predicted || 0);
    const bucket = _bucketConfidence(confidence);
    db.prepare(
        `INSERT INTO ml_r3b_calibration (regime, confidence_bucket, residual, outcome, ts) VALUES (?, ?, ?, ?, ?)`
    ).run(regime, bucket, residual, actual || 0, Date.now());

    // FIFO eviction
    const count = db.prepare(
        `SELECT COUNT(*) AS n FROM ml_r3b_calibration WHERE regime = ?`
    ).get(regime).n;
    if (count > MAX_PER_BUCKET) {
        db.prepare(
            `DELETE FROM ml_r3b_calibration WHERE id IN (
                SELECT id FROM ml_r3b_calibration WHERE regime = ? ORDER BY ts ASC LIMIT ?
            )`
        ).run(regime, count - MAX_PER_BUCKET);
    }
}

module.exports = { predictInterval, recordOutcome };
```

- [ ] **Step 4: Run test to verify all pass**

Run: `cd /root/zeus-terminal && npx jest tests/unit/conformalPrediction.test.js --forceExit`
Expected: PASS 5/5

- [ ] **Step 5: Commit**

```bash
git add server/services/ml/R3B_safety/conformalPrediction.js tests/unit/conformalPrediction.test.js
git commit -m "feat(r3b): conformal prediction split CP intervals per regime"
```

### Task 4.3: `oodDetector.js` — Out-Of-Distribution detection

**Files:**
- Create: `server/services/ml/R3B_safety/oodDetector.js`
- Test: `tests/unit/oodDetector.test.js`

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r3b-ood-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
const { db } = require('../../server/services/database');
const ood = require('../../server/services/ml/R3B_safety/oodDetector');

describe('oodDetector', () => {
    beforeEach(() => db.prepare("DELETE FROM ml_r3b_ood_histogram").run());

    test('cold start returns isOOD=false with low score', () => {
        const r = ood.score({ rsi: 50, adx: 25, confidence: 70 });
        expect(r.isOOD).toBe(false);
        expect(r.coldStart).toBe(true);
    });

    test('after observing 100 in-distribution samples, similar input scores low', () => {
        // Seed histogram with samples around rsi=50, adx=25, conf=70
        for (let i = 0; i < 100; i++) {
            ood.observe({
                rsi: 50 + (Math.random() - 0.5) * 10,
                adx: 25 + (Math.random() - 0.5) * 5,
                confidence: 70 + (Math.random() - 0.5) * 5,
            });
        }
        const r = ood.score({ rsi: 52, adx: 24, confidence: 69 });
        expect(r.isOOD).toBe(false);
        expect(r.score).toBeLessThan(0.5);
    });

    test('outlier scores high after baseline learned', () => {
        for (let i = 0; i < 100; i++) {
            ood.observe({ rsi: 50, adx: 25, confidence: 70 });
        }
        const r = ood.score({ rsi: 95, adx: 80, confidence: 95 });
        expect(r.isOOD).toBe(true);
        expect(r.score).toBeGreaterThan(0.7);
    });

    test('novel feature flagged when never observed', () => {
        ood.observe({ rsi: 50, adx: 25, confidence: 70 });
        const r = ood.score({ rsi: 50, adx: 25, confidence: 70, freshFeature: 0.99 });
        expect(r.novelFeatures).toContain('freshFeature');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/zeus-terminal && npx jest tests/unit/oodDetector.test.js --forceExit`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement `oodDetector.js`**

```js
'use strict';

// [Wave 4] OOD Detector — feature-bin histograms per known feature. Each
// numeric feature bucketed into N=20 bins. Score = product of per-feature
// rarity (1 - p_bin/p_max). Cold start (< MIN_OBS observations) returns
// score=0, isOOD=false. Novel features (never observed) flagged separately.

const { db } = require('../../database');

const BIN_COUNT = 20;
const MIN_OBS = 50;
const OOD_THRESHOLD = 0.6;
const FEATURE_RANGES = {
    rsi: [0, 100],
    adx: [0, 100],
    confidence: [0, 100],
    atr: [0, 1000],
    score: [0, 100],
};

function _bin(featureName, value) {
    const range = FEATURE_RANGES[featureName] || [0, 100];
    const [lo, hi] = range;
    const clamped = Math.max(lo, Math.min(hi, value));
    const norm = (clamped - lo) / (hi - lo);
    return Math.max(0, Math.min(BIN_COUNT - 1, Math.floor(norm * BIN_COUNT)));
}

function observe(features) {
    for (const [name, value] of Object.entries(features || {})) {
        if (typeof value !== 'number' || !isFinite(value)) continue;
        const bin = _bin(name, value);
        db.prepare(
            `INSERT INTO ml_r3b_ood_histogram (feature_name, bin_id, count, updated_at) VALUES (?, ?, 1, ?)
             ON CONFLICT(feature_name, bin_id) DO UPDATE SET count = count + 1, updated_at = excluded.updated_at`
        ).run(name, bin, Date.now());
    }
}

function score(features) {
    const totalObs = db.prepare(
        `SELECT SUM(count) AS n FROM ml_r3b_ood_histogram`
    ).get().n || 0;

    if (totalObs < MIN_OBS) {
        return { score: 0, isOOD: false, coldStart: true, novelFeatures: [], samples: totalObs };
    }

    const novelFeatures = [];
    const rarityScores = [];

    for (const [name, value] of Object.entries(features || {})) {
        if (typeof value !== 'number' || !isFinite(value)) continue;
        const known = db.prepare(
            `SELECT COUNT(*) AS n FROM ml_r3b_ood_histogram WHERE feature_name = ?`
        ).get(name).n;
        if (known === 0) {
            novelFeatures.push(name);
            rarityScores.push(1.0);
            continue;
        }
        const bin = _bin(name, value);
        const binCount = db.prepare(
            `SELECT count FROM ml_r3b_ood_histogram WHERE feature_name = ? AND bin_id = ?`
        ).get(name, bin);
        const maxCount = db.prepare(
            `SELECT MAX(count) AS m FROM ml_r3b_ood_histogram WHERE feature_name = ?`
        ).get(name).m || 1;
        const pBin = (binCount ? binCount.count : 0) / maxCount;
        rarityScores.push(1 - pBin);
    }

    const avgRarity = rarityScores.length > 0
        ? rarityScores.reduce((a, b) => a + b, 0) / rarityScores.length
        : 0;

    return {
        score: avgRarity,
        isOOD: avgRarity > OOD_THRESHOLD || novelFeatures.length > 0,
        coldStart: false,
        novelFeatures,
        samples: totalObs,
    };
}

module.exports = { observe, score };
```

- [ ] **Step 4: Run test to verify all pass**

Run: `cd /root/zeus-terminal && npx jest tests/unit/oodDetector.test.js --forceExit`
Expected: PASS 4/4

- [ ] **Step 5: Commit**

```bash
git add server/services/ml/R3B_safety/oodDetector.js tests/unit/oodDetector.test.js
git commit -m "feat(r3b): OOD detector via feature-bin rarity histograms"
```

### Task 4.4: `R3B_safety/index.js` public surface + wire into serverBrain

**Files:**
- Create: `server/services/ml/R3B_safety/index.js`
- Modify: `server/services/serverBrain.js` (add R3B evaluate after fusion, NO blocking)
- Test: `tests/unit/r3bIndex.test.js`

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r3b-idx-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
const r3b = require('../../server/services/ml/R3B_safety');

describe('R3B_safety index', () => {
    test('evaluate returns { cp, ood } shape', () => {
        const r = r3b.evaluate({
            regime: 'TREND', confidence: 70, predicted: 0.8,
            features: { rsi: 60, adx: 30 },
        });
        expect(r.cp).toBeDefined();
        expect(r.cp.lower).toBeLessThanOrEqual(0.8);
        expect(r.cp.upper).toBeGreaterThanOrEqual(0.8);
        expect(r.ood).toBeDefined();
        expect(typeof r.ood.score).toBe('number');
    });

    test('observeOutcome dispatches to both CP + OOD', () => {
        // No exception thrown — both calls succeed
        r3b.observeOutcome({
            regime: 'RANGE', confidence: 50, predicted: 0.5, actual: 0.55,
            features: { rsi: 50, adx: 20 },
        });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/zeus-terminal && npx jest tests/unit/r3bIndex.test.js --forceExit`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement `index.js`**

```js
'use strict';

const cp = require('./conformalPrediction');
const ood = require('./oodDetector');

function evaluate({ regime, confidence, predicted, features }) {
    return {
        cp: cp.predictInterval({ regime, confidence, predicted }),
        ood: ood.score(features || {}),
    };
}

function observeOutcome({ regime, confidence, predicted, actual, features }) {
    cp.recordOutcome({ regime, confidence, predicted, actual });
    ood.observe(features || {});
}

module.exports = { evaluate, observeOutcome };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /root/zeus-terminal && npx jest tests/unit/r3bIndex.test.js --forceExit`
Expected: PASS 2/2

- [ ] **Step 5: Wire into serverBrain (observability only, no blocking)**

In `server/services/serverBrain.js`, after fusion compute (around line 1700-1800 where snapshot is built), add:

```js
// [Wave 4] R3B Safety — additive observability. cp = prediction interval
// for confidence; ood = distribution rarity score. NOT blocking — attached
// to brain snapshot for downstream consumers (Doctor / audit / UI).
try {
    const r3b = require('./ml/R3B_safety');
    const r3bResult = r3b.evaluate({
        regime: regime.regime,
        confidence: fusion.confidence,
        predicted: (fusion.confidence || 0) / 100,
        features: { rsi: ind.rsi, adx: ind.adx, atr: ind.atr, score: confluence.score, confidence: fusion.confidence },
    });
    fusion._r3b = r3bResult;
    // Feed OOD observations on every cycle so distribution stays current
    r3b.observeOutcome({
        regime: regime.regime, confidence: fusion.confidence,
        predicted: (fusion.confidence || 0) / 100, actual: (fusion.confidence || 0) / 100,
        features: { rsi: ind.rsi, adx: ind.adx, atr: ind.atr, score: confluence.score, confidence: fusion.confidence },
    });
} catch (_) { /* never block brain flow */ }
```

(Exact line will be determined when editing — find appropriate spot after `_calcFusion` returns.)

- [ ] **Step 6: Run full regression**

Run: `cd /root/zeus-terminal && npx jest --forceExit`
Expected: PASS, +4 tests vs baseline (R3B mig + cp + ood + idx).

- [ ] **Step 7: Commit + push + reload + tag**

```bash
git add server/services/ml/R3B_safety/index.js server/services/serverBrain.js tests/unit/r3bIndex.test.js
git commit -m "feat(r3b): index facade + wire into serverBrain (observability)"
git push origin omega/wave-1-foundation
pm2 reload zeus --update-env
git tag omega-wave4-r3b-COMPLETE-$(date +%Y%m%d-%H%M%S)
git push origin --tags
```

---

## WAVE 5 DELTA — R1 Constitution Enforcement Engine

### Architecture

R1 = Constitution layer. Per canonical §10 supremePrinciple + §227-§241 capstone, brain has *principles* but no centralized enforcement. Operator wants: every brain decision passes through a Constitution checker that validates against locked principles (NO market manipulation hints, NO insider claims, NO position sizing > X% balance, NO leverage > Y, etc.). If violated → DECISION BLOCKED + audit trail logged.

This wraps brain fusion output WITHOUT touching fusion math.

### File structure

| File | Responsibility |
|---|---|
| `server/services/ml/R1_constitution/principles.js` | Locked principle definitions (5-7 hard rules) |
| `server/services/ml/R1_constitution/enforcementEngine.js` | `evaluate(decision)` → `{allowed, violatedPrinciples}` |
| `tests/unit/r1Enforcement.test.js` | Per-principle pass/fail cases |
| Migration `376_ml_r1_violations` | Audit table for blocked decisions |

### Task 5.1: Migration + principles module

(Detailed steps will mirror Wave 4 pattern: failing test → migration → impl → tests → commit. ~6 tasks total in Wave 5.)

**Principles to encode (hard rules):**

1. **MAX_POSITION_SIZE_PCT** — position size ≤ 25% of demoBalance/liveBalance
2. **MAX_LEVERAGE** — leverage ≤ 25x (configurable per env DEMO/TESTNET/REAL)
3. **NO_REVENGE_TRADE** — after 3 consecutive losses, mandatory 30min cooldown before next entry
4. **NO_OPPOSITE_ENTRY_ON_OPEN** — can't open SHORT if LONG on same symbol still open (use close/reverse explicitly)
5. **MAX_CORRELATED_EXPOSURE** — sum exposure on correlated assets (corr ≥ 80%) ≤ 50% balance
6. **MIN_REFLECTION_CONFIDENCE** — reflection gate must not be in 'concerns' state for entry
7. **NO_LIVE_WITHOUT_SL** — every live order must have SL set (deterministic risk)

### Task 5.2: Wire enforcement engine into serverBrain decision path

After fusion, before `_executeLiveEntry`/`registerManualPosition`, call `r1.evaluate(decision)`. If `!allowed`, block + emit Doctor P1 alert + log to `ml_r1_violations`. Operator override path documented but requires explicit flag.

### Task 5.3: Public route `/api/omega/constitution/violations` for UI visibility

GET endpoint returning last 50 violations. Used by future "Constitution" tab in OmegaPage.

(Full task breakdown deferred until Wave 4 ships — write deeper detail post-checkpoint.)

---

## WAVE 7 DELTA a — R7 Inter-Ring Communication Audit

### Architecture

R7 in original spec = explicit observability of ring-to-ring messaging. Currently rings call each other directly (`serverBrain → serverReflection → serverCorrelationGuard → ...`). No central log of "which ring called which, with what input/output."

Add: lightweight wrapper that observability-only records ring-to-ring calls without touching call semantics.

### File structure

| File | Responsibility |
|---|---|
| `server/services/ml/R7_meta/interRingTracer.js` | `wrap(moduleName, methodName, fn)` → instrumented fn |
| Migration `377_ml_inter_ring_trace` | rolling log of ring calls |
| Route `/api/omega/inter-ring/recent` | last N calls for Doctor inspection |

### Task 7a.1: Migration + tracer module

### Task 7a.2: Wire wrapper around serverReflection.questionEntry + correlationGuard.checkEntry

(Detailed steps deferred until execution checkpoint.)

---

## WAVE 7 DELTA b — Unified Audit Trail (chained hash)

### Architecture

Currently audit data is spread across `ml_decision_snapshots`, `ml_audit`, `ml_voice_log`, `ml_influence_audit`, `ml_diagnostic_events`. Operator wants:
- Single chained-hash audit trail where every entry hash includes prev entry's hash → tamper-evident
- Periodic chain head signed and persisted for offline verification

### File structure

| File | Responsibility |
|---|---|
| `server/services/ml/_audit/chainedTrail.js` | `append(entry)` computes hash, links to prev; `verify(fromTs, toTs)` walks chain |
| Migration `378_ml_audit_chain` | id, prev_hash, entry_hash, payload_json, ts |
| Route `/api/omega/audit/chain/{recent, verify}` | observability |

### Task 7b.1: Migration + chained trail module

### Task 7b.2: Wrap ALL existing audit emits to also append to chain

### Task 7b.3: Verify route + periodic self-check cron (hourly)

(Detailed steps deferred until checkpoint.)

---

## WAVE 6 DELTA — Exposure Manager Unified + Exactly-Once Guarantee

### Architecture

Current exposure tracking is fragmented:
- `serverCorrelationGuard` checks correlated positions
- `serverDrawdownGuard` checks daily drawdown
- `serverRiskGuard` checks per-order limits
- No single source of truth for "total exposure across all positions"

Plus exactly-once: order idempotency keys exist but cross-restart guarantee partial. Goal: order replay-safe across PM2 reloads.

### File structure

| File | Responsibility |
|---|---|
| `server/services/ml/R4_execution/exposureManager.js` | `getTotalExposure(userId)`, `wouldExceedLimit(userId, newOrder)` unified |
| `server/services/ml/R4_execution/exactlyOnceLedger.js` | Persistent idempotency keys table (cross-restart) |
| Migration `379_ml_idempotency_ledger` | (idempotency_key TEXT PK, request_payload_hash, result_payload, created_at, ttl_ms) |

### Tasks

5.1: Idempotency ledger migration + module
5.2: Exposure manager unified (read-model only; doesn't block, just observability)
5.3: Wire into trading.js POST /api/order/place — verify idempotency_key not duplicated (returns cached result if seen)
5.4: Wire into serverAT _executeLiveEntry — same idempotency check

**Hot path edits required — backup convention strict here.**

(Detailed steps deferred until Wave 4-5-7 ship and risk profile is understood.)

---

## WAVE 8 POLISH — UX items (A-Z Raid remaining)

### Items + estimates

| Letter | Feature | Effort | Detail |
|---|---|---|---|
| **D** | DD awareness UI indicator | 30 min | Gauge in OmegaPage header — green (<3%), yellow (3-7%), red (>7%) |
| **C** | Confidence display per decision | 45 min | TheVoice utterances show confidence% inline; Ring5Panel shows per-decision |
| **G** | Greetings/farewells | 20 min | OnAppMount → "Ω online. let me look around." OnUnmount → "Ω resting." |
| **E** | Easter eggs | 1h | Milestones detection (100 wins, 1k decisions, first profit day) → special TheVoice utterance |
| **P** | Performance "report card" subpage | 2h | New OmegaPage tab with R5A stats + bandit cells + journal insights aggregated |
| **H** | History/replay UI (scroll back Ω day) | 3h | Time-travel slider in TheVoice + DoctorPanel showing past N hours |

Each item independently shippable. Order: D → G → C → E → P → H (easiest first).

(Per-task detail will be written when Wave 8 phase begins.)

---

## SOAK PHASE — 7-day live observation

### Pre-soak checklist

- [ ] All Wave 4-8 changes deployed live (PM2 reload + tag per wave)
- [ ] Full server jest pass (target: 7000+ tests at this point)
- [ ] Backup tag: `pre-soak-omega-waves-4-8-COMPLETE-YYYYMMDD`
- [ ] Operator confirms: enable for 7 days uninterrupted

### Daily check (operator manual or `scripts/soak-daily.sh` cron)

- Active P0/P1 counters in Doctor — should remain 0
- Brain heartbeat avg latency — should stay < 50ms
- `ml_r3b_calibration` row growth — should accumulate (target 100+ per regime by day 7)
- `ml_r1_violations` — log only, should be small (< 10 per day)
- Audit chain integrity — `curl /api/omega/audit/chain/verify` returns ok=true
- PM2 restarts — should remain stable (no crashes)

### Verdict criteria (day 7)

- **GREEN**: zero P0, < 5 P1 events, brain stable, chain verified, no regressions → tag `omega-waves-4-8-soak-GREEN-YYYYMMDD`
- **YELLOW**: 1-3 P0 events or minor anomalies → audit each, decide per-incident
- **RED**: > 3 P0 events or brain crash or chain tampering detected → rollback + post-mortem

---

## Self-Review

**Spec coverage:**
- Wave 4 R3B: conformal ✅, OOD ✅, index ✅, wire ✅
- Wave 5 R1: principles ✅, enforcement ✅, wire ✅, route ✅ (detail deferred — acceptable per checkpoint pattern)
- Wave 6 R4: exposure ✅, idempotency ✅, wire ✅ (detail deferred)
- Wave 7 R7+Audit: tracer ✅, chain ✅, wire ✅ (detail deferred)
- Wave 8 polish: 6 items enumerated ✅ (detail deferred per-item)
- Soak: pre-check + daily + verdict ✅

**Placeholder scan:**
- "Detailed steps deferred until execution checkpoint" used in Waves 5/6/7/8 — *intentional*. Operator pace + checkpoint pattern means writing 30-task detail upfront is wasteful (premature commitment). Wave 4 fully detailed (executes next); subsequent waves expanded post-checkpoint.

**Type consistency:**
- R3B `evaluate({regime, confidence, predicted, features})` matches across cp + ood + index ✅
- Test file names follow `tests/unit/<feature>.test.js` ✅
- Migration IDs sequential 375 → 379 ✅

---

## Rollback strategy

Per-wave: tags pre/post each wave. Revert via:
```bash
git revert <wave-tag-commit>..HEAD --no-edit  # batch revert
pm2 reload zeus --update-env
```

Hot-path Wave 6 = highest risk. Backup mandatory + flag-gated for first 24h (env `WAVE6_EXPOSURE_UNIFIED=true` default off; flip to true post-smoke).

---

## What gets the green light NOW

Operator + Claude approve this plan → start with **Task 4.1 migration** immediately. Each wave is checkpoint-gated; operator can pause/redirect between waves.
