'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p41-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const sc = require('../../../server/services/ml/R5A_learning/strategyCrowdingDetector');

const TEST_USER = 9041;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_strategy_crowding WHERE user_id = ?').run(TEST_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§41 Migration 097', () => {
    test('table ml_strategy_crowding exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_strategy_crowding'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_strategy_crowding)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'setup_type',
            'hit_rate', 'slippage_bps', 'created_at'
        ]));
    });

    test('CHECK setup_type restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_strategy_crowding
             (user_id, resolved_env, setup_type, hit_rate, created_at)
             VALUES (?, ?, 'BOGUS', 0.5, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§41 Exported constants', () => {
    test('SETUP_TYPES has expected entries', () => {
        expect(sc.SETUP_TYPES).toEqual(expect.arrayContaining([
            'liquidity_sweep', 'funding_extreme', 'cross_venue_div',
            'stop_run_reclaim', 'cvd_divergence'
        ]));
    });

    test('DEGRADATION_THRESHOLD = 0.20 per spec', () => {
        expect(sc.DEGRADATION_THRESHOLD).toBeCloseTo(0.20);
    });

    test('MIN_SAMPLES_FOR_DETECTION positive', () => {
        expect(sc.MIN_SAMPLES_FOR_DETECTION).toBeGreaterThan(0);
    });
});

describe('§41 recordSetupOutcome', () => {
    test('records outcome row', () => {
        sc.recordSetupOutcome({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupType: 'liquidity_sweep',
            hitRate: 0.55,
            slippage: 3
        });
        const rows = db.prepare(
            `SELECT * FROM ml_strategy_crowding WHERE user_id = ?`
        ).all(TEST_USER);
        expect(rows).toHaveLength(1);
        expect(rows[0].setup_type).toBe('liquidity_sweep');
    });

    test('throws on invalid setupType', () => {
        expect(() => sc.recordSetupOutcome({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupType: 'bogus',
            hitRate: 0.5
        })).toThrow(/setup/i);
    });
});

describe('§41 detectCrowding', () => {
    test('returns no crowding for fresh setup', () => {
        for (let i = 0; i < 30; i++) {
            sc.recordSetupOutcome({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                setupType: 'liquidity_sweep',
                hitRate: 0.65
            });
        }
        const r = sc.detectCrowding({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupType: 'liquidity_sweep'
        });
        expect(r.crowdingDetected).toBe(false);
    });

    test('detects crowding when hit rate degrades significantly', () => {
        // Old baseline (high hit rate)
        const now = Date.now();
        for (let i = 0; i < 20; i++) {
            sc.recordSetupOutcome({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                setupType: 'liquidity_sweep',
                hitRate: 0.70
            });
        }
        // Backdate old entries
        db.prepare(
            `UPDATE ml_strategy_crowding SET created_at = ? WHERE user_id = ?`
        ).run(now - 60 * 86400000, TEST_USER);
        // Recent low hit rate
        for (let i = 0; i < 20; i++) {
            sc.recordSetupOutcome({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                setupType: 'liquidity_sweep',
                hitRate: 0.40
            });
        }
        const r = sc.detectCrowding({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupType: 'liquidity_sweep'
        });
        expect(r.crowdingDetected).toBe(true);
        expect(r.degradationPct).toBeGreaterThan(0.20);
    });

    test('returns no detection with insufficient samples', () => {
        sc.recordSetupOutcome({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupType: 'funding_extreme',
            hitRate: 0.5
        });
        const r = sc.detectCrowding({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupType: 'funding_extreme'
        });
        expect(r.crowdingDetected).toBe(false);
        expect(r.reason).toMatch(/insufficient/i);
    });
});

describe('§41 getDegradedSetups', () => {
    test('returns empty when no degradation', () => {
        for (let i = 0; i < 20; i++) {
            sc.recordSetupOutcome({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                setupType: 'liquidity_sweep',
                hitRate: 0.65
            });
        }
        const r = sc.getDegradedSetups({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r).toEqual([]);
    });

    test('returns degraded list', () => {
        // Create degraded setup
        const now = Date.now();
        for (let i = 0; i < 15; i++) {
            sc.recordSetupOutcome({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                setupType: 'stop_run_reclaim',
                hitRate: 0.70
            });
        }
        db.prepare(
            `UPDATE ml_strategy_crowding SET created_at = ? WHERE user_id = ?`
        ).run(now - 60 * 86400000, TEST_USER);
        for (let i = 0; i < 15; i++) {
            sc.recordSetupOutcome({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                setupType: 'stop_run_reclaim',
                hitRate: 0.30
            });
        }
        const r = sc.getDegradedSetups({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.length).toBeGreaterThan(0);
        expect(r[0].setupType).toBe('stop_run_reclaim');
    });
});

describe('§41 getSetupTrend', () => {
    beforeEach(() => {
        for (let i = 0; i < 5; i++) {
            sc.recordSetupOutcome({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                setupType: 'cvd_divergence',
                hitRate: 0.5 + i * 0.05
            });
        }
    });

    test('returns rolling stats', () => {
        const r = sc.getSetupTrend({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupType: 'cvd_divergence'
        });
        expect(r.totalObservations).toBe(5);
        expect(r.avgHitRate).toBeGreaterThan(0);
    });
});

describe('§41 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9042;
        sc.recordSetupOutcome({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupType: 'liquidity_sweep',
            hitRate: 0.5
        });
        const r1 = sc.getSetupTrend({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupType: 'liquidity_sweep'
        });
        const r2 = sc.getSetupTrend({
            userId: OTHER_USER, resolvedEnv: TEST_ENV,
            setupType: 'liquidity_sweep'
        });
        expect(r1.totalObservations).toBe(1);
        expect(r2.totalObservations).toBe(0);
    });
});
