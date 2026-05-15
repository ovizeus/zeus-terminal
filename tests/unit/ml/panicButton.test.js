'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-opsn1-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const pb = require('../../../server/services/ml/_operator/panicButton');
const cb = require('../../../server/services/ml/R3A_safety/circuitBreaker');

const TEST_USER = 9111;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_panic_events WHERE user_id = ?').run(TEST_USER);
    db.prepare('DELETE FROM ml_circuit_state WHERE user_id = ?').run(TEST_USER);
    db.prepare('DELETE FROM ml_circuit_history WHERE user_id = ?').run(TEST_USER);
    db.prepare('DELETE FROM ml_human_overrides WHERE user_id = ?').run(TEST_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('OPS-N1 Migration 075', () => {
    test('table ml_panic_events exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_panic_events'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_panic_events)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'severity',
            'reason', 'actor', 'state', 'triggered_at', 'cleared_at'
        ]));
    });

    test('CHECK severity restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_panic_events
             (user_id, resolved_env, severity, reason, actor, state, triggered_at)
             VALUES (?, ?, 'BOGUS', 'test', 'op', 'ACTIVE', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK state restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_panic_events
             (user_id, resolved_env, severity, reason, actor, state, triggered_at)
             VALUES (?, ?, 'CRITICAL', 'test', 'op', 'BOGUS', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('OPS-N1 Exported constants', () => {
    test('PANIC_SEVERITY has 4 levels', () => {
        expect(pb.PANIC_SEVERITY).toEqual(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
    });

    test('PANIC_STATE has ACTIVE/CLEARED', () => {
        expect(pb.PANIC_STATE).toEqual(['ACTIVE', 'CLEARED']);
    });

    test('PANIC_ACTIONS includes flatten + halt', () => {
        expect(pb.PANIC_ACTIONS).toEqual(expect.arrayContaining([
            'breaker_L5_flatten', 'kill_switch_ON', 'audit_logged'
        ]));
    });
});

describe('OPS-N1 triggerPanic', () => {
    test('records panic event with ACTIVE state', () => {
        pb.triggerPanic({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            actor: 'operator', reason: 'manual_panic',
            severity: 'CRITICAL'
        });
        const rows = db.prepare(
            `SELECT * FROM ml_panic_events WHERE user_id = ?`
        ).all(TEST_USER);
        expect(rows).toHaveLength(1);
        expect(rows[0].state).toBe('ACTIVE');
        expect(rows[0].severity).toBe('CRITICAL');
    });

    test('sets §29 circuit breaker to L5', () => {
        pb.triggerPanic({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            actor: 'operator', reason: 'manual_panic',
            severity: 'CRITICAL'
        });
        const state = cb.getBreakerState({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(state.level).toBe('L5');
    });

    test('sets §34 emergency kill switch ON', () => {
        pb.triggerPanic({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            actor: 'operator', reason: 'manual_panic',
            severity: 'CRITICAL'
        });
        const rows = db.prepare(
            `SELECT * FROM ml_human_overrides
             WHERE user_id = ? AND record_type = 'KILL_SWITCH' AND state = 'ACTIVE'`
        ).all(TEST_USER);
        expect(rows.length).toBeGreaterThan(0);
    });

    test('default severity is CRITICAL when not specified', () => {
        pb.triggerPanic({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            actor: 'op', reason: 'r'
        });
        const row = db.prepare(
            `SELECT * FROM ml_panic_events WHERE user_id = ?`
        ).get(TEST_USER);
        expect(row.severity).toBe('CRITICAL');
    });

    test('throws on invalid severity', () => {
        expect(() => pb.triggerPanic({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            actor: 'op', reason: 'r',
            severity: 'BOGUS'
        })).toThrow(/severity/i);
    });

    test('throws on missing reason', () => {
        expect(() => pb.triggerPanic({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            actor: 'op'
        })).toThrow(/reason/i);
    });
});

describe('OPS-N1 getActivePanic', () => {
    test('returns null when no active panic', () => {
        const r = pb.getActivePanic({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r).toBeNull();
    });

    test('returns active panic when triggered', () => {
        pb.triggerPanic({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            actor: 'op', reason: 'r1'
        });
        const r = pb.getActivePanic({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r).not.toBeNull();
        expect(r.state).toBe('ACTIVE');
    });
});

describe('OPS-N1 clearPanic', () => {
    test('clears active panic state', () => {
        pb.triggerPanic({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            actor: 'op', reason: 'r1'
        });
        pb.clearPanic({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            actor: 'operator', reason: 'manual_recovery_verified'
        });
        const r = pb.getActivePanic({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r).toBeNull();
    });

    test('returns false when no active panic to clear', () => {
        const r = pb.clearPanic({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            actor: 'op', reason: 'r'
        });
        expect(r.cleared).toBe(false);
    });

    test('records cleared_at timestamp', () => {
        pb.triggerPanic({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            actor: 'op', reason: 'r1'
        });
        pb.clearPanic({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            actor: 'op', reason: 'recovery'
        });
        const row = db.prepare(
            `SELECT * FROM ml_panic_events WHERE user_id = ? ORDER BY id DESC LIMIT 1`
        ).get(TEST_USER);
        expect(row.cleared_at).not.toBeNull();
    });

    test('clearing does NOT auto-reset breaker (manual only)', () => {
        pb.triggerPanic({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            actor: 'op', reason: 'r1'
        });
        pb.clearPanic({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            actor: 'op', reason: 'cleared'
        });
        const state = cb.getBreakerState({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(state.level).toBe('L5');  // still L5 — operator must manually reset
    });
});

describe('OPS-N1 getPanicHistory', () => {
    beforeEach(() => {
        for (let i = 0; i < 3; i++) {
            pb.triggerPanic({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                actor: 'op', reason: `r${i}`
            });
            pb.clearPanic({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                actor: 'op', reason: 'recovery'
            });
        }
    });

    test('returns full history', () => {
        const r = pb.getPanicHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r).toHaveLength(3);
    });

    test('respects limit', () => {
        const r = pb.getPanicHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV, limit: 2
        });
        expect(r).toHaveLength(2);
    });

    test('filters by since', () => {
        const r = pb.getPanicHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            since: Date.now() + 1000  // future
        });
        expect(r).toEqual([]);
    });
});

describe('OPS-N1 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9112;
        pb.triggerPanic({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            actor: 'op', reason: 'r1'
        });
        const r1 = pb.getActivePanic({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const r2 = pb.getActivePanic({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(r1).not.toBeNull();
        expect(r2).toBeNull();
    });
});
