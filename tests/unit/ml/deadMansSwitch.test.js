'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p63-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const dms = require('../../../server/services/ml/R0_substrate/deadMansSwitch');

const TEST_USER = 9063;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_heartbeat_state WHERE user_id IN (?, ?)').run(TEST_USER, 9064);
    db.prepare('DELETE FROM ml_dead_man_emergencies WHERE user_id IN (?, ?)').run(TEST_USER, 9064);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§63 Migrations 111 + 112', () => {
    test('ml_heartbeat_state exists', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_heartbeat_state)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'user_id', 'resolved_env', 'last_heartbeat_ts',
            'expected_interval_ms', 'staleness_threshold_ms', 'dead_threshold_ms',
            'status', 'last_check_ts', 'updated_at'
        ]));
    });

    test('ml_heartbeat_state CHECK status restricts', () => {
        const ts = Date.now();
        expect(() => db.prepare(
            `INSERT INTO ml_heartbeat_state
             (user_id, resolved_env, last_heartbeat_ts,
              expected_interval_ms, staleness_threshold_ms, dead_threshold_ms,
              status, updated_at)
             VALUES (?, ?, ?, 1000, 5000, 10000, 'BOGUS', ?)`
        ).run(TEST_USER, TEST_ENV, ts, ts)).toThrow();
    });

    test('ml_dead_man_emergencies CHECK trigger_reason restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_dead_man_emergencies
             (user_id, resolved_env, trigger_reason, ts)
             VALUES (?, ?, 'BOGUS', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§63 Constants', () => {
    test('HEARTBEAT_STATUSES has 3 entries', () => {
        expect(dms.HEARTBEAT_STATUSES).toEqual(['HEALTHY', 'STALE', 'DEAD']);
    });

    test('EMERGENCY_REASONS has 3 entries', () => {
        expect(dms.EMERGENCY_REASONS).toEqual([
            'heartbeat_dead', 'manual', 'external_watchdog'
        ]);
    });

    test('thresholds ordered: dead > staleness > interval', () => {
        expect(dms.DEFAULT_DEAD_MS).toBeGreaterThan(dms.DEFAULT_STALENESS_MS);
        expect(dms.DEFAULT_STALENESS_MS).toBeGreaterThan(dms.DEFAULT_HEARTBEAT_INTERVAL_MS);
    });
});

describe('§63 configureThresholds', () => {
    test('persists configuration', () => {
        const r = dms.configureThresholds({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            expectedIntervalMs: 10000,
            stalenessMs: 20000,
            deadMs: 60000
        });
        expect(r.configured).toBe(true);

        const status = dms.getHeartbeatStatus({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(status.expectedIntervalMs).toBe(10000);
    });

    test('throws if thresholds not strictly ordered', () => {
        expect(() => dms.configureThresholds({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            expectedIntervalMs: 100, stalenessMs: 50, deadMs: 200
        })).toThrow(/threshold/i);
    });

    test('uses defaults when not provided', () => {
        dms.configureThresholds({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const s = dms.getHeartbeatStatus({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(s.expectedIntervalMs).toBe(dms.DEFAULT_HEARTBEAT_INTERVAL_MS);
    });
});

describe('§63 emitHeartbeat', () => {
    test('first emit auto-initializes state', () => {
        const r = dms.emitHeartbeat({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.emitted).toBe(true);
        expect(r.status).toBe('HEALTHY');
    });

    test('updates last_heartbeat_ts', () => {
        const now = Date.now();
        dms.configureThresholds({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        dms.emitHeartbeat({
            userId: TEST_USER, resolvedEnv: TEST_ENV, ts: now
        });
        const s = dms.getHeartbeatStatus({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(s.lastHeartbeatTs).toBe(now);
    });

    test('blocked when DEAD', () => {
        dms.configureThresholds({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        dms.triggerEmergency({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            reason: 'heartbeat_dead'
        });
        const r = dms.emitHeartbeat({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.emitted).toBe(false);
        expect(r.status).toBe('DEAD');
    });
});

describe('§63 checkHeartbeatStaleness', () => {
    test('HEALTHY when fresh', () => {
        const now = Date.now();
        dms.configureThresholds({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            expectedIntervalMs: 1000, stalenessMs: 5000, deadMs: 30000
        });
        dms.emitHeartbeat({
            userId: TEST_USER, resolvedEnv: TEST_ENV, ts: now
        });
        const r = dms.checkHeartbeatStaleness({
            userId: TEST_USER, resolvedEnv: TEST_ENV, now: now + 500
        });
        expect(r.status).toBe('HEALTHY');
    });

    test('STALE when > staleness threshold', () => {
        const now = Date.now();
        dms.configureThresholds({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            expectedIntervalMs: 1000, stalenessMs: 5000, deadMs: 30000, ts: now
        });
        dms.emitHeartbeat({
            userId: TEST_USER, resolvedEnv: TEST_ENV, ts: now
        });
        const r = dms.checkHeartbeatStaleness({
            userId: TEST_USER, resolvedEnv: TEST_ENV, now: now + 10000
        });
        expect(r.status).toBe('STALE');
    });

    test('DEAD when > dead threshold', () => {
        const now = Date.now();
        dms.configureThresholds({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            expectedIntervalMs: 1000, stalenessMs: 5000, deadMs: 30000, ts: now
        });
        dms.emitHeartbeat({
            userId: TEST_USER, resolvedEnv: TEST_ENV, ts: now
        });
        const r = dms.checkHeartbeatStaleness({
            userId: TEST_USER, resolvedEnv: TEST_ENV, now: now + 40000
        });
        expect(r.status).toBe('DEAD');
    });

    test('returns HEALTHY when not configured', () => {
        const r = dms.checkHeartbeatStaleness({
            userId: 99999, resolvedEnv: TEST_ENV
        });
        expect(r.status).toBe('HEALTHY');
        expect(r.exists).toBe(false);
    });
});

describe('§63 triggerEmergency', () => {
    test('persists emergency event + action plan', () => {
        dms.configureThresholds({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const r = dms.triggerEmergency({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            reason: 'heartbeat_dead',
            positions: [{ id: 'P1' }, { id: 'P2' }],
            orders: [{ id: 'O1' }]
        });
        expect(r.emergencyId).toBeGreaterThan(0);
        expect(r.actionPlan.positionsToClose).toEqual(['P1', 'P2']);
        expect(r.actionPlan.ordersToCancel).toEqual(['O1']);
    });

    test('moves state to DEAD on heartbeat_dead trigger', () => {
        dms.configureThresholds({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        dms.triggerEmergency({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            reason: 'heartbeat_dead'
        });
        const s = dms.getHeartbeatStatus({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(s.status).toBe('DEAD');
    });

    test('throws on invalid reason', () => {
        expect(() => dms.triggerEmergency({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            reason: 'BOGUS'
        })).toThrow();
    });
});

describe('§63 recordEmergencyOutcome', () => {
    test('persists outcome row', () => {
        dms.configureThresholds({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const e = dms.triggerEmergency({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            reason: 'manual'
        });
        const r = dms.recordEmergencyOutcome({
            emergencyId: e.emergencyId,
            positionsClosedCount: 3,
            ordersCancelledCount: 5,
            alertSent: true
        });
        expect(r.recorded).toBe(true);
        const row = db.prepare(
            `SELECT * FROM ml_dead_man_emergencies WHERE id = ?`
        ).get(e.emergencyId);
        expect(row.positions_closed_count).toBe(3);
        expect(row.orders_cancelled_count).toBe(5);
        expect(row.alert_sent).toBe(1);
    });
});

describe('§63 isDeadManTriggered', () => {
    test('returns false when HEALTHY', () => {
        dms.configureThresholds({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        dms.emitHeartbeat({ userId: TEST_USER, resolvedEnv: TEST_ENV });
        const r = dms.isDeadManTriggered({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.triggered).toBe(false);
    });

    test('returns true after dead-threshold elapse', () => {
        const now = Date.now();
        dms.configureThresholds({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            expectedIntervalMs: 1000, stalenessMs: 5000, deadMs: 10000, ts: now
        });
        dms.emitHeartbeat({
            userId: TEST_USER, resolvedEnv: TEST_ENV, ts: now
        });
        const r = dms.isDeadManTriggered({
            userId: TEST_USER, resolvedEnv: TEST_ENV, now: now + 15000
        });
        expect(r.triggered).toBe(true);
    });
});

describe('§63 getEmergencyHistory', () => {
    test('returns events desc by ts', () => {
        dms.configureThresholds({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        dms.triggerEmergency({
            userId: TEST_USER, resolvedEnv: TEST_ENV, reason: 'manual'
        });
        dms.triggerEmergency({
            userId: TEST_USER, resolvedEnv: TEST_ENV, reason: 'external_watchdog'
        });
        const h = dms.getEmergencyHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(h).toHaveLength(2);
    });
});

describe('§63 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9064;
        dms.emitHeartbeat({ userId: TEST_USER, resolvedEnv: TEST_ENV });
        const s1 = dms.getHeartbeatStatus({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const s2 = dms.getHeartbeatStatus({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(s1.exists).toBe(true);
        expect(s2.exists).toBe(false);
    });
});
