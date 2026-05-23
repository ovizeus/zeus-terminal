'use strict';

/**
 * OMEGA R2 Cognition — thesisGraphEngine (canonical §68)
 *
 * §68 THESIS GRAPH / EVIDENCE DEPENDENCY ENGINE.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1784-1834.
 *
 * "Nu exista trade fara thesis graph. Nu exista management din inertie."
 *
 * Each trade has explicit thesis structured as evidence DAG:
 *   - 7 node types (per spec): context / liquidity / order_flow /
 *                              derivatives / macro / execution /
 *                              portfolio_permission
 *   - 3 edge relations: requires / supports / invalidates
 *   - Node decay (exponential, configurable per node)
 *   - Node confidence [0..1]
 *
 * Evaluation logic:
 *   - Any 'requires' node confidence < floor → INVALID + EXIT_FULL
 *   - 'supports' nodes degraded → PARTIAL_DEGRADED + EXIT_PARTIAL
 *   - All confidence strong + improved → CONFIRMED_STRENGTHENED + SCALE_UP
 *   - Otherwise → ACTIVE + HOLD
 *
 * Feeds: explainability (§25/§54), counterfactuals (§42), attribution (§16).
 */

const { db } = require('../../database');

const NODE_TYPES = Object.freeze([
    'context', 'liquidity', 'order_flow', 'derivatives',
    'macro', 'execution', 'portfolio_permission'
]);
const EDGE_RELATIONS = Object.freeze(['requires', 'supports', 'invalidates']);
const THESIS_STATUSES = Object.freeze([
    'ACTIVE', 'PARTIAL_DEGRADED', 'INVALID', 'CONFIRMED_STRENGTHENED'
]);
const EVALUATION_HEALTH = Object.freeze([
    'active', 'degraded', 'invalid', 'strengthened'
]);
const ACTION_RECOMMENDATIONS = Object.freeze([
    'HOLD', 'EXIT_PARTIAL', 'EXIT_FULL', 'SCALE_UP'
]);
const INVALIDATION_CONFIDENCE_FLOOR = 0.25;

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`thesisGraphEngine: missing ${key}`);
    }
    return params[key];
}

function _validateNode(node) {
    if (!node.nodeId) throw new Error('thesisGraphEngine: node missing nodeId');
    if (!NODE_TYPES.includes(node.type)) {
        throw new Error(`thesisGraphEngine: invalid node type "${node.type}"`);
    }
    if (typeof node.confidence !== 'number' ||
        node.confidence < 0 || node.confidence > 1) {
        throw new Error('thesisGraphEngine: node confidence must be in [0,1]');
    }
}

function _validateEdge(edge) {
    if (!edge.from || !edge.to) {
        throw new Error('thesisGraphEngine: edge missing from/to');
    }
    if (!EDGE_RELATIONS.includes(edge.relation)) {
        throw new Error(`thesisGraphEngine: invalid edge relation "${edge.relation}"`);
    }
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertGraph: db.prepare(`
        INSERT INTO ml_thesis_graphs
        (user_id, resolved_env, thesis_id, position_id,
         nodes_json, edges_json, break_conditions_json,
         status, created_at, last_updated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateGraph: db.prepare(`
        UPDATE ml_thesis_graphs
        SET nodes_json = ?, status = ?, last_updated = ?
        WHERE thesis_id = ?
    `),
    getGraph: db.prepare(`
        SELECT * FROM ml_thesis_graphs WHERE thesis_id = ?
    `),
    listActive: db.prepare(`
        SELECT * FROM ml_thesis_graphs
        WHERE user_id = ? AND resolved_env = ?
          AND status IN ('ACTIVE', 'PARTIAL_DEGRADED', 'CONFIRMED_STRENGTHENED')
        ORDER BY created_at DESC
    `),
    insertEvaluation: db.prepare(`
        INSERT INTO ml_thesis_evaluations
        (user_id, resolved_env, thesis_id, evaluation_ts,
         overall_health, failing_nodes_json, action_recommended, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    evalHistory: db.prepare(`
        SELECT * FROM ml_thesis_evaluations
        WHERE user_id = ? AND resolved_env = ? AND thesis_id = ?
          AND (? = 0 OR ts >= ?)
        ORDER BY ts DESC, id DESC
        LIMIT ?
    `)
};

// ── createThesisGraph ──────────────────────────────────────────────
function createThesisGraph(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const thesisId = _required(params, 'thesisId');
    const positionId = (params && params.positionId) ? params.positionId : null;
    const nodes = _required(params, 'nodes');
    const edges = _required(params, 'edges');
    const breakConditions = (params && params.breakConditions) ? params.breakConditions : null;
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!Array.isArray(nodes) || nodes.length === 0) {
        throw new Error('thesisGraphEngine: nodes must be non-empty array');
    }
    if (!Array.isArray(edges)) {
        throw new Error('thesisGraphEngine: edges must be array');
    }

    for (const n of nodes) _validateNode(n);
    for (const e of edges) _validateEdge(e);

    try {
        _stmts.insertGraph.run(
            userId, env, thesisId, positionId,
            JSON.stringify(nodes), JSON.stringify(edges),
            breakConditions ? JSON.stringify(breakConditions) : null,
            'ACTIVE', ts, ts
        );
        return { created: true, thesisId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`thesisGraphEngine: duplicate thesisId "${thesisId}"`);
        }
        throw err;
    }
}

// ── updateNodeConfidence ───────────────────────────────────────────
function updateNodeConfidence(params) {
    const thesisId = _required(params, 'thesisId');
    const nodeId = _required(params, 'nodeId');
    const newConfidence = _required(params, 'newConfidence');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (typeof newConfidence !== 'number' || newConfidence < 0 || newConfidence > 1) {
        throw new Error('thesisGraphEngine: newConfidence must be in [0,1]');
    }

    const row = _stmts.getGraph.get(thesisId);
    if (!row) throw new Error(`thesisGraphEngine: thesis "${thesisId}" not found`);

    const nodes = JSON.parse(row.nodes_json);
    const node = nodes.find(n => n.nodeId === nodeId);
    if (!node) throw new Error(`thesisGraphEngine: node "${nodeId}" not found`);

    node.confidence = newConfidence;
    node.lastUpdated = ts;

    _stmts.updateGraph.run(JSON.stringify(nodes), row.status, ts, thesisId);
    return { updated: true, nodeId, newConfidence };
}

// ── applyNodeDecay ─────────────────────────────────────────────────
function applyNodeDecay(params) {
    const thesisId = _required(params, 'thesisId');
    const now = (params && params.now) ? params.now : Date.now();

    const row = _stmts.getGraph.get(thesisId);
    if (!row) throw new Error(`thesisGraphEngine: thesis "${thesisId}" not found`);

    const nodes = JSON.parse(row.nodes_json);
    for (const n of nodes) {
        const decayRate = n.decayRate || 0;
        const lastTs = n.lastUpdated || row.created_at;
        const elapsedMs = now - lastTs;
        if (decayRate > 0 && elapsedMs > 0) {
            const decay = Math.exp(-decayRate * elapsedMs);
            n.confidence = Math.max(0, n.confidence * decay);
            n.lastUpdated = now;
        }
    }

    _stmts.updateGraph.run(JSON.stringify(nodes), row.status, now, thesisId);
    return { decayed: true, nodes };
}

// ── evaluateThesisHealth ───────────────────────────────────────────
function evaluateThesisHealth(params) {
    const thesisId = _required(params, 'thesisId');
    const now = (params && params.now) ? params.now : Date.now();

    const row = _stmts.getGraph.get(thesisId);
    if (!row) throw new Error(`thesisGraphEngine: thesis "${thesisId}" not found`);

    const nodes = JSON.parse(row.nodes_json);
    const edges = JSON.parse(row.edges_json);

    const failingNodes = [];
    let requiresFailed = false;
    let supportsDegraded = false;
    let allStrong = true;

    for (const n of nodes) {
        if (n.confidence < INVALIDATION_CONFIDENCE_FLOOR) {
            failingNodes.push({ nodeId: n.nodeId, type: n.type, confidence: n.confidence });
            // Check if any incoming/related edge marks this as 'requires'
            const isRequired = edges.some(
                e => (e.to === n.nodeId || e.from === n.nodeId) && e.relation === 'requires'
            );
            if (isRequired) requiresFailed = true;
            else supportsDegraded = true;
        }
        if (n.confidence < 0.75) allStrong = false;
    }

    let health, status, action;
    if (requiresFailed) {
        health = 'invalid';
        status = 'INVALID';
        action = 'EXIT_FULL';
    } else if (supportsDegraded) {
        health = 'degraded';
        status = 'PARTIAL_DEGRADED';
        action = 'EXIT_PARTIAL';
    } else if (allStrong) {
        health = 'strengthened';
        status = 'CONFIRMED_STRENGTHENED';
        action = 'SCALE_UP';
    } else {
        health = 'active';
        status = 'ACTIVE';
        action = 'HOLD';
    }

    _stmts.updateGraph.run(JSON.stringify(nodes), status, now, thesisId);

    return {
        thesisId,
        health,
        status,
        action,
        failingNodes,
        evaluatedAt: now
    };
}

// ── recordEvaluation ───────────────────────────────────────────────
function recordEvaluation(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const thesisId = _required(params, 'thesisId');
    const evaluation = _required(params, 'evaluation');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!EVALUATION_HEALTH.includes(evaluation.health)) {
        throw new Error(`thesisGraphEngine: invalid health "${evaluation.health}"`);
    }
    if (!ACTION_RECOMMENDATIONS.includes(evaluation.action)) {
        throw new Error(`thesisGraphEngine: invalid action "${evaluation.action}"`);
    }

    _stmts.insertEvaluation.run(
        userId, env, thesisId, ts,
        evaluation.health,
        evaluation.failingNodes ? JSON.stringify(evaluation.failingNodes) : null,
        evaluation.action, ts
    );
    return { recorded: true };
}

// ── getThesisGraph ─────────────────────────────────────────────────
function getThesisGraph(params) {
    const thesisId = _required(params, 'thesisId');
    const row = _stmts.getGraph.get(thesisId);
    if (!row) return null;
    return {
        thesisId: row.thesis_id,
        positionId: row.position_id,
        nodes: JSON.parse(row.nodes_json),
        edges: JSON.parse(row.edges_json),
        breakConditions: row.break_conditions_json ? JSON.parse(row.break_conditions_json) : null,
        status: row.status,
        createdAt: row.created_at,
        lastUpdated: row.last_updated
    };
}

// ── listActiveThesis ───────────────────────────────────────────────
function listActiveThesis(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    return _stmts.listActive.all(userId, env).map(r => ({
        thesisId: r.thesis_id,
        positionId: r.position_id,
        status: r.status,
        createdAt: r.created_at
    }));
}

// ── getEvaluationHistory ───────────────────────────────────────────
function getEvaluationHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const thesisId = _required(params, 'thesisId');
    const since = (params && params.since) ? params.since : 0;
    const limit = (params && params.limit) ? params.limit : 100;
    return _stmts.evalHistory.all(
        userId, env, thesisId,
        since > 0 ? 1 : 0, since,
        limit
    );
}

module.exports = {
    NODE_TYPES,
    EDGE_RELATIONS,
    THESIS_STATUSES,
    EVALUATION_HEALTH,
    ACTION_RECOMMENDATIONS,
    INVALIDATION_CONFIDENCE_FLOOR,
    createThesisGraph,
    updateNodeConfidence,
    applyNodeDecay,
    evaluateThesisHealth,
    recordEvaluation,
    getThesisGraph,
    listActiveThesis,
    getEvaluationHistory
};
