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

describe('POST /api/srv-pos/shadow-report', () => {
    test('accepts valid divergence report', async () => {
        const res = await request(app)
            .post('/api/srv-pos/shadow-report')
            .send({ ts: Date.now(), count: 2, vectors: { v1: 1, v5: 1 }, writeDrops: 0, details: [] });
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
    });

    test('rejects invalid payload', async () => {
        const res = await request(app)
            .post('/api/srv-pos/shadow-report')
            .send({ foo: 'bar' });
        expect(res.status).toBe(400);
    });

    test('logs warning on divergence', async () => {
        const logger = require('../../server/services/logger');
        await request(app)
            .post('/api/srv-pos/shadow-report')
            .send({ ts: Date.now(), count: 3, vectors: { v1: 2, v3: 1 }, writeDrops: 1, details: [] });
        expect(logger.warn).toHaveBeenCalledWith('SRV-POS', expect.stringContaining('3 divergences'));
    });

    test('caps stored reports at 100', async () => {
        for (let i = 0; i < 105; i++) {
            await request(app)
                .post('/api/srv-pos/shadow-report')
                .send({ ts: Date.now(), count: 1, vectors: {}, writeDrops: 0, details: [] });
        }
        const res = await request(app).get('/api/srv-pos/shadow-report');
        expect(res.body.totalReports).toBe(100);
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
        expect(res.body.recent[0].count).toBe(5);
        expect(res.body.recent[0].vectors.v2).toBe(3);
    });

    test('?last limits response', async () => {
        for (let i = 0; i < 10; i++) {
            await request(app)
                .post('/api/srv-pos/shadow-report')
                .send({ ts: i, count: 1, vectors: {}, writeDrops: 0, details: [] });
        }
        const res = await request(app).get('/api/srv-pos/shadow-report?last=3');
        expect(res.body.recent.length).toBe(3);
    });
});

describe('GET /api/srv-pos/status', () => {
    test('returns flag state', async () => {
        const res = await request(app).get('/api/srv-pos/status');
        expect(res.status).toBe(200);
        expect(res.body.flags).toHaveProperty('SERVER_AUTHORITATIVE_POSITIONS', false);
        expect(res.body.flags).toHaveProperty('_SRV_POS_TESTNET_ENABLED', false);
        expect(res.body.flags).toHaveProperty('_SRV_POS_REAL_ENABLED', false);
        expect(res.body.shadow).toHaveProperty('reportsCollected', 0);
    });
});
