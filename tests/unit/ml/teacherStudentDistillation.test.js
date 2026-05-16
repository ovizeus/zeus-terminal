'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p89-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const tsd = require('../../../server/services/ml/R5A_learning/teacherStudentDistillation');

const TEST_USER = 9089;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_model_distillation_pairs WHERE user_id IN (?, ?)').run(TEST_USER, 9090);
    db.prepare('DELETE FROM ml_distillation_observations WHERE user_id IN (?, ?)').run(TEST_USER, 9090);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§89 Migrations 167 + 168', () => {
    test('pair_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_model_distillation_pairs
             (user_id, resolved_env, pair_id, teacher_model_id,
              student_model_id, regime_scope, divergence_threshold,
              status, last_validated)
             VALUES (?, ?, 'P-UNIQ', 'T1', 'S1', 'global', 0.20, 'HEALTHY', ?)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_model_distillation_pairs
             (user_id, resolved_env, pair_id, teacher_model_id,
              student_model_id, regime_scope, divergence_threshold,
              status, last_validated)
             VALUES (?, ?, 'P-UNIQ', 'T2', 'S2', 'global', 0.20, 'HEALTHY', ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('CHECK status restricts', () => {
        const ts = Date.now();
        expect(() => db.prepare(
            `INSERT INTO ml_model_distillation_pairs
             (user_id, resolved_env, pair_id, teacher_model_id,
              student_model_id, regime_scope, divergence_threshold,
              status, last_validated)
             VALUES (?, ?, 'P-BAD', 'T', 'S', 'global', 0.20, 'BOGUS', ?)`
        ).run(TEST_USER, TEST_ENV, ts)).toThrow();
    });

    test('CHECK fallback_triggered IN (0,1)', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_distillation_observations
             (user_id, resolved_env, observation_id, pair_id,
              teacher_output_json, student_output_json, divergence,
              fallback_triggered, ts)
             VALUES (?, ?, 'O-BAD', 'P', '{}', '{}', 0.5, 2, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§89 Constants', () => {
    test('PAIR_STATUSES has 3 entries', () => {
        expect(tsd.PAIR_STATUSES).toEqual([
            'HEALTHY', 'DRIFTING', 'FALLBACK_ACTIVE'
        ]);
    });

    test('RECOMMENDATIONS has 3 entries', () => {
        expect(tsd.RECOMMENDATIONS).toEqual([
            'CONTINUE', 'MONITOR', 'FALLBACK_TO_TEACHER'
        ]);
    });

    test('FALLBACK threshold > divergence threshold', () => {
        expect(tsd.FALLBACK_TRIGGER_THRESHOLD).toBeGreaterThan(
            tsd.DEFAULT_DIVERGENCE_THRESHOLD
        );
    });
});

describe('§89 computeDivergence (pure)', () => {
    test('identical outputs → 0', () => {
        const r = tsd.computeDivergence({
            teacherOutput: { score: 0.7, action: 'LONG' },
            studentOutput: { score: 0.7, action: 'LONG' }
        });
        expect(r).toBe(0);
    });

    test('numeric divergence proportional', () => {
        const r = tsd.computeDivergence({
            teacherOutput: { score: 1.0 },
            studentOutput: { score: 0.5 }
        });
        expect(r).toBeCloseTo(0.5);
    });

    test('categorical mismatch = 1', () => {
        const r = tsd.computeDivergence({
            teacherOutput: { action: 'LONG' },
            studentOutput: { action: 'SHORT' }
        });
        expect(r).toBe(1);
    });

    test('mixed averages', () => {
        const r = tsd.computeDivergence({
            teacherOutput: { score: 1.0, action: 'LONG' },
            studentOutput: { score: 1.0, action: 'SHORT' }
        });
        // numeric=0, categorical=1, avg=0.5
        expect(r).toBeCloseTo(0.5);
    });

    test('empty outputs → 0', () => {
        const r = tsd.computeDivergence({
            teacherOutput: {}, studentOutput: {}
        });
        expect(r).toBe(0);
    });
});

describe('§89 registerModelPair', () => {
    test('persists', () => {
        const r = tsd.registerModelPair({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            pairId: 'PAIR-1', teacherId: 'big', studentId: 'small',
            divergenceThreshold: 0.15
        });
        expect(r.registered).toBe(true);
    });

    test('duplicate throws', () => {
        tsd.registerModelPair({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            pairId: 'PAIR-DUP', teacherId: 'T', studentId: 'S'
        });
        expect(() => tsd.registerModelPair({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            pairId: 'PAIR-DUP', teacherId: 'T2', studentId: 'S2'
        })).toThrow();
    });
});

describe('§89 recordDistillationObservation', () => {
    test('persists + auto-computes divergence', () => {
        tsd.registerModelPair({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            pairId: 'P-OBS', teacherId: 'T', studentId: 'S'
        });
        const r = tsd.recordDistillationObservation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            observationId: 'O-001', pairId: 'P-OBS',
            teacherOutput: { score: 0.8 },
            studentOutput: { score: 0.7 }
        });
        // denom = max(|0.8|, 1) = 1; div = |0.8-0.7|/1 = 0.10
        expect(r.divergence).toBeCloseTo(0.10, 2);
        expect(r.fallbackTriggered).toBe(false);
    });

    test('high divergence triggers fallback flag', () => {
        tsd.registerModelPair({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            pairId: 'P-FALL', teacherId: 'T', studentId: 'S'
        });
        const r = tsd.recordDistillationObservation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            observationId: 'O-FALL', pairId: 'P-FALL',
            teacherOutput: { action: 'LONG' },
            studentOutput: { action: 'SHORT' }
        });
        expect(r.fallbackTriggered).toBe(true);
    });
});

describe('§89 evaluateConsistency', () => {
    beforeEach(() => {
        tsd.registerModelPair({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            pairId: 'P-EVAL', teacherId: 'T', studentId: 'S'
        });
    });

    test('insufficient samples → CONTINUE', () => {
        for (let i = 0; i < 3; i++) {
            tsd.recordDistillationObservation({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                observationId: `OE-${i}`, pairId: 'P-EVAL',
                teacherOutput: { s: 0.7 }, studentOutput: { s: 0.7 }
            });
        }
        const r = tsd.evaluateConsistency({
            userId: TEST_USER, resolvedEnv: TEST_ENV, pairId: 'P-EVAL'
        });
        expect(r.recommendation).toBe('CONTINUE');
        expect(r.sufficient).toBe(false);
    });

    test('low divergence → CONTINUE + HEALTHY', () => {
        for (let i = 0; i < 15; i++) {
            tsd.recordDistillationObservation({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                observationId: `OH-${i}`, pairId: 'P-EVAL',
                teacherOutput: { s: 0.7 }, studentOutput: { s: 0.71 }
            });
        }
        const r = tsd.evaluateConsistency({
            userId: TEST_USER, resolvedEnv: TEST_ENV, pairId: 'P-EVAL'
        });
        expect(r.recommendation).toBe('CONTINUE');
        expect(r.status).toBe('HEALTHY');
    });

    test('moderate divergence → MONITOR + DRIFTING', () => {
        for (let i = 0; i < 15; i++) {
            tsd.recordDistillationObservation({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                observationId: `OM-${i}`, pairId: 'P-EVAL',
                teacherOutput: { s: 1.0 }, studentOutput: { s: 0.75 }
            });
        }
        const r = tsd.evaluateConsistency({
            userId: TEST_USER, resolvedEnv: TEST_ENV, pairId: 'P-EVAL'
        });
        expect(r.recommendation).toBe('MONITOR');
        expect(r.status).toBe('DRIFTING');
    });

    test('high divergence → FALLBACK_TO_TEACHER + FALLBACK_ACTIVE', () => {
        for (let i = 0; i < 15; i++) {
            tsd.recordDistillationObservation({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                observationId: `OF-${i}`, pairId: 'P-EVAL',
                teacherOutput: { a: 'LONG' }, studentOutput: { a: 'SHORT' }
            });
        }
        const r = tsd.evaluateConsistency({
            userId: TEST_USER, resolvedEnv: TEST_ENV, pairId: 'P-EVAL'
        });
        expect(r.recommendation).toBe('FALLBACK_TO_TEACHER');
        expect(r.status).toBe('FALLBACK_ACTIVE');
    });
});

describe('§89 triggerFallback', () => {
    test('marks FALLBACK_ACTIVE', () => {
        tsd.registerModelPair({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            pairId: 'P-TRIG', teacherId: 'T', studentId: 'S'
        });
        tsd.triggerFallback({
            userId: TEST_USER, resolvedEnv: TEST_ENV, pairId: 'P-TRIG'
        });
        const s = tsd.getPairStatus({
            userId: TEST_USER, resolvedEnv: TEST_ENV, pairId: 'P-TRIG'
        });
        expect(s.status).toBe('FALLBACK_ACTIVE');
    });
});

describe('§89 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9090;
        tsd.registerModelPair({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            pairId: 'P-ISO', teacherId: 'T', studentId: 'S'
        });
        const s1 = tsd.getPairStatus({
            userId: TEST_USER, resolvedEnv: TEST_ENV, pairId: 'P-ISO'
        });
        const s2 = tsd.getPairStatus({
            userId: OTHER_USER, resolvedEnv: TEST_ENV, pairId: 'P-ISO'
        });
        expect(s1.exists).toBe(true);
        expect(s2.exists).toBe(false);
    });
});
