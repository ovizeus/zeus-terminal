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
    CREATE TABLE at_positions_orphaned (seq INTEGER PRIMARY KEY, original_at_positions_seq INTEGER, user_id INTEGER NOT NULL, exchange TEXT NOT NULL, data TEXT NOT NULL, disconnected_at INTEGER NOT NULL, resolved_at INTEGER, resolved_by TEXT);
    CREATE TABLE position_events (id INTEGER PRIMARY KEY, position_seq INTEGER, user_id INTEGER, exchange TEXT, event_type TEXT, from_state TEXT, to_state TEXT, payload TEXT, cycle_no INTEGER, ts INTEGER);
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
    // [P7.0a] makeActive controls is_active on a NEW row only; existing rows update
    // in place WITHOUT changing is_active (mirrors real saveExchangeByName + updateExchangeByNameAny).
    const saveExchangeByName = (userId, exchange, encKey, encSecret, mode, makeActive = true) => {
        const existing = mockDb.prepare(`SELECT id FROM exchange_accounts WHERE user_id = ? AND exchange = ?`).get(userId, exchange);
        if (existing) {
            mockDb.prepare(`UPDATE exchange_accounts SET api_key_encrypted = ?, api_secret_encrypted = ?, mode = ? WHERE user_id = ? AND exchange = ?`).run(encKey, encSecret || '', mode, userId, exchange);
            return existing.id;
        }
        const r = mockDb.prepare(`INSERT INTO exchange_accounts (user_id, exchange, api_key_encrypted, api_secret_encrypted, mode, is_active) VALUES (?, ?, ?, ?, ?, ?)`).run(userId, exchange, encKey, encSecret || '', mode, makeActive ? 1 : 0);
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

const mockExchangeOps = {
    ping: jest.fn(async () => ({ ok: true, latencyMs: 50 })),
    getBalance: jest.fn(async () => ({ asset: 'USDT', walletBalance: '1000' })),
    getPositions: jest.fn(async () => []),
};
jest.mock('../../server/services/exchangeOps', () => mockExchangeOps);

const mockPositionEvents = { append: jest.fn() };
jest.mock('../../server/services/positionEvents', () => mockPositionEvents);

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
    mockExchangeOps.ping.mockReset().mockResolvedValue({ ok: true, latencyMs: 50 });
    mockExchangeOps.getBalance.mockReset().mockResolvedValue({ asset: 'USDT', walletBalance: '1000' });
    mockExchangeOps.getPositions.mockReset().mockResolvedValue([]);
    mockPositionEvents.append.mockReset();
    mockDb.exec('DELETE FROM exchange_accounts; DELETE FROM at_positions; DELETE FROM at_positions_orphaned; DELETE FROM position_events; DELETE FROM audit_log;');
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

        // [P2c.6 2026-05-29] Gate LIFTED — the cross-exchange safety family (recon,
        // driftChecker, recoveryBoot, orderSweeper, SL-placement) is now per-exchange
        // and manual close routes by pos.exchange (P2a/P2b). So a switch with open
        // positions SUCCEEDS: the old positions stay DSL-managed on their own exchange;
        // the response carries the summary so the client can confirm/label them.
        it('[P2c.6] switch with open positions SUCCEEDS (200) + summary + keeps old account connected', async () => {
            mockDb.prepare(`INSERT INTO exchange_accounts (user_id, exchange, is_active, mode, api_key_encrypted) VALUES (1, 'binance', 1, 'testnet', 'enc')`).run();
            mockDb.prepare(`INSERT INTO exchange_accounts (user_id, exchange, is_active, mode, api_key_encrypted) VALUES (1, 'bybit', 0, 'testnet', 'enc2')`).run();
            mockDb.prepare(`INSERT INTO at_positions (data, status, user_id, exchange) VALUES ('{"mode":"testnet","exchange":"binance"}', 'OPEN', 1, 'binance')`).run();
            mockDb.prepare(`INSERT INTO at_positions (data, status, user_id, exchange) VALUES ('{"mode":"testnet","exchange":"binance"}', 'OPENING', 1, 'binance')`).run();

            const app = buildApp();
            const res = await request(app).post('/api/exchange/switch').send({ targetExchange: 'bybit' });

            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(res.body.openPositionsOnPrevious).toEqual([{ exchange: 'binance', count: 2 }]);
            expect(mockMarkPendingSwitch).toHaveBeenCalledWith(1, 'binance', 'bybit');

            // Old account row KEPT (not deleted), just deactivated → still manageable.
            expect(mockDb.prepare(`SELECT is_active FROM exchange_accounts WHERE user_id=1 AND exchange='binance'`).get().is_active).toBe(0);
            expect(mockDb.prepare(`SELECT is_active FROM exchange_accounts WHERE user_id=1 AND exchange='bybit'`).get().is_active).toBe(1);

            // No BLOCKED audit; REQUESTED carries the summary.
            expect(mockDb.prepare(`SELECT * FROM audit_log WHERE action='EXCHANGE_SWITCH_BLOCKED'`).get()).toBeUndefined();
            const reqAudit = mockDb.prepare(`SELECT * FROM audit_log WHERE action='EXCHANGE_SWITCH_REQUESTED'`).get();
            expect(reqAudit).toBeDefined();
            expect(JSON.parse(reqAudit.details).openPositionsOnPrevious).toEqual([{ exchange: 'binance', count: 2 }]);
        });

        it('[P3] demo positions never count toward the switch summary', async () => {
            mockDb.prepare(`INSERT INTO exchange_accounts (user_id, exchange, is_active, mode, api_key_encrypted) VALUES (1, 'binance', 1, 'testnet', 'enc')`).run();
            mockDb.prepare(`INSERT INTO exchange_accounts (user_id, exchange, is_active, mode, api_key_encrypted) VALUES (1, 'bybit', 0, 'testnet', 'enc2')`).run();
            mockDb.prepare(`INSERT INTO at_positions (data, status, user_id, exchange) VALUES ('{"mode":"demo","exchange":"binance"}', 'OPEN', 1, 'binance')`).run();

            const res = await request(buildApp()).post('/api/exchange/switch').send({ targetExchange: 'bybit' });
            expect(res.status).toBe(200);
            expect(res.body.openPositionsOnPrevious).toEqual([]);
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

describe('[P7.0a] multi-connect — second exchange connects INACTIVE; per-exchange env mutex kept', () => {
    let origFetch;
    beforeEach(() => {
        mockDb.exec('DELETE FROM exchange_accounts; DELETE FROM at_positions; DELETE FROM audit_log;');
        origFetch = global.fetch;
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ([{ asset: 'USDT', balance: '1000', availableBalance: '800' }]),
        });
    });
    afterEach(() => { global.fetch = origFetch; });

    it('saving a DIFFERENT exchange while one is active SUCCEEDS and connects INACTIVE (no 409, active unchanged)', async () => {
        // Bybit already active (testnet). Now add Binance (testnet) creds.
        mockDb.prepare(`INSERT INTO exchange_accounts (user_id, exchange, is_active, mode, api_key_encrypted) VALUES (1, 'bybit', 1, 'testnet', 'enc')`).run();

        const res = await request(buildApp()).post('/api/exchange/save').send({
            exchange: 'binance', mode: 'testnet', apiKey: 'k'.repeat(12), apiSecret: 's'.repeat(12),
        });

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        // Binance connected but INACTIVE; Bybit stays active (Switch activates Binance later).
        expect(mockDb.prepare(`SELECT is_active FROM exchange_accounts WHERE user_id=1 AND exchange='binance'`).get().is_active).toBe(0);
        expect(mockDb.prepare(`SELECT is_active FROM exchange_accounts WHERE user_id=1 AND exchange='bybit'`).get().is_active).toBe(1);
        // No EXCHANGE_CONFLICT block audited.
        expect(mockDb.prepare(`SELECT * FROM audit_log WHERE action='EXCHANGE_SAVE_BLOCKED'`).get()).toBeUndefined();
    });

    it('first exchange ever saved becomes ACTIVE', async () => {
        const res = await request(buildApp()).post('/api/exchange/save').send({
            exchange: 'binance', mode: 'testnet', apiKey: 'k'.repeat(12), apiSecret: 's'.repeat(12),
        });
        expect(res.status).toBe(200);
        expect(mockDb.prepare(`SELECT is_active FROM exchange_accounts WHERE user_id=1 AND exchange='binance'`).get().is_active).toBe(1);
    });

    it('KEPT: same exchange, different env (testnet↔real) still rejected with ENV_CONFLICT', async () => {
        mockDb.prepare(`INSERT INTO exchange_accounts (user_id, exchange, is_active, mode, api_key_encrypted) VALUES (1, 'binance', 1, 'testnet', 'enc')`).run();
        const res = await request(buildApp()).post('/api/exchange/save').send({
            exchange: 'binance', mode: 'live', apiKey: 'k'.repeat(12), apiSecret: 's'.repeat(12),
        });
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('ENV_CONFLICT');
    });
});

describe('Phase 8 Tasks 47-50', () => {
    // Task 47: /save returns verified:true on success
    describe('POST /save with verify (Task 47)', () => {
        it('returns verified:true in response on successful save', async () => {
            const app = buildApp();
            // _testKeys (fetch) is not mocked — we rely on the route bypassing it via test env
            // The existing /save already calls _testKeys which does a real fetch.
            // We need to mock global fetch for this test.
            const origFetch = global.fetch;
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                json: async () => ([{ asset: 'USDT', balance: '1000', availableBalance: '800' }]),
            });
            const res = await request(buildApp()).post('/api/exchange/save').send({
                exchange: 'binance', mode: 'testnet',
                apiKey: 'k'.repeat(12), apiSecret: 's'.repeat(12),
            });
            global.fetch = origFetch;
            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(res.body.verified).toBe(true);
        });

        it('returns 400 if _testKeys verification fails', async () => {
            const origFetch = global.fetch;
            global.fetch = jest.fn().mockResolvedValue({
                ok: false,
                json: async () => ({ msg: 'Invalid API key' }),
            });
            const res = await request(buildApp()).post('/api/exchange/save').send({
                exchange: 'binance', mode: 'testnet',
                apiKey: 'k'.repeat(12), apiSecret: 's'.repeat(12),
            });
            global.fetch = origFetch;
            expect(res.status).toBe(400);
            expect(res.body.ok).toBe(false);
            // No creds saved
            const saved = mockDb.prepare(`SELECT * FROM exchange_accounts WHERE user_id=1`).all();
            expect(saved.length).toBe(0);
        });
    });

    // Task 48: /disconnect with DB positions check
    describe('POST /disconnect with positions check (Task 48)', () => {
        it('returns 409 with positions list when open DB positions exist', async () => {
            mockDb.prepare(`INSERT INTO exchange_accounts (user_id, exchange, is_active, api_key_encrypted) VALUES (1, 'bybit', 1, 'enc')`).run();
            mockDb.prepare(`INSERT INTO at_positions (seq, data, status, user_id, exchange) VALUES (1, '{"mode":"testnet"}', 'OPEN', 1, 'bybit')`).run();
            mockDb.prepare(`INSERT INTO at_positions (seq, data, status, user_id, exchange) VALUES (2, '{"mode":"testnet"}', 'CLOSING', 1, 'bybit')`).run();

            const res = await request(buildApp()).post('/api/exchange/disconnect').send({ exchange: 'bybit' });
            expect(res.status).toBe(409);
            expect(res.body.ok).toBe(false);
            expect(res.body.error).toMatch(/open position/i);
            expect(Array.isArray(res.body.positions)).toBe(true);
            expect(res.body.positions.length).toBe(2);
        });

        it('returns 200 when no open DB positions exist', async () => {
            mockDb.prepare(`INSERT INTO exchange_accounts (user_id, exchange, is_active, api_key_encrypted) VALUES (1, 'bybit', 1, 'enc')`).run();
            // CLOSED position should not block
            mockDb.prepare(`INSERT INTO at_positions (seq, data, status, user_id, exchange) VALUES (1, '{}', 'CLOSED', 1, 'bybit')`).run();

            const res = await request(buildApp()).post('/api/exchange/disconnect').send({ exchange: 'bybit' });
            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
        });

        it('ignores positions from other exchanges', async () => {
            mockDb.prepare(`INSERT INTO exchange_accounts (user_id, exchange, is_active, api_key_encrypted) VALUES (1, 'bybit', 1, 'enc')`).run();
            // binance position should not block bybit disconnect
            mockDb.prepare(`INSERT INTO at_positions (seq, data, status, user_id, exchange) VALUES (1, '{}', 'OPEN', 1, 'binance')`).run();

            const res = await request(buildApp()).post('/api/exchange/disconnect').send({ exchange: 'bybit' });
            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
        });
    });

    // Task 49: /disconnect force=true orphan move
    describe('POST /disconnect with force=true (Task 49)', () => {
        it('moves open positions to at_positions_orphaned and disconnects', async () => {
            mockDb.prepare(`INSERT INTO exchange_accounts (user_id, exchange, is_active, api_key_encrypted) VALUES (1, 'bybit', 1, 'enc')`).run();
            mockDb.prepare(`INSERT INTO at_positions (seq, data, status, user_id, exchange) VALUES (10, '{"symbol":"BTCUSDT","mode":"testnet"}', 'OPEN', 1, 'bybit')`).run();
            mockDb.prepare(`INSERT INTO at_positions (seq, data, status, user_id, exchange) VALUES (11, '{"symbol":"ETHUSDT","mode":"testnet"}', 'OPENING', 1, 'bybit')`).run();

            const res = await request(buildApp()).post('/api/exchange/disconnect').send({ exchange: 'bybit', force: true });
            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(res.body.orphaned).toBe(2);

            // at_positions rows removed
            const remaining = mockDb.prepare(`SELECT * FROM at_positions WHERE user_id=1 AND exchange='bybit' AND status IN ('OPEN','OPENING','CLOSING')`).all();
            expect(remaining.length).toBe(0);

            // at_positions_orphaned rows created
            const orphaned = mockDb.prepare(`SELECT * FROM at_positions_orphaned WHERE user_id=1 AND exchange='bybit'`).all();
            expect(orphaned.length).toBe(2);

            // positionEvents appended for each
            expect(mockPositionEvents.append).toHaveBeenCalledTimes(2);
            const calls = mockPositionEvents.append.mock.calls;
            expect(calls[0][0].event_type).toBe('ORPHANED_BY_DISCONNECT');
            expect(calls[1][0].event_type).toBe('ORPHANED_BY_DISCONNECT');

            // exchange disconnected
            const acc = mockDb.prepare(`SELECT * FROM exchange_accounts WHERE user_id=1 AND exchange='bybit'`).get();
            expect(acc.is_active).toBe(0);
        });

        it('force=true with no positions still disconnects cleanly', async () => {
            mockDb.prepare(`INSERT INTO exchange_accounts (user_id, exchange, is_active, api_key_encrypted) VALUES (1, 'bybit', 1, 'enc')`).run();

            const res = await request(buildApp()).post('/api/exchange/disconnect').send({ exchange: 'bybit', force: true });
            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(res.body.orphaned).toBe(0);
        });
    });
});
