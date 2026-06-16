# ML Plan v3 — Phase B Day 5 (Phase 7 Observability Admin API) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose Ring5 influence pipeline state via admin-only HTTP API so operator can inspect audit trail, eligibility status per cell, and bandit posterior summaries without direct DB access. Mount under `/api/ring5/*`. Follows existing OMEGA Doctor pattern (`/api/omega/doctor/*`). UI integration (DoctorPanel Ring5 tab) deferred to Day 6.

**Architecture:** Single Express router module `server/routes/ring5.js` exposing 3 GET endpoints, all guarded by `_requireAdmin` middleware (same pattern as `routes/doctor.js`). (1) `GET /api/ring5/audit?since=ts&limit=N&status=accepted|rejected|skipped` — reads `ml_influence_audit` filtered by query params, paginated. (2) `GET /api/ring5/eligibility?userId=X&env=DEMO&symbol=Y&regime=Z` — runs `influenceEligibility.checkEligibility()` live and returns the result with all gate detail. (3) `GET /api/ring5/posteriors?userId=X&env=DEMO&symbol=Y&regime=Z` — reads bandit L4 posterior for the cell + walks hierarchy via `effectiveStatus.resolve` for inheritance trace. Routes mounted in `server.js` after existing doctor routes. PM2 reload procedure documented for operator-triggered deploy.

**Tech Stack:** Node.js + express + better-sqlite3 + supertest (TDD via `tests/unit/ml/ring5Routes.test.js`). Wires existing modules (`influenceEligibility`, `banditPosteriors`, `effectiveStatus`) without changes.

**Branch:** `omega/wave-1-foundation` (continuation).

**Gate:** Phase B Day 4 SHIPPED 2026-05-17 (tag `ml-plan-v3-phase-b-day4-phase5-COMPLETE-20260517-221515`). influenceEligibility module live + wrap() gated.

**Reference patterns:**
- `server/routes/doctor.js` (lines 1-150) — admin guard + endpoint shape
- `tests/unit/ml/doctorRoutes.test.js` — supertest pattern + buildApp + admin/non-admin guards

---

## File Structure

- **Create:** `server/routes/ring5.js` — 3 admin endpoints
- **Create:** `tests/unit/ml/ring5Routes.test.js` — supertest coverage
- **Modify:** `server.js` — mount router under `/api/ring5`
- **Doc:** PM2 reload procedure inline in Task 7.3 closeout

---

## Task 7.1: Build server/routes/ring5.js

**Files:**
- Create: `server/routes/ring5.js`

**Contract:**
- 3 GET endpoints, all `_requireAdmin` guarded
- All return `{ ok: true, ...payload }` on success or `{ ok: false, error: msg }` on failure
- All take optional query params; safe defaults when omitted

**Endpoint specs:**

`GET /audit?since=ts&limit=N&status=...`
- `since` (optional, integer ms) — filter rows where `created_at >= since`
- `limit` (optional, default 100, max 1000) — pagination cap
- `status` (optional, enum) — filter by gate_status
- Returns: `{ ok: true, rows: [...], count: N }`

`GET /eligibility?userId=X&env=DEMO&symbol=Y&regime=Z`
- All 4 params required
- Returns: `{ ok: true, eligibility: {...result from checkEligibility} }` or 400 on missing params

`GET /posteriors?userId=X&env=DEMO&symbol=Y&regime=Z`
- All 4 params required
- Returns: `{ ok: true, posteriors: { L0, L1, L2, L3, L4 }, effective: {...resolve result} }` or 400 on missing params

- [ ] **Step 1: Write the failing test FIRST**

Create `tests/unit/ml/ring5Routes.test.js`:

```javascript
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ring5-routes-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const express = require('express');
const request = require('supertest');

const { db } = require('../../../server/services/database');
const bp = require('../../../server/services/ml/_ring5/banditPosteriors');
const ia = require('../../../server/services/ml/_ring5/influenceAudit');
const versionRegistry = require('../../../server/services/ml/R5B_governance/versionRegistry');
const preRegistration = require('../../../server/services/ml/R5B_governance/preRegistration');

const ring5Routes = require('../../../server/routes/ring5');

const _now = () => Date.now();

function buildApp(user) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = user; next(); });
    app.use('/api/ring5', ring5Routes);
    return app;
}

function clean() {
    db.prepare("DELETE FROM ml_influence_audit").run();
    db.prepare("DELETE FROM ml_bandit_posteriors").run();
    db.prepare("DELETE FROM ml_hypothesis_pre_registrations").run();
    db.prepare("DELETE FROM ml_governance_versions").run();
}

function seedAudit(userId, gateStatus, ts) {
    return ia.record({
        userId, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending',
        phase2Decision: { dir: 'LONG', confidence: 70, score: 5, reasons: [], ts },
        proposedDecision: { dir: 'LONG', confidence: 82, score: 5, reasons: [], ts },
        gateStatus, gateReason: 'test', rationale: 'test', ts
    });
}

function seedActiveVersion() {
    const v = versionRegistry.proposeVersion({
        componentType: 'model',
        componentId: 'ring5-bandit-influence-phase4',
        version: 'v1.0.0',
        config: { thresholds: {} },
        motivation: 'test',
        actor: 'test'
    });
    versionRegistry.activateVersion({ id: v.id });
    return v.id;
}

function seedActivePreReg(versionId) {
    return preRegistration.registerHypothesis({
        versionId,
        hypothesis: 'test',
        predictedMetrics: { x: 0 },
        successCriteria: [{ metric: 'x', op: '>=', value: 0 }],
        evalWindow: { fromMs: _now() - 86400000, toMs: _now() + 86400000 },
        actor: 'test'
    });
}

describe('Ring5 admin routes', () => {
    beforeEach(clean);

    describe('Admin guard', () => {
        test('rejects non-admin (403)', async () => {
            const app = buildApp({ id: 5, role: 'user' });
            const res = await request(app).get('/api/ring5/audit');
            expect(res.status).toBe(403);
        });
        test('rejects missing user (403)', async () => {
            const app = buildApp(null);
            const res = await request(app).get('/api/ring5/audit');
            expect(res.status).toBe(403);
        });
        test('accepts admin user', async () => {
            const app = buildApp({ id: 1, role: 'admin' });
            const res = await request(app).get('/api/ring5/audit');
            expect(res.status).toBe(200);
        });
    });

    describe('GET /audit', () => {
        test('returns empty rows when no audit data', async () => {
            const app = buildApp({ id: 1, role: 'admin' });
            const res = await request(app).get('/api/ring5/audit');
            expect(res.body.ok).toBe(true);
            expect(res.body.rows).toEqual([]);
            expect(res.body.count).toBe(0);
        });

        test('returns seeded rows ordered by created_at desc', async () => {
            seedAudit(1, 'accepted', _now() - 1000);
            seedAudit(1, 'rejected', _now());
            const app = buildApp({ id: 1, role: 'admin' });
            const res = await request(app).get('/api/ring5/audit');
            expect(res.body.rows.length).toBe(2);
            expect(res.body.rows[0].gate_status).toBe('rejected');
            expect(res.body.rows[1].gate_status).toBe('accepted');
        });

        test('respects status filter', async () => {
            seedAudit(1, 'accepted', _now() - 1000);
            seedAudit(1, 'rejected', _now() - 500);
            seedAudit(1, 'skipped', _now());
            const app = buildApp({ id: 1, role: 'admin' });
            const res = await request(app).get('/api/ring5/audit?status=accepted');
            expect(res.body.rows.length).toBe(1);
            expect(res.body.rows[0].gate_status).toBe('accepted');
        });

        test('respects since filter', async () => {
            const t = _now();
            seedAudit(1, 'accepted', t - 10000);
            seedAudit(1, 'rejected', t);
            const app = buildApp({ id: 1, role: 'admin' });
            const res = await request(app).get(`/api/ring5/audit?since=${t - 5000}`);
            expect(res.body.rows.length).toBe(1);
            expect(res.body.rows[0].gate_status).toBe('rejected');
        });

        test('respects limit', async () => {
            for (let i = 0; i < 5; i++) seedAudit(1, 'accepted', _now() + i);
            const app = buildApp({ id: 1, role: 'admin' });
            const res = await request(app).get('/api/ring5/audit?limit=2');
            expect(res.body.rows.length).toBe(2);
        });

        test('caps limit at 1000', async () => {
            const app = buildApp({ id: 1, role: 'admin' });
            const res = await request(app).get('/api/ring5/audit?limit=99999');
            expect(res.status).toBe(200);
        });
    });

    describe('GET /eligibility', () => {
        test('400 when required params missing', async () => {
            const app = buildApp({ id: 1, role: 'admin' });
            const res = await request(app).get('/api/ring5/eligibility?userId=1');
            expect(res.status).toBe(400);
        });

        test('returns eligibility=false when no observations', async () => {
            const app = buildApp({ id: 1, role: 'admin' });
            const res = await request(app).get(
                '/api/ring5/eligibility?userId=1&env=DEMO&symbol=BTCUSDT&regime=trending'
            );
            expect(res.body.ok).toBe(true);
            expect(res.body.eligibility.eligible).toBe(false);
            expect(res.body.eligibility.reason).toBe('insufficient_observations');
        });

        test('returns eligibility=true when all gates satisfied', async () => {
            for (let i = 0; i < 30; i++) {
                bp.updatePosterior({ level: 4, cellKey: '1:DEMO:BTCUSDT:trending', outcomeClass: 'positive', ts: _now() });
            }
            const vId = seedActiveVersion();
            seedActivePreReg(vId);
            const app = buildApp({ id: 1, role: 'admin' });
            const res = await request(app).get(
                '/api/ring5/eligibility?userId=1&env=DEMO&symbol=BTCUSDT&regime=trending'
            );
            expect(res.body.eligibility.eligible).toBe(true);
            expect(res.body.eligibility.observationCount).toBe(30);
        });
    });

    describe('GET /posteriors', () => {
        test('400 when required params missing', async () => {
            const app = buildApp({ id: 1, role: 'admin' });
            const res = await request(app).get('/api/ring5/posteriors?userId=1');
            expect(res.status).toBe(400);
        });

        test('returns null posteriors at all levels when untrained', async () => {
            const app = buildApp({ id: 1, role: 'admin' });
            const res = await request(app).get(
                '/api/ring5/posteriors?userId=1&env=DEMO&symbol=BTCUSDT&regime=trending'
            );
            expect(res.body.ok).toBe(true);
            expect(res.body.posteriors.L0).toBeNull();
            expect(res.body.posteriors.L4).toBeNull();
            expect(res.body.effective.level).toBe(0);
            expect(res.body.effective.alpha).toBe(1);
        });

        test('returns L4 posterior when trained', async () => {
            for (let i = 0; i < 30; i++) {
                bp.updatePosterior({ level: 4, cellKey: '1:DEMO:BTCUSDT:trending', outcomeClass: 'positive', ts: _now() });
            }
            const app = buildApp({ id: 1, role: 'admin' });
            const res = await request(app).get(
                '/api/ring5/posteriors?userId=1&env=DEMO&symbol=BTCUSDT&regime=trending'
            );
            expect(res.body.posteriors.L4).not.toBeNull();
            expect(res.body.posteriors.L4.observationCount).toBe(30);
            expect(res.body.effective.level).toBe(4);
        });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/zeus-terminal && npx jest tests/unit/ml/ring5Routes.test.js --runInBand 2>&1 | tail -10`
Expected: FAIL — `Cannot find module '../../../server/routes/ring5'`.

- [ ] **Step 3: Implement minimal code**

Create `server/routes/ring5.js`:

```javascript
// Zeus Terminal — Ring5 ML influence pipeline admin-only API routes.
// Per ML Plan v3 Phase B Day 5 Phase 7. Mirrors routes/doctor.js shape.
'use strict';

const express = require('express');
const router = express.Router();

const { db } = require('../services/database');
const influenceEligibility = require('../services/ml/_ring5/influenceEligibility');
const banditPosteriors = require('../services/ml/_ring5/banditPosteriors');
const effectiveStatus = require('../services/ml/_ring5/effectiveStatus');

function _requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ ok: false, error: 'admin only' });
    }
    next();
}

const MAX_AUDIT_LIMIT = 1000;
const DEFAULT_AUDIT_LIMIT = 100;
const VALID_STATUSES = new Set(['accepted', 'rejected', 'skipped']);

// GET /api/ring5/audit?since=ts&limit=N&status=accepted|rejected|skipped
router.get('/audit', _requireAdmin, (req, res) => {
    try {
        let limit = parseInt(req.query.limit, 10);
        if (isNaN(limit) || limit <= 0) limit = DEFAULT_AUDIT_LIMIT;
        if (limit > MAX_AUDIT_LIMIT) limit = MAX_AUDIT_LIMIT;

        const since = parseInt(req.query.since, 10);
        const status = req.query.status;

        const conds = [];
        const params = [];
        if (!isNaN(since) && since > 0) {
            conds.push('created_at >= ?');
            params.push(since);
        }
        if (status && VALID_STATUSES.has(status)) {
            conds.push('gate_status = ?');
            params.push(status);
        }
        const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

        const sql = `
            SELECT id, user_id, env, symbol, regime,
                   phase2_dir, phase2_confidence, phase2_score,
                   proposed_dir, proposed_confidence, proposed_score,
                   gate_status, gate_reason, rationale_json, created_at
            FROM ml_influence_audit ${where}
            ORDER BY created_at DESC
            LIMIT ?
        `;
        const rows = db.prepare(sql).all(...params, limit);

        res.status(200).json({ ok: true, rows, count: rows.length });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/ring5/eligibility?userId=X&env=DEMO&symbol=Y&regime=Z
router.get('/eligibility', _requireAdmin, (req, res) => {
    try {
        const userId = parseInt(req.query.userId, 10);
        const env = req.query.env;
        const symbol = req.query.symbol;
        const regime = req.query.regime;
        if (!userId || !env || !symbol || !regime) {
            return res.status(400).json({
                ok: false,
                error: 'missing required query params: userId, env, symbol, regime'
            });
        }
        const eligibility = influenceEligibility.checkEligibility({
            userId, env, symbol, regime, nowTs: Date.now()
        });
        res.status(200).json({ ok: true, eligibility });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/ring5/posteriors?userId=X&env=DEMO&symbol=Y&regime=Z
router.get('/posteriors', _requireAdmin, (req, res) => {
    try {
        const userId = parseInt(req.query.userId, 10);
        const env = req.query.env;
        const symbol = req.query.symbol;
        const regime = req.query.regime;
        if (!userId || !env || !symbol || !regime) {
            return res.status(400).json({
                ok: false,
                error: 'missing required query params: userId, env, symbol, regime'
            });
        }
        const nowTs = Date.now();
        const posteriors = {
            L0: banditPosteriors.getPosterior({ level: 0, cellKey: 'global' }),
            L1: banditPosteriors.getPosterior({ level: 1, cellKey: env }),
            L2: banditPosteriors.getPosterior({ level: 2, cellKey: `${env}:${symbol}` }),
            L3: banditPosteriors.getPosterior({ level: 3, cellKey: `${env}:${symbol}:${regime}` }),
            L4: banditPosteriors.getPosterior({ level: 4, cellKey: `${userId}:${env}:${symbol}:${regime}` })
        };
        const effective = effectiveStatus.resolve({ userId, env, symbol, regime, nowTs });
        res.status(200).json({ ok: true, posteriors, effective });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

module.exports = router;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /root/zeus-terminal && npx jest tests/unit/ml/ring5Routes.test.js --runInBand 2>&1 | tail -10`
Expected: PASS — all 15 tests green.

- [ ] **Step 5: Commit**

```bash
cd /root/zeus-terminal && git add server/routes/ring5.js tests/unit/ml/ring5Routes.test.js && git commit -m "feat(ml-phase-b-day5): Ring5 admin API routes (audit + eligibility + posteriors)

3 GET endpoints under /api/ring5/* guarded by _requireAdmin:
  - /audit?since=ts&limit=N&status=... — influence audit trail
  - /eligibility?userId=X&env=&symbol=&regime= — live checkEligibility result
  - /posteriors?userId=X&env=&symbol=&regime= — L0..L4 posteriors + effective resolve

15 tests via supertest (admin guard + per-endpoint behavior).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7.2: Mount router in server.js

**Files:**
- Modify: `server.js` — add ring5Routes mount after doctor routes

- [ ] **Step 1: Locate doctor mount in server.js**

Run: `grep -n "doctorRoutes\|ring5Routes" /root/zeus-terminal/server.js`
Expected: doctorRoutes mount at line ~1122-1123.

- [ ] **Step 2: Add ring5Routes mount after doctor routes**

Edit `server.js` immediately after the doctor mount block:

```javascript
const ring5Routes = require('./server/routes/ring5');
app.use('/api/ring5', ring5Routes);
```

- [ ] **Step 3: Verify**

Run: `cd /root/zeus-terminal && node -e "require('./server/routes/ring5')" 2>&1 && echo OK`
Expected: OK (no syntax errors).

Run: `cd /root/zeus-terminal && grep -n "ring5Routes" server.js`
Expected: 2 lines — require + use.

- [ ] **Step 4: Commit**

```bash
cd /root/zeus-terminal && git add server.js && git commit -m "feat(ml-phase-b-day5): mount /api/ring5 router in server.js

Wires Day 5 ring5Routes module after existing doctor route mount block.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7.3: Day 5 closeout + PM2 deploy procedure

- [ ] **Step 1: Full regression**

Run: `cd /root/zeus-terminal && npx jest --maxWorkers=2 2>&1 | tail -8`
Expected: tests increase by ~15 vs Day 4 baseline (6756). Zero new failures.

- [ ] **Step 2: Tag**

```bash
cd /root/zeus-terminal && TAG="ml-plan-v3-phase-b-day5-phase7-COMPLETE-$(date -u +%Y%m%d-%H%M%S)" && git tag -a "$TAG" -m "ML Plan v3 Phase B Day 5 — Phase 7 Observability Admin API COMPLETE

Day 5 deliverables:
- server/routes/ring5.js (3 admin endpoints: audit / eligibility / posteriors)
- server.js mount /api/ring5
- 15 supertest covering admin guard + per-endpoint behavior

Wires existing influenceEligibility + banditPosteriors + effectiveStatus modules unchanged.

UI integration (DoctorPanel Ring5 tab) deferred to Day 6 separate work."
```

- [ ] **Step 3: Push**

```bash
cd /root/zeus-terminal && git push origin HEAD --tags
```

- [ ] **Step 4: Memory update**

Append Day 5 SHIPPED note to ML Plan v3 ACTIVE RESUMED memory entry, after Day 4 SHIPPED block.

- [ ] **Step 5: PM2 deploy procedure (operator-triggered)**

Document for operator (NOT auto-run by Claude — operator decides timing):

```bash
# Pre-flight check
cd /root/zeus-terminal && git log -1 --oneline
# Expect: latest Day 5 commit

# PM2 reload
pm2 reload zeus --update-env
pm2 logs zeus --lines 30 --nostream | grep -E "ring5|error|listen"
# Expect: server resumed, no errors

# Smoke test routes (replace ZEUS_TOKEN with actual admin JWT)
curl -sf -H "Cookie: zeus_token=$ZEUS_TOKEN" \
    http://127.0.0.1:3000/api/ring5/audit | head -c 200
# Expect: {"ok":true,"rows":[],"count":0} OR existing audit data

curl -sf -H "Cookie: zeus_token=$ZEUS_TOKEN" \
    "http://127.0.0.1:3000/api/ring5/eligibility?userId=1&env=DEMO&symbol=BTCUSDT&regime=trending"
# Expect: {"ok":true,"eligibility":{"eligible":false,"reason":"insufficient_observations",...}}

curl -sf -H "Cookie: zeus_token=$ZEUS_TOKEN" \
    "http://127.0.0.1:3000/api/ring5/posteriors?userId=1&env=DEMO&symbol=BTCUSDT&regime=trending"
# Expect: {"ok":true,"posteriors":{"L0":null,...,"L4":null},"effective":{...}}
```

If smoke test fails: `pm2 reload zeus && pm2 logs zeus` to inspect. Rollback via `git revert` last commit + reload if needed.

---

## Self-Review

**1. Spec coverage:**
- Admin API /audit + /eligibility + /posteriors ✅
- Admin auth ✅ via _requireAdmin pattern matching routes/doctor.js
- TDD via supertest ✅
- Mount in server.js ✅
- PM2 deploy procedure documented ✅
- UI (DoctorPanel) explicitly deferred to Day 6 — no scope creep

**2. Placeholder scan:** None.

**3. Type consistency:**
- `{ok: true/false}` envelope consistent across all 3 endpoints
- 400 vs 403 vs 500 status codes match doctor pattern
- VALID_STATUSES enum matches DB CHECK constraint values
- L0..L4 keys match banditPosteriors level scheme

---

## Execution Handoff

Plan saved. Inline executing-plans recommended.
