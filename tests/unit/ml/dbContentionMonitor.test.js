'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-obs6-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const cm = require('../../../server/services/ml/R0_substrate/dbContentionMonitor');

const TEST_USER = 9006;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_db_contention_log WHERE user_id = ?').run(TEST_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('OBS-6 Migration 082', () => {
    test('table ml_db_contention_log exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_db_contention_log'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_db_contention_log)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'operation', 'duration_ms',
            'lock_wait_ms', 'error_msg', 'created_at'
        ]));
    });
});

describe('OBS-6 Exported constants', () => {
    test('OPERATION_TYPES includes common DB ops', () => {
        expect(cm.OPERATION_TYPES).toEqual(expect.arrayContaining([
            'read', 'write', 'transaction', 'migration'
        ]));
    });

    test('CONTENTION_THRESHOLDS finite values', () => {
        expect(cm.CONTENTION_THRESHOLDS.slow_op_ms).toBeGreaterThan(0);
        expect(cm.CONTENTION_THRESHOLDS.high_lock_wait_ms).toBeGreaterThan(0);
        expect(cm.CONTENTION_THRESHOLDS.contention_density).toBeGreaterThan(0);
    });
});

describe('OBS-6 recordOperation', () => {
    test('records operation row', () => {
        cm.recordOperation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            operation: 'write', durationMs: 25
        });
        const rows = db.prepare(
            `SELECT * FROM ml_db_contention_log WHERE user_id = ?`
        ).all(TEST_USER);
        expect(rows).toHaveLength(1);
        expect(rows[0].operation).toBe('write');
        expect(rows[0].duration_ms).toBe(25);
    });

    test('records lock wait time when provided', () => {
        cm.recordOperation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            operation: 'write', durationMs: 100,
            lockWaitMs: 80
        });
        const row = db.prepare(
            `SELECT * FROM ml_db_contention_log WHERE user_id = ?`
        ).get(TEST_USER);
        expect(row.lock_wait_ms).toBe(80);
    });

    test('records error message when provided', () => {
        cm.recordOperation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            operation: 'transaction', durationMs: 500,
            errorMsg: 'SQLITE_BUSY'
        });
        const row = db.prepare(
            `SELECT * FROM ml_db_contention_log WHERE user_id = ?`
        ).get(TEST_USER);
        expect(row.error_msg).toBe('SQLITE_BUSY');
    });
});

describe('OBS-6 detectContention (pure)', () => {
    test('no contention when ops are fast', () => {
        const r = cm.detectContention({
            recentOps: [
                { durationMs: 5, lockWaitMs: 0 },
                { durationMs: 8, lockWaitMs: 0 }
            ]
        });
        expect(r.contentionDetected).toBe(false);
    });

    test('high lock wait time → contention', () => {
        const r = cm.detectContention({
            recentOps: [
                { durationMs: 100, lockWaitMs: 200 },
                { durationMs: 120, lockWaitMs: 250 },
                { durationMs: 80, lockWaitMs: 180 }
            ]
        });
        expect(r.contentionDetected).toBe(true);
    });

    test('density of slow ops → contention', () => {
        const slow = Array.from({ length: 10 }, () => ({
            durationMs: 500, lockWaitMs: 50
        }));
        const r = cm.detectContention({ recentOps: slow });
        expect(r.contentionDetected).toBe(true);
    });

    test('empty ops → no contention', () => {
        const r = cm.detectContention({ recentOps: [] });
        expect(r.contentionDetected).toBe(false);
    });

    test('returns severity score', () => {
        const r = cm.detectContention({
            recentOps: [
                { durationMs: 1000, lockWaitMs: 500 },
                { durationMs: 1200, lockWaitMs: 700 }
            ]
        });
        expect(r.severity).toBeGreaterThan(0);
        expect(r.severity).toBeLessThanOrEqual(1);
    });
});

describe('OBS-6 getContentionStats', () => {
    beforeEach(() => {
        for (let i = 0; i < 5; i++) {
            cm.recordOperation({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                operation: 'write', durationMs: 10 + i * 20
            });
        }
    });

    test('returns rolling stats', () => {
        const r = cm.getContentionStats({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.totalOps).toBe(5);
        expect(r.avgDurationMs).toBeGreaterThan(0);
        expect(r.maxDurationMs).toBeGreaterThan(0);
    });

    test('filters by operation type', () => {
        cm.recordOperation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            operation: 'read', durationMs: 5
        });
        const r = cm.getContentionStats({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            operation: 'write'
        });
        expect(r.totalOps).toBe(5);  // only writes
    });

    test('filters by since', () => {
        const r = cm.getContentionStats({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            since: Date.now() + 1000
        });
        expect(r.totalOps).toBe(0);
    });
});

describe('OBS-6 getLongOperations', () => {
    beforeEach(() => {
        cm.recordOperation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            operation: 'write', durationMs: 10
        });
        cm.recordOperation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            operation: 'write', durationMs: 500
        });
        cm.recordOperation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            operation: 'transaction', durationMs: 1500
        });
    });

    test('returns operations exceeding threshold', () => {
        const r = cm.getLongOperations({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            thresholdMs: 100
        });
        expect(r).toHaveLength(2);
    });

    test('returns ordered by duration descending', () => {
        const r = cm.getLongOperations({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            thresholdMs: 100
        });
        expect(r[0].durationMs).toBeGreaterThan(r[1].durationMs);
    });

    test('default threshold from CONTENTION_THRESHOLDS', () => {
        const r = cm.getLongOperations({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.length).toBeGreaterThan(0);
    });

    test('respects limit', () => {
        const r = cm.getLongOperations({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            thresholdMs: 50, limit: 1
        });
        expect(r).toHaveLength(1);
    });
});

describe('OBS-6 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9007;
        cm.recordOperation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            operation: 'write', durationMs: 50
        });
        cm.recordOperation({
            userId: OTHER_USER, resolvedEnv: TEST_ENV,
            operation: 'write', durationMs: 5000
        });
        const r1 = cm.getContentionStats({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const r2 = cm.getContentionStats({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(r1.maxDurationMs).toBe(50);
        expect(r2.maxDurationMs).toBe(5000);
        db.prepare(`DELETE FROM ml_db_contention_log WHERE user_id = ?`).run(OTHER_USER);
    });
});
