'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p56-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const qf = require('../../../server/services/ml/R4_execution/queueFillModel');

const TEST_USER = 9056;
const TEST_ENV = 'DEMO';
const TEST_SYMBOL = 'BTCUSDT';

function cleanRows() {
    db.prepare('DELETE FROM ml_queue_fill_observations WHERE user_id IN (?, ?)').run(TEST_USER, 9057);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§56 Migration 100', () => {
    test('table ml_queue_fill_observations exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_queue_fill_observations'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_queue_fill_observations)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'symbol', 'side',
            'queue_rank_est', 'fill_prob_est', 'decay_rate',
            'maker_cost_bps', 'taker_cost_bps', 'decision',
            'actual_filled', 'time_to_fill_ms', 'cancelled', 'cancel_count', 'ts'
        ]));
    });

    test('CHECK decision restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_queue_fill_observations
             (user_id, resolved_env, symbol, side, queue_rank_est, fill_prob_est,
              decay_rate, maker_cost_bps, taker_cost_bps, decision,
              actual_filled, cancelled, cancel_count, ts)
             VALUES (?, ?, 'BTC', 'LONG', 0, 0.5, 0.001, 1, 2, 'BOGUS', 0, 0, 0, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§56 Exported constants', () => {
    test('MAKER_TAKER_DECISIONS has 4 entries', () => {
        expect(qf.MAKER_TAKER_DECISIONS).toEqual(['maker', 'taker', 'reprice', 'abstain']);
    });

    test('DEFAULT_FILL_DECAY_RATE positive', () => {
        expect(qf.DEFAULT_FILL_DECAY_RATE).toBeGreaterThan(0);
    });

    test('ABSTAIN_FILL_PROB_FLOOR in (0,1)', () => {
        expect(qf.ABSTAIN_FILL_PROB_FLOOR).toBeGreaterThan(0);
        expect(qf.ABSTAIN_FILL_PROB_FLOOR).toBeLessThan(1);
    });
});

describe('§56 estimateQueuePosition', () => {
    test('LONG buy: sums bids at price >= ours', () => {
        // Buy limit at 100. Bids: 101(5), 100(10), 99(20). Ahead: 101 + 100 = 15.
        const r = qf.estimateQueuePosition({
            symbol: TEST_SYMBOL, side: 'LONG', price: 100,
            depthBook: {
                bids: [[101, 5], [100, 10], [99, 20]],
                asks: [[102, 3], [103, 8]]
            }
        });
        expect(r.queueRank).toBe(15);
        expect(r.levelsAhead).toBe(2);
    });

    test('SHORT sell: sums asks at price <= ours', () => {
        // Sell limit at 102. Asks: 101(3), 102(8), 103(15). Ahead: 101 + 102 = 11.
        const r = qf.estimateQueuePosition({
            symbol: TEST_SYMBOL, side: 'SHORT', price: 102,
            depthBook: {
                bids: [[100, 5]],
                asks: [[101, 3], [102, 8], [103, 15]]
            }
        });
        expect(r.queueRank).toBe(11);
        expect(r.levelsAhead).toBe(2);
    });

    test('best price: zero queue ahead', () => {
        const r = qf.estimateQueuePosition({
            symbol: TEST_SYMBOL, side: 'LONG', price: 102,
            depthBook: {
                bids: [[101, 5], [100, 10]],
                asks: [[103, 3]]
            }
        });
        expect(r.queueRank).toBe(0);
    });

    test('throws on invalid side', () => {
        expect(() => qf.estimateQueuePosition({
            symbol: TEST_SYMBOL, side: 'BAD', price: 100,
            depthBook: { bids: [], asks: [] }
        })).toThrow();
    });
});

describe('§56 estimateFillProbability', () => {
    test('zero elapsed + zero queue + zero movement = near baseFillRate', () => {
        const r = qf.estimateFillProbability({
            queueRank: 0, baseFillRate: 0.75, elapsedMs: 0, priceMovementBps: 0
        });
        expect(r.fillProb).toBeCloseTo(0.75, 1);
    });

    test('decay over time: 5000ms reduces prob', () => {
        const fresh = qf.estimateFillProbability({
            queueRank: 0, baseFillRate: 0.75, elapsedMs: 0, priceMovementBps: 0
        });
        const decayed = qf.estimateFillProbability({
            queueRank: 0, baseFillRate: 0.75, elapsedMs: 5000, priceMovementBps: 0
        });
        expect(decayed.fillProb).toBeLessThan(fresh.fillProb);
    });

    test('large queue rank reduces fillProb', () => {
        const shallow = qf.estimateFillProbability({
            queueRank: 10, baseFillRate: 0.75, elapsedMs: 0
        });
        const deep = qf.estimateFillProbability({
            queueRank: 5000, baseFillRate: 0.75, elapsedMs: 0
        });
        expect(deep.fillProb).toBeLessThan(shallow.fillProb);
    });

    test('adverse movement >20bps → fillProb ~0', () => {
        const r = qf.estimateFillProbability({
            queueRank: 0, baseFillRate: 0.75, elapsedMs: 0, priceMovementBps: 25
        });
        expect(r.fillProb).toBe(0);
    });

    test('throws on negative queueRank', () => {
        expect(() => qf.estimateFillProbability({
            queueRank: -1, baseFillRate: 0.75
        })).toThrow();
    });

    test('output always clamped in [0,1]', () => {
        const r = qf.estimateFillProbability({
            queueRank: 0, baseFillRate: 2.0
        });
        expect(r.fillProb).toBeLessThanOrEqual(1);
    });
});

describe('§56 decideMakerVsTaker', () => {
    test('maker wins when fill_prob high + maker cost lower', () => {
        const r = qf.decideMakerVsTaker({
            makerCostBps: -1,   // rebate
            takerCostBps: 5,
            fillProb: 0.85,
            missedFillRiskBps: 10
        });
        expect(r.decision).toBe('maker');
    });

    test('taker wins when fill_prob too low for maker', () => {
        // makerCost=2 + (1-0.30)*10 = 9. Taker=5. Taker wins.
        const r = qf.decideMakerVsTaker({
            makerCostBps: 2,
            takerCostBps: 5,
            fillProb: 0.30,
            missedFillRiskBps: 10
        });
        expect(r.decision).toBe('taker');
    });

    test('abstain when fill_prob below floor', () => {
        const r = qf.decideMakerVsTaker({
            makerCostBps: -1,
            takerCostBps: 5,
            fillProb: 0.05  // below floor 0.10
        });
        expect(r.decision).toBe('abstain');
    });

    test('reprice when queue deep AND fill_prob weak', () => {
        const r = qf.decideMakerVsTaker({
            makerCostBps: 1,
            takerCostBps: 8,
            fillProb: 0.25,
            queueRank: 1000  // > MIN_QUEUE_RANK_FOR_MAKER * 100 = 500
        });
        expect(r.decision).toBe('reprice');
    });

    test('cancel penalty forces taker', () => {
        const r = qf.decideMakerVsTaker({
            makerCostBps: -1,
            takerCostBps: 5,
            fillProb: 0.85,
            cancelCount: 5  // >= threshold 3
        });
        expect(r.decision).toBe('taker');
        expect(r.reason).toMatch(/cancel_count/);
    });
});

describe('§56 recordFillObservation', () => {
    test('persists observation', () => {
        const r = qf.recordFillObservation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            symbol: TEST_SYMBOL, side: 'LONG',
            queueRankEst: 5, fillProbEst: 0.6,
            decision: 'maker',
            actualFilled: true,
            cancelled: false,
            cancelCount: 0,
            makerCostBps: -1,
            takerCostBps: 5,
            timeToFillMs: 800
        });
        expect(r.recorded).toBe(true);
        const rows = db.prepare(
            `SELECT * FROM ml_queue_fill_observations WHERE user_id = ?`
        ).all(TEST_USER);
        expect(rows).toHaveLength(1);
        expect(rows[0].actual_filled).toBe(1);
        expect(rows[0].time_to_fill_ms).toBe(800);
    });

    test('throws on invalid decision', () => {
        expect(() => qf.recordFillObservation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            symbol: TEST_SYMBOL, side: 'LONG',
            queueRankEst: 0, fillProbEst: 0.5,
            decision: 'BOGUS',
            actualFilled: false,
            cancelled: false
        })).toThrow(/decision/i);
    });

    test('throws on invalid side', () => {
        expect(() => qf.recordFillObservation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            symbol: TEST_SYMBOL, side: 'NEUTRAL',
            queueRankEst: 0, fillProbEst: 0.5,
            decision: 'maker',
            actualFilled: false,
            cancelled: false
        })).toThrow(/side/i);
    });
});

describe('§56 getFillStats', () => {
    test('aggregates samples and fill rate', () => {
        for (let i = 0; i < 10; i++) {
            qf.recordFillObservation({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                symbol: TEST_SYMBOL, side: 'LONG',
                queueRankEst: 5, fillProbEst: 0.5,
                decision: 'maker',
                actualFilled: i < 7,  // 7 filled, 3 not
                cancelled: i >= 7,
                cancelCount: 0,
                makerCostBps: -1, takerCostBps: 5
            });
        }
        const r = qf.getFillStats({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            symbol: TEST_SYMBOL
        });
        expect(r.samples).toBe(10);
        expect(r.actualFillRate).toBeCloseTo(0.7);
        expect(r.totalCancelled).toBe(3);
    });

    test('decision breakdown groups by decision', () => {
        qf.recordFillObservation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            symbol: TEST_SYMBOL, side: 'LONG',
            queueRankEst: 0, fillProbEst: 0.6,
            decision: 'maker', actualFilled: true, cancelled: false
        });
        qf.recordFillObservation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            symbol: TEST_SYMBOL, side: 'LONG',
            queueRankEst: 0, fillProbEst: 0.8,
            decision: 'taker', actualFilled: true, cancelled: false
        });
        const r = qf.getFillStats({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            symbol: TEST_SYMBOL
        });
        expect(r.decisionBreakdown).toHaveLength(2);
    });
});

describe('§56 isolation', () => {
    test('per (user × env × symbol) isolation', () => {
        const OTHER_USER = 9057;
        qf.recordFillObservation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            symbol: TEST_SYMBOL, side: 'LONG',
            queueRankEst: 0, fillProbEst: 0.5,
            decision: 'maker', actualFilled: true, cancelled: false
        });
        const r1 = qf.getFillStats({
            userId: TEST_USER, resolvedEnv: TEST_ENV, symbol: TEST_SYMBOL
        });
        const r2 = qf.getFillStats({
            userId: OTHER_USER, resolvedEnv: TEST_ENV, symbol: TEST_SYMBOL
        });
        expect(r1.samples).toBe(1);
        expect(r2.samples).toBe(0);
    });
});
