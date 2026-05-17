'use strict';

/**
 * OMEGA §209 — GRACEFUL OBSOLESCENCE COVENANT / RIGHT-TO-SUNSET.
 * Canonical PDF lines 6629-6672.
 */

const { db } = require('../../database');

const SUNSET_THRESHOLD = 0.70;
const AGING_SIGNALS = Object.freeze([
    'excessPatchesScore', 'ontologicalDebtScore',
    'defensiveConservationScore', 'lowEpistemicIntakeScore'
]);

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

function _required(p, k) {
    if (p == null || p[k] == null) throw new Error(`§209 missing param: ${k}`);
    return p[k];
}
function _requireEnv(env) {
    if (!RESOLVED_ENVS.has(env)) throw new Error(`§209 invalid env: ${env}`);
    return env;
}
function _requireRange01(name, v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`§209 ${name} must be in [0,1]`);
    }
}

function computeObsolescenceScore(params) {
    let sum = 0;
    for (const s of AGING_SIGNALS) {
        if (params[s] === undefined) throw new Error(`§209 missing signal: ${s}`);
        _requireRange01(s, params[s]);
        sum += params[s];
    }
    return { obsolescenceScore: Math.max(0, Math.min(1, sum / AGING_SIGNALS.length)) };
}

function recommendSunset(params) {
    const score = _required(params, 'obsolescenceScore');
    _requireRange01('obsolescenceScore', score);
    return { sunsetRecommended: score >= SUNSET_THRESHOLD ? 1 : 0 };
}

const _stmts = {
    insert: db.prepare(`
        INSERT INTO ml_graceful_obsolescence_assessments (
            user_id, resolved_env, assessment_id, self_version_label,
            excess_patches_score, ontological_debt_score,
            defensive_conservation_score, low_epistemic_intake_score,
            obsolescence_score, sunset_recommended,
            legacy_extraction_text, reasoning, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectById: db.prepare(`SELECT * FROM ml_graceful_obsolescence_assessments WHERE assessment_id = ?`),
    selectAll: db.prepare(`
        SELECT id, assessment_id AS assessmentId,
               self_version_label AS selfVersionLabel,
               obsolescence_score AS obsolescenceScore,
               sunset_recommended AS sunsetRecommended,
               legacy_extraction_text AS legacyExtractionText, ts
        FROM ml_graceful_obsolescence_assessments
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
    `)
};

function recordAssessment(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const assessmentId = _required(params, 'assessmentId');
    const selfVersionLabel = _required(params, 'selfVersionLabel');
    const excessPatchesScore = _required(params, 'excessPatchesScore');
    const ontologicalDebtScore = _required(params, 'ontologicalDebtScore');
    const defensiveConservationScore = _required(params, 'defensiveConservationScore');
    const lowEpistemicIntakeScore = _required(params, 'lowEpistemicIntakeScore');
    const ts = _required(params, 'ts');
    const legacyExtractionText = params.legacyExtractionText ?? null;
    const reasoning = params.reasoning ?? null;

    if (_stmts.selectById.get(assessmentId)) {
        throw new Error(`§209 duplicate assessmentId: ${assessmentId}`);
    }

    const { obsolescenceScore } = computeObsolescenceScore({
        excessPatchesScore, ontologicalDebtScore,
        defensiveConservationScore, lowEpistemicIntakeScore
    });
    const { sunsetRecommended } = recommendSunset({ obsolescenceScore });

    _stmts.insert.run(
        userId, resolvedEnv, assessmentId, selfVersionLabel,
        excessPatchesScore, ontologicalDebtScore,
        defensiveConservationScore, lowEpistemicIntakeScore,
        obsolescenceScore, sunsetRecommended,
        legacyExtractionText, reasoning, ts
    );

    return {
        recorded: true, assessmentId,
        obsolescenceScore, sunsetRecommended
    };
}

function getRecentAssessments(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    return _stmts.selectAll.all(userId, resolvedEnv);
}

module.exports = {
    SUNSET_THRESHOLD, AGING_SIGNALS,
    computeObsolescenceScore, recommendSunset,
    recordAssessment, getRecentAssessments
};
