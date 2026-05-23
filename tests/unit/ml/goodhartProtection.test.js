'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p90-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const gh = require('../../../server/services/ml/R5B_governance/goodhartProtection');

const TEST_USER = 9090;
const OTHER_USER = 9091;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_metric_registry WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
    db.prepare('DELETE FROM ml_metric_rotations WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§90 Migrations 169 + 170', () => {
    test('metric_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_metric_registry
             (user_id, resolved_env, metric_id, name, formula_hash, kind,
              model_visible, status, active_from)
             VALUES (?, ?, 'M-UNIQ', 'brier', 'h1', 'primary', 1, 'ACTIVE', ?)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_metric_registry
             (user_id, resolved_env, metric_id, name, formula_hash, kind,
              model_visible, status, active_from)
             VALUES (?, ?, 'M-UNIQ', 'hit', 'h2', 'secondary', 1, 'ACTIVE', ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('CHECK kind restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_metric_registry
             (user_id, resolved_env, metric_id, name, formula_hash, kind,
              model_visible, status, active_from)
             VALUES (?, ?, 'M-BAD', 'x', 'h', 'BOGUS', 1, 'ACTIVE', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('rotation_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_metric_rotations
             (user_id, resolved_env, rotation_id, retired_metric_ids,
              new_metric_ids, rotation_reason, ts)
             VALUES (?, ?, 'R-UNIQ', '[]', '[]', 'r1', ?)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_metric_rotations
             (user_id, resolved_env, rotation_id, retired_metric_ids,
              new_metric_ids, rotation_reason, ts)
             VALUES (?, ?, 'R-UNIQ', '[]', '[]', 'r2', ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });
});

describe('§90 Constants', () => {
    test('METRIC_KINDS has 3 entries', () => {
        expect(gh.METRIC_KINDS).toEqual(['primary', 'secondary', 'holdout']);
    });

    test('GAMING_PATTERNS has 4 entries', () => {
        expect(gh.GAMING_PATTERNS).toEqual([
            'VARIANCE_COLLAPSE', 'CLUSTERING', 'MONOTONIC_DRIFT', 'HEALTHY'
        ]);
    });

    test('VARIANCE_COLLAPSE_THRESHOLD positive', () => {
        expect(gh.VARIANCE_COLLAPSE_THRESHOLD).toBeGreaterThan(0);
    });
});

describe('§90 registerMetric', () => {
    test('primary metric defaults model_visible=true', () => {
        const r = gh.registerMetric({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            metricId: 'M-PRIMARY', name: 'brier', formulaHash: 'h-brier',
            kind: 'primary'
        });
        expect(r.registered).toBe(true);
        expect(r.modelVisible).toBe(true);
    });

    test('holdout enforces model_visible=false', () => {
        const r = gh.registerMetric({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            metricId: 'M-HIDE', name: 'hidden_brier', formulaHash: 'h-hide',
            kind: 'holdout', modelVisible: true   // explicitly true
        });
        expect(r.modelVisible).toBe(false);   // overridden
    });

    test('duplicate throws', () => {
        gh.registerMetric({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            metricId: 'M-DUP', name: 'x', formulaHash: 'h', kind: 'primary'
        });
        expect(() => gh.registerMetric({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            metricId: 'M-DUP', name: 'y', formulaHash: 'h2', kind: 'secondary'
        })).toThrow();
    });

    test('invalid kind throws', () => {
        expect(() => gh.registerMetric({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            metricId: 'M-BAD', name: 'x', formulaHash: 'h', kind: 'BOGUS'
        })).toThrow();
    });
});

describe('§90 getActiveMetrics', () => {
    test('returns ACTIVE metrics', () => {
        gh.registerMetric({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            metricId: 'M-A', name: 'a', formulaHash: 'h', kind: 'primary'
        });
        gh.registerMetric({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            metricId: 'M-B', name: 'b', formulaHash: 'h', kind: 'holdout'
        });
        const rs = gh.getActiveMetrics({ userId: TEST_USER, resolvedEnv: TEST_ENV });
        expect(rs).toHaveLength(2);
    });

    test('modelVisibleOnly filters holdout', () => {
        gh.registerMetric({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            metricId: 'M-V', name: 'v', formulaHash: 'h', kind: 'primary'
        });
        gh.registerMetric({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            metricId: 'M-H', name: 'h', formulaHash: 'h', kind: 'holdout'
        });
        const rs = gh.getActiveMetrics({
            userId: TEST_USER, resolvedEnv: TEST_ENV, modelVisibleOnly: true
        });
        expect(rs).toHaveLength(1);
        expect(rs[0].metricId).toBe('M-V');
    });
});

describe('§90 detectGamingPattern', () => {
    test('insufficient samples → HEALTHY + sufficient=false', () => {
        const r = gh.detectGamingPattern({ values: [0.1, 0.2, 0.3] });
        expect(r.pattern).toBe('HEALTHY');
        expect(r.sufficient).toBe(false);
    });

    test('variance collapse pattern', () => {
        const r = gh.detectGamingPattern({
            values: [0.5, 0.5, 0.5, 0.5, 0.5, 0.501, 0.5, 0.5, 0.5, 0.5, 0.5]
        });
        expect(r.pattern).toBe('VARIANCE_COLLAPSE');
    });

    test('clustering pattern', () => {
        // bulk-cluster around 0.5 + outliers — stddev > variance collapse threshold,
        // density >= 80% within 1 stddev
        const r = gh.detectGamingPattern({
            values: [0.50, 0.50, 0.50, 0.50, 0.50, 0.50, 0.50, 0.50, 0.50, 0.50, 1.0]
        });
        expect(r.pattern).toBe('CLUSTERING');
    });

    test('monotonic drift pattern', () => {
        const r = gh.detectGamingPattern({
            values: [0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90, 0.95, 0.99]
        });
        expect(r.pattern).toBe('MONOTONIC_DRIFT');
    });

    test('healthy values', () => {
        const r = gh.detectGamingPattern({
            values: [0.1, 0.6, 0.3, 0.8, 0.2, 0.7, 0.4, 0.9, 0.5, 0.25, 0.65]
        });
        expect(r.pattern).toBe('HEALTHY');
    });
});

describe('§90 rotateMetrics', () => {
    test('atomic rotation retires + logs audit', () => {
        gh.registerMetric({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            metricId: 'M-OLD', name: 'old', formulaHash: 'h', kind: 'primary'
        });
        gh.registerMetric({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            metricId: 'M-NEW', name: 'new', formulaHash: 'h2', kind: 'primary'
        });
        const r = gh.rotateMetrics({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            rotationId: 'ROT-1',
            retiredIds: ['M-OLD'], newIds: ['M-NEW'],
            reason: 'gaming_detected'
        });
        expect(r.rotated).toBe(true);
        const active = gh.getActiveMetrics({ userId: TEST_USER, resolvedEnv: TEST_ENV });
        expect(active.map(m => m.metricId)).toEqual(['M-NEW']);
        const hist = gh.getRotationHistory({ userId: TEST_USER, resolvedEnv: TEST_ENV });
        expect(hist).toHaveLength(1);
    });

    test('empty retiredIds throws', () => {
        expect(() => gh.rotateMetrics({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            rotationId: 'ROT-EMPTY', retiredIds: [], newIds: ['x'],
            reason: 'r'
        })).toThrow();
    });

    test('duplicate rotation_id throws', () => {
        gh.registerMetric({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            metricId: 'M-X', name: 'x', formulaHash: 'h', kind: 'primary'
        });
        gh.rotateMetrics({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            rotationId: 'ROT-DUP', retiredIds: ['M-X'], newIds: [],
            reason: 'r'
        });
        expect(() => gh.rotateMetrics({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            rotationId: 'ROT-DUP', retiredIds: ['M-X'], newIds: [],
            reason: 'r2'
        })).toThrow();
    });
});

describe('§90 evaluateHoldout', () => {
    test('computes mse + hitRate against ground truth', () => {
        gh.registerMetric({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            metricId: 'M-HOLD', name: 'hold', formulaHash: 'h', kind: 'holdout'
        });
        const r = gh.evaluateHoldout({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            holdoutMetricId: 'M-HOLD',
            predictions: [0.8, 0.2, 0.9, 0.1],
            groundTruth:  [1.0, 0.0, 1.0, 0.0]
        });
        expect(r.samples).toBe(4);
        expect(r.hitRate).toBe(1.0);
        expect(r.modelVisible).toBe(false);
    });

    test('throws if metric not holdout kind', () => {
        gh.registerMetric({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            metricId: 'M-NOTHOLD', name: 'x', formulaHash: 'h', kind: 'primary'
        });
        expect(() => gh.evaluateHoldout({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            holdoutMetricId: 'M-NOTHOLD',
            predictions: [0.5], groundTruth: [1.0]
        })).toThrow();
    });

    test('throws on length mismatch', () => {
        gh.registerMetric({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            metricId: 'M-LEN', name: 'x', formulaHash: 'h', kind: 'holdout'
        });
        expect(() => gh.evaluateHoldout({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            holdoutMetricId: 'M-LEN',
            predictions: [0.5, 0.6], groundTruth: [1.0]
        })).toThrow();
    });
});

describe('§90 isolation', () => {
    test('per (user × env) isolation', () => {
        gh.registerMetric({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            metricId: 'M-ISO', name: 'x', formulaHash: 'h', kind: 'primary'
        });
        const a = gh.getActiveMetrics({ userId: TEST_USER, resolvedEnv: TEST_ENV });
        const b = gh.getActiveMetrics({ userId: OTHER_USER, resolvedEnv: TEST_ENV });
        expect(a).toHaveLength(1);
        expect(b).toHaveLength(0);
    });
});
