'use strict';

/**
 * OMEGA R5B Governance — complexityBudget (canonical §94)
 *
 * §94 PRINCIPIUL PARCIMONIEI / COMPLEXITY BUDGET.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt line 2378.
 *
 * "Fiecare semnal nou trebuie sa justifice marginal information gain fata de
 *  costul de complexitate adaugat... Minimum Description Length ca principiu
 *  de selectie... cele care nu trec sunt eliminate, nu pastrate din inertie...
 *  Fara asta, sistemul devine inevitabil fragil prin acumulare de complexitate."
 *
 * R5B governance, lifecycle pruning. Distinct from §90 goodhartProtection
 * (gaming defense), §254 autoQuarantine (failure-based quarantine).
 * §94 = complexity-based pruning via MDL/BIC.
 */

const { db } = require('../../database');

const FEATURE_STATUSES = Object.freeze(['ACTIVE', 'EVALUATING', 'PRUNED']);
const EVALUATION_DECISIONS = Object.freeze(['KEEP', 'WATCH', 'PRUNE']);

const DEFAULT_LAMBDA = 1.0;
const WATCH_THRESHOLD = 0.5;

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`complexityBudget: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertFeature: db.prepare(`
        INSERT INTO ml_complexity_registry
        (user_id, resolved_env, feature_id, complexity_units,
         information_gain, mdl_score, status, last_evaluated, ts)
        VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', NULL, ?)
    `),
    getFeature: db.prepare(`
        SELECT * FROM ml_complexity_registry WHERE feature_id = ?
    `),
    listActiveFeatures: db.prepare(`
        SELECT * FROM ml_complexity_registry
        WHERE user_id = ? AND resolved_env = ? AND status = 'ACTIVE'
        ORDER BY ts DESC LIMIT ?
    `),
    listAllFeatures: db.prepare(`
        SELECT * FROM ml_complexity_registry
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC LIMIT ?
    `),
    updateFeatureStatus: db.prepare(`
        UPDATE ml_complexity_registry
        SET status = ?, last_evaluated = ?,
            information_gain = COALESCE(?, information_gain),
            mdl_score = COALESCE(?, mdl_score)
        WHERE user_id = ? AND resolved_env = ? AND feature_id = ?
    `),
    insertEvaluation: db.prepare(`
        INSERT INTO ml_complexity_evaluations
        (user_id, resolved_env, evaluation_id, feature_id,
         marginal_ig, marginal_complexity, mdl_delta, decision, reason, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listEvaluations: db.prepare(`
        SELECT * FROM ml_complexity_evaluations
        WHERE user_id = ? AND resolved_env = ? AND feature_id = ?
        ORDER BY ts DESC LIMIT ?
    `)
};

// ── computeMDLScore (pure) ─────────────────────────────────────────
// BIC: -2 log L + k log(n). Lower = better.
function computeMDLScore(params) {
    const negLogLikelihood = _required(params, 'negLogLikelihood');
    const paramCount = _required(params, 'paramCount');
    const sampleCount = _required(params, 'sampleCount');
    if (paramCount < 0 || sampleCount <= 0) {
        throw new Error('complexityBudget: paramCount >= 0 and sampleCount > 0 required');
    }
    return 2 * negLogLikelihood + paramCount * Math.log(sampleCount);
}

// ── evaluateMarginalContribution (pure) ────────────────────────────
function evaluateMarginalContribution(params) {
    const informationGain = _required(params, 'informationGain');
    const complexityCost = _required(params, 'complexityCost');
    const lambda = (params && params.lambda !== undefined) ? params.lambda : DEFAULT_LAMBDA;

    if (complexityCost <= 0) {
        // free feature — always keep
        return { decision: 'KEEP', ratio: Infinity, lambda };
    }
    const ratio = informationGain / (complexityCost * lambda);
    let decision;
    if (ratio >= 1.0) decision = 'KEEP';
    else if (ratio >= WATCH_THRESHOLD) decision = 'WATCH';
    else decision = 'PRUNE';
    return { decision, ratio, lambda };
}

// ── registerFeature ────────────────────────────────────────────────
function registerFeature(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const featureId = _required(params, 'featureId');
    const complexityUnits = _required(params, 'complexityUnits');
    if (complexityUnits < 0) {
        throw new Error('complexityBudget: complexityUnits must be >= 0');
    }
    const informationGain = (params && params.informationGain !== undefined)
        ? params.informationGain : null;
    const mdlScore = (params && params.mdlScore !== undefined) ? params.mdlScore : null;
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertFeature.run(
            userId, env, featureId, complexityUnits,
            informationGain, mdlScore, ts
        );
        return { registered: true, featureId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`complexityBudget: duplicate featureId "${featureId}"`);
        }
        throw err;
    }
}

// ── recordEvaluation ───────────────────────────────────────────────
function recordEvaluation(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const evaluationId = _required(params, 'evaluationId');
    const featureId = _required(params, 'featureId');
    const marginalIG = _required(params, 'marginalIG');
    const marginalComplexity = _required(params, 'marginalComplexity');
    const mdlDelta = (params && params.mdlDelta !== undefined) ? params.mdlDelta : null;
    const lambda = (params && params.lambda !== undefined) ? params.lambda : DEFAULT_LAMBDA;
    const reason = (params && params.reason) ? params.reason : null;
    const ts = (params && params.ts) ? params.ts : Date.now();

    const feature = _stmts.getFeature.get(featureId);
    if (!feature) {
        throw new Error(`complexityBudget: feature "${featureId}" not registered`);
    }
    if (feature.user_id !== userId || feature.resolved_env !== env) {
        throw new Error('complexityBudget: feature not owned by user/env');
    }

    const ev = evaluateMarginalContribution({
        informationGain: marginalIG, complexityCost: marginalComplexity, lambda
    });

    try {
        _stmts.insertEvaluation.run(
            userId, env, evaluationId, featureId,
            marginalIG, marginalComplexity, mdlDelta,
            ev.decision, reason, ts
        );
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`complexityBudget: duplicate evaluationId "${evaluationId}"`);
        }
        throw err;
    }

    // Auto-update feature status based on decision
    let newStatus = feature.status;
    if (ev.decision === 'PRUNE' && feature.status !== 'PRUNED') {
        newStatus = 'PRUNED';
    } else if (ev.decision === 'WATCH' && feature.status === 'ACTIVE') {
        newStatus = 'EVALUATING';
    } else if (ev.decision === 'KEEP' && feature.status === 'EVALUATING') {
        newStatus = 'ACTIVE';
    }
    if (newStatus !== feature.status) {
        _stmts.updateFeatureStatus.run(
            newStatus, ts, marginalIG, mdlDelta,
            userId, env, featureId
        );
    } else {
        // still update last_evaluated and metrics
        _stmts.updateFeatureStatus.run(
            feature.status, ts, marginalIG, mdlDelta,
            userId, env, featureId
        );
    }

    return {
        recorded: true, evaluationId,
        decision: ev.decision, ratio: ev.ratio,
        newStatus
    };
}

// ── pruneFeature ───────────────────────────────────────────────────
function pruneFeature(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const featureId = _required(params, 'featureId');
    const reason = (params && params.reason) ? params.reason : 'manual_prune';
    const ts = (params && params.ts) ? params.ts : Date.now();

    const feature = _stmts.getFeature.get(featureId);
    if (!feature) {
        throw new Error(`complexityBudget: feature "${featureId}" not registered`);
    }
    if (feature.user_id !== userId || feature.resolved_env !== env) {
        throw new Error('complexityBudget: feature not owned by user/env');
    }

    _stmts.updateFeatureStatus.run(
        'PRUNED', ts, null, null, userId, env, featureId
    );
    return { pruned: true, featureId, reason, previousStatus: feature.status };
}

// ── getActiveFeatures / getEvaluationHistory ───────────────────────
function getActiveFeatures(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const limit = (params && params.limit) ? params.limit : 100;
    const includeAll = !!(params && params.includeAll);

    const rows = includeAll
        ? _stmts.listAllFeatures.all(userId, env, limit)
        : _stmts.listActiveFeatures.all(userId, env, limit);
    return rows.map(r => ({
        featureId: r.feature_id,
        complexityUnits: r.complexity_units,
        informationGain: r.information_gain,
        mdlScore: r.mdl_score,
        status: r.status,
        lastEvaluated: r.last_evaluated,
        ts: r.ts
    }));
}

function getEvaluationHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const featureId = _required(params, 'featureId');
    const limit = (params && params.limit) ? params.limit : 100;

    const rows = _stmts.listEvaluations.all(userId, env, featureId, limit);
    return rows.map(r => ({
        evaluationId: r.evaluation_id,
        featureId: r.feature_id,
        marginalIG: r.marginal_ig,
        marginalComplexity: r.marginal_complexity,
        mdlDelta: r.mdl_delta,
        decision: r.decision,
        reason: r.reason,
        ts: r.ts
    }));
}

module.exports = {
    FEATURE_STATUSES,
    EVALUATION_DECISIONS,
    DEFAULT_LAMBDA,
    WATCH_THRESHOLD,
    computeMDLScore,
    evaluateMarginalContribution,
    registerFeature,
    recordEvaluation,
    pruneFeature,
    getActiveFeatures,
    getEvaluationHistory
};
