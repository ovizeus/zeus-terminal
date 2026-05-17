'use strict';

/**
 * OMEGA Wave 3 §169 — MODAL STABILITY TEST / NEARBY-POSSIBLE-WORLDS ENDORSEMENT.
 *
 * Canonical PDF §169 (ml_brain_canonic.txt lines 5568-5618).
 *
 * "as mai aproba aceasta decizie daca lumea reala ar fi aproape la fel,
 *  dar nu exact identica?"
 *
 * 4 verdict classes (PDF lines 5589-5593):
 *   stable_across_nearby_worlds — score >= 0.85
 *   moderately_fragile          — score >= 0.60
 *   edge_on_a_knife             — score >= 0.40
 *   world_specific              — score < 0.40 (too brittle)
 *
 * 5 recommended actions (PDF lines 5610-5614):
 *   proceed         — stable
 *   size_reduced    — moderately_fragile
 *   progressive     — edge_on_a_knife (incremental commitment)
 *   wait            — edge_on_a_knife alt
 *   observer        — world_specific (do not act)
 *
 * Boldness adjustment map per verdict (multiplier on size/aggression):
 *   stable: 1.0  | moderate: 0.70 | edge: 0.40 | world_specific: 0.10
 *
 * Per canonical rule 5608: alternative worlds MUST be compatible with
 * info available at time of decision (caller-responsibility — module
 * takes endorsement count, doesn't generate worlds).
 *
 * Plasare R2_cognition pentru integrare cu OOD (§69), conformal (§67),
 * uncertainty propagation, boundary phenomenology (§165 register).
 *
 * Per-(user × resolved_env) isolated. Server-only.
 */

const { db } = require('../../database');

const VERDICT_CLASSES = Object.freeze([
    'stable_across_nearby_worlds',
    'moderately_fragile',
    'edge_on_a_knife',
    'world_specific'
]);
const RECOMMENDED_ACTIONS = Object.freeze([
    'proceed', 'size_reduced', 'progressive', 'wait', 'observer'
]);

const STABILITY_THRESHOLDS = Object.freeze({
    stable: 0.85, moderate: 0.60, edge: 0.40
});

const BOLDNESS_ADJUSTMENT_MAP = Object.freeze({
    stable_across_nearby_worlds: 1.0,
    moderately_fragile: 0.70,
    edge_on_a_knife: 0.40,
    world_specific: 0.10
});

const VERDICT_TO_ACTION = Object.freeze({
    stable_across_nearby_worlds: 'proceed',
    moderately_fragile: 'size_reduced',
    edge_on_a_knife: 'progressive',  // canonical preference; caller may opt 'wait'
    world_specific: 'observer'
});

const MIN_WORLDS_TESTED = 5;

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

function _required(params, key) {
    if (params == null || params[key] == null) {
        throw new Error(`§169 missing required param: ${key}`);
    }
    return params[key];
}
function _requireEnv(env) {
    if (!RESOLVED_ENVS.has(env)) {
        throw new Error(`§169 invalid resolvedEnv: ${env}`);
    }
    return env;
}

// ──────────────────────────────────────────────────────────────────────────
// PURE FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

function computeStabilityScore(params) {
    const endorsementCount = _required(params, 'endorsementCount');
    const numWorldsTested = _required(params, 'numWorldsTested');
    if (typeof endorsementCount !== 'number' || endorsementCount < 0) {
        throw new Error('§169 endorsementCount must be non-negative number');
    }
    if (typeof numWorldsTested !== 'number' || numWorldsTested < MIN_WORLDS_TESTED) {
        throw new Error(`§169 insufficient nearby worlds tested: ${numWorldsTested} < MIN_WORLDS_TESTED=${MIN_WORLDS_TESTED}`);
    }
    if (endorsementCount > numWorldsTested) {
        throw new Error(`§169 endorsementCount (${endorsementCount}) exceeds numWorldsTested (${numWorldsTested})`);
    }
    const score = endorsementCount / numWorldsTested;
    return { stabilityScore: Math.max(0, Math.min(1, score)) };
}

function classifyVerdict(params) {
    const stabilityScore = _required(params, 'stabilityScore');
    if (typeof stabilityScore !== 'number' || stabilityScore < 0 || stabilityScore > 1) {
        throw new Error(`§169 stabilityScore must be in [0,1], got ${stabilityScore}`);
    }
    if (stabilityScore >= STABILITY_THRESHOLDS.stable) {
        return { verdict: 'stable_across_nearby_worlds' };
    }
    if (stabilityScore >= STABILITY_THRESHOLDS.moderate) {
        return { verdict: 'moderately_fragile' };
    }
    if (stabilityScore >= STABILITY_THRESHOLDS.edge) {
        return { verdict: 'edge_on_a_knife' };
    }
    return { verdict: 'world_specific' };
}

function recommendAction(params) {
    const verdict = _required(params, 'verdict');
    if (!VERDICT_CLASSES.includes(verdict)) {
        throw new Error(`§169 invalid verdict: ${verdict}`);
    }
    return { action: VERDICT_TO_ACTION[verdict] };
}

function computeBoldnessAdjustment(params) {
    const verdict = _required(params, 'verdict');
    if (!VERDICT_CLASSES.includes(verdict)) {
        throw new Error(`§169 invalid verdict: ${verdict}`);
    }
    return { adjustment: BOLDNESS_ADJUSTMENT_MAP[verdict] };
}

// ──────────────────────────────────────────────────────────────────────────
// DB-BOUND FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

const _stmts = {
    insertEval: db.prepare(`
        INSERT INTO ml_modal_stability_evaluations (
            user_id, resolved_env, evaluation_id, decision_id,
            num_nearby_worlds_tested, endorsement_count, stability_score,
            verdict, boldness_adjustment, recommended_action, reasoning, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectEval: db.prepare(`
        SELECT id, evaluation_id AS evaluationId, decision_id AS decisionId,
               num_nearby_worlds_tested AS numWorldsTested,
               endorsement_count AS endorsementCount,
               stability_score AS stabilityScore,
               verdict, boldness_adjustment AS boldnessAdjustment,
               recommended_action AS recommendedAction,
               reasoning, ts
        FROM ml_modal_stability_evaluations
        WHERE evaluation_id = ?
    `),
    selectAllRecent: db.prepare(`
        SELECT id, evaluation_id AS evaluationId, decision_id AS decisionId,
               num_nearby_worlds_tested AS numWorldsTested,
               endorsement_count AS endorsementCount,
               stability_score AS stabilityScore,
               verdict, boldness_adjustment AS boldnessAdjustment,
               recommended_action AS recommendedAction,
               reasoning, ts
        FROM ml_modal_stability_evaluations
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
    `),
    selectByVerdict: db.prepare(`
        SELECT id, evaluation_id AS evaluationId, decision_id AS decisionId,
               num_nearby_worlds_tested AS numWorldsTested,
               endorsement_count AS endorsementCount,
               stability_score AS stabilityScore,
               verdict, boldness_adjustment AS boldnessAdjustment,
               recommended_action AS recommendedAction,
               reasoning, ts
        FROM ml_modal_stability_evaluations
        WHERE user_id = ? AND resolved_env = ? AND verdict = ?
        ORDER BY ts DESC
    `),
    countByVerdict: db.prepare(`
        SELECT verdict, COUNT(*) AS count
        FROM ml_modal_stability_evaluations
        WHERE user_id = ? AND resolved_env = ? AND ts >= ?
        GROUP BY verdict
    `)
};

function recordModalStabilityEvaluation(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const evaluationId = _required(params, 'evaluationId');
    const decisionId = _required(params, 'decisionId');
    const numWorldsTested = _required(params, 'numWorldsTested');
    const endorsementCount = _required(params, 'endorsementCount');
    const ts = _required(params, 'ts');
    const reasoning = params.reasoning ?? null;

    if (_stmts.selectEval.get(evaluationId)) {
        throw new Error(`§169 duplicate evaluationId: ${evaluationId}`);
    }

    const { stabilityScore } = computeStabilityScore({
        endorsementCount, numWorldsTested
    });
    const { verdict } = classifyVerdict({ stabilityScore });
    const { action: recommendedAction } = recommendAction({ verdict });
    const { adjustment: boldnessAdjustment } = computeBoldnessAdjustment({ verdict });

    _stmts.insertEval.run(
        userId, resolvedEnv, evaluationId, decisionId,
        numWorldsTested, endorsementCount, stabilityScore,
        verdict, boldnessAdjustment, recommendedAction, reasoning, ts
    );

    return {
        recorded: true,
        evaluationId, decisionId,
        stabilityScore, verdict,
        recommendedAction, boldnessAdjustment
    };
}

function getRecentEvaluations(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const verdict = params.verdict;
    if (verdict !== undefined && !VERDICT_CLASSES.includes(verdict)) {
        throw new Error(`§169 invalid verdict filter: ${verdict}`);
    }
    return verdict
        ? _stmts.selectByVerdict.all(userId, resolvedEnv, verdict)
        : _stmts.selectAllRecent.all(userId, resolvedEnv);
}

function countByVerdict(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const sinceTs = _required(params, 'sinceTs');
    const rows = _stmts.countByVerdict.all(userId, resolvedEnv, sinceTs);
    const stats = {
        stable_across_nearby_worlds: 0,
        moderately_fragile: 0,
        edge_on_a_knife: 0,
        world_specific: 0,
        totalCount: 0
    };
    for (const r of rows) {
        stats[r.verdict] = r.count;
        stats.totalCount += r.count;
    }
    return stats;
}

module.exports = {
    // constants
    VERDICT_CLASSES,
    RECOMMENDED_ACTIONS,
    STABILITY_THRESHOLDS,
    BOLDNESS_ADJUSTMENT_MAP,
    MIN_WORLDS_TESTED,
    // pure
    computeStabilityScore,
    classifyVerdict,
    recommendAction,
    computeBoldnessAdjustment,
    // DB
    recordModalStabilityEvaluation,
    getRecentEvaluations,
    countByVerdict
};

// FILE END §169 modalStabilityTest.js
