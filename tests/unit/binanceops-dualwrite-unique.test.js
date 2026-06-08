'use strict';

// [ORPHAN-ROOT FIX 2026-06-08] The dual-write (serverAT persists its canonical
// OPEN row at entry time, M5; binanceOps then transitions ITS row PENDING→OPEN)
// collides on idx_at_pos_user_sym_side_mode_open (one OPEN row per
// user,symbol,side,mode) once both rows carry the same mode. The entry MARKET
// order has ALREADY filled by then, so a thrown UNIQUE error → serverAT abandons
// a FILLED position → orphan → recon re-adopts as x1/manual (the months-old
// "positions appear in manual, x1, open/close by themselves" bug). placeEntry
// must treat the OPEN-transition UNIQUE collision as SUCCESS (order filled,
// position tracked by serverAT's canonical row), NOT a failure.

const Database = require('better-sqlite3');
const fs = require('fs');
const TEST_DB = '/tmp/zeus-bo-dualwrite-' + Date.now() + '.db';
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
const mockDb = new Database(TEST_DB);
mockDb.exec(`
    CREATE TABLE at_positions (seq INTEGER PRIMARY KEY, data TEXT, status TEXT DEFAULT 'OPEN', user_id INTEGER, exchange TEXT DEFAULT 'binance', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE position_events (id INTEGER PRIMARY KEY, position_seq INTEGER NOT NULL, user_id INTEGER NOT NULL, exchange TEXT NOT NULL, event_type TEXT NOT NULL, from_state TEXT, to_state TEXT, payload TEXT NOT NULL DEFAULT '{}', cycle_no INTEGER, ts INTEGER NOT NULL);
    CREATE TABLE emergency_close_queue (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, symbol TEXT NOT NULL, exchange TEXT NOT NULL, qty TEXT NOT NULL, decision_key TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, resolved_at INTEGER, resolved_by TEXT);
    CREATE TABLE audit_log (id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT, details TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE at_closed (seq INTEGER PRIMARY KEY, data TEXT NOT NULL, closed_at TEXT NOT NULL DEFAULT (datetime('now')), user_id INTEGER, exchange TEXT DEFAULT 'binance');
    CREATE UNIQUE INDEX idx_at_pos_user_sym_side_mode_open
      ON at_positions(user_id, json_extract(data,'$.symbol'), json_extract(data,'$.side'), json_extract(data,'$.mode'))
      WHERE status='OPEN';
`);
jest.mock('../../server/services/database', () => ({ db: mockDb }));

const mockSendSignedRequest = jest.fn();
jest.mock('../../server/services/binanceSigner', () => ({ sendSignedRequest: (...a) => mockSendSignedRequest(...a) }));
jest.mock('../../server/services/exchangeInfo', () => ({
    roundOrderParams: jest.fn((sym, qty, price) => ({ quantity: String(qty), price: price ? String(price) : undefined, stopPrice: undefined })),
}));
jest.mock('../../server/services/orderLock', () => ({ acquire: jest.fn(async () => true), release: jest.fn() }));
jest.mock('../../server/services/telegram', () => ({ alertCritical: jest.fn(), sendToUser: jest.fn() }));
jest.mock('../../server/services/serverAT', () => ({ setGlobalHalt: jest.fn() }));

const binanceOps = require('../../server/services/binanceOps');

// FILLED response for every order POST; success for SL/TP/leverage.
function wireHappyExchange() {
    mockSendSignedRequest.mockImplementation(async (method, path) => {
        if (path.includes('/leverage')) return { leverage: 5 };
        if (path.includes('/algoOrder')) return { orderId: 8888, algoId: 8888, status: 'NEW' }; // SL/TP conditional
        if (path.includes('/order')) return { orderId: 7777, status: 'FILLED', avgPrice: '63500', executedQty: '0.05' };
        return {};
    });
}

describe('[ORPHAN-ROOT] placeEntry survives the dual-write UNIQUE collision (filled order NOT abandoned)', () => {
    beforeEach(() => {
        mockSendSignedRequest.mockReset();
        mockDb.prepare('DELETE FROM at_positions').run();
        wireHappyExchange();
    });

    test('OPEN-transition UNIQUE collision with serverAT canonical row → ok:true (order filled, not abandoned)', async () => {
        // serverAT already persisted its canonical OPEN row for the same key (M5).
        mockDb.prepare(`INSERT INTO at_positions (seq, data, status, user_id) VALUES (?, ?, 'OPEN', ?)`)
            .run(900001, JSON.stringify({ symbol: 'BTCUSDT', side: 'LONG', mode: 'live', price: 63400 }), 1);

        const res = await binanceOps.placeEntry(1, {
            symbol: 'BTCUSDT', side: 'LONG', qty: '0.05', entryType: 'MARKET',
            sl: { price: '62000' }, tp: null, leverage: 5,
            decisionKey: 'SAT_1_unq', source: 'serverAT', mode: 'live',
        }, { apiKey: 'k', apiSecret: 's', mode: 'testnet', exchange: 'binance' });

        // The order FILLED — must NOT be reported as a failure (that abandons → orphan).
        expect(res.ok).toBe(true);
        expect(res.orderId).toBe(7777);
        // serverAT's canonical OPEN row remains the only OPEN row for the key.
        const openRows = mockDb.prepare(
            `SELECT COUNT(*) c FROM at_positions WHERE status='OPEN' AND user_id=1 AND json_extract(data,'$.symbol')='BTCUSDT' AND json_extract(data,'$.side')='LONG' AND json_extract(data,'$.mode')='live'`
        ).get();
        expect(openRows.c).toBe(1);
    });

    test('no collision (fresh key) → ok:true as normal', async () => {
        const res = await binanceOps.placeEntry(1, {
            symbol: 'ETHUSDT', side: 'LONG', qty: '0.5', entryType: 'MARKET',
            sl: { price: '1600' }, tp: null, leverage: 5,
            decisionKey: 'SAT_1_fresh', source: 'serverAT', mode: 'live',
        }, { apiKey: 'k', apiSecret: 's', mode: 'testnet', exchange: 'binance' });
        expect(res.ok).toBe(true);
    });
});
