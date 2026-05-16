'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p106-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const cm = require('../../../server/services/ml/R5B_governance/competenceMap');

const TEST_USER = 9106;
const OTHER_USER = 9107;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_competence_cells WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
    db.prepare('DELETE FROM ml_competence_decisions WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§106 Migrations 201 + 202', () => {
    test('cell_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_competence_cells
             (user_id, resolved_env, cell_id, dimensions_json,
              validity_score, sample_count, win_rate, action_permission,
              last_updated, ts_created)
             VALUES (?, ?, 'CC-UNIQ', '{}', 0.8, 50, 0.8, 'allowed', ?, ?)`
        ).run(TEST_USER, TEST_ENV, ts, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_competence_cells
             (user_id, resolved_env, cell_id, dimensions_json,
              validity_score, sample_count, win_rate, action_permission,
              last_updated, ts_created)
             VALUES (?, ?, 'CC-UNIQ', '{}', 0.5, 100, 0.5, 'reduced_size', ?, ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1, ts + 1)).toThrow();
    });

    test('CHECK action_permission restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_competence_cells
             (user_id, resolved_env, cell_id, dimensions_json,
              validity_score, sample_count, win_rate, action_permission,
              last_updated, ts_created)
             VALUES (?, ?, 'CC-BAD', '{}', 0.8, 50, 0.8, 'BOGUS', ?, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now(), Date.now())).toThrow();
    });

    test('CHECK validity_score range', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_competence_cells
             (user_id, resolved_env, cell_id, dimensions_json,
              validity_score, sample_count, win_rate, action_permission,
              last_updated, ts_created)
             VALUES (?, ?, 'CC-OOR', '{}', 1.5, 50, 0.5, 'allowed', ?, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now(), Date.now())).toThrow();
    });
});

describe('§106 Constants', () => {
    test('ACTION_PERMISSIONS has 4 entries', () => {
        expect(cm.ACTION_PERMISSIONS).toEqual([
            'allowed', 'reduced_size', 'shadow_only', 'observer_only'
        ]);
    });

    test('VALIDITY_THRESHOLDS strictly decreasing', () => {
        expect(cm.VALIDITY_THRESHOLDS.allowed)
            .toBeGreaterThan(cm.VALIDITY_THRESHOLDS.reduced);
        expect(cm.VALIDITY_THRESHOLDS.reduced)
            .toBeGreaterThan(cm.VALIDITY_THRESHOLDS.shadow);
    });

    test('MIN_SAMPLES_FOR_VALIDITY positive', () => {
        expect(cm.MIN_SAMPLES_FOR_VALIDITY).toBeGreaterThan(0);
    });
});

describe('§106 computePermissionFromValidity (pure)', () => {
    test('insufficient samples → observer_only', () => {
        const r = cm.computePermissionFromValidity({
            validity: 0.95, sampleCount: 5
        });
        expect(r.permission).toBe('observer_only');
        expect(r.reason).toBe('insufficient_samples');
    });

    test('high validity → allowed', () => {
        const r = cm.computePermissionFromValidity({
            validity: 0.80, sampleCount: 100
        });
        expect(r.permission).toBe('allowed');
    });

    test('medium validity → reduced_size', () => {
        const r = cm.computePermissionFromValidity({
            validity: 0.55, sampleCount: 100
        });
        expect(r.permission).toBe('reduced_size');
    });

    test('low validity → shadow_only', () => {
        const r = cm.computePermissionFromValidity({
            validity: 0.35, sampleCount: 100
        });
        expect(r.permission).toBe('shadow_only');
    });

    test('very low validity → observer_only', () => {
        const r = cm.computePermissionFromValidity({
            validity: 0.10, sampleCount: 100
        });
        expect(r.permission).toBe('observer_only');
    });
});

describe('§106 registerCompetenceCell', () => {
    test('persists with auto-computed permission', () => {
        const r = cm.registerCompetenceCell({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            cellId: 'RC-1',
            dimensions: { asset: 'BTC', regime: 'trend' },
            initialValidity: 0.85, initialSamples: 100
        });
        expect(r.registered).toBe(true);
        expect(r.actionPermission).toBe('allowed');
    });

    test('initialPermission override respected', () => {
        const r = cm.registerCompetenceCell({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            cellId: 'RC-OV',
            dimensions: { asset: 'ETH' },
            initialValidity: 0.9, initialSamples: 100,
            initialPermission: 'shadow_only'
        });
        expect(r.actionPermission).toBe('shadow_only');
    });

    test('duplicate throws', () => {
        cm.registerCompetenceCell({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            cellId: 'RC-DUP', dimensions: { asset: 'X' }
        });
        expect(() => cm.registerCompetenceCell({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            cellId: 'RC-DUP', dimensions: { asset: 'Y' }
        })).toThrow();
    });

    test('invalid initialPermission throws', () => {
        expect(() => cm.registerCompetenceCell({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            cellId: 'RC-BAD', dimensions: {},
            initialPermission: 'BOGUS'
        })).toThrow();
    });
});

describe('§106 updateCompetenceMetrics', () => {
    test('rising win_rate upgrades permission', () => {
        cm.registerCompetenceCell({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            cellId: 'UM-1', dimensions: {},
            initialValidity: 0.4, initialSamples: 100
        });
        const r = cm.updateCompetenceMetrics({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            cellId: 'UM-1', newWinRate: 0.85, newSampleCount: 200
        });
        expect(r.newPermission).toBe('allowed');
    });

    test('falling win_rate downgrades permission', () => {
        cm.registerCompetenceCell({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            cellId: 'UM-2', dimensions: {},
            initialValidity: 0.85, initialSamples: 100
        });
        const r = cm.updateCompetenceMetrics({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            cellId: 'UM-2', newWinRate: 0.20, newSampleCount: 150
        });
        expect(r.newPermission).toBe('observer_only');
    });

    test('unknown cell throws', () => {
        expect(() => cm.updateCompetenceMetrics({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            cellId: 'NOEXIST', newWinRate: 0.5, newSampleCount: 50
        })).toThrow();
    });
});

describe('§106 lookupCompetence', () => {
    test('finds exact dimension match', () => {
        cm.registerCompetenceCell({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            cellId: 'LK-1',
            dimensions: { asset: 'BTC', regime: 'trend' }
        });
        const r = cm.lookupCompetence({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            dimensions: { asset: 'BTC', regime: 'trend' }
        });
        expect(r.found).toBe(true);
        expect(r.cellId).toBe('LK-1');
    });

    test('returns not-found for unknown dimensions', () => {
        const r = cm.lookupCompetence({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            dimensions: { asset: 'DOGE' }
        });
        expect(r.found).toBe(false);
    });
});

describe('§106 getCompetenceMap', () => {
    test('filter by permission', () => {
        cm.registerCompetenceCell({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            cellId: 'GM-A', dimensions: { asset: 'A' },
            initialValidity: 0.85, initialSamples: 100
        });
        cm.registerCompetenceCell({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            cellId: 'GM-B', dimensions: { asset: 'B' },
            initialValidity: 0.20, initialSamples: 100
        });
        const r = cm.getCompetenceMap({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            permissionFilter: 'allowed'
        });
        expect(r).toHaveLength(1);
        expect(r[0].cellId).toBe('GM-A');
    });
});

describe('§106 recordCompetenceDecision', () => {
    test('persists', () => {
        const r = cm.recordCompetenceDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'RD-1', decisionContext: 'BTC-trend-London',
            actionPermission: 'allowed', reason: 'high_validity_cell'
        });
        expect(r.recorded).toBe(true);
    });

    test('invalid action_permission throws', () => {
        expect(() => cm.recordCompetenceDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'RD-BAD', decisionContext: 'ctx',
            actionPermission: 'BOGUS', reason: 'r'
        })).toThrow();
    });
});

describe('§106 isolation', () => {
    test('per (user × env) isolation', () => {
        cm.registerCompetenceCell({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            cellId: 'ISO-1', dimensions: { asset: 'BTC' }
        });
        const a = cm.getCompetenceMap({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const b = cm.getCompetenceMap({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(a).toHaveLength(1);
        expect(b).toHaveLength(0);
    });
});
