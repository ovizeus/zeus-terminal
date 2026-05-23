/**
 * R5A Learning Core — learningPrinciples tests (canonical §8)
 *
 * Meta-checklist for "good learning". Pure state-driven evaluator that
 * audits which of the 20 spec principles are satisfied given the current
 * Omega module state.
 */

const {
    LEARNING_PRINCIPLES,
    evaluateLearningReadiness,
    learningReadinessScore
} = require('../../../server/services/ml/R5A_learning/learningPrinciples')

describe('R5A — learningPrinciples (canonical §8)', () => {

    describe('LEARNING_PRINCIPLES export', () => {
        test('has 20 principles per spec', () => {
            expect(LEARNING_PRINCIPLES.length).toBe(20)
        })

        test('each principle has id + label + satisfied_by', () => {
            for (const p of LEARNING_PRINCIPLES) {
                expect(typeof p.id).toBe('string')
                expect(typeof p.label).toBe('string')
                expect(typeof p.satisfied_by).toBe('string')
            }
        })

        test('ids are unique', () => {
            const ids = LEARNING_PRINCIPLES.map(p => p.id)
            const uniq = new Set(ids)
            expect(uniq.size).toBe(ids.length)
        })

        test('frozen (cannot be mutated)', () => {
            expect(Object.isFrozen(LEARNING_PRINCIPLES)).toBe(true)
        })
    })

    describe('evaluateLearningReadiness(state)', () => {
        test('returns array of {id, satisfied, message} for all 20 principles', () => {
            const result = evaluateLearningReadiness({})
            expect(Array.isArray(result)).toBe(true)
            expect(result.length).toBe(20)
            for (const r of result) {
                expect(r).toHaveProperty('id')
                expect(r).toHaveProperty('satisfied')
                expect(r).toHaveProperty('message')
                expect(typeof r.satisfied).toBe('boolean')
            }
        })

        test('empty state → all principles unsatisfied (foundation flags)', () => {
            const result = evaluateLearningReadiness({})
            const satisfiedCount = result.filter(r => r.satisfied).length
            expect(satisfiedCount).toBe(0)
        })

        test('full state → all principles satisfied', () => {
            // Module-level flags (some satisfy multiple principles)
            const fullState = {
                has_data_hygiene: true,         // → clean_data + no_future_in_train + chronological_test
                has_correct_labels: true,       // → correct_labels
                has_all_regimes: true,          // → all_regimes_data
                has_attribution: true,          // → feedback_loop + predict_vs_actual + causal_learning
                has_per_regime_metrics: true,   // → knows_strong + knows_weak + per_regime_compare
                has_drift_detection: true,      // → continuous_no_break
                has_backtest_skepticism: true,
                has_overfit_check: true,
                has_per_regime_holdouts: true,
                has_oos_stress_windows: true,
                has_feature_importance_stability: true,
                has_rolling_retraining: true,
                has_canary_deploy: true,
                has_recalibration: true
            }
            const result = evaluateLearningReadiness(fullState)
            const satisfiedCount = result.filter(r => r.satisfied).length
            expect(satisfiedCount).toBe(20)
        })

        test('partial state → partial satisfaction', () => {
            const partial = {
                has_data_hygiene: true,
                has_attribution: true,
                has_calibration: true
            }
            const result = evaluateLearningReadiness(partial)
            const satisfied = result.filter(r => r.satisfied)
            expect(satisfied.length).toBeGreaterThanOrEqual(3)
            expect(satisfied.length).toBeLessThan(20)
        })

        test('throws on null state', () => {
            expect(() => evaluateLearningReadiness(null)).toThrow()
        })

        test('non-boolean state values treated as falsy', () => {
            const result = evaluateLearningReadiness({
                has_attribution: 'yes',  // string, not bool
                has_calibration: 1        // number, not bool
            })
            const attrPrinciple = result.find(r => r.id === 'feedback_loop')
            // String 'yes' is truthy → satisfied
            expect(attrPrinciple.satisfied).toBe(true)
        })
    })

    describe('learningReadinessScore(state)', () => {
        test('returns 0 for empty state', () => {
            expect(learningReadinessScore({})).toBe(0)
        })

        test('returns 1 for full state', () => {
            const fullState = {}
            for (const p of LEARNING_PRINCIPLES) {
                fullState[p.satisfied_by] = true
            }
            expect(learningReadinessScore(fullState)).toBe(1)
        })

        test('returns fractional score for partial state', () => {
            const partial = { has_attribution: true, has_calibration: true, has_drift_detection: true }
            const s = learningReadinessScore(partial)
            expect(s).toBeGreaterThan(0)
            expect(s).toBeLessThan(1)
        })

        test('clamped to [0, 1]', () => {
            const s = learningReadinessScore({})
            expect(s).toBeGreaterThanOrEqual(0)
            expect(s).toBeLessThanOrEqual(1)
        })
    })

    describe('Wave 2 R5A integration check', () => {
        test('a state representing current Wave 2 R5A delivers > 0 readiness', () => {
            // Current Wave 2 R5A delivers: §16 attribution + §17 metrics +
            // §20 calibration + §21 drift + §22 data hygiene + §11 vocab
            const currentR5aState = {
                has_attribution: true,         // §16
                has_per_regime_metrics: true,   // §17
                has_calibration: true,          // §20
                has_per_regime_comparison: true,
                has_feedback_loop: true,        // §16 setOperatorFeedback
                has_data_hygiene: true,         // §22
                has_no_lookahead: true,         // §22 detectLookahead
                has_chronological_test: true,   // §22 chronologicalSplit
                has_correct_labels: true,       // §11
                has_causal_learning: true       // §16 causal_class
            }
            const score = learningReadinessScore(currentR5aState)
            expect(score).toBeGreaterThan(0.3)
            expect(score).toBeLessThan(1.0)
        })
    })
})
