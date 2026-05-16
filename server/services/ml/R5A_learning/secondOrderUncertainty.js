'use strict';

/**
 * OMEGA R5A Learning — secondOrderUncertainty (canonical §126)
 *
 * §126 SECOND-ORDER UNCERTAINTY / CONFIDENCE-OF-CONFIDENCE ENGINE.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 3554-3605.
 *
 * "Nu este suficient ca botul sa spuna 'am confidence 74%'. Trebuie sa
 *  poata spune si 'cat de mult am incredere in propriul meu estimator
 *  de confidence chiar acum?'... second-order uncertainty score...
 *  confidence-of-confidence estimate... distinctie: high_conf_robust /
 *  high_conf_fragile / low_conf_robust / low_conf_noisy... penalizare
 *  pentru deciziile unde estimatorul de incertitudine este el insusi
 *  nesigur... 'cat de mult am voie sa cred in propriul meu confidence?'...
 *  confidence mare fara confidence-of-confidence suficient NU primeste
 *  autoritate maxima."
 *
 * Distinct from §20 calibration (history), §92 uncertaintyPropagation
 * (first-order pipeline), §15 confidenceDecay (time), §122 selfModel
 * (module trust). §126 = meta-uncertainty (uncertainty about uncertainty).
 */

const { db } = require('../../database');

const QUADRANTS = Object.freeze([
    'high_conf_robust', 'high_conf_fragile',
    'low_conf_robust', 'low_conf_noisy'
]);
const RECOMMENDED_ACTIONS = Object.freeze([
    'proceed', 'size_reduce', 'wait',
    'active_sensing', 'observer'
]);

const HIGH_CONFIDENCE_THRESHOLD = 0.65;
const ROBUST_THRESHOLD = 0.60;
const HIGH_DRIFT_THRESHOLD = 0.50;

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`secondOrderUncertainty: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertAssessment: db.prepare(`
        INSERT INTO ml_confidence_assessments
        (user_id, resolved_env, assessment_id, decision_id,
         primary_confidence, confidence_of_confidence,
         calibration_reliability, local_drift, quadrant,
         penalized_confidence, recommended_action, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listAssessments: db.prepare(`
        SELECT * FROM ml_confidence_assessments
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC LIMIT ?
    `),
    listByQuadrant: db.prepare(`
        SELECT * FROM ml_confidence_assessments
        WHERE user_id = ? AND resolved_env = ? AND quadrant = ?
        ORDER BY ts DESC LIMIT ?
    `),
    insertDrift: db.prepare(`
        INSERT INTO ml_calibration_drift_audit
        (user_id, resolved_env, audit_id, assessment_id,
         drift_source, drift_magnitude, notes, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
};

// ── classifyQuadrant (pure) ────────────────────────────────────────
function classifyQuadrant(params) {
    const primary = _required(params, 'primaryConfidence');
    const confOfConf = _required(params, 'confidenceOfConfidence');
    const highT = (params && params.highThreshold !== undefined)
        ? params.highThreshold : HIGH_CONFIDENCE_THRESHOLD;
    const robustT = (params && params.robustThreshold !== undefined)
        ? params.robustThreshold : ROBUST_THRESHOLD;
    for (const [k, v] of [['primaryConfidence', primary],
                           ['confidenceOfConfidence', confOfConf]]) {
        if (v < 0 || v > 1) {
            throw new Error(`secondOrderUncertainty: ${k} must be in [0,1]`);
        }
    }
    const isHigh = primary >= highT;
    const isRobust = confOfConf >= robustT;
    let quadrant;
    if (isHigh && isRobust) quadrant = 'high_conf_robust';
    else if (isHigh && !isRobust) quadrant = 'high_conf_fragile';
    else if (!isHigh && isRobust) quadrant = 'low_conf_robust';
    else quadrant = 'low_conf_noisy';
    return { quadrant, primary, confOfConf };
}

// ── applyPenalty (pure) ────────────────────────────────────────────
// penalized = primary × confOfConf × calibrationReliability
function applyPenalty(params) {
    const primary = _required(params, 'primaryConfidence');
    const confOfConf = _required(params, 'confidenceOfConfidence');
    const reliability = _required(params, 'calibrationReliability');
    for (const [k, v] of [['primaryConfidence', primary],
                           ['confidenceOfConfidence', confOfConf],
                           ['calibrationReliability', reliability]]) {
        if (v < 0 || v > 1) {
            throw new Error(`secondOrderUncertainty: ${k} must be in [0,1]`);
        }
    }
    const penalized = primary * confOfConf * reliability;
    return {
        penalizedConfidence: Math.max(0, Math.min(1, penalized)),
        primary, confOfConf, reliability
    };
}

// ── selectRecommendedAction (pure) ─────────────────────────────────
function selectRecommendedAction(params) {
    const quadrant = _required(params, 'quadrant');
    if (!QUADRANTS.includes(quadrant)) {
        throw new Error(`secondOrderUncertainty: invalid quadrant "${quadrant}"`);
    }
    const localDrift = (params && params.localDrift !== undefined)
        ? params.localDrift : 0;

    let action;
    let reason;
    switch (quadrant) {
        case 'high_conf_robust':
            action = 'proceed';
            reason = 'high_confidence_robust_estimator';
            break;
        case 'high_conf_fragile':
            // dangerous quadrant — confidence high but estimator fragile
            if (localDrift >= HIGH_DRIFT_THRESHOLD) {
                action = 'wait';
                reason = 'fragile_estimator_with_high_drift';
            } else {
                action = 'size_reduce';
                reason = 'fragile_estimator_reduce_size';
            }
            break;
        case 'low_conf_robust':
            action = 'active_sensing';
            reason = 'low_conf_but_we_know_it_so_seek_info';
            break;
        case 'low_conf_noisy':
            action = 'observer';
            reason = 'low_conf_noisy_estimator_observer_only';
            break;
        default:
            action = 'observer';
            reason = 'default_fallback';
    }
    return { action, quadrant, reason };
}

// ── assessConfidence ───────────────────────────────────────────────
function assessConfidence(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const assessmentId = _required(params, 'assessmentId');
    const decisionId = _required(params, 'decisionId');
    const primary = _required(params, 'primaryConfidence');
    const confOfConf = _required(params, 'confidenceOfConfidence');
    const reliability = _required(params, 'calibrationReliability');
    const localDrift = _required(params, 'localDrift');
    if (localDrift < 0 || localDrift > 1) {
        throw new Error('secondOrderUncertainty: localDrift must be in [0,1]');
    }
    const ts = (params && params.ts) ? params.ts : Date.now();

    const { quadrant } = classifyQuadrant({
        primaryConfidence: primary,
        confidenceOfConfidence: confOfConf
    });
    const { penalizedConfidence } = applyPenalty({
        primaryConfidence: primary,
        confidenceOfConfidence: confOfConf,
        calibrationReliability: reliability
    });
    const { action } = selectRecommendedAction({
        quadrant, localDrift
    });

    try {
        _stmts.insertAssessment.run(
            userId, env, assessmentId, decisionId,
            primary, confOfConf, reliability, localDrift,
            quadrant, penalizedConfidence, action, ts
        );
        return {
            assessed: true, assessmentId,
            quadrant, penalizedConfidence,
            recommendedAction: action
        };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `secondOrderUncertainty: duplicate assessmentId "${assessmentId}"`
            );
        }
        throw err;
    }
}

// ── recordCalibrationDrift ─────────────────────────────────────────
function recordCalibrationDrift(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const auditId = _required(params, 'auditId');
    const assessmentId = _required(params, 'assessmentId');
    const driftSource = _required(params, 'driftSource');
    const driftMagnitude = _required(params, 'driftMagnitude');
    if (driftMagnitude < 0 || driftMagnitude > 1) {
        throw new Error('secondOrderUncertainty: driftMagnitude must be in [0,1]');
    }
    const notes = (params && params.notes) ? params.notes : null;
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertDrift.run(
            userId, env, auditId, assessmentId,
            driftSource, driftMagnitude, notes, ts
        );
        return { recorded: true, auditId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`secondOrderUncertainty: duplicate auditId "${auditId}"`);
        }
        throw err;
    }
}

// ── getAssessmentHistory ───────────────────────────────────────────
function getAssessmentHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const quadrantFilter = params && params.quadrantFilter;
    const limit = (params && params.limit) ? params.limit : 100;

    if (quadrantFilter && !QUADRANTS.includes(quadrantFilter)) {
        throw new Error(
            `secondOrderUncertainty: invalid quadrantFilter "${quadrantFilter}"`
        );
    }
    const rows = quadrantFilter
        ? _stmts.listByQuadrant.all(userId, env, quadrantFilter, limit)
        : _stmts.listAssessments.all(userId, env, limit);
    return rows.map(r => ({
        assessmentId: r.assessment_id,
        decisionId: r.decision_id,
        primaryConfidence: r.primary_confidence,
        confidenceOfConfidence: r.confidence_of_confidence,
        calibrationReliability: r.calibration_reliability,
        localDrift: r.local_drift,
        quadrant: r.quadrant,
        penalizedConfidence: r.penalized_confidence,
        recommendedAction: r.recommended_action,
        ts: r.ts
    }));
}

module.exports = {
    QUADRANTS,
    RECOMMENDED_ACTIONS,
    HIGH_CONFIDENCE_THRESHOLD,
    ROBUST_THRESHOLD,
    HIGH_DRIFT_THRESHOLD,
    classifyQuadrant,
    applyPenalty,
    selectRecommendedAction,
    assessConfidence,
    recordCalibrationDrift,
    getAssessmentHistory
};
