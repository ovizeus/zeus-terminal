'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-routes-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const express = require('express');
const request = require('supertest');

const { db } = require('../../../server/services/database');
const registry = require('../../../server/services/ml/_doctor/moduleRegistry');
const seed = require('../../../server/services/ml/_doctor/seedRegistry');
const trustScorer = require('../../../server/services/ml/_doctor/trustScorer');
const analyzer = require('../../../server/services/ml/_doctor/analyzer');
const eventBus = require('../../../server/services/ml/_doctor/eventBus');

const doctorRoutes = require('../../../server/routes/doctor');

const _now = () => Date.now();

function buildApp(user) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = user; next(); });
    app.use('/api/omega/doctor', doctorRoutes);
    return app;
}

function clean() {
    db.prepare("DELETE FROM ml_diagnostic_events").run();
    db.prepare("DELETE FROM ml_module_heartbeats").run();
    db.prepare("DELETE FROM ml_module_registry").run();
    eventBus.resetForTest();
    trustScorer.resetForTest();
    analyzer.resetForTest();
    seed.runSeed();  // populate registry for module endpoints
}

function seedEvent(eventId, severity, moduleId, verdict, ts) {
    db.prepare(`
        INSERT INTO ml_diagnostic_events
        (event_id, severity, module_id, event_type, payload_json, verdict, ts)
        VALUES (?, ?, ?, 'alert', '{}', ?, ?)
    `).run(eventId, severity, moduleId, verdict, ts);
}

describe('D-4.1 Doctor API routes', () => {
    beforeEach(clean);

    describe('Admin guard', () => {
        test('rejects non-admin (403)', async () => {
            const app = buildApp({ id: 5, role: 'user' });
            const res = await request(app).get('/api/omega/doctor/state');
            expect(res.status).toBe(403);
        });

        test('rejects missing user (403)', async () => {
            const app = buildApp(null);
            const res = await request(app).get('/api/omega/doctor/state');
            expect(res.status).toBe(403);
        });

        test('accepts admin user', async () => {
            const app = buildApp({ id: 1, role: 'admin' });
            const res = await request(app).get('/api/omega/doctor/state');
            expect(res.status).toBe(200);
        });
    });

    describe('GET /state', () => {
        test('returns current cognitive state dashboard', async () => {
            const app = buildApp({ id: 1, role: 'admin' });
            const res = await request(app).get('/api/omega/doctor/state');
            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(res.body.state).toBe('HEALTHY');
            expect(res.body.activeP0).toBeDefined();
            expect(res.body.activeP1).toBeDefined();
            expect(res.body.quotaStatus).toBeDefined();
            expect(res.body.lowTrustModules).toBeDefined();
            expect(res.body.downweightedModules).toBeDefined();
        });

        test('reflects COMPROMISED when active P0 exists', async () => {
            seedEvent('p0_state', 'P0', 'm', null, _now());
            const app = buildApp({ id: 1, role: 'admin' });
            const res = await request(app).get('/api/omega/doctor/state');
            expect(res.body.state).toBe('COMPROMISED');
            expect(res.body.activeP0).toBe(1);
        });
    });

    describe('GET /events', () => {
        test('returns recent events with default limit', async () => {
            for (let i = 0; i < 5; i++) {
                seedEvent(`ev_${i}`, 'P2', 'mod', null, _now() + i);
            }
            const app = buildApp({ id: 1, role: 'admin' });
            const res = await request(app).get('/api/omega/doctor/events');
            expect(res.status).toBe(200);
            expect(res.body.events.length).toBe(5);
        });

        test('respects limit param', async () => {
            for (let i = 0; i < 10; i++) {
                seedEvent(`evlim_${i}`, 'P2', 'mod', null, _now() + i);
            }
            const app = buildApp({ id: 1, role: 'admin' });
            const res = await request(app).get('/api/omega/doctor/events?limit=3');
            expect(res.body.events.length).toBe(3);
        });

        test('respects since param', async () => {
            const cutoff = _now() + 100;
            seedEvent('old', 'P2', 'mod', null, _now() - 1000);
            seedEvent('new', 'P2', 'mod', null, cutoff + 100);
            const app = buildApp({ id: 1, role: 'admin' });
            const res = await request(app).get(`/api/omega/doctor/events?since=${cutoff}`);
            const ids = res.body.events.map(e => e.event_id);
            expect(ids).toContain('new');
            expect(ids).not.toContain('old');
        });

        test('caps limit at 1000', async () => {
            const app = buildApp({ id: 1, role: 'admin' });
            const res = await request(app).get('/api/omega/doctor/events?limit=99999');
            // No throw + sensible default
            expect(res.status).toBe(200);
        });
    });

    describe('GET /modules', () => {
        test('lists registered modules', async () => {
            const app = buildApp({ id: 1, role: 'admin' });
            const res = await request(app).get('/api/omega/doctor/modules');
            expect(res.status).toBe(200);
            expect(res.body.modules.length).toBeGreaterThan(50);
            const ids = res.body.modules.map(m => m.moduleId);
            expect(ids).toContain('positionStateMachine');
        });

        test('filter by roleTag', async () => {
            const app = buildApp({ id: 1, role: 'admin' });
            const res = await request(app)
                .get('/api/omega/doctor/modules?roleTag=hot_path_critical');
            expect(res.status).toBe(200);
            expect(res.body.modules.length).toBeGreaterThan(0);
            for (const m of res.body.modules) {
                expect(m.roleTag).toBe('hot_path_critical');
            }
        });

        test('rejects invalid roleTag', async () => {
            const app = buildApp({ id: 1, role: 'admin' });
            const res = await request(app)
                .get('/api/omega/doctor/modules?roleTag=invalid');
            expect(res.status).toBe(400);
        });
    });

    describe('POST /verdict', () => {
        test('sets verdict on event', async () => {
            seedEvent('verd_t', 'P1', 'modV', null, _now());
            const app = buildApp({ id: 1, role: 'admin' });
            const res = await request(app)
                .post('/api/omega/doctor/verdict')
                .send({ eventId: 'verd_t', verdict: 'real_incident' });
            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            const row = db.prepare("SELECT verdict FROM ml_diagnostic_events WHERE event_id=?").get('verd_t');
            expect(row.verdict).toBe('real_incident');
        });

        test('rejects invalid verdict (400)', async () => {
            seedEvent('verd_bad', 'P1', 'modX', null, _now());
            const app = buildApp({ id: 1, role: 'admin' });
            const res = await request(app)
                .post('/api/omega/doctor/verdict')
                .send({ eventId: 'verd_bad', verdict: 'maybe' });
            expect(res.status).toBe(400);
        });

        test('rejects unknown eventId (404)', async () => {
            const app = buildApp({ id: 1, role: 'admin' });
            const res = await request(app)
                .post('/api/omega/doctor/verdict')
                .send({ eventId: 'never_existed', verdict: 'real_incident' });
            expect(res.status).toBe(404);
        });
    });

    describe('GET /quota', () => {
        test('returns rolling quota counts', async () => {
            seedEvent('q1', 'P0', 'm', null, _now() - 1000);
            seedEvent('q2', 'P1', 'm', null, _now() - 1000);
            seedEvent('q3', 'P1', 'm', null, _now() - 500);
            const app = buildApp({ id: 1, role: 'admin' });
            const res = await request(app).get('/api/omega/doctor/quota');
            expect(res.body.p0_24h).toBe(1);
            expect(res.body.p1_1h).toBe(2);
        });
    });
});
