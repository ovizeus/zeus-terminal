'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-execn3-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const rlp = require('../../../server/services/ml/R4_execution/rateLimitPriorityQueue');

const TEST_USER = 9003;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_api_request_queue WHERE user_id = ?').run(TEST_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('EXEC-N3 Migration 078', () => {
    test('table ml_api_request_queue exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_api_request_queue'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_api_request_queue)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'exchange', 'request_type',
            'priority', 'payload_json', 'status', 'deadline_at',
            'enqueued_at', 'processed_at'
        ]));
    });

    test('CHECK priority restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_api_request_queue
             (user_id, resolved_env, exchange, request_type, priority,
              payload_json, status, enqueued_at)
             VALUES (?, ?, 'binance', 'status', 'BOGUS', '{}', 'PENDING', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK status restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_api_request_queue
             (user_id, resolved_env, exchange, request_type, priority,
              payload_json, status, enqueued_at)
             VALUES (?, ?, 'binance', 'status', 'NORMAL', '{}', 'BOGUS', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('EXEC-N3 Exported constants', () => {
    test('PRIORITY_LEVELS has 4 levels', () => {
        expect(rlp.PRIORITY_LEVELS).toEqual(['CRITICAL', 'HIGH', 'NORMAL', 'LOW']);
    });

    test('QUEUE_STATUSES has 4 states', () => {
        expect(rlp.QUEUE_STATUSES).toEqual(['PENDING', 'SENT', 'EXPIRED', 'DROPPED']);
    });

    test('REQUEST_TYPES includes critical operations', () => {
        expect(rlp.REQUEST_TYPES).toEqual(expect.arrayContaining([
            'place_order', 'cancel_order', 'set_sl', 'set_tp',
            'force_exit', 'status_check', 'balance_check'
        ]));
    });

    test('REQUEST_PRIORITY_MAP has CRITICAL for force_exit', () => {
        expect(rlp.REQUEST_PRIORITY_MAP.force_exit).toBe('CRITICAL');
    });

    test('status_check has LOW priority', () => {
        expect(rlp.REQUEST_PRIORITY_MAP.status_check).toBe('LOW');
    });
});

describe('EXEC-N3 getRequestPriority (pure)', () => {
    test('force_exit → CRITICAL', () => {
        const r = rlp.getRequestPriority({ requestType: 'force_exit' });
        expect(r.priority).toBe('CRITICAL');
        expect(r.priorityScore).toBeGreaterThan(0);
    });

    test('status_check → LOW', () => {
        const r = rlp.getRequestPriority({ requestType: 'status_check' });
        expect(r.priority).toBe('LOW');
    });

    test('unknown request_type → NORMAL default', () => {
        const r = rlp.getRequestPriority({ requestType: 'unknown_type' });
        expect(r.priority).toBe('NORMAL');
    });

    test('CRITICAL has higher score than LOW', () => {
        const c = rlp.getRequestPriority({ requestType: 'force_exit' });
        const l = rlp.getRequestPriority({ requestType: 'status_check' });
        expect(c.priorityScore).toBeGreaterThan(l.priorityScore);
    });
});

describe('EXEC-N3 enqueueRequest', () => {
    test('records request in queue', () => {
        rlp.enqueueRequest({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            exchange: 'binance',
            requestType: 'place_order',
            payload: { symbol: 'BTCUSDT' }
        });
        const rows = db.prepare(
            `SELECT * FROM ml_api_request_queue WHERE user_id = ?`
        ).all(TEST_USER);
        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe('PENDING');
    });

    test('infers priority from request_type when not provided', () => {
        rlp.enqueueRequest({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            exchange: 'binance',
            requestType: 'force_exit',
            payload: {}
        });
        const row = db.prepare(
            `SELECT * FROM ml_api_request_queue WHERE user_id = ?`
        ).get(TEST_USER);
        expect(row.priority).toBe('CRITICAL');
    });

    test('explicit priority overrides inferred', () => {
        rlp.enqueueRequest({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            exchange: 'binance',
            requestType: 'status_check',
            priority: 'HIGH',
            payload: {}
        });
        const row = db.prepare(
            `SELECT * FROM ml_api_request_queue WHERE user_id = ?`
        ).get(TEST_USER);
        expect(row.priority).toBe('HIGH');
    });
});

describe('EXEC-N3 dequeueNext', () => {
    beforeEach(() => {
        rlp.enqueueRequest({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            exchange: 'binance', requestType: 'status_check', payload: {}
        });
        rlp.enqueueRequest({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            exchange: 'binance', requestType: 'force_exit', payload: {}
        });
        rlp.enqueueRequest({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            exchange: 'binance', requestType: 'place_order', payload: {}
        });
    });

    test('dequeues CRITICAL first', () => {
        const r = rlp.dequeueNext({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            exchange: 'binance',
            currentBudgetRemaining: 100
        });
        expect(r.request).not.toBeNull();
        expect(r.request.priority).toBe('CRITICAL');
        expect(r.request.requestType).toBe('force_exit');
    });

    test('returns null when budget exhausted', () => {
        const r = rlp.dequeueNext({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            exchange: 'binance',
            currentBudgetRemaining: 0
        });
        expect(r.request).toBeNull();
    });

    test('marks request as SENT', () => {
        const r = rlp.dequeueNext({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            exchange: 'binance',
            currentBudgetRemaining: 100
        });
        const row = db.prepare(
            `SELECT * FROM ml_api_request_queue WHERE id = ?`
        ).get(r.request.id);
        expect(row.status).toBe('SENT');
    });
});

describe('EXEC-N3 dropExpiredRequests', () => {
    test('drops requests past deadline', () => {
        rlp.enqueueRequest({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            exchange: 'binance', requestType: 'place_order',
            payload: {},
            deadlineMs: Date.now() - 1000  // 1 sec in past
        });
        const r = rlp.dropExpiredRequests({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            exchange: 'binance'
        });
        expect(r.droppedCount).toBeGreaterThan(0);
        const row = db.prepare(
            `SELECT * FROM ml_api_request_queue WHERE user_id = ?`
        ).get(TEST_USER);
        expect(row.status).toBe('EXPIRED');
    });

    test('keeps requests within deadline', () => {
        rlp.enqueueRequest({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            exchange: 'binance', requestType: 'place_order',
            payload: {},
            deadlineMs: Date.now() + 60000  // 1 min future
        });
        rlp.dropExpiredRequests({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            exchange: 'binance'
        });
        const row = db.prepare(
            `SELECT * FROM ml_api_request_queue WHERE user_id = ?`
        ).get(TEST_USER);
        expect(row.status).toBe('PENDING');
    });
});

describe('EXEC-N3 getQueueStats', () => {
    beforeEach(() => {
        rlp.enqueueRequest({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            exchange: 'binance', requestType: 'force_exit', payload: {}
        });
        rlp.enqueueRequest({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            exchange: 'binance', requestType: 'place_order', payload: {}
        });
        rlp.enqueueRequest({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            exchange: 'binance', requestType: 'status_check', payload: {}
        });
    });

    test('returns counts by priority', () => {
        const r = rlp.getQueueStats({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            exchange: 'binance'
        });
        expect(r.totalPending).toBe(3);
        expect(r.byPriority.CRITICAL).toBe(1);
        expect(r.byPriority.HIGH).toBe(1);   // place_order = HIGH
        expect(r.byPriority.LOW).toBe(1);
    });

    test('zero stats when empty', () => {
        cleanRows();
        const r = rlp.getQueueStats({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            exchange: 'binance'
        });
        expect(r.totalPending).toBe(0);
    });
});

describe('EXEC-N3 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9004;
        rlp.enqueueRequest({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            exchange: 'binance', requestType: 'force_exit', payload: {}
        });
        const r1 = rlp.getQueueStats({
            userId: TEST_USER, resolvedEnv: TEST_ENV, exchange: 'binance'
        });
        const r2 = rlp.getQueueStats({
            userId: OTHER_USER, resolvedEnv: TEST_ENV, exchange: 'binance'
        });
        expect(r1.totalPending).toBe(1);
        expect(r2.totalPending).toBe(0);
    });
});
