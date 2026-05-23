'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p14-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const cr = require('../../../server/services/ml/R3A_safety/conflictResolution');

const TEST_USER = 9114;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_veto_log WHERE user_id = ?').run(TEST_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§14 Migration 055_ml_veto_log', () => {
    test('table ml_veto_log exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_veto_log'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_veto_log)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'decision', 'winning_signal',
            'winning_severity', 'winning_hierarchy', 'blockers_json',
            'penalties_json', 'score_input', 'score_adjusted',
            'context_json', 'created_at'
        ]));
    });

    test('CHECK decision restricts to BLOCK|PROCEED|PENALIZED', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_veto_log (user_id, resolved_env, decision, blockers_json, penalties_json, created_at)
             VALUES (?, ?, 'BOGUS', '[]', '[]', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK resolved_env restricts to DEMO|TESTNET|REAL', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_veto_log (user_id, resolved_env, decision, blockers_json, penalties_json, created_at)
             VALUES (?, 'PROD', 'PROCEED', '[]', '[]', ?)`
        ).run(TEST_USER, Date.now())).toThrow();
    });
});

describe('§14 Exported constants', () => {
    test('SIGNAL_KEYS has 12 entries', () => {
        expect(cr.SIGNAL_KEYS).toHaveLength(12);
        expect(cr.SIGNAL_KEYS).toEqual(expect.arrayContaining([
            'macro_red_flag', 'spread_excessive', 'slippage_estimate_high',
            'feed_unstable', 'htf_ltf_contradiction', 'global_bias_opposite',
            'drawdown_limit_reached', 'execution_unsafe',
            'reconciliation_failed', 'drift_significant', 'venue_anomaly',
            'api_latency_severe'
        ]));
    });

    test('SEVERITY_MAP classifies each signal as BLOCK or SCORE_PENALTY', () => {
        for (const key of cr.SIGNAL_KEYS) {
            expect(['BLOCK', 'SCORE_PENALTY']).toContain(cr.SEVERITY_MAP[key]);
        }
    });

    test('AUTHORITY_HIERARCHY has 6 levels in spec order', () => {
        expect(cr.AUTHORITY_HIERARCHY).toEqual([
            'safety_veto',
            'reconciliation',
            'macro_red_flag',
            'execution',
            'portfolio_risk',
            'data_health'
        ]);
    });

    test('SIGNAL_TO_HIERARCHY maps each signal to one hierarchy level', () => {
        for (const key of cr.SIGNAL_KEYS) {
            expect(cr.AUTHORITY_HIERARCHY).toContain(cr.SIGNAL_TO_HIERARCHY[key]);
        }
    });

    test('BLOCK signals include safety_veto-class signals (drawdown_limit, execution_unsafe, reconciliation_failed)', () => {
        expect(cr.SEVERITY_MAP.drawdown_limit_reached).toBe('BLOCK');
        expect(cr.SEVERITY_MAP.execution_unsafe).toBe('BLOCK');
        expect(cr.SEVERITY_MAP.reconciliation_failed).toBe('BLOCK');
    });
});

describe('§14 evaluateVetoSignals — basic decision matrix', () => {
    test('no signals active → PROCEED with score unchanged', () => {
        const r = cr.evaluateVetoSignals({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            signals: {}, scoreInput: 0.72
        });
        expect(r.decision).toBe('PROCEED');
        expect(r.blockers).toEqual([]);
        expect(r.penalties).toEqual([]);
        expect(r.scoreAdjusted).toBeCloseTo(0.72);
    });

    test('single BLOCK signal → BLOCK decision', () => {
        const r = cr.evaluateVetoSignals({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            signals: { execution_unsafe: true }, scoreInput: 0.85
        });
        expect(r.decision).toBe('BLOCK');
        expect(r.blockers).toContain('execution_unsafe');
        expect(r.winningSignal).toBe('execution_unsafe');
    });

    test('single PENALTY signal → PENALIZED decision (score reduced)', () => {
        const r = cr.evaluateVetoSignals({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            signals: { spread_excessive: true }, scoreInput: 0.80
        });
        expect(r.decision).toBe('PENALIZED');
        expect(r.penalties).toContain('spread_excessive');
        expect(r.scoreAdjusted).toBeLessThan(0.80);
        expect(r.scoreAdjusted).toBeGreaterThanOrEqual(0);
    });

    test('multiple PENALTY signals compound score reduction', () => {
        const r1 = cr.evaluateVetoSignals({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            signals: { spread_excessive: true }, scoreInput: 0.90
        });
        const r2 = cr.evaluateVetoSignals({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            signals: { spread_excessive: true, slippage_estimate_high: true }, scoreInput: 0.90
        });
        expect(r2.scoreAdjusted).toBeLessThan(r1.scoreAdjusted);
    });

    test('BLOCK overrides PENALTY (mixed signals → BLOCK)', () => {
        const r = cr.evaluateVetoSignals({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            signals: {
                spread_excessive: true,        // PENALTY
                execution_unsafe: true         // BLOCK
            }, scoreInput: 0.90
        });
        expect(r.decision).toBe('BLOCK');
        expect(r.blockers).toContain('execution_unsafe');
    });

    test('BLOCK decision returns scoreAdjusted=0', () => {
        const r = cr.evaluateVetoSignals({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            signals: { drawdown_limit_reached: true }, scoreInput: 0.95
        });
        expect(r.scoreAdjusted).toBe(0);
    });
});

describe('§14 evaluateVetoSignals — authority hierarchy', () => {
    test('safety_veto (drawdown_limit) wins over execution-class blocker', () => {
        const r = cr.evaluateVetoSignals({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            signals: {
                execution_unsafe: true,        // execution
                drawdown_limit_reached: true   // safety_veto
            }, scoreInput: 0.85
        });
        expect(r.winningSignal).toBe('drawdown_limit_reached');
        expect(r.winningHierarchy).toBe('safety_veto');
    });

    test('reconciliation_failed beats macro_red_flag when both active', () => {
        const r = cr.evaluateVetoSignals({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            signals: {
                macro_red_flag: true,
                reconciliation_failed: true
            }, scoreInput: 0.80
        });
        expect(r.winningSignal).toBe('reconciliation_failed');
        expect(r.winningHierarchy).toBe('reconciliation');
    });

    test('hierarchy order: safety > reconciliation > macro > execution > portfolio > data_health', () => {
        const hierLevel = cr.AUTHORITY_HIERARCHY;
        const idxSafety = hierLevel.indexOf('safety_veto');
        const idxRecon = hierLevel.indexOf('reconciliation');
        const idxMacro = hierLevel.indexOf('macro_red_flag');
        const idxExec = hierLevel.indexOf('execution');
        const idxPortfolio = hierLevel.indexOf('portfolio_risk');
        const idxData = hierLevel.indexOf('data_health');
        expect(idxSafety).toBeLessThan(idxRecon);
        expect(idxRecon).toBeLessThan(idxMacro);
        expect(idxMacro).toBeLessThan(idxExec);
        expect(idxExec).toBeLessThan(idxPortfolio);
        expect(idxPortfolio).toBeLessThan(idxData);
    });
});

describe('§14 evaluateVetoSignals — audit logging', () => {
    test('logs row to ml_veto_log on BLOCK', () => {
        cr.evaluateVetoSignals({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            signals: { execution_unsafe: true }, scoreInput: 0.80
        });
        const rows = db.prepare(`SELECT * FROM ml_veto_log WHERE user_id = ?`).all(TEST_USER);
        expect(rows).toHaveLength(1);
        expect(rows[0].decision).toBe('BLOCK');
        expect(rows[0].winning_signal).toBe('execution_unsafe');
    });

    test('logs row to ml_veto_log on PENALIZED', () => {
        cr.evaluateVetoSignals({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            signals: { spread_excessive: true }, scoreInput: 0.80
        });
        const rows = db.prepare(`SELECT * FROM ml_veto_log WHERE user_id = ?`).all(TEST_USER);
        expect(rows).toHaveLength(1);
        expect(rows[0].decision).toBe('PENALIZED');
    });

    test('logs row to ml_veto_log on PROCEED (with no blockers/penalties)', () => {
        cr.evaluateVetoSignals({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            signals: {}, scoreInput: 0.80
        });
        const rows = db.prepare(`SELECT * FROM ml_veto_log WHERE user_id = ?`).all(TEST_USER);
        expect(rows).toHaveLength(1);
        expect(rows[0].decision).toBe('PROCEED');
    });

    test('audit row contains JSON serialized blockers + penalties + context', () => {
        cr.evaluateVetoSignals({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            signals: { spread_excessive: true, slippage_estimate_high: true },
            scoreInput: 0.85,
            context: { symbol: 'BTCUSDT', side: 'LONG' }
        });
        const row = db.prepare(`SELECT * FROM ml_veto_log WHERE user_id = ?`).get(TEST_USER);
        const blockers = JSON.parse(row.blockers_json);
        const penalties = JSON.parse(row.penalties_json);
        const ctx = JSON.parse(row.context_json);
        expect(blockers).toEqual([]);
        expect(penalties).toEqual(expect.arrayContaining(['spread_excessive', 'slippage_estimate_high']));
        expect(ctx).toEqual({ symbol: 'BTCUSDT', side: 'LONG' });
    });
});

describe('§14 evaluateVetoSignals — validation', () => {
    test('throws on missing userId', () => {
        expect(() => cr.evaluateVetoSignals({
            resolvedEnv: TEST_ENV, signals: {}, scoreInput: 0.5
        })).toThrow(/userId/);
    });

    test('throws on missing resolvedEnv', () => {
        expect(() => cr.evaluateVetoSignals({
            userId: TEST_USER, signals: {}, scoreInput: 0.5
        })).toThrow(/resolvedEnv/);
    });

    test('throws on missing scoreInput', () => {
        expect(() => cr.evaluateVetoSignals({
            userId: TEST_USER, resolvedEnv: TEST_ENV, signals: {}
        })).toThrow(/scoreInput/);
    });

    test('unknown signal key is ignored (forward-compat)', () => {
        const r = cr.evaluateVetoSignals({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            signals: { bogus_signal: true }, scoreInput: 0.50
        });
        expect(r.decision).toBe('PROCEED');
    });

    test('signal value falsy is treated as inactive', () => {
        const r = cr.evaluateVetoSignals({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            signals: { execution_unsafe: false, spread_excessive: 0 },
            scoreInput: 0.60
        });
        expect(r.decision).toBe('PROCEED');
    });
});

describe('§14 isolation', () => {
    test('per (user × env) isolation in queries', () => {
        const OTHER_USER = 9115;
        cr.evaluateVetoSignals({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            signals: { spread_excessive: true }, scoreInput: 0.80
        });
        cr.evaluateVetoSignals({
            userId: OTHER_USER, resolvedEnv: TEST_ENV,
            signals: { execution_unsafe: true }, scoreInput: 0.80
        });
        const myRows = db.prepare(`SELECT * FROM ml_veto_log WHERE user_id = ?`).all(TEST_USER);
        const otherRows = db.prepare(`SELECT * FROM ml_veto_log WHERE user_id = ?`).all(OTHER_USER);
        expect(myRows).toHaveLength(1);
        expect(otherRows).toHaveLength(1);
        expect(myRows[0].decision).toBe('PENALIZED');
        expect(otherRows[0].decision).toBe('BLOCK');
        db.prepare(`DELETE FROM ml_veto_log WHERE user_id = ?`).run(OTHER_USER);
    });
});
