'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p36-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const tr = require('../../../server/services/ml/R3B_numerical_rules/thresholdRegistry');

const TEST_USER = 9036;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare(`DELETE FROM ml_threshold_overrides WHERE user_id = ?`).run(TEST_USER);
    db.prepare(`DELETE FROM ml_thresholds_canonical WHERE name LIKE 'test-%'`).run();
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§36 Migration 067 — thresholds canonical + overrides', () => {
    test('table ml_thresholds_canonical exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_thresholds_canonical'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('table ml_threshold_overrides exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_threshold_overrides'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('ml_thresholds_canonical has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_thresholds_canonical)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'name', 'category', 'default_value', 'description',
            'version', 'created_at', 'updated_at'
        ]));
    });

    test('ml_threshold_overrides has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_threshold_overrides)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'threshold_name',
            'value', 'regime', 'reason', 'actor', 'created_at'
        ]));
    });

    test('ml_thresholds_canonical name UNIQUE', () => {
        db.prepare(
            `INSERT INTO ml_thresholds_canonical
             (name, category, default_value, description, version, created_at, updated_at)
             VALUES ('dup-test', 'risk', 0.5, 'test', 'v1', ?, ?)`
        ).run(Date.now(), Date.now());
        expect(() => db.prepare(
            `INSERT INTO ml_thresholds_canonical
             (name, category, default_value, description, version, created_at, updated_at)
             VALUES ('dup-test', 'risk', 0.5, 'test', 'v1', ?, ?)`
        ).run(Date.now(), Date.now())).toThrow();
        db.prepare(`DELETE FROM ml_thresholds_canonical WHERE name = 'dup-test'`).run();
    });
});

describe('§36 Exported constants', () => {
    test('THRESHOLD_CATEGORIES has 17 spec entries', () => {
        expect(tr.THRESHOLD_CATEGORIES).toHaveLength(17);
        expect(tr.THRESHOLD_CATEGORIES).toEqual(expect.arrayContaining([
            'meta_score', 'rr', 'max_risk_per_trade', 'max_daily_loss',
            'max_weekly_dd', 'max_leverage_per_regime',
            'funding_sigma', 'oi_sigma', 'latency', 'api_rate',
            'drift', 'confidence_bucket', 'auto_pause',
            'observer_activation', 'adaptive_mode',
            'min_probability_entry', 'capital_allocation_cap'
        ]));
    });

    test('DEFAULT_THRESHOLDS has concrete values (not null/undefined)', () => {
        for (const cat of tr.THRESHOLD_CATEGORIES) {
            const val = tr.DEFAULT_THRESHOLDS[cat];
            expect(val).not.toBeNull();
            expect(val).not.toBeUndefined();
            expect(typeof val).toBe('number');
            expect(Number.isFinite(val)).toBe(true);
        }
    });

    test('canonical defaults are pre-registered on module load', () => {
        const list = tr.listThresholds({});
        expect(list.length).toBeGreaterThanOrEqual(17);
        const names = list.map(t => t.name);
        for (const cat of tr.THRESHOLD_CATEGORIES) {
            expect(names).toContain(cat);
        }
    });
});

describe('§36 registerThreshold', () => {
    test('creates new threshold entry', () => {
        const r = tr.registerThreshold({
            name: 'test-thresh-1',
            category: 'meta_score',
            defaultValue: 0.65,
            description: 'test threshold',
            version: 'v1.0'
        });
        expect(r.registered).toBe(true);
    });

    test('throws on duplicate name', () => {
        tr.registerThreshold({
            name: 'test-dup-thresh',
            category: 'max_risk_per_trade', defaultValue: 0.02,
            description: 'test', version: 'v1'
        });
        expect(() => tr.registerThreshold({
            name: 'test-dup-thresh',
            category: 'max_risk_per_trade', defaultValue: 0.03,
            description: 'test2', version: 'v2'
        })).toThrow();
    });

    test('throws on invalid category', () => {
        expect(() => tr.registerThreshold({
            name: 'test-bad-cat',
            category: 'BOGUS', defaultValue: 1,
            description: 'test', version: 'v1'
        })).toThrow(/category/);
    });

    test('throws on non-numeric defaultValue', () => {
        expect(() => tr.registerThreshold({
            name: 'test-bad-value',
            category: 'max_risk_per_trade', defaultValue: 'not a number',
            description: 'test', version: 'v1'
        })).toThrow(/value|number/i);
    });
});

describe('§36 getThreshold — resolution chain', () => {
    test('returns canonical default when no override', () => {
        const r = tr.getThreshold({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            name: 'meta_score'
        });
        expect(r.value).toBeCloseTo(tr.DEFAULT_THRESHOLDS.meta_score);
        expect(r.source).toBe('canonical');
    });

    test('returns user override when set', () => {
        tr.setOverride({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            name: 'meta_score', value: 0.75,
            reason: 'test', actor: 'operator'
        });
        const r = tr.getThreshold({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            name: 'meta_score'
        });
        expect(r.value).toBeCloseTo(0.75);
        expect(r.source).toBe('override');
    });

    test('regime-specific override beats general override', () => {
        tr.setOverride({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            name: 'meta_score', value: 0.65,
            reason: 'general', actor: 'op'
        });
        tr.setOverride({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            name: 'meta_score', value: 0.80, regime: 'trend',
            reason: 'trend-specific', actor: 'op'
        });
        const r = tr.getThreshold({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            name: 'meta_score', regime: 'trend'
        });
        expect(r.value).toBeCloseTo(0.80);
        expect(r.source).toBe('override-regime');
    });

    test('returns null for unknown threshold', () => {
        const r = tr.getThreshold({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            name: 'nonexistent_threshold'
        });
        expect(r.value).toBeNull();
    });
});

describe('§36 setOverride + clearOverride', () => {
    test('setOverride records row', () => {
        tr.setOverride({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            name: 'max_daily_loss', value: 0.05,
            reason: 'aggressive_mode', actor: 'operator'
        });
        const rows = db.prepare(
            `SELECT * FROM ml_threshold_overrides WHERE user_id = ?`
        ).all(TEST_USER);
        expect(rows).toHaveLength(1);
    });

    test('clearOverride removes override', () => {
        tr.setOverride({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            name: 'max_daily_loss', value: 0.05,
            reason: 'r', actor: 'op'
        });
        tr.clearOverride({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            name: 'max_daily_loss', reason: 'revert', actor: 'op'
        });
        const r = tr.getThreshold({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            name: 'max_daily_loss'
        });
        expect(r.source).toBe('canonical');
    });

    test('throws on unknown threshold', () => {
        expect(() => tr.setOverride({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            name: 'nonexistent', value: 0.5,
            reason: 'r', actor: 'op'
        })).toThrow(/threshold|name/i);
    });

    test('subsequent setOverride replaces prior (same regime)', () => {
        tr.setOverride({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            name: 'max_risk_per_trade', value: 0.01,
            reason: 'r1', actor: 'op'
        });
        tr.setOverride({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            name: 'max_risk_per_trade', value: 0.02,
            reason: 'r2', actor: 'op'
        });
        const r = tr.getThreshold({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            name: 'max_risk_per_trade'
        });
        expect(r.value).toBeCloseTo(0.02);
    });
});

describe('§36 listThresholds', () => {
    test('returns all canonical thresholds by default', () => {
        const list = tr.listThresholds({});
        expect(list.length).toBeGreaterThanOrEqual(17);
    });

    test('filters by category', () => {
        const list = tr.listThresholds({ category: 'max_risk_per_trade' });
        for (const t of list) {
            expect(t.category).toBe('max_risk_per_trade');
        }
        expect(list.length).toBeGreaterThan(0);
    });
});

describe('§36 validateAllSet — INVARIANT (line 1409-1410)', () => {
    test('all 17 spec categories have canonical defaults', () => {
        const r = tr.validateAllSet();
        expect(r.allSet).toBe(true);
        expect(r.missing).toEqual([]);
    });
});

describe('§36 isolation', () => {
    test('per (user × env) override isolation', () => {
        const OTHER_USER = 9037;
        tr.setOverride({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            name: 'meta_score', value: 0.85,
            reason: 'user1', actor: 'op'
        });
        const r1 = tr.getThreshold({
            userId: TEST_USER, resolvedEnv: TEST_ENV, name: 'meta_score'
        });
        const r2 = tr.getThreshold({
            userId: OTHER_USER, resolvedEnv: TEST_ENV, name: 'meta_score'
        });
        expect(r1.value).toBeCloseTo(0.85);
        expect(r2.value).toBeCloseTo(tr.DEFAULT_THRESHOLDS.meta_score);
        db.prepare(`DELETE FROM ml_threshold_overrides WHERE user_id = ?`).run(OTHER_USER);
    });
});
