'use strict';

// Mock all external deps before requiring binanceOps
const Database = require('better-sqlite3');
const fs = require('fs');
const TEST_DB = '/tmp/zeus-binance-ops-test-' + Date.now() + '.db';
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
const mockDb = new Database(TEST_DB);
mockDb.exec(`
    CREATE TABLE at_positions (seq INTEGER PRIMARY KEY, data TEXT, status TEXT DEFAULT 'OPEN', user_id INTEGER, exchange TEXT DEFAULT 'binance', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE position_events (id INTEGER PRIMARY KEY, position_seq INTEGER NOT NULL, user_id INTEGER NOT NULL, exchange TEXT NOT NULL, event_type TEXT NOT NULL, from_state TEXT, to_state TEXT, payload TEXT NOT NULL DEFAULT '{}', cycle_no INTEGER, ts INTEGER NOT NULL);
    CREATE TABLE emergency_close_queue (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, symbol TEXT NOT NULL, exchange TEXT NOT NULL, qty TEXT NOT NULL, decision_key TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, resolved_at INTEGER, resolved_by TEXT);
    CREATE TABLE audit_log (id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT, details TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE at_closed (seq INTEGER PRIMARY KEY, data TEXT, status TEXT DEFAULT 'CLOSED', user_id INTEGER, exchange TEXT DEFAULT 'binance', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
`);
jest.mock('../../server/services/database', () => ({ db: mockDb }));

// Mock binanceSigner — factory uses mockSendSignedRequest (mock-prefixed, allowed by Jest hoisting)
const mockSendSignedRequest = jest.fn();
jest.mock('../../server/services/binanceSigner', () => ({ sendSignedRequest: (...args) => mockSendSignedRequest(...args) }));

// Mock exchangeInfo
jest.mock('../../server/services/exchangeInfo', () => ({
    roundOrderParams: jest.fn((sym, qty, price) => ({
        quantity: String(qty),
        price: price ? String(price) : undefined,
        stopPrice: undefined,
    })),
}));

// Mock orderLock — always succeed
jest.mock('../../server/services/orderLock', () => ({
    acquire: jest.fn(async () => true),
    release: jest.fn(),
}));

// Mock telegram
jest.mock('../../server/services/telegram', () => ({
    alertCritical: jest.fn(),
    sendToUser: jest.fn(),
}));

// Mock serverAT for setGlobalHalt
jest.mock('../../server/services/serverAT', () => ({
    setGlobalHalt: jest.fn(),
}));

const binanceOps = require('../../server/services/binanceOps');

const _validParams = (overrides = {}) => ({
    symbol: 'BTCUSDT', side: 'LONG', qty: '0.001', entryType: 'MARKET',
    sl: { price: '49000', type: 'MARKET' },
    leverage: 5,
    decisionKey: 'test_dk_' + Date.now(),
    source: 'auto',
    ...overrides,
});

const _validCreds = { exchange: 'binance', mode: 'testnet', apiKey: 'k', apiSecret: 's' };

describe('binanceOps.placeEntry', () => {
    beforeEach(() => {
        mockSendSignedRequest.mockReset();
        mockDb.exec('DELETE FROM at_positions; DELETE FROM position_events; DELETE FROM emergency_close_queue; DELETE FROM audit_log;');
        // Reset exchangeInfo mock to default implementation
        const exchangeInfo = require('../../server/services/exchangeInfo');
        exchangeInfo.roundOrderParams.mockImplementation((sym, qty, price) => ({
            quantity: String(qty),
            price: price ? String(price) : undefined,
            stopPrice: undefined,
        }));
        // Reset orderLock mock to default implementation
        const orderLock = require('../../server/services/orderLock');
        orderLock.acquire.mockImplementation(async () => true);
    });

    it('happy path: entry FILLED + SL placed → returns canonical EntryResult', async () => {
        mockSendSignedRequest.mockResolvedValueOnce({ status: 'FILLED', orderId: 'entry1', executedQty: '0.001', avgPrice: '50000' });
        mockSendSignedRequest.mockResolvedValueOnce({ orderId: 'sl1', status: 'NEW' });

        const r = await binanceOps.placeEntry(1, _validParams(), _validCreds);

        expect(r.ok).toBe(true);
        expect(r.orderId).toBe('entry1');
        expect(r.slOrderId).toBe('sl1');
        expect(r.status).toBe('FILLED');
        expect(r.rawExchange).toBe('binance');

        // Position row created with status OPEN
        const pos = mockDb.prepare('SELECT status FROM at_positions WHERE seq = ?').get(r.seq);
        expect(pos.status).toBe('OPEN');

        // position_events trail: CREATED → PENDING/OPENING → OPEN
        const events = mockDb.prepare('SELECT event_type, from_state, to_state FROM position_events WHERE position_seq = ? ORDER BY ts ASC, id ASC').all(r.seq);
        expect(events.length).toBeGreaterThanOrEqual(2);
        expect(events[events.length - 1].to_state).toBe('OPEN');
    });

    it('happy path with TP: entry + SL + TP all placed', async () => {
        mockSendSignedRequest
            .mockResolvedValueOnce({ status: 'FILLED', orderId: 'e2', executedQty: '0.001', avgPrice: '50000' })
            .mockResolvedValueOnce({ orderId: 'sl2', status: 'NEW' })
            .mockResolvedValueOnce({ orderId: 'tp2', status: 'NEW' });

        const r = await binanceOps.placeEntry(1, _validParams({ tp: { price: '52000', type: 'MARKET' } }), _validCreds);
        expect(r.slOrderId).toBe('sl2');
        expect(r.tpOrderId).toBe('tp2');
    });

    it('entry rejected: returns ok=false with canonical error (no SL attempted)', async () => {
        mockSendSignedRequest.mockResolvedValueOnce({ code: -2010, msg: 'Account has insufficient balance' });

        const r = await binanceOps.placeEntry(1, _validParams(), _validCreds);
        expect(r.ok).toBe(false);
        expect(r.error.code).toBe('ErrInsufficientBalance');
        expect(mockSendSignedRequest).toHaveBeenCalledTimes(1); // only entry attempt, no SL
    });

    it('SL retry 3x then emergency close success', async () => {
        mockSendSignedRequest
            .mockResolvedValueOnce({ status: 'FILLED', orderId: 'e3', executedQty: '0.001', avgPrice: '50000' })  // entry OK
            .mockRejectedValueOnce(new Error('SL try 1 fail'))
            .mockRejectedValueOnce(new Error('SL try 2 fail'))
            .mockRejectedValueOnce(new Error('SL try 3 fail'))
            .mockResolvedValueOnce({ status: 'FILLED', orderId: 'emerg1' });  // emergency close OK

        const r = await binanceOps.placeEntry(1, _validParams(), _validCreds);
        expect(r.ok).toBe(false);
        expect(r.error.code).toBe('ErrSlPlacementFailed');
        expect(r.catastrophic).toBeFalsy(); // emergency close succeeded
    }, 15000);

    it('SL retry 3x + emergency close fail = catastrophic + queue insert', async () => {
        mockSendSignedRequest
            .mockResolvedValueOnce({ status: 'FILLED', orderId: 'e4', executedQty: '0.001', avgPrice: '50000' })
            .mockRejectedValue(new Error('SL/emerg fail'));  // all subsequent calls fail

        const r = await binanceOps.placeEntry(1, _validParams(), _validCreds);
        expect(r.ok).toBe(false);
        expect(r.error.code).toBe('ErrSlPlacementFailed');
        expect(r.catastrophic).toBe(true);

        // emergency_close_queue should have row
        const q = mockDb.prepare('SELECT * FROM emergency_close_queue WHERE user_id = ?').get(1);
        expect(q).toBeDefined();

        // Telegram critical alert called
        const telegram = require('../../server/services/telegram');
        expect(telegram.alertCritical).toHaveBeenCalled();

        // PANIC halt set
        const serverAT = require('../../server/services/serverAT');
        expect(serverAT.setGlobalHalt).toHaveBeenCalledWith(1, true, 'EMERGENCY_CLOSE_CATASTROPHIC');
    }, 20000);

    it('TP failure does NOT block ok=true (warning only)', async () => {
        mockSendSignedRequest
            .mockResolvedValueOnce({ status: 'FILLED', orderId: 'e5', executedQty: '0.001', avgPrice: '50000' })
            .mockResolvedValueOnce({ orderId: 'sl5', status: 'NEW' })
            .mockRejectedValueOnce(new Error('TP fail'));

        const r = await binanceOps.placeEntry(1, _validParams({ tp: { price: '52000', type: 'MARKET' } }), _validCreds);
        expect(r.ok).toBe(true);  // OK despite TP fail
        expect(r.slOrderId).toBe('sl5');
        expect(r.tpOrderId).toBeNull();
    });

    it('lot size align fail → CANCELLED state, no signed request', async () => {
        const exchangeInfo = require('../../server/services/exchangeInfo');
        exchangeInfo.roundOrderParams.mockReturnValueOnce(null);

        const r = await binanceOps.placeEntry(1, _validParams(), _validCreds);
        expect(r.ok).toBe(false);
        expect(r.error.code).toBe('ErrLotSize');
        expect(mockSendSignedRequest).not.toHaveBeenCalled();
    });

    it('order lock timeout → ErrLockTimeout', async () => {
        const orderLock = require('../../server/services/orderLock');
        orderLock.acquire.mockResolvedValueOnce(false);

        const r = await binanceOps.placeEntry(1, _validParams(), _validCreds);
        expect(r.ok).toBe(false);
        expect(r.error.code).toBe('ErrLockTimeout');
    });
});

// Expose db for closePosition tests
const _db = mockDb;

describe('binanceOps.closePosition', () => {
    let seq;

    beforeEach(async () => {
        mockSendSignedRequest.mockReset();
        _db.exec('DELETE FROM at_positions; DELETE FROM position_events; DELETE FROM at_closed;');
        // Pre-create an OPEN position
        const r = _db.prepare(
            `INSERT INTO at_positions (data, status, user_id, exchange, created_at, updated_at) VALUES (?, 'OPEN', ?, 'binance', datetime('now'), datetime('now'))`
        ).run(JSON.stringify({
            symbol: 'BTCUSDT', side: 'LONG', qty: '0.001',
            entryOrderId: 'e1', slOrderId: 'sl1', tpOrderId: 'tp1', avgFillPrice: '50000',
        }), 1);
        seq = r.lastInsertRowid;
        // Reset orderLock mock to default
        const orderLock = require('../../server/services/orderLock');
        orderLock.acquire.mockImplementation(async () => true);
    });

    const _validCloseParams = (overrides = {}) => ({
        seq, symbol: 'BTCUSDT', side: 'LONG', qty: '0.001',
        closeType: 'MARKET', decisionKey: 'close_dk_' + Date.now(),
        source: 'manual', ...overrides,
    });

    it('happy path: cancels SL + TP then places close → state CLOSED', async () => {
        mockSendSignedRequest
            .mockResolvedValueOnce({ status: 'CANCELED', orderId: 'sl1' })  // cancel SL
            .mockResolvedValueOnce({ status: 'CANCELED', orderId: 'tp1' })  // cancel TP
            .mockResolvedValueOnce({ status: 'FILLED', orderId: 'close1', executedQty: '0.001', avgPrice: '51000' });

        const r = await binanceOps.closePosition(1, _validCloseParams(), _validCreds);
        expect(r.ok).toBe(true);
        expect(r.orderId).toBe('close1');
        expect(r.status).toBe('FILLED');
        expect(r.rawExchange).toBe('binance');

        // Position moved to at_closed
        const open = _db.prepare('SELECT * FROM at_positions WHERE seq = ?').get(seq);
        const closed = _db.prepare('SELECT * FROM at_closed WHERE seq = ?').get(seq);
        // Either at_positions row deleted+at_closed row exists, OR at_positions.status='CLOSED'
        expect(closed || (open && open.status === 'CLOSED')).toBeTruthy();

        const events = _db.prepare('SELECT event_type FROM position_events WHERE position_seq = ? ORDER BY id').all(seq);
        const types = events.map(e => e.event_type);
        expect(types).toContain('CLOSED');
    });

    it('position already CLOSED (SL race) → returns ok:true closedBySL:true, no close order sent', async () => {
        // Mark position closed BEFORE closePosition call (simulating SL trigger race)
        _db.prepare("UPDATE at_positions SET status='CLOSED' WHERE seq=?").run(seq);

        const r = await binanceOps.closePosition(1, _validCloseParams(), _validCreds);
        expect(r.ok).toBe(true);
        expect(r.closedBySL).toBe(true);
        expect(mockSendSignedRequest).not.toHaveBeenCalled();
    });

    it('cancel SL fail → continues with close anyway (warn only)', async () => {
        mockSendSignedRequest
            .mockRejectedValueOnce(new Error('SL cancel fail'))
            .mockResolvedValueOnce({ status: 'CANCELED', orderId: 'tp1' })
            .mockResolvedValueOnce({ status: 'FILLED', orderId: 'close2', executedQty: '0.001', avgPrice: '51000' });

        const r = await binanceOps.closePosition(1, _validCloseParams(), _validCreds);
        expect(r.ok).toBe(true);  // close still succeeds
    });

    it('close rejected → state reverts CLOSING→OPEN', async () => {
        mockSendSignedRequest
            .mockResolvedValueOnce({ status: 'CANCELED', orderId: 'sl1' })
            .mockResolvedValueOnce({ status: 'CANCELED', orderId: 'tp1' })
            .mockResolvedValueOnce({ code: -2022, msg: 'ReduceOnly order is rejected' });

        const r = await binanceOps.closePosition(1, _validCloseParams(), _validCreds);
        expect(r.ok).toBe(false);
        // Position should still be OPEN (state reverted)
        const pos = _db.prepare('SELECT status FROM at_positions WHERE seq = ?').get(seq);
        expect(pos.status).toBe('OPEN');
    });

    it('position not found → throws ErrNotFound', async () => {
        await expect(binanceOps.closePosition(1, _validCloseParams({ seq: 99999 }), _validCreds))
            .rejects.toMatchObject({ code: 'ErrNotFound' });
    });

    it('order lock timeout → ErrLockTimeout', async () => {
        const orderLock = require('../../server/services/orderLock');
        orderLock.acquire.mockResolvedValueOnce(false);

        const r = await binanceOps.closePosition(1, _validCloseParams(), _validCreds);
        expect(r.ok).toBe(false);
        expect(r.error.code).toBe('ErrLockTimeout');
    });
});
