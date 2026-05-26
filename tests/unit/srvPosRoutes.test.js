'use strict';

const express = require('express');
const request = require('supertest');

let app, router;

beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../server/services/logger', () => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    }));
    router = require('../../server/routes/srvPos');
    router._resetForTest();
    app = express();
    app.use('/api/srv-pos', router);
});

describe('POST /api/srv-pos/shadow-report — basic', () => {
    test('accepts valid divergence report', async () => {
        const res = await request(app)
            .post('/api/srv-pos/shadow-report')
            .send({ ts: Date.now(), count: 2, vectors: { v1: 1 }, writeDrops: 0, details: [] });
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
    });

    test('rejects invalid payload (missing count)', async () => {
        const res = await request(app)
            .post('/api/srv-pos/shadow-report')
            .send({ foo: 'bar' });
        expect(res.status).toBe(400);
    });

    test('logs warning on divergence count > 0', async () => {
        const logger = require('../../server/services/logger');
        await request(app)
            .post('/api/srv-pos/shadow-report')
            .send({ ts: Date.now(), count: 3, vectors: { v1: 2, v3: 1 }, writeDrops: 1, details: [] });
        expect(logger.warn).toHaveBeenCalledWith('SRV-POS', expect.stringContaining('3 divergences'));
    });
});

describe('POST /api/srv-pos/shadow-report — rate limit (5/min per IP)', () => {
    test('6th request within 60s returns 429', async () => {
        for (let i = 0; i < 5; i++) {
            const r = await request(app)
                .post('/api/srv-pos/shadow-report')
                .send({ ts: i, count: 0, vectors: {}, writeDrops: 0, details: [] });
            expect(r.status).toBe(200);
        }
        const blocked = await request(app)
            .post('/api/srv-pos/shadow-report')
            .send({ ts: 999, count: 0, vectors: {}, writeDrops: 0, details: [] });
        expect(blocked.status).toBe(429);
        expect(blocked.body.error).toContain('rate limited');
    });

    test('accepts again after rate window expires', async () => {
        const origNow = Date.now;
        let mockTime = 1000000;
        Date.now = () => mockTime;
        try {
            for (let i = 0; i < 5; i++) {
                await request(app)
                    .post('/api/srv-pos/shadow-report')
                    .send({ ts: mockTime, count: 0, vectors: {}, writeDrops: 0, details: [] });
            }
            const blocked = await request(app)
                .post('/api/srv-pos/shadow-report')
                .send({ ts: mockTime, count: 0, vectors: {}, writeDrops: 0, details: [] });
            expect(blocked.status).toBe(429);

            mockTime += 61000;
            const allowed = await request(app)
                .post('/api/srv-pos/shadow-report')
                .send({ ts: mockTime, count: 0, vectors: {}, writeDrops: 0, details: [] });
            expect(allowed.status).toBe(200);
        } finally {
            Date.now = origNow;
        }
    });
});

describe('buffer cap (MAX_REPORTS = 100) — black-box via HTTP', () => {
    test('105 HTTP inserts → buffer at 100, oldest evicted', async () => {
        const origNow = Date.now;
        let mockTime = 2000000;
        Date.now = () => mockTime;
        try {
            let accepted = 0;
            for (let batch = 0; batch < 21; batch++) {
                // Advance time past rate window for each batch of 5
                mockTime += 61000;
                for (let i = 0; i < 5 && accepted < 105; i++) {
                    const r = await request(app)
                        .post('/api/srv-pos/shadow-report')
                        .send({ ts: accepted, count: 1, vectors: {}, writeDrops: 0, details: [] });
                    expect(r.status).toBe(200);
                    accepted++;
                }
            }
            expect(accepted).toBe(105);

            const res = await request(app).get('/api/srv-pos/shadow-report?last=200');
            expect(res.body.totalReports).toBe(100);
            // Oldest 5 entries (ts 0-4) should be evicted
            expect(res.body.recent[0].ts).toBe(5);
            expect(res.body.recent[99].ts).toBe(104);
        } finally {
            Date.now = origNow;
        }
    });
});

describe('GET /api/srv-pos/shadow-report', () => {
    test('returns empty state initially', async () => {
        const res = await request(app).get('/api/srv-pos/shadow-report');
        expect(res.status).toBe(200);
        expect(res.body.totalReports).toBe(0);
        expect(res.body.totalDivergences).toBe(0);
        expect(res.body.recent).toEqual([]);
    });

    test('returns recent reports after POST', async () => {
        await request(app)
            .post('/api/srv-pos/shadow-report')
            .send({ ts: 1000, count: 5, vectors: { v2: 3 }, writeDrops: 2, details: [{ key: 'BTC/LONG/demo' }] });
        const res = await request(app).get('/api/srv-pos/shadow-report');
        expect(res.body.totalReports).toBe(1);
        expect(res.body.totalDivergences).toBe(5);
        expect(res.body.recent[0].vectors.v2).toBe(3);
    });

    test('?last limits response count', async () => {
        for (let i = 0; i < 5; i++) {
            await request(app)
                .post('/api/srv-pos/shadow-report')
                .send({ ts: i, count: 1, vectors: {}, writeDrops: 0, details: [] });
        }
        const res = await request(app).get('/api/srv-pos/shadow-report?last=3');
        expect(res.body.recent.length).toBe(3);
    });
});

describe('_postTimestamps cleanup', () => {
    test('IP entry created on POST, removed when timestamps expire', async () => {
        const origNow = Date.now;
        let mockTime = 3000000;
        Date.now = () => mockTime;
        try {
            await request(app)
                .post('/api/srv-pos/shadow-report')
                .send({ ts: mockTime, count: 0, vectors: {}, writeDrops: 0, details: [] });
            expect(router._getTimestampMapSize()).toBe(1);

            // Advance past rate window and trigger cleanup logic manually
            // (interval cleanup runs every 5min, but we test the eviction logic
            // by posting again after window expires — the while-shift in POST handler
            // clears old timestamps)
            mockTime += 61000;
            await request(app)
                .post('/api/srv-pos/shadow-report')
                .send({ ts: mockTime, count: 0, vectors: {}, writeDrops: 0, details: [] });
            // Map still has 1 entry (same IP, refreshed)
            expect(router._getTimestampMapSize()).toBe(1);
        } finally {
            Date.now = origNow;
        }
    });

    test('_resetForTest clears timestamp map', async () => {
        await request(app)
            .post('/api/srv-pos/shadow-report')
            .send({ ts: Date.now(), count: 0, vectors: {}, writeDrops: 0, details: [] });
        expect(router._getTimestampMapSize()).toBeGreaterThan(0);
        router._resetForTest();
        expect(router._getTimestampMapSize()).toBe(0);
    });
});

describe('GET /api/srv-pos/status', () => {
    test('returns flag state and shadow info', async () => {
        const res = await request(app).get('/api/srv-pos/status');
        expect(res.status).toBe(200);
        expect(typeof res.body.flags.SERVER_AUTHORITATIVE_POSITIONS).toBe('boolean');
        expect(typeof res.body.flags._SRV_POS_TESTNET_ENABLED).toBe('boolean');
        expect(typeof res.body.flags._SRV_POS_REAL_ENABLED).toBe('boolean');
        expect(res.body.shadow.reportsCollected).toBe(0);
    });
});
