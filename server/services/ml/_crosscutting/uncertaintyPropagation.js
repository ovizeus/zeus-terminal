'use strict';

/**
 * OMEGA cross-cutting — uncertaintyPropagation (canonical §92)
 *
 * §92 PROPAGAREA INCERTITUDINII PRIN INTREGUL PIPELINE.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt line 2374.
 *
 * "Incertitudinea se compune, nu dispare. Daca feed-ul are freshness 0.7,
 *  detectorul de lichiditate produce confidence 0.8, si meta-controllerul
 *  combina 8 scoruri, incertitudinea finala nu e media lor — se compune
 *  algebric... Confidence 74% pe pipeline degradat = 74% +/- 18%, NU +/- 3%."
 *
 * Distinct from §20 calibration (output-level only). §92 = end-to-end algebraic
 * propagation: weighted-sum variance for linear aggregators, delta-method for
 * multiplicative confidences. Classification via CV = stdDev/|mean|.
 */

const { db } = require('../../database');

const NODE_KINDS = Object.freeze([
    'data', 'detector', 'aggregator', 'decision'
]);
const PIPELINE_STATUSES = Object.freeze([
    'HEALTHY', 'DEGRADED', 'UNRELIABLE'
]);

const CV_HEALTHY_THRESHOLD = 0.05;
const CV_DEGRADED_THRESHOLD = 0.20;

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`uncertaintyPropagation: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertNode: db.prepare(`
        INSERT INTO ml_uncertainty_nodes
        (user_id, resolved_env, node_id, pipeline_id, kind,
         point_estimate, variance, contributing_node_ids_json, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getNode: db.prepare(`
        SELECT * FROM ml_uncertainty_nodes WHERE node_id = ?
    `),
    listNodesByPipeline: db.prepare(`
        SELECT * FROM ml_uncertainty_nodes
        WHERE user_id = ? AND resolved_env = ? AND pipeline_id = ?
        ORDER BY ts ASC
    `),
    upsertPipeline: db.prepare(`
        INSERT INTO ml_uncertainty_pipelines
        (user_id, resolved_env, pipeline_id, name, decision_node_id,
         total_propagated_variance, status, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(pipeline_id) DO UPDATE SET
          decision_node_id = excluded.decision_node_id,
          total_propagated_variance = excluded.total_propagated_variance,
          status = excluded.status,
          ts = excluded.ts
    `),
    listPipelines: db.prepare(`
        SELECT * FROM ml_uncertainty_pipelines
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC LIMIT ?
    `)
};

// ── propagateLinear (pure) ─────────────────────────────────────────
// Weighted aggregation: z = Σ w_i x_i ; σ_z² = Σ w_i² σ_i²
function propagateLinear(params) {
    const inputs = _required(params, 'inputs');
    if (!Array.isArray(inputs) || inputs.length === 0) {
        return { value: 0, variance: 0 };
    }
    let weights = (params && params.weights) ? params.weights : null;
    if (!weights) {
        const w = 1 / inputs.length;
        weights = new Array(inputs.length).fill(w);
    }
    if (weights.length !== inputs.length) {
        throw new Error('uncertaintyPropagation: weights length mismatch inputs');
    }

    let value = 0;
    let variance = 0;
    for (let i = 0; i < inputs.length; i++) {
        const v = inputs[i].value;
        const sigma2 = inputs[i].variance;
        if (typeof v !== 'number' || typeof sigma2 !== 'number') {
            throw new Error('uncertaintyPropagation: input.value and input.variance must be numbers');
        }
        value += weights[i] * v;
        variance += weights[i] * weights[i] * sigma2;
    }
    return { value, variance };
}

// ── propagateProduct (pure) ────────────────────────────────────────
// Delta method for z = ∏ x_i :
// log(z) = Σ log(x_i) → var(log z) ≈ Σ σ_i²/x_i²
// var(z) ≈ z² · var(log z)
function propagateProduct(params) {
    const inputs = _required(params, 'inputs');
    if (!Array.isArray(inputs) || inputs.length === 0) {
        return { value: 1, variance: 0 };
    }
    let product = 1;
    let logVar = 0;
    for (const inp of inputs) {
        const v = inp.value;
        const sigma2 = inp.variance;
        if (typeof v !== 'number' || typeof sigma2 !== 'number') {
            throw new Error('uncertaintyPropagation: input.value and input.variance must be numbers');
        }
        if (v === 0) {
            return { value: 0, variance: 0 };
        }
        product *= v;
        logVar += sigma2 / (v * v);
    }
    const variance = product * product * logVar;
    return { value: product, variance };
}

// ── classifyConfidence (pure) ──────────────────────────────────────
// CV = σ/|μ|. CV < 0.05 = HEALTHY, < 0.20 = DEGRADED, else UNRELIABLE.
function classifyConfidence(params) {
    const pointEstimate = _required(params, 'pointEstimate');
    const variance = _required(params, 'variance');
    const stdDev = Math.sqrt(Math.max(0, variance));
    const absMu = Math.abs(pointEstimate);
    if (absMu < 1e-12) {
        return {
            status: 'UNRELIABLE', cv: Infinity, stdDev,
            reason: 'point estimate near zero — CV undefined'
        };
    }
    const cv = stdDev / absMu;
    let status;
    if (cv < CV_HEALTHY_THRESHOLD) status = 'HEALTHY';
    else if (cv < CV_DEGRADED_THRESHOLD) status = 'DEGRADED';
    else status = 'UNRELIABLE';
    return { status, cv, stdDev };
}

// ── recordNode ─────────────────────────────────────────────────────
function recordNode(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const nodeId = _required(params, 'nodeId');
    const pipelineId = _required(params, 'pipelineId');
    const kind = _required(params, 'kind');
    if (!NODE_KINDS.includes(kind)) {
        throw new Error(`uncertaintyPropagation: invalid kind "${kind}"`);
    }
    const pointEstimate = _required(params, 'pointEstimate');
    const variance = _required(params, 'variance');
    if (variance < 0) {
        throw new Error('uncertaintyPropagation: variance must be >= 0');
    }
    const contributingIds = (params && params.contributingNodeIds)
        ? JSON.stringify(params.contributingNodeIds) : null;
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertNode.run(
            userId, env, nodeId, pipelineId, kind,
            pointEstimate, variance, contributingIds, ts
        );
        return { recorded: true, nodeId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`uncertaintyPropagation: duplicate nodeId "${nodeId}"`);
        }
        throw err;
    }
}

// ── evaluatePipeline ───────────────────────────────────────────────
function evaluatePipeline(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const pipelineId = _required(params, 'pipelineId');
    const ts = (params && params.ts) ? params.ts : Date.now();

    const nodes = _stmts.listNodesByPipeline.all(userId, env, pipelineId);
    if (nodes.length === 0) {
        return { evaluated: false, reason: 'no_nodes', pipelineId };
    }

    // Decision node = last node OR explicitly kind='decision'
    let decisionNode = nodes.find(n => n.kind === 'decision');
    if (!decisionNode) decisionNode = nodes[nodes.length - 1];

    const cls = classifyConfidence({
        pointEstimate: decisionNode.point_estimate,
        variance: decisionNode.variance
    });

    _stmts.upsertPipeline.run(
        userId, env, pipelineId,
        (params && params.name) ? params.name : pipelineId,
        decisionNode.node_id, decisionNode.variance, cls.status, ts
    );

    return {
        evaluated: true,
        pipelineId,
        decisionNodeId: decisionNode.node_id,
        decisionValue: decisionNode.point_estimate,
        decisionVariance: decisionNode.variance,
        cv: cls.cv,
        stdDev: cls.stdDev,
        status: cls.status,
        nodeCount: nodes.length
    };
}

// ── getPipelineHistory ─────────────────────────────────────────────
function getPipelineHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const limit = (params && params.limit) ? params.limit : 100;

    const rows = _stmts.listPipelines.all(userId, env, limit);
    return rows.map(r => ({
        pipelineId: r.pipeline_id,
        name: r.name,
        decisionNodeId: r.decision_node_id,
        totalPropagatedVariance: r.total_propagated_variance,
        status: r.status,
        ts: r.ts
    }));
}

module.exports = {
    NODE_KINDS,
    PIPELINE_STATUSES,
    CV_HEALTHY_THRESHOLD,
    CV_DEGRADED_THRESHOLD,
    propagateLinear,
    propagateProduct,
    classifyConfidence,
    recordNode,
    evaluatePipeline,
    getPipelineHistory
};
