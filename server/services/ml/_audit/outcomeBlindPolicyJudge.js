'use strict';

/**
 * OMEGA Wave 3 §154 — OUTCOME-BLIND POLICY JUDGE / VEIL-OF-RESULT GOVERNANCE.
 *
 * Canonical PDF §154 (ml_brain_canonic.txt lines 5132-5178).
 *
 * "a fost asta o decizie buna chiar daca n-as sti deloc cum s-a terminat?"
 *
 * Distinct de:
 *   - §16  attribution (R5A_learning)   — post-trade attribution
 *   - §147 intellectualHonestyAudit     — reason drift
 *   - §148 ontologicalHumility          — reality exceeds model
 *   - §149 purposeDriftDetector         — scope substitution
 *   - §150 metaEpistemicSandbox         — epistemic regime comparison
 *   - §153 sourceAblationRobustness     — belief robustness via deletion
 *
 * §154 = JUDGE FĂRĂ SĂ ȘTIE OUTCOME. Profitul poate masca prostia;
 *        pierderea poate masca prudența. Decizia evaluată exclusiv pe
 *        calitate epistemică pre-outcome.
 *
 * 6 canonical scoring axes (PDF lines 5149-5155):
 *   infoQuality | thesisIntegrity | riskAppropriateness |
 *   executionAppropriateness | reversibility | opportunityRanking
 *
 * Equal-weighted composite (PDF nu specifică ponderi diferite — egalitate
 * neutră pentru first version, operator poate suprapune weights).
 *
 * Outcome comparison (separat, FK) emite interpretation:
 *   aligned (|gap| ≤ 0.20) — judecata și realitatea concordă
 *   skilled_good — decizie bună + outcome bun (cu gap)
 *   lucky_good — decizie slabă + outcome bun
 *   unlucky_bad — decizie bună + outcome slab
 *   deserved_bad — decizie slabă + outcome slab (cu gap)
 *
 * Reguli canonical (PDF lines 5170-5174):
 * - policy updates importante trebuie justificate prin blind review, nu prin outcome brut
 * - win-ul nu absolvă decizia slabă; loss-ul nu condamnă decizia bună
 * - blind verdict trebuie logat înainte de outcome review complet
 *   (enforced de caller prin `lockedPreOutcome` flag = 1 default)
 *
 * Per-(user × resolved_env) isolated. Server-only.
 */

const { db } = require('../../database');

const DECISION_AXES = Object.freeze([
    'infoQuality', 'thesisIntegrity',
    'riskAppropriateness', 'executionAppropriateness',
    'reversibility', 'opportunityRanking'
]);
const DECISION_CLASSIFICATIONS = Object.freeze([
    'excellent', 'sound', 'marginal', 'poor'
]);
const OUTCOME_LABELS = Object.freeze([
    'win', 'loss', 'breakeven', 'cancelled'
]);
const INTERPRETATIONS = Object.freeze([
    'lucky_good', 'skilled_good', 'unlucky_bad',
    'deserved_bad', 'aligned'
]);

const DECISION_THRESHOLDS = Object.freeze({
    excellent: 0.80, sound: 0.60, marginal: 0.40
});
const ALIGNED_GAP_MAX = 0.20;
const GOOD_OUTCOME_THRESHOLD = 0.60;  // for lucky/skilled/unlucky split

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

function _required(params, key) {
    if (params == null || params[key] == null) {
        throw new Error(`§154 missing required param: ${key}`);
    }
    return params[key];
}
function _requireEnv(env) {
    if (!RESOLVED_ENVS.has(env)) {
        throw new Error(`§154 invalid resolvedEnv: ${env}`);
    }
    return env;
}
function _requireRange01(name, v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`§154 ${name} must be number in [0,1], got ${v}`);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PURE FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

function computeDecisionQuality(params) {
    const axes = _required(params, 'axes');
    let sum = 0;
    for (const ax of DECISION_AXES) {
        if (axes[ax] === undefined || axes[ax] === null) {
            throw new Error(`§154 missing axis: ${ax}`);
        }
        _requireRange01(ax, axes[ax]);
        sum += axes[ax];
    }
    const composite = sum / DECISION_AXES.length;
    return { composite: Math.max(0, Math.min(1, composite)) };
}

function classifyDecision(params) {
    const compositeScore = _required(params, 'compositeScore');
    _requireRange01('compositeScore', compositeScore);
    let classification;
    if (compositeScore >= DECISION_THRESHOLDS.excellent) classification = 'excellent';
    else if (compositeScore >= DECISION_THRESHOLDS.sound) classification = 'sound';
    else if (compositeScore >= DECISION_THRESHOLDS.marginal) classification = 'marginal';
    else classification = 'poor';
    return { classification, compositeScore };
}

function computeOutcomeGap(params) {
    const decisionQuality = _required(params, 'decisionQuality');
    const outcomeQuality = _required(params, 'outcomeQuality');
    _requireRange01('decisionQuality', decisionQuality);
    _requireRange01('outcomeQuality', outcomeQuality);
    return { gap: Math.abs(decisionQuality - outcomeQuality) };
}

function interpretComparison(params) {
    const decisionQuality = _required(params, 'decisionQuality');
    const outcomeQuality = _required(params, 'outcomeQuality');
    _requireRange01('decisionQuality', decisionQuality);
    _requireRange01('outcomeQuality', outcomeQuality);
    const gap = Math.abs(decisionQuality - outcomeQuality);
    if (gap <= ALIGNED_GAP_MAX) {
        return { interpretation: 'aligned', gap };
    }
    // Outside aligned band — separate by outcome quality high vs low.
    const goodOutcome = outcomeQuality >= GOOD_OUTCOME_THRESHOLD;
    const goodDecision = decisionQuality >= GOOD_OUTCOME_THRESHOLD;
    let interpretation;
    if (goodDecision && goodOutcome) interpretation = 'skilled_good';
    else if (!goodDecision && goodOutcome) interpretation = 'lucky_good';
    else if (goodDecision && !goodOutcome) interpretation = 'unlucky_bad';
    else interpretation = 'deserved_bad';
    return { interpretation, gap };
}

// ──────────────────────────────────────────────────────────────────────────
// DB-BOUND FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

const _stmts = {
    insertJudgment: db.prepare(`
        INSERT INTO ml_blind_decision_judgments (
            user_id, resolved_env, judgment_id, decision_id,
            info_quality_score, thesis_integrity_score,
            risk_appropriateness_score, execution_appropriateness_score,
            reversibility_score, opportunity_ranking_score,
            composite_decision_quality, classification,
            locked_pre_outcome, judge_reasoning, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectJudgment: db.prepare(`
        SELECT id, judgment_id AS judgmentId, decision_id AS decisionId,
               info_quality_score AS infoQualityScore,
               thesis_integrity_score AS thesisIntegrityScore,
               risk_appropriateness_score AS riskAppropriatenessScore,
               execution_appropriateness_score AS executionAppropriatenessScore,
               reversibility_score AS reversibilityScore,
               opportunity_ranking_score AS opportunityRankingScore,
               composite_decision_quality AS compositeDecisionQuality,
               classification,
               locked_pre_outcome AS lockedPreOutcome,
               judge_reasoning AS judgeReasoning, ts
        FROM ml_blind_decision_judgments
        WHERE judgment_id = ?
    `),
    selectAllJudgments: db.prepare(`
        SELECT id, judgment_id AS judgmentId, decision_id AS decisionId,
               composite_decision_quality AS compositeDecisionQuality,
               classification,
               locked_pre_outcome AS lockedPreOutcome, ts
        FROM ml_blind_decision_judgments
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
    `),
    selectJudgmentsByDecision: db.prepare(`
        SELECT id, judgment_id AS judgmentId, decision_id AS decisionId,
               composite_decision_quality AS compositeDecisionQuality,
               classification,
               locked_pre_outcome AS lockedPreOutcome, ts
        FROM ml_blind_decision_judgments
        WHERE user_id = ? AND resolved_env = ? AND decision_id = ?
        ORDER BY ts DESC
    `),
    insertComparison: db.prepare(`
        INSERT INTO ml_decision_outcome_comparisons (
            user_id, resolved_env, comparison_id, judgment_id,
            outcome_quality_score, outcome_label,
            decision_quality_at_judgment, gap_score,
            interpretation, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectComparison: db.prepare(`
        SELECT id, comparison_id AS comparisonId, judgment_id AS judgmentId,
               outcome_quality_score AS outcomeQualityScore,
               outcome_label AS outcomeLabel,
               decision_quality_at_judgment AS decisionQualityAtJudgment,
               gap_score AS gapScore,
               interpretation, ts
        FROM ml_decision_outcome_comparisons
        WHERE comparison_id = ?
    `),
    selectLatestComparison: db.prepare(`
        SELECT id, comparison_id AS comparisonId, judgment_id AS judgmentId,
               outcome_quality_score AS outcomeQualityScore,
               outcome_label AS outcomeLabel,
               decision_quality_at_judgment AS decisionQualityAtJudgment,
               gap_score AS gapScore,
               interpretation, ts
        FROM ml_decision_outcome_comparisons
        WHERE user_id = ? AND resolved_env = ? AND judgment_id = ?
        ORDER BY ts DESC
        LIMIT 1
    `)
};

function recordBlindJudgment(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const judgmentId = _required(params, 'judgmentId');
    const decisionId = _required(params, 'decisionId');
    const axes = _required(params, 'axes');
    const ts = _required(params, 'ts');
    const lockedPreOutcome = params.lockedPreOutcome === false ? 0 : 1;
    const judgeReasoning = params.judgeReasoning ?? null;

    if (_stmts.selectJudgment.get(judgmentId)) {
        throw new Error(`§154 duplicate judgmentId: ${judgmentId}`);
    }

    const { composite } = computeDecisionQuality({ axes });
    const { classification } = classifyDecision({ compositeScore: composite });

    _stmts.insertJudgment.run(
        userId, resolvedEnv, judgmentId, decisionId,
        axes.infoQuality, axes.thesisIntegrity,
        axes.riskAppropriateness, axes.executionAppropriateness,
        axes.reversibility, axes.opportunityRanking,
        composite, classification,
        lockedPreOutcome, judgeReasoning, ts
    );

    return {
        recorded: true,
        judgmentId, decisionId,
        compositeScore: composite,
        classification,
        lockedPreOutcome
    };
}

function recordOutcomeComparison(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const comparisonId = _required(params, 'comparisonId');
    const judgmentId = _required(params, 'judgmentId');
    const outcomeQualityScore = _required(params, 'outcomeQualityScore');
    const outcomeLabel = _required(params, 'outcomeLabel');
    const ts = _required(params, 'ts');

    if (!OUTCOME_LABELS.includes(outcomeLabel)) {
        throw new Error(`§154 invalid outcomeLabel: ${outcomeLabel}`);
    }
    _requireRange01('outcomeQualityScore', outcomeQualityScore);
    if (_stmts.selectComparison.get(comparisonId)) {
        throw new Error(`§154 duplicate comparisonId: ${comparisonId}`);
    }

    const judgment = _stmts.selectJudgment.get(judgmentId);
    if (!judgment) {
        throw new Error(`§154 judgment not found: ${judgmentId}`);
    }
    const decisionQuality = judgment.compositeDecisionQuality;

    const { interpretation, gap } = interpretComparison({
        decisionQuality,
        outcomeQuality: outcomeQualityScore
    });

    _stmts.insertComparison.run(
        userId, resolvedEnv, comparisonId, judgmentId,
        outcomeQualityScore, outcomeLabel,
        decisionQuality, gap, interpretation, ts
    );

    return {
        recorded: true,
        comparisonId, judgmentId,
        decisionQualityAtJudgment: decisionQuality,
        outcomeQualityScore, outcomeLabel,
        gapScore: gap, interpretation
    };
}

function getBlindJudgments(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const decisionId = params.decisionId;
    return decisionId
        ? _stmts.selectJudgmentsByDecision.all(userId, resolvedEnv, decisionId)
        : _stmts.selectAllJudgments.all(userId, resolvedEnv);
}

function getLatestComparison(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const judgmentId = _required(params, 'judgmentId');
    const row = _stmts.selectLatestComparison.get(userId, resolvedEnv, judgmentId);
    return row || null;
}

module.exports = {
    // constants
    DECISION_AXES,
    DECISION_CLASSIFICATIONS,
    OUTCOME_LABELS,
    INTERPRETATIONS,
    DECISION_THRESHOLDS,
    ALIGNED_GAP_MAX,
    GOOD_OUTCOME_THRESHOLD,
    // pure
    computeDecisionQuality,
    classifyDecision,
    computeOutcomeGap,
    interpretComparison,
    // DB
    recordBlindJudgment,
    recordOutcomeComparison,
    getBlindJudgments,
    getLatestComparison
};

// FILE END §154 outcomeBlindPolicyJudge.js
