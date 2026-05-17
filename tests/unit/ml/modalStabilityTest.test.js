'use strict';

/**
 * OMEGA §169 MODAL STABILITY TEST / NEARBY-POSSIBLE-WORLDS ENDORSEMENT.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt lines 5568-5618.
 *
 * "as mai aproba aceasta decizie daca lumea reala ar fi aproape la fel,
 *  dar nu exact identica?"
 *
 * Tests FIRST per TDD discipline.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p169-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/R2_cognition/modalStabilityTest');

const UID = 9169;
const UID_R = 9269;
const UID_GET = 9369;
const UID_ISO_A = 9469;
const UID_ISO_B = 9569;
const UID_ENV = 9669;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    const uids = [UID, UID_R, UID_GET, UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_modal_stability_evaluations WHERE user_id IN (${placeholders})`).run(...uids);
}
beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §169 MODAL STABILITY TEST', () => {

    describe('Migration 326', () => {
        test('326 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('326_ml_modal_stability_evaluations')).toBeTruthy();
        });
        test('verdict CHECK enum (4)', () => {
            expect(() => db.prepare(`INSERT INTO ml_modal_stability_evaluations
                (user_id, resolved_env, evaluation_id, decision_id,
                 num_nearby_worlds_tested, endorsement_count, stability_score,
                 verdict, boldness_adjustment, recommended_action, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'e_bk', 'd1', 10, 8, 0.8, 'BOGUS',
                    1, 'proceed', null, _now())).toThrow();
        });
        test('recommended_action CHECK enum (5)', () => {
            expect(() => db.prepare(`INSERT INTO ml_modal_stability_evaluations
                (user_id, resolved_env, evaluation_id, decision_id,
                 num_nearby_worlds_tested, endorsement_count, stability_score,
                 verdict, boldness_adjustment, recommended_action, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'e_rec', 'd1', 10, 8, 0.8,
                    'stable_across_nearby_worlds', 1, 'BOGUS',
                    null, _now())).toThrow();
        });
        test('num_nearby_worlds_tested >= 5 CHECK', () => {
            expect(() => db.prepare(`INSERT INTO ml_modal_stability_evaluations
                (user_id, resolved_env, evaluation_id, decision_id,
                 num_nearby_worlds_tested, endorsement_count, stability_score,
                 verdict, boldness_adjustment, recommended_action, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'e_min', 'd1', 3, 2, 0.6,
                    'moderately_fragile', 0.7, 'size_reduced',
                    null, _now())).toThrow();
        });
        test('endorsement_count <= num_worlds_tested CHECK', () => {
            expect(() => db.prepare(`INSERT INTO ml_modal_stability_evaluations
                (user_id, resolved_env, evaluation_id, decision_id,
                 num_nearby_worlds_tested, endorsement_count, stability_score,
                 verdict, boldness_adjustment, recommended_action, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'e_over', 'd1', 10, 12, 1.2,
                    'stable_across_nearby_worlds', 1, 'proceed',
                    null, _now())).toThrow();
        });
        test('evaluation_id UNIQUE', () => {
            const stmt = db.prepare(`INSERT INTO ml_modal_stability_evaluations
                (user_id, resolved_env, evaluation_id, decision_id,
                 num_nearby_worlds_tested, endorsement_count, stability_score,
                 verdict, boldness_adjustment, recommended_action, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            stmt.run(UID, ENV, 'e_dup', 'd1', 10, 9, 0.9,
                'stable_across_nearby_worlds', 1, 'proceed', null, _now());
            expect(() => stmt.run(UID, ENV, 'e_dup', 'd2', 10, 5, 0.5,
                'edge_on_a_knife', 0.4, 'wait', null, _now())).toThrow();
        });
    });

    describe('Constants', () => {
        test('VERDICT_CLASSES frozen 4 (canonical PDF list)', () => {
            expect(M.VERDICT_CLASSES).toEqual([
                'stable_across_nearby_worlds',
                'moderately_fragile',
                'edge_on_a_knife',
                'world_specific'
            ]);
            expect(Object.isFrozen(M.VERDICT_CLASSES)).toBe(true);
        });
        test('RECOMMENDED_ACTIONS frozen 5', () => {
            expect(M.RECOMMENDED_ACTIONS).toEqual([
                'proceed', 'size_reduced', 'progressive', 'wait', 'observer'
            ]);
            expect(Object.isFrozen(M.RECOMMENDED_ACTIONS)).toBe(true);
        });
        test('STABILITY_THRESHOLDS ordered', () => {
            expect(M.STABILITY_THRESHOLDS.stable).toBe(0.85);
            expect(M.STABILITY_THRESHOLDS.moderate).toBe(0.60);
            expect(M.STABILITY_THRESHOLDS.edge).toBe(0.40);
        });
        test('BOLDNESS_ADJUSTMENT_MAP per verdict', () => {
            expect(M.BOLDNESS_ADJUSTMENT_MAP.stable_across_nearby_worlds).toBe(1.0);
            expect(M.BOLDNESS_ADJUSTMENT_MAP.moderately_fragile).toBe(0.70);
            expect(M.BOLDNESS_ADJUSTMENT_MAP.edge_on_a_knife).toBe(0.40);
            expect(M.BOLDNESS_ADJUSTMENT_MAP.world_specific).toBe(0.10);
        });
        test('MIN_WORLDS_TESTED = 5', () => {
            expect(M.MIN_WORLDS_TESTED).toBe(5);
        });
    });

    describe('computeStabilityScore (pure)', () => {
        test('all worlds endorse → score 1.0', () => {
            const r = M.computeStabilityScore({
                endorsementCount: 10, numWorldsTested: 10
            });
            expect(r.stabilityScore).toBe(1);
        });
        test('zero endorse → score 0', () => {
            const r = M.computeStabilityScore({
                endorsementCount: 0, numWorldsTested: 10
            });
            expect(r.stabilityScore).toBe(0);
        });
        test('partial endorsement', () => {
            const r = M.computeStabilityScore({
                endorsementCount: 7, numWorldsTested: 10
            });
            expect(r.stabilityScore).toBeCloseTo(0.7, 5);
        });
        test('endorsement > num throws', () => {
            expect(() => M.computeStabilityScore({
                endorsementCount: 12, numWorldsTested: 10
            })).toThrow(/endorsement.*exceed|exceed/i);
        });
        test('num < MIN_WORLDS_TESTED throws', () => {
            expect(() => M.computeStabilityScore({
                endorsementCount: 3, numWorldsTested: 3
            })).toThrow(/min|insufficient/i);
        });
        test('negative inputs throw', () => {
            expect(() => M.computeStabilityScore({
                endorsementCount: -1, numWorldsTested: 10
            })).toThrow();
        });
    });

    describe('classifyVerdict (pure)', () => {
        test('score ≥ 0.85 → stable_across_nearby_worlds', () => {
            expect(M.classifyVerdict({ stabilityScore: 0.90 }).verdict).toBe('stable_across_nearby_worlds');
        });
        test('0.60 ≤ score < 0.85 → moderately_fragile', () => {
            expect(M.classifyVerdict({ stabilityScore: 0.70 }).verdict).toBe('moderately_fragile');
        });
        test('0.40 ≤ score < 0.60 → edge_on_a_knife', () => {
            expect(M.classifyVerdict({ stabilityScore: 0.50 }).verdict).toBe('edge_on_a_knife');
        });
        test('score < 0.40 → world_specific', () => {
            expect(M.classifyVerdict({ stabilityScore: 0.25 }).verdict).toBe('world_specific');
        });
        test('boundary 0.85 → stable', () => {
            expect(M.classifyVerdict({ stabilityScore: 0.85 }).verdict).toBe('stable_across_nearby_worlds');
        });
        test('boundary 0.40 → edge_on_a_knife', () => {
            expect(M.classifyVerdict({ stabilityScore: 0.40 }).verdict).toBe('edge_on_a_knife');
        });
    });

    describe('recommendAction (pure)', () => {
        test('stable → proceed', () => {
            expect(M.recommendAction({
                verdict: 'stable_across_nearby_worlds'
            }).action).toBe('proceed');
        });
        test('moderately_fragile → size_reduced', () => {
            expect(M.recommendAction({
                verdict: 'moderately_fragile'
            }).action).toBe('size_reduced');
        });
        test('edge_on_a_knife → progressive OR wait', () => {
            // PDF allows either — module returns one canonical
            const r = M.recommendAction({ verdict: 'edge_on_a_knife' });
            expect(['progressive', 'wait']).toContain(r.action);
        });
        test('world_specific → observer (do not act)', () => {
            expect(M.recommendAction({
                verdict: 'world_specific'
            }).action).toBe('observer');
        });
        test('invalid verdict throws', () => {
            expect(() => M.recommendAction({ verdict: 'BOGUS' })).toThrow();
        });
    });

    describe('computeBoldnessAdjustment (pure)', () => {
        test('stable → 1.0 (no adjustment)', () => {
            expect(M.computeBoldnessAdjustment({
                verdict: 'stable_across_nearby_worlds'
            }).adjustment).toBe(1.0);
        });
        test('moderately_fragile → 0.70', () => {
            expect(M.computeBoldnessAdjustment({
                verdict: 'moderately_fragile'
            }).adjustment).toBe(0.70);
        });
        test('edge_on_a_knife → 0.40', () => {
            expect(M.computeBoldnessAdjustment({
                verdict: 'edge_on_a_knife'
            }).adjustment).toBe(0.40);
        });
        test('world_specific → 0.10 (near-mute)', () => {
            expect(M.computeBoldnessAdjustment({
                verdict: 'world_specific'
            }).adjustment).toBe(0.10);
        });
        test('invalid verdict throws', () => {
            expect(() => M.computeBoldnessAdjustment({
                verdict: 'BOGUS'
            })).toThrow();
        });
    });

    describe('recordModalStabilityEvaluation', () => {
        test('persists with auto-classify pipeline', () => {
            const r = M.recordModalStabilityEvaluation({
                userId: UID_R, resolvedEnv: ENV,
                evaluationId: 'rm_1', decisionId: 'd_btc_long_72k',
                numWorldsTested: 12,
                endorsementCount: 11,
                reasoning: 'strong endorsement across hidden-state perturbations',
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.stabilityScore).toBeCloseTo(0.9166, 3);
            expect(r.verdict).toBe('stable_across_nearby_worlds');
            expect(r.recommendedAction).toBe('proceed');
            expect(r.boldnessAdjustment).toBe(1.0);
        });
        test('low endorsement → world_specific + observer', () => {
            const r = M.recordModalStabilityEvaluation({
                userId: UID_R, resolvedEnv: ENV,
                evaluationId: 'rm_brittle', decisionId: 'd1',
                numWorldsTested: 10,
                endorsementCount: 2,
                ts: _now()
            });
            expect(r.verdict).toBe('world_specific');
            expect(r.recommendedAction).toBe('observer');
            expect(r.boldnessAdjustment).toBe(0.10);
        });
        test('insufficient worlds tested throws', () => {
            expect(() => M.recordModalStabilityEvaluation({
                userId: UID_R, resolvedEnv: ENV,
                evaluationId: 'rm_few', decisionId: 'd1',
                numWorldsTested: 3, endorsementCount: 2, ts: _now()
            })).toThrow(/min|insufficient/i);
        });
        test('endorsement exceeds num throws', () => {
            expect(() => M.recordModalStabilityEvaluation({
                userId: UID_R, resolvedEnv: ENV,
                evaluationId: 'rm_over', decisionId: 'd1',
                numWorldsTested: 10, endorsementCount: 12, ts: _now()
            })).toThrow(/exceed/i);
        });
        test('duplicate evaluationId throws', () => {
            M.recordModalStabilityEvaluation({
                userId: UID_R, resolvedEnv: ENV,
                evaluationId: 'rm_dup', decisionId: 'd1',
                numWorldsTested: 10, endorsementCount: 7, ts: _now()
            });
            expect(() => M.recordModalStabilityEvaluation({
                userId: UID_R, resolvedEnv: ENV,
                evaluationId: 'rm_dup', decisionId: 'd1',
                numWorldsTested: 10, endorsementCount: 7, ts: _now()
            })).toThrow(/duplicate/);
        });
    });

    describe('getRecentEvaluations & countByVerdict', () => {
        test('getRecentEvaluations filters by verdict', () => {
            M.recordModalStabilityEvaluation({
                userId: UID_GET, resolvedEnv: ENV,
                evaluationId: 'g_s', decisionId: 'd1',
                numWorldsTested: 10, endorsementCount: 10, ts: _now()
            });
            M.recordModalStabilityEvaluation({
                userId: UID_GET, resolvedEnv: ENV,
                evaluationId: 'g_e', decisionId: 'd2',
                numWorldsTested: 10, endorsementCount: 5, ts: _now()
            });
            const stable = M.getRecentEvaluations({
                userId: UID_GET, resolvedEnv: ENV,
                verdict: 'stable_across_nearby_worlds'
            });
            expect(stable.length).toBe(1);
        });
        test('countByVerdict returns counts per class', () => {
            for (let i = 0; i < 3; i++) {
                M.recordModalStabilityEvaluation({
                    userId: UID_GET, resolvedEnv: ENV,
                    evaluationId: `c_s_${i}`, decisionId: `d${i}`,
                    numWorldsTested: 10, endorsementCount: 10, ts: 1000 + i
                });
            }
            M.recordModalStabilityEvaluation({
                userId: UID_GET, resolvedEnv: ENV,
                evaluationId: 'c_w', decisionId: 'dw',
                numWorldsTested: 10, endorsementCount: 1, ts: 2000
            });
            const stats = M.countByVerdict({
                userId: UID_GET, resolvedEnv: ENV,
                sinceTs: 0
            });
            expect(stats.stable_across_nearby_worlds).toBe(3);
            expect(stats.world_specific).toBe(1);
            expect(stats.totalCount).toBe(4);
        });
    });

    describe('isolation per user × env', () => {
        test('uid isolation', () => {
            M.recordModalStabilityEvaluation({
                userId: UID_ISO_A, resolvedEnv: ENV,
                evaluationId: 'iso_a', decisionId: 'd',
                numWorldsTested: 10, endorsementCount: 9, ts: _now()
            });
            M.recordModalStabilityEvaluation({
                userId: UID_ISO_B, resolvedEnv: ENV,
                evaluationId: 'iso_b', decisionId: 'd',
                numWorldsTested: 10, endorsementCount: 9, ts: _now()
            });
            const a = M.getRecentEvaluations({
                userId: UID_ISO_A, resolvedEnv: ENV
            });
            expect(a.every(e => e.evaluationId !== 'iso_b')).toBe(true);
        });
        test('env isolation', () => {
            M.recordModalStabilityEvaluation({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                evaluationId: 'env_d', decisionId: 'd',
                numWorldsTested: 10, endorsementCount: 9, ts: _now()
            });
            const testnet = M.getRecentEvaluations({
                userId: UID_ENV, resolvedEnv: 'TESTNET'
            });
            expect(testnet).toEqual([]);
        });
    });
});
