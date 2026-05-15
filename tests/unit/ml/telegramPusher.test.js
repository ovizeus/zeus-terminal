'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-raidn-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const tp = require('../../../server/services/ml/_operator/telegramPusher');

const TEST_USER = 9501;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_telegram_pushes WHERE user_id = ?').run(TEST_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('Raid-N Migration 085', () => {
    test('table ml_telegram_pushes exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_telegram_pushes'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_telegram_pushes)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'event_type', 'severity',
            'message', 'payload_json', 'dedup_key', 'delivery_status',
            'created_at', 'delivered_at'
        ]));
    });
});

describe('Raid-N Exported constants', () => {
    test('SEVERITY_LEVELS includes CRITICAL', () => {
        expect(tp.SEVERITY_LEVELS).toEqual(expect.arrayContaining([
            'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'
        ]));
    });

    test('DELIVERY_STATUS has expected states', () => {
        expect(tp.DELIVERY_STATUS).toEqual(expect.arrayContaining([
            'PENDING', 'SENT', 'FAILED', 'DEDUPED'
        ]));
    });

    test('DEFAULT_DEDUP_WINDOW_MS positive', () => {
        expect(tp.DEFAULT_DEDUP_WINDOW_MS).toBeGreaterThan(0);
    });
});

describe('Raid-N enqueuePush', () => {
    test('records CRITICAL event', () => {
        tp.enqueuePush({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            eventType: 'panic_triggered',
            severity: 'CRITICAL',
            payload: { reason: 'manual' }
        });
        const rows = db.prepare(
            `SELECT * FROM ml_telegram_pushes WHERE user_id = ?`
        ).all(TEST_USER);
        expect(rows).toHaveLength(1);
        expect(rows[0].severity).toBe('CRITICAL');
    });

    test('rejects non-CRITICAL by default (critical-only filter)', () => {
        const r = tp.enqueuePush({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            eventType: 'info_event',
            severity: 'LOW',
            payload: {}
        });
        expect(r.queued).toBe(false);
        expect(r.reason).toMatch(/below.*threshold|severity/i);
    });

    test('HIGH severity accepted when threshold lowered', () => {
        const r = tp.enqueuePush({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            eventType: 'high_alert',
            severity: 'HIGH',
            payload: {},
            minSeverity: 'HIGH'
        });
        expect(r.queued).toBe(true);
    });

    test('dedups recurring event within window', () => {
        tp.enqueuePush({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            eventType: 'alert',
            severity: 'CRITICAL',
            payload: {},
            dedupKey: 'event-1'
        });
        const r = tp.enqueuePush({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            eventType: 'alert',
            severity: 'CRITICAL',
            payload: {},
            dedupKey: 'event-1'
        });
        expect(r.queued).toBe(false);
        expect(r.reason).toMatch(/dedup/i);
    });
});

describe('Raid-N shouldDedup', () => {
    test('returns false when no prior push with dedupKey', () => {
        const r = tp.shouldDedup({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            dedupKey: 'never-seen'
        });
        expect(r).toBe(false);
    });

    test('returns true when recent push exists', () => {
        tp.enqueuePush({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            eventType: 'alert',
            severity: 'CRITICAL',
            payload: {},
            dedupKey: 'dedup-test'
        });
        const r = tp.shouldDedup({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            dedupKey: 'dedup-test'
        });
        expect(r).toBe(true);
    });

    test('respects withinMs window', () => {
        tp.enqueuePush({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            eventType: 'alert',
            severity: 'CRITICAL',
            payload: {},
            dedupKey: 'window-test'
        });
        // Backdate
        db.prepare(`UPDATE ml_telegram_pushes SET created_at = ? WHERE dedup_key = ?`)
            .run(Date.now() - 60000, 'window-test');
        const r = tp.shouldDedup({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            dedupKey: 'window-test',
            withinMs: 30000  // 30s window
        });
        expect(r).toBe(false);
    });
});

describe('Raid-N formatPushMessage (pure)', () => {
    test('formats CRITICAL with prefix', () => {
        const msg = tp.formatPushMessage({
            eventType: 'panic_triggered',
            severity: 'CRITICAL',
            payload: { reason: 'manual', actor: 'op' }
        });
        expect(msg).toMatch(/CRITICAL|🚨|🔥/);
        expect(msg).toMatch(/panic_triggered/);
    });

    test('includes payload details', () => {
        const msg = tp.formatPushMessage({
            eventType: 'recon_failed',
            severity: 'HIGH',
            payload: { symbol: 'BTCUSDT', divergence: 'position_side' }
        });
        expect(msg).toMatch(/BTCUSDT/);
    });

    test('handles missing payload gracefully', () => {
        const msg = tp.formatPushMessage({
            eventType: 'event',
            severity: 'HIGH',
            payload: {}
        });
        expect(typeof msg).toBe('string');
    });
});

describe('Raid-N markDelivered', () => {
    test('updates delivery status', () => {
        const insertResult = db.prepare(
            `INSERT INTO ml_telegram_pushes
             (user_id, resolved_env, event_type, severity, message, payload_json,
              delivery_status, created_at)
             VALUES (?, ?, 'test', 'CRITICAL', 'msg', '{}', 'PENDING', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now());

        tp.markDelivered({
            pushId: insertResult.lastInsertRowid,
            deliveryStatus: 'SENT'
        });

        const row = db.prepare(
            `SELECT * FROM ml_telegram_pushes WHERE id = ?`
        ).get(insertResult.lastInsertRowid);
        expect(row.delivery_status).toBe('SENT');
        expect(row.delivered_at).not.toBeNull();
    });
});

describe('Raid-N getPushHistory', () => {
    beforeEach(() => {
        for (let i = 0; i < 3; i++) {
            tp.enqueuePush({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                eventType: `event_${i}`,
                severity: 'CRITICAL',
                payload: { i }
            });
        }
    });

    test('returns history entries', () => {
        const r = tp.getPushHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r).toHaveLength(3);
    });

    test('respects limit', () => {
        const r = tp.getPushHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            limit: 2
        });
        expect(r).toHaveLength(2);
    });
});

describe('Raid-N isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9502;
        tp.enqueuePush({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            eventType: 'alert', severity: 'CRITICAL', payload: {}
        });
        const r1 = tp.getPushHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const r2 = tp.getPushHistory({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(r1).toHaveLength(1);
        expect(r2).toHaveLength(0);
    });
});
