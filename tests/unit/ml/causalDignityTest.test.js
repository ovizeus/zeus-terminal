'use strict';

/**
 * OMEGA §178 CAUSAL DIGNITY TEST / DOES-THIS-EXPLANATION-RESPECT-THE-WORLD.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt lines 5792-5832.
 *
 * "explicatia mea chiar respecta felul in care pare sa functioneze lumea
 *  sau doar exploateaza o scurtatura?"
 *
 * Tests FIRST per TDD discipline.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p178-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/R2_cognition/causalDignityTest');

const UID = 9178;
const UID_R = 9278;
const UID_GET = 9378;
const UID_ISO_A = 9478;
const UID_ISO_B = 9578;
const UID_ENV = 9678;
const ENV = 'DEMO';
const _now = () => Date.now();

const RESPECTFUL = {
    mechanicalRealism: 0.85, interRegimeStability: 0.80,
    transferability: 0.75, interventionSupportability: 0.80,
    causalStructureCompatibility: 0.85
};
const SHORTCUT = {
    mechanicalRealism: 0.15, interRegimeStability: 0.20,
    transferability: 0.10, interventionSupportability: 0.10,
    causalStructureCompatibility: 0.15
};

function cleanRows() {
    const uids = [UID, UID_R, UID_GET, UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_causal_dignity_evaluations WHERE user_id IN (${placeholders})`).run(...uids);
}
beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §178 CAUSAL DIGNITY TEST', () => {

    describe('Migration 330', () => {
        test('330 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('330_ml_causal_dignity_evaluations')).toBeTruthy();
        });
        test('classification CHECK enum (3)', () => {
            expect(() => db.prepare(`INSERT INTO ml_causal_dignity_evaluations
                (user_id, resolved_env, evaluation_id, explanation_label,
                 predictive_accuracy, mechanical_realism, inter_regime_stability,
                 transferability, intervention_supportability,
                 causal_structure_compatibility, composite_dignity_score,
                 classification, allowed_use_tier, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'e_bk', 'l', 0.8, 0.8, 0.8, 0.8, 0.8, 0.8,
                    0.8, 'BOGUS', 'ontological_foundation', null, _now())).toThrow();
        });
        test('allowed_use_tier CHECK enum (3)', () => {
            expect(() => db.prepare(`INSERT INTO ml_causal_dignity_evaluations
                (user_id, resolved_env, evaluation_id, explanation_label,
                 predictive_accuracy, mechanical_realism, inter_regime_stability,
                 transferability, intervention_supportability,
                 causal_structure_compatibility, composite_dignity_score,
                 classification, allowed_use_tier, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'e_tier', 'l', 0.8, 0.8, 0.8, 0.8, 0.8, 0.8,
                    0.8, 'explanation_works', 'BOGUS', null, _now())).toThrow();
        });
        test('evaluation_id UNIQUE', () => {
            const stmt = db.prepare(`INSERT INTO ml_causal_dignity_evaluations
                (user_id, resolved_env, evaluation_id, explanation_label,
                 predictive_accuracy, mechanical_realism, inter_regime_stability,
                 transferability, intervention_supportability,
                 causal_structure_compatibility, composite_dignity_score,
                 classification, allowed_use_tier, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            stmt.run(UID, ENV, 'e_dup', 'l', 0.8, 0.8, 0.8, 0.8, 0.8, 0.8,
                0.8, 'explanation_respects_mechanism', 'ontological_foundation',
                null, _now());
            expect(() => stmt.run(UID, ENV, 'e_dup', 'l2', 0.8, 0.8, 0.8, 0.8,
                0.8, 0.8, 0.8, 'explanation_works', 'local_application',
                null, _now())).toThrow();
        });
    });

    describe('Constants', () => {
        test('DIGNITY_CRITERIA frozen 5 (canonical PDF list)', () => {
            expect(M.DIGNITY_CRITERIA).toEqual([
                'mechanicalRealism', 'interRegimeStability',
                'transferability', 'interventionSupportability',
                'causalStructureCompatibility'
            ]);
            expect(Object.isFrozen(M.DIGNITY_CRITERIA)).toBe(true);
        });
        test('CLASSIFICATIONS frozen 3 (canonical PDF list)', () => {
            expect(M.CLASSIFICATIONS).toEqual([
                'explanation_works',
                'explanation_respects_mechanism',
                'explanation_is_exploitative_shortcut'
            ]);
            expect(Object.isFrozen(M.CLASSIFICATIONS)).toBe(true);
        });
        test('USE_TIERS frozen 3', () => {
            expect(M.USE_TIERS).toEqual([
                'heuristic_only', 'local_application', 'ontological_foundation'
            ]);
            expect(Object.isFrozen(M.USE_TIERS)).toBe(true);
        });
        test('DIGNITY_THRESHOLDS ordered', () => {
            expect(M.DIGNITY_THRESHOLDS.foundation).toBe(0.70);
            expect(M.DIGNITY_THRESHOLDS.local).toBe(0.40);
        });
        test('SHORTCUT_DETECTION_THRESHOLDS', () => {
            // high predictive + low dignity = shortcut
            expect(M.SHORTCUT_DETECTION_THRESHOLDS.minPredictive).toBe(0.65);
            expect(M.SHORTCUT_DETECTION_THRESHOLDS.maxDignity).toBe(0.30);
        });
    });

    describe('computeDignityScore (pure)', () => {
        test('all criteria high → high dignity', () => {
            const r = M.computeDignityScore({ criteria: RESPECTFUL });
            expect(r.dignityScore).toBeGreaterThan(0.75);
        });
        test('all criteria low → low dignity', () => {
            const r = M.computeDignityScore({ criteria: SHORTCUT });
            expect(r.dignityScore).toBeLessThan(0.20);
        });
        test('equal-weighted (1/5 each) → mean', () => {
            const r = M.computeDignityScore({
                criteria: {
                    mechanicalRealism: 0.5, interRegimeStability: 0.5,
                    transferability: 0.5, interventionSupportability: 0.5,
                    causalStructureCompatibility: 0.5
                }
            });
            expect(r.dignityScore).toBeCloseTo(0.5, 5);
        });
        test('missing criterion throws', () => {
            const partial = { ...RESPECTFUL };
            delete partial.transferability;
            expect(() => M.computeDignityScore({ criteria: partial })).toThrow();
        });
        test('out-of-range throws', () => {
            expect(() => M.computeDignityScore({
                criteria: { ...RESPECTFUL, mechanicalRealism: 1.5 }
            })).toThrow();
        });
    });

    describe('classifyExplanation (pure)', () => {
        test('high dignity → explanation_respects_mechanism', () => {
            const r = M.classifyExplanation({
                predictiveAccuracy: 0.75, dignityScore: 0.85
            });
            expect(r.classification).toBe('explanation_respects_mechanism');
        });
        test('high predictive + low dignity → exploitative_shortcut', () => {
            const r = M.classifyExplanation({
                predictiveAccuracy: 0.85, dignityScore: 0.20
            });
            expect(r.classification).toBe('explanation_is_exploitative_shortcut');
        });
        test('moderate dignity + ok predictive → explanation_works (middle band)', () => {
            const r = M.classifyExplanation({
                predictiveAccuracy: 0.65, dignityScore: 0.50
            });
            expect(r.classification).toBe('explanation_works');
        });
        test('low predictive + low dignity → explanation_works (just weak overall)', () => {
            // Not technically shortcut without high predictive accuracy
            const r = M.classifyExplanation({
                predictiveAccuracy: 0.30, dignityScore: 0.20
            });
            expect(r.classification).toBe('explanation_works');
        });
        test('out-of-range throws', () => {
            expect(() => M.classifyExplanation({
                predictiveAccuracy: 1.5, dignityScore: 0.5
            })).toThrow();
        });
    });

    describe('recommendUseTier (pure)', () => {
        test('high dignity → ontological_foundation', () => {
            const r = M.recommendUseTier({
                dignityScore: 0.85,
                classification: 'explanation_respects_mechanism'
            });
            expect(r.useTier).toBe('ontological_foundation');
        });
        test('mid dignity → local_application', () => {
            const r = M.recommendUseTier({
                dignityScore: 0.55,
                classification: 'explanation_works'
            });
            expect(r.useTier).toBe('local_application');
        });
        test('low dignity → heuristic_only', () => {
            const r = M.recommendUseTier({
                dignityScore: 0.20,
                classification: 'explanation_is_exploitative_shortcut'
            });
            expect(r.useTier).toBe('heuristic_only');
        });
        test('shortcut classification forces at-most heuristic_only', () => {
            // Per PDF rule 5826: low-dignity (shortcut) → heuristic only,
            // NOT ontological foundation even if numerics look ok
            const r = M.recommendUseTier({
                dignityScore: 0.50,  // would normally be local
                classification: 'explanation_is_exploitative_shortcut'
            });
            expect(r.useTier).toBe('heuristic_only');
        });
        test('invalid classification throws', () => {
            expect(() => M.recommendUseTier({
                dignityScore: 0.5, classification: 'BOGUS'
            })).toThrow();
        });
    });

    describe('recordCausalDignityEvaluation', () => {
        test('persists with auto-pipeline', () => {
            const r = M.recordCausalDignityEvaluation({
                userId: UID_R, resolvedEnv: ENV,
                evaluationId: 'rc_1',
                explanationLabel: 'CVD+orderflow → entry quality (mechanism: liquidity transfer)',
                predictiveAccuracy: 0.70,
                criteria: RESPECTFUL,
                reasoning: 'mechanistic story coherent with execution model',
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.compositeDignityScore).toBeGreaterThan(0.75);
            expect(r.classification).toBe('explanation_respects_mechanism');
            expect(r.allowedUseTier).toBe('ontological_foundation');
        });
        test('shortcut detection (high predictive + low dignity)', () => {
            const r = M.recordCausalDignityEvaluation({
                userId: UID_R, resolvedEnv: ENV,
                evaluationId: 'rc_shortcut',
                explanationLabel: 'pure pattern match without mechanism',
                predictiveAccuracy: 0.85,
                criteria: SHORTCUT,
                ts: _now()
            });
            expect(r.classification).toBe('explanation_is_exploitative_shortcut');
            expect(r.allowedUseTier).toBe('heuristic_only');
        });
        test('duplicate evaluationId throws', () => {
            M.recordCausalDignityEvaluation({
                userId: UID_R, resolvedEnv: ENV,
                evaluationId: 'rc_dup', explanationLabel: 'l',
                predictiveAccuracy: 0.5, criteria: RESPECTFUL, ts: _now()
            });
            expect(() => M.recordCausalDignityEvaluation({
                userId: UID_R, resolvedEnv: ENV,
                evaluationId: 'rc_dup', explanationLabel: 'l',
                predictiveAccuracy: 0.5, criteria: RESPECTFUL, ts: _now()
            })).toThrow(/duplicate/);
        });
        test('missing criterion throws', () => {
            const partial = { ...RESPECTFUL };
            delete partial.mechanicalRealism;
            expect(() => M.recordCausalDignityEvaluation({
                userId: UID_R, resolvedEnv: ENV,
                evaluationId: 'rc_part', explanationLabel: 'l',
                predictiveAccuracy: 0.5, criteria: partial, ts: _now()
            })).toThrow();
        });
    });

    describe('getRecentEvaluations & getStatsByClassification', () => {
        test('getRecentEvaluations filters by classification', () => {
            M.recordCausalDignityEvaluation({
                userId: UID_GET, resolvedEnv: ENV,
                evaluationId: 'g_r', explanationLabel: 'l',
                predictiveAccuracy: 0.70, criteria: RESPECTFUL, ts: _now()
            });
            M.recordCausalDignityEvaluation({
                userId: UID_GET, resolvedEnv: ENV,
                evaluationId: 'g_s', explanationLabel: 'l',
                predictiveAccuracy: 0.85, criteria: SHORTCUT, ts: _now()
            });
            const shortcuts = M.getRecentEvaluations({
                userId: UID_GET, resolvedEnv: ENV,
                classification: 'explanation_is_exploitative_shortcut'
            });
            expect(shortcuts.length).toBe(1);
            expect(shortcuts[0].evaluationId).toBe('g_s');
        });
        test('getStatsByClassification returns counts', () => {
            M.recordCausalDignityEvaluation({
                userId: UID_GET, resolvedEnv: ENV,
                evaluationId: 'gs_1', explanationLabel: 'l',
                predictiveAccuracy: 0.70, criteria: RESPECTFUL, ts: 1000
            });
            M.recordCausalDignityEvaluation({
                userId: UID_GET, resolvedEnv: ENV,
                evaluationId: 'gs_2', explanationLabel: 'l',
                predictiveAccuracy: 0.85, criteria: SHORTCUT, ts: 2000
            });
            const stats = M.getStatsByClassification({
                userId: UID_GET, resolvedEnv: ENV,
                sinceTs: 0
            });
            expect(stats.explanation_respects_mechanism).toBe(1);
            expect(stats.explanation_is_exploitative_shortcut).toBe(1);
            expect(stats.totalCount).toBe(2);
        });
    });

    describe('isolation per user × env', () => {
        test('uid isolation', () => {
            M.recordCausalDignityEvaluation({
                userId: UID_ISO_A, resolvedEnv: ENV,
                evaluationId: 'iso_a', explanationLabel: 'l',
                predictiveAccuracy: 0.5, criteria: RESPECTFUL, ts: _now()
            });
            M.recordCausalDignityEvaluation({
                userId: UID_ISO_B, resolvedEnv: ENV,
                evaluationId: 'iso_b', explanationLabel: 'l',
                predictiveAccuracy: 0.5, criteria: RESPECTFUL, ts: _now()
            });
            const a = M.getRecentEvaluations({
                userId: UID_ISO_A, resolvedEnv: ENV
            });
            expect(a.every(e => e.evaluationId !== 'iso_b')).toBe(true);
        });
        test('env isolation', () => {
            M.recordCausalDignityEvaluation({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                evaluationId: 'env_d', explanationLabel: 'l',
                predictiveAccuracy: 0.5, criteria: RESPECTFUL, ts: _now()
            });
            const testnet = M.getRecentEvaluations({
                userId: UID_ENV, resolvedEnv: 'TESTNET'
            });
            expect(testnet).toEqual([]);
        });
    });
});
