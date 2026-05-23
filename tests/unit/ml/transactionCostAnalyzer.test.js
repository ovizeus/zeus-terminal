'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p23-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const tca = require('../../../server/services/ml/R4_execution/transactionCostAnalyzer');

const TEST_USER = 9023;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_tca_estimates WHERE user_id = ?').run(TEST_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§23 Migration 066 — TCA estimates', () => {
    test('table ml_tca_estimates exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_tca_estimates'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_tca_estimates)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'pos_id', 'exchange',
            'order_size_usd', 'estimated_slippage_bps', 'estimated_fees_bps',
            'estimated_total_cost_bps', 'actual_slippage_bps',
            'actual_fees_bps', 'is_viable', 'expected_edge_bps',
            'created_at'
        ]));
    });

    test('CHECK is_viable bool flag', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_tca_estimates
             (user_id, resolved_env, exchange, order_size_usd,
              estimated_slippage_bps, estimated_fees_bps, estimated_total_cost_bps,
              is_viable, created_at)
             VALUES (?, ?, 'binance', 100, 5, 10, 15, 2, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§23 Exported constants', () => {
    test('EXCHANGE_FEE_MODELS has major exchanges', () => {
        expect(Object.keys(tca.EXCHANGE_FEE_MODELS)).toEqual(expect.arrayContaining([
            'binance', 'bybit', 'coinbase'
        ]));
    });

    test('each fee model has maker + taker rates', () => {
        for (const ex of Object.keys(tca.EXCHANGE_FEE_MODELS)) {
            const m = tca.EXCHANGE_FEE_MODELS[ex];
            expect(typeof m.makerBps).toBe('number');
            expect(typeof m.takerBps).toBe('number');
        }
    });

    test('DEFAULT_SLIPPAGE_PARAMS has positive values', () => {
        expect(tca.DEFAULT_SLIPPAGE_PARAMS.base_bps).toBeGreaterThanOrEqual(0);
        expect(tca.DEFAULT_SLIPPAGE_PARAMS.size_factor).toBeGreaterThan(0);
        expect(tca.DEFAULT_SLIPPAGE_PARAMS.depth_factor).toBeGreaterThan(0);
    });

    test('INVARIANT_MIN_EDGE_RATIO >= 1.0', () => {
        expect(tca.INVARIANT_MIN_EDGE_RATIO).toBeGreaterThanOrEqual(1.0);
    });
});

describe('§23 estimateTransactionCost (pure)', () => {
    test('basic estimate with binance taker', () => {
        const r = tca.estimateTransactionCost({
            orderSizeUsd: 1000,
            bookDepthUsd: 100000,
            hourUtc: 12,
            exchange: 'binance',
            isMaker: false
        });
        expect(r.slippageBps).toBeGreaterThanOrEqual(0);
        expect(r.feesBps).toBeGreaterThan(0);
        expect(r.totalCostBps).toBeGreaterThan(0);
    });

    test('larger order has higher slippage', () => {
        const small = tca.estimateTransactionCost({
            orderSizeUsd: 1000,
            bookDepthUsd: 100000,
            hourUtc: 12,
            exchange: 'binance',
            isMaker: false
        });
        const large = tca.estimateTransactionCost({
            orderSizeUsd: 50000,
            bookDepthUsd: 100000,
            hourUtc: 12,
            exchange: 'binance',
            isMaker: false
        });
        expect(large.slippageBps).toBeGreaterThan(small.slippageBps);
    });

    test('thinner book has higher slippage', () => {
        const deep = tca.estimateTransactionCost({
            orderSizeUsd: 1000,
            bookDepthUsd: 1000000,
            hourUtc: 12,
            exchange: 'binance',
            isMaker: false
        });
        const thin = tca.estimateTransactionCost({
            orderSizeUsd: 1000,
            bookDepthUsd: 10000,
            hourUtc: 12,
            exchange: 'binance',
            isMaker: false
        });
        expect(thin.slippageBps).toBeGreaterThan(deep.slippageBps);
    });

    test('illiquid hours have higher slippage', () => {
        const liquid = tca.estimateTransactionCost({
            orderSizeUsd: 1000,
            bookDepthUsd: 100000,
            hourUtc: 13,  // NY open
            exchange: 'binance',
            isMaker: false
        });
        const illiquid = tca.estimateTransactionCost({
            orderSizeUsd: 1000,
            bookDepthUsd: 100000,
            hourUtc: 3,  // dead Asia
            exchange: 'binance',
            isMaker: false
        });
        expect(illiquid.slippageBps).toBeGreaterThanOrEqual(liquid.slippageBps);
    });

    test('maker has lower fees than taker', () => {
        const maker = tca.estimateTransactionCost({
            orderSizeUsd: 1000, bookDepthUsd: 100000,
            hourUtc: 12, exchange: 'binance', isMaker: true
        });
        const taker = tca.estimateTransactionCost({
            orderSizeUsd: 1000, bookDepthUsd: 100000,
            hourUtc: 12, exchange: 'binance', isMaker: false
        });
        expect(maker.feesBps).toBeLessThan(taker.feesBps);
    });

    test('throws on unknown exchange', () => {
        expect(() => tca.estimateTransactionCost({
            orderSizeUsd: 1000, bookDepthUsd: 100000,
            hourUtc: 12, exchange: 'unknown', isMaker: false
        })).toThrow(/exchange/);
    });
});

describe('§23 estimateMarketImpact (pure)', () => {
    test('small order has small impact', () => {
        const r = tca.estimateMarketImpact({
            orderSizeUsd: 1000,
            dailyVolumeUsd: 1000000000,
            volatility: 0.02
        });
        expect(r.impactBps).toBeLessThan(5);
    });

    test('large fraction of daily volume increases impact', () => {
        const small = tca.estimateMarketImpact({
            orderSizeUsd: 1000,
            dailyVolumeUsd: 1000000000,
            volatility: 0.02
        });
        const big = tca.estimateMarketImpact({
            orderSizeUsd: 10000000,
            dailyVolumeUsd: 1000000000,
            volatility: 0.02
        });
        expect(big.impactBps).toBeGreaterThan(small.impactBps);
    });

    test('higher volatility amplifies impact', () => {
        const lowVol = tca.estimateMarketImpact({
            orderSizeUsd: 100000,
            dailyVolumeUsd: 100000000,
            volatility: 0.01
        });
        const highVol = tca.estimateMarketImpact({
            orderSizeUsd: 100000,
            dailyVolumeUsd: 100000000,
            volatility: 0.10
        });
        expect(highVol.impactBps).toBeGreaterThan(lowVol.impactBps);
    });

    test('returns decay time', () => {
        const r = tca.estimateMarketImpact({
            orderSizeUsd: 100000,
            dailyVolumeUsd: 100000000,
            volatility: 0.02
        });
        expect(r.decayMs).toBeGreaterThan(0);
    });
});

describe('§23 evaluateEdgeVsCost — INVARIANT enforced', () => {
    test('viable when edge > cost × ratio', () => {
        const r = tca.evaluateEdgeVsCost({
            expectedEdgeBps: 30,
            estimatedCostBps: 10,
            riskMultiple: 1.5
        });
        expect(r.viable).toBe(true);
        expect(r.edgeAfterCost).toBeCloseTo(20);
    });

    test('NOT viable when edge eaten by cost', () => {
        const r = tca.evaluateEdgeVsCost({
            expectedEdgeBps: 12,
            estimatedCostBps: 10,
            riskMultiple: 1.5  // requires edge >= 15 to be viable
        });
        expect(r.viable).toBe(false);
    });

    test('INVARIANT — edge == cost is NOT viable (line 1116)', () => {
        const r = tca.evaluateEdgeVsCost({
            expectedEdgeBps: 10,
            estimatedCostBps: 10
        });
        expect(r.viable).toBe(false);
    });

    test('INVARIANT — even slightly less edge than cost → not viable', () => {
        const r = tca.evaluateEdgeVsCost({
            expectedEdgeBps: 9.99,
            estimatedCostBps: 10
        });
        expect(r.viable).toBe(false);
    });

    test('uses INVARIANT_MIN_EDGE_RATIO when riskMultiple not provided', () => {
        const r = tca.evaluateEdgeVsCost({
            expectedEdgeBps: 14,
            estimatedCostBps: 10
            // default ratio = INVARIANT_MIN_EDGE_RATIO (>=1.5 → need >=15)
        });
        expect(r.viable).toBe(false);
    });

    test('throws on negative cost', () => {
        expect(() => tca.evaluateEdgeVsCost({
            expectedEdgeBps: 10,
            estimatedCostBps: -1
        })).toThrow();
    });

    test('returns ratio metric for diagnostic', () => {
        const r = tca.evaluateEdgeVsCost({
            expectedEdgeBps: 30,
            estimatedCostBps: 10
        });
        expect(r.ratio).toBeCloseTo(3.0);
    });
});

describe('§23 recordTcaEstimate', () => {
    test('records estimate row', () => {
        tca.recordTcaEstimate({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: 'pos-tca-1',
            exchange: 'binance',
            orderSizeUsd: 1000,
            estimate: {
                slippageBps: 5, feesBps: 8, totalCostBps: 13
            },
            expectedEdgeBps: 25,
            isViable: true
        });
        const rows = db.prepare(
            `SELECT * FROM ml_tca_estimates WHERE user_id = ?`
        ).all(TEST_USER);
        expect(rows).toHaveLength(1);
        expect(rows[0].estimated_total_cost_bps).toBeCloseTo(13);
        expect(rows[0].is_viable).toBe(1);
    });

    test('updates actual values when provided', () => {
        tca.recordTcaEstimate({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            exchange: 'binance', orderSizeUsd: 1000,
            estimate: { slippageBps: 5, feesBps: 8, totalCostBps: 13 },
            isViable: true,
            actualSlippageBps: 7,
            actualFeesBps: 8
        });
        const row = db.prepare(
            `SELECT * FROM ml_tca_estimates WHERE user_id = ?`
        ).get(TEST_USER);
        expect(row.actual_slippage_bps).toBeCloseTo(7);
        expect(row.actual_fees_bps).toBeCloseTo(8);
    });
});

describe('§23 getTcaStats', () => {
    beforeEach(() => {
        for (const e of [5, 6, 7]) {
            tca.recordTcaEstimate({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                exchange: 'binance', orderSizeUsd: 1000,
                estimate: { slippageBps: e, feesBps: 8, totalCostBps: e + 8 },
                isViable: true,
                actualSlippageBps: e + 1
            });
        }
    });

    test('returns rolling stats per exchange', () => {
        const r = tca.getTcaStats({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            exchange: 'binance'
        });
        expect(r.estimateCount).toBe(3);
        expect(r.meanEstimatedSlippageBps).toBeCloseTo(6, 0);
        expect(r.meanActualSlippageBps).toBeCloseTo(7, 0);
        expect(r.estimationError).toBeCloseTo(1, 0);
    });

    test('returns null for unseen exchange', () => {
        const r = tca.getTcaStats({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            exchange: 'coinbase'
        });
        expect(r.estimateCount).toBe(0);
    });
});

describe('§23 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9024;
        tca.recordTcaEstimate({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            exchange: 'binance', orderSizeUsd: 1000,
            estimate: { slippageBps: 5, feesBps: 8, totalCostBps: 13 },
            isViable: true
        });
        tca.recordTcaEstimate({
            userId: OTHER_USER, resolvedEnv: TEST_ENV,
            exchange: 'binance', orderSizeUsd: 1000,
            estimate: { slippageBps: 50, feesBps: 8, totalCostBps: 58 },
            isViable: false
        });
        const mine = tca.getTcaStats({
            userId: TEST_USER, resolvedEnv: TEST_ENV, exchange: 'binance'
        });
        const others = tca.getTcaStats({
            userId: OTHER_USER, resolvedEnv: TEST_ENV, exchange: 'binance'
        });
        expect(mine.meanEstimatedSlippageBps).toBeLessThan(50);
        expect(others.meanEstimatedSlippageBps).toBeGreaterThan(45);
        db.prepare(`DELETE FROM ml_tca_estimates WHERE user_id = ?`).run(OTHER_USER);
    });
});
