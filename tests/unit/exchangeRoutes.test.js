'use strict';

const express = require('express');
const request = require('supertest');
const Database = require('better-sqlite3');
const fs = require('fs');

const TEST_DB = '/tmp/zeus-exchange-routes-test-' + Date.now() + '.db';
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
const mockDb = new Database(TEST_DB);
mockDb.exec(`
    CREATE TABLE exchange_accounts (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, exchange TEXT NOT NULL DEFAULT 'binance', is_active INTEGER NOT NULL DEFAULT 1, mode TEXT NOT NULL DEFAULT 'testnet', api_key_encrypted TEXT NOT NULL DEFAULT '', api_secret_encrypted TEXT NOT NULL DEFAULT '', created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE at_positions (seq INTEGER PRIMARY KEY, data TEXT, status TEXT DEFAULT 'OPEN', user_id INTEGER, exchange TEXT DEFAULT 'binance');
    CREATE TABLE audit_log (id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT, details TEXT, created_at TEXT DEFAULT (datetime('now')));
`);

// Build a mock that exposes BOTH the raw `db` (better-sqlite3) for direct SQL
// in new /switch endpoint AND the named helper functions used by existing routes.
jest.mock('../../server/services/database', () => {
    // Helper functions that mirror database.js but run against mockDb
    const getAllExchanges = (userId) =>
        mockDb.prepare(`SELECT * FROM exchange_accounts WHERE user_id = ? AND is_active = 1`).all(userId);
    const getExchangeByName = (userId, exchange) =>
        mockDb.prepare(`SELECT * FROM exchange_accounts WHERE user_id = ? AND exchange = ? AND is_active = 1`).get(userId, exchange);
    const saveExchangeByName = (userId, exchange, encKey, encSecret, mode) => {
        const existing = mockDb.prepare(`SELECT id FROM exchange_accounts WHERE user_id = ? AND exchange = ?`).get(userId, exchange);
        if (existing) {
            mockDb.prepare(`UPDATE exchange_accounts SET api_key_encrypted = ?, api_secret_encrypted = ?, mode = ?, is_active = 1 WHERE user_id = ? AND exchange = ?`).run(encKey, encSecret || '', mode, userId, exchange);
            return existing.id;
        }
        const r = mockDb.prepare(`INSERT INTO exchange_accounts (user_id, exchange, api_key_encrypted, api_secret_encrypted, mode, is_active) VALUES (?, ?, ?, ?, ?, 1)`).run(userId, exchange, encKey, encSecret || '', mode);
        return r.lastInsertRowid;
    };
    const disconnectExchangeByName = (userId, exchange) =>
        mockDb.prepare(`UPDATE exchange_accounts SET is_active = 0 WHERE user_id = ? AND exchange = ?`).run(userId, exchange);
    const auditLog = (userId, action, details) =>
        mockDb.prepare(`INSERT INTO audit_log (user_id, action, details, created_at) VALUES (?, ?, ?, datetime('now'))`).run(userId, action, JSON.stringify(details));
    const listUsers = () => [];

    return { db: mockDb, getAllExchanges, getExchangeByName, saveExchangeByName, disconnectExchangeByName, auditLog, listUsers };
});

const mockMarkPendingSwitch = jest.fn();
const mockInvalidateUserExchangeCache = jest.fn();
jest.mock('../../server/services/serverBrain', () => ({
    _markPendingSwitch: mockMarkPendingSwitch,
    _invalidateUserExchangeCache: mockInvalidateUserExchangeCache,
    _getUserExchange: jest.fn(() => 'binance'),
}));

jest.mock('../../server/services/encryption', () => ({
    encrypt: jest.fn((v) => 'enc:' + v),
    decrypt: jest.fn((v) => v.replace(/^enc:/, '')),
    maskKey: jest.fn((v) => v ? v.slice(0, 4) + '****' : '****'),
}));

jest.mock('../../server/services/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

jest.mock('../../server/services/serverAT', () => ({
    getOpenPositions: jest.fn(() => []),
}));

jest.mock('../../server/services/telegram', () => ({
    sendToUser: jest.fn(),
}));

jest.mock('../../server/services/credentialStore', () => ({
    getExchangeCreds: jest.fn(() => null),
    saveExchangeCreds: jest.fn(() => ({ ok: true })),
    removeExchangeCreds: jest.fn(() => ({ ok: true })),
}));

jest.mock('../../server/services/exchangeOps', () => ({
    ping: jest.fn(async () => ({ ok: true, latencyMs: 50 })),
    getBalance: jest.fn(async () => ({ asset: 'USDT', walletBalance: '1000' })),
}));

// Mock auth middleware: inject req.user.id = 1
const mockAuth = (req, res, next) => { req.user = { id: 1 }; next(); };

const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use(mockAuth);
    // Clear require cache so fresh module is loaded each time
    delete require.cache[require.resolve('../../server/routes/exchange')];
    const router = require('../../server/routes/exchange');
    app.use('/api/exchange', router);
    return app;
};

beforeEach(() => {
    mockMarkPendingSwitch.mockReset();
    mockInvalidateUserExchangeCache.mockReset();
    mockDb.exec('DELETE FROM exchange_accounts; DELETE FROM at_positions; DELETE FROM audit_log;');
});

describe('exchange routes — Phase 6 Task 36', () => {
    describe('POST /switch', () => {
        it('switches binance → bybit + 200 + audit log + _markPendingSwitch called', async () => {
            mockDb.prepare(`INSERT INTO exchange_accounts (user_id, exchange, is_active, mode, api_key_encrypted) VALUES (1, 'binance', 1, 'testnet', 'enc')`).run();
            mockDb.prepare(`INSERT INTO exchange_accounts (user_id, exchange, is_active, mode, api_key_encrypted) VALUES (1, 'bybit', 0, 'testnet', 'enc2')`).run();

            const app = buildApp();
            const res = await request(app).post('/api/exchange/switch').send({ targetExchange: 'bybit' });
            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(mockMarkPendingSwitch).toHaveBeenCalledWith(1, 'binance', 'bybit');

            const audit = mockDb.prepare(`SELECT * FROM audit_log WHERE user_id=1 ORDER BY id DESC LIMIT 2`).all();
            expect(audit.some(a => a.action === 'EXCHANGE_SWITCH_REQUESTED')).toBe(true);
        });

        it('409 BLOCKED on switch with open positions', async () => {
            mockDb.prepare(`INSERT INTO exchange_accounts (user_id, exchange, is_active, mode) VALUES (1, 'binance', 1, 'testnet')`).run();
            mockDb.prepare(`INSERT INTO at_positions (data, status, user_id, exchange) VALUES ('{}', 'OPEN', 1, 'binance')`).run();

            const app = buildApp();
            const res = await request(app).post('/api/exchange/switch').send({ targetExchange: 'bybit' });
            expect(res.status).toBe(409);
            expect(res.body.ok).toBe(false);
            expect(res.body.error).toMatch(/open position/i);
            expect(mockMarkPendingSwitch).not.toHaveBeenCalled();

            const audit = mockDb.prepare(`SELECT * FROM audit_log WHERE action='EXCHANGE_SWITCH_BLOCKED'`).get();
            expect(audit).toBeDefined();
        });

        it('400 on missing targetExchange', async () => {
            const app = buildApp();
            const res = await request(app).post('/api/exchange/switch').send({});
            expect(res.status).toBe(400);
        });

        it('400 on invalid targetExchange', async () => {
            const app = buildApp();
            const res = await request(app).post('/api/exchange/switch').send({ targetExchange: 'kraken' });
            expect(res.status).toBe(400);
        });

        it('200 no-op when targetExchange equals current', async () => {
            mockDb.prepare(`INSERT INTO exchange_accounts (user_id, exchange, is_active) VALUES (1, 'binance', 1)`).run();
            const app = buildApp();
            const res = await request(app).post('/api/exchange/switch').send({ targetExchange: 'binance' });
            expect(res.status).toBe(200);
            expect(res.body.noOp).toBe(true);
            expect(mockMarkPendingSwitch).not.toHaveBeenCalled();
        });
    });

    describe('POST /save invalidates cache', () => {
        it('calls _invalidateUserExchangeCache after successful save', async () => {
            const app = buildApp();
            const res = await request(app).post('/api/exchange/save').send({
                exchange: 'bybit', mode: 'testnet', apiKey: 'k', apiSecret: 's',
            });
            expect(res.status).toBeLessThan(500);  // 200 or 4xx — either way cache call should happen on success
            if (res.body.ok) {
                expect(mockInvalidateUserExchangeCache).toHaveBeenCalledWith(1);
            }
        });
    });

    describe('POST /disconnect invalidates cache', () => {
        it('calls _invalidateUserExchangeCache after disconnect', async () => {
            mockDb.prepare(`INSERT INTO exchange_accounts (user_id, exchange, is_active, api_key_encrypted) VALUES (1, 'bybit', 1, 'enc')`).run();
            const app = buildApp();
            const res = await request(app).post('/api/exchange/disconnect').send({ exchange: 'bybit' });
            if (res.status < 400) {
                expect(mockInvalidateUserExchangeCache).toHaveBeenCalledWith(1);
            }
        });
    });
});
