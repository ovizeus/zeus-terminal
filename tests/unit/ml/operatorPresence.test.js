'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-raido-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const op = require('../../../server/services/ml/_operator/operatorPresence');

const TEST_USER = 9620;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_operator_presence WHERE user_id = ?').run(TEST_USER);
    db.prepare('DELETE FROM ml_operator_activity_log WHERE user_id = ?').run(TEST_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('Raid-O Migration 086', () => {
    test('table ml_operator_presence exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_operator_presence'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('table ml_operator_activity_log exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_operator_activity_log'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('presence UNIQUE per (user, env)', () => {
        const now = Date.now();
        db.prepare(
            `INSERT INTO ml_operator_presence
             (user_id, resolved_env, state, last_activity_at, updated_at)
             VALUES (?, ?, 'ACTIVE', ?, ?)`
        ).run(TEST_USER, TEST_ENV, now, now);
        expect(() => db.prepare(
            `INSERT INTO ml_operator_presence
             (user_id, resolved_env, state, last_activity_at, updated_at)
             VALUES (?, ?, 'AWAY', ?, ?)`
        ).run(TEST_USER, TEST_ENV, now, now)).toThrow();
        cleanRows();
    });
});

describe('Raid-O Exported constants', () => {
    test('PRESENCE_STATES has ACTIVE/AWAY/UNKNOWN', () => {
        expect(op.PRESENCE_STATES).toEqual(['ACTIVE', 'AWAY', 'UNKNOWN']);
    });

    test('ACTIVITY_TYPES includes common', () => {
        expect(op.ACTIVITY_TYPES).toEqual(expect.arrayContaining([
            'click', 'keystroke', 'api_call', 'page_view'
        ]));
    });

    test('AWAY_THRESHOLD_MS positive', () => {
        expect(op.AWAY_THRESHOLD_MS).toBeGreaterThan(0);
    });
});

describe('Raid-O recordActivity', () => {
    test('creates presence on first activity', () => {
        op.recordActivity({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            activityType: 'click'
        });
        const r = op.getPresence({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.state).toBe('ACTIVE');
    });

    test('updates last_activity_at', () => {
        op.recordActivity({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            activityType: 'click'
        });
        const before = Date.now();
        op.recordActivity({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            activityType: 'keystroke'
        });
        const r = op.getPresence({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.lastSeen).toBeGreaterThanOrEqual(before);
    });

    test('logs activity event', () => {
        op.recordActivity({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            activityType: 'api_call',
            source: 'dashboard'
        });
        const rows = db.prepare(
            `SELECT * FROM ml_operator_activity_log WHERE user_id = ?`
        ).all(TEST_USER);
        expect(rows).toHaveLength(1);
        expect(rows[0].activity_type).toBe('api_call');
    });

    test('throws on invalid activity_type', () => {
        expect(() => op.recordActivity({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            activityType: 'bogus'
        })).toThrow(/activity/i);
    });
});

describe('Raid-O getPresence', () => {
    test('returns UNKNOWN when no presence', () => {
        const r = op.getPresence({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.state).toBe('UNKNOWN');
        expect(r.exists).toBe(false);
    });

    test('returns ACTIVE when recent activity', () => {
        op.recordActivity({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            activityType: 'click'
        });
        const r = op.getPresence({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.state).toBe('ACTIVE');
        expect(r.idleMs).toBeLessThan(5000);
    });

    test('returns AWAY when idle exceeds threshold', () => {
        op.recordActivity({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            activityType: 'click'
        });
        // Backdate
        db.prepare(`UPDATE ml_operator_presence
                    SET last_activity_at = ?, updated_at = ?
                    WHERE user_id = ?`)
            .run(Date.now() - 600000, Date.now() - 600000, TEST_USER);
        const r = op.getPresence({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            awayThresholdMs: 300000  // 5 min
        });
        expect(r.state).toBe('AWAY');
    });
});

describe('Raid-O markAway / markBack', () => {
    test('markAway sets state to AWAY explicitly', () => {
        op.recordActivity({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            activityType: 'click'
        });
        op.markAway({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            reason: 'lunch', actor: 'operator'
        });
        const r = op.getPresence({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.state).toBe('AWAY');
    });

    test('markBack restores ACTIVE', () => {
        op.markAway({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            reason: 'r', actor: 'op'
        });
        op.markBack({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            actor: 'op'
        });
        const r = op.getPresence({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.state).toBe('ACTIVE');
    });
});

describe('Raid-O getActivityHistory', () => {
    beforeEach(() => {
        for (const t of ['click', 'keystroke', 'page_view']) {
            op.recordActivity({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                activityType: t
            });
        }
    });

    test('returns activity log', () => {
        const r = op.getActivityHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r).toHaveLength(3);
    });

    test('respects limit', () => {
        const r = op.getActivityHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV, limit: 2
        });
        expect(r).toHaveLength(2);
    });
});

describe('Raid-O isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9621;
        op.recordActivity({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            activityType: 'click'
        });
        const r1 = op.getPresence({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const r2 = op.getPresence({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(r1.state).toBe('ACTIVE');
        expect(r2.state).toBe('UNKNOWN');
    });
});
