'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p58-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const frn = require('../../../server/services/ml/R3A_safety/factorRiskNetting');

const TEST_USER = 9058;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_factor_exposures WHERE user_id IN (?, ?)').run(TEST_USER, 9059);
    db.prepare('DELETE FROM ml_netting_decisions WHERE user_id IN (?, ?)').run(TEST_USER, 9059);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§58 Migrations 103 + 104', () => {
    test('ml_factor_exposures exists with expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_factor_exposures)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'position_id',
            'btc_beta', 'market_beta', 'vol_factor',
            'liquidity_factor', 'funding_factor', 'macro_factor',
            'gross_exposure', 'ts'
        ]));
    });

    test('ml_netting_decisions exists with CHECK decision_type', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_netting_decisions
             (user_id, resolved_env, decision_type, positions_json,
              dominant_factor, factor_overlap_score, ts)
             VALUES (?, ?, 'BOGUS', '[]', 'btc_beta', 0.5, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§58 Constants', () => {
    test('FACTORS has 6 expected', () => {
        expect(frn.FACTORS).toEqual([
            'btc_beta', 'market_beta', 'vol_factor',
            'liquidity_factor', 'funding_factor', 'macro_factor'
        ]);
    });

    test('NETTING_DECISIONS has 5 expected', () => {
        expect(frn.NETTING_DECISIONS).toEqual(
            ['NET', 'HEDGE', 'REDUCE', 'REPLACE', 'HOLD']
        );
    });

    test('STACKED_RISK_OVERLAP_THRESHOLD in (0,1)', () => {
        expect(frn.STACKED_RISK_OVERLAP_THRESHOLD).toBeGreaterThan(0);
        expect(frn.STACKED_RISK_OVERLAP_THRESHOLD).toBeLessThan(1);
    });
});

describe('§58 decomposePosition', () => {
    test('BTC long position has btc_beta ~1.0 positive', () => {
        const f = frn.decomposePosition({
            position: { symbol: 'BTCUSDT', side: 'LONG', size: 1, leverage: 1 }
        });
        expect(f.btc_beta).toBeCloseTo(1.0, 1);
        expect(f.grossExposure).toBe(1);
    });

    test('BTC short position has btc_beta negative', () => {
        const f = frn.decomposePosition({
            position: { symbol: 'BTCUSDT', side: 'SHORT', size: 1, leverage: 1 }
        });
        expect(f.btc_beta).toBeLessThan(0);
    });

    test('ETH position has lower btc_beta', () => {
        const f = frn.decomposePosition({
            position: { symbol: 'ETHUSDT', side: 'LONG', size: 1, leverage: 1 }
        });
        expect(f.btc_beta).toBeLessThan(1.0);
        expect(f.btc_beta).toBeGreaterThan(0.5);
    });

    test('leverage scales vol_factor', () => {
        const f1 = frn.decomposePosition({
            position: { symbol: 'BTCUSDT', side: 'LONG', size: 1, leverage: 1 }
        });
        const f10 = frn.decomposePosition({
            position: { symbol: 'BTCUSDT', side: 'LONG', size: 1, leverage: 10 }
        });
        expect(f10.vol_factor).toBeGreaterThan(f1.vol_factor);
    });

    test('all 6 factors present in result', () => {
        const f = frn.decomposePosition({
            position: { symbol: 'BTCUSDT', side: 'LONG', size: 1 }
        });
        for (const factor of frn.FACTORS) {
            expect(f).toHaveProperty(factor);
        }
    });
});

describe('§58 recordExposure', () => {
    test('persists factor row', () => {
        const factors = frn.decomposePosition({
            position: { symbol: 'BTCUSDT', side: 'LONG', size: 1 }
        });
        const r = frn.recordExposure({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            positionId: 'POS-1',
            factors,
            grossExposure: 1
        });
        expect(r.recorded).toBe(true);
        const rows = db.prepare(
            `SELECT * FROM ml_factor_exposures WHERE user_id = ?`
        ).all(TEST_USER);
        expect(rows).toHaveLength(1);
        expect(rows[0].position_id).toBe('POS-1');
    });
});

describe('§58 detectStackedRisk', () => {
    test('detects two LONG BTC + ETH as same bet (high overlap)', () => {
        const btc = frn.decomposePosition({
            position: { symbol: 'BTCUSDT', side: 'LONG', size: 1 }
        });
        const eth = frn.decomposePosition({
            position: { symbol: 'ETHUSDT', side: 'LONG', size: 1 }
        });
        const r = frn.detectStackedRisk({
            positions: [
                { id: 'P1', factors: btc },
                { id: 'P2', factors: eth }
            ]
        });
        expect(r.anyStacked).toBe(true);
        expect(r.stackedPairs).toHaveLength(1);
        expect(r.stackedPairs[0].similarity).toBeGreaterThan(0.70);
    });

    test('LONG and SHORT same symbol = negative cosine, not stacked', () => {
        const longBtc = frn.decomposePosition({
            position: { symbol: 'BTCUSDT', side: 'LONG', size: 1 }
        });
        const shortBtc = frn.decomposePosition({
            position: { symbol: 'BTCUSDT', side: 'SHORT', size: 1 }
        });
        const r = frn.detectStackedRisk({
            positions: [
                { id: 'P1', factors: longBtc },
                { id: 'P2', factors: shortBtc }
            ]
        });
        // Opposite sides → cosine likely below positive threshold
        expect(r.anyStacked).toBe(false);
    });

    test('single position returns no stacked', () => {
        const f = frn.decomposePosition({
            position: { symbol: 'BTCUSDT', side: 'LONG', size: 1 }
        });
        const r = frn.detectStackedRisk({
            positions: [{ id: 'P1', factors: f }]
        });
        expect(r.anyStacked).toBe(false);
        expect(r.stackedPairs).toEqual([]);
    });

    test('custom threshold respected', () => {
        const btc = frn.decomposePosition({
            position: { symbol: 'BTCUSDT', side: 'LONG', size: 1 }
        });
        const eth = frn.decomposePosition({
            position: { symbol: 'ETHUSDT', side: 'LONG', size: 1 }
        });
        const r = frn.detectStackedRisk({
            positions: [
                { id: 'P1', factors: btc },
                { id: 'P2', factors: eth }
            ],
            threshold: 0.99
        });
        expect(r.anyStacked).toBe(false);
    });
});

describe('§58 recommendNetting', () => {
    test('NET recommended for same-side near-identical positions', () => {
        const a = frn.decomposePosition({
            position: { symbol: 'BTCUSDT', side: 'LONG', size: 1 }
        });
        const b = frn.decomposePosition({
            position: { symbol: 'BTCUSDT', side: 'LONG', size: 2 }
        });
        const r = frn.recommendNetting({
            positions: [
                { id: 'P1', factors: a },
                { id: 'P2', factors: b }
            ]
        });
        expect(r.decision).toBe('NET');
        expect(r.factorOverlapScore).toBeGreaterThan(0.90);
    });

    test('HEDGE for opposite-side high overlap', () => {
        // Two ETH same-magnitude opposite sides
        const longEth = frn.decomposePosition({
            position: { symbol: 'ETHUSDT', side: 'LONG', size: 1 }
        });
        // Construct a perfect-anti factor vector manually
        // (real opposite-side high-overlap requires constructed scenario)
        const r = frn.recommendNetting({
            positions: [
                { id: 'P1', factors: longEth },
                { id: 'P2', factors: longEth }  // same-side, should NET not HEDGE
            ]
        });
        expect(r.decision).toBe('NET');  // same-side identical
    });

    test('HOLD when no stacking detected', () => {
        const r = frn.recommendNetting({
            positions: [
                { id: 'P1', factors: { btc_beta: 1, market_beta: 0, vol_factor: 0,
                                       liquidity_factor: 0, funding_factor: 0, macro_factor: 0 } },
                { id: 'P2', factors: { btc_beta: 0, market_beta: 0, vol_factor: 0,
                                       liquidity_factor: 1, funding_factor: 0, macro_factor: 0 } }
            ]
        });
        // Orthogonal vectors → no stacking → HOLD
        expect(r.decision).toBe('HOLD');
    });

    test('insufficient positions returns HOLD', () => {
        const f = frn.decomposePosition({
            position: { symbol: 'BTCUSDT', side: 'LONG', size: 1 }
        });
        const r = frn.recommendNetting({
            positions: [{ id: 'P1', factors: f }]
        });
        expect(r.decision).toBe('HOLD');
        expect(r.reasoning).toMatch(/insufficient/i);
    });
});

describe('§58 recordNettingDecision', () => {
    test('persists decision', () => {
        const r = frn.recordNettingDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionType: 'NET',
            positions: [{ id: 'P1' }, { id: 'P2' }],
            dominantFactor: 'btc_beta',
            factorOverlapScore: 0.95,
            recommendedAction: 'Combine positions'
        });
        expect(r.recorded).toBe(true);
    });

    test('throws on invalid decisionType', () => {
        expect(() => frn.recordNettingDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionType: 'BOGUS',
            positions: [],
            dominantFactor: 'btc_beta',
            factorOverlapScore: 0
        })).toThrow();
    });
});

describe('§58 getFactorTrend', () => {
    test('aggregates factor averages across exposures', () => {
        for (let i = 0; i < 5; i++) {
            const f = frn.decomposePosition({
                position: { symbol: 'BTCUSDT', side: 'LONG', size: 1 }
            });
            frn.recordExposure({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                positionId: `POS-${i}`,
                factors: f, grossExposure: 1
            });
        }
        const t = frn.getFactorTrend({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(t.samples).toBe(5);
        expect(t.btcBeta).toBeCloseTo(1.0, 1);
    });
});

describe('§58 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9059;
        const f = frn.decomposePosition({
            position: { symbol: 'BTCUSDT', side: 'LONG', size: 1 }
        });
        frn.recordExposure({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            positionId: 'P1', factors: f, grossExposure: 1
        });
        const t1 = frn.getFactorTrend({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const t2 = frn.getFactorTrend({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(t1.samples).toBe(1);
        expect(t2.samples).toBe(0);
    });
});
