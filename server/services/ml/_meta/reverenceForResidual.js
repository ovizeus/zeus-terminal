'use strict';

/**
 * OMEGA §201 — REVERENCE FOR THE RESIDUAL / THE WORLD-OWES-ME-NO-FIT LAYER.
 * Canonical PDF lines 6469-6518.
 */

const { db } = require('../../database');

const POSTURES = Object.freeze([
    'continue', 'observe', 'retreat', 'reduce_pretension'
]);

const ENTITLEMENT_THRESHOLD = 0.50;
const FORCING_THRESHOLD = 0.40;

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

function _required(p, k) {
    if (p == null || p[k] == null) throw new Error(`§201 missing param: ${k}`);
    return p[k];
}
function _requireEnv(env) {
    if (!RESOLVED_ENVS.has(env)) throw new Error(`§201 invalid env: ${env}`);
    return env;
}
function _requireRange01(name, v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`§201 ${name} must be in [0,1]`);
    }
}

function detectEntitlement(params) {
    const fitFrustration = _required(params, 'fitFrustrationLevel');
    _requireRange01('fitFrustrationLevel', fitFrustration);
    return { entitlementDetected: fitFrustration >= ENTITLEMENT_THRESHOLD ? 1 : 0 };
}

function detectForcingAttempt(params) {
    const modelForcingPressure = _required(params, 'modelForcingPressure');
    _requireRange01('modelForcingPressure', modelForcingPressure);
    return { forcingDetected: modelForcingPressure >= FORCING_THRESHOLD ? 1 : 0 };
}

function recommendPosture(params) {
    const entitlement = _required(params, 'entitlementDetected');
    const forcing = _required(params, 'forcingDetected');
    const reverence = _required(params, 'reverenceScore');
    _requireRange01('reverenceScore', reverence);
    if (forcing === 1) return { posture: 'retreat' };
    if (entitlement === 1) return { posture: 'reduce_pretension' };
    if (reverence < 0.30) return { posture: 'observe' };
    return { posture: 'continue' };
}

const _stmts = {
    insert: db.prepare(`
        INSERT INTO ml_residual_reverence_assessments (
            user_id, resolved_env, assessment_id, residual_label,
            reverence_score, entitlement_to_fit_detected,
            forcing_attempt_detected, recommended_posture,
            reasoning, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectById: db.prepare(`SELECT * FROM ml_residual_reverence_assessments WHERE assessment_id = ?`),
    selectAll: db.prepare(`
        SELECT id, assessment_id AS assessmentId, residual_label AS residualLabel,
               reverence_score AS reverenceScore,
               entitlement_to_fit_detected AS entitlementToFitDetected,
               forcing_attempt_detected AS forcingAttemptDetected,
               recommended_posture AS recommendedPosture,
               reasoning, ts
        FROM ml_residual_reverence_assessments
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
    `)
};

function recordReverenceAssessment(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const assessmentId = _required(params, 'assessmentId');
    const residualLabel = _required(params, 'residualLabel');
    const reverenceScore = _required(params, 'reverenceScore');
    const fitFrustrationLevel = _required(params, 'fitFrustrationLevel');
    const modelForcingPressure = _required(params, 'modelForcingPressure');
    const ts = _required(params, 'ts');
    const reasoning = params.reasoning ?? null;

    if (_stmts.selectById.get(assessmentId)) {
        throw new Error(`§201 duplicate assessmentId: ${assessmentId}`);
    }

    const { entitlementDetected } = detectEntitlement({ fitFrustrationLevel });
    const { forcingDetected } = detectForcingAttempt({ modelForcingPressure });
    const { posture: recommendedPosture } = recommendPosture({
        entitlementDetected, forcingDetected, reverenceScore
    });

    _stmts.insert.run(
        userId, resolvedEnv, assessmentId, residualLabel,
        reverenceScore, entitlementDetected, forcingDetected,
        recommendedPosture, reasoning, ts
    );

    return {
        recorded: true, assessmentId,
        entitlementToFitDetected: entitlementDetected,
        forcingAttemptDetected: forcingDetected,
        recommendedPosture
    };
}

function getRecentAssessments(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    return _stmts.selectAll.all(userId, resolvedEnv);
}

module.exports = {
    POSTURES,
    ENTITLEMENT_THRESHOLD,
    FORCING_THRESHOLD,
    detectEntitlement,
    detectForcingAttempt,
    recommendPosture,
    recordReverenceAssessment,
    getRecentAssessments
};
