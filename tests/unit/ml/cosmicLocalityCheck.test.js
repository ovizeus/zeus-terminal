'use strict';

/**
 * OMEGA §181 COSMIC LOCALITY CHECK / DO-NOT-UNIVERSALIZE-THE-PARISH.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt lines 5929-5976.
 *
 * "descoperirea mea este un adevar mare sau doar un adevar de cartier?"
 *
 * Tests FIRST per TDD discipline.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p181-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/R2_cognition/cosmicLocalityCheck');

const UID = 9181;
const UID_R = 9281;
const UID_GET = 9381;
const UID_ISO_A = 9481;
const UID_ISO_B = 9581;
const UID_ENV = 9681;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    const uids = [UID, UID_R, UID_GET, UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_locality_assessments WHERE user_id IN (${placeholders})`).run(...uids);
}
beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §181 COSMIC LOCALITY CHECK', () => {

    describe('Migration 333', () => {
        test('333 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('333_ml_locality_assessments')).toBeTruthy();
        });
        test('declared_scope CHECK enum (7)', () => {
            expect(() => db.prepare(`INSERT INTO ml_locality_assessments
                (user_id, resolved_env, assessment_id, thesis_label, declared_scope,
                 tested_contexts_count, supporting_contexts_count,
                 portability_score, claimed_generality, evidenced_generality,
                 universalization_penalty, recommended_scope, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'a_bk', 'th', 'BOGUS', 5, 4, 0.8, 0.5, 0.5,
                    0, 'local', null, _now())).toThrow();
        });
        test('supporting <= tested CHECK', () => {
            expect(() => db.prepare(`INSERT INTO ml_locality_assessments
                (user_id, resolved_env, assessment_id, thesis_label, declared_scope,
                 tested_contexts_count, supporting_contexts_count,
                 portability_score, claimed_generality, evidenced_generality,
                 universalization_penalty, recommended_scope, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'a_over', 'th', 'local', 5, 8, 1.6, 0.5, 0.5,
                    0, 'local', null, _now())).toThrow();
        });
        test('assessment_id UNIQUE', () => {
            const stmt = db.prepare(`INSERT INTO ml_locality_assessments
                (user_id, resolved_env, assessment_id, thesis_label, declared_scope,
                 tested_contexts_count, supporting_contexts_count,
                 portability_score, claimed_generality, evidenced_generality,
                 universalization_penalty, recommended_scope, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            stmt.run(UID, ENV, 'a_dup', 'th', 'local', 5, 4, 0.8, 0.3, 0.4,
                0, 'local', null, _now());
            expect(() => stmt.run(UID, ENV, 'a_dup', 'th2', 'regime_bound',
                5, 4, 0.8, 0.3, 0.4, 0, 'local', null, _now())).toThrow();
        });
    });

    describe('Constants', () => {
        test('SCOPE_TAGS frozen 7 (canonical PDF list)', () => {
            expect(M.SCOPE_TAGS).toEqual([
                'local', 'regime_bound', 'asset_bound',
                'venue_bound', 'session_bound',
                'likely_general', 'unknown_scope'
            ]);
            expect(Object.isFrozen(M.SCOPE_TAGS)).toBe(true);
        });
        test('SCOPE_BREADTH_MAP — local narrow, likely_general broad', () => {
            expect(M.SCOPE_BREADTH_MAP.local).toBeLessThan(M.SCOPE_BREADTH_MAP.likely_general);
        });
        test('MIN_TESTED_FOR_GENERAL = 10', () => {
            expect(M.MIN_TESTED_FOR_GENERAL).toBe(10);
        });
        test('PORTABILITY_THRESHOLD_GENERAL = 0.80', () => {
            expect(M.PORTABILITY_THRESHOLD_GENERAL).toBe(0.80);
        });
        test('UNIVERSALIZATION_PENALTY_THRESHOLD = 0.30', () => {
            expect(M.UNIVERSALIZATION_PENALTY_THRESHOLD).toBe(0.30);
        });
    });

    describe('computePortabilityScore (pure)', () => {
        test('all contexts support → 1.0', () => {
            const r = M.computePortabilityScore({
                supportingContextsCount: 8, testedContextsCount: 8
            });
            expect(r.portabilityScore).toBe(1.0);
        });
        test('half support → 0.5', () => {
            const r = M.computePortabilityScore({
                supportingContextsCount: 4, testedContextsCount: 8
            });
            expect(r.portabilityScore).toBe(0.5);
        });
        test('zero tested → 0 (no evidence)', () => {
            const r = M.computePortabilityScore({
                supportingContextsCount: 0, testedContextsCount: 0
            });
            expect(r.portabilityScore).toBe(0);
        });
        test('supporting > tested throws', () => {
            expect(() => M.computePortabilityScore({
                supportingContextsCount: 10, testedContextsCount: 5
            })).toThrow(/exceed/i);
        });
        test('negative counts throw', () => {
            expect(() => M.computePortabilityScore({
                supportingContextsCount: -1, testedContextsCount: 5
            })).toThrow();
        });
    });

    describe('computeEvidencedGenerality (pure)', () => {
        test('high portability + many contexts → high generality', () => {
            const r = M.computeEvidencedGenerality({
                portabilityScore: 0.90, testedContextsCount: 15
            });
            expect(r.evidencedGenerality).toBeGreaterThan(0.70);
        });
        test('high portability + few contexts → low generality (insufficient)', () => {
            const r = M.computeEvidencedGenerality({
                portabilityScore: 1.0, testedContextsCount: 2
            });
            expect(r.evidencedGenerality).toBeLessThan(0.50);
        });
        test('low portability → low generality regardless of count', () => {
            const r = M.computeEvidencedGenerality({
                portabilityScore: 0.30, testedContextsCount: 30
            });
            expect(r.evidencedGenerality).toBeLessThan(0.40);
        });
        test('out-of-range throws', () => {
            expect(() => M.computeEvidencedGenerality({
                portabilityScore: 1.5, testedContextsCount: 5
            })).toThrow();
        });
    });

    describe('computeUniversalizationPenalty (pure)', () => {
        test('claimed = evidenced → 0 penalty', () => {
            const r = M.computeUniversalizationPenalty({
                claimedGenerality: 0.70, evidencedGenerality: 0.70
            });
            expect(r.universalizationPenalty).toBe(0);
        });
        test('claimed > evidenced (overclaim) → penalty', () => {
            const r = M.computeUniversalizationPenalty({
                claimedGenerality: 0.90, evidencedGenerality: 0.30
            });
            expect(r.universalizationPenalty).toBeCloseTo(0.60, 5);
        });
        test('claimed < evidenced (modest) → 0 penalty (no over-universalization)', () => {
            const r = M.computeUniversalizationPenalty({
                claimedGenerality: 0.30, evidencedGenerality: 0.85
            });
            expect(r.universalizationPenalty).toBe(0);
        });
        test('out-of-range throws', () => {
            expect(() => M.computeUniversalizationPenalty({
                claimedGenerality: 1.5, evidencedGenerality: 0.5
            })).toThrow();
        });
    });

    describe('classifyRecommendedScope (pure)', () => {
        test('high portability + many contexts → likely_general', () => {
            const r = M.classifyRecommendedScope({
                portabilityScore: 0.90,
                testedContextsCount: 15,
                declaredScope: 'likely_general'
            });
            expect(r.recommendedScope).toBe('likely_general');
        });
        test('moderate portability + few contexts → declared scope preserved (regime_bound)', () => {
            const r = M.classifyRecommendedScope({
                portabilityScore: 0.60,
                testedContextsCount: 5,
                declaredScope: 'regime_bound'
            });
            expect(['regime_bound', 'local']).toContain(r.recommendedScope);
        });
        test('zero tested → unknown_scope', () => {
            const r = M.classifyRecommendedScope({
                portabilityScore: 0,
                testedContextsCount: 0,
                declaredScope: 'likely_general'
            });
            expect(r.recommendedScope).toBe('unknown_scope');
        });
        test('low portability → narrower than declared', () => {
            // declared likely_general but portability 0.20 → must narrow
            const r = M.classifyRecommendedScope({
                portabilityScore: 0.20,
                testedContextsCount: 15,
                declaredScope: 'likely_general'
            });
            // Should narrow significantly from likely_general
            expect(r.recommendedScope).not.toBe('likely_general');
        });
        test('invalid declared_scope throws', () => {
            expect(() => M.classifyRecommendedScope({
                portabilityScore: 0.5, testedContextsCount: 5,
                declaredScope: 'BOGUS'
            })).toThrow();
        });
    });

    describe('recordLocalityAssessment', () => {
        test('persists with auto-pipeline', () => {
            const r = M.recordLocalityAssessment({
                userId: UID_R, resolvedEnv: ENV,
                assessmentId: 'rl_1',
                thesisLabel: 'OBI flip predicts retest fail',
                declaredScope: 'regime_bound',
                testedContextsCount: 8,
                supportingContextsCount: 6,
                claimedGenerality: 0.40,
                reasoning: 'tested on trend regimes only',
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.portabilityScore).toBeCloseTo(0.75, 5);
            // claimed 0.40 with evidenced moderate → minimal penalty
            expect(r.universalizationPenalty).toBeGreaterThanOrEqual(0);
        });
        test('overclaim detected with penalty', () => {
            const r = M.recordLocalityAssessment({
                userId: UID_R, resolvedEnv: ENV,
                assessmentId: 'rl_overclaim',
                thesisLabel: 'liquidation cascades always lead to V-recovery',
                declaredScope: 'likely_general',
                testedContextsCount: 3,        // very few
                supportingContextsCount: 2,
                claimedGenerality: 0.95,       // big claim
                ts: _now()
            });
            expect(r.universalizationPenalty).toBeGreaterThan(0.30);
            expect(r.recommendedScope).not.toBe('likely_general');
        });
        test('zero tested → unknown_scope recommendation', () => {
            const r = M.recordLocalityAssessment({
                userId: UID_R, resolvedEnv: ENV,
                assessmentId: 'rl_zero',
                thesisLabel: 'untested hypothesis',
                declaredScope: 'unknown_scope',
                testedContextsCount: 0,
                supportingContextsCount: 0,
                claimedGenerality: 0,
                ts: _now()
            });
            expect(r.recommendedScope).toBe('unknown_scope');
        });
        test('duplicate assessmentId throws', () => {
            M.recordLocalityAssessment({
                userId: UID_R, resolvedEnv: ENV,
                assessmentId: 'rl_dup', thesisLabel: 'th',
                declaredScope: 'local',
                testedContextsCount: 5, supportingContextsCount: 4,
                claimedGenerality: 0.3, ts: _now()
            });
            expect(() => M.recordLocalityAssessment({
                userId: UID_R, resolvedEnv: ENV,
                assessmentId: 'rl_dup', thesisLabel: 'th',
                declaredScope: 'local',
                testedContextsCount: 5, supportingContextsCount: 4,
                claimedGenerality: 0.3, ts: _now()
            })).toThrow(/duplicate/);
        });
        test('invalid declared_scope throws', () => {
            expect(() => M.recordLocalityAssessment({
                userId: UID_R, resolvedEnv: ENV,
                assessmentId: 'rl_bad', thesisLabel: 'th',
                declaredScope: 'BOGUS',
                testedContextsCount: 5, supportingContextsCount: 4,
                claimedGenerality: 0.3, ts: _now()
            })).toThrow();
        });
    });

    describe('getRecentAssessments & getStatsByScope', () => {
        test('getRecentAssessments filters by recommended_scope', () => {
            M.recordLocalityAssessment({
                userId: UID_GET, resolvedEnv: ENV,
                assessmentId: 'g_lg', thesisLabel: 'th',
                declaredScope: 'likely_general',
                testedContextsCount: 15, supportingContextsCount: 14,
                claimedGenerality: 0.85, ts: _now()
            });
            M.recordLocalityAssessment({
                userId: UID_GET, resolvedEnv: ENV,
                assessmentId: 'g_lo', thesisLabel: 'th',
                declaredScope: 'local',
                testedContextsCount: 3, supportingContextsCount: 3,
                claimedGenerality: 0.20, ts: _now()
            });
            const generals = M.getRecentAssessments({
                userId: UID_GET, resolvedEnv: ENV,
                recommendedScope: 'likely_general'
            });
            expect(generals.length).toBe(1);
        });
        test('getStatsByScope returns counts', () => {
            M.recordLocalityAssessment({
                userId: UID_GET, resolvedEnv: ENV,
                assessmentId: 'gs_1', thesisLabel: 'th',
                declaredScope: 'local',
                testedContextsCount: 5, supportingContextsCount: 5,
                claimedGenerality: 0.20, ts: 1000
            });
            M.recordLocalityAssessment({
                userId: UID_GET, resolvedEnv: ENV,
                assessmentId: 'gs_2', thesisLabel: 'th',
                declaredScope: 'regime_bound',
                testedContextsCount: 5, supportingContextsCount: 4,
                claimedGenerality: 0.40, ts: 2000
            });
            const stats = M.getStatsByScope({
                userId: UID_GET, resolvedEnv: ENV,
                sinceTs: 0
            });
            expect(stats.totalCount).toBe(2);
        });
    });

    describe('isolation per user × env', () => {
        test('uid isolation', () => {
            M.recordLocalityAssessment({
                userId: UID_ISO_A, resolvedEnv: ENV,
                assessmentId: 'iso_a', thesisLabel: 'th',
                declaredScope: 'local',
                testedContextsCount: 5, supportingContextsCount: 5,
                claimedGenerality: 0.20, ts: _now()
            });
            M.recordLocalityAssessment({
                userId: UID_ISO_B, resolvedEnv: ENV,
                assessmentId: 'iso_b', thesisLabel: 'th',
                declaredScope: 'local',
                testedContextsCount: 5, supportingContextsCount: 5,
                claimedGenerality: 0.20, ts: _now()
            });
            const a = M.getRecentAssessments({
                userId: UID_ISO_A, resolvedEnv: ENV
            });
            expect(a.every(r => r.assessmentId !== 'iso_b')).toBe(true);
        });
        test('env isolation', () => {
            M.recordLocalityAssessment({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                assessmentId: 'env_d', thesisLabel: 'th',
                declaredScope: 'local',
                testedContextsCount: 5, supportingContextsCount: 5,
                claimedGenerality: 0.20, ts: _now()
            });
            const testnet = M.getRecentAssessments({
                userId: UID_ENV, resolvedEnv: 'TESTNET'
            });
            expect(testnet).toEqual([]);
        });
    });
});
