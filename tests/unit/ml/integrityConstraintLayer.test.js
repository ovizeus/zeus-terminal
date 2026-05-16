'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p104-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const il = require('../../../server/services/ml/_crosscutting/integrityConstraintLayer');

const TEST_USER = 9104;
const OTHER_USER = 9105;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_integrity_constraints WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
    db.prepare('DELETE FROM ml_integrity_violations WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§104 Migrations 197 + 198', () => {
    test('constraint_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_integrity_constraints
             (user_id, resolved_env, constraint_id, kind, description,
              severity, is_active, ts)
             VALUES (?, ?, 'IC-UNIQ', 'venue_health', 'd', 'strict', 1, ?)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_integrity_constraints
             (user_id, resolved_env, constraint_id, kind, description,
              severity, is_active, ts)
             VALUES (?, ?, 'IC-UNIQ', 'peer_predation', 'd2', 'advisory', 1, ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('CHECK kind restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_integrity_constraints
             (user_id, resolved_env, constraint_id, kind, description,
              severity, is_active, ts)
             VALUES (?, ?, 'IC-BAD', 'BOGUS', 'd', 'strict', 1, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK severity restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_integrity_constraints
             (user_id, resolved_env, constraint_id, kind, description,
              severity, is_active, ts)
             VALUES (?, ?, 'IC-SEV', 'venue_health', 'd', 'BOGUS', 1, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK decision restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_integrity_violations
             (user_id, resolved_env, violation_id, constraint_id,
              action_context, severity_score, decision, reason, ts)
             VALUES (?, ?, 'IV-BAD', NULL, 'ctx', 0.5, 'BOGUS', NULL, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§104 Constants', () => {
    test('INTEGRITY_KINDS has 4 entries', () => {
        expect(il.INTEGRITY_KINDS).toEqual([
            'venue_health', 'ecosystem_impact',
            'peer_predation', 'liquidity_provision'
        ]);
    });

    test('INTEGRITY_DECISIONS has 4 entries', () => {
        expect(il.INTEGRITY_DECISIONS).toEqual([
            'BLOCK', 'REDUCE_SIZE', 'WARN', 'ACCEPT'
        ]);
    });

    test('thresholds ordered', () => {
        expect(il.DEFAULT_WARN_THRESHOLD)
            .toBeLessThan(il.DEFAULT_STRICT_BLOCK_THRESHOLD);
    });
});

describe('§104 evaluateActionIntegrity (pure)', () => {
    test('strict + high severity → BLOCK', () => {
        const r = il.evaluateActionIntegrity({
            severityScore: 0.7, constraintSeverity: 'strict'
        });
        expect(r.decision).toBe('BLOCK');
    });

    test('strict + mid severity → REDUCE_SIZE', () => {
        const r = il.evaluateActionIntegrity({
            severityScore: 0.30, constraintSeverity: 'strict'
        });
        expect(r.decision).toBe('REDUCE_SIZE');
    });

    test('strict + low severity → WARN', () => {
        const r = il.evaluateActionIntegrity({
            severityScore: 0.10, constraintSeverity: 'strict'
        });
        expect(r.decision).toBe('WARN');
    });

    test('advisory never BLOCKs', () => {
        const r = il.evaluateActionIntegrity({
            severityScore: 0.95, constraintSeverity: 'advisory'
        });
        expect(r.decision).toBe('REDUCE_SIZE');
    });

    test('zero severity → ACCEPT', () => {
        const r = il.evaluateActionIntegrity({
            severityScore: 0, constraintSeverity: 'strict'
        });
        expect(r.decision).toBe('ACCEPT');
    });

    test('invalid constraintSeverity throws', () => {
        expect(() => il.evaluateActionIntegrity({
            severityScore: 0.5, constraintSeverity: 'BOGUS'
        })).toThrow();
    });
});

describe('§104 registerIntegrityConstraint', () => {
    test('persists', () => {
        const r = il.registerIntegrityConstraint({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            constraintId: 'RC-1', kind: 'venue_health',
            description: 'no exploit small exchange to bankrupt',
            severity: 'strict'
        });
        expect(r.registered).toBe(true);
    });

    test('duplicate throws', () => {
        il.registerIntegrityConstraint({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            constraintId: 'RC-DUP', kind: 'venue_health',
            description: 'd', severity: 'strict'
        });
        expect(() => il.registerIntegrityConstraint({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            constraintId: 'RC-DUP', kind: 'peer_predation',
            description: 'd2', severity: 'advisory'
        })).toThrow();
    });

    test('invalid kind throws', () => {
        expect(() => il.registerIntegrityConstraint({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            constraintId: 'RC-BAD', kind: 'BOGUS',
            description: 'd', severity: 'strict'
        })).toThrow();
    });
});

describe('§104 recordIntegrityCheck', () => {
    test('persists', () => {
        const r = il.recordIntegrityCheck({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            violationId: 'IV-1',
            actionContext: 'large order in thin venue',
            severityScore: 0.6, decision: 'REDUCE_SIZE',
            reason: 'liquidity 80% depth'
        });
        expect(r.recorded).toBe(true);
    });

    test('invalid decision throws', () => {
        expect(() => il.recordIntegrityCheck({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            violationId: 'IV-BAD',
            actionContext: 'ctx', severityScore: 0.5,
            decision: 'BOGUS'
        })).toThrow();
    });

    test('severity out of range throws', () => {
        expect(() => il.recordIntegrityCheck({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            violationId: 'IV-OOR',
            actionContext: 'ctx', severityScore: 1.5,
            decision: 'WARN'
        })).toThrow();
    });
});

describe('§104 getActiveConstraints', () => {
    test('filter by kind', () => {
        il.registerIntegrityConstraint({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            constraintId: 'GA-V', kind: 'venue_health',
            description: 'd', severity: 'strict'
        });
        il.registerIntegrityConstraint({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            constraintId: 'GA-P', kind: 'peer_predation',
            description: 'd', severity: 'advisory'
        });
        const r = il.getActiveConstraints({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            kind: 'venue_health'
        });
        expect(r).toHaveLength(1);
        expect(r[0].constraintId).toBe('GA-V');
    });

    test('retired excluded', () => {
        il.registerIntegrityConstraint({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            constraintId: 'GA-RET', kind: 'venue_health',
            description: 'd', severity: 'strict'
        });
        il.retireConstraint({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            constraintId: 'GA-RET'
        });
        const r = il.getActiveConstraints({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.find(c => c.constraintId === 'GA-RET')).toBeUndefined();
    });
});

describe('§104 getViolationHistory', () => {
    test('filter by decision', () => {
        il.recordIntegrityCheck({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            violationId: 'VH-1', actionContext: 'a',
            severityScore: 0.7, decision: 'BLOCK'
        });
        il.recordIntegrityCheck({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            violationId: 'VH-2', actionContext: 'b',
            severityScore: 0.3, decision: 'WARN'
        });
        const r = il.getViolationHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionFilter: 'BLOCK'
        });
        expect(r).toHaveLength(1);
        expect(r[0].violationId).toBe('VH-1');
    });
});

describe('§104 retireConstraint', () => {
    test('marks inactive', () => {
        il.registerIntegrityConstraint({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            constraintId: 'RT-1', kind: 'venue_health',
            description: 'd', severity: 'strict'
        });
        const r = il.retireConstraint({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            constraintId: 'RT-1'
        });
        expect(r.retired).toBe(true);
    });

    test('unknown throws', () => {
        expect(() => il.retireConstraint({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            constraintId: 'NOEXIST'
        })).toThrow();
    });
});

describe('§104 isolation', () => {
    test('per (user × env) isolation', () => {
        il.registerIntegrityConstraint({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            constraintId: 'ISO-1', kind: 'venue_health',
            description: 'd', severity: 'strict'
        });
        const a = il.getActiveConstraints({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const b = il.getActiveConstraints({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(a).toHaveLength(1);
        expect(b).toHaveLength(0);
    });
});
