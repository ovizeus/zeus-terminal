'use strict';

const express = require('express');
const request = require('supertest');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

const TEST_SECRET = 'test-secret-123';
let app, router;

function makeToken(userId) {
    return jwt.sign({ id: userId }, TEST_SECRET);
}

beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../server/services/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
    jest.doMock('../../server/services/telegram', () => ({ sendToUser: jest.fn() }));
    jest.doMock('../../server/services/serverAT', () => ({
        getUserState: jest.fn(() => ({ killActive: false })),
        activateKillSwitch: jest.fn(),
    }));
    jest.doMock('../../server/services/database', () => ({
        db: { prepare: jest.fn(() => ({ run: jest.fn() })) },
    }));
    jest.doMock('../../server/config', () => ({ jwtSecret: TEST_SECRET }));

    router = require('../../server/routes/srvPos');
    router._resetForTest();
    app = express();
    app.use(cookieParser());
    app.use('/api/srv-pos', router);
});

const VALID_ORPHAN = { orphans: [{ sym: 'BTCUSDT', side: 'LONG', size: 0.1, exchange: 'binance' }], ts: Date.now() };

describe('POST /api/srv-pos/orphan-report — auth', () => {
    test('rejects without auth cookie', async () => {
        const res = await request(app)
            .post('/api/srv-pos/orphan-report')
            .set('x-zeus-request', '1')
            .send(VALID_ORPHAN);
        expect(res.status).toBe(401);
    });

    test('accepts with valid JWT cookie', async () => {
        const res = await request(app)
            .post('/api/srv-pos/orphan-report')
            .set('Cookie', `zeus_token=${makeToken(1)}`)
            .set('x-zeus-request', '1')
            .send(VALID_ORPHAN);
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
    });
});

describe('POST /api/srv-pos/orphan-report — thresholds', () => {
    test('1 orphan → severity info, no suspend', async () => {
        const serverAT = require('../../server/services/serverAT');
        const res = await request(app)
            .post('/api/srv-pos/orphan-report')
            .set('Cookie', `zeus_token=${makeToken(1)}`)
            .set('x-zeus-request', '1')
            .send(VALID_ORPHAN);
        expect(res.body.severity).toBe('info');
        expect(serverAT.activateKillSwitch).not.toHaveBeenCalled();
    });

    test('2+ orphans in 5min → severity urgent, no suspend', async () => {
        const cookie = `zeus_token=${makeToken(2)}`;
        const serverAT = require('../../server/services/serverAT');
        await request(app).post('/api/srv-pos/orphan-report')
            .set('Cookie', cookie).set('x-zeus-request', '1')
            .send({ orphans: [{ sym: 'BTC', side: 'L' }, { sym: 'ETH', side: 'S' }], ts: Date.now() });
        expect(serverAT.activateKillSwitch).not.toHaveBeenCalled();
    });

    test('5+ orphans in 5min → severity critical + AT suspended', async () => {
        const origNow = Date.now;
        let mockTime = 5000000;
        Date.now = () => mockTime;
        try {
            const cookie = `zeus_token=${makeToken(3)}`;
            const serverAT = require('../../server/services/serverAT');
            // Send 5 orphans across multiple reports (debounce 10s apart)
            for (let i = 0; i < 5; i++) {
                mockTime += 11000; // 11s between each to bypass debounce
                await request(app).post('/api/srv-pos/orphan-report')
                    .set('Cookie', cookie).set('x-zeus-request', '1')
                    .send({ orphans: [{ sym: `SYM${i}`, side: 'LONG' }], ts: mockTime });
            }
            expect(serverAT.activateKillSwitch).toHaveBeenCalledWith(3);
        } finally {
            Date.now = origNow;
        }
    });

    test('debounce: second report within 10s is debounced', async () => {
        const cookie = `zeus_token=${makeToken(4)}`;
        const r1 = await request(app).post('/api/srv-pos/orphan-report')
            .set('Cookie', cookie).set('x-zeus-request', '1')
            .send(VALID_ORPHAN);
        expect(r1.body.debounced).toBeUndefined();

        const r2 = await request(app).post('/api/srv-pos/orphan-report')
            .set('Cookie', cookie).set('x-zeus-request', '1')
            .send(VALID_ORPHAN);
        expect(r2.body.debounced).toBe(true);
    });

    test('window expiry: orphans outside 5min not counted', async () => {
        const origNow = Date.now;
        let mockTime = 8000000;
        Date.now = () => mockTime;
        try {
            const cookie = `zeus_token=${makeToken(5)}`;
            // Send 4 orphans at t=0
            for (let i = 0; i < 4; i++) {
                mockTime += 11000;
                await request(app).post('/api/srv-pos/orphan-report')
                    .set('Cookie', cookie).set('x-zeus-request', '1')
                    .send({ orphans: [{ sym: `OLD${i}`, side: 'LONG' }], ts: mockTime });
            }
            // Advance past 5min window
            mockTime += 310000;
            const res = await request(app).post('/api/srv-pos/orphan-report')
                .set('Cookie', cookie).set('x-zeus-request', '1')
                .send({ orphans: [{ sym: 'NEW', side: 'SHORT' }], ts: mockTime });
            // Should be severity 'info' (only 1 in current window)
            expect(res.body.severity).toBe('info');
            expect(res.body.total5min).toBe(1);
        } finally {
            Date.now = origNow;
        }
    });
});
