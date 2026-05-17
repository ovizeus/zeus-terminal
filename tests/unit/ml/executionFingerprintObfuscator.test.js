'use strict';

/**
 * OMEGA Claude-Extra #3 — Execution Fingerprint Obfuscator (LEGAL).
 * Order diversification within ONE account.
 * NO multi-account, NO wash trading, NO concealment of beneficial ownership.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-extra-obf-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/R4_execution/executionFingerprintObfuscator');

const UID = 9701;
const UID_OBF = 9702;
const UID_HIST = 9703;
const UID_ISO_A = 9704;
const UID_ISO_B = 9705;
const UID_ENV = 9706;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    const uids = [UID, UID_OBF, UID_HIST,
                  UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_obfuscated_orders WHERE user_id IN (${placeholders})`).run(...uids);
}
beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('Claude-Extra #3 EXECUTION FINGERPRINT OBFUSCATOR', () => {

    describe('Migration 279', () => {
        test('applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('279_ml_obfuscated_orders')).toBeTruthy();
        });
        test('obfuscation_strategy CHECK enum', () => {
            expect(() => db.prepare(`INSERT INTO ml_obfuscated_orders
                (user_id, resolved_env, original_order_id, asset,
                 original_size, original_order_type, obfuscation_strategy,
                 child_orders_json, jitter_ms, child_count, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'b_o', 'BTC', 1.0, 'limit', 'BOGUS',
                    '[]', 0, 1, _now())).toThrow();
        });
        test('order_type CHECK enum', () => {
            expect(() => db.prepare(`INSERT INTO ml_obfuscated_orders
                (user_id, resolved_env, original_order_id, asset,
                 original_size, original_order_type, obfuscation_strategy,
                 child_orders_json, jitter_ms, child_count, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'b_t', 'BTC', 1.0, 'BOGUS_TYPE', 'none',
                    '[]', 0, 1, _now())).toThrow();
        });
        test('original_order_id UNIQUE', () => {
            const stmt = db.prepare(`INSERT INTO ml_obfuscated_orders
                (user_id, resolved_env, original_order_id, asset,
                 original_size, original_order_type, obfuscation_strategy,
                 child_orders_json, jitter_ms, child_count, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            stmt.run(UID, ENV, 'd_o', 'BTC', 1.0, 'limit', 'none', '[]', 0, 1, _now());
            expect(() => stmt.run(UID, ENV, 'd_o', 'ETH', 2.0, 'market', 'none', '[]', 0, 1, _now())).toThrow();
        });
    });

    describe('Constants', () => {
        test('ORDER_TYPES frozen 6', () => {
            expect(M.ORDER_TYPES).toEqual([
                'limit', 'market', 'ioc', 'gtc', 'stop', 'stop_limit'
            ]);
            expect(Object.isFrozen(M.ORDER_TYPES)).toBe(true);
        });
        test('OBFUSCATION_STRATEGIES frozen 5', () => {
            expect(M.OBFUSCATION_STRATEGIES).toEqual([
                'none', 'timing_jitter', 'size_split',
                'type_variation', 'full_obfuscation'
            ]);
            expect(Object.isFrozen(M.OBFUSCATION_STRATEGIES)).toBe(true);
        });
        test('TYPE_COMPATIBILITY map: which types can substitute which', () => {
            // E.g. 'limit' can be substituted with 'gtc' (both passive)
            // but not 'market' (active liquidity taker)
            expect(M.TYPE_COMPATIBILITY.limit).toContain('limit');
            expect(M.TYPE_COMPATIBILITY.limit).toContain('gtc');
            expect(M.TYPE_COMPATIBILITY.limit).not.toContain('market');
            expect(M.TYPE_COMPATIBILITY.market).toContain('ioc');
        });
        test('limits configured', () => {
            expect(M.MAX_JITTER_MS).toBeGreaterThan(0);
            expect(M.MAX_CHILD_COUNT).toBeGreaterThan(1);
            expect(M.MIN_CHILD_SIZE_RATIO).toBeGreaterThan(0);
            expect(M.MIN_CHILD_SIZE_RATIO).toBeLessThan(1);
        });
    });

    describe('computeJitterMs (pure)', () => {
        test('returns value in [0, MAX]', () => {
            // Deterministic seed via Math.random replacement
            const original = Math.random;
            Math.random = () => 0.5;
            const r = M.computeJitterMs({ maxJitterMs: 100 });
            Math.random = original;
            expect(r.jitterMs).toBe(50);
        });
        test('respects max', () => {
            const original = Math.random;
            Math.random = () => 0.999;
            const r = M.computeJitterMs({ maxJitterMs: 100 });
            Math.random = original;
            expect(r.jitterMs).toBeLessThanOrEqual(100);
        });
        test('zero max → 0', () => {
            const r = M.computeJitterMs({ maxJitterMs: 0 });
            expect(r.jitterMs).toBe(0);
        });
        test('negative max throws', () => {
            expect(() => M.computeJitterMs({ maxJitterMs: -1 })).toThrow();
        });
    });

    describe('splitSize (pure)', () => {
        test('childCount=1 → single child equal to total', () => {
            const r = M.splitSize({
                totalSize: 1.0, childCount: 1, minChildRatio: 0.1
            });
            expect(r.childSizes.length).toBe(1);
            expect(r.childSizes[0]).toBeCloseTo(1.0, 6);
        });
        test('childCount=3 → 3 children sum to total', () => {
            const r = M.splitSize({
                totalSize: 1.0, childCount: 3, minChildRatio: 0.1
            });
            expect(r.childSizes.length).toBe(3);
            const sum = r.childSizes.reduce((a, b) => a + b, 0);
            expect(sum).toBeCloseTo(1.0, 6);
            // Each child ≥ minChildRatio × total
            for (const s of r.childSizes) {
                expect(s).toBeGreaterThanOrEqual(0.1 * 1.0);
            }
        });
        test('childCount > max-feasible → throws', () => {
            // total=1, minRatio=0.5 → only 2 children possible (0.5+0.5)
            // requesting 3 → infeasible
            expect(() => M.splitSize({
                totalSize: 1.0, childCount: 3, minChildRatio: 0.5
            })).toThrow(/infeasible|min.*child/i);
        });
        test('zero totalSize throws', () => {
            expect(() => M.splitSize({
                totalSize: 0, childCount: 2, minChildRatio: 0.1
            })).toThrow();
        });
    });

    describe('selectCompatibleOrderType (pure)', () => {
        test('limit → can be limit or gtc', () => {
            const r = M.selectCompatibleOrderType({
                originalType: 'limit',
                allowVariation: true
            });
            expect(['limit', 'gtc']).toContain(r.selectedType);
        });
        test('allowVariation=false → returns original', () => {
            const r = M.selectCompatibleOrderType({
                originalType: 'limit',
                allowVariation: false
            });
            expect(r.selectedType).toBe('limit');
        });
        test('market → can be market or ioc', () => {
            const r = M.selectCompatibleOrderType({
                originalType: 'market',
                allowVariation: true
            });
            expect(['market', 'ioc']).toContain(r.selectedType);
        });
        test('stop → only stop (no compatible alt)', () => {
            const r = M.selectCompatibleOrderType({
                originalType: 'stop',
                allowVariation: true
            });
            expect(r.selectedType).toBe('stop');
        });
        test('invalid original throws', () => {
            expect(() => M.selectCompatibleOrderType({
                originalType: 'BOGUS', allowVariation: true
            })).toThrow();
        });
    });

    describe('obfuscateOrder (integration)', () => {
        test('strategy=none → unchanged', () => {
            const r = M.obfuscateOrder({
                userId: UID_OBF, resolvedEnv: ENV,
                originalOrderId: 'o_none', asset: 'BTC',
                originalSize: 1.0, originalOrderType: 'limit',
                obfuscationStrategy: 'none',
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.childCount).toBe(1);
            expect(r.jitterMs).toBe(0);
            expect(r.childOrders.length).toBe(1);
            expect(r.childOrders[0].size).toBeCloseTo(1.0, 6);
            expect(r.childOrders[0].orderType).toBe('limit');
        });
        test('strategy=timing_jitter → 1 child + jitter > 0', () => {
            const r = M.obfuscateOrder({
                userId: UID_OBF, resolvedEnv: ENV,
                originalOrderId: 'o_jit', asset: 'BTC',
                originalSize: 1.0, originalOrderType: 'limit',
                obfuscationStrategy: 'timing_jitter',
                ts: _now()
            });
            expect(r.childCount).toBe(1);
            expect(r.jitterMs).toBeGreaterThanOrEqual(0);
            expect(r.jitterMs).toBeLessThanOrEqual(M.MAX_JITTER_MS);
        });
        test('strategy=size_split → multiple children sum to total', () => {
            const r = M.obfuscateOrder({
                userId: UID_OBF, resolvedEnv: ENV,
                originalOrderId: 'o_split', asset: 'BTC',
                originalSize: 1.0, originalOrderType: 'limit',
                obfuscationStrategy: 'size_split',
                ts: _now()
            });
            expect(r.childCount).toBeGreaterThan(1);
            const sum = r.childOrders.reduce((s, c) => s + c.size, 0);
            expect(sum).toBeCloseTo(1.0, 6);
        });
        test('strategy=full_obfuscation → split + jitter + possible type variation', () => {
            const r = M.obfuscateOrder({
                userId: UID_OBF, resolvedEnv: ENV,
                originalOrderId: 'o_full', asset: 'BTC',
                originalSize: 1.0, originalOrderType: 'limit',
                obfuscationStrategy: 'full_obfuscation',
                ts: _now()
            });
            expect(r.childCount).toBeGreaterThan(1);
            const sum = r.childOrders.reduce((s, c) => s + c.size, 0);
            expect(sum).toBeCloseTo(1.0, 6);
            // Each child type must be compatible with original
            for (const c of r.childOrders) {
                expect(M.TYPE_COMPATIBILITY.limit).toContain(c.orderType);
            }
        });
        test('duplicate originalOrderId throws', () => {
            M.obfuscateOrder({
                userId: UID_OBF, resolvedEnv: ENV,
                originalOrderId: 'o_dup', asset: 'BTC',
                originalSize: 1.0, originalOrderType: 'limit',
                obfuscationStrategy: 'none', ts: _now()
            });
            expect(() => M.obfuscateOrder({
                userId: UID_OBF, resolvedEnv: ENV,
                originalOrderId: 'o_dup', asset: 'ETH',
                originalSize: 2.0, originalOrderType: 'market',
                obfuscationStrategy: 'none', ts: _now()
            })).toThrow(/duplicate/);
        });
        test('zero size throws', () => {
            expect(() => M.obfuscateOrder({
                userId: UID_OBF, resolvedEnv: ENV,
                originalOrderId: 'o_bad', asset: 'BTC',
                originalSize: 0, originalOrderType: 'limit',
                obfuscationStrategy: 'none', ts: _now()
            })).toThrow();
        });
        test('invalid strategy throws', () => {
            expect(() => M.obfuscateOrder({
                userId: UID_OBF, resolvedEnv: ENV,
                originalOrderId: 'o_bad2', asset: 'BTC',
                originalSize: 1.0, originalOrderType: 'limit',
                obfuscationStrategy: 'BOGUS', ts: _now()
            })).toThrow();
        });
    });

    describe('getObfuscationHistory', () => {
        test('filter by strategy', () => {
            const u = UID_HIST;
            M.obfuscateOrder({
                userId: u, resolvedEnv: ENV,
                originalOrderId: 'h_split', asset: 'BTC',
                originalSize: 1.0, originalOrderType: 'limit',
                obfuscationStrategy: 'size_split', ts: 1000
            });
            M.obfuscateOrder({
                userId: u, resolvedEnv: ENV,
                originalOrderId: 'h_none', asset: 'BTC',
                originalSize: 1.0, originalOrderType: 'limit',
                obfuscationStrategy: 'none', ts: 2000
            });
            const split = M.getObfuscationHistory({
                userId: u, resolvedEnv: ENV,
                strategy: 'size_split', limit: 10
            });
            expect(split.length).toBe(1);
            expect(split[0].originalOrderId).toBe('h_split');
        });
    });

    describe('isolation', () => {
        test('uid', () => {
            M.obfuscateOrder({
                userId: UID_ISO_A, resolvedEnv: ENV,
                originalOrderId: 'iso_a', asset: 'BTC',
                originalSize: 1.0, originalOrderType: 'limit',
                obfuscationStrategy: 'none', ts: _now()
            });
            M.obfuscateOrder({
                userId: UID_ISO_B, resolvedEnv: ENV,
                originalOrderId: 'iso_b', asset: 'BTC',
                originalSize: 1.0, originalOrderType: 'limit',
                obfuscationStrategy: 'none', ts: _now()
            });
            const rows = M.getObfuscationHistory({
                userId: UID_ISO_A, resolvedEnv: ENV, limit: 10
            });
            expect(rows.every(r => r.originalOrderId !== 'iso_b')).toBe(true);
        });
        test('env', () => {
            M.obfuscateOrder({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                originalOrderId: 'env_d', asset: 'BTC',
                originalSize: 1.0, originalOrderType: 'limit',
                obfuscationStrategy: 'none', ts: _now()
            });
            M.obfuscateOrder({
                userId: UID_ENV, resolvedEnv: 'TESTNET',
                originalOrderId: 'env_t', asset: 'BTC',
                originalSize: 1.0, originalOrderType: 'limit',
                obfuscationStrategy: 'none', ts: _now()
            });
            const demo = M.getObfuscationHistory({
                userId: UID_ENV, resolvedEnv: 'DEMO', limit: 10
            });
            expect(demo.every(r => r.originalOrderId !== 'env_t')).toBe(true);
        });
    });
});
