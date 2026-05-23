'use strict';

/**
 * OMEGA _meta — epistemicHumilityGovernor (canonical §135)
 *
 * §135 EPISTEMIC HUMILITY GOVERNOR / RIGHT-TO-BE-BOLD ENGINE.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 3954-3996.
 *
 * "Nu orice claritate locala da dreptul la indrazneala. Sistemul trebuie
 *  sa aiba un guvernator care decide cand are cu adevarat dreptul sa fie
 *  agresiv... un setup poate avea scor mare DAR daca unknowns sunt multe,
 *  self-model este degradat, confidence-of-confidence este slab, consensul
 *  este dependent, representation debt este mare, atunci agresivitatea
 *  devine nejustificata epistemic... humility score + boldness permission
 *  logic + combinare intre confidence + confidence-of-confidence +
 *  competence map + unknowns debt + false consensus penalty + self-model
 *  health + tension field + distinctie intre am voie sa fiu bold / am
 *  voie sa fiu doar moderat / trebuie sa raman umil-observator..."
 *
 * §135 = INTEGRATIVE aggregator. Combines outputs of §126 secondOrder
 * Uncertainty (confidence_of_confidence) + §122 selfModel (competence) +
 * §120 unknownsRegistry (unknowns_debt) + §128 falseConsensusDetector
 * (false_consensus_penalty) + §134 representationDebtTracker (representation
 * _debt) + §125 epistemicTensionField (tension_field_level) + primary
 * confidence into a single 3-state policy decision + size multiplier.
 * Does NOT duplicate any input module — only aggregates.
 */

const { db } = require('../../database');

const BOLDNESS_PERMISSIONS = Object.freeze([
    'humble_observer', 'moderate', 'bold'
]);
const PERMISSION_THRESHOLDS = Object.freeze({
    bold: 0.70,
    moderate: 0.40
});

// Weights sum to 1.0. "Debt-like" inputs are inverted (1 − value) before
// weighting so that high debt → low contribution to humility-eligibility.
const INPUT_WEIGHTS = Object.freeze({
    primary_confidence: 0.20,
    confidence_of_confidence: 0.20,
    competence_score: 0.15,
    unknowns_debt: 0.10,            // inverted
    false_consensus_penalty: 0.10,  // inverted
    representation_debt: 0.15,      // inverted
    tension_field_level: 0.10       // inverted
});

const SIZE_MULTIPLIERS = Object.freeze({
    humble_observer: 0.0,
    moderate: 0.5,
    bold: 1.0
});

const _INPUT_KEYS = [
    'primaryConfidence', 'confidenceOfConfidence', 'competenceScore',
    'unknownsDebt', 'falseConsensusPenalty', 'representationDebt',
    'tensionFieldLevel'
];

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`epistemicHumilityGovernor: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertAssessment: db.prepare(`
        INSERT INTO ml_humility_assessments
        (user_id, resolved_env, assessment_id, decision_id,
         primary_confidence, confidence_of_confidence,
         competence_score, unknowns_debt, false_consensus_penalty,
         representation_debt, tension_field_level,
         humility_score, boldness_permission, size_multiplier, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    latestByDecision: db.prepare(`
        SELECT * FROM ml_humility_assessments
        WHERE user_id = ? AND resolved_env = ? AND decision_id = ?
        ORDER BY ts DESC LIMIT 1
    `),
    listAll: db.prepare(`
        SELECT * FROM ml_humility_assessments
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC LIMIT ?
    `),
    listByPermission: db.prepare(`
        SELECT * FROM ml_humility_assessments
        WHERE user_id = ? AND resolved_env = ?
          AND boldness_permission = ?
        ORDER BY ts DESC LIMIT ?
    `),
    distribution: db.prepare(`
        SELECT boldness_permission, COUNT(*) AS cnt
        FROM ml_humility_assessments
        WHERE user_id = ? AND resolved_env = ? AND ts >= ?
        GROUP BY boldness_permission
    `)
};

// ── validateInputs (pure) ──────────────────────────────────────────
function validateInputs(params) {
    for (const k of _INPUT_KEYS) {
        if (!params || params[k] === undefined || params[k] === null) {
            throw new Error(`epistemicHumilityGovernor: missing ${k}`);
        }
        const v = params[k];
        if (v < 0 || v > 1) {
            throw new Error(
                `epistemicHumilityGovernor: ${k} must be in [0,1], got ${v}`
            );
        }
    }
    return { valid: true };
}

// ── computeHumilityScore (pure) ────────────────────────────────────
// Weighted sum. Positive inputs contribute directly; debt-like inputs
// contribute (1 - value). Sum of all weighted values is the humility score.
function computeHumilityScore(params) {
    validateInputs(params);
    const W = INPUT_WEIGHTS;
    const positive =
        params.primaryConfidence    * W.primary_confidence +
        params.confidenceOfConfidence * W.confidence_of_confidence +
        params.competenceScore      * W.competence_score;
    const inverted =
        (1 - params.unknownsDebt)           * W.unknowns_debt +
        (1 - params.falseConsensusPenalty)  * W.false_consensus_penalty +
        (1 - params.representationDebt)     * W.representation_debt +
        (1 - params.tensionFieldLevel)      * W.tension_field_level;
    const raw = positive + inverted;
    return { humilityScore: Math.max(0, Math.min(1, raw)) };
}

// ── classifyBoldnessPermission (pure) ──────────────────────────────
function classifyBoldnessPermission(params) {
    const score = _required(params, 'humilityScore');
    if (score < 0 || score > 1) {
        throw new Error(
            'epistemicHumilityGovernor: humilityScore must be in [0,1]'
        );
    }
    let permission;
    if (score >= PERMISSION_THRESHOLDS.bold) permission = 'bold';
    else if (score >= PERMISSION_THRESHOLDS.moderate) permission = 'moderate';
    else permission = 'humble_observer';
    return { boldnessPermission: permission, humilityScore: score };
}

// ── computeSizeMultiplier (pure) ───────────────────────────────────
function computeSizeMultiplier(params) {
    const permission = _required(params, 'boldnessPermission');
    if (!BOLDNESS_PERMISSIONS.includes(permission)) {
        throw new Error(
            `epistemicHumilityGovernor: invalid boldnessPermission "${permission}"`
        );
    }
    return {
        sizeMultiplier: SIZE_MULTIPLIERS[permission],
        boldnessPermission: permission
    };
}

// ── recordHumilityAssessment (integration) ─────────────────────────
function recordHumilityAssessment(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const assessmentId = _required(params, 'assessmentId');
    const decisionId = _required(params, 'decisionId');
    const ts = (params && params.ts) ? params.ts : Date.now();

    // validateInputs throws if any of the 7 inputs missing or out-of-range
    validateInputs(params);

    const { humilityScore } = computeHumilityScore(params);
    const { boldnessPermission } = classifyBoldnessPermission({
        humilityScore
    });
    const { sizeMultiplier } = computeSizeMultiplier({
        boldnessPermission
    });

    try {
        _stmts.insertAssessment.run(
            userId, env, assessmentId, decisionId,
            params.primaryConfidence,
            params.confidenceOfConfidence,
            params.competenceScore,
            params.unknownsDebt,
            params.falseConsensusPenalty,
            params.representationDebt,
            params.tensionFieldLevel,
            humilityScore, boldnessPermission,
            sizeMultiplier, ts
        );
        return {
            recorded: true, assessmentId,
            humilityScore, boldnessPermission,
            sizeMultiplier
        };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `epistemicHumilityGovernor: duplicate assessmentId "${assessmentId}"`
            );
        }
        throw err;
    }
}

function _rowToAssessment(r) {
    return {
        assessmentId: r.assessment_id,
        decisionId: r.decision_id,
        primaryConfidence: r.primary_confidence,
        confidenceOfConfidence: r.confidence_of_confidence,
        competenceScore: r.competence_score,
        unknownsDebt: r.unknowns_debt,
        falseConsensusPenalty: r.false_consensus_penalty,
        representationDebt: r.representation_debt,
        tensionFieldLevel: r.tension_field_level,
        humilityScore: r.humility_score,
        boldnessPermission: r.boldness_permission,
        sizeMultiplier: r.size_multiplier,
        ts: r.ts
    };
}

// ── getAssessmentForDecision ───────────────────────────────────────
function getAssessmentForDecision(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const decisionId = _required(params, 'decisionId');
    const r = _stmts.latestByDecision.get(userId, env, decisionId);
    if (!r) return null;
    return _rowToAssessment(r);
}

// ── getAssessmentHistory ───────────────────────────────────────────
function getAssessmentHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const permissionFilter = params && params.permissionFilter;
    const limit = (params && params.limit) ? params.limit : 100;

    if (permissionFilter && !BOLDNESS_PERMISSIONS.includes(permissionFilter)) {
        throw new Error(
            `epistemicHumilityGovernor: invalid permissionFilter "${permissionFilter}"`
        );
    }
    const rows = permissionFilter
        ? _stmts.listByPermission.all(userId, env, permissionFilter, limit)
        : _stmts.listAll.all(userId, env, limit);
    return rows.map(_rowToAssessment);
}

// ── getPermissionDistribution ──────────────────────────────────────
function getPermissionDistribution(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const sinceTs = (params && params.sinceTs !== undefined)
        ? params.sinceTs : 0;
    const rows = _stmts.distribution.all(userId, env, sinceTs);
    const dist = {};
    for (const r of rows) {
        dist[r.boldness_permission] = r.cnt;
    }
    return dist;
}

module.exports = {
    BOLDNESS_PERMISSIONS,
    PERMISSION_THRESHOLDS,
    INPUT_WEIGHTS,
    SIZE_MULTIPLIERS,
    validateInputs,
    computeHumilityScore,
    classifyBoldnessPermission,
    computeSizeMultiplier,
    recordHumilityAssessment,
    getAssessmentForDecision,
    getAssessmentHistory,
    getPermissionDistribution
};
