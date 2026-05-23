'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p67-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const cp = require('../../../server/services/ml/R5A_learning/conformalPrediction');

const TEST_USER = 9067;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_conformal_calibration WHERE user_id IN (?, ?)').run(TEST_USER, 9068);
    db.prepare('DELETE FROM ml_conformal_decisions WHERE user_id IN (?, ?)').run(TEST_USER, 9068);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§67 Migrations 125 + 126', () => {
    test('ml_conformal_calibration exists', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_conformal_calibration)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'user_id', 'resolved_env', 'trading_mode', 'regime_type',
            'coverage_target', 'calibration_scores_json',
            'n_calibration_samples', 'last_updated'
        ]));
    });

    test('CHECK trading_mode restricts', () => {
        const ts = Date.now();
        expect(() => db.prepare(
            `INSERT INTO ml_conformal_calibration
             (user_id, resolved_env, trading_mode, regime_type,
              coverage_target, calibration_scores_json,
              n_calibration_samples, last_updated)
             VALUES (?, ?, 'BOGUS', 'range', 0.9, '[]', 0, ?)`
        ).run(TEST_USER, TEST_ENV, ts)).toThrow();
    });

    test('CHECK decision_action restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_conformal_decisions
             (user_id, resolved_env, decision_id, trading_mode, regime_type,
              prediction_set_size, conformal_score, coverage_target,
              in_coverage_zone, decision_action, ts)
             VALUES (?, ?, 'D1', 'scalp', 'range', 1, 0.1, 0.9, 1, 'BOGUS', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§67 Constants', () => {
    test('TRADING_MODES has 4 entries', () => {
        expect(cp.TRADING_MODES).toEqual(['scalp', 'intraday', 'swing', 'news_risk']);
    });

    test('DECISION_ACTIONS has 3 entries', () => {
        expect(cp.DECISION_ACTIONS).toEqual(['TRADE', 'NO_TRADE', 'WAIT']);
    });

    test('DEFAULT_COVERAGE_TARGET in (0,1)', () => {
        expect(cp.DEFAULT_COVERAGE_TARGET).toBeGreaterThan(0);
        expect(cp.DEFAULT_COVERAGE_TARGET).toBeLessThan(1);
    });
});

describe('§67 updateCalibrationSet', () => {
    test('builds sorted scores incrementally', () => {
        for (const s of [0.3, 0.1, 0.5, 0.2, 0.4]) {
            cp.updateCalibrationSet({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                tradingMode: 'scalp', regimeType: 'range',
                newScore: s
            });
        }
        const state = cp.getCalibrationState({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradingMode: 'scalp', regimeType: 'range'
        });
        expect(state.samples).toBe(5);
    });

    test('throws on invalid tradingMode', () => {
        expect(() => cp.updateCalibrationSet({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradingMode: 'BOGUS', regimeType: 'range', newScore: 0.5
        })).toThrow();
    });

    test('throws on negative newScore', () => {
        expect(() => cp.updateCalibrationSet({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradingMode: 'scalp', regimeType: 'range', newScore: -0.1
        })).toThrow();
    });
});

describe('§67 evaluateConformalCoverage', () => {
    function seedCalibration(samples) {
        for (const s of samples) {
            cp.updateCalibrationSet({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                tradingMode: 'scalp', regimeType: 'range',
                newScore: s
            });
        }
    }

    test('insufficient samples → NO_TRADE', () => {
        seedCalibration([0.1, 0.2, 0.3]);  // < 30
        const r = cp.evaluateConformalCoverage({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradingMode: 'scalp', regimeType: 'range',
            predictionScore: 0.15, predictionSetSize: 1
        });
        expect(r.action).toBe('NO_TRADE');
        expect(r.reason).toMatch(/insufficient/i);
    });

    test('in coverage zone + small prediction set → TRADE', () => {
        // 30 samples 0.01..0.30, prediction 0.15 should be in 90% coverage zone
        const samples = [];
        for (let i = 1; i <= 30; i++) samples.push(i / 100);
        seedCalibration(samples);
        const r = cp.evaluateConformalCoverage({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradingMode: 'scalp', regimeType: 'range',
            predictionScore: 0.05, predictionSetSize: 1
        });
        expect(r.inCoverageZone).toBe(true);
        expect(r.action).toBe('TRADE');
    });

    test('outside coverage zone → NO_TRADE', () => {
        const samples = [];
        for (let i = 1; i <= 30; i++) samples.push(i / 100);
        seedCalibration(samples);
        const r = cp.evaluateConformalCoverage({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradingMode: 'scalp', regimeType: 'range',
            predictionScore: 0.50, predictionSetSize: 1  // well above 90% quantile (0.27)
        });
        expect(r.inCoverageZone).toBe(false);
        expect(r.action).toBe('NO_TRADE');
    });

    test('large prediction set → WAIT or NO_TRADE', () => {
        const samples = [];
        for (let i = 1; i <= 30; i++) samples.push(i / 100);
        seedCalibration(samples);
        const r = cp.evaluateConformalCoverage({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradingMode: 'scalp', regimeType: 'range',
            predictionScore: 0.05, predictionSetSize: 2
        });
        expect(r.action).toBe('WAIT');
    });

    test('very large prediction set → NO_TRADE', () => {
        const samples = [];
        for (let i = 1; i <= 30; i++) samples.push(i / 100);
        seedCalibration(samples);
        const r = cp.evaluateConformalCoverage({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradingMode: 'scalp', regimeType: 'range',
            predictionScore: 0.05, predictionSetSize: 5
        });
        expect(r.action).toBe('NO_TRADE');
    });
});

describe('§67 setCoverageTarget', () => {
    test('configures target', () => {
        const r = cp.setCoverageTarget({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradingMode: 'swing', regimeType: 'trend_up',
            target: 0.95
        });
        expect(r.configured).toBe(true);
        const state = cp.getCalibrationState({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradingMode: 'swing', regimeType: 'trend_up'
        });
        expect(state.coverageTarget).toBe(0.95);
    });

    test('throws on out-of-range target', () => {
        expect(() => cp.setCoverageTarget({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradingMode: 'swing', regimeType: 'trend_up',
            target: 1.5
        })).toThrow();
        expect(() => cp.setCoverageTarget({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradingMode: 'swing', regimeType: 'trend_up',
            target: 0
        })).toThrow();
    });
});

describe('§67 recordConformalDecision', () => {
    test('persists decision row', () => {
        cp.recordConformalDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'D-001',
            tradingMode: 'intraday', regimeType: 'range',
            predictionSetSize: 1, conformalScore: 0.15,
            coverageTarget: 0.90, inCoverageZone: true,
            decisionAction: 'TRADE'
        });
        const rows = db.prepare(
            `SELECT * FROM ml_conformal_decisions WHERE user_id = ?`
        ).all(TEST_USER);
        expect(rows).toHaveLength(1);
        expect(rows[0].decision_action).toBe('TRADE');
    });

    test('throws on invalid action', () => {
        expect(() => cp.recordConformalDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'D-X',
            tradingMode: 'scalp', regimeType: 'range',
            predictionSetSize: 1, conformalScore: 0.1,
            coverageTarget: 0.9, inCoverageZone: true,
            decisionAction: 'BOGUS'
        })).toThrow();
    });
});

describe('§67 getCoverageStatsByRegime', () => {
    test('groups by regime + computes actual coverage', () => {
        for (let i = 0; i < 5; i++) {
            cp.recordConformalDecision({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                decisionId: `R${i}`,
                tradingMode: 'scalp', regimeType: 'range',
                predictionSetSize: 1, conformalScore: 0.1,
                coverageTarget: 0.9, inCoverageZone: i < 4,
                decisionAction: i < 4 ? 'TRADE' : 'NO_TRADE'
            });
        }
        for (let i = 0; i < 3; i++) {
            cp.recordConformalDecision({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                decisionId: `T${i}`,
                tradingMode: 'scalp', regimeType: 'trend_up',
                predictionSetSize: 1, conformalScore: 0.05,
                coverageTarget: 0.9, inCoverageZone: true,
                decisionAction: 'TRADE'
            });
        }
        const stats = cp.getCoverageStatsByRegime({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradingMode: 'scalp'
        });
        expect(stats.length).toBe(2);
        const range = stats.find(s => s.regimeType === 'range');
        expect(range.total).toBe(5);
        expect(range.actualCoveragePct).toBeCloseTo(0.80);
    });
});

describe('§67 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9068;
        cp.updateCalibrationSet({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradingMode: 'scalp', regimeType: 'range', newScore: 0.1
        });
        const s1 = cp.getCalibrationState({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradingMode: 'scalp', regimeType: 'range'
        });
        const s2 = cp.getCalibrationState({
            userId: OTHER_USER, resolvedEnv: TEST_ENV,
            tradingMode: 'scalp', regimeType: 'range'
        });
        expect(s1.exists).toBe(true);
        expect(s2.exists).toBe(false);
    });

    test('regime isolation within same user', () => {
        cp.updateCalibrationSet({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradingMode: 'scalp', regimeType: 'range', newScore: 0.1
        });
        const s1 = cp.getCalibrationState({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradingMode: 'scalp', regimeType: 'range'
        });
        const s2 = cp.getCalibrationState({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradingMode: 'scalp', regimeType: 'trend_up'
        });
        expect(s1.exists).toBe(true);
        expect(s2.exists).toBe(false);
    });
});
