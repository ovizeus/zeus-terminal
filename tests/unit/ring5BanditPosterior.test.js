'use strict';

// [Wave 9 Worktrack B] Ring5 bandit posterior dashboard route — read-only
// view over ml_bandit_posteriors with parsed cell_key (level:env:symbol:regime),
// posterior_mean = alpha/(alpha+beta), and eligibility flag (n_obs ≥ 30).
// Operator-facing decision support for T+48h seed go/no-go.

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r5-post-'));
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

function seedPosterior(level, cellKey, alpha, beta, obsCount, updatedAt) {
    db.prepare(
        `INSERT INTO ml_bandit_posteriors (level, cell_key, alpha, beta, observation_count, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(level, cell_key) DO UPDATE SET
           alpha = excluded.alpha, beta = excluded.beta,
           observation_count = excluded.observation_count, updated_at = excluded.updated_at`
    ).run(level, cellKey, alpha, beta, obsCount, updatedAt);
}

describe('GET /api/omega/ring5/bandit/posterior', () => {
    let app;
    beforeAll(() => {
        seedUser(1);
        app = makeApp();
    });
    beforeEach(() => {
        db.prepare("DELETE FROM ml_bandit_posteriors").run();
    });

    test('returns empty array when no posteriors exist', async () => {
        const r = await request(app).get('/api/omega/ring5/bandit/posterior').expect(200);
        expect(r.body.ok).toBe(true);
        expect(r.body.cells).toEqual([]);
        expect(r.body.summary).toBeDefined();
        expect(r.body.summary.total_cells).toBe(0);
        expect(r.body.summary.eligible_cells).toBe(0);
    });

    test('returns parsed cell_key components + posterior_mean + eligibility', async () => {
        const now = Date.now();
        seedPosterior(1, '1:DEMO:BTCUSDT:TREND', 5.0, 3.0, 7, now);
        seedPosterior(2, '1:DEMO:ETHUSDT:RANGE', 35.0, 15.0, 49, now);
        const r = await request(app).get('/api/omega/ring5/bandit/posterior').expect(200);
        expect(r.body.cells.length).toBe(2);
        const btc = r.body.cells.find(c => c.symbol === 'BTCUSDT');
        expect(btc.level).toBe(1);
        expect(btc.env).toBe('DEMO');
        expect(btc.regime).toBe('TREND');
        expect(btc.alpha).toBe(5);
        expect(btc.beta).toBe(3);
        expect(btc.observation_count).toBe(7);
        expect(btc.posterior_mean).toBeCloseTo(5 / 8, 3);
        expect(btc.eligible).toBe(false);
        const eth = r.body.cells.find(c => c.symbol === 'ETHUSDT');
        expect(eth.observation_count).toBe(49);
        expect(eth.eligible).toBe(true);
        expect(eth.posterior_mean).toBeCloseTo(35 / 50, 3);
    });

    test('summary counts total and eligible cells', async () => {
        const now = Date.now();
        seedPosterior(1, '1:DEMO:BTCUSDT:TREND', 5.0, 3.0, 7, now);
        seedPosterior(1, '1:DEMO:BTCUSDT:RANGE', 12.0, 8.0, 19, now);
        seedPosterior(2, '1:DEMO:ETHUSDT:TREND', 35.0, 15.0, 49, now);
        seedPosterior(2, '1:DEMO:SOLUSDT:BREAKOUT', 60.0, 40.0, 99, now);
        const r = await request(app).get('/api/omega/ring5/bandit/posterior').expect(200);
        expect(r.body.summary.total_cells).toBe(4);
        expect(r.body.summary.eligible_cells).toBe(2);
        expect(r.body.summary.threshold_obs).toBe(30);
    });

    test('cells sorted by observation_count DESC', async () => {
        const now = Date.now();
        seedPosterior(1, '1:DEMO:BTCUSDT:TREND', 5.0, 3.0, 7, now);
        seedPosterior(2, '1:DEMO:ETHUSDT:TREND', 35.0, 15.0, 49, now);
        seedPosterior(3, '1:DEMO:SOLUSDT:RANGE', 8.0, 7.0, 14, now);
        const r = await request(app).get('/api/omega/ring5/bandit/posterior').expect(200);
        expect(r.body.cells[0].observation_count).toBe(49);
        expect(r.body.cells[1].observation_count).toBe(14);
        expect(r.body.cells[2].observation_count).toBe(7);
    });

    test('malformed cell_key gracefully handled', async () => {
        const now = Date.now();
        seedPosterior(1, 'WEIRDFORMAT', 5.0, 3.0, 7, now);
        const r = await request(app).get('/api/omega/ring5/bandit/posterior').expect(200);
        expect(r.body.cells.length).toBe(1);
        expect(r.body.cells[0].cell_key).toBe('WEIRDFORMAT');
        expect(r.body.cells[0].symbol).toBeNull();
    });

    test('limit param clamps response', async () => {
        const now = Date.now();
        for (let i = 0; i < 10; i++) {
            seedPosterior(1, `1:DEMO:SYM${i}USDT:TREND`, 2.0, 2.0, i + 1, now);
        }
        const r = await request(app).get('/api/omega/ring5/bandit/posterior?limit=5').expect(200);
        expect(r.body.cells.length).toBe(5);
        expect(r.body.summary.total_cells).toBe(10);
    });
});
