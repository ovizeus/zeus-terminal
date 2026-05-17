'use strict';

/**
 * OMEGA Claude-Extra #3 v2 — Execution Optimization Engine.
 * Repositioned from "obfuscator" → institutional-grade execution
 * optimization. Deterministic latency buffers (NOT random), explicit
 * execution_intent, relational child_orders, policy versioning.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-extra-eoe-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/R4_execution/executionOptimizationEngine');

const UID = 9801;
const UID_OPT = 9802;
const UID_HIST = 9803;
const UID_CHILD = 9804;
const UID_ISO_A = 9805;
const UID_ISO_B = 9806;
const UID_ENV = 9807;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    const uids = [UID, UID_OPT, UID_HIST, UID_CHILD,
                  UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_execution_child_orders WHERE user_id IN (${placeholders})`).run(...uids);
    db.prepare(`DELETE FROM ml_execution_optimization_orders WHERE user_id IN (${placeholders})`).run(...uids);
}
beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('Claude-Extra #3 v2 EXECUTION OPTIMIZATION ENGINE', () => {

    describe('Migrations 282+283', () => {
        test('282 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('282_ml_execution_optimization_orders')).toBeTruthy();
        });
        test('283 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('283_ml_execution_child_orders')).toBeTruthy();
        });
        test('execution_strategy CHECK enum', () => {
            expect(() => db.prepare(`INSERT INTO ml_execution_optimization_orders
                (user_id, resolved_env, parent_order_id, asset,
                 original_size, original_order_type, execution_strategy,
                 execution_intent, execution_delay_ms, child_count,
                 execution_policy_version, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'p_bs', 'BTC', 1, 'limit', 'BOGUS',
                    'minimize_slippage', 0, 1, 'v2.0.0', _now())).toThrow();
        });
        test('execution_intent CHECK enum', () => {
            expect(() => db.prepare(`INSERT INTO ml_execution_optimization_orders
                (user_id, resolved_env, parent_order_id, asset,
                 original_size, original_order_type, execution_strategy,
                 execution_intent, execution_delay_ms, child_count,
                 execution_policy_version, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'p_bi', 'BTC', 1, 'limit', 'passthrough',
                    'BOGUS', 0, 1, 'v2.0.0', _now())).toThrow();
        });
        test('parent_order_id UNIQUE', () => {
            const stmt = db.prepare(`INSERT INTO ml_execution_optimization_orders
                (user_id, resolved_env, parent_order_id, asset,
                 original_size, original_order_type, execution_strategy,
                 execution_intent, execution_delay_ms, child_count,
                 execution_policy_version, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            stmt.run(UID, ENV, 'p_dup', 'BTC', 1, 'limit', 'passthrough',
                'minimize_slippage', 0, 1, 'v2.0.0', _now());
            expect(() => stmt.run(UID, ENV, 'p_dup', 'ETH', 2, 'market',
                'passthrough', 'minimize_slippage', 0, 1, 'v2.0.0', _now())).toThrow();
        });
        test('FK child → parent', () => {
            expect(() => db.prepare(`INSERT INTO ml_execution_child_orders
                (user_id, resolved_env, child_order_id, parent_order_id,
                 child_size, child_order_type, child_index, split_reason, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'c_orphan', 'NONEXISTENT',
                    1.0, 'limit', 0, 'test', _now())).toThrow(/FOREIGN KEY/i);
        });
    });

    describe('Constants — REBRANDED', () => {
        test('EXECUTION_STRATEGIES frozen 5 — no "obfuscation"', () => {
            expect(M.EXECUTION_STRATEGIES).toEqual([
                'passthrough', 'latency_buffered',
                'liquidity_based_splitting',
                'type_substitution',
                'optimized_distribution'
            ]);
            expect(Object.isFrozen(M.EXECUTION_STRATEGIES)).toBe(true);
            // No "obfuscation" anywhere
            for (const s of M.EXECUTION_STRATEGIES) {
                expect(s.toLowerCase()).not.toContain('obfusc');
            }
        });
        test('EXECUTION_INTENTS frozen 3 explicit', () => {
            expect(M.EXECUTION_INTENTS).toEqual([
                'minimize_slippage',
                'reduce_market_impact',
                'improve_fill_quality'
            ]);
        });
        test('Guardrails defined', () => {
            expect(M.MAX_EXECUTION_DELAY_MS).toBeGreaterThan(0);
            expect(M.MAX_EXECUTION_DELAY_MS).toBeLessThanOrEqual(500);
            expect(M.MAX_CHILD_COUNT).toBeLessThanOrEqual(10);
            expect(M.MIN_CHILD_SIZE_RATIO).toBeLessThan(M.MAX_SPLIT_RATIO);
            expect(M.MAX_SPLIT_RATIO).toBeLessThan(1.0);
        });
        test('EXECUTION_POLICY_VERSION semver', () => {
            expect(M.EXECUTION_POLICY_VERSION).toMatch(/^v\d+\.\d+\.\d+$/);
        });
    });

    describe('computeLatencyBufferMs (pure) — DETERMINISTIC', () => {
        test('minimize_slippage → 25ms (fast)', () => {
            expect(M.computeLatencyBufferMs({
                executionIntent: 'minimize_slippage'
            }).latencyBufferMs).toBe(25);
        });
        test('reduce_market_impact → 100ms (medium)', () => {
            expect(M.computeLatencyBufferMs({
                executionIntent: 'reduce_market_impact'
            }).latencyBufferMs).toBe(100);
        });
        test('improve_fill_quality → 150ms (waiting)', () => {
            expect(M.computeLatencyBufferMs({
                executionIntent: 'improve_fill_quality'
            }).latencyBufferMs).toBe(150);
        });
        test('SAME intent → SAME result (deterministic)', () => {
            const r1 = M.computeLatencyBufferMs({ executionIntent: 'minimize_slippage' });
            const r2 = M.computeLatencyBufferMs({ executionIntent: 'minimize_slippage' });
            expect(r1.latencyBufferMs).toBe(r2.latencyBufferMs);
        });
        test('invalid intent throws', () => {
            expect(() => M.computeLatencyBufferMs({
                executionIntent: 'BOGUS'
            })).toThrow();
        });
    });

    describe('computeLiquidityBasedSplit (pure)', () => {
        test('childCount=1 → single child equal to total', () => {
            const r = M.computeLiquidityBasedSplit({
                totalSize: 1.0, childCount: 1
            });
            expect(r.childSizes).toEqual([1.0]);
        });
        test('childCount=3 + no depths → equal split', () => {
            const r = M.computeLiquidityBasedSplit({
                totalSize: 3.0, childCount: 3
            });
            expect(r.childSizes.length).toBe(3);
            for (const s of r.childSizes) {
                expect(s).toBeCloseTo(1.0, 4);
            }
        });
        test('childCount=3 + bookDepths → proportional split', () => {
            const r = M.computeLiquidityBasedSplit({
                totalSize: 6.0, childCount: 3,
                bookDepths: [1, 2, 3]  // 1/6 + 2/6 + 3/6
            });
            // After MIN_CHILD_SIZE_RATIO enforcement (0.10 × 6 = 0.6 min)
            // 1, 2, 3 are all above min, sum = 6, no adjustment needed.
            // But MAX_SPLIT_RATIO = 0.50 × 6 = 3.0. Last child = 3.0 = exact max.
            expect(r.childSizes.length).toBe(3);
            const sum = r.childSizes.reduce((a, b) => a + b, 0);
            expect(sum).toBeCloseTo(6.0, 4);
        });
        test('child count > MAX_CHILD_COUNT throws', () => {
            expect(() => M.computeLiquidityBasedSplit({
                totalSize: 10, childCount: 20
            })).toThrow(/MAX_CHILD_COUNT/);
        });
        test('infeasible split throws', () => {
            // 5 children × 0.10 min = 0.50 < 1.0 OK
            // But 11 children × 0.10 = 1.10 > 1.0 → infeasible (also above max count)
            expect(() => M.computeLiquidityBasedSplit({
                totalSize: 1.0, childCount: 11
            })).toThrow();
        });
        test('zero totalSize throws', () => {
            expect(() => M.computeLiquidityBasedSplit({
                totalSize: 0, childCount: 2
            })).toThrow();
        });
    });

    describe('selectCompatibleOrderType (pure) — DETERMINISTIC', () => {
        test('limit + substitution → gtc (first alt)', () => {
            const r = M.selectCompatibleOrderType({
                originalType: 'limit', allowSubstitution: true
            });
            expect(r.selectedType).toBe('gtc');
        });
        test('limit + no substitution → limit', () => {
            expect(M.selectCompatibleOrderType({
                originalType: 'limit', allowSubstitution: false
            }).selectedType).toBe('limit');
        });
        test('market + substitution → ioc', () => {
            expect(M.selectCompatibleOrderType({
                originalType: 'market', allowSubstitution: true
            }).selectedType).toBe('ioc');
        });
        test('stop + substitution → stop (no alts)', () => {
            expect(M.selectCompatibleOrderType({
                originalType: 'stop', allowSubstitution: true
            }).selectedType).toBe('stop');
        });
    });

    describe('selectOptimalStrategyForIntent (pure)', () => {
        test('minimize_slippage → latency_buffered', () => {
            expect(M.selectOptimalStrategyForIntent({
                executionIntent: 'minimize_slippage'
            }).recommendedStrategy).toBe('latency_buffered');
        });
        test('reduce_market_impact → liquidity_based_splitting', () => {
            expect(M.selectOptimalStrategyForIntent({
                executionIntent: 'reduce_market_impact'
            }).recommendedStrategy).toBe('liquidity_based_splitting');
        });
        test('improve_fill_quality → optimized_distribution', () => {
            expect(M.selectOptimalStrategyForIntent({
                executionIntent: 'improve_fill_quality'
            }).recommendedStrategy).toBe('optimized_distribution');
        });
    });

    describe('optimizeOrder (integration)', () => {
        test('passthrough → 1 child, no delay', () => {
            const r = M.optimizeOrder({
                userId: UID_OPT, resolvedEnv: ENV,
                parentOrderId: 'p_pass', asset: 'BTC',
                originalSize: 1.0, originalOrderType: 'limit',
                executionStrategy: 'passthrough',
                executionIntent: 'minimize_slippage',
                ts: _now()
            });
            expect(r.childCount).toBe(1);
            expect(r.latencyBufferMs).toBe(0);
            expect(r.childOrders.length).toBe(1);
            expect(r.childOrders[0].size).toBeCloseTo(1.0, 6);
            expect(r.childOrders[0].orderType).toBe('limit');
        });
        test('latency_buffered → deterministic delay', () => {
            const r = M.optimizeOrder({
                userId: UID_OPT, resolvedEnv: ENV,
                parentOrderId: 'p_lat', asset: 'BTC',
                originalSize: 1.0, originalOrderType: 'limit',
                executionStrategy: 'latency_buffered',
                executionIntent: 'improve_fill_quality',
                ts: _now()
            });
            expect(r.latencyBufferMs).toBe(150);  // deterministic for fill_quality
        });
        test('liquidity_based_splitting → multiple children', () => {
            const r = M.optimizeOrder({
                userId: UID_OPT, resolvedEnv: ENV,
                parentOrderId: 'p_split', asset: 'BTC',
                originalSize: 1.0, originalOrderType: 'limit',
                executionStrategy: 'liquidity_based_splitting',
                executionIntent: 'reduce_market_impact',
                ts: _now()
            });
            expect(r.childCount).toBeGreaterThan(1);
            const sum = r.childOrders.reduce((s, c) => s + c.size, 0);
            expect(sum).toBeCloseTo(1.0, 6);
        });
        test('optimized_distribution → split + buffer + type sub', () => {
            const r = M.optimizeOrder({
                userId: UID_OPT, resolvedEnv: ENV,
                parentOrderId: 'p_opt', asset: 'BTC',
                originalSize: 1.0, originalOrderType: 'limit',
                executionStrategy: 'optimized_distribution',
                executionIntent: 'improve_fill_quality',
                ts: _now()
            });
            expect(r.childCount).toBeGreaterThan(1);
            expect(r.latencyBufferMs).toBeGreaterThan(0);
            // type substitution → limit → gtc
            expect(r.childOrders.every(c => c.orderType === 'gtc')).toBe(true);
        });
        test('child orders persisted in relational table', () => {
            M.optimizeOrder({
                userId: UID_OPT, resolvedEnv: ENV,
                parentOrderId: 'p_rel', asset: 'BTC',
                originalSize: 2.0, originalOrderType: 'limit',
                executionStrategy: 'liquidity_based_splitting',
                executionIntent: 'reduce_market_impact',
                ts: _now()
            });
            const children = M.getChildOrdersForParent({
                userId: UID_OPT, resolvedEnv: ENV,
                parentOrderId: 'p_rel'
            });
            expect(children.length).toBeGreaterThan(1);
            const sum = children.reduce((s, c) => s + c.childSize, 0);
            expect(sum).toBeCloseTo(2.0, 6);
            // child_index sequential 0..N-1
            const indices = children.map(c => c.childIndex).sort((a,b) => a-b);
            for (let i = 0; i < indices.length; i++) {
                expect(indices[i]).toBe(i);
            }
        });
        test('FK cascade — delete parent → children gone', () => {
            M.optimizeOrder({
                userId: UID_OPT, resolvedEnv: ENV,
                parentOrderId: 'p_cas', asset: 'BTC',
                originalSize: 1.0, originalOrderType: 'limit',
                executionStrategy: 'liquidity_based_splitting',
                executionIntent: 'reduce_market_impact',
                ts: _now()
            });
            db.prepare("DELETE FROM ml_execution_optimization_orders WHERE parent_order_id=?").run('p_cas');
            const orphans = db.prepare(
                "SELECT * FROM ml_execution_child_orders WHERE parent_order_id=?"
            ).all('p_cas');
            expect(orphans.length).toBe(0);
        });
        test('duplicate parent throws', () => {
            M.optimizeOrder({
                userId: UID_OPT, resolvedEnv: ENV,
                parentOrderId: 'p_dup_int', asset: 'BTC',
                originalSize: 1.0, originalOrderType: 'limit',
                executionStrategy: 'passthrough',
                executionIntent: 'minimize_slippage', ts: _now()
            });
            expect(() => M.optimizeOrder({
                userId: UID_OPT, resolvedEnv: ENV,
                parentOrderId: 'p_dup_int', asset: 'ETH',
                originalSize: 2.0, originalOrderType: 'market',
                executionStrategy: 'passthrough',
                executionIntent: 'minimize_slippage', ts: _now()
            })).toThrow(/duplicate/);
        });
        test('policy version tracked', () => {
            const r = M.optimizeOrder({
                userId: UID_OPT, resolvedEnv: ENV,
                parentOrderId: 'p_pv', asset: 'BTC',
                originalSize: 1.0, originalOrderType: 'limit',
                executionStrategy: 'passthrough',
                executionIntent: 'minimize_slippage',
                executionPolicyVersion: 'v2.5.0',
                ts: _now()
            });
            expect(r.executionPolicyVersion).toBe('v2.5.0');
        });
    });

    describe('getOptimizationHistory', () => {
        test('filter by strategy', () => {
            const u = UID_HIST;
            M.optimizeOrder({
                userId: u, resolvedEnv: ENV,
                parentOrderId: 'h_split', asset: 'BTC',
                originalSize: 1.0, originalOrderType: 'limit',
                executionStrategy: 'liquidity_based_splitting',
                executionIntent: 'reduce_market_impact', ts: 1000
            });
            M.optimizeOrder({
                userId: u, resolvedEnv: ENV,
                parentOrderId: 'h_pass', asset: 'BTC',
                originalSize: 1.0, originalOrderType: 'limit',
                executionStrategy: 'passthrough',
                executionIntent: 'minimize_slippage', ts: 2000
            });
            const split = M.getOptimizationHistory({
                userId: u, resolvedEnv: ENV,
                strategy: 'liquidity_based_splitting', limit: 10
            });
            expect(split.length).toBe(1);
            expect(split[0].parentOrderId).toBe('h_split');
        });
    });

    describe('isolation per user × env', () => {
        test('uid', () => {
            M.optimizeOrder({
                userId: UID_ISO_A, resolvedEnv: ENV,
                parentOrderId: 'iso_a', asset: 'BTC',
                originalSize: 1.0, originalOrderType: 'limit',
                executionStrategy: 'passthrough',
                executionIntent: 'minimize_slippage', ts: _now()
            });
            M.optimizeOrder({
                userId: UID_ISO_B, resolvedEnv: ENV,
                parentOrderId: 'iso_b', asset: 'BTC',
                originalSize: 1.0, originalOrderType: 'limit',
                executionStrategy: 'passthrough',
                executionIntent: 'minimize_slippage', ts: _now()
            });
            const rows = M.getOptimizationHistory({
                userId: UID_ISO_A, resolvedEnv: ENV, limit: 10
            });
            expect(rows.every(r => r.parentOrderId !== 'iso_b')).toBe(true);
        });
    });
});
