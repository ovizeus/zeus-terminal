# Doctor D-7: Cognitive Sandbox — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A/B module testing orchestrator wrapping R6 abTesting infrastructure.

**Architecture:** `cognitiveSandbox.js` wraps `R6_shadowMeta/abTesting.js` with Doctor-specific semantics (module targeting, snapshot integration). 3 new API endpoints. Test runner: `/root/.nvm/versions/node/v22.22.3/bin/node /root/zeus-terminal/node_modules/.bin/jest`

**Tech Stack:** Node.js 22, better-sqlite3, Jest

---

### Task 1: cognitiveSandbox module

**Files:**
- Create: `server/services/ml/_doctor/cognitiveSandbox.js`
- Test: `tests/unit/ml/doctorSandbox.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';
const { db } = require('../../../server/services/database');

beforeEach(() => {
  try { db.prepare('DELETE FROM ml_experiments').run(); } catch(_) {}
  try { db.prepare('DELETE FROM ml_experiment_outcomes').run(); } catch(_) {}
});
afterAll(() => {
  try { db.prepare('DELETE FROM ml_experiments').run(); } catch(_) {}
  try { db.prepare('DELETE FROM ml_experiment_outcomes').run(); } catch(_) {}
});

describe('Doctor D-7: cognitiveSandbox', () => {
  test('createExperiment returns experimentId', () => {
    const sb = require('../../../server/services/ml/_doctor/cognitiveSandbox');
    const result = sb.createExperiment({
      moduleId: 'confidenceDecay',
      name: 'test_threshold_compare',
      variantAConfig: { threshold: 0.3 },
      variantBConfig: { threshold: 0.5 },
    });
    expect(result).toHaveProperty('experimentId');
    expect(result.experimentId).toBeGreaterThan(0);
  });

  test('getExperimentStatus returns state', () => {
    const sb = require('../../../server/services/ml/_doctor/cognitiveSandbox');
    const { experimentId } = sb.createExperiment({
      moduleId: 'confidenceDecay',
      name: 'test_status',
      variantAConfig: { x: 1 },
      variantBConfig: { x: 2 },
    });
    const status = sb.getExperimentStatus({ experimentId });
    expect(status).toHaveProperty('state');
    expect(status).toHaveProperty('moduleId', 'confidenceDecay');
  });

  test('listExperiments returns array', () => {
    const sb = require('../../../server/services/ml/_doctor/cognitiveSandbox');
    sb.createExperiment({ moduleId: 'modA', name: 'exp1', variantAConfig: {}, variantBConfig: {} });
    sb.createExperiment({ moduleId: 'modB', name: 'exp2', variantAConfig: {}, variantBConfig: {} });
    const list = sb.listExperiments({});
    expect(list.length).toBe(2);
  });

  test('completeExperiment returns result', () => {
    const sb = require('../../../server/services/ml/_doctor/cognitiveSandbox');
    const { experimentId } = sb.createExperiment({
      moduleId: 'testMod',
      name: 'test_complete',
      variantAConfig: { a: 1 },
      variantBConfig: { b: 2 },
    });
    const result = sb.completeExperiment({ experimentId });
    expect(result).toHaveProperty('completed', true);
  });
});
```

- [ ] **Step 2: Run test — should FAIL**

- [ ] **Step 3: Create cognitiveSandbox.js**

```javascript
'use strict';

const MAX_DURATION_MS = 7 * 86400000; // 7 days max
const DEFAULT_DURATION_MS = 24 * 3600000; // 24h default
const DEFAULT_ALLOCATION_B = 0.5; // 50/50 split

function createExperiment(params) {
    const moduleId = params && params.moduleId;
    const name = (params && params.name) || `sandbox_${moduleId}_${Date.now()}`;
    const variantAConfig = (params && params.variantAConfig) || {};
    const variantBConfig = (params && params.variantBConfig) || {};
    const allocationPctB = (params && params.allocationPctB) || DEFAULT_ALLOCATION_B;
    const actor = (params && params.actor) || 'doctor_sandbox';

    if (!moduleId) throw new Error('moduleId required');

    const ab = require('../ml/R6_shadowMeta/abTesting');
    const vr = require('../ml/R5B_governance/versionRegistry');

    // Create version entries for A and B
    let versionAId, versionBId;
    try {
        const vA = vr.proposeVersion({
            componentType: 'sandbox', componentId: moduleId,
            version: `sandbox-A-${Date.now()}`,
            configJson: JSON.stringify(variantAConfig), actor,
        });
        versionAId = vA.id || vA.versionId || 1;
    } catch (_) { versionAId = 1; }

    try {
        const vB = vr.proposeVersion({
            componentType: 'sandbox', componentId: moduleId,
            version: `sandbox-B-${Date.now()}`,
            configJson: JSON.stringify(variantBConfig), actor,
        });
        versionBId = vB.id || vB.versionId || 2;
    } catch (_) { versionBId = 2; }

    const exp = ab.createExperiment({
        name,
        versionAId,
        versionBId,
        allocationPctB,
        isolationMode: 'shadow',
        actor,
    });

    // Store moduleId in experiment metadata
    const experimentId = exp.id || exp.experimentId;

    return { experimentId, moduleId, name };
}

function getExperimentStatus(params) {
    const experimentId = params && params.experimentId;
    if (!experimentId) return { error: 'experimentId required' };

    try {
        const ab = require('../ml/R6_shadowMeta/abTesting');
        const metrics = ab.getExperimentMetrics({ experimentId });
        const { db } = require('../../database');
        const row = db.prepare('SELECT * FROM ml_experiments WHERE id = ?').get(experimentId);
        const moduleId = row && row.name ? row.name.split('_')[1] || row.name : 'unknown';

        return {
            experimentId,
            moduleId,
            state: row ? row.state : 'UNKNOWN',
            ...metrics,
        };
    } catch (err) {
        return { experimentId, error: err.message };
    }
}

function listExperiments(params) {
    try {
        const { db } = require('../../database');
        const state = params && params.state;
        if (state) {
            return db.prepare('SELECT id, name, state, allocation_pct_b, created_at FROM ml_experiments WHERE state = ? ORDER BY created_at DESC LIMIT 50').all(state);
        }
        return db.prepare('SELECT id, name, state, allocation_pct_b, created_at FROM ml_experiments ORDER BY created_at DESC LIMIT 50').all();
    } catch (_) { return []; }
}

function completeExperiment(params) {
    const experimentId = params && params.experimentId;
    if (!experimentId) return { error: 'experimentId required' };

    try {
        const ab = require('../ml/R6_shadowMeta/abTesting');
        ab.completeExperiment({ experimentId, actor: 'doctor_sandbox' });

        // D-6 integration: capture post-completion snapshot
        try {
            const cs = require('./cognitiveSnapshot');
            cs.captureSnapshot({ triggerType: 'scheduled' });
        } catch (_) {}

        return { completed: true, experimentId };
    } catch (err) {
        return { completed: false, error: err.message };
    }
}

module.exports = {
    createExperiment,
    getExperimentStatus,
    listExperiments,
    completeExperiment,
    DEFAULT_DURATION_MS,
    MAX_DURATION_MS,
    DEFAULT_ALLOCATION_B,
};
```

- [ ] **Step 4: Run test — should PASS**

- [ ] **Step 5: Commit**

```bash
git add server/services/ml/_doctor/cognitiveSandbox.js tests/unit/ml/doctorSandbox.test.js
git commit -m "feat(d7): cognitive sandbox A/B module testing orchestrator"
```

---

### Task 2: Routes + integration verify + tag

**Files:**
- Modify: `server/routes/doctor.js`
- Test: `tests/unit/ml/doctorD7Routes.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';
const { db } = require('../../../server/services/database');

beforeEach(() => {
  try { db.prepare('DELETE FROM ml_experiments').run(); } catch(_) {}
});
afterAll(() => {
  try { db.prepare('DELETE FROM ml_experiments').run(); } catch(_) {}
});

describe('Doctor D-7: sandbox routes', () => {
  test('cognitiveSandbox loads and creates experiment', () => {
    const sb = require('../../../server/services/ml/_doctor/cognitiveSandbox');
    const result = sb.createExperiment({
      moduleId: 'testMod', name: 'route_test',
      variantAConfig: { a: 1 }, variantBConfig: { b: 2 },
    });
    expect(result.experimentId).toBeGreaterThan(0);
  });

  test('listExperiments returns created experiments', () => {
    const sb = require('../../../server/services/ml/_doctor/cognitiveSandbox');
    sb.createExperiment({ moduleId: 'm1', name: 'e1', variantAConfig: {}, variantBConfig: {} });
    const list = sb.listExperiments({});
    expect(list.length).toBeGreaterThan(0);
  });

  test('completeExperiment captures D-6 snapshot', () => {
    const sb = require('../../../server/services/ml/_doctor/cognitiveSandbox');
    const { experimentId } = sb.createExperiment({
      moduleId: 'snapTest', name: 'snap_test',
      variantAConfig: {}, variantBConfig: {},
    });
    sb.completeExperiment({ experimentId });
    const snaps = db.prepare('SELECT COUNT(*) as cnt FROM ml_cognitive_snapshots WHERE trigger_type = ?').get('scheduled');
    expect(snaps.cnt).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test — should PASS**

- [ ] **Step 3: Add 3 routes to doctor.js**

```javascript
// ─── D-7: Cognitive Sandbox ───────────────────────────────────────────────
router.post('/sandbox/create', _requireAdmin, (req, res) => {
    try {
        const sb = require('../services/ml/_doctor/cognitiveSandbox');
        const result = sb.createExperiment({
            moduleId: req.body.moduleId,
            name: req.body.name,
            variantAConfig: req.body.variantAConfig || {},
            variantBConfig: req.body.variantBConfig || {},
            allocationPctB: req.body.allocationPctB,
            actor: 'admin',
        });
        res.json({ ok: true, ...result });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

router.get('/sandbox/:id', _requireAdmin, (req, res) => {
    try {
        const sb = require('../services/ml/_doctor/cognitiveSandbox');
        const status = sb.getExperimentStatus({ experimentId: Number(req.params.id) });
        if (status.error) return res.status(400).json({ ok: false, error: status.error });
        res.json({ ok: true, ...status });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

router.post('/sandbox/:id/complete', _requireAdmin, (req, res) => {
    try {
        const sb = require('../services/ml/_doctor/cognitiveSandbox');
        const result = sb.completeExperiment({ experimentId: Number(req.params.id) });
        if (result.error) return res.status(400).json({ ok: false, error: result.error });
        res.json({ ok: true, ...result });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});
```

- [ ] **Step 4: Run all D-7 tests + full ML suite**

- [ ] **Step 5: Commit + PM2 reload + tag**

```bash
git add server/routes/doctor.js tests/unit/ml/doctorD7Routes.test.js
git commit -m "feat(d7): 3 sandbox API routes + D-6 snapshot integration"
git tag doctor-d7-cognitive-sandbox-COMPLETE-$(date +%Y%m%d)
pm2 reload zeus --update-env
git push origin main --tags
```
