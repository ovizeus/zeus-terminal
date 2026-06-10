'use strict';

// [LEVER-A 2026-06-10] Parity confluence consumes serverSentiment's cached
// global L/S account ratio (R = longs/shorts), mirroring the client rule
// (client/src/engine/confluence.ts:34): ls.l > ls.s ⇔ R > 1; R == 1 → 'bear'
// (client's binary else-branch); missing/unfinite/throwing → 'neut'.
// Shadow parity rows only — the LIVE _calcConfluence is untouched.
//
// Mock block mirrors tests/unit/serverBrain_loopSwap.test.js (same boot-path
// stubs so serverBrain can be required without the real DB / ML modules).

jest.mock('../../server/services/database', () => {
    const Database = require('better-sqlite3');
    const fs = require('fs');
    const TEST_DB = '/tmp/zeus-levera-ls-test-' + Date.now() + '.db';
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

jest.mock('../../server/services/feedManager', () => ({
    activateForUser: jest.fn(),
    deactivateForUser: jest.fn(),
    getRefcount: jest.fn(() => 0),
    getUserExchange: jest.fn(() => null),
}));

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

// The unit under test lazy-requires serverSentiment inside
// _calcConfluenceParity — this mock intercepts that require.
jest.mock('../../server/services/serverSentiment', () => ({
    getSentiment: jest.fn(),
}));

const sentiment = require('../../server/services/serverSentiment');

describe('Lever A — parity confluence LS vote (client-mirror)', () => {
    let sb;

    // Baseline snap/ind: rsi 60 → bull, stDir neut → folds to bear (client
    // fallback), fr null → neut, oi null → neut. With LS missing the dirs are
    // [bull, bear, neut, neut, neut] → bullDirs=1, bearDirs=1, score 20.
    const snap = { symbol: 'BTCUSDT', rsi: { '5m': 60 }, fr: null, oi: null, oiPrev: null };
    const ind = { stDir: 'neut', macdDir: 'neut' };

    beforeAll(() => {
        sb = require('../../server/services/serverBrain');
    });

    beforeEach(() => {
        sentiment.getSentiment.mockReset();
    });

    test('_calcConfluenceParity is exported for tests', () => {
        expect(typeof sb._calcConfluenceParity).toBe('function');
    });

    test('R=1.5 → bull vote counted (bullDirs +1 and score up vs missing LS)', () => {
        sentiment.getSentiment.mockReturnValue({ ls: null });
        const base = sb._calcConfluenceParity(snap, ind);

        sentiment.getSentiment.mockReturnValue({ ls: 1.5 });
        const withLs = sb._calcConfluenceParity(snap, ind);

        expect(sentiment.getSentiment).toHaveBeenCalledWith('BTCUSDT');
        expect(base.bullDirs).toBe(1);
        expect(withLs.bullDirs).toBe(2);
        expect(withLs.bearDirs).toBe(base.bearDirs);
        expect(withLs.score).toBeGreaterThan(base.score);
        expect(withLs.isBull).toBe(true);
    });

    test('R=0.7 → bear vote counted', () => {
        sentiment.getSentiment.mockReturnValue({ ls: null });
        const base = sb._calcConfluenceParity(snap, ind);

        sentiment.getSentiment.mockReturnValue({ ls: 0.7 });
        const withLs = sb._calcConfluenceParity(snap, ind);

        expect(base.bearDirs).toBe(1);
        expect(withLs.bearDirs).toBe(2);
        expect(withLs.bullDirs).toBe(base.bullDirs);
        expect(withLs.isBear).toBe(true);
        expect(withLs.score).toBeLessThan(base.score);
    });

    test('R=1.0 exactly → bear (client parity: l > s is strict, else-branch is bear)', () => {
        sentiment.getSentiment.mockReturnValue({ ls: 1.0 });
        const res = sb._calcConfluenceParity(snap, ind);
        expect(res.bearDirs).toBe(2);
        expect(res.bullDirs).toBe(1);
    });

    test('missing/empty sentiment entry → neut (same as no LS feed)', () => {
        sentiment.getSentiment.mockReturnValue(null);
        const resNull = sb._calcConfluenceParity(snap, ind);

        // serverSentiment's default entry has no ls field at all
        sentiment.getSentiment.mockReturnValue({ compositeScore: 0, ts: 0 });
        const resNoField = sb._calcConfluenceParity(snap, ind);

        for (const res of [resNull, resNoField]) {
            expect(res.bullDirs).toBe(1);
            expect(res.bearDirs).toBe(1);
            expect(res.score).toBe(20);
        }
    });

    test('getSentiment throws → neut, no exception propagates', () => {
        sentiment.getSentiment.mockImplementation(() => { throw new Error('boom'); });
        let res;
        expect(() => { res = sb._calcConfluenceParity(snap, ind); }).not.toThrow();
        expect(res.bullDirs).toBe(1);
        expect(res.bearDirs).toBe(1);
        expect(res.score).toBe(20);
    });

    test('R <= 0 → neut (client lsRatioToSplit returns null for R<=0)', () => {
        sentiment.getSentiment.mockReturnValue({ ls: 0 });
        const res0 = sb._calcConfluenceParity(snap, ind);
        sentiment.getSentiment.mockReturnValue({ ls: -1.2 });
        const resNeg = sb._calcConfluenceParity(snap, ind);
        for (const res of [res0, resNeg]) {
            expect(res.bullDirs).toBe(1);
            expect(res.bearDirs).toBe(1);
        }
    });

    test('non-finite R (NaN/Infinity) → neut', () => {
        sentiment.getSentiment.mockReturnValue({ ls: NaN });
        const resNaN = sb._calcConfluenceParity(snap, ind);
        sentiment.getSentiment.mockReturnValue({ ls: Infinity });
        const resInf = sb._calcConfluenceParity(snap, ind);
        for (const res of [resNaN, resInf]) {
            expect(res.bullDirs).toBe(1);
            expect(res.bearDirs).toBe(1);
        }
    });
});

describe('P2-OI — QUANT_SYMBOLS env-overridable (wsMarketProxy)', () => {
    const ORIG_ENV = process.env.QUANT_SYMBOLS;

    afterEach(() => {
        if (ORIG_ENV === undefined) delete process.env.QUANT_SYMBOLS;
        else process.env.QUANT_SYMBOLS = ORIG_ENV;
    });

    test('env unset → default array equals the original 4', () => {
        delete process.env.QUANT_SYMBOLS;
        jest.isolateModules(() => {
            const proxy = require('../../server/services/wsMarketProxy');
            expect(proxy.QUANT_SYMBOLS).toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT']);
        });
    });

    test('env set → comma-separated override (trimmed, uppercased, empties dropped)', () => {
        process.env.QUANT_SYMBOLS = ' btcusdt , XRPUSDT,, ';
        jest.isolateModules(() => {
            const proxy = require('../../server/services/wsMarketProxy');
            expect(proxy.QUANT_SYMBOLS).toEqual(['BTCUSDT', 'XRPUSDT']);
        });
    });
});
