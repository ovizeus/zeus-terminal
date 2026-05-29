'use strict';

const Database = require('better-sqlite3');
const fs = require('fs');
const TEST_DB = '/tmp/zeus-bybit-ops-test-' + Date.now() + '.db';
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
const mockDb = new Database(TEST_DB);
mockDb.exec(`
    CREATE TABLE at_positions (seq INTEGER PRIMARY KEY, data TEXT, status TEXT DEFAULT 'OPEN', user_id INTEGER, exchange TEXT DEFAULT 'bybit', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE at_closed (seq INTEGER PRIMARY KEY, data TEXT NOT NULL, closed_at TEXT NOT NULL DEFAULT (datetime('now')), user_id INTEGER, exchange TEXT DEFAULT 'bybit');
    CREATE TABLE position_events (id INTEGER PRIMARY KEY, position_seq INTEGER NOT NULL, user_id INTEGER NOT NULL, exchange TEXT NOT NULL, event_type TEXT NOT NULL, from_state TEXT, to_state TEXT, payload TEXT NOT NULL DEFAULT '{}', cycle_no INTEGER, ts INTEGER NOT NULL);
    CREATE TABLE emergency_close_queue (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, symbol TEXT NOT NULL, exchange TEXT NOT NULL, qty TEXT NOT NULL, decision_key TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, resolved_at INTEGER, resolved_by TEXT);
    CREATE TABLE audit_log (id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT, details TEXT, created_at TEXT DEFAULT (datetime('now')));
`);
jest.mock('../../server/services/database', () => ({ db: mockDb }));

// Mock bybitSigner — sendSignedRequest is never actually called in unit tests
// because _dispatchRequest drains the synthetic queue first.
// We still spy on it to verify it is not called (queue fully satisfies requests).
const mockSendSignedRequest = jest.fn(async () => { throw new Error('sendSignedRequest should not be called in unit tests — enqueue synthetic responses'); });
jest.mock('../../server/services/bybitSigner', () => ({
    buildSignedRequestDryRun: jest.fn(() => undefined),
    sendSignedRequest: (...a) => mockSendSignedRequest(...a),
    parseBybitError: jest.fn((resp) => ({ code: 'ErrUnknown', message: resp && resp.retMsg || 'unknown' })),
}));

// bybitOps will expose _setSyntheticResponse for tests (per-call synthetic response queue)
jest.mock('../../server/services/orderLock', () => ({
    acquire: jest.fn(async () => true),
    release: jest.fn(),
}));

jest.mock('../../server/services/telegram', () => ({
    alertCritical: jest.fn(),
    sendToUser: jest.fn(),
}));

jest.mock('../../server/services/serverAT', () => ({ setGlobalHalt: jest.fn() }));

// [BUG#5] migrationFlags lives at server/migrationFlags (one level up from services).
// bybitOps._dispatchRequest must require it from '../migrationFlags' — a wrong './…'
// path throws MODULE_NOT_FOUND on every real Bybit call. [BUG#5b] The real module
// exposes each flag as a getter DIRECTLY on the exported object (MF.BYBIT_DRY_RUN_ONLY),
// NOT under a `.flags` sub-object — so the mock must match that shape, otherwise a
// `.flags` accessor silently reads undefined in prod (it crashed with
// "Cannot read properties of undefined") while a `{flags:{…}}` mock hid the defect.
jest.mock('../../server/migrationFlags', () => ({ BYBIT_DRY_RUN_ONLY: true }));

const bybitOps = require('../../server/services/bybitOps');

const _validCreds = { exchange: 'bybit', mode: 'testnet', apiKey: 'k', apiSecret: 's' };

describe('[BUG#5] _dispatchRequest migrationFlags require path', () => {
    it('resolves migrationFlags from the correct path (reaches DRY_RUN gate, not MODULE_NOT_FOUND)', async () => {
        // No synthetic enqueued → real dispatch path → hits require('../migrationFlags').
        // Must reach the gate and throw its real message; NOT a require/shape crash.
        // (Asserting on the literal gate message — "dispatch blocked" — because the
        //  bare token /DRY_RUN/ also matches the "Cannot read properties of undefined
        //  (reading 'BYBIT_DRY_RUN_ONLY')" crash that the `.flags` shape bug produced.)
        await expect(bybitOps.getBalance(1, _validCreds)).rejects.toThrow(/dispatch blocked/i);
        await expect(bybitOps.getBalance(1, _validCreds)).rejects.not.toThrow(/Cannot find module/i);
        await expect(bybitOps.getBalance(1, _validCreds)).rejects.not.toThrow(/Cannot read properties/i);
    });
});

const _validEntryParams = (overrides = {}) => ({
    symbol: 'BTCUSDT', side: 'LONG', qty: '0.001', entryType: 'MARKET',
    sl: { price: '49000', type: 'MARKET' }, leverage: 5,
    decisionKey: 'bdk_' + Date.now(), source: 'auto', ...overrides,
});

beforeEach(() => {
    mockSendSignedRequest.mockReset();
    mockSendSignedRequest.mockImplementation(async () => { throw new Error('sendSignedRequest should not be called in unit tests'); });
    bybitOps._resetSyntheticQueue();
    mockDb.exec('DELETE FROM at_positions; DELETE FROM position_events; DELETE FROM at_closed; DELETE FROM emergency_close_queue; DELETE FROM audit_log;');
});

describe('bybitOps.placeEntry', () => {
    it('happy path: entry FILLED + SL placed', async () => {
        bybitOps._enqueueSynthetic({ retCode: 0, result: { orderId: 'bye1', orderStatus: 'Filled', cumExecQty: '0.001', avgPrice: '50000' } });
        bybitOps._enqueueSynthetic({ retCode: 0, result: { orderId: 'bysl1', orderStatus: 'New' } });

        const r = await bybitOps.placeEntry(1, _validEntryParams(), _validCreds);
        expect(r.ok).toBe(true);
        expect(r.orderId).toBe('bye1');
        expect(r.slOrderId).toBe('bysl1');
        expect(r.rawExchange).toBe('bybit');
        // sendSignedRequest should NOT be called — synthetic queue satisfied all requests
        expect(mockSendSignedRequest).not.toHaveBeenCalled();
    });

    it('entry rejected retCode=110007 (insufficient balance)', async () => {
        bybitOps._enqueueSynthetic({ retCode: 110007, retMsg: 'ab not enough', result: {} });

        const r = await bybitOps.placeEntry(1, _validEntryParams(), _validCreds);
        expect(r.ok).toBe(false);
    });

    it('SL retry 3x → emergency close', async () => {
        bybitOps._enqueueSynthetic({ retCode: 0, result: { orderId: 'bye2', orderStatus: 'Filled', cumExecQty: '0.001', avgPrice: '50000' } });
        // 3 SL fails
        bybitOps._enqueueSynthetic({ retCode: 110001, retMsg: 'sl fail 1', result: {} });
        bybitOps._enqueueSynthetic({ retCode: 110001, retMsg: 'sl fail 2', result: {} });
        bybitOps._enqueueSynthetic({ retCode: 110001, retMsg: 'sl fail 3', result: {} });
        // emergency close success
        bybitOps._enqueueSynthetic({ retCode: 0, result: { orderId: 'byemerg1', orderStatus: 'Filled' } });

        const r = await bybitOps.placeEntry(1, _validEntryParams(), _validCreds);
        expect(r.ok).toBe(false);
        expect(r.error.code).toBe('ErrSlPlacementFailed');
        expect(r.catastrophic).toBeFalsy();
    }, 15000);

    it('uses Sell for SHORT side', async () => {
        bybitOps._enqueueSynthetic({ retCode: 0, result: { orderId: 'x', orderStatus: 'Filled' } });
        bybitOps._enqueueSynthetic({ retCode: 0, result: { orderId: 'y', orderStatus: 'New' } });

        const r2 = await bybitOps.placeEntry(1, _validEntryParams({ side: 'SHORT' }), _validCreds);
        expect(r2.ok).toBe(true);
        expect(mockSendSignedRequest).not.toHaveBeenCalled();
    });
});

describe('bybitOps.closePosition', () => {
    let seq;
    beforeEach(() => {
        const r = mockDb.prepare(
            `INSERT INTO at_positions (data, status, user_id, exchange) VALUES (?, 'OPEN', 1, 'bybit')`
        ).run(JSON.stringify({ symbol: 'BTCUSDT', side: 'LONG', qty: '0.001', entryOrderId: 'e', slOrderId: 'sl', tpOrderId: null }));
        seq = r.lastInsertRowid;
    });

    it('happy path cancel SL + close', async () => {
        bybitOps._enqueueSynthetic({ retCode: 0, result: { orderId: 'sl', orderStatus: 'Cancelled' } });
        bybitOps._enqueueSynthetic({ retCode: 0, result: { orderId: 'byclose1', orderStatus: 'Filled', cumExecQty: '0.001', avgPrice: '51000' } });

        const r = await bybitOps.closePosition(1, { seq, symbol: 'BTCUSDT', side: 'LONG', qty: '0.001', closeType: 'MARKET', decisionKey: 'cdk1', source: 'manual' }, _validCreds);
        expect(r.ok).toBe(true);
        expect(r.orderId).toBe('byclose1');
        expect(r.rawExchange).toBe('bybit');
    });

    it('race: already CLOSED → ok:true closedBySL', async () => {
        mockDb.prepare("UPDATE at_positions SET status='CLOSED' WHERE seq=?").run(seq);
        const r = await bybitOps.closePosition(1, { seq, symbol: 'BTCUSDT', side: 'LONG', qty: '0.001', closeType: 'MARKET', decisionKey: 'cdk2', source: 'manual' }, _validCreds);
        expect(r.closedBySL).toBe(true);
    });
});

describe('bybitOps.ensureSymbolReady', () => {
    it('sets leverage + position mode + margin', async () => {
        bybitOps._enqueueSynthetic({ retCode: 0, result: {} });  // leverage
        bybitOps._enqueueSynthetic({ retCode: 0, result: {} });  // switch-mode one-way
        bybitOps._enqueueSynthetic({ retCode: 0, result: {} });  // switch-isolated → cross

        const r = await bybitOps.ensureSymbolReady(1, { symbol: 'BTCUSDT', leverage: 5, marginMode: 'CROSSED' }, _validCreds);
        expect(r.ok).toBe(true);
        expect(r.leverage).toBe(5);
        expect(r.marginMode).toBe('CROSSED');
        expect(r.rawExchange).toBe('bybit');
    });

    it('handles retCode=110026 (mode already set, idempotent)', async () => {
        bybitOps._enqueueSynthetic({ retCode: 0, result: {} });
        bybitOps._enqueueSynthetic({ retCode: 110026, retMsg: 'position mode unchanged', result: {} });
        bybitOps._enqueueSynthetic({ retCode: 110026, retMsg: 'cross/isolated unchanged', result: {} });
        const r = await bybitOps.ensureSymbolReady(1, { symbol: 'BTCUSDT', leverage: 5, marginMode: 'CROSSED' }, _validCreds);
        expect(r.ok).toBe(true);
    });
});

describe('bybitOps.getPositions', () => {
    it('maps to canonical shape, filters zero', async () => {
        bybitOps._enqueueSynthetic({
            retCode: 0,
            result: {
                list: [
                    { symbol: 'BTCUSDT', side: 'Buy', size: '0.001', avgPrice: '50000', markPrice: '51000', unrealisedPnl: '1', leverage: '5', tradeMode: 0 },
                    { symbol: 'ETHUSDT', side: '', size: '0', avgPrice: '0' },
                ],
            },
        });
        const r = await bybitOps.getPositions(1, {}, _validCreds);
        expect(r.length).toBe(1);
        expect(r[0].symbol).toBe('BTCUSDT');
        expect(r[0].side).toBe('LONG');
        expect(r[0].rawExchange).toBe('bybit');
    });
});

describe('bybitOps.getBalance', () => {
    it('finds USDT coin in list + canonical shape', async () => {
        bybitOps._enqueueSynthetic({
            retCode: 0,
            result: {
                list: [{
                    coin: [
                        { coin: 'BNB', walletBalance: '10', availableToWithdraw: '8' },
                        { coin: 'USDT', walletBalance: '1000', availableToWithdraw: '950', unrealisedPnl: '5' },
                    ],
                    accountType: 'UNIFIED',
                }],
            },
        });
        const r = await bybitOps.getBalance(1, _validCreds);
        expect(r.asset).toBe('USDT');
        expect(r.walletBalance).toBe('1000');
        expect(r.rawExchange).toBe('bybit');
    });
});

describe('bybitOps.ping', () => {
    it('returns ok + latencyMs', async () => {
        bybitOps._enqueueSynthetic({ retCode: 0, result: { timeSecond: '1234567', timeNano: '...' } });
        const r = await bybitOps.ping(1, _validCreds);
        expect(r.ok).toBe(true);
        expect(typeof r.latencyMs).toBe('number');
        expect(r.rawExchange).toBe('bybit');
    });
});

describe('bybitOps.cancelOrder', () => {
    it('cancels + canonical shape', async () => {
        bybitOps._enqueueSynthetic({ retCode: 0, result: { orderId: 'x', orderStatus: 'Cancelled' } });
        const r = await bybitOps.cancelOrder(1, { symbol: 'BTCUSDT', orderId: 'x' }, _validCreds);
        expect(r.ok).toBe(true);
        expect(r.rawExchange).toBe('bybit');
    });
});

describe('bybitOps.placeStopLoss', () => {
    it('STOP_MARKET reduce-only + canonical shape', async () => {
        bybitOps._enqueueSynthetic({ retCode: 0, result: { orderId: 'sl_new', orderStatus: 'New' } });
        const r = await bybitOps.placeStopLoss(1, {
            symbol: 'BTCUSDT', side: 'LONG', stopPrice: '49000', decisionKey: 'resl_dk_1',
        }, _validCreds);
        expect(r.ok).toBe(true);
        expect(r.slOrderId).toBe('sl_new');
        expect(r.rawExchange).toBe('bybit');
    });
});

describe('bybitOps.getUserTrades', () => {
    it('returns canonical trade array', async () => {
        bybitOps._enqueueSynthetic({
            retCode: 0,
            result: {
                list: [
                    { execId: '1', symbol: 'BTCUSDT', side: 'Buy', execPrice: '50000', execQty: '0.001', execFee: '0.05', feeRate: '0', execTime: '1000', closedPnl: '0' },
                    { execId: '2', symbol: 'BTCUSDT', side: 'Sell', execPrice: '51000', execQty: '0.001', execFee: '0.05', execTime: '2000', closedPnl: '1.0' },
                ],
            },
        });
        const r = await bybitOps.getUserTrades(1, { symbol: 'BTCUSDT', limit: 10 }, _validCreds);
        expect(r.length).toBe(2);
        expect(r[0].side).toBe('BUY');
        expect(r[1].side).toBe('SELL');
        expect(r[0].rawExchange).toBe('bybit');
    });
});
