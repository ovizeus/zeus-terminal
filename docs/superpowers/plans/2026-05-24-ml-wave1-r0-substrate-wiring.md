# Wave 1: R0 Substrate + R-1 Test Harness Wiring

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire 5 inactive R0 modules into production + upgrade R-1 replayEngine from stub to functional.

**Architecture:** Each R0 module has a complete implementation that writes to DB — we add call sites in existing hot-path code (serverBrain, brainLogger, migrationFlags, cron). Lazy-require + try/catch isolation pattern (telemetry never blocks production). Test runner: `/root/.nvm/versions/node/v22.22.3/bin/node /root/zeus-terminal/node_modules/.bin/jest`

**Tech Stack:** Node.js 22, better-sqlite3, PM2 cluster, Jest

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `server/services/serverBrain.js` | MODIFY (lines 1371-1377) | Add deadMansSwitch.emitHeartbeat in finally block |
| `server/services/brainLogger.js` | MODIFY | Add pointInTimeStore.recordSnapshot after ML ingest |
| `server/services/migrationFlags.js` | MODIFY (set method) | Add configRollback.snapshotConfig on flag change |
| `server/services/database.js` | MODIFY | Add dbContentionMonitor wrapper for slow queries |
| `server/cron/r0SubstrateCron.js` | CREATE | disasterRecoveryOrchestrator heartbeat + backup cron |
| `server/index.js` or `server.js` | MODIFY | Boot r0SubstrateCron |
| `server/services/ml/R-1_testHarness/replayEngine.js` | MODIFY | Real replay from ml_decision_snapshots |
| `tests/unit/ml/wave1_deadMansWiring.test.js` | CREATE | |
| `tests/unit/ml/wave1_pitWiring.test.js` | CREATE | |
| `tests/unit/ml/wave1_configRollbackWiring.test.js` | CREATE | |
| `tests/unit/ml/wave1_dbContentionWiring.test.js` | CREATE | |
| `tests/unit/ml/wave1_drCron.test.js` | CREATE | |
| `tests/unit/ml/wave1_replayEngine.test.js` | CREATE | |

---

### Task 1: Dead Man's Switch — Brain Heartbeat Wiring

**Files:**
- Modify: `server/services/serverBrain.js:1371-1377`
- Test: `tests/unit/ml/wave1_deadMansWiring.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';
const { db } = require('../../server/services/database');

beforeEach(() => {
  db.prepare('DELETE FROM ml_heartbeat_state').run();
});

afterAll(() => {
  db.prepare('DELETE FROM ml_heartbeat_state').run();
});

describe('Wave 1: deadMansSwitch brain wiring', () => {
  test('emitHeartbeat writes row to ml_heartbeat_state after brain cycle', () => {
    const dms = require('../../server/services/ml/R0_substrate/deadMansSwitch');
    // Simulate what serverBrain finally block should do
    dms.emitHeartbeat({ userId: 1, resolvedEnv: 'DEMO' });
    const row = db.prepare('SELECT * FROM ml_heartbeat_state WHERE user_id = 1 AND resolved_env = ?').get('DEMO');
    expect(row).not.toBeNull();
    expect(row.last_heartbeat_ts).toBeGreaterThan(0);
    expect(row.status).toBe('LIVE');
  });

  test('checkHeartbeatStaleness returns LIVE when recent heartbeat', () => {
    const dms = require('../../server/services/ml/R0_substrate/deadMansSwitch');
    dms.emitHeartbeat({ userId: 1, resolvedEnv: 'DEMO' });
    const result = dms.checkHeartbeatStaleness({ userId: 1, resolvedEnv: 'DEMO' });
    expect(result.status).toBe('LIVE');
    expect(result.stale).toBe(false);
  });

  test('checkHeartbeatStaleness returns STALE after threshold', () => {
    const dms = require('../../server/services/ml/R0_substrate/deadMansSwitch');
    dms.configureThresholds({ userId: 1, resolvedEnv: 'DEMO', stalenessMs: 100 });
    dms.emitHeartbeat({ userId: 1, resolvedEnv: 'DEMO', ts: Date.now() - 200 });
    const result = dms.checkHeartbeatStaleness({ userId: 1, resolvedEnv: 'DEMO' });
    expect(result.status).toBe('STALE');
    expect(result.stale).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it passes (module already works)**

Run: `/root/.nvm/versions/node/v22.22.3/bin/node /root/zeus-terminal/node_modules/.bin/jest tests/unit/ml/wave1_deadMansWiring.test.js --forceExit --no-coverage`
Expected: PASS (deadMansSwitch module already implemented)

- [ ] **Step 3: Wire emitHeartbeat into serverBrain.js finally block**

In `server/services/serverBrain.js` at line 1374, after `_recordInvocation(...)`, add:

```javascript
        // [Wave 1] R0 dead man's switch — heartbeat per brain cycle.
        // Proves brain is alive; staleness triggers Doctor alert.
        try {
            const _dms = require('./ml/R0_substrate/deadMansSwitch');
            const _activeUserIds = [..._stcMap.keys()];
            for (const _uid of _activeUserIds) {
                _dms.emitHeartbeat({ userId: _uid, resolvedEnv: (serverAT.getMode(_uid) || 'demo').toUpperCase() });
            }
        } catch (_) { /* never block brain cycle on telemetry */ }
```

- [ ] **Step 4: Verify existing tests still pass**

Run: `/root/.nvm/versions/node/v22.22.3/bin/node /root/zeus-terminal/node_modules/.bin/jest tests/unit/ml/wave1_deadMansWiring.test.js tests/unit/ml/deadMansSwitch.test.js --forceExit --no-coverage`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add server/services/serverBrain.js tests/unit/ml/wave1_deadMansWiring.test.js
git commit -m "feat(wave1): wire deadMansSwitch heartbeat into brain cycle finally block"
```

---

### Task 2: Point-in-Time Store — Decision Snapshots Wiring

**Files:**
- Modify: `server/services/brainLogger.js`
- Test: `tests/unit/ml/wave1_pitWiring.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';
const { db } = require('../../server/services/database');

beforeEach(() => {
  db.prepare('DELETE FROM ml_pit_snapshots WHERE user_id = 99').run();
});

afterAll(() => {
  db.prepare('DELETE FROM ml_pit_snapshots WHERE user_id = 99').run();
});

describe('Wave 1: pointInTimeStore wiring via brainLogger', () => {
  test('recordSnapshot stores decision snapshot with market state', () => {
    const pit = require('../../server/services/ml/R0_substrate/pointInTimeStore');
    const result = pit.recordSnapshot({
      userId: 99,
      resolvedEnv: 'DEMO',
      snapshotType: 'decision',
      ts: Date.now(),
      marketState: { symbol: 'BTCUSDT', price: 67000, regime: 'TREND' },
      modelOutput: { score: 72, dir: 'bull', tier: 'MEDIUM' },
      scores: { regime: 0.8, alignment: 0.7 },
    });
    expect(result).toBeDefined();

    const row = db.prepare('SELECT * FROM ml_pit_snapshots WHERE user_id = 99 ORDER BY id DESC LIMIT 1').get();
    expect(row).not.toBeNull();
    expect(row.snapshot_type).toBe('decision');
    expect(JSON.parse(row.market_state_json).symbol).toBe('BTCUSDT');
  });

  test('getStateAt retrieves latest snapshot at or before timestamp', () => {
    const pit = require('../../server/services/ml/R0_substrate/pointInTimeStore');
    const ts = Date.now() - 5000;
    pit.recordSnapshot({
      userId: 99, resolvedEnv: 'DEMO', snapshotType: 'decision', ts,
      marketState: { price: 65000 },
    });
    const result = pit.getStateAt({ userId: 99, resolvedEnv: 'DEMO', ts: Date.now() });
    expect(result).not.toBeNull();
    expect(JSON.parse(result.market_state_json).price).toBe(65000);
  });
});
```

- [ ] **Step 2: Run test to verify it passes (module already works)**

Run: `/root/.nvm/versions/node/v22.22.3/bin/node /root/zeus-terminal/node_modules/.bin/jest tests/unit/ml/wave1_pitWiring.test.js --forceExit --no-coverage`
Expected: PASS

- [ ] **Step 3: Wire pointInTimeStore into brainLogger.logDecision**

In `server/services/brainLogger.js`, after the `ml_decision_light` INSERT block (gated by `MF.ML_INGEST_ENABLED`), add:

```javascript
        // [Wave 1] R0 point-in-time store — full decision snapshot for deterministic replay.
        try {
            const pit = require('./ml/R0_substrate/pointInTimeStore');
            pit.recordSnapshot({
                userId: fields.userId,
                resolvedEnv: fields.resolvedEnv || 'DEMO',
                snapshotType: 'decision',
                ts: fields.ts || Date.now(),
                marketState: { symbol: fields.symbol, price: fields.price, regime: fields.regime },
                featureState: fields.indicators ? { indicators: fields.indicators } : null,
                modelOutput: { score: fields.score, dir: fields.dir, tier: fields.finalTier, action: fields.finalAction },
                scores: fields.scores || null,
                orderIntent: fields.orderIntent || null,
            });
        } catch (_) { /* never block brain logger on PIT store */ }
```

- [ ] **Step 4: Run full ML test suite to verify no regression**

Run: `/root/.nvm/versions/node/v22.22.3/bin/node /root/zeus-terminal/node_modules/.bin/jest tests/unit/ml/wave1_pitWiring.test.js tests/unit/ml/pointInTimeStore.test.js tests/unit/mlFlagWiring.test.js --forceExit --no-coverage`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add server/services/brainLogger.js tests/unit/ml/wave1_pitWiring.test.js
git commit -m "feat(wave1): wire pointInTimeStore into brainLogger for decision snapshots"
```

---

### Task 3: Config Rollback — Flag Change Pipeline Wiring

**Files:**
- Modify: `server/migrationFlags.js`
- Test: `tests/unit/ml/wave1_configRollbackWiring.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';
const { db } = require('../../server/services/database');

beforeEach(() => {
  db.prepare("DELETE FROM ml_config_snapshots WHERE config_key = 'TEST_FLAG'").run();
});

afterAll(() => {
  db.prepare("DELETE FROM ml_config_snapshots WHERE config_key = 'TEST_FLAG'").run();
});

describe('Wave 1: configRollback wiring on flag change', () => {
  test('snapshotConfig records flag value with version', () => {
    const cr = require('../../server/services/ml/R0_substrate/configRollback');
    cr.snapshotConfig({
      userId: 0, resolvedEnv: 'SYSTEM',
      configKey: 'TEST_FLAG', value: true, version: 1,
      actor: 'operator', reason: 'manual_flip',
    });
    const row = db.prepare("SELECT * FROM ml_config_snapshots WHERE config_key = 'TEST_FLAG' AND is_active = 1").get();
    expect(row).not.toBeNull();
    expect(JSON.parse(row.value_json)).toBe(true);
    expect(row.version).toBe(1);
  });

  test('getCurrentConfig returns latest active snapshot', () => {
    const cr = require('../../server/services/ml/R0_substrate/configRollback');
    cr.snapshotConfig({ userId: 0, resolvedEnv: 'SYSTEM', configKey: 'TEST_FLAG', value: false, version: 1, actor: 'test' });
    cr.snapshotConfig({ userId: 0, resolvedEnv: 'SYSTEM', configKey: 'TEST_FLAG', value: true, version: 2, actor: 'test' });
    const current = cr.getCurrentConfig({ userId: 0, resolvedEnv: 'SYSTEM', configKey: 'TEST_FLAG' });
    expect(current).not.toBeNull();
    expect(current.version).toBe(2);
    expect(JSON.parse(current.value_json)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `/root/.nvm/versions/node/v22.22.3/bin/node /root/zeus-terminal/node_modules/.bin/jest tests/unit/ml/wave1_configRollbackWiring.test.js --forceExit --no-coverage`
Expected: PASS

- [ ] **Step 3: Wire configRollback into migrationFlags.set()**

In `server/migrationFlags.js`, inside the `set(key, value)` method, after the flag is persisted to JSON file, add:

```javascript
        // [Wave 1] R0 config rollback — snapshot every flag change for <60s rollback.
        try {
            const cr = require('./services/ml/R0_substrate/configRollback');
            const currentVersion = db.prepare(
                "SELECT MAX(version) as v FROM ml_config_snapshots WHERE config_key = ?"
            ).get(key);
            const nextVersion = (currentVersion && currentVersion.v ? currentVersion.v : 0) + 1;
            cr.snapshotConfig({
                userId: 0, resolvedEnv: 'SYSTEM',
                configKey: key, value, version: nextVersion,
                actor: 'migrationFlags.set', reason: 'flag_change',
            });
        } catch (_) { /* never block flag set on rollback snapshot */ }
```

- [ ] **Step 4: Run tests**

Run: `/root/.nvm/versions/node/v22.22.3/bin/node /root/zeus-terminal/node_modules/.bin/jest tests/unit/ml/wave1_configRollbackWiring.test.js tests/unit/ml/configRollback.test.js --forceExit --no-coverage`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add server/migrationFlags.js tests/unit/ml/wave1_configRollbackWiring.test.js
git commit -m "feat(wave1): wire configRollback snapshot into migrationFlags.set()"
```

---

### Task 4: DB Contention Monitor — Query Instrumentation

**Files:**
- Modify: `server/services/database.js`
- Test: `tests/unit/ml/wave1_dbContentionWiring.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';
const { db } = require('../../server/services/database');

beforeEach(() => {
  db.prepare("DELETE FROM ml_db_contention_log WHERE user_id = 99").run();
});

afterAll(() => {
  db.prepare("DELETE FROM ml_db_contention_log WHERE user_id = 99").run();
});

describe('Wave 1: dbContentionMonitor wiring', () => {
  test('recordOperation logs slow query to ml_db_contention_log', () => {
    const dcm = require('../../server/services/ml/R0_substrate/dbContentionMonitor');
    dcm.recordOperation({
      userId: 99, resolvedEnv: 'DEMO',
      operation: 'write', durationMs: 150, lockWaitMs: 60,
    });
    const row = db.prepare('SELECT * FROM ml_db_contention_log WHERE user_id = 99 ORDER BY id DESC LIMIT 1').get();
    expect(row).not.toBeNull();
    expect(row.duration_ms).toBe(150);
    expect(row.lock_wait_ms).toBe(60);
  });

  test('detectContention identifies high contention from ops array', () => {
    const dcm = require('../../server/services/ml/R0_substrate/dbContentionMonitor');
    const ops = [
      { durationMs: 150, lockWaitMs: 60 },
      { durationMs: 200, lockWaitMs: 80 },
      { durationMs: 50, lockWaitMs: 10 },
    ];
    const result = dcm.detectContention({ recentOps: ops });
    expect(result.hasContention).toBe(true);
    expect(result.slowOpsCount).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `/root/.nvm/versions/node/v22.22.3/bin/node /root/zeus-terminal/node_modules/.bin/jest tests/unit/ml/wave1_dbContentionWiring.test.js --forceExit --no-coverage`
Expected: PASS

- [ ] **Step 3: Add slow-query instrumentation to database.js**

At the end of `server/services/database.js`, add a monitoring helper that the brain cycle calls periodically:

```javascript
// [Wave 1] R0 DB contention monitor — samples slow queries per brain cycle.
// Called from serverBrain finally block. Lightweight: only records if duration > threshold.
let _contentionMonitor = null;
function recordSlowQuery(userId, resolvedEnv, operation, durationMs) {
    if (durationMs < 100) return; // only log slow ops (>100ms)
    try {
        if (!_contentionMonitor) _contentionMonitor = require('./ml/R0_substrate/dbContentionMonitor');
        _contentionMonitor.recordOperation({ userId, resolvedEnv, operation, durationMs });
    } catch (_) { /* never block on contention telemetry */ }
}

module.exports.recordSlowQuery = recordSlowQuery;
```

- [ ] **Step 4: Wire into serverBrain.js finally block (after deadMansSwitch)**

In `server/services/serverBrain.js` finally block, after the deadMansSwitch wiring, add:

```javascript
        // [Wave 1] R0 DB contention — record brain cycle duration as a write op sample.
        try {
            const _cycleDuration = Date.now() - _cycleStartTs;
            db.recordSlowQuery(0, 'SYSTEM', 'brain_cycle', _cycleDuration);
        } catch (_) { /* never block brain on contention telemetry */ }
```

- [ ] **Step 5: Run tests**

Run: `/root/.nvm/versions/node/v22.22.3/bin/node /root/zeus-terminal/node_modules/.bin/jest tests/unit/ml/wave1_dbContentionWiring.test.js tests/unit/ml/dbContentionMonitor.test.js --forceExit --no-coverage`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add server/services/database.js server/services/serverBrain.js tests/unit/ml/wave1_dbContentionWiring.test.js
git commit -m "feat(wave1): wire dbContentionMonitor slow-query instrumentation"
```

---

### Task 5: Disaster Recovery Orchestrator — Cron Wiring

**Files:**
- Create: `server/cron/r0SubstrateCron.js`
- Modify: `server.js` (boot wiring)
- Test: `tests/unit/ml/wave1_drCron.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';
const { db } = require('../../server/services/database');

beforeEach(() => {
  db.prepare("DELETE FROM ml_dr_state WHERE node_id = 'zeus-test'").run();
});

afterAll(() => {
  db.prepare("DELETE FROM ml_dr_state WHERE node_id = 'zeus-test'").run();
});

describe('Wave 1: DR orchestrator cron', () => {
  test('recordHeartbeat stores HEARTBEAT record in ml_dr_state', () => {
    const dr = require('../../server/services/ml/R0_substrate/disasterRecoveryOrchestrator');
    dr.recordHeartbeat({ nodeId: 'zeus-test', role: 'PRIMARY' });
    const row = db.prepare("SELECT * FROM ml_dr_state WHERE node_id = 'zeus-test' AND record_type = 'HEARTBEAT' ORDER BY id DESC LIMIT 1").get();
    expect(row).not.toBeNull();
    expect(row.role).toBe('PRIMARY');
    expect(row.state).toBe('LIVE');
  });

  test('getHeartbeatStatus returns LIVE when recent heartbeat', () => {
    const dr = require('../../server/services/ml/R0_substrate/disasterRecoveryOrchestrator');
    dr.recordHeartbeat({ nodeId: 'zeus-test', role: 'PRIMARY' });
    const status = dr.getHeartbeatStatus({ nodeId: 'zeus-test' });
    expect(status.state).toBe('LIVE');
  });

  test('getRecoveryReadiness returns structured readiness report', () => {
    const dr = require('../../server/services/ml/R0_substrate/disasterRecoveryOrchestrator');
    dr.recordHeartbeat({ nodeId: 'zeus-primary', role: 'PRIMARY' });
    const readiness = dr.getRecoveryReadiness({ primaryNodeId: 'zeus-primary' });
    expect(readiness).toHaveProperty('heartbeatOk');
    expect(readiness).toHaveProperty('backupOk');
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `/root/.nvm/versions/node/v22.22.3/bin/node /root/zeus-terminal/node_modules/.bin/jest tests/unit/ml/wave1_drCron.test.js --forceExit --no-coverage`
Expected: PASS

- [ ] **Step 3: Create cron module**

Create `server/cron/r0SubstrateCron.js`:

```javascript
'use strict';

const NODE_ID = 'zeus-primary';
const HEARTBEAT_INTERVAL_MS = 60000; // 60s

let _timer = null;

function _tick() {
    try {
        const dr = require('../services/ml/R0_substrate/disasterRecoveryOrchestrator');
        dr.recordHeartbeat({ nodeId: NODE_ID, role: 'PRIMARY', actor: 'r0SubstrateCron' });
    } catch (_) { /* never crash cron on DR telemetry */ }
}

function schedule() {
    if (_timer) return;
    _timer = setInterval(_tick, HEARTBEAT_INTERVAL_MS);
    setTimeout(_tick, 5000); // first tick after 5s
}

function stop() {
    if (_timer) { clearInterval(_timer); _timer = null; }
}

module.exports = { schedule, stop, _tick, NODE_ID };
```

- [ ] **Step 4: Wire into server boot**

In `server.js`, after the existing cron/omega wiring (search for `omegaMemoryCleanup` or similar cron require), add:

```javascript
    // [Wave 1] R0 substrate cron — DR heartbeat every 60s
    try { require('./cron/r0SubstrateCron').schedule(); } catch (_) {}
```

- [ ] **Step 5: Run tests**

Run: `/root/.nvm/versions/node/v22.22.3/bin/node /root/zeus-terminal/node_modules/.bin/jest tests/unit/ml/wave1_drCron.test.js tests/unit/ml/disasterRecoveryOrchestrator.test.js --forceExit --no-coverage`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add server/cron/r0SubstrateCron.js server.js tests/unit/ml/wave1_drCron.test.js
git commit -m "feat(wave1): wire disasterRecoveryOrchestrator via 60s cron heartbeat"
```

---

### Task 6: Replay Engine — Upgrade from Stub to Real

**Files:**
- Modify: `server/services/ml/R-1_testHarness/replayEngine.js`
- Test: `tests/unit/ml/wave1_replayEngine.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';
const { db } = require('../../server/services/database');

const TEST_DIGEST = 'replay_test_' + Date.now();

beforeAll(() => {
  // Seed a decision snapshot for replay
  db.prepare(`INSERT OR IGNORE INTO ml_decision_snapshots 
    (user_id, resolved_env, symbol, snapshot_event_type, decision_digest, snapshot_json, registry_digest, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    99, 'DEMO', 'BTCUSDT', 'TRADE', TEST_DIGEST,
    JSON.stringify({
      score: 78, dir: 'bull', tier: 'MEDIUM', action: 'ENTRY',
      top5: ['regime_0.9', 'alignment_0.8', 'structure_0.7', 'flow_0.6', 'mtf_0.5'],
      indicators: { rsi: 55, adx: 28 },
      regime: 'TREND',
      confluence: { regime: 0.9, alignment: 0.8, structure: 0.7, flow: 0.6, mtf: 0.5, indicator: 0.6, sentiment: 0.4 },
    }),
    'v1.0.0', Date.now()
  );
});

afterAll(() => {
  db.prepare('DELETE FROM ml_decision_snapshots WHERE decision_digest = ?').run(TEST_DIGEST);
  db.prepare('DELETE FROM ml_pit_snapshots WHERE user_id = 99').run();
});

describe('Wave 1: replayEngine upgrade', () => {
  test('loadSnapshot returns full snapshot by digest', () => {
    const re = require('../../server/services/ml/R-1_testHarness/replayEngine');
    const snap = re.loadSnapshot(TEST_DIGEST);
    expect(snap).not.toBeNull();
    expect(snap.decision_digest).toBe(TEST_DIGEST);
    expect(snap.symbol).toBe('BTCUSDT');
  });

  test('replayDecision recomputes score from confluence components', () => {
    const re = require('../../server/services/ml/R-1_testHarness/replayEngine');
    const snap = re.loadSnapshot(TEST_DIGEST);
    const result = re.replayDecision(snap);
    expect(result).toHaveProperty('decision_digest', TEST_DIGEST);
    expect(result).toHaveProperty('replay_score');
    expect(typeof result.replay_score).toBe('number');
    expect(result).toHaveProperty('replay_top5');
    expect(Array.isArray(result.replay_top5)).toBe(true);
    expect(result).toHaveProperty('matches_original');
    expect(typeof result.matches_original).toBe('boolean');
  });

  test('replayDecision produces matches_original=true for identical inputs', () => {
    const re = require('../../server/services/ml/R-1_testHarness/replayEngine');
    const snap = re.loadSnapshot(TEST_DIGEST);
    const result = re.replayDecision(snap);
    // With identical inputs, replay should produce same score
    expect(result.matches_original).toBe(true);
    expect(result.replay_score).toBe(78);
  });

  test('loadSnapshot returns null for non-existent digest', () => {
    const re = require('../../server/services/ml/R-1_testHarness/replayEngine');
    const snap = re.loadSnapshot('nonexistent_digest_xyz');
    expect(snap).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it FAILS (current stub won't pass recompute test)**

Run: `/root/.nvm/versions/node/v22.22.3/bin/node /root/zeus-terminal/node_modules/.bin/jest tests/unit/ml/wave1_replayEngine.test.js --forceExit --no-coverage`
Expected: FAIL on `replayDecision recomputes score from confluence components`

- [ ] **Step 3: Implement real replayEngine**

Replace `server/services/ml/R-1_testHarness/replayEngine.js` with:

```javascript
'use strict';

const { db } = require('../../database');

const _stmtLoad = db.prepare(
    'SELECT * FROM ml_decision_snapshots WHERE decision_digest = ? LIMIT 1'
);

function loadSnapshot(decisionDigest) {
    if (!decisionDigest) return null;
    const row = _stmtLoad.get(decisionDigest);
    if (!row) return null;
    return row;
}

function replayDecision(snapshot) {
    if (!snapshot || !snapshot.snapshot_json) {
        return { decision_digest: null, replay_score: 0, replay_top5: [], matches_original: false };
    }

    let parsed;
    try {
        parsed = typeof snapshot.snapshot_json === 'string'
            ? JSON.parse(snapshot.snapshot_json)
            : snapshot.snapshot_json;
    } catch (_) {
        return { decision_digest: snapshot.decision_digest, replay_score: 0, replay_top5: [], matches_original: false };
    }

    const originalScore = parsed.score || 0;
    const confluence = parsed.confluence || {};

    // Deterministic score recomputation from confluence components.
    // Mirrors serverConfluence weighted sum: each component 0-1, weights sum to 1.
    const weights = { regime: 0.20, alignment: 0.15, structure: 0.15, flow: 0.15, mtf: 0.15, indicator: 0.10, sentiment: 0.10 };
    let replayScore = 0;
    let weightSum = 0;
    for (const [key, w] of Object.entries(weights)) {
        if (typeof confluence[key] === 'number') {
            replayScore += confluence[key] * w * 100;
            weightSum += w;
        }
    }
    if (weightSum > 0) {
        replayScore = Math.round(replayScore / weightSum);
    } else {
        replayScore = originalScore; // fallback if no confluence data
    }

    // Top5 reconstruction from confluence (sorted desc)
    const entries = Object.entries(confluence)
        .filter(([, v]) => typeof v === 'number')
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([k, v]) => `${k}_${v.toFixed(1)}`);

    const matchesOriginal = replayScore === originalScore;

    return {
        decision_digest: snapshot.decision_digest,
        replay_score: replayScore,
        replay_top5: entries,
        matches_original: matchesOriginal,
        original_score: originalScore,
        delta: replayScore - originalScore,
    };
}

module.exports = { loadSnapshot, replayDecision };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `/root/.nvm/versions/node/v22.22.3/bin/node /root/zeus-terminal/node_modules/.bin/jest tests/unit/ml/wave1_replayEngine.test.js --forceExit --no-coverage`
Expected: ALL PASS

- [ ] **Step 5: Run original replayEngine test to verify backward compat**

Run: `/root/.nvm/versions/node/v22.22.3/bin/node /root/zeus-terminal/node_modules/.bin/jest tests/unit/ml/replayEngine.test.js --forceExit --no-coverage`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/services/ml/R-1_testHarness/replayEngine.js tests/unit/ml/wave1_replayEngine.test.js
git commit -m "feat(wave1): upgrade replayEngine from stub to real confluence-based replay"
```

---

### Task 7: Integration Verification + PM2 Reload

**Files:** None (verification only)

- [ ] **Step 1: Run full ML test suite**

Run: `/root/.nvm/versions/node/v22.22.3/bin/node /root/zeus-terminal/node_modules/.bin/jest tests/unit/ml/ --forceExit --no-coverage`
Expected: ALL PASS (no regressions)

- [ ] **Step 2: PM2 reload and verify live data**

```bash
pm2 reload zeus --update-env
sleep 10
# Verify deadMansSwitch heartbeats flowing
sqlite3 /root/zeus-terminal/data/zeus.db "SELECT COUNT(*) FROM ml_heartbeat_state WHERE last_heartbeat_ts > (strftime('%s','now')*1000 - 60000)"
# Expected: >=1

# Verify PIT snapshots growing
sqlite3 /root/zeus-terminal/data/zeus.db "SELECT COUNT(*) FROM ml_pit_snapshots WHERE created_at > datetime('now', '-2 minutes')"
# Expected: >=1

# Verify DR heartbeat
sqlite3 /root/zeus-terminal/data/zeus.db "SELECT COUNT(*) FROM ml_dr_state WHERE record_type = 'HEARTBEAT'"
# Expected: >=1

# Verify rate state still clean
sqlite3 /root/zeus-terminal/data/zeus.db "SELECT banned_until, warm_until FROM binance_rate_state"
# Expected: 0|0

# Verify zero errors
pm2 logs zeus --nostream --lines 30 | grep -c "ERROR"
# Expected: 0
```

- [ ] **Step 3: Commit verification tag**

```bash
git tag ml-wave1-r0-substrate-COMPLETE-$(date +%Y%m%d-%H%M%S)
git push origin main --tags
```

---

## Verification Checklist

After all tasks complete:

- [ ] ml_heartbeat_state: rows growing every 30s (brain cycle heartbeat)
- [ ] ml_pit_snapshots: rows growing alongside ml_decision_snapshots
- [ ] ml_config_snapshots: row created when migrationFlags.set() called
- [ ] ml_db_contention_log: rows appear only for slow queries (>100ms)
- [ ] ml_dr_state: HEARTBEAT rows every 60s from cron
- [ ] replayEngine: deterministic replay from snapshot data
- [ ] Zero test regressions
- [ ] Zero PM2 errors
- [ ] Rate state clean (no Binance ban triggered)
