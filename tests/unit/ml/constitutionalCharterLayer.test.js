'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p116-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const ccl = require('../../../server/services/ml/R1_constitution/constitutionalCharterLayer');

const TEST_USER = 9116;
const OTHER_USER = 9117;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_charter_principles WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
    db.prepare('DELETE FROM ml_charter_decisions WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§116 Migrations 221 + 222', () => {
    test('principle_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_charter_principles
             (user_id, resolved_env, principle_id, kind, priority_rank,
              description, is_active, ts_created, ts_last_updated)
             VALUES (?, ?, 'CP-UNIQ', 'safety', 1, 'd', 1, ?, ?)`
        ).run(TEST_USER, TEST_ENV, ts, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_charter_principles
             (user_id, resolved_env, principle_id, kind, priority_rank,
              description, is_active, ts_created, ts_last_updated)
             VALUES (?, ?, 'CP-UNIQ', 'profit', 6, 'd2', 1, ?, ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1, ts + 1)).toThrow();
    });

    test('CHECK kind restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_charter_principles
             (user_id, resolved_env, principle_id, kind, priority_rank,
              description, is_active, ts_created, ts_last_updated)
             VALUES (?, ?, 'CP-BAD', 'BOGUS', 1, 'd', 1, ?, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now(), Date.now())).toThrow();
    });

    test('CHECK priority_rank >= 1', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_charter_principles
             (user_id, resolved_env, principle_id, kind, priority_rank,
              description, is_active, ts_created, ts_last_updated)
             VALUES (?, ?, 'CP-ZERO', 'safety', 0, 'd', 1, ?, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now(), Date.now())).toThrow();
    });

    test('CHECK charter_status restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_charter_decisions
             (user_id, resolved_env, decision_id, action_summary,
              conflicting_principles_json, charter_status,
              utility_score, override_reason, ts)
             VALUES (?, ?, 'CD-BAD', 'a', '[]', 'BOGUS', 0.5, NULL, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§116 Constants', () => {
    test('PRINCIPLE_KINDS has 6 entries', () => {
        expect(ccl.PRINCIPLE_KINDS).toEqual([
            'profit', 'safety', 'truth', 'compliance',
            'integrity', 'long_term_survivability'
        ]);
    });

    test('CHARTER_STATUSES has 3 entries', () => {
        expect(ccl.CHARTER_STATUSES).toEqual([
            'CONSTITUTIONAL_COMPLIANT',
            'CONSTITUTIONALLY_DEGRADED',
            'CONSTITUTIONALLY_BLOCKED'
        ]);
    });

    test('safety rank = 1 (highest)', () => {
        expect(ccl.DEFAULT_PRIORITY_RANKS.safety).toBe(1);
    });

    test('profit rank = 6 (LAST per canonical)', () => {
        expect(ccl.DEFAULT_PRIORITY_RANKS.profit).toBe(6);
    });

    test('safety < truth < compliance ranks', () => {
        expect(ccl.DEFAULT_PRIORITY_RANKS.safety)
            .toBeLessThan(ccl.DEFAULT_PRIORITY_RANKS.truth);
        expect(ccl.DEFAULT_PRIORITY_RANKS.truth)
            .toBeLessThan(ccl.DEFAULT_PRIORITY_RANKS.compliance);
    });

    test('BLOCKING_RANK_CEILING = 3 (top 3 = hard blockers)', () => {
        expect(ccl.BLOCKING_RANK_CEILING).toBe(3);
    });
});

describe('§116 resolveConflict (pure)', () => {
    test('safety conflict → BLOCKED regardless of utility', () => {
        const r = ccl.resolveConflict({
            involvedPrincipleKinds: ['safety'],
            registeredPriorityMap: ccl.DEFAULT_PRIORITY_RANKS,
            utilityScore: 0.99
        });
        expect(r.charterStatus).toBe('CONSTITUTIONALLY_BLOCKED');
    });

    test('profit-only → COMPLIANT', () => {
        const r = ccl.resolveConflict({
            involvedPrincipleKinds: ['profit'],
            registeredPriorityMap: ccl.DEFAULT_PRIORITY_RANKS,
            utilityScore: 0.8
        });
        expect(r.charterStatus).toBe('CONSTITUTIONAL_COMPLIANT');
    });

    test('integrity conflict → DEGRADED (rank 4, not blocker)', () => {
        const r = ccl.resolveConflict({
            involvedPrincipleKinds: ['integrity'],
            registeredPriorityMap: ccl.DEFAULT_PRIORITY_RANKS,
            utilityScore: 0.5
        });
        expect(r.charterStatus).toBe('CONSTITUTIONALLY_DEGRADED');
    });

    test('compliance + integrity → BLOCKED (compliance rank 3)', () => {
        const r = ccl.resolveConflict({
            involvedPrincipleKinds: ['compliance', 'integrity'],
            registeredPriorityMap: ccl.DEFAULT_PRIORITY_RANKS,
            utilityScore: 0.9
        });
        expect(r.charterStatus).toBe('CONSTITUTIONALLY_BLOCKED');
    });

    test('no conflicts → COMPLIANT', () => {
        const r = ccl.resolveConflict({
            involvedPrincipleKinds: [],
            registeredPriorityMap: ccl.DEFAULT_PRIORITY_RANKS,
            utilityScore: 0.5
        });
        expect(r.charterStatus).toBe('CONSTITUTIONAL_COMPLIANT');
    });
});

describe('§116 registerPrinciple', () => {
    test('persists with default rank', () => {
        const r = ccl.registerPrinciple({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            principleId: 'RP-1', kind: 'safety',
            description: 'never break user funds'
        });
        expect(r.registered).toBe(true);
        expect(r.priorityRank).toBe(1);
    });

    test('explicit rank override respected', () => {
        const r = ccl.registerPrinciple({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            principleId: 'RP-OV', kind: 'truth',
            priorityRank: 99, description: 'd'
        });
        expect(r.priorityRank).toBe(99);
    });

    test('duplicate throws', () => {
        ccl.registerPrinciple({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            principleId: 'RP-DUP', kind: 'safety', description: 'd'
        });
        expect(() => ccl.registerPrinciple({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            principleId: 'RP-DUP', kind: 'truth', description: 'd2'
        })).toThrow();
    });

    test('invalid kind throws', () => {
        expect(() => ccl.registerPrinciple({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            principleId: 'RP-BAD', kind: 'BOGUS', description: 'd'
        })).toThrow();
    });
});

describe('§116 evaluateDecisionAgainstCharter', () => {
    test('uses registered principles to evaluate', () => {
        ccl.registerPrinciple({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            principleId: 'ED-S', kind: 'safety', description: 'd'
        });
        const r = ccl.evaluateDecisionAgainstCharter({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            principleKinds: ['safety'], utilityScore: 0.8
        });
        expect(r.charterStatus).toBe('CONSTITUTIONALLY_BLOCKED');
    });

    test('falls back to DEFAULT when no registered principle', () => {
        const r = ccl.evaluateDecisionAgainstCharter({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            principleKinds: ['profit'], utilityScore: 0.5
        });
        expect(r.charterStatus).toBe('CONSTITUTIONAL_COMPLIANT');
    });
});

describe('§116 recordCharterDecision', () => {
    test('persists', () => {
        const r = ccl.recordCharterDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'RD-1',
            actionSummary: 'short BTC at 67k',
            conflictingPrinciples: ['profit', 'safety'],
            charterStatus: 'CONSTITUTIONALLY_BLOCKED',
            utilityScore: 0.6,
            overrideReason: null
        });
        expect(r.recorded).toBe(true);
    });

    test('invalid status throws', () => {
        expect(() => ccl.recordCharterDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'RD-BAD', actionSummary: 'a',
            conflictingPrinciples: [],
            charterStatus: 'BOGUS', utilityScore: 0.5
        })).toThrow();
    });
});

describe('§116 getActivePrinciples', () => {
    test('filter by kind', () => {
        ccl.registerPrinciple({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            principleId: 'GP-S', kind: 'safety', description: 'd'
        });
        ccl.registerPrinciple({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            principleId: 'GP-T', kind: 'truth', description: 'd'
        });
        const r = ccl.getActivePrinciples({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            kindFilter: 'safety'
        });
        expect(r).toHaveLength(1);
        expect(r[0].principleId).toBe('GP-S');
    });
});

describe('§116 getCharterDecisions', () => {
    test('filter by status', () => {
        ccl.recordCharterDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'GCD-B',
            actionSummary: 'a', conflictingPrinciples: ['safety'],
            charterStatus: 'CONSTITUTIONALLY_BLOCKED'
        });
        ccl.recordCharterDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'GCD-C',
            actionSummary: 'b', conflictingPrinciples: [],
            charterStatus: 'CONSTITUTIONAL_COMPLIANT'
        });
        const r = ccl.getCharterDecisions({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            statusFilter: 'CONSTITUTIONALLY_BLOCKED'
        });
        expect(r).toHaveLength(1);
        expect(r[0].decisionId).toBe('GCD-B');
    });
});

describe('§116 isolation', () => {
    test('per (user × env) isolation', () => {
        ccl.registerPrinciple({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            principleId: 'ISO-1', kind: 'safety', description: 'd'
        });
        const a = ccl.getActivePrinciples({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const b = ccl.getActivePrinciples({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(a).toHaveLength(1);
        expect(b).toHaveLength(0);
    });
});
