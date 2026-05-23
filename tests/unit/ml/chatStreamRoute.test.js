'use strict';

// [Day 32D] /api/omega/chat-stream — SSE end-to-end.

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-route-stream-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';
process.env.MARKET_RADAR_ENABLED = '0';
delete process.env.GROQ_API_KEY;
delete process.env.XAI_API_KEY;

const express = require('express');
const request = require('supertest');
const omegaRoutes = require('../../../server/routes/omega');
const marketRadar = require('../../../server/services/marketRadar');

function makeApp() {
    const app = express();
    // Inject a fake user (sessionAuth shim) so _requireUser passes
    app.use((req, _res, next) => { req.user = { id: 1 }; next(); });
    app.use('/api/omega', omegaRoutes);
    return app;
}

function parseSseFrames(body) {
    const frames = [];
    for (const block of String(body).split('\n\n')) {
        const m = block.match(/^data:\s*(.*)$/m);
        if (m) {
            try { frames.push(JSON.parse(m[1])); } catch (_) {}
        }
    }
    return frames;
}

describe('POST /api/omega/chat-stream', () => {
    let app;
    beforeAll(() => {
        marketRadar._ingestSnapshotForTest([
            { symbol: 'BTCUSDT', price: 70000, priceChangePercent24h: 2.5, quoteVolume: 5e9 },
        ]);
        app = makeApp();
    });

    afterAll(() => {
        marketRadar._resetSnapshotForTest();
    });

    test('emits chunk + done frames for local intent (greeting)', async () => {
        const res = await request(app)
            .post('/api/omega/chat-stream')
            .send({ text: 'hi' })
            .expect(200);
        expect(res.headers['content-type']).toMatch(/text\/event-stream/);
        const frames = parseSseFrames(res.text);
        const chunks = frames.filter(f => f.type === 'chunk');
        const done = frames.find(f => f.type === 'done');
        expect(chunks.length).toBe(1);
        expect(chunks[0].text).toMatch(/yo boss|omega/i);
        expect(done).toBeDefined();
        expect(done.streamed).toBe(false);
    });

    test('400 when text missing', async () => {
        const res = await request(app)
            .post('/api/omega/chat-stream')
            .send({})
            .expect(400);
        expect(res.body.ok).toBe(false);
    });

    test('emits top-gainers chunk for market intent', async () => {
        const res = await request(app)
            .post('/api/omega/chat-stream')
            .send({ text: 'top gainers' })
            .expect(200);
        const frames = parseSseFrames(res.text);
        const chunk = frames.find(f => f.type === 'chunk');
        expect(chunk.text).toMatch(/BTC/);
    });
});
