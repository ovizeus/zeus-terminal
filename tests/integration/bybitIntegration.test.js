'use strict';

const Database = require('better-sqlite3');
const TEST_DB = '/tmp/zeus-integration-bybit-entry-' + Date.now() + '.db';
const mockDb = new Database(TEST_DB);

// Full schema needed for integration
mockDb.exec(`
    CREATE TABLE exchange_accounts (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, exchange TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1, mode TEXT NOT NULL DEFAULT 'testnet', status TEXT NOT NULL DEFAULT 'verified', api_key_encrypted TEXT NOT NULL DEFAULT '', api_secret_encrypted TEXT NOT NULL DEFAULT '');
    CREATE TABLE at_positions (seq INTEGER PRIMARY KEY, data TEXT, status TEXT DEFAULT 'OPEN', user_id INTEGER, exchange TEXT DEFAULT 'binance', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE position_events (id INTEGER PRIMARY KEY, position_seq INTEGER NOT NULL, user_id INTEGER NOT NULL, exchange TEXT NOT NULL, event_type TEXT NOT NULL, from_state TEXT, to_state TEXT, payload TEXT NOT NULL DEFAULT '{}', cycle_no INTEGER, ts INTEGER NOT NULL);
    CREATE TABLE emergency_close_queue (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, symbol TEXT NOT NULL, exchange TEXT NOT NULL, qty TEXT NOT NULL, decision_key TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, resolved_at INTEGER, resolved_by TEXT);
    CREATE TABLE audit_log (id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT, details TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE dsl_parity_log (id INTEGER PRIMARY KEY, user_id INTEGER, symbol TEXT, exchange TEXT, cycle_no INTEGER, decision TEXT, shadow_signal TEXT, diverged INTEGER DEFAULT 0, details TEXT, created_at TEXT DEFAULT (datetime('now')));
`);

jest.mock('../../server/services/database', () => ({ db: mockDb }));

jest.mock('../../server/services/credentialStore', () => ({
    getExchangeCreds: jest.fn((uid) => {
        if (uid === 10) return { exchange: 'bybit', mode: 'testnet', apiKey: 'testKey', apiSecret: 'testSecret' };
        if (uid === 30) return { exchange: 'bybit', mode: 'testnet', apiKey: 'testKey30', apiSecret: 'testSecret30' };
        return null;
    }),
    // [P1/P2c.3] per-exchange creds — recoveryBoot + exchangeOps route via this now.
    getExchangeCredsFor: jest.fn((uid, exchange) => {
        if (uid === 10) return { exchange, mode: 'testnet', apiKey: 'testKey', apiSecret: 'testSecret' };
        if (uid === 30) return { exchange, mode: 'testnet', apiKey: 'testKey30', apiSecret: 'testSecret30' };
        return null;
    }),
}));

// Mock bybitSigner dry-run to validate + return void (synthetic queue in bybitOps handles responses)
jest.mock('../../server/services/bybitSigner', () => ({
    buildSignedRequestDryRun: jest.fn(),
    parseBybitError: jest.fn((r) => ({ code: 'ErrUnknown', message: r?.retMsg || 'err' })),
}));

jest.mock('../../server/services/orderLock', () => ({
    acquire: jest.fn(async () => true),
    release: jest.fn(),
}));

jest.mock('../../server/services/feedManager', () => ({
    deactivateForUser: jest.fn(),
    activateForUser: jest.fn(),
}));

jest.mock('../../server/services/ml/ring5LearningService', () => ({
    wrap: jest.fn(async (opts) => opts.run()),
    recordContribution: jest.fn(),
    _stateHelper: {},
}));

jest.mock('../../server/services/serverState', () => ({
    forExchange: jest.fn((ex) => ({
        getSnapshotForSymbol: jest.fn((sym) => {
            if (ex === 'bybit') return { price: 50100, regime: 'BULL', exchange: 'bybit' };
            return { price: 50000, regime: 'BULL', exchange: 'binance' };
        }),
    })),
}));

const exchangeOps = require('../../server/services/exchangeOps');
const bybitOps = require('../../server/services/bybitOps');

beforeEach(() => {
    mockDb.exec('DELETE FROM at_positions; DELETE FROM position_events; DELETE FROM emergency_close_queue; DELETE FROM audit_log; DELETE FROM exchange_accounts; DELETE FROM dsl_parity_log;');
    bybitOps._resetSyntheticQueue();
    exchangeOps._resetForTest();
});

// ---------------------------------------------------------------------------
// Task 57: Bybit entry flow end-to-end
// ---------------------------------------------------------------------------
describe('Integration: Bybit entry flow end-to-end', () => {
    it('placeEntry via exchangeOps → bybitOps → position + events in DB', async () => {
        // Seed synthetic responses
        bybitOps._enqueueSynthetic({ retCode: 0, result: { orderId: 'int_bye1', orderStatus: 'Filled', cumExecQty: '0.01', avgPrice: '68000' } });
        bybitOps._enqueueSynthetic({ retCode: 0, result: { orderId: 'int_bysl1', orderStatus: 'New' } });

        const result = await exchangeOps.placeEntry(10, {
            symbol: 'BTCUSDT', side: 'LONG', qty: '0.01', entryType: 'MARKET',
            sl: { price: '65000', type: 'MARKET' }, leverage: 5,
            decisionKey: 'int_test_dk_001', source: 'integration_test',
        });

        expect(result.ok).toBe(true);
        expect(result.rawExchange).toBe('bybit');
        expect(result.orderId).toBe('int_bye1');
        expect(result.slOrderId).toBe('int_bysl1');

        // Verify DB state
        const pos = mockDb.prepare('SELECT * FROM at_positions WHERE seq=?').get(result.seq);
        expect(pos).toBeDefined();
        expect(pos.status).toBe('OPEN');
        expect(pos.exchange).toBe('bybit');

        // Verify position_events trail
        const events = mockDb.prepare('SELECT event_type FROM position_events WHERE position_seq=? ORDER BY id').all(result.seq);
        const types = events.map(e => e.event_type);
        expect(types).toContain('CREATED');
        expect(types).toContain('SL_PLACED');
    });

    it('user without creds → throws', async () => {
        await expect(exchangeOps.placeEntry(999, {
            symbol: 'BTCUSDT', side: 'LONG', qty: '0.01', entryType: 'MARKET',
            sl: { price: '65000', type: 'MARKET' }, leverage: 5,
            decisionKey: 'int_test_dk_002', source: 'test',
        })).rejects.toThrow(/no creds/i);
    });
});

// ---------------------------------------------------------------------------
// Task 58: Exchange switch barrier atomic
// ---------------------------------------------------------------------------
describe('Integration: Exchange switch barrier', () => {
    it('_markPendingSwitch + _applyPendingSwitches atomic flow', () => {
        const serverBrain = require('../../server/services/serverBrain');
        // Set initial exchange
        mockDb.prepare(`INSERT INTO exchange_accounts (user_id, exchange, is_active) VALUES (20, 'binance', 1)`).run();

        // Invalidate cache so the fresh DB row is read
        serverBrain._invalidateUserExchangeCache(20);

        // Before switch: user is on binance
        expect(serverBrain._getUserExchange(20)).toBe('binance');

        // Mark pending
        serverBrain._markPendingSwitch(20, 'binance', 'bybit');

        // Before apply: still binance (barrier NOT yet applied)
        // _getUserExchange reads from cache which was set to 'binance'
        expect(serverBrain._getUserExchange(20)).toBe('binance');

        // Apply switches
        serverBrain._applyPendingSwitches();

        // After apply: now bybit
        expect(serverBrain._getUserExchange(20)).toBe('bybit');
    });
});

// ---------------------------------------------------------------------------
// Task 59: State machine race protection
// ---------------------------------------------------------------------------
describe('Integration: Position state machine race protection', () => {
    it('concurrent transitions to same state rejected', () => {
        const positionStateMachine = require('../../server/services/positionStateMachine');
        // Create position
        const r = mockDb.prepare(`INSERT INTO at_positions (data, status, user_id, exchange) VALUES ('{}', 'PENDING', 1, 'binance')`).run();
        const seq = r.lastInsertRowid;

        // First transition succeeds
        positionStateMachine.transition(seq, 'PENDING', 'OPENING', { test: true });
        expect(positionStateMachine.getCurrentState(seq)).toBe('OPENING');

        // Second transition from PENDING fails (state already OPENING)
        expect(() => positionStateMachine.transition(seq, 'PENDING', 'OPENING', {}))
            .toThrow(/state mismatch/i);
    });
});

// ---------------------------------------------------------------------------
// Task 60: Recovery boot reconciliation
// ---------------------------------------------------------------------------
describe('Integration: Recovery boot reconciliation', () => {
    it('orphans position not found on exchange', async () => {
        // Insert a Bybit user with an open position
        mockDb.prepare(`INSERT INTO exchange_accounts (user_id, exchange, is_active) VALUES (30, 'bybit', 1)`).run();
        mockDb.prepare(`INSERT INTO at_positions (data, status, user_id, exchange) VALUES (?, 'OPEN', 30, 'bybit')`).run(
            JSON.stringify({ symbol: 'ETHUSDT', side: 'LONG', qty: '1', slOrderId: 'sl1', exchange: 'bybit' })
        );

        // Seed synthetic response for getPositions → empty list (position closed externally)
        bybitOps._enqueueSynthetic({ retCode: 0, result: { list: [] } });

        const recoveryBoot = require('../../server/services/recoveryBoot');
        await recoveryBoot.run();

        // Should have orphaned the position
        const pos = mockDb.prepare('SELECT status FROM at_positions WHERE user_id=30').get();
        if (pos) expect(pos.status).toBe('ORPHANED');
    });
});

// ---------------------------------------------------------------------------
// Task 61: Parity shadow divergence detection
// ---------------------------------------------------------------------------
describe('Integration: Parity shadow divergence detection', () => {
    it('logDivergence + getDailyParity + checkParityAlert pipeline', () => {
        const psl = require('../../server/services/parityShadowLogger');
        // Log 10 entries: 7 matched, 3 diverged
        for (let i = 0; i < 7; i++) {
            psl.logDivergence({ userId: 40, symbol: 'BTCUSDT', exchange: 'binance', shadowExchange: 'bybit', cycleNo: i, decision: 'HOLD', shadowSignal: 'HOLD', diverged: false });
        }
        for (let i = 7; i < 10; i++) {
            psl.logDivergence({ userId: 40, symbol: 'BTCUSDT', exchange: 'binance', shadowExchange: 'bybit', cycleNo: i, decision: 'LONG', shadowSignal: 'SHORT', diverged: true });
        }

        const today = new Date().toISOString().slice(0, 10);
        const parity = psl.getDailyParity(40, today);
        expect(parity.parityPct).toBe(70);

        const alert = psl.checkParityAlert(40);
        expect(alert.alert).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Task 62: Feed contract parity
// ---------------------------------------------------------------------------
describe('Integration: Feed contract parity', () => {
    it('binanceFeed and bybitFeed expose identical API shape', () => {
        const binanceFeed = require('../../server/services/binanceFeed');
        const bybitFeed = require('../../server/services/bybitFeed');
        const requiredMethods = ['start', 'stop', 'on', 'off', 'getConnectionState'];
        for (const m of requiredMethods) {
            expect(typeof binanceFeed[m]).toBe('function');
            expect(typeof bybitFeed[m]).toBe('function');
        }
    });
});
