/**
 * Zeus Terminal — E2E Tests: POST /api/order/place flow (M1.1 Cat D part 1/2)
 *
 * TDD failing-first per `_review/audit/TEST_SCAFFOLDING_M1_20260510.md` §6.
 *
 * Validates full HTTP request flow through Express route handler pentru
 * `/api/order/place` post-M1 refactor. Uses supertest pentru realistic
 * HTTP testing fără server.listen() conflict cu running PM2.
 *
 * Setup: mounts trading.js router on minimal Express test app cu fake auth
 * middleware setting req.user={id:1}. Tests assert HTTP-level behavior:
 * - 400 SafetyAssertionError dacă sl=null + mode=live (ADR-001 §3.2)
 * - 200 cu SL valid + slOrderId populated în response
 * - Demo allows sl=null
 *
 * Status: ALL tests initially FAIL — target route handler refactor (M1.2)
 * does not yet validate sl=null hard nor delegate la _executeLiveEntryCore.
 * Currently /api/order/place calls registerManualPosition direct (Path B unsafe).
 *
 * Coverage targets (per scaffolding §6 P1):
 *   - Live order safety: 2 tests (400 sl=null, 200 cu SL)
 *   - Demo allows null: 1 test
 *
 * Total: 3 tests (target band 3-4).
 *
 * Refs:
 * - ADR-001 §3.2 hard safety assertions
 * - TEST_SCAFFOLDING_M1 §6 Cat D spec
 * - MILESTONES_M1-M8 §M1 acceptance criteria M1.4 (curl POST returns 400)
 */
'use strict';

// ── Mocks (sparse — DB + exchange + alerts) ──
jest.mock('../../server/services/database', () => ({
    db: { prepare: jest.fn(() => ({ all: jest.fn(() => []), run: jest.fn() })) },
    atGetState: jest.fn(() => null),
    atSetState: jest.fn(),
    saveMissedTrade: jest.fn(),
    auditLog: jest.fn(),
    getOpenPositionsForUser: jest.fn(() => []),
    getOpenPositions: jest.fn(() => []),
    getRecentActions: jest.fn(() => []),
    getLastActiveAt: jest.fn(() => null),
    setLastActiveAt: jest.fn(),
    getMaxSeq: jest.fn(() => 0),
    getGhostCandidates: jest.fn(() => []),
    deleteAtPosition: jest.fn(),
    saveAtPosition: jest.fn(),
    moveToClosedAtomic: jest.fn(),
    getRecentClosedForUser: jest.fn(() => []),
    countOpenPositions: jest.fn(() => 0),
    getUserById: jest.fn(() => ({ id: 1, email: 'test@example.com' })),
    getActiveExchangeCreds: jest.fn(() => null),
}));

jest.mock('../../server/services/binanceSigner', () => ({
    sendSignedRequest: jest.fn(),
}));

jest.mock('../../server/services/telegram', () => ({
    sendToUser: jest.fn(),
    alertOrderFilled: jest.fn(),
    notifyUser: jest.fn(),
}));

jest.mock('@sentry/node', () => ({
    init: jest.fn(),
    captureMessage: jest.fn(),
    captureException: jest.fn(),
    withScope: jest.fn((fn) => fn({ setUser: jest.fn(), setTag: jest.fn(), setExtra: jest.fn() })),
    setUser: jest.fn(),
    setContext: jest.fn(),
}));

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');

// Build minimal test app cu trading router + fake auth
function buildTestApp() {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    // Fake auth middleware: set req.user pentru toate cererile
    app.use((req, _res, next) => {
        req.user = { id: 1, email: 'test@example.com' };
        next();
    });
    const tradingRoutes = require('../../server/routes/trading.js');
    app.use('/api', tradingRoutes);
    return app;
}

describe('POST /api/order/place E2E (M1.1 Cat D)', () => {
    let app;

    beforeAll(() => {
        app = buildTestApp();
    });

    describe('live order safety', () => {
        it('returns 400 SafetyAssertionError if sl=null with mode=live', async () => {
            const res = await request(app)
                .post('/api/order/place')
                .set('x-idempotency-key', 'test-sl-null-' + Date.now())
                .send({
                    symbol: 'ETHUSDT',
                    side: 'BUY',
                    quantity: 0.5,
                    leverage: 10,
                    sl: null,
                    tp: null,
                    mode: 'live',
                    entryPrice: 2330,
                    source: 'auto',
                });

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/SafetyAssertionError|sl.*required|missing.*sl/i);
        });

        it('returns 200 with slOrderId populated în response când valid live entry', async () => {
            // After M1.2 refactor: /api/order/place delegates to _executeLiveEntryCore
            // care places SL pe Binance + returns slOrderId în response shape
            const res = await request(app)
                .post('/api/order/place')
                .set('x-idempotency-key', 'test-live-valid-' + Date.now())
                .send({
                    symbol: 'ETHUSDT',
                    side: 'BUY',
                    quantity: 0.5,
                    leverage: 10,
                    sl: 2300,
                    tp: 2400,
                    mode: 'live',
                    entryPrice: 2330,
                    source: 'auto',
                });

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('orderId');
            expect(res.body).toHaveProperty('slOrderId');
            expect(res.body.slOrderId).toBeTruthy();
        });
    });

    describe('demo order — no SL enforcement', () => {
        it('allows sl=null pentru demo mode (zero exchange SL responsability)', async () => {
            const res = await request(app)
                .post('/api/order/place')
                .set('x-idempotency-key', 'test-demo-null-' + Date.now())
                .send({
                    symbol: 'ETHUSDT',
                    side: 'BUY',
                    quantity: 0.5,
                    leverage: 10,
                    sl: null,
                    tp: null,
                    mode: 'demo',
                    entryPrice: 2330,
                    source: 'manual',
                });

            // Demo allowed sl=null per ADR-001 §3.1 (no exchange safety burden)
            expect(res.status).toBe(200);
            // Demo response: orderId optional, seq mandatory
            expect(res.body).toHaveProperty('ok', true);
        });
    });
});
