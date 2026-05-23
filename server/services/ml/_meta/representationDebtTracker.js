'use strict';

/**
 * OMEGA _meta — representationDebtTracker (canonical §134)
 *
 * §134 REPRESENTATION DEBT TRACKER / MAP-TERRITORY MISFIT ENGINE.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 3913-3953.
 *
 * "Sistemul poate continua sa functioneze cu harti interne care devin tot
 *  mai prost potrivite cu realitatea, fara sa se rupa instantaneu... se
 *  acumuleaza o datorie de reprezentare: realitatea devine mai bogata sau
 *  diferita decat harta interna... mismatch tracking intre concepte interne
 *  / regimuri clasificate / rezultate observate / explicatii generate +
 *  detectie a compresiei excesive / categoriilor fortate / conceptelor care
 *  explica prea putin cu prea multa incredere... 'harta mea despre piata
 *  incepe sa ramana in urma realitatii?'... justifica cand este nevoie de
 *  revizie de limbaj, nu doar de parametri."
 *
 * Distinct from §132 semanticGroundingCheck (concept anchoring NOW, runtime
 * check), §123 ontologyRevisionEngine (R5B — event-based revision), §114
 * conceptLibrary (R5A — semantic definitions), §120 unknownsRegistry (_meta
 * — gap inventory). §134 = cumulative drift score per representation kind,
 * tracks pattern of misfit (compression / forced cat / overconfident) +
 * outputs revision recommendation.
 */

const { db } = require('../../database');

const REPRESENTATION_KINDS = Object.freeze([
    'concept', 'regime', 'primitive',
    'explanation', 'ontology'
]);
const MISFIT_KINDS = Object.freeze([
    'no_misfit', 'compression_excessive',
    'forced_category', 'over_confident_under_explanatory'
]);
const DEBT_VERDICTS = Object.freeze([
    'healthy', 'accumulating', 'critical'
]);
const DEBT_THRESHOLDS = Object.freeze({
    critical: 0.70,
    accumulating: 0.40
});
const MIN_OBSERVATIONS_FOR_SNAPSHOT = 10;

const _NO_MISFIT_THRESHOLD = 0.20;
const _OVER_CONFIDENT_CONFIDENCE = 0.70;
const _LOW_EXPLANATORY = 0.30;
const _HIGH_EXPLANATORY = 0.70;
const _EPSILON = 1e-9;

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`representationDebtTracker: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertObservation: db.prepare(`
        INSERT INTO ml_representation_observations
        (user_id, resolved_env, observation_id, representation_kind,
         representation_id, predicted_outcome_json, actual_outcome_json,
         misfit_score, misfit_kind, prediction_confidence,
         explanatory_power, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listObsByKindSince: db.prepare(`
        SELECT * FROM ml_representation_observations
        WHERE user_id = ? AND resolved_env = ?
          AND representation_kind = ? AND ts >= ?
        ORDER BY ts ASC LIMIT ?
    `),
    listObsInWindow: db.prepare(`
        SELECT * FROM ml_representation_observations
        WHERE user_id = ? AND resolved_env = ?
          AND representation_kind = ?
          AND ts >= ? AND ts <= ?
    `),
    insertSnapshot: db.prepare(`
        INSERT INTO ml_representation_debt_snapshots
        (user_id, resolved_env, snapshot_id, representation_kind,
         window_start_ts, window_end_ts, observations_count,
         mean_misfit, debt_score, debt_verdict,
         revision_recommendation, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listSnapshotsByKind: db.prepare(`
        SELECT * FROM ml_representation_debt_snapshots
        WHERE user_id = ? AND resolved_env = ?
          AND representation_kind = ?
        ORDER BY ts ASC LIMIT ?
    `)
};

// ── computeMisfitScore (pure) ──────────────────────────────────────
// Numeric: |p-a| / max(|p|, |a|, ε), clamped [0,1]
// Categorical (strings): 0 if equal, 1 if different
function computeMisfitScore(params) {
    const predicted = _required(params, 'predicted');
    const actual = _required(params, 'actual');
    if (typeof predicted === 'number' && typeof actual === 'number') {
        const denom = Math.max(Math.abs(predicted), Math.abs(actual), _EPSILON);
        const raw = Math.abs(predicted - actual) / denom;
        return { misfitScore: Math.max(0, Math.min(1, raw)) };
    }
    return { misfitScore: predicted === actual ? 0 : 1 };
}

// ── classifyMisfitKind (pure) ──────────────────────────────────────
function classifyMisfitKind(params) {
    const score = _required(params, 'misfitScore');
    const confidence = _required(params, 'predictionConfidence');
    const explanatory = _required(params, 'explanatoryPower');
    const isCategorical = (params && params.isCategorical) === true;

    if (score < 0 || score > 1) {
        throw new Error(
            'representationDebtTracker: misfitScore must be in [0,1]'
        );
    }
    if (score < _NO_MISFIT_THRESHOLD) {
        return { misfitKind: 'no_misfit' };
    }
    if (isCategorical && score >= 0.9) {
        return { misfitKind: 'forced_category' };
    }
    if (confidence >= _OVER_CONFIDENT_CONFIDENCE &&
        explanatory < _LOW_EXPLANATORY + 0.10) {
        return { misfitKind: 'over_confident_under_explanatory' };
    }
    if (explanatory >= _HIGH_EXPLANATORY) {
        return { misfitKind: 'compression_excessive' };
    }
    return { misfitKind: 'over_confident_under_explanatory' };
}

// ── computeDebtScore (pure) ────────────────────────────────────────
// meanMisfit × min(1, observationsCount / minObservations), clamped [0,1]
function computeDebtScore(params) {
    const meanMisfit = _required(params, 'meanMisfit');
    const obsCount = _required(params, 'observationsCount');
    const minObs = (params && params.minObservations !== undefined)
        ? params.minObservations : MIN_OBSERVATIONS_FOR_SNAPSHOT;

    if (meanMisfit < 0 || meanMisfit > 1) {
        throw new Error(
            'representationDebtTracker: meanMisfit must be in [0,1]'
        );
    }
    if (obsCount <= 0) return { debtScore: 0 };
    const discount = Math.min(1, obsCount / minObs);
    const score = meanMisfit * discount;
    return { debtScore: Math.max(0, Math.min(1, score)) };
}

// ── classifyDebt (pure) ────────────────────────────────────────────
function classifyDebt(params) {
    const score = _required(params, 'debtScore');
    if (score < 0 || score > 1) {
        throw new Error(
            'representationDebtTracker: debtScore must be in [0,1]'
        );
    }
    let verdict;
    if (score >= DEBT_THRESHOLDS.critical) verdict = 'critical';
    else if (score >= DEBT_THRESHOLDS.accumulating) verdict = 'accumulating';
    else verdict = 'healthy';
    return { debtVerdict: verdict, debtScore: score };
}

// ── recommendRevision (pure) ───────────────────────────────────────
const _RECOMMENDATIONS = Object.freeze({
    healthy: {
        concept: 'parameter_tune',
        regime: 'parameter_tune',
        primitive: 'parameter_tune',
        explanation: 'parameter_tune',
        ontology: 'parameter_tune'
    },
    accumulating: {
        concept: 'concept_re_anchor',
        regime: 'regime_review',
        primitive: 'primitive_review',
        explanation: 'explanation_audit',
        ontology: 'ontology_review'
    },
    critical: {
        concept: 'concept_re_anchor',
        regime: 'regime_redefinition',
        primitive: 'primitive_rewrite',
        explanation: 'explanation_rebuild',
        ontology: 'ontology_revision'
    }
});

function recommendRevision(params) {
    const verdict = _required(params, 'debtVerdict');
    const kind = _required(params, 'representationKind');
    if (!DEBT_VERDICTS.includes(verdict)) {
        throw new Error(
            `representationDebtTracker: invalid debtVerdict "${verdict}"`
        );
    }
    if (!REPRESENTATION_KINDS.includes(kind)) {
        throw new Error(
            `representationDebtTracker: invalid representationKind "${kind}"`
        );
    }
    return { recommendation: _RECOMMENDATIONS[verdict][kind] };
}

// ── recordObservation ──────────────────────────────────────────────
function recordObservation(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const observationId = _required(params, 'observationId');
    const kind = _required(params, 'representationKind');
    const representationId = _required(params, 'representationId');
    const predicted = _required(params, 'predicted');
    const actual = _required(params, 'actual');
    const confidence = _required(params, 'predictionConfidence');
    const explanatory = _required(params, 'explanatoryPower');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!REPRESENTATION_KINDS.includes(kind)) {
        throw new Error(
            `representationDebtTracker: invalid representationKind "${kind}"`
        );
    }
    if (confidence < 0 || confidence > 1) {
        throw new Error(
            'representationDebtTracker: predictionConfidence must be in [0,1]'
        );
    }
    if (explanatory < 0 || explanatory > 1) {
        throw new Error(
            'representationDebtTracker: explanatoryPower must be in [0,1]'
        );
    }

    const isCategorical = typeof predicted !== 'number' ||
                          typeof actual !== 'number';
    const { misfitScore } = computeMisfitScore({ predicted, actual });
    const { misfitKind } = classifyMisfitKind({
        misfitScore, predictionConfidence: confidence,
        explanatoryPower: explanatory,
        isCategorical
    });

    try {
        _stmts.insertObservation.run(
            userId, env, observationId, kind, representationId,
            JSON.stringify(predicted), JSON.stringify(actual),
            misfitScore, misfitKind, confidence, explanatory, ts
        );
        return {
            recorded: true, observationId,
            misfitScore, misfitKind
        };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `representationDebtTracker: duplicate observationId "${observationId}"`
            );
        }
        throw err;
    }
}

// ── computeDebtSnapshot (integration) ──────────────────────────────
function computeDebtSnapshot(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const snapshotId = _required(params, 'snapshotId');
    const kind = _required(params, 'representationKind');
    const startTs = _required(params, 'windowStartTs');
    const endTs = _required(params, 'windowEndTs');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!REPRESENTATION_KINDS.includes(kind)) {
        throw new Error(
            `representationDebtTracker: invalid representationKind "${kind}"`
        );
    }

    const obs = _stmts.listObsInWindow.all(userId, env, kind, startTs, endTs);
    const count = obs.length;
    const meanMisfit = count > 0
        ? obs.reduce((a, b) => a + b.misfit_score, 0) / count
        : 0;
    const { debtScore } = computeDebtScore({
        meanMisfit, observationsCount: count
    });
    const { debtVerdict } = classifyDebt({ debtScore });
    const { recommendation } = recommendRevision({
        debtVerdict, representationKind: kind
    });

    try {
        _stmts.insertSnapshot.run(
            userId, env, snapshotId, kind,
            startTs, endTs, count,
            meanMisfit, debtScore, debtVerdict,
            recommendation, ts
        );
        return {
            snapshotted: true, snapshotId,
            observationsCount: count,
            meanMisfit, debtScore, debtVerdict,
            revisionRecommendation: recommendation
        };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `representationDebtTracker: duplicate snapshotId "${snapshotId}"`
            );
        }
        throw err;
    }
}

// ── getObservationsByKind ──────────────────────────────────────────
function getObservationsByKind(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const kind = _required(params, 'representationKind');
    const sinceTs = (params && params.sinceTs !== undefined)
        ? params.sinceTs : 0;
    const limit = (params && params.limit) ? params.limit : 100;

    if (!REPRESENTATION_KINDS.includes(kind)) {
        throw new Error(
            `representationDebtTracker: invalid representationKind "${kind}"`
        );
    }
    const rows = _stmts.listObsByKindSince.all(
        userId, env, kind, sinceTs, limit
    );
    return rows.map(r => ({
        observationId: r.observation_id,
        representationKind: r.representation_kind,
        representationId: r.representation_id,
        predicted: JSON.parse(r.predicted_outcome_json),
        actual: JSON.parse(r.actual_outcome_json),
        misfitScore: r.misfit_score,
        misfitKind: r.misfit_kind,
        predictionConfidence: r.prediction_confidence,
        explanatoryPower: r.explanatory_power,
        ts: r.ts
    }));
}

// ── getDebtTrend ───────────────────────────────────────────────────
function getDebtTrend(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const kind = _required(params, 'representationKind');
    const limit = (params && params.limit) ? params.limit : 100;

    if (!REPRESENTATION_KINDS.includes(kind)) {
        throw new Error(
            `representationDebtTracker: invalid representationKind "${kind}"`
        );
    }
    const rows = _stmts.listSnapshotsByKind.all(userId, env, kind, limit);
    return rows.map(r => ({
        snapshotId: r.snapshot_id,
        representationKind: r.representation_kind,
        windowStartTs: r.window_start_ts,
        windowEndTs: r.window_end_ts,
        observationsCount: r.observations_count,
        meanMisfit: r.mean_misfit,
        debtScore: r.debt_score,
        debtVerdict: r.debt_verdict,
        revisionRecommendation: r.revision_recommendation,
        ts: r.ts
    }));
}

module.exports = {
    REPRESENTATION_KINDS,
    MISFIT_KINDS,
    DEBT_VERDICTS,
    DEBT_THRESHOLDS,
    MIN_OBSERVATIONS_FOR_SNAPSHOT,
    computeMisfitScore,
    classifyMisfitKind,
    computeDebtScore,
    classifyDebt,
    recommendRevision,
    recordObservation,
    computeDebtSnapshot,
    getObservationsByKind,
    getDebtTrend
};
