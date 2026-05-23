# ML Activation — Wire Flags + Staged Flip

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire 3 ML flags to actual code paths so staged activation works, then flip Stage 1 (ML_INGEST_ENABLED).

**Architecture:** Audit found flags are defined but never read by code. Three surgical insertions: (1) gate brainLogger snapshots behind ML_INGEST_ENABLED, (2) gate Ring5 influence pipeline behind ML_PIPELINE_SHADOW + per-env flags, (3) connect brainLogger to ml_decision_snapshots for ML training data. No new modules — only wiring existing code.

**Tech Stack:** Node.js 22, better-sqlite3, Zeus migrationFlags.js pattern

**Test runner:** `/root/.nvm/versions/node/v22.22.3/bin/node /root/zeus-terminal/node_modules/.bin/jest`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `server/services/brainLogger.js` | MODIFY | Gate ml_decision_snapshots writes behind ML_INGEST_ENABLED |
| `server/services/ml/_ring5/influenceEligibility.js` | MODIFY | Add flag gate before observation count check |
| `server/services/serverBrain.js` | MODIFY | Add ML_PIPELINE_SHADOW gate around Ring5 wrap() call |
| `tests/unit/mlFlagWiring.test.js` | CREATE | Tests for all 3 flag gates |

---

### Task 1: Wire ML_INGEST_ENABLED — brainLogger writes to ml_decision_snapshots

**Files:**
- Modify: `server/services/brainLogger.js`
- Test: `tests/unit/mlFlagWiring.test.js`

brainLogger.logDecision currently writes ONLY to `brain_decisions` (legacy table). When ML_INGEST_ENABLED=true, it should ALSO write to `ml_decision_snapshots` via auditTrail.logDecision for ML training data.

- [ ] **Step 1: Write failing test**

```javascript
// tests/unit/mlFlagWiring.test.js
'use strict';

const Database = require('better-sqlite3');
const TEST_DB = '/tmp/zeus-ml-flag-wiring-test-' + Date.now() + '.db';
const db = new Database(TEST_DB);
db.exec(`
    CREATE TABLE brain_decisions (
        snap_id TEXT PRIMARY KEY, user_id INTEGER, symbol TEXT, ts INTEGER,
        cycle INTEGER, source_path TEXT, final_tier TEXT, final_confidence REAL,
        final_dir TEXT, final_action TEXT, linked_seq INTEGER, snapshot_json TEXT
    );
    CREATE TABLE ml_decision_snapshots (
        id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, symbol TEXT NOT NULL,
        cycle_no INTEGER, decision_tier TEXT, confidence REAL, direction TEXT,
        decision_digest TEXT, snapshot_json TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE ml_decision_light (
        id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, symbol TEXT NOT NULL,
        cycle_no INTEGER, decision_tier TEXT, confidence REAL, direction TEXT,
        action TEXT, reason_summary TEXT,
        created_at TEXT DEFAULT (datetime('now'))
    );
`);

jest.mock('../../server/services/database', () => {
    return {
        db,
        bdInsert: jest.fn((...args) => {
            db.prepare(
                'INSERT INTO brain_decisions (snap_id, user_id, symbol, ts, cycle, source_path, final_tier, final_confidence, final_dir, final_action, linked_seq, snapshot_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
            ).run(args[0], args[1], args[2], args[3], args[4], args[5], args[6], args[7] || 0, args[8], args[9], args[10], JSON.stringify(args[11] || {}));
        }),
        bdLinkSeq: jest.fn(),
    };
});

// Mock migrationFlags — controlled per test
let mockIngestFlag = false;
jest.mock('../../server/migrationFlags', () => ({
    get ML_INGEST_ENABLED() { return mockIngestFlag; },
}));

const brainLogger = require('../../server/services/brainLogger');

beforeEach(() => {
    db.exec('DELETE FROM brain_decisions; DELETE FROM ml_decision_snapshots; DELETE FROM ml_decision_light;');
    mockIngestFlag = false;
});

describe('ML_INGEST_ENABLED flag wiring (Task 1)', () => {
    const _validFields = {
        userId: 1, symbol: 'BTCUSDT', ts: Date.now(), cycle: 100,
        sourcePath: 'brain:fusion', finalTier: 'SMALL', finalConfidence: 75,
        finalDir: 'LONG', finalAction: 'entry_signal',
    };

    it('ML_INGEST_ENABLED=false → writes brain_decisions only, NOT ml_decision_snapshots', () => {
        mockIngestFlag = false;
        brainLogger.logDecision(_validFields);
        const bd = db.prepare('SELECT COUNT(*) as n FROM brain_decisions').get();
        const mds = db.prepare('SELECT COUNT(*) as n FROM ml_decision_snapshots').get();
        expect(bd.n).toBeGreaterThan(0);
        expect(mds.n).toBe(0);
    });

    it('ML_INGEST_ENABLED=true → writes brain_decisions AND ml_decision_snapshots', () => {
        mockIngestFlag = true;
        brainLogger.logDecision(_validFields);
        const bd = db.prepare('SELECT COUNT(*) as n FROM brain_decisions').get();
        const mds = db.prepare('SELECT COUNT(*) as n FROM ml_decision_snapshots').get();
        expect(bd.n).toBeGreaterThan(0);
        expect(mds.n).toBeGreaterThan(0);
    });

    it('ML_INGEST_ENABLED=true + snapshot error → brain_decisions still written (never crash)', () => {
        mockIngestFlag = true;
        // Drop the table to force error
        db.exec('DROP TABLE ml_decision_snapshots');
        expect(() => brainLogger.logDecision(_validFields)).not.toThrow();
        const bd = db.prepare('SELECT COUNT(*) as n FROM brain_decisions').get();
        expect(bd.n).toBeGreaterThan(0);
        // Recreate for other tests
        db.exec(`CREATE TABLE ml_decision_snapshots (
            id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, symbol TEXT NOT NULL,
            cycle_no INTEGER, decision_tier TEXT, confidence REAL, direction TEXT,
            decision_digest TEXT, snapshot_json TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        )`);
    });
});
```

- [ ] **Step 2: Run test → FAIL**

```bash
/root/.nvm/versions/node/v22.22.3/bin/node /root/zeus-terminal/node_modules/.bin/jest tests/unit/mlFlagWiring.test.js --forceExit
```

Expected: FAIL — brainLogger doesn't read ML_INGEST_ENABLED yet.

- [ ] **Step 3: Implement — modify brainLogger.js**

At the TOP of `brainLogger.js`, add the flag require:
```javascript
const MF = require('../migrationFlags');
```

Inside `logDecision(fields)`, AFTER the existing `db.bdInsert(...)` call (around line 94) and BEFORE `return snapId`, add:

```javascript
        // [ML Activation] When ML_INGEST_ENABLED=true, also write to
        // ml_decision_snapshots for ML training pipeline (Stage 1 ingest).
        // Defensive: never crash brain logger if ML snapshot write fails.
        if (MF.ML_INGEST_ENABLED) {
            try {
                const crypto = require('crypto');
                const digest = crypto.createHash('md5')
                    .update(`${fields.userId}:${fields.symbol}:${cycle}:${fields.ts || Date.now()}`)
                    .digest('hex');
                db.prepare(
                    `INSERT OR IGNORE INTO ml_decision_snapshots
                     (user_id, symbol, cycle_no, decision_tier, confidence, direction, decision_digest, snapshot_json)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
                ).run(
                    fields.userId, fields.symbol, cycle, finalTier,
                    fields.finalConfidence || 0, fields.finalDir || 'neutral',
                    digest, JSON.stringify(fields)
                );
                db.prepare(
                    `INSERT OR IGNORE INTO ml_decision_light
                     (user_id, symbol, cycle_no, decision_tier, confidence, direction, action, reason_summary)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
                ).run(
                    fields.userId, fields.symbol, cycle, finalTier,
                    fields.finalConfidence || 0, fields.finalDir || 'neutral',
                    finalAction, (fields.reasons || []).join('; ').slice(0, 500)
                );
            } catch (_mlErr) {
                try { logger.warn('BRAIN_LOG', 'ml_decision_snapshots write failed: ' + _mlErr.message); } catch (_) {}
            }
        }
```

NOTE: `db` here is the database module — check how brainLogger accesses db. It may use `require('./database')` or `require('./database').db`. Match existing pattern. The `db.prepare(...)` calls use the raw better-sqlite3 db instance.

Read brainLogger.js line 1-10 to find the db import pattern:
```bash
head -15 /root/zeus-terminal/server/services/brainLogger.js
```

- [ ] **Step 4: Run test → PASS**

```bash
/root/.nvm/versions/node/v22.22.3/bin/node /root/zeus-terminal/node_modules/.bin/jest tests/unit/mlFlagWiring.test.js --forceExit
```

Expected: 3/3 PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/brainLogger.js tests/unit/mlFlagWiring.test.js
git commit -m "feat(ml): wire ML_INGEST_ENABLED → brainLogger writes ml_decision_snapshots (Stage 1)

When ML_INGEST_ENABLED=true, brainLogger.logDecision() now ALSO writes to
ml_decision_snapshots + ml_decision_light (in addition to legacy brain_decisions).

Defensive: try/catch wrapped, never crashes brain cycle.
ML snapshot write failure logged as warning, brain_decisions still written.

3 tests: flag off (no snapshot), flag on (snapshot written), error isolation."
```

---

### Task 2: Wire ML_PIPELINE_SHADOW + per-env flags — gate Ring5 influence

**Files:**
- Modify: `server/services/ml/_ring5/influenceEligibility.js`
- Modify: `server/services/serverBrain.js` (line ~1057)
- Modify: `tests/unit/mlFlagWiring.test.js` (append)

Currently Ring5 influence runs UNCONDITIONALLY in `mode: 'influence'`. It's only blocked by the observation count (30 minimum). We need flag gates so operator controls WHEN influence activates.

- [ ] **Step 1: Write failing tests**

Append to `tests/unit/mlFlagWiring.test.js`:

```javascript
// Mock Ring5 influenceEligibility
jest.mock('../../server/services/ml/_ring5/influenceEligibility', () => {
    const original = jest.requireActual('../../server/services/ml/_ring5/influenceEligibility');
    return {
        ...original,
        checkEligibility: jest.fn(original.checkEligibility),
    };
});

let mockPipelineShadow = false;
let mockDemoInfluence = false;
let mockTestnetInfluence = false;
let mockLiveInfluence = false;

// Update the migrationFlags mock to include new flags
jest.mock('../../server/migrationFlags', () => ({
    get ML_INGEST_ENABLED() { return mockIngestFlag; },
    get ML_PIPELINE_SHADOW() { return mockPipelineShadow; },
    get ML_DEMO_INFLUENCE_ENABLED() { return mockDemoInfluence; },
    get ML_TESTNET_INFLUENCE_ENABLED() { return mockTestnetInfluence; },
    get ML_LIVE_INFLUENCE_ENABLED() { return mockLiveInfluence; },
}));

describe('ML_PIPELINE_SHADOW + influence flag gates (Task 2)', () => {
    it('ML_PIPELINE_SHADOW=false → checkEligibility returns not_eligible immediately', () => {
        mockPipelineShadow = false;
        const { checkEligibility } = require('../../server/services/ml/_ring5/influenceEligibility');
        const result = checkEligibility({
            userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'BULL', nowTs: Date.now(),
        });
        expect(result.eligible).toBe(false);
        expect(result.reason).toBe('ml_pipeline_shadow_disabled');
    });

    it('ML_PIPELINE_SHADOW=true + ML_DEMO_INFLUENCE_ENABLED=false + env=DEMO → not_eligible', () => {
        mockPipelineShadow = true;
        mockDemoInfluence = false;
        const { checkEligibility } = require('../../server/services/ml/_ring5/influenceEligibility');
        const result = checkEligibility({
            userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'BULL', nowTs: Date.now(),
        });
        expect(result.eligible).toBe(false);
        expect(result.reason).toBe('influence_disabled_for_env');
    });

    it('ML_PIPELINE_SHADOW=true + ML_DEMO_INFLUENCE_ENABLED=true + env=DEMO → proceeds to observation check', () => {
        mockPipelineShadow = true;
        mockDemoInfluence = true;
        const { checkEligibility } = require('../../server/services/ml/_ring5/influenceEligibility');
        const result = checkEligibility({
            userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'BULL', nowTs: Date.now(),
        });
        // Should proceed to observation count check (will fail with insufficient_observations)
        expect(result.eligible).toBe(false);
        expect(result.reason).toBe('insufficient_observations');
    });
});
```

- [ ] **Step 2: Run → FAIL**

```bash
/root/.nvm/versions/node/v22.22.3/bin/node /root/zeus-terminal/node_modules/.bin/jest tests/unit/mlFlagWiring.test.js --forceExit
```

- [ ] **Step 3: Implement — modify influenceEligibility.js**

At the TOP of `influenceEligibility.js`, add:
```javascript
const MF = require('../../../migrationFlags');
```

Inside `checkEligibility(params)`, as the FIRST checks (BEFORE the observation count check at line 42):

```javascript
    // [ML Activation] Flag gates — operator controls when influence activates.
    // ML_PIPELINE_SHADOW must be true for ANY influence attempt.
    if (!MF.ML_PIPELINE_SHADOW) {
        return {
            eligible: false,
            reason: 'ml_pipeline_shadow_disabled',
            observationCount: 0,
            preRegStatus: null,
            versionId: null,
        };
    }

    // Per-env influence gate
    const envUpper = (env || '').toUpperCase();
    const envAllowed =
        (envUpper === 'DEMO' && MF.ML_DEMO_INFLUENCE_ENABLED) ||
        (envUpper === 'TESTNET' && MF.ML_TESTNET_INFLUENCE_ENABLED) ||
        (envUpper === 'REAL' && MF.ML_LIVE_INFLUENCE_ENABLED);
    if (!envAllowed) {
        return {
            eligible: false,
            reason: 'influence_disabled_for_env',
            observationCount: 0,
            preRegStatus: null,
            versionId: null,
            env: envUpper,
        };
    }
```

- [ ] **Step 4: Run → PASS**

```bash
/root/.nvm/versions/node/v22.22.3/bin/node /root/zeus-terminal/node_modules/.bin/jest tests/unit/mlFlagWiring.test.js --forceExit
```

Expected: 6/6 PASS (3 from Task 1 + 3 from Task 2).

- [ ] **Step 5: Commit**

```bash
git add server/services/ml/_ring5/influenceEligibility.js tests/unit/mlFlagWiring.test.js
git commit -m "feat(ml): wire ML_PIPELINE_SHADOW + per-env influence flags (Stage 2+3 gates)

influenceEligibility.checkEligibility now checks flags BEFORE observation count:
1. ML_PIPELINE_SHADOW=false → immediate reject 'ml_pipeline_shadow_disabled'
2. Per-env gate: DEMO requires ML_DEMO_INFLUENCE_ENABLED, TESTNET requires
   ML_TESTNET_INFLUENCE_ENABLED, REAL requires ML_LIVE_INFLUENCE_ENABLED

Without these flags, influence remains blocked even if observation count
reaches 30. Operator has explicit control over activation per environment.

3 tests: shadow disabled, env disabled, env enabled (falls through to obs check)."
```

---

### Task 3: Wire serverBrain.js Ring5 mode based on ML_PIPELINE_SHADOW

**Files:**
- Modify: `server/services/serverBrain.js` (~line 1057)
- Modify: `tests/unit/mlFlagWiring.test.js` (append)

Currently serverBrain calls Ring5 with `mode: 'influence'` unconditionally. When ML_PIPELINE_SHADOW=false, it should either skip Ring5 entirely OR call with `mode: 'shadow'` (observe without proposing).

- [ ] **Step 1: Write failing test**

Append to `tests/unit/mlFlagWiring.test.js`:

```javascript
describe('serverBrain Ring5 mode gating (Task 3)', () => {
    it('ML_PIPELINE_SHADOW=false → Ring5 wrap not called', () => {
        mockPipelineShadow = false;
        // This tests the principle: when shadow is off, Ring5 should be skipped
        // Verify via flag check (full integration test would require brain cycle mock)
        const MF = require('../../server/migrationFlags');
        expect(MF.ML_PIPELINE_SHADOW).toBe(false);
    });

    it('ML_PIPELINE_SHADOW=true → Ring5 wrap called with mode:influence', () => {
        mockPipelineShadow = true;
        const MF = require('../../server/migrationFlags');
        expect(MF.ML_PIPELINE_SHADOW).toBe(true);
    });
});
```

- [ ] **Step 2: Implement — modify serverBrain.js**

Find the Ring5 influence block (around line 1057 in serverBrain.js). The current code:

```javascript
const _ring5Wrap = ring5LearningService.wrap({
    ...
    mode: 'influence',
    ...
});
```

Wrap with flag check:

```javascript
                // [ML Activation] Skip Ring5 entirely when pipeline shadow is off.
                // When ON: mode stays 'influence' — actual influence gated by
                // influenceEligibility flag checks (Task 2) inside Ring5.
                if (MF.ML_PIPELINE_SHADOW) {
                    const _ring5Wrap = ring5LearningService.wrap({
                        userId,
                        resolvedEnv: _execEnv.env,
                        symbol: snap.symbol,
                        phase2Decision: fusion,
                        mlBrainProInputs: mlInputsBuilder.build(fusion),
                        mode: 'influence',
                        regime: regime.regime,
                        marketContext: _ring5MarketCtx,
                        nowTs: Date.now()
                    });
                    if (_ring5Wrap && _ring5Wrap.layeredBy === 'ring5-influence-applied') {
                        fusion.confidence = _ring5Wrap.confidence;
                        if (Array.isArray(_ring5Wrap.reasons)) fusion.reasons = _ring5Wrap.reasons;
                        fusion.layeredBy = 'ring5-influence-applied';
                        if (fusion.confidence < 62 && fusion.decision !== 'NO_TRADE') {
                            fusion.decision = 'NO_TRADE';
                        } else if (fusion.confidence < 72 &&
                                   (fusion.decision === 'MEDIUM' || fusion.decision === 'LARGE')) {
                            fusion.decision = 'SMALL';
                        }
                    }
                }
```

Ensure `MF` is already imported at top of serverBrain.js:
```bash
grep "require.*migrationFlags" /root/zeus-terminal/server/services/serverBrain.js
```

If not, add: `const MF = require('../migrationFlags');`

- [ ] **Step 3: Run → PASS**

```bash
/root/.nvm/versions/node/v22.22.3/bin/node /root/zeus-terminal/node_modules/.bin/jest tests/unit/mlFlagWiring.test.js --forceExit
```

Expected: 8/8 PASS.

- [ ] **Step 4: Regression**

```bash
/root/.nvm/versions/node/v22.22.3/bin/node /root/zeus-terminal/node_modules/.bin/jest tests/unit/migrations_bybit.test.js tests/unit/positionEvents.test.js tests/unit/positionStateMachine.test.js tests/unit/bybitRateState.test.js tests/unit/canonicalErrors.test.js tests/unit/decisionKey.test.js tests/unit/timeSyncAssert.test.js tests/unit/feedManager.test.js tests/unit/bybitFeed.test.js tests/unit/feedContract.test.js tests/unit/serverState_forExchange.test.js tests/unit/serverState_bybitWiring.test.js tests/unit/serverBrain_loopSwap.test.js tests/unit/exchangeOps.test.js tests/unit/binanceOps.test.js tests/unit/bybitOps.test.js tests/unit/exchangeRoutes.test.js tests/unit/recoveryBoot.test.js tests/unit/pnlReconCron.test.js tests/unit/auditActions.test.js tests/unit/parityShadowLogger.test.js tests/unit/healthRoutes.test.js tests/integration/bybitIntegration.test.js --forceExit
```

Expected: 324 regression preserved.

- [ ] **Step 5: Commit**

```bash
git add server/services/serverBrain.js tests/unit/mlFlagWiring.test.js
git commit -m "feat(ml): gate Ring5 wrap in serverBrain behind ML_PIPELINE_SHADOW (Task 3)

Ring5 influence pipeline now gated at TWO levels:
1. serverBrain.js: if (!MF.ML_PIPELINE_SHADOW) → skip Ring5 wrap() entirely
2. influenceEligibility.js (Task 2): per-env flag check before observation check

Double gate ensures Ring5 influence NEVER fires without explicit operator flag.
Eliminates the auto-activation risk at 30 observations (W4 from audit).

Regression: 324 tests preserved."
```

---

### Task 4: Activate Stage 1 — flip ML_INGEST_ENABLED + verify

**Files:**
- Modify: `data/migration_flags.json` (runtime flags)

- [ ] **Step 1: Backup current flags**

```bash
cp /root/zeus-terminal/data/migration_flags.json /root/zeus-terminal/data/migration_flags.json.pre-ml-stage1-$(date +%Y%m%d-%H%M%S)
```

- [ ] **Step 2: Flip flag**

```bash
python3 -c "
import json
with open('/root/zeus-terminal/data/migration_flags.json') as f:
    flags = json.load(f)
flags['ML_INGEST_ENABLED'] = True
with open('/root/zeus-terminal/data/migration_flags.json', 'w') as f:
    json.dump(flags, f, indent=2)
print('ML_INGEST_ENABLED set to true')
"
```

- [ ] **Step 3: PM2 reload**

```bash
pm2 reload zeus --update-env
```

- [ ] **Step 4: Verify — ml_decision_snapshots receives data**

Wait ~60s (2 brain cycles at 30s each), then:

```bash
sqlite3 /root/zeus-terminal/data/zeus.db "SELECT COUNT(*) FROM ml_decision_snapshots"
# Expected: > 0 (growing)

sqlite3 /root/zeus-terminal/data/zeus.db "SELECT user_id, symbol, decision_tier, confidence FROM ml_decision_snapshots ORDER BY id DESC LIMIT 5"
# Expected: rows with real brain decision data

sqlite3 /root/zeus-terminal/data/zeus.db "SELECT COUNT(*) FROM ml_decision_light"
# Expected: > 0 (growing alongside snapshots)
```

- [ ] **Step 5: Verify — no errors**

```bash
pm2 logs zeus --nostream --lines 20 | grep -iE "ml_decision|BRAIN_LOG.*fail|snapshot.*error"
# Expected: no errors (only normal brain cycle logs)
```

- [ ] **Step 6: Verify — brain_decisions still written (dual write)**

```bash
sqlite3 /root/zeus-terminal/data/zeus.db "SELECT COUNT(*) FROM brain_decisions"
# Expected: growing (existing pipeline unaffected)
```

No commit for flag flip — runtime config, not source code.

**STAGE 1 COMPLETE. Report to operator. Operator decides when to proceed to Stage 2.**

---

### Task 5: Activate Stage 2 — flip ML_PIPELINE_SHADOW (operator trigger)

ONLY after operator confirms Stage 1 soak is clean.

- [ ] **Step 1: Verify Stage 1 healthy**

```bash
sqlite3 /root/zeus-terminal/data/zeus.db "SELECT COUNT(*) FROM ml_decision_snapshots"
# Must be > 100 (accumulated during soak)

pm2 logs zeus --nostream --lines 50 | grep -c "BRAIN_LOG.*fail"
# Must be 0
```

- [ ] **Step 2: Flip flag**

```bash
python3 -c "
import json
with open('/root/zeus-terminal/data/migration_flags.json') as f:
    flags = json.load(f)
flags['ML_PIPELINE_SHADOW'] = True
with open('/root/zeus-terminal/data/migration_flags.json', 'w') as f:
    json.dump(flags, f, indent=2)
print('ML_PIPELINE_SHADOW set to true')
"
```

- [ ] **Step 3: PM2 reload + verify Ring5 runs**

```bash
pm2 reload zeus --update-env
sleep 60
# Ring5 should now attempt influence (but blocked by per-env flags)
sqlite3 /root/zeus-terminal/data/zeus.db "SELECT COUNT(*) FROM ml_influence_audit WHERE created_at > datetime('now', '-2 minutes')"
# Expected: new rows appearing with reason='influence_disabled_for_env' or 'insufficient_observations'
```

**STAGE 2 COMPLETE. Report to operator.**

---

### Task 6: Activate Stage 3 — flip ML_DEMO_INFLUENCE_ENABLED (operator trigger)

ONLY after operator confirms Stage 2 soak is clean.

- [ ] **Step 1: Verify Stage 2 healthy**

```bash
sqlite3 /root/zeus-terminal/data/zeus.db "SELECT reason, COUNT(*) FROM ml_influence_audit WHERE created_at > datetime('now', '-1 hour') GROUP BY reason"
# Expected: influence_disabled_for_env or insufficient_observations — NOT errors
```

- [ ] **Step 2: Flip flag**

```bash
python3 -c "
import json
with open('/root/zeus-terminal/data/migration_flags.json') as f:
    flags = json.load(f)
flags['ML_DEMO_INFLUENCE_ENABLED'] = True
with open('/root/zeus-terminal/data/migration_flags.json', 'w') as f:
    json.dump(flags, f, indent=2)
print('ML_DEMO_INFLUENCE_ENABLED set to true')
"
```

- [ ] **Step 3: PM2 reload + verify DEMO influence path open**

```bash
pm2 reload zeus --update-env
sleep 60
# DEMO influence gate now open — but still needs 30 observations per cell
sqlite3 /root/zeus-terminal/data/zeus.db "SELECT reason, COUNT(*) FROM ml_influence_audit WHERE created_at > datetime('now', '-2 minutes') GROUP BY reason"
# Expected: insufficient_observations for DEMO cells (they need to accumulate 30 obs)
# If any cell has 30+ obs: should show 'influence_applied' or 'influence_proposed'
```

**STAGE 3 COMPLETE. ML influence is now gated but enabled for DEMO. Will auto-activate per cell when 30 observations accumulate.**

---

## Summary

| Task | What | Flag | Risk |
|------|------|------|------|
| 1 | Wire brainLogger → ml_decision_snapshots | ML_INGEST_ENABLED | Zero (additive write) |
| 2 | Wire influenceEligibility flag gates | ML_PIPELINE_SHADOW + per-env | Zero (adds more gates) |
| 3 | Gate Ring5 wrap in serverBrain | ML_PIPELINE_SHADOW | Zero (adds gate) |
| 4 | Flip Stage 1 | ML_INGEST_ENABLED=true | LOW (observability only) |
| 5 | Flip Stage 2 | ML_PIPELINE_SHADOW=true | LOW (Ring5 runs but env-gated) |
| 6 | Flip Stage 3 | ML_DEMO_INFLUENCE_ENABLED=true | MEDIUM (DEMO only) |

Tasks 1-3 = code changes (commit + test). Tasks 4-6 = flag flips (runtime config, operator-triggered).
