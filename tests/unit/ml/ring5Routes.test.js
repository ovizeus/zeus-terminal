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
const es = require('../../../server/services/ml/_ring5/effectiveStatus');
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
    es.resetCacheForTest();
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

    describe('POST /influence/seed (admin activator)', () => {
        test('rejects non-admin', async () => {
            const app = buildApp({ id: 5, role: 'user' });
            const res = await request(app).post('/api/ring5/influence/seed');
            expect(res.status).toBe(403);
        });

        test('creates active version + preReg when none exists', async () => {
            const app = buildApp({ id: 1, role: 'admin' });
            const res = await request(app).post('/api/ring5/influence/seed');
            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(res.body.status).toBe('seeded');
            expect(res.body.versionId).toBeGreaterThan(0);
            expect(res.body.preRegId).toBeGreaterThan(0);

            const vrow = db.prepare("SELECT * FROM ml_governance_versions WHERE id=?").get(res.body.versionId);
            expect(vrow.state).toBe('ACTIVE');
            expect(vrow.component_id).toBe('ring5-bandit-influence-phase4');

            const prRow = db.prepare("SELECT * FROM ml_hypothesis_pre_registrations WHERE id=?").get(res.body.preRegId);
            expect(prRow.state).toBe('REGISTERED');
            expect(prRow.version_id).toBe(res.body.versionId);
        });

        test('idempotent: second seed returns already_active', async () => {
            const app = buildApp({ id: 1, role: 'admin' });
            const first = await request(app).post('/api/ring5/influence/seed');
            expect(first.body.status).toBe('seeded');
            const second = await request(app).post('/api/ring5/influence/seed');
            expect(second.body.ok).toBe(true);
            expect(second.body.status).toBe('already_active');
            expect(second.body.versionId).toBe(first.body.versionId);
            expect(second.body.preRegId).toBe(first.body.preRegId);
        });
    });

    describe('GET /influence/status', () => {
        test('returns inactive when no version exists', async () => {
            const app = buildApp({ id: 1, role: 'admin' });
            const res = await request(app).get('/api/ring5/influence/status');
            expect(res.body.ok).toBe(true);
            expect(res.body.active).toBe(false);
            expect(res.body.versionId).toBeNull();
            expect(res.body.preRegId).toBeNull();
        });

        test('returns active after seed', async () => {
            const app = buildApp({ id: 1, role: 'admin' });
            const seed = await request(app).post('/api/ring5/influence/seed');
            const res = await request(app).get('/api/ring5/influence/status');
            expect(res.body.active).toBe(true);
            expect(res.body.versionId).toBe(seed.body.versionId);
            expect(res.body.preRegId).toBe(seed.body.preRegId);
            expect(res.body.preRegState).toBe('REGISTERED');
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
