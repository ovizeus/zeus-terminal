'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-execn1-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const spo = require('../../../server/services/ml/R4_execution/smartPostOnly');

const TEST_USER = 9001;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_post_only_orders WHERE user_id = ?').run(TEST_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('EXEC-N1 Migration 076', () => {
    test('table ml_post_only_orders exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_post_only_orders'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_post_only_orders)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'pos_id', 'exchange',
            'side', 'placed_price', 'shaded_price', 'reference_best',
            'urgency', 'strategy', 'outcome', 'filled_price', 'created_at'
        ]));
    });

    test('CHECK side restricts to BUY|SELL', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_post_only_orders
             (user_id, resolved_env, exchange, side, placed_price, shaded_price,
              reference_best, urgency, strategy, outcome, created_at)
             VALUES (?, ?, 'binance', 'BOGUS', 100, 100, 100, 'MEDIUM', 'MODERATE', 'PENDING', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK strategy restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_post_only_orders
             (user_id, resolved_env, exchange, side, placed_price, shaded_price,
              reference_best, urgency, strategy, outcome, created_at)
             VALUES (?, ?, 'binance', 'BUY', 100, 100, 100, 'MEDIUM', 'BOGUS', 'PENDING', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('EXEC-N1 Exported constants', () => {
    test('SHADE_STRATEGIES has 3 levels', () => {
        expect(spo.SHADE_STRATEGIES).toEqual(['PASSIVE', 'MODERATE', 'AGGRESSIVE']);
    });

    test('URGENCY_LEVELS has 3 levels', () => {
        expect(spo.URGENCY_LEVELS).toEqual(['LOW', 'MEDIUM', 'HIGH']);
    });

    test('ORDER_OUTCOMES has fill/miss/pending', () => {
        expect(spo.ORDER_OUTCOMES).toEqual(expect.arrayContaining([
            'FILLED', 'MISSED', 'PENDING', 'CANCELLED'
        ]));
    });

    test('DEFAULT_SHADE_PARAMS has finite values', () => {
        expect(spo.DEFAULT_SHADE_PARAMS.passive_bps).toBeGreaterThan(0);
        expect(spo.DEFAULT_SHADE_PARAMS.moderate_bps).toBeGreaterThan(0);
        expect(spo.DEFAULT_SHADE_PARAMS.aggressive_bps).toBeGreaterThan(0);
    });
});

describe('EXEC-N1 calculatePriceShade (pure)', () => {
    test('BUY side shades below best ask (better fill price)', () => {
        const r = spo.calculatePriceShade({
            side: 'BUY',
            currentBest: 50000,
            spreadBps: 5,
            depthUsd: 1000000,
            urgency: 'MEDIUM',
            strategy: 'MODERATE'
        });
        expect(r.shadedPrice).toBeLessThan(50000);
        expect(r.strategy).toBe('MODERATE');
    });

    test('SELL side shades above best bid (better fill price)', () => {
        const r = spo.calculatePriceShade({
            side: 'SELL',
            currentBest: 50000,
            spreadBps: 5,
            depthUsd: 1000000,
            urgency: 'MEDIUM',
            strategy: 'MODERATE'
        });
        expect(r.shadedPrice).toBeGreaterThan(50000);
    });

    test('PASSIVE strategy shades further (lower fill rate)', () => {
        const passive = spo.calculatePriceShade({
            side: 'BUY', currentBest: 50000, spreadBps: 5,
            depthUsd: 1000000, urgency: 'LOW', strategy: 'PASSIVE'
        });
        const aggressive = spo.calculatePriceShade({
            side: 'BUY', currentBest: 50000, spreadBps: 5,
            depthUsd: 1000000, urgency: 'HIGH', strategy: 'AGGRESSIVE'
        });
        // PASSIVE BUY = further from best (lower price) → less likely to fill
        expect(passive.shadedPrice).toBeLessThan(aggressive.shadedPrice);
    });

    test('HIGH urgency aggressive → closer to best', () => {
        const r = spo.calculatePriceShade({
            side: 'BUY', currentBest: 50000, spreadBps: 5,
            depthUsd: 1000000, urgency: 'HIGH', strategy: 'AGGRESSIVE'
        });
        expect(r.shadedPrice).toBeGreaterThan(49990);  // close to 50000
    });

    test('returns shadeBps for tracking', () => {
        const r = spo.calculatePriceShade({
            side: 'BUY', currentBest: 50000, spreadBps: 5,
            depthUsd: 1000000, urgency: 'MEDIUM', strategy: 'MODERATE'
        });
        expect(typeof r.shadeBps).toBe('number');
        expect(r.shadeBps).toBeGreaterThan(0);
    });

    test('throws on invalid side', () => {
        expect(() => spo.calculatePriceShade({
            side: 'BOGUS', currentBest: 50000, spreadBps: 5,
            depthUsd: 1000000, urgency: 'MEDIUM', strategy: 'MODERATE'
        })).toThrow(/side/);
    });
});

describe('EXEC-N1 shouldUsePostOnly (pure)', () => {
    test('high urgency + low fill rate → use taker (don\'t post-only)', () => {
        const r = spo.shouldUsePostOnly({
            orderUrgency: 'HIGH',
            edgeBps: 50,
            costSavingsBps: 8,
            fillRateExpected: 0.3
        });
        expect(r.usePostOnly).toBe(false);
    });

    test('low urgency + high savings → post-only', () => {
        const r = spo.shouldUsePostOnly({
            orderUrgency: 'LOW',
            edgeBps: 50,
            costSavingsBps: 8,
            fillRateExpected: 0.85
        });
        expect(r.usePostOnly).toBe(true);
    });

    test('edge too thin → use post-only (savings matter)', () => {
        const r = spo.shouldUsePostOnly({
            orderUrgency: 'MEDIUM',
            edgeBps: 15,        // thin
            costSavingsBps: 8,
            fillRateExpected: 0.75
        });
        expect(r.usePostOnly).toBe(true);
    });

    test('returns reason', () => {
        const r = spo.shouldUsePostOnly({
            orderUrgency: 'HIGH',
            edgeBps: 50,
            costSavingsBps: 8,
            fillRateExpected: 0.3
        });
        expect(typeof r.reason).toBe('string');
        expect(r.reason.length).toBeGreaterThan(0);
    });
});

describe('EXEC-N1 recordPostOnlyOrder', () => {
    test('records order row', () => {
        spo.recordPostOnlyOrder({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: 'pos-po-1', exchange: 'binance',
            params: {
                side: 'BUY', placedPrice: 49995, shadedPrice: 49995,
                referenceBest: 50000, urgency: 'MEDIUM', strategy: 'MODERATE',
                outcome: 'PENDING'
            }
        });
        const rows = db.prepare(
            `SELECT * FROM ml_post_only_orders WHERE user_id = ?`
        ).all(TEST_USER);
        expect(rows).toHaveLength(1);
        expect(rows[0].side).toBe('BUY');
        expect(rows[0].outcome).toBe('PENDING');
    });

    test('throws on invalid outcome', () => {
        expect(() => spo.recordPostOnlyOrder({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: 'pos-x', exchange: 'binance',
            params: {
                side: 'BUY', placedPrice: 100, shadedPrice: 100,
                referenceBest: 100, urgency: 'MEDIUM', strategy: 'MODERATE',
                outcome: 'BOGUS'
            }
        })).toThrow(/outcome/i);
    });
});

describe('EXEC-N1 recordPostOnlyOutcome', () => {
    test('updates outcome on existing order', () => {
        const insertResult = db.prepare(
            `INSERT INTO ml_post_only_orders
             (user_id, resolved_env, exchange, side, placed_price, shaded_price,
              reference_best, urgency, strategy, outcome, created_at)
             VALUES (?, ?, 'binance', 'BUY', 50000, 49995, 50000, 'MEDIUM', 'MODERATE', 'PENDING', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now());

        spo.recordPostOnlyOutcome({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            orderId: insertResult.lastInsertRowid,
            outcome: { outcome: 'FILLED', filledPrice: 49996 }
        });
        const row = db.prepare(
            `SELECT * FROM ml_post_only_orders WHERE id = ?`
        ).get(insertResult.lastInsertRowid);
        expect(row.outcome).toBe('FILLED');
        expect(row.filled_price).toBeCloseTo(49996);
    });
});

describe('EXEC-N1 getPostOnlyStats', () => {
    beforeEach(() => {
        for (const outcome of ['FILLED', 'FILLED', 'MISSED', 'FILLED']) {
            const insertResult = db.prepare(
                `INSERT INTO ml_post_only_orders
                 (user_id, resolved_env, exchange, side, placed_price, shaded_price,
                  reference_best, urgency, strategy, outcome, created_at)
                 VALUES (?, ?, 'binance', 'BUY', 50000, 49995, 50000, 'MEDIUM', 'MODERATE', ?, ?)`
            ).run(TEST_USER, TEST_ENV, outcome, Date.now());
        }
    });

    test('returns fill rate stats', () => {
        const r = spo.getPostOnlyStats({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            exchange: 'binance'
        });
        expect(r.totalOrders).toBe(4);
        expect(r.filledCount).toBe(3);
        expect(r.missedCount).toBe(1);
        expect(r.fillRate).toBeCloseTo(0.75);
    });

    test('returns null stats when no orders', () => {
        const r = spo.getPostOnlyStats({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            exchange: 'coinbase'
        });
        expect(r.totalOrders).toBe(0);
    });
});

describe('EXEC-N1 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9002;
        spo.recordPostOnlyOrder({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: 'pos-iso', exchange: 'binance',
            params: {
                side: 'BUY', placedPrice: 100, shadedPrice: 99,
                referenceBest: 100, urgency: 'MEDIUM', strategy: 'MODERATE',
                outcome: 'PENDING'
            }
        });
        const myRows = db.prepare(
            `SELECT * FROM ml_post_only_orders WHERE user_id = ?`
        ).all(TEST_USER);
        const otherRows = db.prepare(
            `SELECT * FROM ml_post_only_orders WHERE user_id = ?`
        ).all(OTHER_USER);
        expect(myRows).toHaveLength(1);
        expect(otherRows).toHaveLength(0);
    });
});
