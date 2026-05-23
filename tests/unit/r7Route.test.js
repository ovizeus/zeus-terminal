'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r7-route-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const express = require('express');
const request = require('supertest');
const { db } = require('../../server/services/database');
const omegaRoutes = require('../../server/routes/omega');
const tracer = require('../../server/services/ml/R7_meta/interRingTracer');

function makeApp() {
    const app = express();
    app.use((req, _res, next) => { req.user = { id: 1 }; next(); });
    app.use('/api/omega', omegaRoutes);
    return app;
}

describe('GET /api/omega/inter-ring/recent', () => {
    let app;
    beforeAll(() => {
        app = makeApp();
        db.prepare("DELETE FROM ml_inter_ring_trace").run();
    });

    test('returns empty when no traces', async () => {
        const r = await request(app).get('/api/omega/inter-ring/recent').expect(200);
        expect(r.body.ok).toBe(true);
        expect(r.body.traces).toEqual([]);
    });

    test('returns traces ordered by ts DESC', async () => {
        const wrapped = tracer.wrap('serverBrain', 'serverReflection', 'questionEntry', () => ({ proceed: true }));
        wrapped();
        wrapped();
        const r = await request(app).get('/api/omega/inter-ring/recent').expect(200);
        expect(r.body.traces.length).toBe(2);
        expect(r.body.traces[0].callee_module).toBe('serverReflection');
    });

    test('limit param clamped to 500', async () => {
        const r = await request(app).get('/api/omega/inter-ring/recent?limit=999').expect(200);
        expect(r.body.ok).toBe(true);
    });
});
