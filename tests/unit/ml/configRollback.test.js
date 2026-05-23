'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-obs3-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const cr = require('../../../server/services/ml/R0_substrate/configRollback');

const TEST_USER = 9003;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_config_snapshots WHERE user_id = ?').run(TEST_USER);
    db.prepare('DELETE FROM ml_config_rollback_log WHERE user_id = ?').run(TEST_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('OBS-3 Migration 080', () => {
    test('table ml_config_snapshots exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_config_snapshots'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('table ml_config_rollback_log exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_config_rollback_log'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('snapshots has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_config_snapshots)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'config_key', 'value_json',
            'version', 'is_active', 'actor', 'reason', 'created_at'
        ]));
    });

    test('rollback_log has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_config_rollback_log)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'config_key',
            'from_version', 'to_version', 'reason', 'actor',
            'duration_ms', 'created_at'
        ]));
    });
});

describe('OBS-3 Exported constants', () => {
    test('ROLLBACK_REASONS has standard set', () => {
        expect(cr.ROLLBACK_REASONS).toEqual(expect.arrayContaining([
            'bad_deploy', 'performance_regression',
            'unintended_behavior', 'manual_revert', 'incident_response'
        ]));
    });

    test('CONFIG_CATEGORIES exists', () => {
        expect(Array.isArray(cr.CONFIG_CATEGORIES)).toBe(true);
        expect(cr.CONFIG_CATEGORIES.length).toBeGreaterThan(0);
    });

    test('TARGET_ROLLBACK_MS = 60000 (60s per spec)', () => {
        expect(cr.TARGET_ROLLBACK_MS).toBe(60000);
    });
});

describe('OBS-3 snapshotConfig', () => {
    test('records new snapshot as active', () => {
        cr.snapshotConfig({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            configKey: 'meta_score_threshold',
            value: 0.65, version: 'v1.0', actor: 'operator'
        });
        const rows = db.prepare(
            `SELECT * FROM ml_config_snapshots WHERE user_id = ?`
        ).all(TEST_USER);
        expect(rows).toHaveLength(1);
        expect(rows[0].is_active).toBe(1);
    });

    test('new snapshot deactivates old', () => {
        cr.snapshotConfig({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            configKey: 'threshold_x',
            value: 0.65, version: 'v1.0', actor: 'op'
        });
        cr.snapshotConfig({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            configKey: 'threshold_x',
            value: 0.75, version: 'v1.1', actor: 'op'
        });
        const rows = db.prepare(
            `SELECT * FROM ml_config_snapshots WHERE user_id = ? AND config_key = 'threshold_x'
             ORDER BY id ASC`
        ).all(TEST_USER);
        expect(rows[0].is_active).toBe(0);
        expect(rows[1].is_active).toBe(1);
    });

    test('stores value_json correctly', () => {
        cr.snapshotConfig({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            configKey: 'complex_config',
            value: { nested: true, array: [1, 2, 3] },
            version: 'v1', actor: 'op'
        });
        const row = db.prepare(
            `SELECT * FROM ml_config_snapshots WHERE user_id = ?`
        ).get(TEST_USER);
        const v = JSON.parse(row.value_json);
        expect(v.nested).toBe(true);
        expect(v.array).toEqual([1, 2, 3]);
    });
});

describe('OBS-3 getCurrentConfig', () => {
    test('returns null when no config exists', () => {
        const r = cr.getCurrentConfig({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            configKey: 'nonexistent'
        });
        expect(r).toBeNull();
    });

    test('returns current active config', () => {
        cr.snapshotConfig({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            configKey: 'active_thresh',
            value: 0.7, version: 'v1', actor: 'op'
        });
        const r = cr.getCurrentConfig({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            configKey: 'active_thresh'
        });
        expect(r.value).toBe(0.7);
        expect(r.version).toBe('v1');
    });
});

describe('OBS-3 rollbackConfig', () => {
    beforeEach(() => {
        cr.snapshotConfig({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            configKey: 'rollback_target',
            value: 0.5, version: 'v1.0', actor: 'op'
        });
        cr.snapshotConfig({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            configKey: 'rollback_target',
            value: 0.7, version: 'v2.0', actor: 'op'
        });
        cr.snapshotConfig({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            configKey: 'rollback_target',
            value: 0.9, version: 'v3.0', actor: 'op'
        });
    });

    test('rolls back to specified version', () => {
        cr.rollbackConfig({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            configKey: 'rollback_target',
            targetVersion: 'v1.0',
            reason: 'bad_deploy', actor: 'op'
        });
        const r = cr.getCurrentConfig({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            configKey: 'rollback_target'
        });
        expect(r.version).toBe('v1.0');
        expect(r.value).toBe(0.5);
    });

    test('rolls back to immediate previous when targetVersion omitted', () => {
        cr.rollbackConfig({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            configKey: 'rollback_target',
            reason: 'manual_revert', actor: 'op'
        });
        const r = cr.getCurrentConfig({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            configKey: 'rollback_target'
        });
        expect(r.version).toBe('v2.0');
    });

    test('logs rollback event', () => {
        cr.rollbackConfig({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            configKey: 'rollback_target',
            targetVersion: 'v1.0',
            reason: 'bad_deploy', actor: 'op'
        });
        const log = db.prepare(
            `SELECT * FROM ml_config_rollback_log WHERE user_id = ?`
        ).all(TEST_USER);
        expect(log).toHaveLength(1);
        expect(log[0].from_version).toBe('v3.0');
        expect(log[0].to_version).toBe('v1.0');
    });

    test('rollback duration tracked (must be <60s target)', () => {
        cr.rollbackConfig({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            configKey: 'rollback_target',
            targetVersion: 'v1.0',
            reason: 'incident_response', actor: 'op'
        });
        const log = db.prepare(
            `SELECT * FROM ml_config_rollback_log WHERE user_id = ?`
        ).get(TEST_USER);
        expect(log.duration_ms).toBeLessThan(60000);
    });

    test('throws when target version not found', () => {
        expect(() => cr.rollbackConfig({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            configKey: 'rollback_target',
            targetVersion: 'v999',
            reason: 'manual_revert', actor: 'op'
        })).toThrow();
    });
});

describe('OBS-3 getConfigHistory', () => {
    test('returns all versions for a key', () => {
        for (const v of ['v1', 'v2', 'v3']) {
            cr.snapshotConfig({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                configKey: 'history_key',
                value: 0.5, version: v, actor: 'op'
            });
        }
        const r = cr.getConfigHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            configKey: 'history_key'
        });
        expect(r).toHaveLength(3);
    });
});

describe('OBS-3 getRollbackHistory', () => {
    test('returns empty when no rollbacks', () => {
        const r = cr.getRollbackHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r).toEqual([]);
    });

    test('returns rollback events ordered', () => {
        cr.snapshotConfig({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            configKey: 'k', value: 1, version: 'v1', actor: 'op'
        });
        cr.snapshotConfig({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            configKey: 'k', value: 2, version: 'v2', actor: 'op'
        });
        cr.rollbackConfig({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            configKey: 'k', targetVersion: 'v1',
            reason: 'manual_revert', actor: 'op'
        });
        const r = cr.getRollbackHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r).toHaveLength(1);
    });
});

describe('OBS-3 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9004;
        cr.snapshotConfig({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            configKey: 'iso', value: 1, version: 'v1', actor: 'op'
        });
        const r1 = cr.getCurrentConfig({
            userId: TEST_USER, resolvedEnv: TEST_ENV, configKey: 'iso'
        });
        const r2 = cr.getCurrentConfig({
            userId: OTHER_USER, resolvedEnv: TEST_ENV, configKey: 'iso'
        });
        expect(r1.value).toBe(1);
        expect(r2).toBeNull();
    });
});
