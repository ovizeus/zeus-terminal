'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'market-route-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.MARKET_RADAR_ENABLED = '0';

const express = require('express');
const request = require('supertest');
const marketRadar = require('../../server/services/marketRadar');
const marketRoutes = require('../../server/routes/market');

function makeApp() {
    const app = express();
    app.use('/api/market', marketRoutes);
    return app;
}

const FIXTURE = [
    { symbol: 'BTCUSDT', price: 70000, priceChangePercent24h:  2.5,  quoteVolume: 5_000_000_000 },
    { symbol: 'PEPEUSDT', price: 0.00002, priceChangePercent24h: 35.0, quoteVolume: 700_000_000 },
    { symbol: 'LUNAUSDT', price: 0.5, priceChangePercent24h: -22.0, quoteVolume:  600_000_000 },
];

describe('GET /api/market/top', () => {
    let app;
    beforeAll(() => { app = makeApp(); });
    beforeEach(() => { marketRadar._resetSnapshotForTest(); });

    test('returns warming_up when no snapshot yet', async () => {
        const r = await request(app).get('/api/market/top?kind=gainers&limit=5');
        expect(r.status).toBe(200);
        expect(r.body.ok).toBe(false);
        expect(r.body.error).toBe('radar_warming_up');
        expect(r.body.symbols).toEqual([]);
    });

    test('returns top gainers when snapshot exists', async () => {
        marketRadar._ingestSnapshotForTest(FIXTURE);
        const r = await request(app).get('/api/market/top?kind=gainers&limit=2');
        expect(r.body.ok).toBe(true);
        expect(r.body.kind).toBe('gainers');
        expect(r.body.symbols[0].symbol).toBe('PEPEUSDT');
    });

    test('falls back to volume kind on bogus input', async () => {
        marketRadar._ingestSnapshotForTest(FIXTURE);
        const r = await request(app).get('/api/market/top?kind=bogus');
        expect(r.body.kind).toBe('volume');
    });

    test('GET /symbol/:symbol returns single entry', async () => {
        marketRadar._ingestSnapshotForTest(FIXTURE);
        const r = await request(app).get('/api/market/symbol/BTC');
        expect(r.body.ok).toBe(true);
        expect(r.body.symbol).toBe('BTCUSDT');
        expect(r.body.price).toBe(70000);
    });

    test('GET /symbol/:symbol 404 for unknown symbol', async () => {
        marketRadar._ingestSnapshotForTest(FIXTURE);
        const r = await request(app).get('/api/market/symbol/UNKNOWNXYZ');
        expect(r.status).toBe(404);
        expect(r.body.ok).toBe(false);
    });
});
