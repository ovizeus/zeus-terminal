'use strict';

/**
 * Tests for server/routes/health.js — Tasks 54-56.
 *
 * GET /api/health/feed/:exchange   — Task 54
 * GET /api/health/locks            — Task 55
 * GET /api/health/recovery         — Task 56
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

// Use isolated DB so we don't pollute main DB.
const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'health-routes-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const express = require('express');
const request = require('supertest');

// ─── Mock bybitFeed ───────────────────────────────────────────────────────────
jest.mock('../../server/services/bybitFeed', () => ({
    getConnectionState: jest.fn(() => ({
        connected: true,
        lastMessageTs: Date.now() - 2500,
    })),
}));

// ─── Mock binanceFeed ─────────────────────────────────────────────────────────
jest.mock('../../server/services/binanceFeed', () => ({
    getConnectionState: jest.fn(() => ({
        connected: false,
        lastMessageTs: 0,
    })),
}));

// ─── Mock orderLock ───────────────────────────────────────────────────────────
const mockActiveLocks = [];
jest.mock('../../server/services/orderLock', () => ({
    acquire: jest.fn(),
    release: jest.fn(),
    getActiveLocks: jest.fn(() => mockActiveLocks),
}));

// ─── Mock database ────────────────────────────────────────────────────────────
let mockDbRow = null;
jest.mock('../../server/services/database', () => ({
    db: {
        prepare: jest.fn(() => ({
            get: jest.fn(() => mockDbRow),
        })),
    },
}));

const healthRoutes = require('../../server/routes/health');

function makeApp() {
    const app = express();
    app.use((req, _res, next) => { req.user = { id: 1, role: 'user' }; next(); });
    app.use('/api/health', healthRoutes);
    return app;
}

// ─── Task 54: GET /feed/:exchange ─────────────────────────────────────────────
describe('GET /api/health/feed/:exchange', () => {
    let app;
    beforeAll(() => { app = makeApp(); });

    it('returns healthy state shape for bybit', async () => {
        const r = await request(app).get('/api/health/feed/bybit').expect(200);
        expect(r.body.exchange).toBe('bybit');
        expect(r.body.connected).toBe(true);
        expect(typeof r.body.lastMessageTs).toBe('number');
        expect(typeof r.body.silentMs).toBe('number');
        expect(r.body.silentMs).toBeGreaterThanOrEqual(0);
        expect(r.body.state).toBe('healthy');
    });

    it('returns 400 for unknown exchange', async () => {
        const r = await request(app).get('/api/health/feed/okx').expect(400);
        expect(r.body.error).toBe('exchange must be binance or bybit');
    });
});

// ─── Task 55: GET /locks ───────────────────────────────────────────────────────
describe('GET /api/health/locks', () => {
    let app;
    beforeAll(() => { app = makeApp(); });

    it('returns activeLocks count and locks array', async () => {
        // Seed mock locks
        mockActiveLocks.length = 0;
        mockActiveLocks.push({ key: '1|BTCUSDT', heldMs: 1500, acquired: true });
        mockActiveLocks.push({ key: '2|ETHUSDT', heldMs: 800, acquired: true });

        const r = await request(app).get('/api/health/locks').expect(200);
        expect(r.body.activeLocks).toBe(2);
        expect(Array.isArray(r.body.locks)).toBe(true);
        expect(r.body.locks[0].key).toBe('1|BTCUSDT');
        expect(r.body.locks[0].heldMs).toBe(1500);
        expect(r.body.locks[0].acquired).toBe(true);
    });
});

// ─── Task 56: GET /recovery ───────────────────────────────────────────────────
describe('GET /api/health/recovery', () => {
    let app;
    beforeAll(() => { app = makeApp(); });

    it('returns last boot summary when available', async () => {
        mockDbRow = {
            created_at: '2026-05-23T02:00:00Z',
            details: JSON.stringify({ totalUsers: 2, totalReconciled: 2, errors: 0 }),
        };

        const r = await request(app).get('/api/health/recovery').expect(200);
        expect(r.body.lastRun).toBe('2026-05-23T02:00:00Z');
        expect(r.body.totalUsers).toBe(2);
        expect(r.body.totalReconciled).toBe(2);
        expect(r.body.errors).toBe(0);
        expect(r.body.status).toBe('clean');
    });

    it('returns never_run when no boot log', async () => {
        mockDbRow = null;

        const r = await request(app).get('/api/health/recovery').expect(200);
        expect(r.body.lastRun).toBeNull();
        expect(r.body.status).toBe('never_run');
    });
});
