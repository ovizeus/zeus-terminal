'use strict';

/**
 * OMEGA R5A Learning Core — learningPrinciples (canonical §8)
 *
 * Meta-checklist: 20 spec-mandated principles for "good learning".
 * State-driven evaluator that audits which principles are satisfied
 * given current Omega module state. Returns granular pass/fail per
 * principle + a single readiness score (0-1).
 *
 * Used by OmegaPage report card + Wave 3+ R5B governance to gate
 * promotion: a configuration that fails too many learning principles
 * shouldn't graduate from SHADOW to DEMO influence.
 *
 * Pure logic, no DB, no migration.
 */

const LEARNING_PRINCIPLES = Object.freeze([
    { id: 'clean_data',         label: 'date curate',
      satisfied_by: 'has_data_hygiene',
      satisfied_msg: '§22 dataHygiene validators in place',
      missing_msg: 'data hygiene module not wired (§22 dataHygiene)' },

    { id: 'correct_labels',     label: 'etichete corecte',
      satisfied_by: 'has_correct_labels',
      satisfied_msg: '§11 targetLabels.classifyLabel canonical vocabulary',
      missing_msg: 'label classifier not in place (§11 targetLabels)' },

    { id: 'all_regimes_data',   label: 'exemple din toate regimurile',
      satisfied_by: 'has_all_regimes',
      satisfied_msg: 'data spans all canonical regimes (trend/range/chop/squeeze/news-risk/high-vol/low-vol)',
      missing_msg: 'training data missing one or more regime classes' },

    { id: 'no_future_in_train', label: 'sa nu vada viitorul in datele de train',
      satisfied_by: 'has_data_hygiene',
      satisfied_msg: '§22 detectLookahead applied (part of dataHygiene module)',
      missing_msg: 'lookahead detection not enforced (§22 detectLookahead)' },

    { id: 'chronological_test', label: 'testat cronologic',
      satisfied_by: 'has_data_hygiene',
      satisfied_msg: '§22 chronologicalSplit (no shuffle) — part of dataHygiene',
      missing_msg: 'chronological split missing (§22 chronologicalSplit)' },

    { id: 'feedback_loop',      label: 'feedback loop',
      satisfied_by: 'has_attribution',
      satisfied_msg: '§16 setOperatorFeedback inside attributionEngine closes the loop',
      missing_msg: 'feedback loop not closed (§16 setOperatorFeedback)' },

    { id: 'predict_vs_actual',  label: 'compara predictia cu rezultatul real',
      satisfied_by: 'has_attribution',
      satisfied_msg: '§16 attributionEngine.recordAttribution',
      missing_msg: 'attribution engine not wired (§16 attributionEngine)' },

    { id: 'knows_strong_regimes',  label: 'stie in ce conditii performeaza bine',
      satisfied_by: 'has_per_regime_metrics',
      satisfied_msg: '§17 regimeMetrics.getAllRegimeMetrics',
      missing_msg: 'per-regime metrics not wired (§17 regimeMetrics)' },

    { id: 'knows_weak_regimes', label: 'stie in ce conditii performeaza prost',
      satisfied_by: 'has_per_regime_metrics',
      satisfied_msg: '§17 regimeMetrics (same as strong-regime tracking)',
      missing_msg: 'per-regime metrics not wired (§17 regimeMetrics)' },

    { id: 'periodic_recalibration', label: 'recalibrare periodica',
      satisfied_by: 'has_recalibration',
      satisfied_msg: 'recalibration loop scheduled (Wave 5+ — Platt/isotonic remap)',
      missing_msg: 'recalibration loop not wired (Wave 5+ — Platt/isotonic remap)' },

    { id: 'backtest_skepticism', label: 'sa nu fie lasat sa se auto-amageasca din backtest-uri frumoase',
      satisfied_by: 'has_backtest_skepticism',
      satisfied_msg: 'backtest-vs-live divergence checks active',
      missing_msg: 'no backtest skepticism guard (Wave 4+ R3B validation)' },

    { id: 'overfit_check',      label: 'auto-check pentru overfitting pe fiecare regim',
      satisfied_by: 'has_overfit_check',
      satisfied_msg: 'per-regime overfit detector active',
      missing_msg: 'overfit detection missing (Wave 4+ R3B)' },

    { id: 'per_regime_holdouts', label: 'holdouts pe fiecare regim',
      satisfied_by: 'has_per_regime_holdouts',
      satisfied_msg: 'per-regime holdout sets reserved',
      missing_msg: 'no per-regime holdouts (Wave 4+ R3B)' },

    { id: 'oos_stress_windows', label: 'stress windows out-of-sample',
      satisfied_by: 'has_oos_stress_windows',
      satisfied_msg: 'OOS stress windows configured',
      missing_msg: 'no OOS stress windows (Wave 4+ R3B)' },

    { id: 'feature_stability', label: 'stabilitatea feature importance',
      satisfied_by: 'has_feature_importance_stability',
      satisfied_msg: 'feature importance stability tracked',
      missing_msg: 'feature importance stability not tracked (Wave 3+ when features pipeline ships)' },

    { id: 'continuous_no_break', label: 'invete continuu fara sa distruga robustetea',
      satisfied_by: 'has_drift_detection',
      satisfied_msg: '§21 drift detection acts as continuous-learning guard',
      missing_msg: 'continuous learning guards missing (§21 drift + Wave 4 R5B governance)' },

    { id: 'rolling_retraining', label: 'rolling window retraining',
      satisfied_by: 'has_rolling_retraining',
      satisfied_msg: 'rolling-window retraining scheduler active',
      missing_msg: 'rolling-window retraining missing (Wave 5+ retraining infrastructure)' },

    { id: 'canary_deploy',      label: 'canary deploy inainte de adoptie completa',
      satisfied_by: 'has_canary_deploy',
      satisfied_msg: 'canary deploy via R6 Shadow/Meta A/B framework',
      missing_msg: 'canary deploy missing (Wave 7 — R6 Shadow/Meta)' },

    { id: 'per_regime_compare', label: 'compara performanta pe trend/range/chop separat',
      satisfied_by: 'has_per_regime_metrics',
      satisfied_msg: '§17 regimeMetrics.getAllRegimeMetrics breakdown',
      missing_msg: 'per-regime comparison not wired (§17 regimeMetrics)' },

    { id: 'causal_learning',    label: 'invete cauzal, nu doar statistic',
      satisfied_by: 'has_attribution',
      satisfied_msg: '§16 attributionEngine causal_class (11 causal labels)',
      missing_msg: 'causal classification missing (§16 attributionEngine.classifyCausal)' }
]);

function evaluateLearningReadiness(state) {
    if (!state || typeof state !== 'object') {
        throw new Error('evaluateLearningReadiness: state object required');
    }
    return LEARNING_PRINCIPLES.map(p => {
        const satisfied = !!state[p.satisfied_by];
        return {
            id: p.id,
            satisfied,
            message: satisfied ? p.satisfied_msg : p.missing_msg
        };
    });
}

function learningReadinessScore(state) {
    if (!state || typeof state !== 'object') return 0;
    let satisfied = 0;
    for (const p of LEARNING_PRINCIPLES) {
        if (state[p.satisfied_by]) satisfied++;
    }
    return Math.max(0, Math.min(1, satisfied / LEARNING_PRINCIPLES.length));
}

module.exports = {
    LEARNING_PRINCIPLES,
    evaluateLearningReadiness,
    learningReadinessScore
};
