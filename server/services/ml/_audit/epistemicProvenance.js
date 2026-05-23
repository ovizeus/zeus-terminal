'use strict';

/**
 * OMEGA _audit — epistemicProvenance (canonical §117)
 *
 * §117 EPISTEMIC PROVENANCE / LINEAGE OF BELIEF ENGINE.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 3118-3161.
 *
 * "Nu este suficient sa loghezi ce a decis botul. Trebuie sa stii exact
 *  de unde provine fiecare credinta, scor sau ipoteza... lineage graph
 *  pentru fiecare decizie... mapping complet raw_feed → preprocess →
 *  detector_outputs → score_transforms → gating_events → thesis_nodes →
 *  policy_verdict... distinctie observatie_directa / inferenta_derivata /
 *  ipoteza_propagata / prior_istoric / analogie_episodica... 'de unde
 *  vine exact ideea asta?'... NU exista belief important fara lineage...
 *  provenance queryable + replayable... orice belief fara provenienta
 *  clara este tratat ca slab sau suspect."
 *
 * Distinct from auditTrail.js (flat decision snapshots), §16
 * attributionEngine (PnL factor decomposition), §25 explainability
 * (output XAI), §35 monitoring (KPI dashboards), §105 latentStateFilter
 * (Bayesian belief tracking — different concept).
 */

const { db } = require('../../database');

const NODE_KINDS = Object.freeze([
    'raw_feed', 'preprocess', 'detector_output',
    'score_transform', 'gating_event',
    'thesis_node', 'policy_verdict'
]);
const SOURCE_TYPES = Object.freeze([
    'direct_observation', 'derived_inference',
    'propagated_hypothesis',
    'historical_prior', 'episodic_analogy'
]);

const MIN_NODE_COUNT = 1;

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`epistemicProvenance: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertNode: db.prepare(`
        INSERT INTO ml_belief_nodes
        (user_id, resolved_env, node_id, belief_id, kind,
         source_type, parent_node_ids_json, content_summary, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listNodesByBelief: db.prepare(`
        SELECT * FROM ml_belief_nodes
        WHERE user_id = ? AND resolved_env = ? AND belief_id = ?
        ORDER BY ts ASC LIMIT ?
    `),
    insertLineage: db.prepare(`
        INSERT INTO ml_belief_lineages
        (user_id, resolved_env, lineage_id, belief_id,
         root_node_id, terminal_node_id, decision_id,
         node_count, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getLineage: db.prepare(`
        SELECT * FROM ml_belief_lineages WHERE lineage_id = ?
    `)
};

// ── validateLineageCompleteness (pure) ─────────────────────────────
// Enforces canonical structure:
// - At least one root (kind='raw_feed' AND parents=[])
// - At least one terminal (kind='policy_verdict')
// - No orphan parent references
function validateLineageCompleteness(params) {
    const nodes = _required(params, 'nodes');
    if (!Array.isArray(nodes) || nodes.length === 0) {
        throw new Error('epistemicProvenance: nodes must be non-empty array');
    }
    const nodeIdSet = new Set(nodes.map(n => n.nodeId));

    let hasRoot = false;
    let hasTerminal = false;
    for (const n of nodes) {
        // 1) orphan parent ref check
        const parents = n.parentNodeIds || [];
        for (const p of parents) {
            if (!nodeIdSet.has(p)) {
                throw new Error(
                    `epistemicProvenance: orphan parent reference "${p}" ` +
                    `in node "${n.nodeId}" — node not in lineage set`
                );
            }
        }
        // 2) root validation: raw_feed nodes MUST have empty parents
        if (n.kind === 'raw_feed') {
            if (parents.length > 0) {
                throw new Error(
                    `epistemicProvenance: raw_feed node "${n.nodeId}" ` +
                    'must have empty parentNodeIds (root constraint)'
                );
            }
            hasRoot = true;
        }
        if (n.kind === 'policy_verdict') {
            hasTerminal = true;
        }
    }

    if (!hasRoot) {
        throw new Error(
            'epistemicProvenance: lineage missing root (kind=raw_feed)'
        );
    }
    if (!hasTerminal) {
        throw new Error(
            'epistemicProvenance: lineage missing terminal (kind=policy_verdict)'
        );
    }
    return { valid: true, nodeCount: nodes.length };
}

// ── registerBeliefNode ─────────────────────────────────────────────
function registerBeliefNode(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const nodeId = _required(params, 'nodeId');
    const beliefId = _required(params, 'beliefId');
    const kind = _required(params, 'kind');
    if (!NODE_KINDS.includes(kind)) {
        throw new Error(`epistemicProvenance: invalid kind "${kind}"`);
    }
    const sourceType = _required(params, 'sourceType');
    if (!SOURCE_TYPES.includes(sourceType)) {
        throw new Error(`epistemicProvenance: invalid sourceType "${sourceType}"`);
    }
    const parentNodeIds = (params && Array.isArray(params.parentNodeIds))
        ? params.parentNodeIds : [];
    const contentSummary = _required(params, 'contentSummary');
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertNode.run(
            userId, env, nodeId, beliefId, kind, sourceType,
            JSON.stringify(parentNodeIds), contentSummary, ts
        );
        return { registered: true, nodeId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`epistemicProvenance: duplicate nodeId "${nodeId}"`);
        }
        throw err;
    }
}

// ── traceBeliefLineage ─────────────────────────────────────────────
function traceBeliefLineage(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const beliefId = _required(params, 'beliefId');
    const limit = (params && params.limit) ? params.limit : 1000;

    const rows = _stmts.listNodesByBelief.all(userId, env, beliefId, limit);
    return rows.map(r => ({
        nodeId: r.node_id,
        beliefId: r.belief_id,
        kind: r.kind,
        sourceType: r.source_type,
        parentNodeIds: JSON.parse(r.parent_node_ids_json),
        contentSummary: r.content_summary,
        ts: r.ts
    }));
}

// ── recordBeliefLineage ────────────────────────────────────────────
function recordBeliefLineage(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const lineageId = _required(params, 'lineageId');
    const beliefId = _required(params, 'beliefId');
    const rootNodeId = _required(params, 'rootNodeId');
    const terminalNodeId = _required(params, 'terminalNodeId');
    const decisionId = _required(params, 'decisionId');
    const nodeCount = _required(params, 'nodeCount');
    if (nodeCount < MIN_NODE_COUNT) {
        throw new Error(
            `epistemicProvenance: nodeCount ${nodeCount} < MIN ${MIN_NODE_COUNT}`
        );
    }
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertLineage.run(
            userId, env, lineageId, beliefId,
            rootNodeId, terminalNodeId, decisionId,
            nodeCount, ts
        );
        return { recorded: true, lineageId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`epistemicProvenance: duplicate lineageId "${lineageId}"`);
        }
        throw err;
    }
}

// ── getLineageById ─────────────────────────────────────────────────
function getLineageById(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const lineageId = _required(params, 'lineageId');

    const lineage = _stmts.getLineage.get(lineageId);
    if (!lineage) {
        throw new Error(`epistemicProvenance: lineage "${lineageId}" not found`);
    }
    if (lineage.user_id !== userId || lineage.resolved_env !== env) {
        throw new Error('epistemicProvenance: lineage not owned by user/env');
    }
    const nodes = traceBeliefLineage({
        userId, resolvedEnv: env, beliefId: lineage.belief_id
    });
    return {
        lineage: {
            lineageId: lineage.lineage_id,
            beliefId: lineage.belief_id,
            rootNodeId: lineage.root_node_id,
            terminalNodeId: lineage.terminal_node_id,
            decisionId: lineage.decision_id,
            nodeCount: lineage.node_count,
            ts: lineage.ts
        },
        nodes
    };
}

module.exports = {
    NODE_KINDS,
    SOURCE_TYPES,
    MIN_NODE_COUNT,
    validateLineageCompleteness,
    registerBeliefNode,
    traceBeliefLineage,
    recordBeliefLineage,
    getLineageById
};
