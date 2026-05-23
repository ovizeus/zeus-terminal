'use strict';

const Database = require('better-sqlite3');
const TEST_DB = '/tmp/zeus-parity-shadow-test-' + Date.now() + '.db';
const mockDb = new Database(TEST_DB);
mockDb.exec(`
    CREATE TABLE dsl_parity_log (id INTEGER PRIMARY KEY, user_id INTEGER, symbol TEXT, exchange TEXT, cycle_no INTEGER, decision TEXT, shadow_signal TEXT, diverged INTEGER DEFAULT 0, details TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE audit_log (id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT, details TEXT, created_at TEXT DEFAULT (datetime('now')));
`);
jest.mock('../../server/services/database', () => ({ db: mockDb }));
jest.mock('../../server/services/serverState', () => ({
    forExchange: jest.fn((ex) => ({
        getSnapshotForSymbol: jest.fn((sym) => {
            if (ex === 'bybit') return { price: 50100, regime: 'BULL', exchange: 'bybit' };
            return { price: 50000, regime: 'BULL', exchange: 'binance' };
        }),
    })),
}));

const psl = require('../../server/services/parityShadowLogger');

beforeEach(() => {
    mockDb.exec('DELETE FROM dsl_parity_log; DELETE FROM audit_log;');
});

describe('parityShadowLogger', () => {
    it('logDivergence inserts row', () => {
        psl.logDivergence({ userId: 1, symbol: 'BTCUSDT', exchange: 'binance', shadowExchange: 'bybit', cycleNo: 1, decision: 'HOLD', shadowSignal: 'HOLD', diverged: false, details: {} });
        const row = mockDb.prepare('SELECT * FROM dsl_parity_log').get();
        expect(row).toBeDefined();
        expect(row.diverged).toBe(0);
    });

    it('logDivergence records divergence', () => {
        psl.logDivergence({ userId: 1, symbol: 'BTCUSDT', exchange: 'binance', shadowExchange: 'bybit', cycleNo: 2, decision: 'LONG', shadowSignal: 'HOLD', diverged: true, details: { reason: 'regime mismatch' } });
        const row = mockDb.prepare('SELECT * FROM dsl_parity_log WHERE diverged=1').get();
        expect(row).toBeDefined();
    });

    it('computeShadowSignal returns snap from shadow exchange', () => {
        const sig = psl.computeShadowSignal('BTCUSDT', 'bybit');
        expect(sig.available).toBe(true);
        expect(sig.price).toBe(50100);
    });

    it('getDailyParity computes percentage', () => {
        const today = new Date().toISOString().slice(0, 10);
        for (let i = 0; i < 8; i++) psl.logDivergence({ userId: 1, symbol: 'BTCUSDT', exchange: 'binance', shadowExchange: 'bybit', cycleNo: i, decision: 'HOLD', shadowSignal: 'HOLD', diverged: false });
        psl.logDivergence({ userId: 1, symbol: 'BTCUSDT', exchange: 'binance', shadowExchange: 'bybit', cycleNo: 9, decision: 'LONG', shadowSignal: 'HOLD', diverged: true });
        psl.logDivergence({ userId: 1, symbol: 'BTCUSDT', exchange: 'binance', shadowExchange: 'bybit', cycleNo: 10, decision: 'SHORT', shadowSignal: 'HOLD', diverged: true });
        const p = psl.getDailyParity(1, today);
        expect(p.total).toBe(10);
        expect(p.matched).toBe(8);
        expect(p.parityPct).toBe(80);
    });

    it('checkParityAlert fires when below 80%', () => {
        const today = new Date().toISOString().slice(0, 10);
        for (let i = 0; i < 7; i++) psl.logDivergence({ userId: 1, symbol: 'BTCUSDT', exchange: 'binance', shadowExchange: 'bybit', cycleNo: i, decision: 'HOLD', shadowSignal: 'HOLD', diverged: false });
        for (let i = 7; i < 12; i++) psl.logDivergence({ userId: 1, symbol: 'BTCUSDT', exchange: 'binance', shadowExchange: 'bybit', cycleNo: i, decision: 'LONG', shadowSignal: 'SHORT', diverged: true });
        const result = psl.checkParityAlert(1);
        expect(result.alert).toBe(true);
        expect(result.parity.parityPct).toBeLessThan(80);
        const audit = mockDb.prepare(`SELECT * FROM audit_log WHERE action='PARITY_ALERT_LOW'`).get();
        expect(audit).toBeDefined();
    });

    it('checkParityAlert no alert above 80%', () => {
        for (let i = 0; i < 10; i++) psl.logDivergence({ userId: 1, symbol: 'BTCUSDT', exchange: 'binance', shadowExchange: 'bybit', cycleNo: i, decision: 'HOLD', shadowSignal: 'HOLD', diverged: false });
        const result = psl.checkParityAlert(1);
        expect(result.alert).toBe(false);
    });
});
