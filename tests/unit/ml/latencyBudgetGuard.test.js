'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-raidl-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const lbg = require('../../../server/services/ml/_crosscutting/latencyBudgetGuard');

const TEST_USER = 9501;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_latency_budget_log WHERE user_id = ?').run(TEST_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('Raid-L Migration 084', () => {
    test('table ml_latency_budget_log exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_latency_budget_log'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_latency_budget_log)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'task_type',
            'latency_ms', 'budget_ms', 'accepted', 'drop_reason', 'created_at'
        ]));
    });
});

describe('Raid-L Exported constants', () => {
    test('TASK_TYPES includes voice_push', () => {
        expect(lbg.TASK_TYPES).toEqual(expect.arrayContaining([
            'voice_push', 'alert', 'notification', 'log_emit'
        ]));
    });

    test('DEFAULT_BUDGET_MS_BY_TASK has voice_push=100', () => {
        expect(lbg.DEFAULT_BUDGET_MS_BY_TASK.voice_push).toBe(100);
    });

    test('alert budget higher than voice_push', () => {
        expect(lbg.DEFAULT_BUDGET_MS_BY_TASK.alert).toBeGreaterThan(
            lbg.DEFAULT_BUDGET_MS_BY_TASK.voice_push
        );
    });
});

describe('Raid-L enforceBudget (pure)', () => {
    test('within budget → allowed', () => {
        const now = Date.now();
        const r = lbg.enforceBudget({
            deadline: now + 100,
            taskType: 'voice_push',
            currentTime: now + 50
        });
        expect(r.allowed).toBe(true);
        expect(r.latencyMs).toBe(50);
    });

    test('exceeded budget → dropped', () => {
        const now = Date.now();
        const r = lbg.enforceBudget({
            deadline: now,
            taskType: 'voice_push',
            currentTime: now + 200
        });
        expect(r.allowed).toBe(false);
        expect(r.droppedReason).toBe('latency_exceeded');
    });

    test('throws on invalid task_type', () => {
        expect(() => lbg.enforceBudget({
            deadline: Date.now(),
            taskType: 'bogus_task',
            currentTime: Date.now()
        })).toThrow(/task/i);
    });

    test('uses budget from defaults when not specified', () => {
        const now = Date.now();
        const r = lbg.enforceBudget({
            deadline: now + 100,
            taskType: 'voice_push',
            currentTime: now + 50  // 50ms latency from start, voice_push=100ms budget
        });
        expect(r.allowed).toBe(true);
        expect(r.budgetMs).toBe(100);
    });
});

describe('Raid-L recordBudgetEvent', () => {
    test('records accepted event', () => {
        lbg.recordBudgetEvent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            taskType: 'voice_push',
            latencyMs: 50, budgetMs: 100,
            accepted: true
        });
        const rows = db.prepare(
            `SELECT * FROM ml_latency_budget_log WHERE user_id = ?`
        ).all(TEST_USER);
        expect(rows).toHaveLength(1);
        expect(rows[0].accepted).toBe(1);
    });

    test('records dropped event with reason', () => {
        lbg.recordBudgetEvent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            taskType: 'voice_push',
            latencyMs: 200, budgetMs: 100,
            accepted: false, dropReason: 'latency_exceeded'
        });
        const row = db.prepare(
            `SELECT * FROM ml_latency_budget_log WHERE user_id = ?`
        ).get(TEST_USER);
        expect(row.accepted).toBe(0);
        expect(row.drop_reason).toBe('latency_exceeded');
    });
});

describe('Raid-L getBudgetStats', () => {
    beforeEach(() => {
        for (let i = 0; i < 5; i++) {
            lbg.recordBudgetEvent({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                taskType: 'voice_push',
                latencyMs: 50, budgetMs: 100, accepted: true
            });
        }
        lbg.recordBudgetEvent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            taskType: 'voice_push',
            latencyMs: 150, budgetMs: 100,
            accepted: false, dropReason: 'latency_exceeded'
        });
    });

    test('returns drop rate stats', () => {
        const r = lbg.getBudgetStats({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.totalEvents).toBe(6);
        expect(r.droppedCount).toBe(1);
        expect(r.dropRate).toBeCloseTo(1/6, 2);
    });

    test('filters by task_type', () => {
        lbg.recordBudgetEvent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            taskType: 'alert',
            latencyMs: 30, budgetMs: 200, accepted: true
        });
        const r = lbg.getBudgetStats({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            taskType: 'voice_push'
        });
        expect(r.totalEvents).toBe(6);  // only voice_push
    });

    test('returns avg latency', () => {
        const r = lbg.getBudgetStats({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            taskType: 'voice_push'
        });
        expect(r.avgLatencyMs).toBeGreaterThan(0);
    });
});

describe('Raid-L getRecentDrops', () => {
    test('returns only dropped events', () => {
        lbg.recordBudgetEvent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            taskType: 'voice_push',
            latencyMs: 50, budgetMs: 100, accepted: true
        });
        lbg.recordBudgetEvent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            taskType: 'voice_push',
            latencyMs: 200, budgetMs: 100,
            accepted: false, dropReason: 'latency_exceeded'
        });
        const r = lbg.getRecentDrops({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r).toHaveLength(1);
        expect(r[0].accepted).toBe(false);
    });
});

describe('Raid-L isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9502;
        lbg.recordBudgetEvent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            taskType: 'voice_push',
            latencyMs: 50, budgetMs: 100, accepted: true
        });
        const r1 = lbg.getBudgetStats({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const r2 = lbg.getBudgetStats({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(r1.totalEvents).toBe(1);
        expect(r2.totalEvents).toBe(0);
    });
});
