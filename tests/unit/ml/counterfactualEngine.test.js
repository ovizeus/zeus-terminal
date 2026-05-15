'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p42-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const cf = require('../../../server/services/ml/R5A_learning/counterfactualEngine');

const TEST_USER = 9042;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_counterfactual_runs WHERE user_id = ?').run(TEST_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§42 Migration 098', () => {
    test('table ml_counterfactual_runs exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_counterfactual_runs'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_counterfactual_runs)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'trade_id', 'param_type',
            'actual_value', 'alt_value', 'actual_pnl', 'alt_pnl',
            'would_have_hit_sl', 'would_have_hit_tp', 'improvement', 'created_at'
        ]));
    });

    test('CHECK param_type restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_counterfactual_runs
             (user_id, resolved_env, trade_id, param_type,
              actual_value, alt_value, actual_pnl, alt_pnl,
              would_have_hit_sl, would_have_hit_tp, improvement, created_at)
             VALUES (?, ?, ?, 'BOGUS', 100, 100, 0, 0, 0, 0, 0, ?)`
        ).run(TEST_USER, TEST_ENV, 'T1', Date.now())).toThrow();
    });

    test('CHECK resolved_env restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_counterfactual_runs
             (user_id, resolved_env, trade_id, param_type,
              actual_value, alt_value, actual_pnl, alt_pnl,
              would_have_hit_sl, would_have_hit_tp, improvement, created_at)
             VALUES (?, 'BOGUS', ?, 'sl', 100, 100, 0, 0, 0, 0, 0, ?)`
        ).run(TEST_USER, 'T1', Date.now())).toThrow();
    });
});

describe('§42 Exported constants', () => {
    test('PARAM_TYPES has entry/sl/size/tp', () => {
        expect(cf.PARAM_TYPES).toEqual(expect.arrayContaining(['entry', 'sl', 'size', 'tp']));
    });

    test('MIN_TRADES_FOR_RECOMMENDATION positive', () => {
        expect(cf.MIN_TRADES_FOR_RECOMMENDATION).toBeGreaterThan(0);
    });

    test('RECOMMENDATION_CONFIDENCE_THRESHOLD in (0,1)', () => {
        expect(cf.RECOMMENDATION_CONFIDENCE_THRESHOLD).toBeGreaterThan(0);
        expect(cf.RECOMMENDATION_CONFIDENCE_THRESHOLD).toBeLessThan(1);
    });
});

describe('§42 runCounterfactual — LONG winning trade', () => {
    test('actual SL held; tighter alt SL would have triggered (loss)', () => {
        // LONG entry 98200, SL 96800, TP 100000, size 1
        // Price path: dips to 97100 then rises to 100000 (actual TP hit).
        // Alt SL at 97400 would have triggered.
        const r = cf.runCounterfactual({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradeId: 'T_LONG_WIN',
            side: 'LONG',
            actual: { entry: 98200, sl: 96800, tp: 100000, size: 1 },
            actualPnl: 1800,  // (100000 - 98200) * 1
            pricePath: [98000, 97500, 97100, 97800, 98500, 99200, 100000],
            alternatives: [
                { paramType: 'sl', value: 97400 }
            ]
        });
        expect(r.ran).toBe(1);
        expect(r.results[0].wouldHitSL).toBe(true);
        expect(r.results[0].altPnl).toBeLessThan(0);
        expect(r.results[0].improvement).toBeLessThan(0);
    });

    test('looser alt SL also reaches TP, same outcome', () => {
        const r = cf.runCounterfactual({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradeId: 'T_LONG_WIN_2',
            side: 'LONG',
            actual: { entry: 98200, sl: 96800, tp: 100000, size: 1 },
            actualPnl: 1800,
            pricePath: [98000, 97500, 97100, 97800, 98500, 99200, 100000],
            alternatives: [
                { paramType: 'sl', value: 96000 }  // looser SL never triggered
            ]
        });
        expect(r.results[0].wouldHitTP).toBe(true);
        expect(r.results[0].altPnl).toBeCloseTo(1800);
        expect(r.results[0].improvement).toBeCloseTo(0);
    });
});

describe('§42 runCounterfactual — SHORT trade', () => {
    test('SHORT side simulates correctly with wick', () => {
        // SHORT: entry=100, SL=105 (above), TP=90 (below). Actual path includes
        // a wick to 103 before going down. Tighter SL=102 would have triggered
        // on the 103 wick.
        const r = cf.runCounterfactual({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradeId: 'T_SHORT_1',
            side: 'SHORT',
            actual: { entry: 100, sl: 105, tp: 90, size: 1 },
            actualPnl: 10,  // (100 - 90) * 1
            pricePath: [100, 103, 99, 95, 92, 90],
            alternatives: [
                { paramType: 'sl', value: 102 }  // tighter SHORT SL
            ]
        });
        expect(r.results[0].wouldHitSL).toBe(true);
        expect(r.results[0].altPnl).toBeLessThan(0);  // (100 - 102) * 1 = -2
    });
});

describe('§42 runCounterfactual — size alternative', () => {
    test('larger size scales PnL linearly', () => {
        const r = cf.runCounterfactual({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradeId: 'T_SIZE',
            side: 'LONG',
            actual: { entry: 100, sl: 95, tp: 110, size: 1 },
            actualPnl: 10,
            pricePath: [100, 102, 105, 108, 110],
            alternatives: [
                { paramType: 'size', value: 2 }
            ]
        });
        expect(r.results[0].wouldHitTP).toBe(true);
        expect(r.results[0].altPnl).toBeCloseTo(20);
        expect(r.results[0].improvement).toBeCloseTo(10);
    });

    test('halved size halves PnL', () => {
        const r = cf.runCounterfactual({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradeId: 'T_SIZE_HALF',
            side: 'LONG',
            actual: { entry: 100, sl: 95, tp: 110, size: 2 },
            actualPnl: 20,
            pricePath: [100, 102, 105, 108, 110],
            alternatives: [
                { paramType: 'size', value: 1 }
            ]
        });
        expect(r.results[0].altPnl).toBeCloseTo(10);
        expect(r.results[0].improvement).toBeCloseTo(-10);
    });
});

describe('§42 runCounterfactual — multiple alternatives same call', () => {
    test('processes multiple alts in single call', () => {
        const r = cf.runCounterfactual({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradeId: 'T_MULTI',
            side: 'LONG',
            actual: { entry: 100, sl: 95, tp: 110, size: 1 },
            actualPnl: 10,
            pricePath: [100, 102, 105, 108, 110],
            alternatives: [
                { paramType: 'sl', value: 90 },
                { paramType: 'tp', value: 105 },
                { paramType: 'size', value: 3 }
            ]
        });
        expect(r.ran).toBe(3);
        expect(r.results).toHaveLength(3);
        // Verify DB persistence
        const stored = db.prepare(
            `SELECT * FROM ml_counterfactual_runs WHERE trade_id = 'T_MULTI'`
        ).all();
        expect(stored).toHaveLength(3);
    });
});

describe('§42 runCounterfactual — validation', () => {
    test('throws on invalid side', () => {
        expect(() => cf.runCounterfactual({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradeId: 'T_BAD',
            side: 'BOGUS',
            actual: { entry: 100, sl: 95, tp: 110, size: 1 },
            actualPnl: 0,
            pricePath: [100, 110],
            alternatives: [{ paramType: 'sl', value: 90 }]
        })).toThrow(/side/i);
    });

    test('throws on invalid paramType', () => {
        expect(() => cf.runCounterfactual({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradeId: 'T_BAD2',
            side: 'LONG',
            actual: { entry: 100, sl: 95, tp: 110, size: 1 },
            actualPnl: 0,
            pricePath: [100, 110],
            alternatives: [{ paramType: 'leverage', value: 5 }]
        })).toThrow(/paramType/i);
    });

    test('throws on empty pricePath', () => {
        expect(() => cf.runCounterfactual({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradeId: 'T_BAD3',
            side: 'LONG',
            actual: { entry: 100, sl: 95, tp: 110, size: 1 },
            actualPnl: 0,
            pricePath: [],
            alternatives: [{ paramType: 'sl', value: 90 }]
        })).toThrow(/pricePath/i);
    });
});

describe('§42 recordCounterfactualResult', () => {
    test('records and computes improvement', () => {
        const r = cf.recordCounterfactualResult({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradeId: 'T_REC',
            paramType: 'entry',
            actualValue: 100, altValue: 99,
            actualPnl: 10, altPnl: 11,
            wouldHitSL: false, wouldHitTP: true
        });
        expect(r.recorded).toBe(true);
        expect(r.improvement).toBeCloseTo(1);
        const rows = db.prepare(
            `SELECT * FROM ml_counterfactual_runs WHERE trade_id = 'T_REC'`
        ).all();
        expect(rows).toHaveLength(1);
    });
});

describe('§42 getParameterDriftRecommendations', () => {
    test('returns insufficient when below threshold', () => {
        for (let i = 0; i < 5; i++) {
            cf.recordCounterfactualResult({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                tradeId: `T_R${i}`,
                paramType: 'sl',
                actualValue: 100, altValue: 99,
                actualPnl: 10, altPnl: 12,
                wouldHitSL: false, wouldHitTP: true
            });
        }
        const r = cf.getParameterDriftRecommendations({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.sufficient).toBe(false);
    });

    test('returns recommendations when sufficient + confident', () => {
        // 25 SL alts, 20 positive improvements (80% > 60% threshold)
        for (let i = 0; i < 25; i++) {
            cf.recordCounterfactualResult({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                tradeId: `T_S${i}`,
                paramType: 'sl',
                actualValue: 100, altValue: 99,
                actualPnl: 10,
                altPnl: i < 20 ? 15 : 5,  // 20 positive, 5 negative
                wouldHitSL: false, wouldHitTP: true
            });
        }
        const r = cf.getParameterDriftRecommendations({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.sufficient).toBe(true);
        expect(r.recommendations.length).toBeGreaterThan(0);
        const slRec = r.recommendations.find(x => x.paramType === 'sl');
        expect(slRec).toBeTruthy();
        expect(slRec.confident).toBe(true);
        expect(slRec.recommendation).toBeTruthy();
    });

    test('marks not confident when positive rate below threshold', () => {
        // 25 entries, only 10 positive (40% < 60% threshold)
        for (let i = 0; i < 25; i++) {
            cf.recordCounterfactualResult({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                tradeId: `T_E${i}`,
                paramType: 'entry',
                actualValue: 100, altValue: 99,
                actualPnl: 10,
                altPnl: i < 10 ? 12 : 8,
                wouldHitSL: false, wouldHitTP: true
            });
        }
        const r = cf.getParameterDriftRecommendations({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const entryRec = r.recommendations.find(x => x.paramType === 'entry');
        expect(entryRec.confident).toBe(false);
        expect(entryRec.recommendation).toBe(null);
    });
});

describe('§42 getCounterfactualHistory', () => {
    test('returns runs ordered desc by ts', () => {
        const now = Date.now();
        cf.recordCounterfactualResult({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradeId: 'T_H1', paramType: 'sl',
            actualValue: 100, altValue: 99, actualPnl: 10, altPnl: 12,
            wouldHitSL: false, wouldHitTP: true, ts: now - 1000
        });
        cf.recordCounterfactualResult({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradeId: 'T_H2', paramType: 'tp',
            actualValue: 110, altValue: 105, actualPnl: 10, altPnl: 5,
            wouldHitSL: false, wouldHitTP: true, ts: now
        });
        const h = cf.getCounterfactualHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(h).toHaveLength(2);
        expect(h[0].tradeId).toBe('T_H2');
        expect(h[1].tradeId).toBe('T_H1');
    });
});

describe('§42 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9043;
        cf.recordCounterfactualResult({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            tradeId: 'T_ISO',
            paramType: 'sl',
            actualValue: 100, altValue: 99, actualPnl: 10, altPnl: 12,
            wouldHitSL: false, wouldHitTP: true
        });
        const h1 = cf.getCounterfactualHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const h2 = cf.getCounterfactualHistory({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(h1.length).toBe(1);
        expect(h2.length).toBe(0);
    });
});
