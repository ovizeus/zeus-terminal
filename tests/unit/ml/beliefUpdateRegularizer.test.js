'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p118-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const bur = require('../../../server/services/ml/R5A_learning/beliefUpdateRegularizer');

const TEST_USER = 9118;
const OTHER_USER = 9119;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_belief_regularization_audit WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
    db.prepare('DELETE FROM ml_belief_update_limits WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§118 Migrations 225 + 226', () => {
    test('audit_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_belief_regularization_audit
             (user_id, resolved_env, audit_id, belief_id,
              prior_value, proposed_value, applied_value,
              evidence_kind, regularization_factor, reason, ts)
             VALUES (?, ?, 'BRA-UNIQ', 'B', 0.5, 0.7, 0.55, 'structural_signal', 1.0, 'r', ?)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_belief_regularization_audit
             (user_id, resolved_env, audit_id, belief_id,
              prior_value, proposed_value, applied_value,
              evidence_kind, regularization_factor, reason, ts)
             VALUES (?, ?, 'BRA-UNIQ', 'B2', 0.3, 0.4, 0.35, 'lucky_streak', 0.2, 'r2', ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('CHECK evidence_kind restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_belief_regularization_audit
             (user_id, resolved_env, audit_id, belief_id,
              prior_value, proposed_value, applied_value,
              evidence_kind, regularization_factor, reason, ts)
             VALUES (?, ?, 'BRA-BAD', 'B', 0.5, 0.7, 0.6, 'BOGUS', 0.5, NULL, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK max_delta_per_update > 0', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_belief_update_limits
             (user_id, resolved_env, limit_id, belief_category,
              max_delta_per_update, max_updates_per_window,
              window_seconds, regime_modifier_json,
              ts_created, ts_last_updated)
             VALUES (?, ?, 'L-BAD', 'cat', 0, 5, 60, NULL, ?, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now(), Date.now())).toThrow();
    });
});

describe('§118 Constants', () => {
    test('EVIDENCE_KINDS has 4 entries', () => {
        expect(bur.EVIDENCE_KINDS).toEqual([
            'structural_signal', 'strident_event',
            'lucky_streak', 'unlucky_streak'
        ]);
    });

    test('structural factor is highest', () => {
        expect(bur.KIND_REGULARIZATION_FACTORS.structural_signal)
            .toBeGreaterThan(bur.KIND_REGULARIZATION_FACTORS.strident_event);
        expect(bur.KIND_REGULARIZATION_FACTORS.strident_event)
            .toBeGreaterThan(bur.KIND_REGULARIZATION_FACTORS.lucky_streak);
    });

    test('NOISY_REGIME_MULTIPLIER < 1', () => {
        expect(bur.NOISY_REGIME_MULTIPLIER).toBeLessThan(1);
    });
});

describe('§118 classifyEvidenceKind (pure)', () => {
    test('structural_signal: large samples + moderate delta + low noise', () => {
        const r = bur.classifyEvidenceKind({
            deltaMagnitude: 0.10, sampleSize: 50, regimeNoiseLevel: 0.2
        });
        expect(r.kind).toBe('structural_signal');
    });

    test('strident_event: extreme delta + few samples', () => {
        const r = bur.classifyEvidenceKind({
            deltaMagnitude: 0.50, sampleSize: 2, regimeNoiseLevel: 0.3
        });
        expect(r.kind).toBe('strident_event');
    });

    test('lucky_streak: positive delta + few samples + high noise', () => {
        const r = bur.classifyEvidenceKind({
            deltaMagnitude: 0.15, sampleSize: 4, regimeNoiseLevel: 0.8,
            deltaSign: 1
        });
        expect(r.kind).toBe('lucky_streak');
    });

    test('unlucky_streak: negative delta + few samples + high noise', () => {
        const r = bur.classifyEvidenceKind({
            deltaMagnitude: 0.15, sampleSize: 4, regimeNoiseLevel: 0.8,
            deltaSign: -1
        });
        expect(r.kind).toBe('unlucky_streak');
    });
});

describe('§118 computeRegularizationFactor (pure)', () => {
    test('structural_signal → factor 1.0', () => {
        const r = bur.computeRegularizationFactor({
            evidenceKind: 'structural_signal'
        });
        expect(r.factor).toBe(1.0);
    });

    test('lucky_streak → low factor', () => {
        const r = bur.computeRegularizationFactor({
            evidenceKind: 'lucky_streak'
        });
        expect(r.factor).toBe(0.2);
    });

    test('noisy regime halves factor', () => {
        const r = bur.computeRegularizationFactor({
            evidenceKind: 'structural_signal',
            regimeNoiseLevel: 0.9
        });
        expect(r.factor).toBeCloseTo(0.5);
    });

    test('invalid kind throws', () => {
        expect(() => bur.computeRegularizationFactor({
            evidenceKind: 'BOGUS'
        })).toThrow();
    });
});

describe('§118 regularizeUpdate (pure)', () => {
    test('structural fully applies', () => {
        const r = bur.regularizeUpdate({
            priorValue: 0.4, proposedValue: 0.6,
            evidenceKind: 'structural_signal'
        });
        // factor=1.0, delta=0.2 within maxDelta=0.10 → clamped
        expect(r.appliedValue).toBeCloseTo(0.5);   // prior + clamped delta
    });

    test('lucky_streak heavily damped', () => {
        const r = bur.regularizeUpdate({
            priorValue: 0.4, proposedValue: 0.9,
            evidenceKind: 'lucky_streak'
        });
        // delta=0.5, factor=0.2 → 0.1, but maxDelta=0.10 → 0.10
        // applied = 0.4 + 0.10 = 0.50
        expect(r.appliedValue).toBeLessThan(0.6);
    });

    test('clamps to maxDelta', () => {
        const r = bur.regularizeUpdate({
            priorValue: 0.5, proposedValue: 1.0,
            evidenceKind: 'structural_signal',
            maxDelta: 0.05
        });
        expect(r.appliedValue).toBeCloseTo(0.55);
    });
});

describe('§118 registerSpeedLimit', () => {
    test('persists', () => {
        const r = bur.registerSpeedLimit({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            limitId: 'RL-1', beliefCategory: 'core_thresholds',
            maxDeltaPerUpdate: 0.05,
            maxUpdatesPerWindow: 3, windowSeconds: 3600
        });
        expect(r.registered).toBe(true);
    });

    test('duplicate throws', () => {
        bur.registerSpeedLimit({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            limitId: 'RL-DUP', beliefCategory: 'x',
            maxDeltaPerUpdate: 0.05, maxUpdatesPerWindow: 3,
            windowSeconds: 3600
        });
        expect(() => bur.registerSpeedLimit({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            limitId: 'RL-DUP', beliefCategory: 'y',
            maxDeltaPerUpdate: 0.1, maxUpdatesPerWindow: 5,
            windowSeconds: 7200
        })).toThrow();
    });

    test('zero maxDelta throws', () => {
        expect(() => bur.registerSpeedLimit({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            limitId: 'RL-ZERO', beliefCategory: 'x',
            maxDeltaPerUpdate: 0, maxUpdatesPerWindow: 3,
            windowSeconds: 60
        })).toThrow();
    });
});

describe('§118 recordBeliefUpdate', () => {
    test('persists audit row', () => {
        const r = bur.recordBeliefUpdate({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            auditId: 'AU-1', beliefId: 'B-1',
            priorValue: 0.5, proposedValue: 0.7,
            appliedValue: 0.55,
            evidenceKind: 'strident_event',
            regularizationFactor: 0.3,
            reason: 'one_off_shock'
        });
        expect(r.recorded).toBe(true);
    });

    test('invalid evidence_kind throws', () => {
        expect(() => bur.recordBeliefUpdate({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            auditId: 'AU-BAD', beliefId: 'B',
            priorValue: 0.5, proposedValue: 0.6,
            appliedValue: 0.55, evidenceKind: 'BOGUS',
            regularizationFactor: 0.5
        })).toThrow();
    });
});

describe('§118 getUpdateAudit', () => {
    test('returns audit DESC by ts', () => {
        bur.recordBeliefUpdate({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            auditId: 'GA-1', beliefId: 'B-AU',
            priorValue: 0.5, proposedValue: 0.6, appliedValue: 0.55,
            evidenceKind: 'structural_signal', regularizationFactor: 1.0,
            ts: 1000
        });
        bur.recordBeliefUpdate({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            auditId: 'GA-2', beliefId: 'B-AU',
            priorValue: 0.55, proposedValue: 0.7, appliedValue: 0.60,
            evidenceKind: 'lucky_streak', regularizationFactor: 0.2,
            ts: 2000
        });
        const r = bur.getUpdateAudit({
            userId: TEST_USER, resolvedEnv: TEST_ENV, beliefId: 'B-AU'
        });
        expect(r).toHaveLength(2);
        expect(r[0].auditId).toBe('GA-2');
    });
});

describe('§118 isolation', () => {
    test('per (user × env) isolation', () => {
        bur.recordBeliefUpdate({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            auditId: 'ISO-1', beliefId: 'B-ISO',
            priorValue: 0.5, proposedValue: 0.6, appliedValue: 0.55,
            evidenceKind: 'structural_signal', regularizationFactor: 1.0
        });
        const a = bur.getUpdateAudit({
            userId: TEST_USER, resolvedEnv: TEST_ENV, beliefId: 'B-ISO'
        });
        const b = bur.getUpdateAudit({
            userId: OTHER_USER, resolvedEnv: TEST_ENV, beliefId: 'B-ISO'
        });
        expect(a).toHaveLength(1);
        expect(b).toHaveLength(0);
    });
});
