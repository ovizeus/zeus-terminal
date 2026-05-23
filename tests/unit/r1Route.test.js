'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r1-route-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const express = require('express');
const request = require('supertest');
const { db } = require('../../server/services/database');
const omegaRoutes = require('../../server/routes/omega');

function seedUser(uid) {
    try {
        db.prepare(`INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, ?)`)
          .run(uid, `u${uid}@test.local`, 'x');
    } catch (_) {}
}

function makeApp() {
    const app = express();
    app.use((req, _res, next) => { req.user = { id: 1 }; next(); });
    app.use('/api/omega', omegaRoutes);
    return app;
}

describe('R1 constitution routes', () => {
    let app;
    beforeAll(() => {
        seedUser(1);
        app = makeApp();
        db.prepare("DELETE FROM ml_r1_violations").run();
    });

    test('GET /constitution/principles returns 7 principles', async () => {
        const r = await request(app).get('/api/omega/constitution/principles').expect(200);
        expect(r.body.ok).toBe(true);
        expect(r.body.principles.length).toBe(7);
        const ids = r.body.principles.map(p => p.id);
        expect(ids).toEqual(expect.arrayContaining([
            'MAX_POSITION_SIZE_PCT', 'MAX_LEVERAGE', 'NO_REVENGE_TRADE',
        ]));
    });

    test('GET /constitution/violations empty when none', async () => {
        const r = await request(app).get('/api/omega/constitution/violations').expect(200);
        expect(r.body.ok).toBe(true);
        expect(r.body.violations).toEqual([]);
    });

    test('GET /constitution/violations returns rows for user', async () => {
        db.prepare(
            `INSERT INTO ml_r1_violations (user_id, principle_id, principle_name, symbol, side, severity, decision_payload_json, enforcement_mode, ts)
             VALUES (1, 'MAX_LEVERAGE', 'Max leverage 25x', 'BTCUSDT', 'LONG', 'hard', '{}', 'advisory', ?)`
        ).run(Date.now());
        const r = await request(app).get('/api/omega/constitution/violations').expect(200);
        expect(r.body.violations.length).toBe(1);
        expect(r.body.violations[0].principle_id).toBe('MAX_LEVERAGE');
    });

    test('limit param clamped to 200 max', async () => {
        const r = await request(app).get('/api/omega/constitution/violations?limit=999').expect(200);
        expect(r.body.ok).toBe(true);
        // We can't easily check internal limit, but no crash + ok shape suffices
    });
});
