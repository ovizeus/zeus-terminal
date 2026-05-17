'use strict';

/**
 * OMEGA §148 ONTOLOGICAL HUMILITY / REALITY-EXCEEDS-MODEL GOVERNOR.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt lines 4821-4868.
 *
 * "ce parte a realitatii mele actuale nu incape bine in limbajul meu,
 *  chiar daca sistemul inca pare functional?"
 *
 * Tests written FIRST per TDD discipline (RED step). Module does not
 * exist yet — these tests MUST fail when run before module creation.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p148-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/_meta/ontologicalHumilityGovernor');

const UID = 9148;
const UID_OBS = 9248;
const UID_ASS = 9348;
const UID_GET = 9448;
const UID_ISO_A = 9548;
const UID_ISO_B = 9648;
const UID_ENV = 9748;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    const uids = [UID, UID_OBS, UID_ASS, UID_GET,
                  UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_ontological_humility_assessments WHERE user_id IN (${placeholders})`).run(...uids);
    db.prepare(`DELETE FROM ml_open_remainder_observations WHERE user_id IN (${placeholders})`).run(...uids);
}
beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §148 ONTOLOGICAL HUMILITY GOVERNOR', () => {

    describe('Migrations 294+295', () => {
        test('294 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('294_ml_open_remainder_observations')).toBeTruthy();
        });
        test('295 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('295_ml_ontological_humility_assessments')).toBeTruthy();
        });
        test('flagged_category CHECK enum on observations', () => {
            expect(() => db.prepare(`INSERT INTO ml_open_remainder_observations
                (user_id, resolved_env, observation_id, decision_id,
                 phenomenon_description, attempted_categories_json,
                 best_match_score, residual_score, flagged_category, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'o_bk', null, 'phenomenon', '[]',
                    0.5, 0.5, 'BOGUS', _now())).toThrow();
        });
        test('humility_level CHECK enum on assessments', () => {
            expect(() => db.prepare(`INSERT INTO ml_ontological_humility_assessments
                (user_id, resolved_env, assessment_id, window_start_ts,
                 window_end_ts, observations_count, mean_residual_score,
                 overclosure_attempts_count, humility_score, humility_level,
                 aggression_penalty, recommended_action, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'a_bk', 100, 200, 5, 0.5, 0, 0.5,
                    'BOGUS', 0, 'continue', _now())).toThrow();
        });
        test('recommended_action CHECK enum', () => {
            expect(() => db.prepare(`INSERT INTO ml_ontological_humility_assessments
                (user_id, resolved_env, assessment_id, window_start_ts,
                 window_end_ts, observations_count, mean_residual_score,
                 overclosure_attempts_count, humility_score, humility_level,
                 aggression_penalty, recommended_action, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'a_ba', 100, 200, 5, 0.5, 0, 0.5,
                    'moderate', 0, 'BOGUS', _now())).toThrow();
        });
        test('observation_id UNIQUE', () => {
            const stmt = db.prepare(`INSERT INTO ml_open_remainder_observations
                (user_id, resolved_env, observation_id, decision_id,
                 phenomenon_description, attempted_categories_json,
                 best_match_score, residual_score, flagged_category, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            stmt.run(UID, ENV, 'o_dup', null, 'p1', '[]',
                0.5, 0.5, 'captured', _now());
            expect(() => stmt.run(UID, ENV, 'o_dup', null, 'p2', '[]',
                0.3, 0.7, 'unexplained', _now())).toThrow();
        });
        test('range CHECK on best_match_score', () => {
            const stmt = db.prepare(`INSERT INTO ml_open_remainder_observations
                (user_id, resolved_env, observation_id, decision_id,
                 phenomenon_description, attempted_categories_json,
                 best_match_score, residual_score, flagged_category, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            expect(() => stmt.run(UID, ENV, 'o_br', null, 'p', '[]',
                1.5, 0.5, 'captured', _now())).toThrow();
        });
    });

    describe('Constants', () => {
        test('FLAGGED_CATEGORIES frozen 4 (captured + 3 escalating)', () => {
            expect(M.FLAGGED_CATEGORIES).toEqual([
                'captured', 'partially_captured',
                'unexplained', 'forces_new_category'
            ]);
            expect(Object.isFrozen(M.FLAGGED_CATEGORIES)).toBe(true);
        });
        test('RECOMMENDED_ACTIONS frozen 3', () => {
            expect(M.RECOMMENDED_ACTIONS).toEqual([
                'continue', 'increase_observation', 'expand_ontology'
            ]);
            expect(Object.isFrozen(M.RECOMMENDED_ACTIONS)).toBe(true);
        });
        test('HUMILITY_LEVELS frozen 3', () => {
            expect(M.HUMILITY_LEVELS).toEqual(['low', 'moderate', 'high']);
            expect(Object.isFrozen(M.HUMILITY_LEVELS)).toBe(true);
        });
        test('RESIDUAL_THRESHOLDS ordered', () => {
            expect(M.RESIDUAL_THRESHOLDS.high).toBe(0.50);
            expect(M.RESIDUAL_THRESHOLDS.medium).toBe(0.20);
        });
        test('HUMILITY_THRESHOLDS ordered', () => {
            expect(M.HUMILITY_THRESHOLDS.high).toBe(0.70);
            expect(M.HUMILITY_THRESHOLDS.low).toBe(0.30);
        });
        test('AGGRESSION_PENALTY_MAP per humility level', () => {
            expect(M.AGGRESSION_PENALTY_MAP.high).toBe(0);
            expect(M.AGGRESSION_PENALTY_MAP.moderate).toBe(0.20);
            expect(M.AGGRESSION_PENALTY_MAP.low).toBe(0.50);
        });
        test('MIN_OBSERVATIONS_FOR_ASSESSMENT = 10', () => {
            expect(M.MIN_OBSERVATIONS_FOR_ASSESSMENT).toBe(10);
        });
    });

    describe('classifyResidual (pure)', () => {
        test('residual < 0.20 → captured', () => {
            expect(M.classifyResidual({ residualScore: 0.10 }).flag).toBe('captured');
        });
        test('residual 0.20..0.50 → partially_captured', () => {
            expect(M.classifyResidual({ residualScore: 0.35 }).flag).toBe('partially_captured');
        });
        test('residual ≥ 0.50 → unexplained', () => {
            expect(M.classifyResidual({ residualScore: 0.65 }).flag).toBe('unexplained');
        });
        test('boundary 0.20 → partially_captured', () => {
            expect(M.classifyResidual({ residualScore: 0.20 }).flag).toBe('partially_captured');
        });
        test('boundary 0.50 → unexplained', () => {
            expect(M.classifyResidual({ residualScore: 0.50 }).flag).toBe('unexplained');
        });
        test('out-of-range throws', () => {
            expect(() => M.classifyResidual({ residualScore: 1.5 })).toThrow();
        });
    });

    describe('computeHumilityScore (pure)', () => {
        test('all observations recognized as unexplained → high humility', () => {
            // Mean residual high + 0 overclosure = humility acknowledges limits
            const r = M.computeHumilityScore({
                meanResidual: 0.80,
                overclosureAttemptsCount: 0,
                totalObservations: 20
            });
            expect(r.humility).toBeGreaterThan(0.70);
        });
        test('low residual + 0 overclosures → moderate humility (everything captured)', () => {
            // Everything fits — no humility test stressed yet
            const r = M.computeHumilityScore({
                meanResidual: 0.05,
                overclosureAttemptsCount: 0,
                totalObservations: 20
            });
            expect(r.humility).toBeGreaterThan(0.40);
            expect(r.humility).toBeLessThan(0.85);
        });
        test('high residual + MANY overclosures → low humility (hubris)', () => {
            // System sees residuals but keeps forcing them into categories
            const r = M.computeHumilityScore({
                meanResidual: 0.80,
                overclosureAttemptsCount: 15,  // 75% of obs were forced
                totalObservations: 20
            });
            expect(r.humility).toBeLessThan(0.30);
        });
        test('zero observations → default baseline 0.50', () => {
            const r = M.computeHumilityScore({
                meanResidual: 0,
                overclosureAttemptsCount: 0,
                totalObservations: 0
            });
            expect(r.humility).toBe(0.50);
        });
        test('negative inputs throw', () => {
            expect(() => M.computeHumilityScore({
                meanResidual: -0.1,
                overclosureAttemptsCount: 0,
                totalObservations: 10
            })).toThrow();
        });
        test('overclosure > observations throws', () => {
            expect(() => M.computeHumilityScore({
                meanResidual: 0.5,
                overclosureAttemptsCount: 20,
                totalObservations: 10
            })).toThrow(/overclosure.*observ|exceeds/i);
        });
    });

    describe('classifyHumility (pure)', () => {
        test('≥0.70 → high', () => {
            expect(M.classifyHumility({ humilityScore: 0.85 }).level).toBe('high');
        });
        test('0.30..0.70 → moderate', () => {
            expect(M.classifyHumility({ humilityScore: 0.50 }).level).toBe('moderate');
        });
        test('<0.30 → low', () => {
            expect(M.classifyHumility({ humilityScore: 0.20 }).level).toBe('low');
        });
        test('boundary 0.70 → high', () => {
            expect(M.classifyHumility({ humilityScore: 0.70 }).level).toBe('high');
        });
        test('boundary 0.30 → moderate', () => {
            expect(M.classifyHumility({ humilityScore: 0.30 }).level).toBe('moderate');
        });
    });

    describe('computeAggressionPenalty (pure)', () => {
        test('high humility → 0 penalty (free to be aggressive)', () => {
            expect(M.computeAggressionPenalty({ humilityLevel: 'high' }).penalty).toBe(0);
        });
        test('moderate → 0.20 penalty', () => {
            expect(M.computeAggressionPenalty({ humilityLevel: 'moderate' }).penalty).toBe(0.20);
        });
        test('low humility (hubris) → 0.50 penalty (forced restraint)', () => {
            expect(M.computeAggressionPenalty({ humilityLevel: 'low' }).penalty).toBe(0.50);
        });
        test('invalid throws', () => {
            expect(() => M.computeAggressionPenalty({ humilityLevel: 'BOGUS' })).toThrow();
        });
    });

    describe('recommendAction (pure)', () => {
        test('high humility + low residual → continue', () => {
            expect(M.recommendAction({
                humilityLevel: 'high', meanResidual: 0.10
            }).action).toBe('continue');
        });
        test('moderate humility + high residual → increase_observation', () => {
            expect(M.recommendAction({
                humilityLevel: 'moderate', meanResidual: 0.55
            }).action).toBe('increase_observation');
        });
        test('low humility (hubris) → expand_ontology (forced)', () => {
            expect(M.recommendAction({
                humilityLevel: 'low', meanResidual: 0.65
            }).action).toBe('expand_ontology');
        });
        test('high humility + high residual → increase_observation (gather)', () => {
            expect(M.recommendAction({
                humilityLevel: 'high', meanResidual: 0.65
            }).action).toBe('increase_observation');
        });
        test('invalid humility throws', () => {
            expect(() => M.recommendAction({
                humilityLevel: 'BOGUS', meanResidual: 0.5
            })).toThrow();
        });
    });

    describe('recordOpenRemainderObservation', () => {
        test('persists observation with auto-classification', () => {
            const r = M.recordOpenRemainderObservation({
                userId: UID_OBS, resolvedEnv: ENV,
                observationId: 'or_persist',
                phenomenonDescription: 'unusual liquidation cascade with no funding stress',
                attemptedCategories: [
                    { category: 'liquidation_cascade', matchScore: 0.30 },
                    { category: 'flash_crash', matchScore: 0.25 }
                ],
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.bestMatchScore).toBe(0.30);
            expect(r.residualScore).toBeCloseTo(0.70, 6);
            expect(r.flaggedCategory).toBe('unexplained');
        });
        test('decision_id optional (standalone observation)', () => {
            const r = M.recordOpenRemainderObservation({
                userId: UID_OBS, resolvedEnv: ENV,
                observationId: 'or_standalone',
                phenomenonDescription: 'phenomenon X',
                attemptedCategories: [
                    { category: 'cat_a', matchScore: 0.90 }
                ],
                ts: _now()
            });
            expect(r.bestMatchScore).toBe(0.90);
            expect(r.flaggedCategory).toBe('captured');
        });
        test('decision_id provided when relevant', () => {
            const r = M.recordOpenRemainderObservation({
                userId: UID_OBS, resolvedEnv: ENV,
                observationId: 'or_with_dec',
                decisionId: 'd_42',
                phenomenonDescription: 'phenomenon X',
                attemptedCategories: [
                    { category: 'cat_a', matchScore: 0.65 }  // residual 0.35 → partially_captured
                ],
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.flaggedCategory).toBe('partially_captured');
        });
        test('empty attemptedCategories → residual 1.0 + forces_new_category', () => {
            const r = M.recordOpenRemainderObservation({
                userId: UID_OBS, resolvedEnv: ENV,
                observationId: 'or_empty',
                phenomenonDescription: 'completely novel phenomenon',
                attemptedCategories: [],
                ts: _now()
            });
            expect(r.bestMatchScore).toBe(0);
            expect(r.residualScore).toBe(1);
            expect(r.flaggedCategory).toBe('forces_new_category');
        });
        test('duplicate observationId throws', () => {
            M.recordOpenRemainderObservation({
                userId: UID_OBS, resolvedEnv: ENV,
                observationId: 'or_dup',
                phenomenonDescription: 'p',
                attemptedCategories: [{ category: 'a', matchScore: 0.5 }],
                ts: _now()
            });
            expect(() => M.recordOpenRemainderObservation({
                userId: UID_OBS, resolvedEnv: ENV,
                observationId: 'or_dup',
                phenomenonDescription: 'p2',
                attemptedCategories: [{ category: 'b', matchScore: 0.5 }],
                ts: _now()
            })).toThrow(/duplicate/);
        });
        test('out-of-range match score throws', () => {
            expect(() => M.recordOpenRemainderObservation({
                userId: UID_OBS, resolvedEnv: ENV,
                observationId: 'or_br',
                phenomenonDescription: 'p',
                attemptedCategories: [{ category: 'a', matchScore: 1.5 }],
                ts: _now()
            })).toThrow();
        });
    });

    describe('recordHumilityAssessment (integration)', () => {
        test('high residuals + few overclosures → high humility + continue', () => {
            const u = UID_ASS;
            // 12 observations, all with high residual (unexplained), 0 forced
            for (let i = 0; i < 12; i++) {
                M.recordOpenRemainderObservation({
                    userId: u, resolvedEnv: ENV,
                    observationId: `ha_h_${i}`,
                    phenomenonDescription: `phenomenon ${i}`,
                    attemptedCategories: [{ category: 'cat', matchScore: 0.10 }],
                    ts: 1000 + i
                });
            }
            const r = M.recordHumilityAssessment({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'a_high',
                windowStartTs: 500, windowEndTs: 2000,
                overclosureAttemptsCount: 0,
                ts: 3000
            });
            expect(r.recorded).toBe(true);
            expect(r.observationsCount).toBe(12);
            expect(r.humilityLevel).toBe('high');
            expect(r.aggressionPenalty).toBe(0);
        });
        test('overclosure dominant → low humility + expand_ontology', () => {
            const u = UID_ASS;
            for (let i = 0; i < 15; i++) {
                M.recordOpenRemainderObservation({
                    userId: u, resolvedEnv: ENV,
                    observationId: `ha_l_${i}`,
                    phenomenonDescription: 'p',
                    attemptedCategories: [{ category: 'cat', matchScore: 0.15 }],
                    ts: 1000 + i
                });
            }
            const r = M.recordHumilityAssessment({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'a_low',
                windowStartTs: 500, windowEndTs: 2000,
                overclosureAttemptsCount: 12,  // 80% forced
                ts: 3000
            });
            expect(r.humilityLevel).toBe('low');
            expect(r.aggressionPenalty).toBe(0.50);
            expect(r.recommendedAction).toBe('expand_ontology');
        });
        test('insufficient observations throws', () => {
            const u = UID_ASS;
            for (let i = 0; i < 5; i++) {  // only 5, need ≥ 10
                M.recordOpenRemainderObservation({
                    userId: u, resolvedEnv: ENV,
                    observationId: `ha_few_${i}`,
                    phenomenonDescription: 'p',
                    attemptedCategories: [{ category: 'cat', matchScore: 0.5 }],
                    ts: 1000 + i
                });
            }
            expect(() => M.recordHumilityAssessment({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'a_few',
                windowStartTs: 500, windowEndTs: 2000,
                overclosureAttemptsCount: 0,
                ts: 3000
            })).toThrow(/insufficient|MIN_OBSERVATIONS/i);
        });
        test('duplicate assessmentId throws', () => {
            const u = UID_ASS;
            for (let i = 0; i < 10; i++) {
                M.recordOpenRemainderObservation({
                    userId: u, resolvedEnv: ENV,
                    observationId: `ha_dup_${i}`,
                    phenomenonDescription: 'p',
                    attemptedCategories: [{ category: 'cat', matchScore: 0.5 }],
                    ts: 1000 + i
                });
            }
            M.recordHumilityAssessment({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'a_dup',
                windowStartTs: 500, windowEndTs: 2000,
                overclosureAttemptsCount: 0,
                ts: 3000
            });
            expect(() => M.recordHumilityAssessment({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'a_dup',
                windowStartTs: 500, windowEndTs: 2000,
                overclosureAttemptsCount: 0,
                ts: 4000
            })).toThrow(/duplicate/);
        });
        test('window with no observations throws (insufficient)', () => {
            expect(() => M.recordHumilityAssessment({
                userId: UID_ASS, resolvedEnv: ENV,
                assessmentId: 'a_empty',
                windowStartTs: 99999000, windowEndTs: 99999999,
                overclosureAttemptsCount: 0,
                ts: _now()
            })).toThrow(/insufficient/);
        });
    });

    describe('getRecentObservations', () => {
        test('returns recent observations filtered by sinceTs', () => {
            const u = UID_GET;
            M.recordOpenRemainderObservation({
                userId: u, resolvedEnv: ENV,
                observationId: 'g_old', phenomenonDescription: 'p',
                attemptedCategories: [{ category: 'a', matchScore: 0.5 }],
                ts: 100
            });
            M.recordOpenRemainderObservation({
                userId: u, resolvedEnv: ENV,
                observationId: 'g_new', phenomenonDescription: 'p',
                attemptedCategories: [{ category: 'a', matchScore: 0.5 }],
                ts: 2000
            });
            const r = M.getRecentObservations({
                userId: u, resolvedEnv: ENV,
                sinceTs: 1000, limit: 10
            });
            expect(r.length).toBe(1);
            expect(r[0].observationId).toBe('g_new');
        });
    });

    describe('getLatestAssessment', () => {
        test('returns most recent or null', () => {
            const u = UID_GET;
            for (let i = 0; i < 10; i++) {
                M.recordOpenRemainderObservation({
                    userId: u, resolvedEnv: ENV,
                    observationId: `gl_o_${i}`, phenomenonDescription: 'p',
                    attemptedCategories: [{ category: 'a', matchScore: 0.5 }],
                    ts: 1000 + i
                });
            }
            M.recordHumilityAssessment({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'gl_a1',
                windowStartTs: 500, windowEndTs: 2000,
                overclosureAttemptsCount: 0, ts: 3000
            });
            M.recordHumilityAssessment({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'gl_a2',
                windowStartTs: 500, windowEndTs: 2000,
                overclosureAttemptsCount: 2, ts: 4000
            });
            const r = M.getLatestAssessment({
                userId: u, resolvedEnv: ENV
            });
            expect(r.assessmentId).toBe('gl_a2');
        });
        test('returns null when no assessments', () => {
            expect(M.getLatestAssessment({
                userId: UID_GET, resolvedEnv: 'REAL'
            })).toBeNull();
        });
    });

    describe('isolation per user × env', () => {
        test('uid isolation', () => {
            M.recordOpenRemainderObservation({
                userId: UID_ISO_A, resolvedEnv: ENV,
                observationId: 'iso_a', phenomenonDescription: 'p',
                attemptedCategories: [{ category: 'a', matchScore: 0.5 }],
                ts: 1000
            });
            M.recordOpenRemainderObservation({
                userId: UID_ISO_B, resolvedEnv: ENV,
                observationId: 'iso_b', phenomenonDescription: 'p',
                attemptedCategories: [{ category: 'a', matchScore: 0.5 }],
                ts: 1000
            });
            const a = M.getRecentObservations({
                userId: UID_ISO_A, resolvedEnv: ENV,
                sinceTs: 0, limit: 10
            });
            expect(a.every(o => o.observationId !== 'iso_b')).toBe(true);
        });
        test('env isolation', () => {
            M.recordOpenRemainderObservation({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                observationId: 'env_d', phenomenonDescription: 'p',
                attemptedCategories: [{ category: 'a', matchScore: 0.5 }],
                ts: 1000
            });
            const testnet = M.getRecentObservations({
                userId: UID_ENV, resolvedEnv: 'TESTNET',
                sinceTs: 0, limit: 10
            });
            expect(testnet).toEqual([]);
        });
    });
});
