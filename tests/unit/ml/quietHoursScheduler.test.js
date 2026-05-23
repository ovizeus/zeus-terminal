'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-raidq-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const qh = require('../../../server/services/ml/_operator/quietHoursScheduler');

const TEST_USER = 9701;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_quiet_hours WHERE user_id = ?').run(TEST_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('Raid-Q Migration 087', () => {
    test('table ml_quiet_hours exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_quiet_hours'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_quiet_hours)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'windows_json',
            'timezone', 'actor', 'enabled', 'updated_at'
        ]));
    });

    test('UNIQUE per (user, env)', () => {
        const now = Date.now();
        db.prepare(
            `INSERT INTO ml_quiet_hours
             (user_id, resolved_env, windows_json, timezone, actor, enabled, updated_at)
             VALUES (?, ?, '[]', 'UTC', 'op', 1, ?)`
        ).run(TEST_USER, TEST_ENV, now);
        expect(() => db.prepare(
            `INSERT INTO ml_quiet_hours
             (user_id, resolved_env, windows_json, timezone, actor, enabled, updated_at)
             VALUES (?, ?, '[]', 'UTC', 'op', 1, ?)`
        ).run(TEST_USER, TEST_ENV, now)).toThrow();
        cleanRows();
    });
});

describe('Raid-Q Exported constants', () => {
    test('DEFAULT_QUIET_HOURS_TZ is UTC', () => {
        expect(qh.DEFAULT_QUIET_HOURS_TZ).toBe('UTC');
    });

    test('SUPPRESSION_MIN_SEVERITY = CRITICAL', () => {
        expect(qh.SUPPRESSION_MIN_SEVERITY).toBe('CRITICAL');
    });
});

describe('Raid-Q setQuietHours', () => {
    test('records new config', () => {
        qh.setQuietHours({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            windows: [{ start: '22:00', end: '08:00' }],
            actor: 'operator'
        });
        const rows = db.prepare(
            `SELECT * FROM ml_quiet_hours WHERE user_id = ?`
        ).all(TEST_USER);
        expect(rows).toHaveLength(1);
    });

    test('updates existing config', () => {
        qh.setQuietHours({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            windows: [{ start: '22:00', end: '08:00' }],
            actor: 'op'
        });
        qh.setQuietHours({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            windows: [{ start: '23:00', end: '07:00' }],
            actor: 'op'
        });
        const r = qh.getQuietHoursConfig({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.windows[0].start).toBe('23:00');
    });

    test('throws on empty windows', () => {
        expect(() => qh.setQuietHours({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            windows: [], actor: 'op'
        })).toThrow();
    });
});

describe('Raid-Q isInQuietHours', () => {
    test('returns false when no config', () => {
        const r = qh.isInQuietHours({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r).toBe(false);
    });

    test('returns true during quiet window', () => {
        qh.setQuietHours({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            windows: [{ start: '22:00', end: '08:00' }],
            actor: 'op'
        });
        const ts = new Date('2026-05-15T23:00:00Z').getTime();
        const r = qh.isInQuietHours({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            currentTime: ts
        });
        expect(r).toBe(true);
    });

    test('returns false outside quiet window', () => {
        qh.setQuietHours({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            windows: [{ start: '22:00', end: '08:00' }],
            actor: 'op'
        });
        const ts = new Date('2026-05-15T14:00:00Z').getTime();
        const r = qh.isInQuietHours({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            currentTime: ts
        });
        expect(r).toBe(false);
    });

    test('handles cross-midnight windows', () => {
        qh.setQuietHours({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            windows: [{ start: '22:00', end: '06:00' }],
            actor: 'op'
        });
        const ts1 = new Date('2026-05-15T03:00:00Z').getTime();
        expect(qh.isInQuietHours({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            currentTime: ts1
        })).toBe(true);
        const ts2 = new Date('2026-05-15T10:00:00Z').getTime();
        expect(qh.isInQuietHours({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            currentTime: ts2
        })).toBe(false);
    });
});

describe('Raid-Q shouldSuppressAlert', () => {
    beforeEach(() => {
        qh.setQuietHours({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            windows: [{ start: '22:00', end: '08:00' }],
            actor: 'op'
        });
    });

    test('suppresses HIGH alert during quiet hours', () => {
        const ts = new Date('2026-05-15T03:00:00Z').getTime();
        const r = qh.shouldSuppressAlert({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            severity: 'HIGH',
            currentTime: ts
        });
        expect(r.suppressed).toBe(true);
    });

    test('does NOT suppress CRITICAL alert during quiet hours', () => {
        const ts = new Date('2026-05-15T03:00:00Z').getTime();
        const r = qh.shouldSuppressAlert({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            severity: 'CRITICAL',
            currentTime: ts
        });
        expect(r.suppressed).toBe(false);
    });

    test('does NOT suppress outside quiet hours', () => {
        const ts = new Date('2026-05-15T14:00:00Z').getTime();
        const r = qh.shouldSuppressAlert({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            severity: 'HIGH',
            currentTime: ts
        });
        expect(r.suppressed).toBe(false);
    });
});

describe('Raid-Q clearQuietHours', () => {
    test('removes config', () => {
        qh.setQuietHours({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            windows: [{ start: '22:00', end: '08:00' }],
            actor: 'op'
        });
        qh.clearQuietHours({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            actor: 'op'
        });
        const r = qh.getQuietHoursConfig({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r).toBeNull();
    });
});

describe('Raid-Q getQuietHoursConfig', () => {
    test('returns null when no config', () => {
        const r = qh.getQuietHoursConfig({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r).toBeNull();
    });

    test('returns config when set', () => {
        qh.setQuietHours({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            windows: [{ start: '22:00', end: '08:00' }],
            actor: 'op'
        });
        const r = qh.getQuietHoursConfig({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.windows).toHaveLength(1);
        expect(r.timezone).toBe('UTC');
    });
});

describe('Raid-Q isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9702;
        qh.setQuietHours({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            windows: [{ start: '22:00', end: '08:00' }],
            actor: 'op'
        });
        const r1 = qh.getQuietHoursConfig({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const r2 = qh.getQuietHoursConfig({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(r1).not.toBeNull();
        expect(r2).toBeNull();
    });
});
