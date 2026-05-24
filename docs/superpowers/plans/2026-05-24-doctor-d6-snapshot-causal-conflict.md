# Doctor D-6: Snapshot + Causal Blame Tree + Conflict Map — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Forensic tooling for OMEGA Doctor — capture brain snapshots, reconstruct blame chains, detect semantic divergence.

**Architecture:** 3 new modules in `server/services/ml/_doctor/` + 5 new API endpoints in `server/routes/doctor.js` + auto-snapshot trigger in analyzer. All async, zero hot-path impact. Migration 401 adds `ml_cognitive_snapshots` table.

**Tech Stack:** Node.js 22, better-sqlite3, Jest. Test runner: `/root/.nvm/versions/node/v22.22.3/bin/node /root/zeus-terminal/node_modules/.bin/jest`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `server/services/ml/_doctor/cognitiveSnapshot.js` | CREATE | Capture + store + retrieve + prune snapshots |
| `server/services/ml/_doctor/causalChain.js` | CREATE | Blame tree from moduleRegistry deps |
| `server/services/ml/_doctor/conflictMap.js` | CREATE | Diff two snapshots for divergences |
| `server/services/database.js` | MODIFY | Migration 401: ml_cognitive_snapshots |
| `server/routes/doctor.js` | MODIFY | 5 new endpoints |
| `server/services/ml/_doctor/analyzer.js` | MODIFY | Auto-snapshot on P0 |
| `tests/unit/ml/doctorSnapshot.test.js` | CREATE | |
| `tests/unit/ml/doctorCausalChain.test.js` | CREATE | |
| `tests/unit/ml/doctorConflictMap.test.js` | CREATE | |
| `tests/unit/ml/doctorD6Routes.test.js` | CREATE | |

---

### Task 1: cognitiveSnapshot module + migration 401

**Files:**
- Create: `server/services/ml/_doctor/cognitiveSnapshot.js`
- Modify: `server/services/database.js` (add migration 401)
- Test: `tests/unit/ml/doctorSnapshot.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';
const { db } = require('../../../server/services/database');

beforeEach(() => {
  db.prepare('DELETE FROM ml_cognitive_snapshots').run();
});
afterAll(() => {
  db.prepare('DELETE FROM ml_cognitive_snapshots').run();
});

describe('Doctor D-6: cognitiveSnapshot', () => {
  test('captureSnapshot stores snapshot and returns id', () => {
    const cs = require('../../../server/services/ml/_doctor/cognitiveSnapshot');
    const result = cs.captureSnapshot({ triggerType: 'manual' });
    expect(result).toHaveProperty('id');
    expect(result.id).toBeGreaterThan(0);
    expect(result).toHaveProperty('cognitiveState');
  });

  test('getSnapshot retrieves by id', () => {
    const cs = require('../../../server/services/ml/_doctor/cognitiveSnapshot');
    const { id } = cs.captureSnapshot({ triggerType: 'manual' });
    const snap = cs.getSnapshot(id);
    expect(snap).not.toBeNull();
    expect(snap.trigger_type).toBe('manual');
    expect(snap.snapshot_json).toBeDefined();
    const parsed = JSON.parse(snap.snapshot_json);
    expect(parsed).toHaveProperty('trustScores');
    expect(parsed).toHaveProperty('quarantines');
    expect(parsed).toHaveProperty('shedState');
  });

  test('listSnapshots returns array sorted by created_at desc', () => {
    const cs = require('../../../server/services/ml/_doctor/cognitiveSnapshot');
    cs.captureSnapshot({ triggerType: 'manual' });
    cs.captureSnapshot({ triggerType: 'auto_p0', triggerEventId: 42 });
    const list = cs.listSnapshots({ limit: 10 });
    expect(list.length).toBe(2);
    expect(list[0].trigger_type).toBe('auto_p0');
  });

  test('getSnapshot returns null for nonexistent id', () => {
    const cs = require('../../../server/services/ml/_doctor/cognitiveSnapshot');
    expect(cs.getSnapshot(99999)).toBeNull();
  });

  test('pruneOld deletes snapshots older than maxAgeDays', () => {
    const cs = require('../../../server/services/ml/_doctor/cognitiveSnapshot');
    cs.captureSnapshot({ triggerType: 'manual' });
    // Insert an old snapshot directly
    db.prepare(`INSERT INTO ml_cognitive_snapshots
      (trigger_type, cognitive_state, snapshot_json, created_at)
      VALUES ('manual', 'HEALTHY', '{}', ?)`).run(Date.now() - 100 * 86400000);
    const deleted = cs.pruneOld(90);
    expect(deleted).toBe(1);
    expect(cs.listSnapshots({}).length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test — should FAIL (table + module don't exist)**

```bash
/root/.nvm/versions/node/v22.22.3/bin/node /root/zeus-terminal/node_modules/.bin/jest tests/unit/ml/doctorSnapshot.test.js --forceExit --no-coverage
```
Expected: FAIL — Cannot find module cognitiveSnapshot

- [ ] **Step 3: Add migration 401 in database.js**

After migration `400_brain_decisions_resolved_env`, add:

```javascript
migrate('401_ml_cognitive_snapshots', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_cognitive_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trigger_type TEXT NOT NULL CHECK(trigger_type IN ('auto_p0', 'manual', 'scheduled')),
            trigger_event_id INTEGER,
            cognitive_state TEXT NOT NULL,
            snapshot_json TEXT NOT NULL,
            modules_involved_json TEXT,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_cog_snap_ts ON ml_cognitive_snapshots(created_at);
        CREATE INDEX IF NOT EXISTS idx_cog_snap_trigger ON ml_cognitive_snapshots(trigger_type, created_at);
    `);
});
```

- [ ] **Step 4: Create cognitiveSnapshot.js**

```javascript
'use strict';

const { db } = require('../../database');

const TRIGGER_TYPES = Object.freeze(['auto_p0', 'manual', 'scheduled']);

const _stmts = {
    insert: db.prepare(`INSERT INTO ml_cognitive_snapshots
        (trigger_type, trigger_event_id, cognitive_state, snapshot_json, modules_involved_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`),
    getById: db.prepare('SELECT * FROM ml_cognitive_snapshots WHERE id = ?'),
    list: db.prepare('SELECT id, trigger_type, trigger_event_id, cognitive_state, created_at FROM ml_cognitive_snapshots ORDER BY created_at DESC LIMIT ?'),
    listSince: db.prepare('SELECT id, trigger_type, trigger_event_id, cognitive_state, created_at FROM ml_cognitive_snapshots WHERE created_at > ? ORDER BY created_at DESC LIMIT ?'),
    pruneOld: db.prepare('DELETE FROM ml_cognitive_snapshots WHERE created_at < ?'),
};

function _gatherState() {
    let trustScores = {};
    let quarantines = [];
    let shedState = 0;
    let cognitiveState = 'HEALTHY';

    try {
        const ts = require('./trustScorer');
        trustScores = ts.listAllScores();
    } catch (_) {}

    try {
        const qm = require('./quarantineManager');
        quarantines = qm.getActiveQuarantines();
    } catch (_) {}

    try {
        const sm = require('./shedManager');
        shedState = sm.getCurrentState();
    } catch (_) {}

    try {
        const az = require('./analyzer');
        cognitiveState = az.getCurrentState() || 'HEALTHY';
    } catch (_) {}

    return { trustScores, quarantines, shedState, cognitiveState };
}

function captureSnapshot(params) {
    const triggerType = (params && params.triggerType) || 'manual';
    if (!TRIGGER_TYPES.includes(triggerType)) {
        throw new Error(`Invalid trigger_type: ${triggerType}`);
    }
    const triggerEventId = (params && params.triggerEventId) || null;
    const nowTs = (params && params.nowTs) || Date.now();

    const state = _gatherState();
    const snapshotJson = JSON.stringify(state);
    const modulesInvolved = state.quarantines.length > 0
        ? JSON.stringify(state.quarantines.map(q => q.module_id || q.moduleId))
        : null;

    const result = _stmts.insert.run(
        triggerType, triggerEventId, state.cognitiveState,
        snapshotJson, modulesInvolved, nowTs
    );

    return {
        id: Number(result.lastInsertRowid),
        cognitiveState: state.cognitiveState,
        moduleCount: Object.keys(state.trustScores).length,
    };
}

function getSnapshot(id) {
    if (!id) return null;
    return _stmts.getById.get(id) || null;
}

function listSnapshots(params) {
    const limit = (params && params.limit) || 50;
    const since = params && params.since;
    if (since) return _stmts.listSince.all(since, limit);
    return _stmts.list.all(limit);
}

function pruneOld(maxAgeDays) {
    const cutoff = Date.now() - maxAgeDays * 86400000;
    const result = _stmts.pruneOld.run(cutoff);
    return result.changes;
}

module.exports = {
    TRIGGER_TYPES,
    captureSnapshot,
    getSnapshot,
    listSnapshots,
    pruneOld,
};
```

- [ ] **Step 5: Run test — should PASS**

```bash
/root/.nvm/versions/node/v22.22.3/bin/node /root/zeus-terminal/node_modules/.bin/jest tests/unit/ml/doctorSnapshot.test.js --forceExit --no-coverage
```

- [ ] **Step 6: Commit**

```bash
git add server/services/ml/_doctor/cognitiveSnapshot.js server/services/database.js tests/unit/ml/doctorSnapshot.test.js
git commit -m "feat(d6): cognitive snapshot module + migration 401"
```

---

### Task 2: causalChain module (blame tree)

**Files:**
- Create: `server/services/ml/_doctor/causalChain.js`
- Test: `tests/unit/ml/doctorCausalChain.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';
const { db } = require('../../../server/services/database');

describe('Doctor D-6: causalChain', () => {
  test('buildBlameTree returns tree with root module', () => {
    const cc = require('../../../server/services/ml/_doctor/causalChain');
    const tree = cc.buildBlameTree({ moduleId: 'serverBrain' });
    expect(tree).toHaveProperty('root', 'serverBrain');
    expect(tree).toHaveProperty('depth');
    expect(tree).toHaveProperty('nodes');
    expect(Array.isArray(tree.nodes)).toBe(true);
  });

  test('buildBlameTree respects maxDepth', () => {
    const cc = require('../../../server/services/ml/_doctor/causalChain');
    const tree = cc.buildBlameTree({ moduleId: 'serverBrain', maxDepth: 1 });
    expect(tree.depth).toBeLessThanOrEqual(1);
  });

  test('buildBlameTree returns empty nodes for unknown module', () => {
    const cc = require('../../../server/services/ml/_doctor/causalChain');
    const tree = cc.buildBlameTree({ moduleId: 'nonexistent_xyz' });
    expect(tree.root).toBe('nonexistent_xyz');
    expect(tree.nodes.length).toBe(0);
  });

  test('getModuleHealth returns health info', () => {
    const cc = require('../../../server/services/ml/_doctor/causalChain');
    const health = cc.getModuleHealth({ moduleId: 'serverBrain' });
    expect(health).toHaveProperty('moduleId', 'serverBrain');
    expect(health).toHaveProperty('trustScore');
    expect(health).toHaveProperty('latencyMs');
    expect(health).toHaveProperty('ranOk');
  });
});
```

- [ ] **Step 2: Run test — should FAIL**

```bash
/root/.nvm/versions/node/v22.22.3/bin/node /root/zeus-terminal/node_modules/.bin/jest tests/unit/ml/doctorCausalChain.test.js --forceExit --no-coverage
```

- [ ] **Step 3: Create causalChain.js**

```javascript
'use strict';

const { db } = require('../../database');

const MAX_DEPTH_DEFAULT = 5;

function _getCallers(moduleId) {
    try {
        const reg = require('./moduleRegistry');
        const all = reg.listAll();
        const callers = [];
        for (const mod of all) {
            const contract = mod.contract_json ? JSON.parse(mod.contract_json) : {};
            if (Array.isArray(contract.allowedDeps) && contract.allowedDeps.includes(moduleId)) {
                callers.push(mod.module_id);
            }
        }
        return callers;
    } catch (_) { return []; }
}

function _getHeartbeat(moduleId) {
    try {
        const row = db.prepare(
            'SELECT latency_ms, ran_ok, invocation_count FROM ml_module_heartbeats WHERE module_id = ? ORDER BY ts DESC LIMIT 1'
        ).get(moduleId);
        return row || { latency_ms: null, ran_ok: null, invocation_count: 0 };
    } catch (_) { return { latency_ms: null, ran_ok: null, invocation_count: 0 }; }
}

function _getTrust(moduleId) {
    try {
        const ts = require('./trustScorer');
        return ts.getTrustScore(moduleId);
    } catch (_) { return 1.0; }
}

function _buildNode(moduleId, depth, maxDepth, visited) {
    if (depth > maxDepth || visited.has(moduleId)) return null;
    visited.add(moduleId);

    const hb = _getHeartbeat(moduleId);
    const trust = _getTrust(moduleId);
    let role = 'unknown';
    try {
        const reg = require('./moduleRegistry');
        const mod = reg.getModule({ moduleId });
        role = mod ? mod.role_tag : 'unknown';
    } catch (_) {}

    const callers = _getCallers(moduleId);
    const children = [];
    for (const caller of callers) {
        const child = _buildNode(caller, depth + 1, maxDepth, visited);
        if (child) children.push(child);
    }

    return {
        moduleId,
        role,
        latencyMs: hb.latency_ms,
        ranOk: hb.ran_ok === 1 || hb.ran_ok === true,
        invocationCount: hb.invocation_count || 0,
        trustScore: trust,
        depth,
        children,
    };
}

function buildBlameTree(params) {
    const moduleId = params && params.moduleId;
    if (!moduleId) return { root: null, depth: 0, nodes: [] };

    const maxDepth = (params && params.maxDepth) || MAX_DEPTH_DEFAULT;
    const visited = new Set();
    const callers = _getCallers(moduleId);

    const nodes = [];
    let maxFoundDepth = 0;
    for (const caller of callers) {
        const node = _buildNode(caller, 1, maxDepth, visited);
        if (node) {
            nodes.push(node);
            const d = _maxDepthOf(node);
            if (d > maxFoundDepth) maxFoundDepth = d;
        }
    }

    return { root: moduleId, depth: maxFoundDepth, nodes };
}

function _maxDepthOf(node) {
    if (!node.children || node.children.length === 0) return node.depth;
    return Math.max(node.depth, ...node.children.map(_maxDepthOf));
}

function getModuleHealth(params) {
    const moduleId = params && params.moduleId;
    if (!moduleId) return { moduleId: null, trustScore: 0, latencyMs: null, ranOk: false };

    const hb = _getHeartbeat(moduleId);
    const trust = _getTrust(moduleId);

    return {
        moduleId,
        trustScore: trust,
        latencyMs: hb.latency_ms,
        ranOk: hb.ran_ok === 1 || hb.ran_ok === true,
        invocationCount: hb.invocation_count || 0,
    };
}

module.exports = { buildBlameTree, getModuleHealth, MAX_DEPTH_DEFAULT };
```

- [ ] **Step 4: Run test — should PASS**

```bash
/root/.nvm/versions/node/v22.22.3/bin/node /root/zeus-terminal/node_modules/.bin/jest tests/unit/ml/doctorCausalChain.test.js --forceExit --no-coverage
```

- [ ] **Step 5: Commit**

```bash
git add server/services/ml/_doctor/causalChain.js tests/unit/ml/doctorCausalChain.test.js
git commit -m "feat(d6): causal blame tree module"
```

---

### Task 3: conflictMap module

**Files:**
- Create: `server/services/ml/_doctor/conflictMap.js`
- Test: `tests/unit/ml/doctorConflictMap.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';
const { db } = require('../../../server/services/database');

beforeEach(() => {
  db.prepare('DELETE FROM ml_cognitive_snapshots').run();
});
afterAll(() => {
  db.prepare('DELETE FROM ml_cognitive_snapshots').run();
});

describe('Doctor D-6: conflictMap', () => {
  test('compareSnapshots with identical snapshots returns 0 divergences', () => {
    const cs = require('../../../server/services/ml/_doctor/cognitiveSnapshot');
    const { id: id1 } = cs.captureSnapshot({ triggerType: 'manual' });
    const { id: id2 } = cs.captureSnapshot({ triggerType: 'manual' });
    const cm = require('../../../server/services/ml/_doctor/conflictMap');
    const result = cm.compareSnapshots({ fromId: id1, toId: id2 });
    expect(result).toHaveProperty('divergences');
    expect(result.divergences.length).toBe(0);
    expect(result).toHaveProperty('totalDiverged', 0);
  });

  test('compareSnapshots detects trust score delta', () => {
    const cs = require('../../../server/services/ml/_doctor/cognitiveSnapshot');
    // Insert two snapshots with different trust scores manually
    db.prepare(`INSERT INTO ml_cognitive_snapshots
      (trigger_type, cognitive_state, snapshot_json, created_at)
      VALUES ('manual', 'HEALTHY', ?, ?)`).run(
      JSON.stringify({ trustScores: { modA: 0.9, modB: 0.8 }, quarantines: [], shedState: 0 }),
      Date.now() - 10000
    );
    db.prepare(`INSERT INTO ml_cognitive_snapshots
      (trigger_type, cognitive_state, snapshot_json, created_at)
      VALUES ('manual', 'DEGRADED', ?, ?)`).run(
      JSON.stringify({ trustScores: { modA: 0.5, modB: 0.8 }, quarantines: [], shedState: 0 }),
      Date.now()
    );
    const rows = db.prepare('SELECT id FROM ml_cognitive_snapshots ORDER BY id ASC').all();
    const cm = require('../../../server/services/ml/_doctor/conflictMap');
    const result = cm.compareSnapshots({ fromId: rows[0].id, toId: rows[1].id });
    expect(result.totalDiverged).toBe(1);
    expect(result.divergences[0].moduleId).toBe('modA');
    expect(result.divergences[0].trustDelta).toBeCloseTo(-0.4, 1);
    expect(result.divergences[0].severity).toBe('high');
  });

  test('compareSnapshots with missing toId uses live state', () => {
    const cs = require('../../../server/services/ml/_doctor/cognitiveSnapshot');
    const { id } = cs.captureSnapshot({ triggerType: 'manual' });
    const cm = require('../../../server/services/ml/_doctor/conflictMap');
    const result = cm.compareSnapshots({ fromId: id });
    expect(result).toHaveProperty('from');
    expect(result).toHaveProperty('to');
    expect(result).toHaveProperty('divergences');
  });

  test('compareSnapshots returns error for invalid fromId', () => {
    const cm = require('../../../server/services/ml/_doctor/conflictMap');
    const result = cm.compareSnapshots({ fromId: 99999 });
    expect(result).toHaveProperty('error');
  });
});
```

- [ ] **Step 2: Run test — should FAIL**

```bash
/root/.nvm/versions/node/v22.22.3/bin/node /root/zeus-terminal/node_modules/.bin/jest tests/unit/ml/doctorConflictMap.test.js --forceExit --no-coverage
```

- [ ] **Step 3: Create conflictMap.js**

```javascript
'use strict';

const TRUST_DELTA_THRESHOLD = 0.2;

function compareSnapshots(params) {
    const fromId = params && params.fromId;
    if (!fromId) return { error: 'fromId required' };

    const cs = require('./cognitiveSnapshot');
    const fromSnap = cs.getSnapshot(fromId);
    if (!fromSnap) return { error: `Snapshot ${fromId} not found` };

    let toSnap;
    const toId = params && params.toId;
    if (toId) {
        toSnap = cs.getSnapshot(toId);
        if (!toSnap) return { error: `Snapshot ${toId} not found` };
    } else {
        const live = cs.captureSnapshot({ triggerType: 'manual' });
        toSnap = cs.getSnapshot(live.id);
    }

    let fromState, toState;
    try { fromState = JSON.parse(fromSnap.snapshot_json); } catch (_) { fromState = {}; }
    try { toState = JSON.parse(toSnap.snapshot_json); } catch (_) { toState = {}; }

    const fromTrust = fromState.trustScores || {};
    const toTrust = toState.trustScores || {};
    const fromQuarantines = new Set((fromState.quarantines || []).map(q => q.module_id || q.moduleId || ''));
    const toQuarantines = new Set((toState.quarantines || []).map(q => q.module_id || q.moduleId || ''));

    const allModules = new Set([...Object.keys(fromTrust), ...Object.keys(toTrust)]);
    const divergences = [];

    for (const mod of allModules) {
        const ft = typeof fromTrust[mod] === 'number' ? fromTrust[mod] : 1.0;
        const tt = typeof toTrust[mod] === 'number' ? toTrust[mod] : 1.0;
        const delta = tt - ft;
        const quarantineChanged = fromQuarantines.has(mod) !== toQuarantines.has(mod);

        if (Math.abs(delta) >= TRUST_DELTA_THRESHOLD || quarantineChanged) {
            let severity = 'low';
            if (Math.abs(delta) >= 0.4 || quarantineChanged) severity = 'high';
            else if (Math.abs(delta) >= 0.2) severity = 'medium';

            divergences.push({
                moduleId: mod,
                trustDelta: +delta.toFixed(4),
                fromTrust: +ft.toFixed(4),
                toTrust: +tt.toFixed(4),
                quarantineChanged,
                severity,
            });
        }
    }

    divergences.sort((a, b) => Math.abs(b.trustDelta) - Math.abs(a.trustDelta));

    return {
        from: { id: fromSnap.id, ts: fromSnap.created_at, state: fromSnap.cognitive_state },
        to: { id: toSnap.id, ts: toSnap.created_at, state: toSnap.cognitive_state },
        divergences,
        totalDiverged: divergences.length,
        totalModules: allModules.size,
    };
}

module.exports = { compareSnapshots, TRUST_DELTA_THRESHOLD };
```

- [ ] **Step 4: Run test — should PASS**

```bash
/root/.nvm/versions/node/v22.22.3/bin/node /root/zeus-terminal/node_modules/.bin/jest tests/unit/ml/doctorConflictMap.test.js --forceExit --no-coverage
```

- [ ] **Step 5: Commit**

```bash
git add server/services/ml/_doctor/conflictMap.js tests/unit/ml/doctorConflictMap.test.js
git commit -m "feat(d6): semantic conflict map module"
```

---

### Task 4: Routes + analyzer auto-snapshot + integration verify

**Files:**
- Modify: `server/routes/doctor.js`
- Modify: `server/services/ml/_doctor/analyzer.js`
- Test: `tests/unit/ml/doctorD6Routes.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';
const { db } = require('../../../server/services/database');

beforeEach(() => {
  db.prepare('DELETE FROM ml_cognitive_snapshots').run();
});
afterAll(() => {
  db.prepare('DELETE FROM ml_cognitive_snapshots').run();
});

describe('Doctor D-6: routes + auto-snapshot', () => {
  test('cognitiveSnapshot.captureSnapshot works for auto_p0', () => {
    const cs = require('../../../server/services/ml/_doctor/cognitiveSnapshot');
    const result = cs.captureSnapshot({ triggerType: 'auto_p0', triggerEventId: 42 });
    expect(result.id).toBeGreaterThan(0);
    const snap = cs.getSnapshot(result.id);
    expect(snap.trigger_type).toBe('auto_p0');
    expect(snap.trigger_event_id).toBe(42);
  });

  test('causalChain.buildBlameTree returns valid structure', () => {
    const cc = require('../../../server/services/ml/_doctor/causalChain');
    const tree = cc.buildBlameTree({ moduleId: 'circuitBreaker' });
    expect(tree.root).toBe('circuitBreaker');
    expect(Array.isArray(tree.nodes)).toBe(true);
  });

  test('conflictMap.compareSnapshots end-to-end', () => {
    const cs = require('../../../server/services/ml/_doctor/cognitiveSnapshot');
    const { id: id1 } = cs.captureSnapshot({ triggerType: 'manual' });
    const { id: id2 } = cs.captureSnapshot({ triggerType: 'manual' });
    const cm = require('../../../server/services/ml/_doctor/conflictMap');
    const result = cm.compareSnapshots({ fromId: id1, toId: id2 });
    expect(result.totalDiverged).toBe(0);
  });

  test('all D-6 modules load without error', () => {
    expect(() => require('../../../server/services/ml/_doctor/cognitiveSnapshot')).not.toThrow();
    expect(() => require('../../../server/services/ml/_doctor/causalChain')).not.toThrow();
    expect(() => require('../../../server/services/ml/_doctor/conflictMap')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test — should PASS (modules created in T1-T3)**

```bash
/root/.nvm/versions/node/v22.22.3/bin/node /root/zeus-terminal/node_modules/.bin/jest tests/unit/ml/doctorD6Routes.test.js --forceExit --no-coverage
```

- [ ] **Step 3: Add 5 routes to doctor.js**

At the end of `server/routes/doctor.js`, before `module.exports`, add:

```javascript
// ─── D-6: Cognitive Snapshots ──────────────────────────────────────────────
router.post('/snapshots', _requireAdmin, (req, res) => {
    try {
        const cs = require('../services/ml/_doctor/cognitiveSnapshot');
        const result = cs.captureSnapshot({ triggerType: 'manual' });
        res.json({ ok: true, ...result });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

router.get('/snapshots', _requireAdmin, (req, res) => {
    try {
        const cs = require('../services/ml/_doctor/cognitiveSnapshot');
        const since = req.query.since ? Number(req.query.since) : undefined;
        const limit = req.query.limit ? Math.min(Number(req.query.limit), 100) : 50;
        res.json({ ok: true, snapshots: cs.listSnapshots({ since, limit }) });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

router.get('/snapshots/:id', _requireAdmin, (req, res) => {
    try {
        const cs = require('../services/ml/_doctor/cognitiveSnapshot');
        const snap = cs.getSnapshot(Number(req.params.id));
        if (!snap) return res.status(404).json({ ok: false, error: 'Snapshot not found' });
        res.json({ ok: true, snapshot: snap });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ─── D-6: Causal Blame Tree ───────────────────────────────────────────────
router.get('/causal-chain/:moduleId', _requireAdmin, (req, res) => {
    try {
        const cc = require('../services/ml/_doctor/causalChain');
        const tree = cc.buildBlameTree({
            moduleId: req.params.moduleId,
            maxDepth: req.query.maxDepth ? Number(req.query.maxDepth) : undefined,
        });
        res.json({ ok: true, ...tree });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ─── D-6: Semantic Conflict Map ───────────────────────────────────────────
router.get('/conflict-map', _requireAdmin, (req, res) => {
    try {
        const cm = require('../services/ml/_doctor/conflictMap');
        const result = cm.compareSnapshots({
            fromId: Number(req.query.from),
            toId: req.query.to ? Number(req.query.to) : undefined,
        });
        if (result.error) return res.status(400).json({ ok: false, error: result.error });
        res.json({ ok: true, ...result });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});
```

- [ ] **Step 4: Wire auto-snapshot in analyzer.js**

In `server/services/ml/_doctor/analyzer.js`, find where P0 events are emitted (inside `analyze()` function, where severity is classified as P0). After the P0 event emission, add:

```javascript
        // [D-6] Auto-snapshot on P0 event
        try {
            const cogSnap = require('./cognitiveSnapshot');
            cogSnap.captureSnapshot({ triggerType: 'auto_p0', triggerEventId: eventId || null });
        } catch (_) { /* never block analyzer on snapshot */ }
```

Read `analyzer.js` first to find the exact insertion point — search for where P0 severity is detected and an event is written to `ml_diagnostic_events`.

- [ ] **Step 5: Run all D-6 tests together**

```bash
/root/.nvm/versions/node/v22.22.3/bin/node /root/zeus-terminal/node_modules/.bin/jest tests/unit/ml/doctorSnapshot.test.js tests/unit/ml/doctorCausalChain.test.js tests/unit/ml/doctorConflictMap.test.js tests/unit/ml/doctorD6Routes.test.js --forceExit --no-coverage
```
Expected: ALL PASS

- [ ] **Step 6: Run full ML test suite**

```bash
/root/.nvm/versions/node/v22.22.3/bin/node /root/zeus-terminal/node_modules/.bin/jest tests/unit/ml/ --forceExit --no-coverage
```
Expected: ALL PASS, no regressions

- [ ] **Step 7: Commit**

```bash
git add server/routes/doctor.js server/services/ml/_doctor/analyzer.js tests/unit/ml/doctorD6Routes.test.js
git commit -m "feat(d6): 5 API routes + analyzer auto-snapshot on P0"
```

- [ ] **Step 8: PM2 reload + verify live**

```bash
pm2 reload zeus --update-env
sleep 10
# Verify snapshot API works
TOKEN=$(node -e "const jwt=require('jsonwebtoken');const s=require('fs').readFileSync('/root/zeus-terminal/.env','utf8').match(/JWT_SECRET=(.+)/)[1].trim();console.log(jwt.sign({id:1,role:'admin',tokenVersion:1},s,{expiresIn:'1h'}))")
curl -s -X POST http://127.0.0.1:3000/api/omega/doctor/snapshots -H "Cookie: zeus_token=$TOKEN"
# Expected: {"ok":true,"id":1,"cognitiveState":"HEALTHY",...}
curl -s http://127.0.0.1:3000/api/omega/doctor/snapshots -H "Cookie: zeus_token=$TOKEN"
# Expected: {"ok":true,"snapshots":[...]}
curl -s http://127.0.0.1:3000/api/omega/doctor/causal-chain/serverBrain -H "Cookie: zeus_token=$TOKEN"
# Expected: {"ok":true,"root":"serverBrain","depth":...,"nodes":[...]}
```

- [ ] **Step 9: Tag**

```bash
git tag doctor-d6-snapshot-causal-conflict-COMPLETE-$(date +%Y%m%d)
git push origin main --tags
```

---

## Verification Checklist

- [ ] ml_cognitive_snapshots table created (migration 401)
- [ ] captureSnapshot stores full brain state (trust + quarantine + shed + cognitive)
- [ ] listSnapshots returns sorted desc
- [ ] pruneOld removes >90d snapshots
- [ ] buildBlameTree walks allowedDeps backward with max depth 5
- [ ] getModuleHealth returns trust + latency + ranOk
- [ ] compareSnapshots detects trust delta >= 0.2
- [ ] compareSnapshots detects quarantine changes
- [ ] compareSnapshots with no toId uses live state
- [ ] POST /snapshots creates manual snapshot
- [ ] GET /snapshots lists recent
- [ ] GET /snapshots/:id returns detail
- [ ] GET /causal-chain/:moduleId returns blame tree
- [ ] GET /conflict-map?from=X&to=Y returns divergences
- [ ] All endpoints admin-only (403 for non-admin)
- [ ] Auto-snapshot fires on P0 event in analyzer
- [ ] Zero test regressions
- [ ] PM2 reload clean, zero errors
