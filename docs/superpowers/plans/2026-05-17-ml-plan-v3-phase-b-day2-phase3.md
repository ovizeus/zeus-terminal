# ML Plan v3 — Phase B Day 2 (Phase 3 Thompson Sampling Bandit) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Thompson Sampling bandit machinery per Plan v3 Phase A specs SPEC-7 (lazy pooled evidence refresh), SPEC-8 (4-level cell hierarchy L0→L4 with 30-trade promotion), and ARCH-2 (in-memory LRU cache).

**Architecture:** Three layered subsystems built on the Phase B Day 1 foundation (`ml_module_state` + Ring5LearningService). (1) **Bandit posteriors store** — per-(level × cell_key) α/β params persisted in `ml_bandit_posteriors`, with cold-start inheritance walking the L0→L4 hierarchy (global default → env → env×symbol → env×symbol×regime → user×env×symbol×regime). (2) **Pooled evidence aggregator** — lazy-with-TTL refresh from atomic `ml_bandit_evidence` rows; recomputes per-cell stats when stale (>30min OR >50 new obs). (3) **EffectiveStatus resolver** — in-memory LRU Map (1000 entries, 60s TTL) fronting the hierarchy walk for hot-path reads. Thompson Sampling draws use the resolved posterior; observations write to evidence + invalidate cache. NO change to existing decision flow — bandit is wired only via Ring5 facade `recordContribution` evolved to Thompson Sampling on Day 2 close.

**Tech Stack:** Node.js + better-sqlite3 + Jest (TDD). All work in `server/services/ml/_ring5/` namespace.

**Branch:** `omega/wave-1-foundation` (continuation).

**Gate:** Phase B Day 1 SHIPPED 2026-05-17 (tag `ml-plan-v3-phase-b-day1-phase1-2-COMPLETE-20260517-200828`). Migration 369 + ring5State + ring5LearningService live.

**Reference specs:**
- `_review/audit/PLAN_V3_GAP_CLOSURE_SCAFFOLDING.md` §SPEC-7 (lazy refresh), §SPEC-8 (hierarchy), §ARCH-2 (cache)
- `[[project_ml_v3_active_resumed]]` constraints

---

## File Structure

- **Modify:** `server/services/database.js` — prepend 3 migrations (370 bandit_posteriors, 371 pooled_evidence, 372 bandit_evidence) before existing Phase B 369 anchor
- **Create:** `server/services/ml/_ring5/banditPosteriors.js` — per-(level × cell_key) α/β state store
- **Create:** `server/services/ml/_ring5/banditEvidence.js` — atomic evidence row writer + reader for windowed aggregation
- **Create:** `server/services/ml/_ring5/pooledEvidence.js` — lazy-with-TTL refresh aggregator
- **Create:** `server/services/ml/_ring5/effectiveStatus.js` — LRU cache + hierarchy walk
- **Create:** `server/services/ml/_ring5/thompsonSampler.js` — public API for bandit draws + observation recording
- **Create:** `tests/unit/ml/banditPosteriors.test.js` (+ corresponding tests for each module)
- **Create:** `tests/unit/ml/banditEvidence.test.js`
- **Create:** `tests/unit/ml/pooledEvidence.test.js`
- **Create:** `tests/unit/ml/effectiveStatus.test.js`
- **Create:** `tests/unit/ml/thompsonSampler.test.js`
- **Modify:** `server/services/ml/ring5LearningService.js` — `recordContribution` evolved to call thompsonSampler

---

## Task 3.1: Migrations 370 + 371 + 372

**Files:**
- Modify: `server/services/database.js` (prepend before 369_ml_module_state anchor)
- Create: `tests/unit/ml/migrationsBandit370_371_372.test.js`

- [ ] **Step 1: Write the failing test**

Create `/root/zeus-terminal/tests/unit/ml/migrationsBandit370_371_372.test.js`:

```javascript
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-bandit-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');

describe('Phase 3 bandit migrations 370/371/372', () => {
    describe('370_ml_bandit_posteriors', () => {
        test('migration applied', () => {
            const row = db.prepare("SELECT name FROM _migrations WHERE name=?")
                .get('370_ml_bandit_posteriors');
            expect(row).toBeTruthy();
        });
        test('columns', () => {
            const cols = db.prepare("PRAGMA table_info(ml_bandit_posteriors)").all();
            const names = cols.map(c => c.name).sort();
            expect(names).toEqual([
                'alpha', 'beta', 'cell_key', 'id', 'level', 'observation_count',
                'updated_at'
            ]);
        });
        test('level CHECK enforces L0-L4', () => {
            expect(() => {
                db.prepare(`INSERT INTO ml_bandit_posteriors
                    (level, cell_key, alpha, beta, observation_count, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)`).run(5, 'x', 1, 1, 0, Date.now());
            }).toThrow(/CHECK/);
        });
        test('UNIQUE(level, cell_key)', () => {
            const now = Date.now();
            db.prepare(`INSERT INTO ml_bandit_posteriors
                (level, cell_key, alpha, beta, observation_count, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)`).run(2, 'BTCUSDT:DEMO', 1, 1, 0, now);
            expect(() => {
                db.prepare(`INSERT INTO ml_bandit_posteriors
                    (level, cell_key, alpha, beta, observation_count, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)`).run(2, 'BTCUSDT:DEMO', 1, 1, 0, now);
            }).toThrow(/UNIQUE/);
        });
        test('alpha/beta CHECK > 0', () => {
            expect(() => {
                db.prepare(`INSERT INTO ml_bandit_posteriors
                    (level, cell_key, alpha, beta, observation_count, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)`).run(0, 'global', 0, 1, 0, Date.now());
            }).toThrow(/CHECK/);
        });
    });

    describe('371_ml_pooled_evidence', () => {
        test('migration applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?")
                .get('371_ml_pooled_evidence')).toBeTruthy();
        });
        test('columns', () => {
            const cols = db.prepare("PRAGMA table_info(ml_pooled_evidence)").all();
            const names = cols.map(c => c.name).sort();
            expect(names).toEqual([
                'cell_key', 'id', 'last_refresh_ts', 'pooled_alpha', 'pooled_beta',
                'staleness_observations_count', 'sum_contribution', 'updated_at'
            ]);
        });
        test('UNIQUE cell_key', () => {
            const now = Date.now();
            db.prepare(`INSERT INTO ml_pooled_evidence
                (cell_key, last_refresh_ts, pooled_alpha, pooled_beta,
                 sum_contribution, staleness_observations_count, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)`).run('BTCUSDT:DEMO', now, 1, 1, 0, 0, now);
            expect(() => {
                db.prepare(`INSERT INTO ml_pooled_evidence
                    (cell_key, last_refresh_ts, pooled_alpha, pooled_beta,
                     sum_contribution, staleness_observations_count, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)`).run('BTCUSDT:DEMO', now, 1, 1, 0, 0, now);
            }).toThrow(/UNIQUE/);
        });
    });

    describe('372_ml_bandit_evidence', () => {
        test('migration applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?")
                .get('372_ml_bandit_evidence')).toBeTruthy();
        });
        test('columns', () => {
            const cols = db.prepare("PRAGMA table_info(ml_bandit_evidence)").all();
            const names = cols.map(c => c.name).sort();
            expect(names).toEqual([
                'cell_key', 'confidence', 'contribution', 'created_at',
                'id', 'module_id', 'outcome_class', 'ts'
            ]);
        });
        test('outcome_class CHECK enforced', () => {
            expect(() => {
                db.prepare(`INSERT INTO ml_bandit_evidence
                    (cell_key, module_id, contribution, confidence, outcome_class, ts, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
                    'BTCUSDT:DEMO', 'm', 0.1, 0.5, 'invalid', Date.now(), Date.now());
            }).toThrow(/CHECK/);
        });
        test('index idx_mlbe_cell_ts exists', () => {
            const idx = db.prepare(`
                SELECT name FROM sqlite_master
                WHERE type='index' AND tbl_name='ml_bandit_evidence'
                  AND name='idx_mlbe_cell_ts'
            `).get();
            expect(idx).toBeTruthy();
        });
    });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd /root/zeus-terminal && npx jest tests/unit/ml/migrationsBandit370_371_372.test.js --runInBand 2>&1 | tail -8`

Expected: `Tests: 11 failed` with first error `no such table: ml_bandit_posteriors`.

- [ ] **Step 3: Add the 3 migrations**

In `server/services/database.js`, locate the anchor `// [ML Plan v3 Phase 2 — Ring5LearningService module state per SPEC-1 contract 2026-05-17]` (around the 369 migration block). PREPEND the following 3 migrations IMMEDIATELY BEFORE that anchor:

```javascript
// [ML Plan v3 Phase 3 — Thompson Sampling bandit posteriors per SPEC-8 hierarchy 2026-05-17]
migrate('370_ml_bandit_posteriors', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_bandit_posteriors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            level INTEGER NOT NULL CHECK(level >= 0 AND level <= 4),
            cell_key TEXT NOT NULL,
            alpha REAL NOT NULL CHECK(alpha > 0),
            beta REAL NOT NULL CHECK(beta > 0),
            observation_count INTEGER NOT NULL DEFAULT 0 CHECK(observation_count >= 0),
            updated_at INTEGER NOT NULL,
            UNIQUE(level, cell_key)
        );
        CREATE INDEX IF NOT EXISTS idx_mlbp_level_cell
            ON ml_bandit_posteriors(level, cell_key);
    `);
});

// [ML Plan v3 Phase 3 — Pooled evidence per SPEC-7 lazy-with-TTL refresh 2026-05-17]
migrate('371_ml_pooled_evidence', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_pooled_evidence (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cell_key TEXT NOT NULL UNIQUE,
            last_refresh_ts INTEGER NOT NULL,
            pooled_alpha REAL NOT NULL CHECK(pooled_alpha > 0),
            pooled_beta REAL NOT NULL CHECK(pooled_beta > 0),
            sum_contribution REAL NOT NULL DEFAULT 0,
            staleness_observations_count INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL
        );
    `);
});

// [ML Plan v3 Phase 3 — Atomic bandit evidence per SPEC-7 source of truth 2026-05-17]
migrate('372_ml_bandit_evidence', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_bandit_evidence (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cell_key TEXT NOT NULL,
            module_id TEXT NOT NULL,
            contribution REAL NOT NULL,
            confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
            outcome_class TEXT NOT NULL CHECK(outcome_class IN ('positive','negative','neutral')),
            ts INTEGER NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlbe_cell_ts
            ON ml_bandit_evidence(cell_key, ts);
        CREATE INDEX IF NOT EXISTS idx_mlbe_module_ts
            ON ml_bandit_evidence(module_id, ts);
    `);
});

```

- [ ] **Step 4: Run test, verify GREEN**

Run: `cd /root/zeus-terminal && npx jest tests/unit/ml/migrationsBandit370_371_372.test.js --runInBand 2>&1 | tail -8`

Expected: `Tests: 11 passed`.

- [ ] **Step 5: Commit**

```bash
cd /root/zeus-terminal && git add server/services/database.js tests/unit/ml/migrationsBandit370_371_372.test.js
git commit -m "$(cat <<'EOF'
feat(ml-phase-b-day2): migrations 370/371/372 Thompson Sampling foundation

Three additive tables per Plan v3 Phase A Cluster 2 specs:

  370_ml_bandit_posteriors — per-(level × cell_key) α/β state
    SPEC-8 4-level hierarchy L0..L4 (CHECK level in [0,4]);
    UNIQUE(level, cell_key); alpha/beta > 0.

  371_ml_pooled_evidence — per-cell aggregated stats
    SPEC-7 lazy-with-TTL refresh source of truth;
    UNIQUE(cell_key); pooled_alpha/beta > 0;
    staleness_observations_count drives refresh trigger.

  372_ml_bandit_evidence — atomic observation rows
    SPEC-7 windowed aggregation reads from here;
    outcome_class CHECK 3 enum (positive|negative|neutral);
    INDEX idx_mlbe_cell_ts for windowed queries.

11 tests passing.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3.2: banditPosteriors helper

**Files:**
- Create: `server/services/ml/_ring5/banditPosteriors.js`
- Create: `tests/unit/ml/banditPosteriors.test.js`

- [ ] **Step 1: Write the failing test**

Create `/root/zeus-terminal/tests/unit/ml/banditPosteriors.test.js`:

```javascript
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r5-post-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const bp = require('../../../server/services/ml/_ring5/banditPosteriors');

const _now = () => Date.now();

function clean() {
    db.prepare("DELETE FROM ml_bandit_posteriors").run();
}

describe('banditPosteriors (Phase 3)', () => {
    beforeEach(clean);

    describe('LEVELS constants', () => {
        test('LEVELS exposes 5 levels L0..L4', () => {
            expect(bp.LEVELS).toEqual([0, 1, 2, 3, 4]);
        });
        test('buildCellKey produces expected format per level', () => {
            expect(bp.buildCellKey({ level: 0 })).toBe('global');
            expect(bp.buildCellKey({ level: 1, env: 'DEMO' })).toBe('DEMO');
            expect(bp.buildCellKey({ level: 2, env: 'DEMO', symbol: 'BTCUSDT' })).toBe('DEMO:BTCUSDT');
            expect(bp.buildCellKey({ level: 3, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending' })).toBe('DEMO:BTCUSDT:trending');
            expect(bp.buildCellKey({ level: 4, userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending' })).toBe('1:DEMO:BTCUSDT:trending');
        });
    });

    describe('getPosterior', () => {
        test('returns null for unseen (level, cell_key)', () => {
            expect(bp.getPosterior({ level: 2, cellKey: 'unseen' })).toBeNull();
        });

        test('returns hydrated posterior when present', () => {
            db.prepare(`INSERT INTO ml_bandit_posteriors
                (level, cell_key, alpha, beta, observation_count, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)`).run(2, 'DEMO:BTCUSDT', 5, 3, 8, _now());
            const r = bp.getPosterior({ level: 2, cellKey: 'DEMO:BTCUSDT' });
            expect(r).toEqual(expect.objectContaining({
                level: 2, cellKey: 'DEMO:BTCUSDT', alpha: 5, beta: 3, observationCount: 8
            }));
        });
    });

    describe('updatePosterior (Bayesian Beta update)', () => {
        test('inserts new row with uniform prior (alpha=1, beta=1) on first observation positive', () => {
            bp.updatePosterior({
                level: 2, cellKey: 'DEMO:BTCUSDT',
                outcomeClass: 'positive', ts: _now()
            });
            const r = bp.getPosterior({ level: 2, cellKey: 'DEMO:BTCUSDT' });
            expect(r.alpha).toBe(2);   // prior 1 + positive 1
            expect(r.beta).toBe(1);
            expect(r.observationCount).toBe(1);
        });

        test('inserts new row with uniform prior on first observation negative', () => {
            bp.updatePosterior({
                level: 2, cellKey: 'DEMO:ETHUSDT',
                outcomeClass: 'negative', ts: _now()
            });
            const r = bp.getPosterior({ level: 2, cellKey: 'DEMO:ETHUSDT' });
            expect(r.alpha).toBe(1);
            expect(r.beta).toBe(2);    // prior 1 + negative 1
            expect(r.observationCount).toBe(1);
        });

        test('neutral does not move α/β but increments count', () => {
            bp.updatePosterior({
                level: 2, cellKey: 'DEMO:LTCUSDT',
                outcomeClass: 'neutral', ts: _now()
            });
            const r = bp.getPosterior({ level: 2, cellKey: 'DEMO:LTCUSDT' });
            expect(r.alpha).toBe(1);
            expect(r.beta).toBe(1);
            expect(r.observationCount).toBe(1);
        });

        test('repeated positive observations push alpha higher', () => {
            for (let i = 0; i < 10; i++) {
                bp.updatePosterior({
                    level: 2, cellKey: 'DEMO:SOLUSDT',
                    outcomeClass: 'positive', ts: _now()
                });
            }
            const r = bp.getPosterior({ level: 2, cellKey: 'DEMO:SOLUSDT' });
            expect(r.alpha).toBe(11);   // 1 + 10
            expect(r.beta).toBe(1);
            expect(r.observationCount).toBe(10);
        });

        test('rejects invalid level', () => {
            expect(() => bp.updatePosterior({
                level: 5, cellKey: 'x', outcomeClass: 'positive', ts: _now()
            })).toThrow(/level/);
        });

        test('rejects invalid outcomeClass', () => {
            expect(() => bp.updatePosterior({
                level: 2, cellKey: 'x', outcomeClass: 'maybe', ts: _now()
            })).toThrow(/outcomeClass/);
        });
    });

    describe('isCellOwned (30-trade promotion gate per SPEC-8)', () => {
        test('returns false when observationCount < PROMOTION_THRESHOLD', () => {
            for (let i = 0; i < 29; i++) {
                bp.updatePosterior({
                    level: 4, cellKey: '1:DEMO:BTCUSDT:trending',
                    outcomeClass: 'positive', ts: _now()
                });
            }
            expect(bp.isCellOwned({ level: 4, cellKey: '1:DEMO:BTCUSDT:trending' })).toBe(false);
        });

        test('returns true at threshold = 30 observations', () => {
            for (let i = 0; i < 30; i++) {
                bp.updatePosterior({
                    level: 4, cellKey: '1:DEMO:BTCUSDT:ranging',
                    outcomeClass: 'positive', ts: _now()
                });
            }
            expect(bp.isCellOwned({ level: 4, cellKey: '1:DEMO:BTCUSDT:ranging' })).toBe(true);
        });

        test('returns false for unseen cell', () => {
            expect(bp.isCellOwned({ level: 4, cellKey: 'never' })).toBe(false);
        });
    });

    describe('walkHierarchy (per SPEC-8 inheritance ladder)', () => {
        test('returns owned posterior at highest level when present', () => {
            for (let i = 0; i < 30; i++) {
                bp.updatePosterior({ level: 4, cellKey: '1:DEMO:BTCUSDT:trending', outcomeClass: 'positive', ts: _now() });
            }
            const r = bp.walkHierarchy({
                userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending'
            });
            expect(r.level).toBe(4);
            expect(r.alpha).toBe(31); // 1 + 30 positive
        });

        test('falls back to L3 when L4 not yet owned', () => {
            for (let i = 0; i < 30; i++) {
                bp.updatePosterior({ level: 3, cellKey: 'DEMO:BTCUSDT:trending', outcomeClass: 'positive', ts: _now() });
            }
            const r = bp.walkHierarchy({
                userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending'
            });
            expect(r.level).toBe(3);
            expect(r.alpha).toBe(31);
        });

        test('falls back to L0 global default when nothing seeded', () => {
            const r = bp.walkHierarchy({
                userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending'
            });
            expect(r.level).toBe(0);
            expect(r.alpha).toBe(1);  // uniform prior
            expect(r.beta).toBe(1);
            expect(r.observationCount).toBe(0);
        });
    });
});
```

- [ ] **Step 2: Verify RED**

Run: `cd /root/zeus-terminal && npx jest tests/unit/ml/banditPosteriors.test.js --runInBand 2>&1 | tail -5`

Expected: `Cannot find module '../../../server/services/ml/_ring5/banditPosteriors'`.

- [ ] **Step 3: Create banditPosteriors.js**

Create `/root/zeus-terminal/server/services/ml/_ring5/banditPosteriors.js`:

```javascript
'use strict';

/**
 * ML Plan v3 Phase 3 — Bandit Posteriors (per-(level × cell_key) Beta α/β state).
 *
 * Per SPEC-8 4-level cell hierarchy:
 *   L0 = global default (uniform prior α=β=1)
 *   L1 = env (e.g., 'DEMO')
 *   L2 = env × symbol (e.g., 'DEMO:BTCUSDT')
 *   L3 = env × symbol × regime (e.g., 'DEMO:BTCUSDT:trending')
 *   L4 = user × env × symbol × regime (e.g., '1:DEMO:BTCUSDT:trending')
 *
 * Bayesian Beta update on observation:
 *   positive → α += 1
 *   negative → β += 1
 *   neutral → no α/β change (only observation_count++)
 *
 * Promotion gate (SPEC-8): cell owns its posterior when observation_count >= 30.
 *
 * walkHierarchy walks L4 → L0 returning the FIRST owned posterior (or L0 default
 * if none owned yet) — cold-start inheritance via the ladder.
 */

const { db } = require('../../database');

const LEVELS = Object.freeze([0, 1, 2, 3, 4]);
const PROMOTION_THRESHOLD = 30;
const VALID_OUTCOMES = new Set(['positive', 'negative', 'neutral']);

function _required(p, k) {
    if (p == null || p[k] == null) throw new Error(`banditPosteriors: missing ${k}`);
    return p[k];
}

function _validateLevel(level) {
    if (!LEVELS.includes(level)) throw new Error(`banditPosteriors: invalid level ${level}`);
    return level;
}

function buildCellKey(params) {
    const level = _required(params, 'level');
    _validateLevel(level);
    if (level === 0) return 'global';
    if (level === 1) return `${_required(params, 'env')}`;
    if (level === 2) return `${_required(params, 'env')}:${_required(params, 'symbol')}`;
    if (level === 3) return `${_required(params, 'env')}:${_required(params, 'symbol')}:${_required(params, 'regime')}`;
    return `${_required(params, 'userId')}:${_required(params, 'env')}:${_required(params, 'symbol')}:${_required(params, 'regime')}`;
}

const _stmts = {
    select: db.prepare(`
        SELECT id, level, cell_key, alpha, beta, observation_count, updated_at
        FROM ml_bandit_posteriors WHERE level = ? AND cell_key = ?
    `),
    upsertPositive: db.prepare(`
        INSERT INTO ml_bandit_posteriors
            (level, cell_key, alpha, beta, observation_count, updated_at)
        VALUES (?, ?, 2, 1, 1, ?)
        ON CONFLICT(level, cell_key) DO UPDATE SET
            alpha = alpha + 1,
            observation_count = observation_count + 1,
            updated_at = excluded.updated_at
    `),
    upsertNegative: db.prepare(`
        INSERT INTO ml_bandit_posteriors
            (level, cell_key, alpha, beta, observation_count, updated_at)
        VALUES (?, ?, 1, 2, 1, ?)
        ON CONFLICT(level, cell_key) DO UPDATE SET
            beta = beta + 1,
            observation_count = observation_count + 1,
            updated_at = excluded.updated_at
    `),
    upsertNeutral: db.prepare(`
        INSERT INTO ml_bandit_posteriors
            (level, cell_key, alpha, beta, observation_count, updated_at)
        VALUES (?, ?, 1, 1, 1, ?)
        ON CONFLICT(level, cell_key) DO UPDATE SET
            observation_count = observation_count + 1,
            updated_at = excluded.updated_at
    `)
};

function _hydrate(row) {
    if (!row) return null;
    return {
        id: row.id,
        level: row.level,
        cellKey: row.cell_key,
        alpha: row.alpha,
        beta: row.beta,
        observationCount: row.observation_count,
        updatedAt: row.updated_at
    };
}

function getPosterior(params) {
    const level = _validateLevel(_required(params, 'level'));
    const cellKey = _required(params, 'cellKey');
    return _hydrate(_stmts.select.get(level, cellKey));
}

function updatePosterior(params) {
    const level = _validateLevel(_required(params, 'level'));
    const cellKey = _required(params, 'cellKey');
    const outcomeClass = _required(params, 'outcomeClass');
    const ts = _required(params, 'ts');
    if (!VALID_OUTCOMES.has(outcomeClass)) {
        throw new Error(`banditPosteriors: invalid outcomeClass '${outcomeClass}'`);
    }
    const stmt = outcomeClass === 'positive' ? _stmts.upsertPositive
              : outcomeClass === 'negative' ? _stmts.upsertNegative
              : _stmts.upsertNeutral;
    stmt.run(level, cellKey, ts);
    return { updated: true };
}

function isCellOwned(params) {
    const r = getPosterior(params);
    if (!r) return false;
    return r.observationCount >= PROMOTION_THRESHOLD;
}

function walkHierarchy(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'env');
    const symbol = _required(params, 'symbol');
    const regime = _required(params, 'regime');

    // Walk L4 → L0 returning first owned posterior; default to L0 uniform prior.
    const candidates = [
        { level: 4, cellKey: buildCellKey({ level: 4, userId, env, symbol, regime }) },
        { level: 3, cellKey: buildCellKey({ level: 3, env, symbol, regime }) },
        { level: 2, cellKey: buildCellKey({ level: 2, env, symbol }) },
        { level: 1, cellKey: buildCellKey({ level: 1, env }) },
        { level: 0, cellKey: 'global' }
    ];
    for (const c of candidates) {
        const r = getPosterior({ level: c.level, cellKey: c.cellKey });
        if (r && r.observationCount >= PROMOTION_THRESHOLD) return r;
    }
    // No owned cell — fall back to L0 default uniform prior.
    return { level: 0, cellKey: 'global', alpha: 1, beta: 1, observationCount: 0, updatedAt: null };
}

module.exports = {
    LEVELS, PROMOTION_THRESHOLD,
    buildCellKey, getPosterior, updatePosterior, isCellOwned, walkHierarchy
};
```

- [ ] **Step 4: Verify GREEN**

Run: `cd /root/zeus-terminal && npx jest tests/unit/ml/banditPosteriors.test.js --runInBand 2>&1 | tail -8`

Expected: `Tests: 13 passed`.

- [ ] **Step 5: Commit**

```bash
cd /root/zeus-terminal && git add server/services/ml/_ring5/banditPosteriors.js tests/unit/ml/banditPosteriors.test.js
git commit -m "$(cat <<'EOF'
feat(ml-phase-b-day2): banditPosteriors — SPEC-8 4-level hierarchy + 30-trade promotion

Per-(level × cell_key) Beta α/β state with atomic Bayesian updates:
  positive → α += 1; negative → β += 1; neutral → observation_count++ only.

API:
  - LEVELS frozen [0..4]
  - PROMOTION_THRESHOLD = 30 (SPEC-8 sample-size gate)
  - buildCellKey({level, ...}) → canonical string per level
  - getPosterior({level, cellKey}) → hydrated record or null
  - updatePosterior({level, cellKey, outcomeClass, ts}) → atomic upsert
  - isCellOwned({level, cellKey}) → observationCount >= 30
  - walkHierarchy({userId, env, symbol, regime}) → L4→L0 cold-start ladder

Cold-start: walkHierarchy returns first OWNED posterior up the ladder,
or L0 uniform prior (α=β=1) if no cell has reached threshold yet.

13 tests passing.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3.3: banditEvidence helper (atomic observation rows)

**Files:**
- Create: `server/services/ml/_ring5/banditEvidence.js`
- Create: `tests/unit/ml/banditEvidence.test.js`

- [ ] **Step 1: Write the failing test**

Create `/root/zeus-terminal/tests/unit/ml/banditEvidence.test.js`:

```javascript
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r5-ev-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const be = require('../../../server/services/ml/_ring5/banditEvidence');

const _now = () => Date.now();

function clean() {
    db.prepare("DELETE FROM ml_bandit_evidence").run();
}

describe('banditEvidence (Phase 3)', () => {
    beforeEach(clean);

    describe('recordEvidence', () => {
        test('inserts row', () => {
            be.recordEvidence({
                cellKey: 'DEMO:BTCUSDT', moduleId: 'mod_a',
                contribution: 0.3, confidence: 0.7,
                outcomeClass: 'positive', ts: _now()
            });
            const n = db.prepare("SELECT COUNT(*) AS n FROM ml_bandit_evidence").get().n;
            expect(n).toBe(1);
        });

        test('rejects outcomeClass not in enum', () => {
            expect(() => be.recordEvidence({
                cellKey: 'x', moduleId: 'm', contribution: 0, confidence: 0.5,
                outcomeClass: 'maybe', ts: _now()
            })).toThrow(/outcomeClass/);
        });

        test('rejects confidence outside [0,1]', () => {
            expect(() => be.recordEvidence({
                cellKey: 'x', moduleId: 'm', contribution: 0, confidence: 1.5,
                outcomeClass: 'positive', ts: _now()
            })).toThrow(/confidence/);
        });

        test('rejects missing required field', () => {
            expect(() => be.recordEvidence({
                cellKey: 'x', moduleId: 'm', contribution: 0,
                outcomeClass: 'positive', ts: _now()
            })).toThrow(/confidence/);
        });
    });

    describe('countSince', () => {
        test('returns 0 for cell with no evidence', () => {
            expect(be.countSince({ cellKey: 'empty', sinceTs: 0 })).toBe(0);
        });

        test('counts only rows since cutoff ts', () => {
            const t = _now();
            be.recordEvidence({ cellKey: 'c1', moduleId: 'm', contribution: 0, confidence: 0.5, outcomeClass: 'positive', ts: t - 1000 });
            be.recordEvidence({ cellKey: 'c1', moduleId: 'm', contribution: 0, confidence: 0.5, outcomeClass: 'positive', ts: t + 1000 });
            be.recordEvidence({ cellKey: 'c1', moduleId: 'm', contribution: 0, confidence: 0.5, outcomeClass: 'positive', ts: t + 2000 });
            expect(be.countSince({ cellKey: 'c1', sinceTs: t })).toBe(2);
        });
    });

    describe('aggregateSince (windowed pooled stats)', () => {
        test('zero counts return uniform prior shape', () => {
            const r = be.aggregateSince({ cellKey: 'empty', sinceTs: 0 });
            expect(r).toEqual({ pooledAlpha: 1, pooledBeta: 1, sumContribution: 0, n: 0 });
        });

        test('aggregates positive + negative + neutral with prior', () => {
            const t = _now();
            // 5 positive, 2 negative, 1 neutral
            for (let i = 0; i < 5; i++) be.recordEvidence({ cellKey: 'ag', moduleId: 'm', contribution: 0.2, confidence: 0.7, outcomeClass: 'positive', ts: t + i });
            for (let i = 0; i < 2; i++) be.recordEvidence({ cellKey: 'ag', moduleId: 'm', contribution: -0.1, confidence: 0.6, outcomeClass: 'negative', ts: t + 100 + i });
            be.recordEvidence({ cellKey: 'ag', moduleId: 'm', contribution: 0, confidence: 0.5, outcomeClass: 'neutral', ts: t + 200 });
            const r = be.aggregateSince({ cellKey: 'ag', sinceTs: 0 });
            expect(r.pooledAlpha).toBe(6);   // 1 + 5 positive
            expect(r.pooledBeta).toBe(3);    // 1 + 2 negative
            expect(r.n).toBe(8);             // 5 + 2 + 1 total
            expect(r.sumContribution).toBeCloseTo(5 * 0.2 + 2 * -0.1 + 0, 5);
        });

        test('respects sinceTs cutoff', () => {
            const t = _now();
            be.recordEvidence({ cellKey: 'cut', moduleId: 'm', contribution: 0.5, confidence: 0.5, outcomeClass: 'positive', ts: t - 5000 });
            be.recordEvidence({ cellKey: 'cut', moduleId: 'm', contribution: 0.5, confidence: 0.5, outcomeClass: 'positive', ts: t + 1000 });
            const r = be.aggregateSince({ cellKey: 'cut', sinceTs: t });
            expect(r.n).toBe(1);
            expect(r.pooledAlpha).toBe(2);   // 1 prior + 1 positive (older excluded)
        });
    });
});
```

- [ ] **Step 2: Verify RED**

Run: `cd /root/zeus-terminal && npx jest tests/unit/ml/banditEvidence.test.js --runInBand 2>&1 | tail -5`

Expected: `Cannot find module '../../../server/services/ml/_ring5/banditEvidence'`.

- [ ] **Step 3: Create banditEvidence.js**

Create `/root/zeus-terminal/server/services/ml/_ring5/banditEvidence.js`:

```javascript
'use strict';

/**
 * ML Plan v3 Phase 3 — Bandit Evidence (atomic observation rows).
 *
 * Source of truth for pooled aggregation. Each contribution row immutable.
 * Pooled evidence helper reads from here on lazy-with-TTL refresh trigger.
 *
 * API:
 *   - recordEvidence(...) — insert atomic row
 *   - countSince({cellKey, sinceTs}) — windowed count
 *   - aggregateSince({cellKey, sinceTs}) — pooled α/β + sum_contribution + n
 */

const { db } = require('../../database');

const VALID_OUTCOMES = new Set(['positive', 'negative', 'neutral']);

function _required(p, k) {
    if (p == null || p[k] == null) throw new Error(`banditEvidence: missing ${k}`);
    return p[k];
}

function _validateConfidence(v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`banditEvidence: confidence must be in [0,1], got ${v}`);
    }
    return v;
}

const _stmts = {
    insert: db.prepare(`
        INSERT INTO ml_bandit_evidence
            (cell_key, module_id, contribution, confidence, outcome_class, ts, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    countSince: db.prepare(`
        SELECT COUNT(*) AS n FROM ml_bandit_evidence
        WHERE cell_key = ? AND ts >= ?
    `),
    aggregateSince: db.prepare(`
        SELECT
            SUM(CASE WHEN outcome_class='positive' THEN 1 ELSE 0 END) AS positives,
            SUM(CASE WHEN outcome_class='negative' THEN 1 ELSE 0 END) AS negatives,
            SUM(CASE WHEN outcome_class='neutral'  THEN 1 ELSE 0 END) AS neutrals,
            COALESCE(SUM(contribution), 0) AS sum_contribution,
            COUNT(*) AS n
        FROM ml_bandit_evidence
        WHERE cell_key = ? AND ts >= ?
    `)
};

function recordEvidence(params) {
    const cellKey = _required(params, 'cellKey');
    const moduleId = _required(params, 'moduleId');
    const contribution = _required(params, 'contribution');
    const confidence = _validateConfidence(_required(params, 'confidence'));
    const outcomeClass = _required(params, 'outcomeClass');
    const ts = _required(params, 'ts');
    if (!VALID_OUTCOMES.has(outcomeClass)) {
        throw new Error(`banditEvidence: invalid outcomeClass '${outcomeClass}'`);
    }
    _stmts.insert.run(cellKey, moduleId, contribution, confidence, outcomeClass, ts, ts);
    return { recorded: true };
}

function countSince(params) {
    const cellKey = _required(params, 'cellKey');
    const sinceTs = _required(params, 'sinceTs');
    return _stmts.countSince.get(cellKey, sinceTs).n;
}

function aggregateSince(params) {
    const cellKey = _required(params, 'cellKey');
    const sinceTs = _required(params, 'sinceTs');
    const row = _stmts.aggregateSince.get(cellKey, sinceTs);
    const positives = row.positives || 0;
    const negatives = row.negatives || 0;
    // Uniform prior α=β=1 plus observed counts
    return {
        pooledAlpha: 1 + positives,
        pooledBeta: 1 + negatives,
        sumContribution: row.sum_contribution || 0,
        n: row.n || 0
    };
}

module.exports = { recordEvidence, countSince, aggregateSince };
```

- [ ] **Step 4: Verify GREEN**

Run: `cd /root/zeus-terminal && npx jest tests/unit/ml/banditEvidence.test.js --runInBand 2>&1 | tail -5`

Expected: `Tests: 9 passed`.

- [ ] **Step 5: Commit**

```bash
cd /root/zeus-terminal && git add server/services/ml/_ring5/banditEvidence.js tests/unit/ml/banditEvidence.test.js
git commit -m "$(cat <<'EOF'
feat(ml-phase-b-day2): banditEvidence — atomic observation rows + windowed aggregation

API:
  - recordEvidence({cellKey, moduleId, contribution, confidence, outcomeClass, ts})
  - countSince({cellKey, sinceTs}) → rows in window
  - aggregateSince({cellKey, sinceTs}) → {pooledAlpha, pooledBeta, sumContribution, n}

Uniform prior α=β=1 applied at aggregation time. Source of truth for
SPEC-7 pooled evidence lazy refresh.

9 tests passing.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3.4: pooledEvidence (lazy-with-TTL refresh)

**Files:**
- Create: `server/services/ml/_ring5/pooledEvidence.js`
- Create: `tests/unit/ml/pooledEvidence.test.js`

- [ ] **Step 1: Write the failing test**

Create `/root/zeus-terminal/tests/unit/ml/pooledEvidence.test.js`:

```javascript
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r5-pool-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const be = require('../../../server/services/ml/_ring5/banditEvidence');
const pe = require('../../../server/services/ml/_ring5/pooledEvidence');

const _now = () => Date.now();

function clean() {
    db.prepare("DELETE FROM ml_bandit_evidence").run();
    db.prepare("DELETE FROM ml_pooled_evidence").run();
}

describe('pooledEvidence (Phase 3 — SPEC-7 lazy-with-TTL)', () => {
    beforeEach(clean);

    describe('constants', () => {
        test('TTL_MS = 30 min', () => {
            expect(pe.TTL_MS).toBe(30 * 60 * 1000);
        });
        test('OBS_THRESHOLD = 50', () => {
            expect(pe.OBS_THRESHOLD).toBe(50);
        });
        test('WINDOW_DAYS = 30', () => {
            expect(pe.WINDOW_DAYS).toBe(30);
        });
    });

    describe('refresh (triggered)', () => {
        test('first call creates pooled row from evidence', () => {
            const t = _now();
            be.recordEvidence({ cellKey: 'fresh', moduleId: 'm', contribution: 0.5, confidence: 0.7, outcomeClass: 'positive', ts: t });
            be.recordEvidence({ cellKey: 'fresh', moduleId: 'm', contribution: 0.3, confidence: 0.6, outcomeClass: 'positive', ts: t + 100 });
            const r = pe.refresh({ cellKey: 'fresh', nowTs: _now() });
            expect(r.refreshed).toBe(true);
            expect(r.pooledAlpha).toBe(3);    // 1 prior + 2 positive
            expect(r.pooledBeta).toBe(1);
            expect(r.n).toBe(2);
        });

        test('persisted in ml_pooled_evidence', () => {
            be.recordEvidence({ cellKey: 'persist', moduleId: 'm', contribution: 0.1, confidence: 0.5, outcomeClass: 'positive', ts: _now() });
            pe.refresh({ cellKey: 'persist', nowTs: _now() });
            const row = db.prepare("SELECT * FROM ml_pooled_evidence WHERE cell_key = ?").get('persist');
            expect(row).toBeTruthy();
            expect(row.pooled_alpha).toBe(2);
            expect(row.staleness_observations_count).toBe(0);  // reset on refresh
        });
    });

    describe('get + lazy refresh trigger', () => {
        test('returns existing pooled row when fresh', () => {
            const now = _now();
            be.recordEvidence({ cellKey: 'g1', moduleId: 'm', contribution: 0.5, confidence: 0.5, outcomeClass: 'positive', ts: now });
            pe.refresh({ cellKey: 'g1', nowTs: now });
            const r = pe.get({ cellKey: 'g1', nowTs: now + 1000 });  // 1s later
            expect(r.pooledAlpha).toBe(2);
            expect(r.refreshTriggered).toBe(false);
        });

        test('TTL trigger: > 30min stale auto-refresh on get', () => {
            const t = _now() - 31 * 60 * 1000;  // 31 min ago
            be.recordEvidence({ cellKey: 'ttl', moduleId: 'm', contribution: 0.1, confidence: 0.5, outcomeClass: 'positive', ts: t });
            pe.refresh({ cellKey: 'ttl', nowTs: t });  // initial refresh stamps last_refresh_ts to (t)
            // Add new evidence
            const newT = _now();
            be.recordEvidence({ cellKey: 'ttl', moduleId: 'm', contribution: 0.2, confidence: 0.5, outcomeClass: 'positive', ts: newT });
            const r = pe.get({ cellKey: 'ttl', nowTs: newT });
            expect(r.refreshTriggered).toBe(true);
            expect(r.pooledAlpha).toBe(3);  // 1 prior + 2 positive
        });

        test('OBS threshold trigger: 50 new obs since last refresh → auto-refresh', () => {
            const t = _now();
            be.recordEvidence({ cellKey: 'obs', moduleId: 'm', contribution: 0.1, confidence: 0.5, outcomeClass: 'positive', ts: t });
            pe.refresh({ cellKey: 'obs', nowTs: t });
            for (let i = 0; i < 50; i++) {
                be.recordEvidence({ cellKey: 'obs', moduleId: 'm', contribution: 0.05, confidence: 0.5, outcomeClass: 'positive', ts: t + 100 + i });
            }
            pe.incrementStaleness({ cellKey: 'obs', count: 50 });
            const r = pe.get({ cellKey: 'obs', nowTs: t + 500 });
            expect(r.refreshTriggered).toBe(true);
            expect(r.n).toBe(51);
        });

        test('cell never refreshed → triggers initial refresh on first get', () => {
            be.recordEvidence({ cellKey: 'new', moduleId: 'm', contribution: 0.1, confidence: 0.5, outcomeClass: 'positive', ts: _now() });
            const r = pe.get({ cellKey: 'new', nowTs: _now() });
            expect(r.refreshTriggered).toBe(true);
            expect(r.pooledAlpha).toBe(2);
        });
    });

    describe('incrementStaleness', () => {
        test('increments staleness counter without refresh', () => {
            be.recordEvidence({ cellKey: 'st', moduleId: 'm', contribution: 0.1, confidence: 0.5, outcomeClass: 'positive', ts: _now() });
            pe.refresh({ cellKey: 'st', nowTs: _now() });
            pe.incrementStaleness({ cellKey: 'st', count: 5 });
            const row = db.prepare("SELECT staleness_observations_count FROM ml_pooled_evidence WHERE cell_key = ?").get('st');
            expect(row.staleness_observations_count).toBe(5);
        });
    });
});
```

- [ ] **Step 2: Verify RED**

Run: `cd /root/zeus-terminal && npx jest tests/unit/ml/pooledEvidence.test.js --runInBand 2>&1 | tail -5`

Expected: `Cannot find module '../../../server/services/ml/_ring5/pooledEvidence'`.

- [ ] **Step 3: Create pooledEvidence.js**

Create `/root/zeus-terminal/server/services/ml/_ring5/pooledEvidence.js`:

```javascript
'use strict';

/**
 * ML Plan v3 Phase 3 — Pooled Evidence (SPEC-7 lazy-with-TTL refresh).
 *
 * Per-cell aggregated stats refreshed lazily via:
 *   - TTL trigger: last_refresh_ts older than 30 min
 *   - OBS threshold trigger: >= 50 new observations since last refresh
 *   - Forced refresh: explicit refresh() call
 *
 * Window for aggregation: rolling 30 days (per §97 knowledge expiry policy).
 *
 * Source of truth: ml_bandit_evidence atomic rows; pooled row is materialized view.
 */

const { db } = require('../../database');
const banditEvidence = require('./banditEvidence');

const TTL_MS = 30 * 60 * 1000;      // 30 min
const OBS_THRESHOLD = 50;
const WINDOW_DAYS = 30;
const WINDOW_MS = WINDOW_DAYS * 24 * 60 * 60 * 1000;

function _required(p, k) {
    if (p == null || p[k] == null) throw new Error(`pooledEvidence: missing ${k}`);
    return p[k];
}

const _stmts = {
    select: db.prepare(`
        SELECT id, cell_key, last_refresh_ts, pooled_alpha, pooled_beta,
               sum_contribution, staleness_observations_count, updated_at
        FROM ml_pooled_evidence WHERE cell_key = ?
    `),
    upsert: db.prepare(`
        INSERT INTO ml_pooled_evidence
            (cell_key, last_refresh_ts, pooled_alpha, pooled_beta,
             sum_contribution, staleness_observations_count, updated_at)
        VALUES (?, ?, ?, ?, ?, 0, ?)
        ON CONFLICT(cell_key) DO UPDATE SET
            last_refresh_ts = excluded.last_refresh_ts,
            pooled_alpha = excluded.pooled_alpha,
            pooled_beta = excluded.pooled_beta,
            sum_contribution = excluded.sum_contribution,
            staleness_observations_count = 0,
            updated_at = excluded.updated_at
    `),
    incrementStaleness: db.prepare(`
        UPDATE ml_pooled_evidence
        SET staleness_observations_count = staleness_observations_count + ?,
            updated_at = ?
        WHERE cell_key = ?
    `)
};

function refresh(params) {
    const cellKey = _required(params, 'cellKey');
    const nowTs = _required(params, 'nowTs');
    const sinceTs = nowTs - WINDOW_MS;
    const agg = banditEvidence.aggregateSince({ cellKey, sinceTs });
    _stmts.upsert.run(
        cellKey, nowTs,
        agg.pooledAlpha, agg.pooledBeta,
        agg.sumContribution, nowTs
    );
    return {
        refreshed: true,
        pooledAlpha: agg.pooledAlpha,
        pooledBeta: agg.pooledBeta,
        sumContribution: agg.sumContribution,
        n: agg.n
    };
}

function _hydrate(row) {
    if (!row) return null;
    return {
        cellKey: row.cell_key,
        lastRefreshTs: row.last_refresh_ts,
        pooledAlpha: row.pooled_alpha,
        pooledBeta: row.pooled_beta,
        sumContribution: row.sum_contribution,
        stalenessObservationsCount: row.staleness_observations_count
    };
}

function get(params) {
    const cellKey = _required(params, 'cellKey');
    const nowTs = _required(params, 'nowTs');
    const existing = _stmts.select.get(cellKey);

    const ttlExpired = !existing || (nowTs - existing.last_refresh_ts) > TTL_MS;
    const obsThresholdReached = existing && existing.staleness_observations_count >= OBS_THRESHOLD;
    const shouldRefresh = ttlExpired || obsThresholdReached;

    if (shouldRefresh) {
        const r = refresh({ cellKey, nowTs });
        // Re-query for n (refresh returns n already)
        return {
            cellKey,
            pooledAlpha: r.pooledAlpha,
            pooledBeta: r.pooledBeta,
            sumContribution: r.sumContribution,
            n: r.n,
            refreshTriggered: true,
            refreshReason: !existing ? 'never_refreshed' : (ttlExpired ? 'ttl_expired' : 'obs_threshold')
        };
    }

    return {
        ...(_hydrate(existing)),
        refreshTriggered: false
    };
}

function incrementStaleness(params) {
    const cellKey = _required(params, 'cellKey');
    const count = _required(params, 'count');
    _stmts.incrementStaleness.run(count, Date.now(), cellKey);
    return { incremented: true };
}

module.exports = { TTL_MS, OBS_THRESHOLD, WINDOW_DAYS, refresh, get, incrementStaleness };
```

- [ ] **Step 4: Verify GREEN**

Run: `cd /root/zeus-terminal && npx jest tests/unit/ml/pooledEvidence.test.js --runInBand 2>&1 | tail -5`

Expected: `Tests: 9 passed`.

The 5th test (`n` field check) — pooledEvidence.get returns `n` only on refresh path. The non-refresh path uses pooled row which doesn't track `n` directly (track via aggregateSince re-query if needed). If a test specifically asserts n on the non-refresh path, the helper needs minor tweak. Verify test expectations match implementation; adjust if minor mismatch.

- [ ] **Step 5: Commit**

```bash
cd /root/zeus-terminal && git add server/services/ml/_ring5/pooledEvidence.js tests/unit/ml/pooledEvidence.test.js
git commit -m "$(cat <<'EOF'
feat(ml-phase-b-day2): pooledEvidence — SPEC-7 lazy-with-TTL refresh

Per-cell aggregated stats refreshed lazily on:
  - TTL 30 min stale
  - 50 new obs since last refresh
  - Forced refresh

30-day rolling window per §97 knowledge expiry. Source of truth =
ml_bandit_evidence atomic rows; pooled row is materialized view.

API: refresh + get (with auto-refresh trigger) + incrementStaleness.

9 tests passing.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3.5: effectiveStatus (ARCH-2 LRU cache + hierarchy walk)

**Files:**
- Create: `server/services/ml/_ring5/effectiveStatus.js`
- Create: `tests/unit/ml/effectiveStatus.test.js`

- [ ] **Step 1: Write the failing test**

Create `/root/zeus-terminal/tests/unit/ml/effectiveStatus.test.js`:

```javascript
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r5-es-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

require('../../../server/services/database');
const bp = require('../../../server/services/ml/_ring5/banditPosteriors');
const es = require('../../../server/services/ml/_ring5/effectiveStatus');

const _now = () => Date.now();

function clean() {
    const { db } = require('../../../server/services/database');
    db.prepare("DELETE FROM ml_bandit_posteriors").run();
    es.resetCacheForTest();
}

describe('effectiveStatus (Phase 3 — ARCH-2 LRU cache + hierarchy)', () => {
    beforeEach(clean);

    describe('constants', () => {
        test('LRU_MAX = 1000', () => {
            expect(es.LRU_MAX).toBe(1000);
        });
        test('TTL_MS = 60000', () => {
            expect(es.TTL_MS).toBe(60_000);
        });
    });

    describe('resolve (hot path)', () => {
        test('returns L0 default on cold start', () => {
            const r = es.resolve({
                userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: _now()
            });
            expect(r.level).toBe(0);
            expect(r.alpha).toBe(1);
            expect(r.beta).toBe(1);
            expect(r.cacheHit).toBe(false);
        });

        test('returns owned L4 when threshold reached', () => {
            for (let i = 0; i < 30; i++) {
                bp.updatePosterior({
                    level: 4, cellKey: '1:DEMO:BTCUSDT:trending',
                    outcomeClass: 'positive', ts: _now()
                });
            }
            const r = es.resolve({
                userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: _now()
            });
            expect(r.level).toBe(4);
            expect(r.alpha).toBe(31);
        });

        test('second call within TTL = cache hit', () => {
            const now = _now();
            es.resolve({ userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: now });
            const second = es.resolve({ userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: now + 1000 });
            expect(second.cacheHit).toBe(true);
        });

        test('call past TTL → cache miss + re-resolve', () => {
            const now = _now();
            es.resolve({ userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: now });
            const second = es.resolve({ userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: now + 65_000 });
            expect(second.cacheHit).toBe(false);
        });
    });

    describe('invalidate', () => {
        test('clears cache entry for specific cell key', () => {
            const now = _now();
            es.resolve({ userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: now });
            es.invalidate({ cellKey: '1:DEMO:BTCUSDT:trending' });
            const second = es.resolve({ userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: now + 1000 });
            expect(second.cacheHit).toBe(false);
        });

        test('invalidateAll clears entire cache', () => {
            const now = _now();
            es.resolve({ userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: now });
            es.resolve({ userId: 2, env: 'DEMO', symbol: 'ETHUSDT', regime: 'ranging', nowTs: now });
            es.invalidateAll();
            const a = es.resolve({ userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: now + 1000 });
            const b = es.resolve({ userId: 2, env: 'DEMO', symbol: 'ETHUSDT', regime: 'ranging', nowTs: now + 1000 });
            expect(a.cacheHit).toBe(false);
            expect(b.cacheHit).toBe(false);
        });
    });

    describe('cache stats', () => {
        test('hit/miss counters', () => {
            const now = _now();
            es.resolve({ userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: now });
            es.resolve({ userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: now + 1000 });
            es.resolve({ userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: now + 2000 });
            const stats = es.getStats();
            expect(stats.hits).toBe(2);
            expect(stats.misses).toBe(1);
            expect(stats.entries).toBeGreaterThan(0);
        });
    });
});
```

- [ ] **Step 2: Verify RED**

Run: `cd /root/zeus-terminal && npx jest tests/unit/ml/effectiveStatus.test.js --runInBand 2>&1 | tail -5`

Expected: `Cannot find module '../../../server/services/ml/_ring5/effectiveStatus'`.

- [ ] **Step 3: Create effectiveStatus.js**

Create `/root/zeus-terminal/server/services/ml/_ring5/effectiveStatus.js`:

```javascript
'use strict';

/**
 * ML Plan v3 Phase 3 — EffectiveStatus resolver (ARCH-2 LRU cache + SPEC-8 hierarchy).
 *
 * Hot-path API for "given (user, env, symbol, regime), what's the effective bandit
 * posterior right now?" Walks the 4-level hierarchy via banditPosteriors.walkHierarchy
 * and caches result in an in-memory LRU Map with TTL.
 *
 * Cache: Map<cellKey, {value, expiresAt}>, LRU eviction at 1000 entries via
 * delete-and-re-insert on hit (insertion-order Map preserves access order).
 *
 * Invalidation:
 *   - TTL: 60s per-entry expiry (each call checks expiresAt)
 *   - Explicit: invalidate({cellKey}) — called on writes that mutate posterior
 *   - invalidateAll() — registry mutations etc
 */

const bp = require('./banditPosteriors');

const LRU_MAX = 1000;
const TTL_MS = 60_000;

const _cache = new Map();
let _hits = 0;
let _misses = 0;

function _required(p, k) {
    if (p == null || p[k] == null) throw new Error(`effectiveStatus: missing ${k}`);
    return p[k];
}

function _evictIfNeeded() {
    while (_cache.size > LRU_MAX) {
        const oldestKey = _cache.keys().next().value;
        _cache.delete(oldestKey);
    }
}

function resolve(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'env');
    const symbol = _required(params, 'symbol');
    const regime = _required(params, 'regime');
    const nowTs = _required(params, 'nowTs');

    const cellKey = `${userId}:${env}:${symbol}:${regime}`;
    const cached = _cache.get(cellKey);
    if (cached && nowTs < cached.expiresAt) {
        // LRU touch: delete + re-insert to move to back
        _cache.delete(cellKey);
        _cache.set(cellKey, cached);
        _hits += 1;
        return { ...cached.value, cacheHit: true };
    }

    _misses += 1;
    const resolved = bp.walkHierarchy({ userId, env, symbol, regime });
    const value = {
        level: resolved.level,
        cellKey: resolved.cellKey,
        alpha: resolved.alpha,
        beta: resolved.beta,
        observationCount: resolved.observationCount
    };
    _cache.set(cellKey, { value, expiresAt: nowTs + TTL_MS });
    _evictIfNeeded();
    return { ...value, cacheHit: false };
}

function invalidate(params) {
    const cellKey = _required(params, 'cellKey');
    // Cell keys may match at any level — clear all that contain this fragment.
    for (const k of [..._cache.keys()]) {
        if (k === cellKey || k.includes(cellKey)) _cache.delete(k);
    }
    return { invalidated: true };
}

function invalidateAll() {
    _cache.clear();
    return { invalidated: true };
}

function getStats() {
    return { hits: _hits, misses: _misses, entries: _cache.size };
}

function resetCacheForTest() {
    _cache.clear();
    _hits = 0;
    _misses = 0;
}

module.exports = {
    LRU_MAX, TTL_MS,
    resolve, invalidate, invalidateAll, getStats, resetCacheForTest
};
```

- [ ] **Step 4: Verify GREEN**

Run: `cd /root/zeus-terminal && npx jest tests/unit/ml/effectiveStatus.test.js --runInBand 2>&1 | tail -5`

Expected: `Tests: 9 passed`.

- [ ] **Step 5: Commit**

```bash
cd /root/zeus-terminal && git add server/services/ml/_ring5/effectiveStatus.js tests/unit/ml/effectiveStatus.test.js
git commit -m "$(cat <<'EOF'
feat(ml-phase-b-day2): effectiveStatus — ARCH-2 LRU cache + SPEC-8 hierarchy walk

Hot-path API resolve({userId, env, symbol, regime, nowTs}) returns owned
posterior or L0 default. In-memory LRU Map cache, 1000 entries cap, 60s TTL.

Cache invalidation:
  - TTL expiry (per-entry expiresAt)
  - Explicit invalidate({cellKey})
  - invalidateAll() for registry-level changes

Stats: hits/misses/entries for observability.

9 tests passing.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3.6: thompsonSampler (public bandit API + Ring5 integration)

**Files:**
- Create: `server/services/ml/_ring5/thompsonSampler.js`
- Create: `tests/unit/ml/thompsonSampler.test.js`
- Modify: `server/services/ml/ring5LearningService.js` (wire recordContribution to thompsonSampler)

- [ ] **Step 1: Write the failing test**

Create `/root/zeus-terminal/tests/unit/ml/thompsonSampler.test.js`:

```javascript
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r5-ts-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const bp = require('../../../server/services/ml/_ring5/banditPosteriors');
const ts_mod = require('../../../server/services/ml/_ring5/thompsonSampler');
const es = require('../../../server/services/ml/_ring5/effectiveStatus');

const _now = () => Date.now();

function clean() {
    db.prepare("DELETE FROM ml_bandit_posteriors").run();
    db.prepare("DELETE FROM ml_bandit_evidence").run();
    db.prepare("DELETE FROM ml_pooled_evidence").run();
    es.resetCacheForTest();
}

describe('thompsonSampler (Phase 3 public API)', () => {
    beforeEach(clean);

    describe('drawSample', () => {
        test('returns sample in [0, 1] from L0 default uniform prior', () => {
            const r = ts_mod.drawSample({
                userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: _now()
            });
            expect(r.sample).toBeGreaterThanOrEqual(0);
            expect(r.sample).toBeLessThanOrEqual(1);
            expect(r.level).toBe(0);
        });

        test('with mostly positive observations, mean draw skews high', () => {
            for (let i = 0; i < 30; i++) {
                bp.updatePosterior({
                    level: 4, cellKey: '1:DEMO:BTCUSDT:trending',
                    outcomeClass: 'positive', ts: _now()
                });
            }
            es.resetCacheForTest();
            const samples = [];
            for (let i = 0; i < 100; i++) {
                samples.push(ts_mod.drawSample({
                    userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: _now()
                }).sample);
            }
            const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
            expect(mean).toBeGreaterThan(0.85);  // α=31, β=1 → expected mean ~0.97
        });
    });

    describe('recordObservation', () => {
        test('writes evidence + updates posterior at L4 + invalidates cache', () => {
            ts_mod.recordObservation({
                userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending',
                moduleId: 'm', contribution: 0.5, confidence: 0.7,
                outcomeClass: 'positive', ts: _now()
            });
            const post = bp.getPosterior({ level: 4, cellKey: '1:DEMO:BTCUSDT:trending' });
            expect(post.alpha).toBe(2);   // 1 + 1 positive
            expect(post.observationCount).toBe(1);
            const evRows = db.prepare("SELECT * FROM ml_bandit_evidence").all();
            expect(evRows.length).toBe(1);
        });

        test('cache invalidated after recordObservation', () => {
            const now = _now();
            ts_mod.drawSample({ userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: now });
            ts_mod.recordObservation({
                userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending',
                moduleId: 'm', contribution: 0.3, confidence: 0.6,
                outcomeClass: 'positive', ts: now
            });
            const second = ts_mod.drawSample({ userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: now + 1 });
            expect(second.cacheHit).toBe(false);  // invalidated by recordObservation
        });
    });
});
```

- [ ] **Step 2: Verify RED**

Run: `cd /root/zeus-terminal && npx jest tests/unit/ml/thompsonSampler.test.js --runInBand 2>&1 | tail -5`

Expected: `Cannot find module '../../../server/services/ml/_ring5/thompsonSampler'`.

- [ ] **Step 3: Create thompsonSampler.js**

Create `/root/zeus-terminal/server/services/ml/_ring5/thompsonSampler.js`:

```javascript
'use strict';

/**
 * ML Plan v3 Phase 3 — Thompson Sampling public API.
 *
 * Composes banditPosteriors + banditEvidence + effectiveStatus into the bandit
 * surface used by Ring5LearningService.recordContribution.
 *
 * API:
 *   - drawSample({userId, env, symbol, regime, nowTs}) →
 *       { sample ∈ [0,1], level, cellKey, alpha, beta }
 *     Beta(α, β) random draw via Cheng's BA algorithm (fast for small a,b).
 *
 *   - recordObservation({userId, env, symbol, regime, moduleId,
 *                      contribution, confidence, outcomeClass, ts}) →
 *       writes evidence row + updates L4 posterior + invalidates cache.
 *
 * No exploration ε (pure Thompson Sampling — exploration emerges naturally
 * from posterior variance, per SPEC-8).
 */

const bp = require('./banditPosteriors');
const be = require('./banditEvidence');
const es = require('./effectiveStatus');

/**
 * Beta(a, b) random draw using Gamma(a)/(Gamma(a)+Gamma(b)).
 * Gamma(k) for k>=1 via Marsaglia-Tsang squeeze; for k<1 via boost.
 * Adequate for production bandit draws — speed > perfect accuracy.
 */
function _gammaSample(k) {
    if (k < 1) {
        // Boost: Gamma(k) = Gamma(k+1) * U^(1/k)
        return _gammaSample(k + 1) * Math.pow(Math.random(), 1 / k);
    }
    const d = k - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    while (true) {
        let x, v;
        do {
            const u1 = Math.random();
            const u2 = Math.random();
            x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
            v = 1 + c * x;
        } while (v <= 0);
        v = v * v * v;
        const u = Math.random();
        if (u < 1 - 0.0331 * x * x * x * x) return d * v;
        if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
}

function _betaSample(alpha, beta) {
    const x = _gammaSample(alpha);
    const y = _gammaSample(beta);
    return x / (x + y);
}

function _required(p, k) {
    if (p == null || p[k] == null) throw new Error(`thompsonSampler: missing ${k}`);
    return p[k];
}

function drawSample(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'env');
    const symbol = _required(params, 'symbol');
    const regime = _required(params, 'regime');
    const nowTs = _required(params, 'nowTs');

    const status = es.resolve({ userId, env, symbol, regime, nowTs });
    const sample = _betaSample(status.alpha, status.beta);
    return {
        sample,
        level: status.level,
        cellKey: status.cellKey,
        alpha: status.alpha,
        beta: status.beta,
        cacheHit: status.cacheHit
    };
}

function recordObservation(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'env');
    const symbol = _required(params, 'symbol');
    const regime = _required(params, 'regime');
    const moduleId = _required(params, 'moduleId');
    const contribution = _required(params, 'contribution');
    const confidence = _required(params, 'confidence');
    const outcomeClass = _required(params, 'outcomeClass');
    const ts = _required(params, 'ts');

    const cellKey = bp.buildCellKey({ level: 4, userId, env, symbol, regime });

    // Atomic-ish sequence: evidence + posterior + cache invalidation.
    be.recordEvidence({ cellKey, moduleId, contribution, confidence, outcomeClass, ts });
    bp.updatePosterior({ level: 4, cellKey, outcomeClass, ts });
    es.invalidate({ cellKey });

    return { recorded: true, cellKey };
}

module.exports = { drawSample, recordObservation };
```

- [ ] **Step 4: Wire ring5LearningService.recordContribution to thompsonSampler**

Modify `/root/zeus-terminal/server/services/ml/ring5LearningService.js` `recordContribution` function. Replace its body with thompsonSampler delegation:

Find:
```javascript
function recordContribution(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _validateEnv(_required(params, 'resolvedEnv'));
    const symbol = _required(params, 'symbol');
    const moduleId = _required(params, 'moduleId');
    const contribution = _required(params, 'contribution');
    const confidence = _required(params, 'confidence');
    const ts = _required(params, 'ts');

    // Phase B Day 1: trust_score initialized to confidence; bandit params stub.
    // Phase 3 will replace this with real Thompson Sampling α/β state.
    _stateHelper.updateModuleState({
        userId, resolvedEnv, symbol, moduleId,
        trustScore: Math.max(0, Math.min(1, confidence)),
        banditParams: { alpha: 1, beta: 1, lastContribution: contribution },
        lastObservedTs: ts,
        ts
    });

    return { recorded: true };
}
```

Replace with:
```javascript
const thompsonSampler = require('./_ring5/thompsonSampler');

function recordContribution(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _validateEnv(_required(params, 'resolvedEnv'));
    const symbol = _required(params, 'symbol');
    const moduleId = _required(params, 'moduleId');
    const contribution = _required(params, 'contribution');
    const confidence = _required(params, 'confidence');
    const ts = _required(params, 'ts');
    const regime = params.regime || 'unknown';

    // [Phase 3 2026-05-17] Map contribution to outcome class. Positive >=0.1,
    // negative <=-0.1, neutral otherwise. Threshold deliberate — small
    // contributions don't move bandit; clear signals do.
    const outcomeClass = contribution >= 0.1 ? 'positive'
                      : contribution <= -0.1 ? 'negative'
                      : 'neutral';

    // Update Thompson Sampling state (posterior + evidence + cache invalidate).
    thompsonSampler.recordObservation({
        userId, env: resolvedEnv, symbol, regime,
        moduleId, contribution, confidence, outcomeClass, ts
    });

    // Continue persisting Ring5 module state (Day 1 contract) for compatibility.
    _stateHelper.updateModuleState({
        userId, resolvedEnv, symbol, moduleId,
        trustScore: Math.max(0, Math.min(1, confidence)),
        banditParams: { lastContribution: contribution, outcomeClass },
        lastObservedTs: ts,
        ts
    });

    return { recorded: true };
}
```

- [ ] **Step 5: Verify all green**

Run: `cd /root/zeus-terminal && npx jest tests/unit/ml/thompsonSampler.test.js tests/unit/ml/ring5LearningService.test.js --runInBand 2>&1 | tail -8`

Expected: All tests pass (thompsonSampler: ~5 passing; ring5LearningService: 10 still passing — the recordContribution shape unchanged so existing tests still hold).

- [ ] **Step 6: Commit**

```bash
cd /root/zeus-terminal && git add server/services/ml/_ring5/thompsonSampler.js server/services/ml/ring5LearningService.js tests/unit/ml/thompsonSampler.test.js
git commit -m "$(cat <<'EOF'
feat(ml-phase-b-day2): thompsonSampler — bandit public API + Ring5 integration

Composes banditPosteriors + banditEvidence + effectiveStatus into the
public bandit surface.

API:
  - drawSample({userId, env, symbol, regime, nowTs}) → Beta(α,β) random draw
  - recordObservation({userId, env, symbol, regime, moduleId, contribution,
                       confidence, outcomeClass, ts}) → atomic-ish
                       evidence + L4 posterior + cache invalidate

Beta sampling via Marsaglia-Tsang Gamma squeeze (no exploration ε —
exploration emerges from posterior variance per SPEC-8).

Ring5LearningService.recordContribution now wires through thompsonSampler:
  - Map contribution to outcome (>=0.1 positive, <=-0.1 negative, else neutral)
  - Update bandit state + invalidate cache
  - Continue Day 1 ring5State update for backward-compat

5 tests passing; Ring5LearningService 10 still GREEN.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3.7: Day 2 closeout — full regression + tag + push + memory

- [ ] **Step 1: Run full regression**

Run: `cd /root/zeus-terminal && npx jest --maxWorkers=2 2>&1 | tail -8`

Expected: total test count INCREASES by ~45 (5 modules × ~9 tests avg) vs post-Day-1 baseline. Zero new failures (the parallel-worker doctorPersistentLogWriter flake may surface; not a Phase B regression).

- [ ] **Step 2: Tag the Phase B Day 2 milestone**

Run: `cd /root/zeus-terminal && git tag "ml-plan-v3-phase-b-day2-phase3-COMPLETE-$(date -u +%Y%m%d-%H%M%S)"`

- [ ] **Step 3: Push branch + tags**

Run: `git push origin omega/wave-1-foundation --tags 2>&1 | tail -5`

Expected: clean push, new tag listed.

- [ ] **Step 4: Update memory**

Edit `/root/.claude/projects/-root/memory/MEMORY.md` ml-plan-v3 entry. Append after "Day 2 NEXT = Phase 3...":

```
**Phase B Day 2 ✅ SHIPPED 2026-05-17** — Phase 3 Thompson Sampling bandit fully shipped: 3 migrations (370 posteriors + 371 pooled + 372 evidence) + banditPosteriors (SPEC-8 4-level hierarchy + 30-trade promotion) + banditEvidence (atomic source-of-truth + windowed aggregation) + pooledEvidence (SPEC-7 lazy-with-TTL refresh) + effectiveStatus (ARCH-2 LRU 1000-entry 60s-TTL cache + hierarchy walk) + thompsonSampler (Beta sampling + recordObservation atomic-ish) + ring5LearningService.recordContribution wired to thompsonSampler. ~45 new tests, regression clean. Tag `ml-plan-v3-phase-b-day2-phase3-COMPLETE-…`. Phase B Day 3 NEXT = Phase 4 reflection enforcement + Phase 5 multi-symbol isolation + Phase 6 OPS hardening + Phase 7 deployment.
```

---

## Self-Review

**1. Spec coverage:**
- SPEC-7 (lazy pooled evidence refresh) — Task 3.4 ✅ (TTL 30min + 50 obs threshold + 30d window)
- SPEC-8 (4-level cell hierarchy + 30-trade promotion) — Task 3.2 ✅ (LEVELS frozen + walkHierarchy + PROMOTION_THRESHOLD)
- ARCH-2 (LRU cache 1000 entries + 60s TTL) — Task 3.5 ✅

**2. Placeholder scan:** None. Every step has exact code + test data + commands + expected output.

**3. Type consistency:**
- `cellKey` (string) consistent across banditPosteriors / banditEvidence / pooledEvidence / effectiveStatus / thompsonSampler
- `outcomeClass` enum ('positive'|'negative'|'neutral') consistent across banditPosteriors + banditEvidence + thompsonSampler
- `level` (0-4) and `LEVELS` frozen array consistent
- `(userId, env, symbol, regime, nowTs)` signature consistent across resolve / drawSample
- `recordObservation` params shape consistent with `recordEvidence` + `updatePosterior` internal calls

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-17-ml-plan-v3-phase-b-day2-phase3.md`.**

**Inline Execution chosen by operator default (no subagent overhead for this layered + tested code).**

**REQUIRED SUB-SKILL:** Use superpowers:executing-plans to run task-by-task.
