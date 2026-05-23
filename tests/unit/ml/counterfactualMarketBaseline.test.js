'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p76-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const cb = require('../../../server/services/ml/R5A_learning/counterfactualMarketBaseline');

const TEST_USER = 9076;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_inactivity_baseline_snapshots WHERE user_id IN (?, ?)').run(TEST_USER, 9077);
    db.prepare('DELETE FROM ml_alpha_observations WHERE user_id IN (?, ?)').run(TEST_USER, 9077);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§76 Migrations 142 + 143', () => {
    test('ml_inactivity_baseline_snapshots exists', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_inactivity_baseline_snapshots)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'asset', 'hodl_quantity', 'mark_price',
            'hodl_value', 'initial_value', 'ts', 'last_updated'
        ]));
    });

    test('baseline UNIQUE per (user, env, asset)', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_inactivity_baseline_snapshots
             (user_id, resolved_env, asset, hodl_quantity, mark_price,
              hodl_value, initial_value, ts, last_updated)
             VALUES (?, ?, 'BTC', 1, 100, 100, 100, ?, ?)`
        ).run(TEST_USER, TEST_ENV, ts, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_inactivity_baseline_snapshots
             (user_id, resolved_env, asset, hodl_quantity, mark_price,
              hodl_value, initial_value, ts, last_updated)
             VALUES (?, ?, 'BTC', 2, 200, 400, 200, ?, ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1, ts + 1)).toThrow();
    });

    test('CHECK market_regime restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_alpha_observations
             (user_id, resolved_env, period_id, asset, bot_pnl,
              baseline_pnl, alpha_real, alpha_pct, market_regime, ts)
             VALUES (?, ?, 'P', 'BTC', 100, 50, 50, 5, 'BOGUS', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§76 Constants', () => {
    test('MARKET_REGIMES has 5 entries', () => {
        expect(cb.MARKET_REGIMES).toEqual([
            'bull', 'bear', 'range', 'high_vol', 'low_vol'
        ]);
    });

    test('ALPHA_SIGNIFICANT_THRESHOLD_PCT positive', () => {
        expect(cb.ALPHA_SIGNIFICANT_THRESHOLD_PCT).toBeGreaterThan(0);
    });
});

describe('§76 initializeBaseline', () => {
    test('persists with computed initial_value', () => {
        const r = cb.initializeBaseline({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            asset: 'BTC',
            initialQuantity: 2, initialPrice: 50000
        });
        expect(r.initialized).toBe(true);
        expect(r.initialValue).toBe(100000);

        const current = cb.getCurrentBaselineValue({
            userId: TEST_USER, resolvedEnv: TEST_ENV, asset: 'BTC'
        });
        expect(current.hodlValue).toBe(100000);
    });

    test('throws on non-positive quantity', () => {
        expect(() => cb.initializeBaseline({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            asset: 'BTC',
            initialQuantity: 0, initialPrice: 50000
        })).toThrow();
    });
});

describe('§76 recordBaselineSnapshot', () => {
    test('updates HODL value at new mark', () => {
        cb.initializeBaseline({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            asset: 'BTC', initialQuantity: 1, initialPrice: 50000
        });
        const r = cb.recordBaselineSnapshot({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            asset: 'BTC', markPrice: 60000
        });
        expect(r.newValue).toBe(60000);
        expect(r.baselinePnl).toBe(10000);
    });

    test('throws if baseline not initialized', () => {
        expect(() => cb.recordBaselineSnapshot({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            asset: 'NEW', markPrice: 100
        })).toThrow();
    });
});

describe('§76 computeAlphaVsBaseline', () => {
    test('positive alpha: bot outperformed HODL', () => {
        cb.initializeBaseline({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            asset: 'BTC', initialQuantity: 1, initialPrice: 50000
        });
        cb.recordBaselineSnapshot({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            asset: 'BTC', markPrice: 51500  // HODL pnl = 1500
        });
        const r = cb.computeAlphaVsBaseline({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            asset: 'BTC', currentBotPnl: 2500  // bot did better
        });
        expect(r.positiveAlpha).toBe(true);
        expect(r.alphaReal).toBeCloseTo(1000);
    });

    test('negative alpha: bot underperformed HODL', () => {
        cb.initializeBaseline({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            asset: 'BTC', initialQuantity: 1, initialPrice: 50000
        });
        cb.recordBaselineSnapshot({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            asset: 'BTC', markPrice: 53000  // HODL pnl = 3000
        });
        const r = cb.computeAlphaVsBaseline({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            asset: 'BTC', currentBotPnl: 2000  // bot did worse
        });
        expect(r.positiveAlpha).toBe(false);
        expect(r.alphaReal).toBeCloseTo(-1000);
    });

    test('zero alpha when matched', () => {
        cb.initializeBaseline({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            asset: 'BTC', initialQuantity: 1, initialPrice: 50000
        });
        cb.recordBaselineSnapshot({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            asset: 'BTC', markPrice: 51000
        });
        const r = cb.computeAlphaVsBaseline({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            asset: 'BTC', currentBotPnl: 1000
        });
        expect(r.alphaReal).toBeCloseTo(0);
    });

    test('significant flag triggers when |alphaPct| >= 5%', () => {
        cb.initializeBaseline({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            asset: 'BTC', initialQuantity: 1, initialPrice: 1000
        });
        cb.recordBaselineSnapshot({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            asset: 'BTC', markPrice: 1000  // HODL pnl = 0
        });
        const r = cb.computeAlphaVsBaseline({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            asset: 'BTC', currentBotPnl: 80  // 8% alpha
        });
        expect(r.alphaPct).toBeCloseTo(8);
        expect(r.significantAlpha).toBe(true);
    });

    test('returns sufficient=false when no baseline', () => {
        const r = cb.computeAlphaVsBaseline({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            asset: 'UNSEEN', currentBotPnl: 100
        });
        expect(r.sufficient).toBe(false);
    });
});

describe('§76 recordAlphaObservation', () => {
    test('persists observation', () => {
        cb.initializeBaseline({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            asset: 'BTC', initialQuantity: 1, initialPrice: 50000
        });
        cb.recordAlphaObservation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            periodId: 'P-001', asset: 'BTC',
            botPnl: 1000, baselinePnl: 500,
            marketRegime: 'bull'
        });
        const rows = db.prepare(
            `SELECT * FROM ml_alpha_observations WHERE period_id = 'P-001'`
        ).all();
        expect(rows).toHaveLength(1);
        expect(rows[0].alpha_real).toBeCloseTo(500);
    });

    test('throws on invalid market_regime', () => {
        expect(() => cb.recordAlphaObservation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            periodId: 'P-BAD', asset: 'BTC',
            botPnl: 100, baselinePnl: 50,
            marketRegime: 'BOGUS'
        })).toThrow();
    });
});

describe('§76 getAlphaSummary', () => {
    test('aggregates percentiles', () => {
        cb.initializeBaseline({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            asset: 'BTC', initialQuantity: 1, initialPrice: 1000
        });
        for (let i = 0; i < 10; i++) {
            cb.recordAlphaObservation({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                periodId: `P-${i}`, asset: 'BTC',
                botPnl: 100 + i * 10, baselinePnl: 50,
                marketRegime: 'bull'
            });
        }
        const s = cb.getAlphaSummary({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(s.samples).toBe(10);
        expect(s.avgAlphaPct).toBeGreaterThan(0);
        expect(s.p25AlphaPct).toBeLessThan(s.p75AlphaPct);
    });
});

describe('§76 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9077;
        cb.initializeBaseline({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            asset: 'BTC', initialQuantity: 1, initialPrice: 50000
        });
        const r1 = cb.getCurrentBaselineValue({
            userId: TEST_USER, resolvedEnv: TEST_ENV, asset: 'BTC'
        });
        const r2 = cb.getCurrentBaselineValue({
            userId: OTHER_USER, resolvedEnv: TEST_ENV, asset: 'BTC'
        });
        expect(r1.exists).toBe(true);
        expect(r2.exists).toBe(false);
    });
});
