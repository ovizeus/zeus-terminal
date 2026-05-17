'use strict';

/**
 * OMEGA §154 OUTCOME-BLIND POLICY JUDGE / VEIL-OF-RESULT GOVERNANCE.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt lines 5132-5178.
 *
 * "a fost asta o decizie buna chiar daca n-as sti deloc cum s-a terminat?"
 *
 * Tests FIRST per TDD discipline.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p154-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/_audit/outcomeBlindPolicyJudge');

const UID = 9154;
const UID_J = 9254;
const UID_C = 9354;
const UID_GET = 9454;
const UID_ISO_A = 9554;
const UID_ISO_B = 9654;
const UID_ENV = 9754;
const ENV = 'DEMO';
const _now = () => Date.now();
const AXES = {
    infoQuality: 0.7, thesisIntegrity: 0.7,
    riskAppropriateness: 0.7, executionAppropriateness: 0.7,
    reversibility: 0.7, opportunityRanking: 0.7
};

function cleanRows() {
    const uids = [UID, UID_J, UID_C, UID_GET, UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_decision_outcome_comparisons WHERE user_id IN (${placeholders})`).run(...uids);
    db.prepare(`DELETE FROM ml_blind_decision_judgments WHERE user_id IN (${placeholders})`).run(...uids);
}
beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §154 OUTCOME-BLIND POLICY JUDGE', () => {

    describe('Migrations 306+307', () => {
        test('306 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('306_ml_blind_decision_judgments')).toBeTruthy();
        });
        test('307 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('307_ml_decision_outcome_comparisons')).toBeTruthy();
        });
        test('classification CHECK enum', () => {
            expect(() => db.prepare(`INSERT INTO ml_blind_decision_judgments
                (user_id, resolved_env, judgment_id, decision_id,
                 info_quality_score, thesis_integrity_score,
                 risk_appropriateness_score, execution_appropriateness_score,
                 reversibility_score, opportunity_ranking_score,
                 composite_decision_quality, classification,
                 locked_pre_outcome, judge_reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'j_bk', 'd1', 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
                    0.5, 'BOGUS', 1, null, _now())).toThrow();
        });
        test('interpretation CHECK enum on comparisons', () => {
            db.prepare(`INSERT INTO ml_blind_decision_judgments
                (user_id, resolved_env, judgment_id, decision_id,
                 info_quality_score, thesis_integrity_score,
                 risk_appropriateness_score, execution_appropriateness_score,
                 reversibility_score, opportunity_ranking_score,
                 composite_decision_quality, classification,
                 locked_pre_outcome, judge_reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'j_for_ck1', 'd1', 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
                    0.5, 'marginal', 1, null, _now());
            expect(() => db.prepare(`INSERT INTO ml_decision_outcome_comparisons
                (user_id, resolved_env, comparison_id, judgment_id,
                 outcome_quality_score, outcome_label,
                 decision_quality_at_judgment, gap_score,
                 interpretation, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'c_bk', 'j_for_ck1', 0.5, 'win',
                    0.5, 0, 'BOGUS', _now())).toThrow();
        });
        test('judgment_id UNIQUE', () => {
            const stmt = db.prepare(`INSERT INTO ml_blind_decision_judgments
                (user_id, resolved_env, judgment_id, decision_id,
                 info_quality_score, thesis_integrity_score,
                 risk_appropriateness_score, execution_appropriateness_score,
                 reversibility_score, opportunity_ranking_score,
                 composite_decision_quality, classification,
                 locked_pre_outcome, judge_reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            stmt.run(UID, ENV, 'j_dup', 'd1', 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
                0.5, 'marginal', 1, null, _now());
            expect(() => stmt.run(UID, ENV, 'j_dup', 'd2', 0.6, 0.6, 0.6, 0.6,
                0.6, 0.6, 0.6, 'sound', 1, null, _now())).toThrow();
        });
        test('FK ON DELETE RESTRICT on judgment_id', () => {
            db.prepare(`INSERT INTO ml_blind_decision_judgments
                (user_id, resolved_env, judgment_id, decision_id,
                 info_quality_score, thesis_integrity_score,
                 risk_appropriateness_score, execution_appropriateness_score,
                 reversibility_score, opportunity_ranking_score,
                 composite_decision_quality, classification,
                 locked_pre_outcome, judge_reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'j_fk', 'd1', 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
                    0.5, 'marginal', 1, null, _now());
            db.prepare(`INSERT INTO ml_decision_outcome_comparisons
                (user_id, resolved_env, comparison_id, judgment_id,
                 outcome_quality_score, outcome_label,
                 decision_quality_at_judgment, gap_score,
                 interpretation, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'c_fk', 'j_fk', 0.5, 'win',
                    0.5, 0, 'aligned', _now());
            expect(() => db.prepare(`DELETE FROM ml_blind_decision_judgments WHERE judgment_id=?`).run('j_fk')).toThrow();
            db.prepare(`DELETE FROM ml_decision_outcome_comparisons WHERE comparison_id=?`).run('c_fk');
            db.prepare(`DELETE FROM ml_blind_decision_judgments WHERE judgment_id=?`).run('j_fk');
        });
    });

    describe('Constants', () => {
        test('DECISION_AXES frozen 6 (canonical PDF list)', () => {
            expect(M.DECISION_AXES).toEqual([
                'infoQuality', 'thesisIntegrity',
                'riskAppropriateness', 'executionAppropriateness',
                'reversibility', 'opportunityRanking'
            ]);
            expect(Object.isFrozen(M.DECISION_AXES)).toBe(true);
        });
        test('DECISION_CLASSIFICATIONS frozen 4', () => {
            expect(M.DECISION_CLASSIFICATIONS).toEqual([
                'excellent', 'sound', 'marginal', 'poor'
            ]);
            expect(Object.isFrozen(M.DECISION_CLASSIFICATIONS)).toBe(true);
        });
        test('OUTCOME_LABELS frozen 4', () => {
            expect(M.OUTCOME_LABELS).toEqual([
                'win', 'loss', 'breakeven', 'cancelled'
            ]);
            expect(Object.isFrozen(M.OUTCOME_LABELS)).toBe(true);
        });
        test('INTERPRETATIONS frozen 5', () => {
            expect(M.INTERPRETATIONS).toEqual([
                'lucky_good', 'skilled_good', 'unlucky_bad',
                'deserved_bad', 'aligned'
            ]);
            expect(Object.isFrozen(M.INTERPRETATIONS)).toBe(true);
        });
        test('DECISION_THRESHOLDS ordered', () => {
            expect(M.DECISION_THRESHOLDS.excellent).toBe(0.80);
            expect(M.DECISION_THRESHOLDS.sound).toBe(0.60);
            expect(M.DECISION_THRESHOLDS.marginal).toBe(0.40);
        });
        test('ALIGNED_GAP_MAX = 0.20', () => {
            expect(M.ALIGNED_GAP_MAX).toBe(0.20);
        });
    });

    describe('computeDecisionQuality (pure)', () => {
        test('all axes 1.0 → composite 1.0', () => {
            const r = M.computeDecisionQuality({
                axes: {
                    infoQuality: 1, thesisIntegrity: 1,
                    riskAppropriateness: 1, executionAppropriateness: 1,
                    reversibility: 1, opportunityRanking: 1
                }
            });
            expect(r.composite).toBeCloseTo(1, 6);
        });
        test('all axes 0 → composite 0', () => {
            const r = M.computeDecisionQuality({
                axes: {
                    infoQuality: 0, thesisIntegrity: 0,
                    riskAppropriateness: 0, executionAppropriateness: 0,
                    reversibility: 0, opportunityRanking: 0
                }
            });
            expect(r.composite).toBe(0);
        });
        test('equal weights → simple mean', () => {
            const r = M.computeDecisionQuality({
                axes: {
                    infoQuality: 0.6, thesisIntegrity: 0.6,
                    riskAppropriateness: 0.6, executionAppropriateness: 0.6,
                    reversibility: 0.6, opportunityRanking: 0.6
                }
            });
            expect(r.composite).toBeCloseTo(0.6, 6);
        });
        test('missing axis throws', () => {
            expect(() => M.computeDecisionQuality({
                axes: { infoQuality: 0.5 }
            })).toThrow();
        });
        test('out-of-range axis throws', () => {
            expect(() => M.computeDecisionQuality({
                axes: {
                    infoQuality: 1.5, thesisIntegrity: 0.5,
                    riskAppropriateness: 0.5, executionAppropriateness: 0.5,
                    reversibility: 0.5, opportunityRanking: 0.5
                }
            })).toThrow();
        });
    });

    describe('classifyDecision (pure)', () => {
        test('composite ≥ 0.80 → excellent', () => {
            expect(M.classifyDecision({ compositeScore: 0.90 }).classification).toBe('excellent');
        });
        test('0.60 ≤ composite < 0.80 → sound', () => {
            expect(M.classifyDecision({ compositeScore: 0.70 }).classification).toBe('sound');
        });
        test('0.40 ≤ composite < 0.60 → marginal', () => {
            expect(M.classifyDecision({ compositeScore: 0.50 }).classification).toBe('marginal');
        });
        test('composite < 0.40 → poor', () => {
            expect(M.classifyDecision({ compositeScore: 0.25 }).classification).toBe('poor');
        });
        test('boundary 0.80 → excellent', () => {
            expect(M.classifyDecision({ compositeScore: 0.80 }).classification).toBe('excellent');
        });
        test('boundary 0.40 → marginal', () => {
            expect(M.classifyDecision({ compositeScore: 0.40 }).classification).toBe('marginal');
        });
    });

    describe('computeOutcomeGap (pure)', () => {
        test('equal scores → gap 0', () => {
            const r = M.computeOutcomeGap({
                decisionQuality: 0.70, outcomeQuality: 0.70
            });
            expect(r.gap).toBe(0);
        });
        test('absolute difference', () => {
            const r = M.computeOutcomeGap({
                decisionQuality: 0.30, outcomeQuality: 0.80
            });
            expect(r.gap).toBeCloseTo(0.50, 5);
        });
        test('symmetric', () => {
            const a = M.computeOutcomeGap({
                decisionQuality: 0.30, outcomeQuality: 0.80
            });
            const b = M.computeOutcomeGap({
                decisionQuality: 0.80, outcomeQuality: 0.30
            });
            expect(a.gap).toBe(b.gap);
        });
        test('out-of-range throws', () => {
            expect(() => M.computeOutcomeGap({
                decisionQuality: 1.5, outcomeQuality: 0.5
            })).toThrow();
        });
    });

    describe('interpretComparison (pure)', () => {
        test('high decision + good outcome (close) → aligned', () => {
            const r = M.interpretComparison({
                decisionQuality: 0.85, outcomeQuality: 0.90
            });
            expect(r.interpretation).toBe('aligned');
        });
        test('high decision + bad outcome → unlucky_bad', () => {
            const r = M.interpretComparison({
                decisionQuality: 0.85, outcomeQuality: 0.20
            });
            expect(r.interpretation).toBe('unlucky_bad');
        });
        test('low decision + good outcome → lucky_good', () => {
            const r = M.interpretComparison({
                decisionQuality: 0.20, outcomeQuality: 0.85
            });
            expect(r.interpretation).toBe('lucky_good');
        });
        test('low decision + bad outcome (close) → aligned', () => {
            const r = M.interpretComparison({
                decisionQuality: 0.25, outcomeQuality: 0.30
            });
            expect(r.interpretation).toBe('aligned');
        });
        test('high decision + high outcome but outside gap → skilled_good', () => {
            // decision 0.65 (above GOOD threshold 0.60), outcome 0.95, gap 0.30
            const r = M.interpretComparison({
                decisionQuality: 0.65, outcomeQuality: 0.95
            });
            expect(r.interpretation).toBe('skilled_good');
        });
        test('high decision + bad outcome (outside gap) → unlucky_bad', () => {
            // decision 0.65 (good), outcome 0.30, gap 0.35
            const r = M.interpretComparison({
                decisionQuality: 0.65, outcomeQuality: 0.30
            });
            expect(r.interpretation).toBe('unlucky_bad');
        });
        test('low decision + low outcome but outside gap → deserved_bad', () => {
            // decision 0.55 (below GOOD), outcome 0.20, gap 0.35
            const r = M.interpretComparison({
                decisionQuality: 0.55, outcomeQuality: 0.20
            });
            expect(r.interpretation).toBe('deserved_bad');
        });
        test('gap exactly at ALIGNED_GAP_MAX boundary → aligned', () => {
            const r = M.interpretComparison({
                decisionQuality: 0.50, outcomeQuality: 0.70
            });
            expect(r.interpretation).toBe('aligned');
        });
    });

    describe('recordBlindJudgment', () => {
        test('persists with auto-computed composite + classification + locked_pre_outcome=1 default', () => {
            const r = M.recordBlindJudgment({
                userId: UID_J, resolvedEnv: ENV,
                judgmentId: 'rj_1', decisionId: 'd_btc_long_72k',
                axes: AXES,
                judgeReasoning: 'thesis confluent, risk capped, reversible',
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.compositeScore).toBeCloseTo(0.7, 6);
            expect(r.classification).toBe('sound');
            expect(r.lockedPreOutcome).toBe(1);
        });
        test('lockedPreOutcome=false records as audit-only', () => {
            const r = M.recordBlindJudgment({
                userId: UID_J, resolvedEnv: ENV,
                judgmentId: 'rj_late', decisionId: 'd1',
                axes: AXES,
                lockedPreOutcome: false,
                judgeReasoning: 'retrospective audit',
                ts: _now()
            });
            expect(r.lockedPreOutcome).toBe(0);
        });
        test('excellent classification', () => {
            const r = M.recordBlindJudgment({
                userId: UID_J, resolvedEnv: ENV,
                judgmentId: 'rj_exc', decisionId: 'd2',
                axes: {
                    infoQuality: 0.90, thesisIntegrity: 0.90,
                    riskAppropriateness: 0.85, executionAppropriateness: 0.85,
                    reversibility: 0.85, opportunityRanking: 0.85
                },
                ts: _now()
            });
            expect(r.classification).toBe('excellent');
        });
        test('poor classification', () => {
            const r = M.recordBlindJudgment({
                userId: UID_J, resolvedEnv: ENV,
                judgmentId: 'rj_poor', decisionId: 'd3',
                axes: {
                    infoQuality: 0.25, thesisIntegrity: 0.30,
                    riskAppropriateness: 0.20, executionAppropriateness: 0.20,
                    reversibility: 0.25, opportunityRanking: 0.30
                },
                ts: _now()
            });
            expect(r.classification).toBe('poor');
        });
        test('duplicate judgmentId throws', () => {
            M.recordBlindJudgment({
                userId: UID_J, resolvedEnv: ENV,
                judgmentId: 'rj_dup', decisionId: 'd', axes: AXES, ts: _now()
            });
            expect(() => M.recordBlindJudgment({
                userId: UID_J, resolvedEnv: ENV,
                judgmentId: 'rj_dup', decisionId: 'd', axes: AXES, ts: _now()
            })).toThrow(/duplicate/);
        });
        test('missing axis throws', () => {
            expect(() => M.recordBlindJudgment({
                userId: UID_J, resolvedEnv: ENV,
                judgmentId: 'rj_miss', decisionId: 'd',
                axes: { infoQuality: 0.5 },
                ts: _now()
            })).toThrow();
        });
    });

    describe('recordOutcomeComparison (integration)', () => {
        function _seedJudgment(uid, jid, axes = AXES) {
            return M.recordBlindJudgment({
                userId: uid, resolvedEnv: ENV,
                judgmentId: jid, decisionId: `d_for_${jid}`,
                axes, ts: _now()
            });
        }
        test('persists with auto-computed gap + interpretation', () => {
            _seedJudgment(UID_C, 'oc_j1');  // composite 0.70 sound
            const r = M.recordOutcomeComparison({
                userId: UID_C, resolvedEnv: ENV,
                comparisonId: 'oc_c1',
                judgmentId: 'oc_j1',
                outcomeQualityScore: 0.75,
                outcomeLabel: 'win',
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.gapScore).toBeCloseTo(0.05, 5);
            expect(r.interpretation).toBe('aligned');
        });
        test('high decision + loss → unlucky_bad', () => {
            _seedJudgment(UID_C, 'oc_j2', {
                infoQuality: 0.85, thesisIntegrity: 0.85,
                riskAppropriateness: 0.85, executionAppropriateness: 0.85,
                reversibility: 0.85, opportunityRanking: 0.85
            });
            const r = M.recordOutcomeComparison({
                userId: UID_C, resolvedEnv: ENV,
                comparisonId: 'oc_c2',
                judgmentId: 'oc_j2',
                outcomeQualityScore: 0.15,
                outcomeLabel: 'loss',
                ts: _now()
            });
            expect(r.interpretation).toBe('unlucky_bad');
        });
        test('low decision + win → lucky_good', () => {
            _seedJudgment(UID_C, 'oc_j3', {
                infoQuality: 0.20, thesisIntegrity: 0.25,
                riskAppropriateness: 0.20, executionAppropriateness: 0.20,
                reversibility: 0.25, opportunityRanking: 0.20
            });
            const r = M.recordOutcomeComparison({
                userId: UID_C, resolvedEnv: ENV,
                comparisonId: 'oc_c3',
                judgmentId: 'oc_j3',
                outcomeQualityScore: 0.85,
                outcomeLabel: 'win',
                ts: _now()
            });
            expect(r.interpretation).toBe('lucky_good');
        });
        test('comparison on nonexistent judgment throws (FK)', () => {
            expect(() => M.recordOutcomeComparison({
                userId: UID_C, resolvedEnv: ENV,
                comparisonId: 'oc_orph',
                judgmentId: 'oc_nonexistent',
                outcomeQualityScore: 0.5,
                outcomeLabel: 'win',
                ts: _now()
            })).toThrow();
        });
        test('duplicate comparisonId throws', () => {
            _seedJudgment(UID_C, 'oc_jdup');
            M.recordOutcomeComparison({
                userId: UID_C, resolvedEnv: ENV,
                comparisonId: 'oc_cdup',
                judgmentId: 'oc_jdup',
                outcomeQualityScore: 0.5,
                outcomeLabel: 'win',
                ts: _now()
            });
            expect(() => M.recordOutcomeComparison({
                userId: UID_C, resolvedEnv: ENV,
                comparisonId: 'oc_cdup',
                judgmentId: 'oc_jdup',
                outcomeQualityScore: 0.5,
                outcomeLabel: 'win',
                ts: _now()
            })).toThrow(/duplicate/);
        });
        test('invalid outcomeLabel throws', () => {
            _seedJudgment(UID_C, 'oc_jbad');
            expect(() => M.recordOutcomeComparison({
                userId: UID_C, resolvedEnv: ENV,
                comparisonId: 'oc_cbad',
                judgmentId: 'oc_jbad',
                outcomeQualityScore: 0.5,
                outcomeLabel: 'BOGUS',
                ts: _now()
            })).toThrow();
        });
    });

    describe('getBlindJudgments & getLatestComparison', () => {
        test('getBlindJudgments returns all for user × env', () => {
            M.recordBlindJudgment({
                userId: UID_GET, resolvedEnv: ENV,
                judgmentId: 'g_j1', decisionId: 'd1', axes: AXES, ts: _now()
            });
            M.recordBlindJudgment({
                userId: UID_GET, resolvedEnv: ENV,
                judgmentId: 'g_j2', decisionId: 'd2', axes: AXES, ts: _now()
            });
            const r = M.getBlindJudgments({
                userId: UID_GET, resolvedEnv: ENV
            });
            expect(r.length).toBe(2);
        });
        test('getBlindJudgments filters by decisionId', () => {
            M.recordBlindJudgment({
                userId: UID_GET, resolvedEnv: ENV,
                judgmentId: 'g_j_d1', decisionId: 'd_target', axes: AXES, ts: _now()
            });
            M.recordBlindJudgment({
                userId: UID_GET, resolvedEnv: ENV,
                judgmentId: 'g_j_d2', decisionId: 'd_other', axes: AXES, ts: _now()
            });
            const r = M.getBlindJudgments({
                userId: UID_GET, resolvedEnv: ENV,
                decisionId: 'd_target'
            });
            expect(r.length).toBe(1);
            expect(r[0].judgmentId).toBe('g_j_d1');
        });
        test('getLatestComparison returns most recent or null', () => {
            M.recordBlindJudgment({
                userId: UID_GET, resolvedEnv: ENV,
                judgmentId: 'gl_j', decisionId: 'd', axes: AXES, ts: 1000
            });
            M.recordOutcomeComparison({
                userId: UID_GET, resolvedEnv: ENV,
                comparisonId: 'gl_c1', judgmentId: 'gl_j',
                outcomeQualityScore: 0.5, outcomeLabel: 'win', ts: 2000
            });
            M.recordOutcomeComparison({
                userId: UID_GET, resolvedEnv: ENV,
                comparisonId: 'gl_c2', judgmentId: 'gl_j',
                outcomeQualityScore: 0.6, outcomeLabel: 'win', ts: 3000
            });
            const r = M.getLatestComparison({
                userId: UID_GET, resolvedEnv: ENV,
                judgmentId: 'gl_j'
            });
            expect(r.comparisonId).toBe('gl_c2');
        });
        test('getLatestComparison returns null when none', () => {
            M.recordBlindJudgment({
                userId: UID_GET, resolvedEnv: ENV,
                judgmentId: 'gl_no', decisionId: 'd', axes: AXES, ts: _now()
            });
            expect(M.getLatestComparison({
                userId: UID_GET, resolvedEnv: ENV,
                judgmentId: 'gl_no'
            })).toBeNull();
        });
    });

    describe('isolation per user × env', () => {
        test('uid isolation', () => {
            M.recordBlindJudgment({
                userId: UID_ISO_A, resolvedEnv: ENV,
                judgmentId: 'iso_a', decisionId: 'd', axes: AXES, ts: _now()
            });
            M.recordBlindJudgment({
                userId: UID_ISO_B, resolvedEnv: ENV,
                judgmentId: 'iso_b', decisionId: 'd', axes: AXES, ts: _now()
            });
            const a = M.getBlindJudgments({
                userId: UID_ISO_A, resolvedEnv: ENV
            });
            expect(a.every(j => j.judgmentId !== 'iso_b')).toBe(true);
        });
        test('env isolation', () => {
            M.recordBlindJudgment({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                judgmentId: 'env_d', decisionId: 'd', axes: AXES, ts: _now()
            });
            const testnet = M.getBlindJudgments({
                userId: UID_ENV, resolvedEnv: 'TESTNET'
            });
            expect(testnet).toEqual([]);
        });
    });
});
