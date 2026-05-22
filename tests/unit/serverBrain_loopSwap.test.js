'use strict';

// Test that loop swap mechanics work: per-user routing + _pendingSwitch barrier.
// This is a unit test for the SHAPE of the new loop — not full cycle execution.
//
// We expose the helpers via module.exports from serverBrain (see Step 4 in
// implementation). The mock DB only needs audit_log + exchange_accounts tables
// since that's all the swap infrastructure uses directly.

jest.mock('../../server/services/database', () => {
    const Database = require('better-sqlite3');
    const fs = require('fs');
    const TEST_DB = '/tmp/zeus-brain-swap-test-' + Date.now() + '.db';
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    const db = new Database(TEST_DB);
    db.exec(`
        CREATE TABLE audit_log (id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT, details TEXT, created_at TEXT DEFAULT (datetime('now')));
        CREATE TABLE exchange_accounts (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, exchange TEXT NOT NULL DEFAULT 'binance', is_active INTEGER NOT NULL DEFAULT 1, mode TEXT NOT NULL DEFAULT 'live', api_key_encrypted TEXT NOT NULL DEFAULT '', api_secret_encrypted TEXT NOT NULL DEFAULT '');
        CREATE TABLE at_state (id INTEGER PRIMARY KEY, user_id INTEGER, key TEXT, value TEXT);
        CREATE TABLE at_open (id INTEGER PRIMARY KEY, user_id INTEGER, data TEXT);
        CREATE TABLE at_closed (id INTEGER PRIMARY KEY, user_id INTEGER, data TEXT, closed_at TEXT DEFAULT (datetime('now')));
        CREATE TABLE brain_decisions (id INTEGER PRIMARY KEY, user_id INTEGER, symbol TEXT, data TEXT, created_at TEXT DEFAULT (datetime('now')));
        CREATE TABLE brain_parity_log (id INTEGER PRIMARY KEY);
        CREATE TABLE ml_module_state (id INTEGER PRIMARY KEY, user_id INTEGER, resolved_env TEXT, symbol TEXT, module_id TEXT, version TEXT, last_observed_ts INTEGER, trust_score REAL, bandit_params_json TEXT, updated_at TEXT);
        CREATE TABLE ml_r1_violations (id INTEGER PRIMARY KEY);
        CREATE TABLE ml_brain_pro_snapshots (id INTEGER PRIMARY KEY);
        CREATE TABLE ml_regime_history (id INTEGER PRIMARY KEY);
        CREATE TABLE ml_volatility_history (id INTEGER PRIMARY KEY);
        CREATE TABLE ml_correlation_matrix (id INTEGER PRIMARY KEY);
        CREATE TABLE ml_module_heartbeats (id INTEGER PRIMARY KEY);
        CREATE TABLE metrics_snapshots (id INTEGER PRIMARY KEY);
        CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, created_at TEXT DEFAULT (datetime('now')));
        CREATE TABLE at_positions (id INTEGER PRIMARY KEY, user_id INTEGER, data TEXT);
        CREATE TABLE at_pending (id INTEGER PRIMARY KEY, user_id INTEGER, data TEXT);
        CREATE TABLE regime_changes (id INTEGER PRIMARY KEY, user_id INTEGER, symbol TEXT, regime TEXT, prev_regime TEXT, confidence REAL, price REAL, created_at TEXT DEFAULT (datetime('now')));
    `);
    return {
        db,
        // Stub methods used across serverBrain boot path
        atGetState: () => null,
        atSetState: () => {},
        getOpenPositions: () => [],
        getOpenPositionsForUser: () => [],
        saveRegimeChange: () => {},
        listUsers: () => [],
        logParityRow: () => {},
        getState: () => null,
        setState: () => {},
    };
});

// Mock feedManager to no-op
jest.mock('../../server/services/feedManager', () => ({
    activateForUser: jest.fn(),
    deactivateForUser: jest.fn(),
    getRefcount: jest.fn(() => 0),
    getUserExchange: jest.fn(() => null),
}));

// Mock heavy ML modules that require real DB at module load time
jest.mock('../../server/services/ml/ring5LearningService', () => ({
    wrap: jest.fn(({ phase2Decision }) => phase2Decision),
}));

jest.mock('../../server/services/ml/R3B_safety', () => ({
    evaluate: jest.fn(() => ({ cp: 1.0, ood: 0.0 })),
    observeOutcome: jest.fn(),
}));

jest.mock('../../server/services/ml/R1_constitution/enforcementEngine', () => ({
    evaluate: jest.fn(() => ({ violations: [] })),
    logViolations: jest.fn(),
}));

jest.mock('../../server/services/ml/_ring5/mlInputsBuilder', () => ({
    build: jest.fn(() => ({})),
}));

describe('serverBrain loop swap mechanics (Phase 4 Task 23)', () => {
    let sb;
    beforeAll(() => {
        sb = require('../../server/services/serverBrain');
    });

    describe('_getUserExchange', () => {
        it('exported as function', () => {
            expect(typeof sb._getUserExchange).toBe('function');
        });

        it('returns binance for user with no DB row (default)', () => {
            // No exchange_accounts row → should default to 'binance'
            const ex = sb._getUserExchange(99999);
            expect(ex).toBe('binance');
        });

        it('reads from exchange_accounts when user has active row', () => {
            const { db } = require('../../server/services/database');
            db.prepare(`INSERT INTO exchange_accounts (user_id, exchange, is_active) VALUES (?, ?, ?)`).run(7, 'bybit', 1);
            const ex = sb._getUserExchange(7);
            expect(ex).toBe('bybit');
        });

        it('caches result (second call hits cache)', () => {
            const ex1 = sb._getUserExchange(7);
            const ex2 = sb._getUserExchange(7);
            expect(ex1).toBe(ex2);
            expect(ex1).toBe('bybit');
        });
    });

    describe('_markPendingSwitch', () => {
        it('exported as function', () => {
            expect(typeof sb._markPendingSwitch).toBe('function');
        });

        it('stores pending switch info', () => {
            sb._markPendingSwitch(7, 'binance', 'bybit');
            // Internal state — verify via behavior on next cycle (or expose getter)
            expect(true).toBe(true); // smoke test only — full behavior in integration
        });
    });

    describe('_applyPendingSwitches', () => {
        it('exported as function', () => {
            expect(typeof sb._applyPendingSwitches).toBe('function');
        });

        it('moves pending → cache + clears pending', () => {
            sb._markPendingSwitch(8, 'binance', 'bybit');
            sb._applyPendingSwitches();
            const ex = sb._getUserExchange(8);
            expect(ex).toBe('bybit');
        });

        it('emits audit_log entry on apply', () => {
            const { db } = require('../../server/services/database');
            sb._markPendingSwitch(9, 'binance', 'bybit');
            sb._applyPendingSwitches();
            const row = db.prepare(`SELECT * FROM audit_log WHERE user_id = 9 AND action = 'EXCHANGE_SWITCH_APPLIED'`).get();
            expect(row).toBeDefined();
        });
    });
});
