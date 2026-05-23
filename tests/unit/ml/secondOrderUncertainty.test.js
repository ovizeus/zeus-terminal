'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p126-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const sou = require('../../../server/services/ml/R5A_learning/secondOrderUncertainty');

const TEST_USER = 9126;
const OTHER_USER = 9127;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_confidence_assessments WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
    db.prepare('DELETE FROM ml_calibration_drift_audit WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§126 Migrations 241 + 242', () => {
    test('assessment_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_confidence_assessments
             (user_id, resolved_env, assessment_id, decision_id,
              primary_confidence, confidence_of_confidence,
              calibration_reliability, local_drift, quadrant,
              penalized_confidence, recommended_action, ts)
             VALUES (?, ?, 'CA-UNIQ', 'D', 0.8, 0.7, 0.7, 0.1,
                     'high_conf_robust', 0.4, 'proceed', ?)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_confidence_assessments
             (user_id, resolved_env, assessment_id, decision_id,
              primary_confidence, confidence_of_confidence,
              calibration_reliability, local_drift, quadrant,
              penalized_confidence, recommended_action, ts)
             VALUES (?, ?, 'CA-UNIQ', 'D2', 0.5, 0.5, 0.5, 0.5,
                     'low_conf_noisy', 0.125, 'observer', ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('CHECK quadrant restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_confidence_assessments
             (user_id, resolved_env, assessment_id, decision_id,
              primary_confidence, confidence_of_confidence,
              calibration_reliability, local_drift, quadrant,
              penalized_confidence, recommended_action, ts)
             VALUES (?, ?, 'CA-BAD', 'D', 0.5, 0.5, 0.5, 0.5,
                     'BOGUS', 0.125, 'proceed', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK recommended_action restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_confidence_assessments
             (user_id, resolved_env, assessment_id, decision_id,
              primary_confidence, confidence_of_confidence,
              calibration_reliability, local_drift, quadrant,
              penalized_confidence, recommended_action, ts)
             VALUES (?, ?, 'CA-ABAD', 'D', 0.5, 0.5, 0.5, 0.5,
                     'low_conf_noisy', 0.125, 'BOGUS', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK drift_magnitude range', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_calibration_drift_audit
             (user_id, resolved_env, audit_id, assessment_id,
              drift_source, drift_magnitude, notes, ts)
             VALUES (?, ?, 'CDA-OOR', 'A', 'source', 1.5, NULL, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§126 Constants', () => {
    test('QUADRANTS has 4 entries', () => {
        expect(sou.QUADRANTS).toEqual([
            'high_conf_robust', 'high_conf_fragile',
            'low_conf_robust', 'low_conf_noisy'
        ]);
    });

    test('RECOMMENDED_ACTIONS has 5 entries', () => {
        expect(sou.RECOMMENDED_ACTIONS).toEqual([
            'proceed', 'size_reduce', 'wait',
            'active_sensing', 'observer'
        ]);
    });

    test('thresholds positive in (0,1)', () => {
        expect(sou.HIGH_CONFIDENCE_THRESHOLD).toBeGreaterThan(0);
        expect(sou.HIGH_CONFIDENCE_THRESHOLD).toBeLessThan(1);
        expect(sou.ROBUST_THRESHOLD).toBeGreaterThan(0);
        expect(sou.ROBUST_THRESHOLD).toBeLessThan(1);
    });
});

describe('§126 classifyQuadrant (pure)', () => {
    test('high primary + robust conf-of-conf → high_conf_robust', () => {
        const r = sou.classifyQuadrant({
            primaryConfidence: 0.85, confidenceOfConfidence: 0.75
        });
        expect(r.quadrant).toBe('high_conf_robust');
    });

    test('high primary + fragile conf-of-conf → high_conf_fragile', () => {
        const r = sou.classifyQuadrant({
            primaryConfidence: 0.85, confidenceOfConfidence: 0.30
        });
        expect(r.quadrant).toBe('high_conf_fragile');
    });

    test('low primary + robust conf-of-conf → low_conf_robust', () => {
        const r = sou.classifyQuadrant({
            primaryConfidence: 0.40, confidenceOfConfidence: 0.80
        });
        expect(r.quadrant).toBe('low_conf_robust');
    });

    test('low primary + noisy conf-of-conf → low_conf_noisy', () => {
        const r = sou.classifyQuadrant({
            primaryConfidence: 0.40, confidenceOfConfidence: 0.30
        });
        expect(r.quadrant).toBe('low_conf_noisy');
    });
});

describe('§126 applyPenalty (pure)', () => {
    test('triple product', () => {
        const r = sou.applyPenalty({
            primaryConfidence: 0.8,
            confidenceOfConfidence: 0.5,
            calibrationReliability: 0.5
        });
        expect(r.penalizedConfidence).toBeCloseTo(0.2);
    });

    test('zero in any axis → 0', () => {
        const r = sou.applyPenalty({
            primaryConfidence: 1.0,
            confidenceOfConfidence: 0,
            calibrationReliability: 1.0
        });
        expect(r.penalizedConfidence).toBe(0);
    });

    test('all 1.0 → 1.0', () => {
        const r = sou.applyPenalty({
            primaryConfidence: 1.0,
            confidenceOfConfidence: 1.0,
            calibrationReliability: 1.0
        });
        expect(r.penalizedConfidence).toBe(1.0);
    });
});

describe('§126 selectRecommendedAction (pure)', () => {
    test('high_conf_robust → proceed', () => {
        const r = sou.selectRecommendedAction({
            quadrant: 'high_conf_robust'
        });
        expect(r.action).toBe('proceed');
    });

    test('high_conf_fragile → size_reduce', () => {
        const r = sou.selectRecommendedAction({
            quadrant: 'high_conf_fragile'
        });
        expect(['size_reduce', 'wait']).toContain(r.action);
    });

    test('low_conf_robust → active_sensing', () => {
        const r = sou.selectRecommendedAction({
            quadrant: 'low_conf_robust'
        });
        expect(r.action).toBe('active_sensing');
    });

    test('low_conf_noisy → observer', () => {
        const r = sou.selectRecommendedAction({
            quadrant: 'low_conf_noisy'
        });
        expect(r.action).toBe('observer');
    });

    test('high drift escalates fragile to wait', () => {
        const r = sou.selectRecommendedAction({
            quadrant: 'high_conf_fragile',
            localDrift: 0.8
        });
        expect(r.action).toBe('wait');
    });
});

describe('§126 assessConfidence', () => {
    test('persists + computes quadrant + penalty + action', () => {
        const r = sou.assessConfidence({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            assessmentId: 'AC-1', decisionId: 'D-1',
            primaryConfidence: 0.85, confidenceOfConfidence: 0.75,
            calibrationReliability: 0.80, localDrift: 0.10
        });
        expect(r.assessed).toBe(true);
        expect(r.quadrant).toBe('high_conf_robust');
        expect(r.recommendedAction).toBe('proceed');
        expect(r.penalizedConfidence).toBeGreaterThan(0);
    });

    test('duplicate throws', () => {
        sou.assessConfidence({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            assessmentId: 'AC-DUP', decisionId: 'D',
            primaryConfidence: 0.5, confidenceOfConfidence: 0.5,
            calibrationReliability: 0.5, localDrift: 0.5
        });
        expect(() => sou.assessConfidence({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            assessmentId: 'AC-DUP', decisionId: 'D2',
            primaryConfidence: 0.6, confidenceOfConfidence: 0.6,
            calibrationReliability: 0.6, localDrift: 0.4
        })).toThrow();
    });

    test('range violation throws', () => {
        expect(() => sou.assessConfidence({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            assessmentId: 'AC-OOR', decisionId: 'D',
            primaryConfidence: 1.5, confidenceOfConfidence: 0.5,
            calibrationReliability: 0.5, localDrift: 0.5
        })).toThrow();
    });
});

describe('§126 recordCalibrationDrift', () => {
    test('persists', () => {
        const r = sou.recordCalibrationDrift({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            auditId: 'CD-1', assessmentId: 'A-1',
            driftSource: 'recent_market_regime_change',
            driftMagnitude: 0.7,
            notes: 'calibration last update 30d ago'
        });
        expect(r.recorded).toBe(true);
    });

    test('range violation throws', () => {
        expect(() => sou.recordCalibrationDrift({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            auditId: 'CD-OOR', assessmentId: 'A',
            driftSource: 'x', driftMagnitude: 1.5
        })).toThrow();
    });
});

describe('§126 getAssessmentHistory', () => {
    test('filter by quadrant', () => {
        sou.assessConfidence({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            assessmentId: 'GH-1', decisionId: 'D-1',
            primaryConfidence: 0.85, confidenceOfConfidence: 0.75,
            calibrationReliability: 0.8, localDrift: 0.1
        });
        sou.assessConfidence({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            assessmentId: 'GH-2', decisionId: 'D-2',
            primaryConfidence: 0.3, confidenceOfConfidence: 0.3,
            calibrationReliability: 0.5, localDrift: 0.3
        });
        const r = sou.getAssessmentHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            quadrantFilter: 'high_conf_robust'
        });
        expect(r).toHaveLength(1);
        expect(r[0].assessmentId).toBe('GH-1');
    });
});

describe('§126 isolation', () => {
    test('per (user × env) isolation', () => {
        sou.assessConfidence({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            assessmentId: 'ISO-1', decisionId: 'D',
            primaryConfidence: 0.5, confidenceOfConfidence: 0.5,
            calibrationReliability: 0.5, localDrift: 0.5
        });
        const a = sou.getAssessmentHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const b = sou.getAssessmentHistory({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(a).toHaveLength(1);
        expect(b).toHaveLength(0);
    });
});
