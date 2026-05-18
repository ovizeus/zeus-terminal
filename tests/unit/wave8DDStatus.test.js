'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wave8-dd-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const express = require('express');
const request = require('supertest');
const omegaRoutes = require('../../server/routes/omega');

function makeApp() {
    const app = express();
    app.use((req, _res, next) => { req.user = { id: 1 }; next(); });
    app.use('/api/omega', omegaRoutes);
    return app;
}

describe('GET /api/omega/dd-status', () => {
    let app;
    beforeAll(() => { app = makeApp(); });

    test('returns ok + color + drawdownPct shape', async () => {
        const r = await request(app).get('/api/omega/dd-status').expect(200);
        expect(r.body.ok).toBe(true);
        expect(typeof r.body.drawdownPct).toBe('number');
        expect(typeof r.body.dailyPnL).toBe('number');
        expect(['green', 'yellow', 'red']).toContain(r.body.color);
    });

    test('color = green when no drawdown (default state)', async () => {
        const r = await request(app).get('/api/omega/dd-status').expect(200);
        expect(r.body.drawdownPct).toBeLessThan(3);
        expect(r.body.color).toBe('green');
    });
});
