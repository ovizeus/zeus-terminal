'use strict';

/**
 * OMEGA R2 Cognition — beliefPropagation (canonical §75)
 *
 * §75 BELIEF PROPAGATION — cand o piesa de evidenta se schimba,
 * tot graful se actualizeaza instantaneu.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1980-1981.
 *
 * "Daca nodul CVD confirma se schimba brusc de la + la − in timp ce
 *  esti in pozitie, toate nodurile dependente trebuie sa-si actualizeze
 *  confidence-ul automat si imediat. Nu la urmatorul ciclu. Acum."
 *
 * R2. Real-time cascade through thesis graph (§68) edges.
 * Without this: thesis graph = static photo.
 * With this: organism viu reactionand continuu.
 *
 * Propagation rules per edge relation:
 *   requires(source → target):
 *     source drops → target loses confidence proportionally
 *     source rises → no propagation (already required)
 *   supports(source → target):
 *     bidirectional, target += sourceDelta × damping × edgeStrength
 *   invalidates(source → target):
 *     inverse, target -= sourceDelta × damping
 *
 * Cycle safety: MAX_PROPAGATION_DEPTH bounds cascade.
 * Damping: signal weakens each hop (× 0.7 default).
 */

const { db } = require('../../database');

const MAX_PROPAGATION_DEPTH = 5;
const EDGE_STRENGTH_DEFAULT = 0.8;
const PROPAGATION_DAMPING_FACTOR = 0.7;
const MIN_BELIEF_DELTA_TO_PROPAGATE = 0.05;

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`beliefPropagation: missing ${key}`);
    }
    return params[key];
}

function _clamp01(x) {
    return Math.max(0, Math.min(1, x));
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    getThesisRow: db.prepare(`
        SELECT * FROM ml_thesis_graphs WHERE thesis_id = ?
    `),
    updateThesisNodes: db.prepare(`
        UPDATE ml_thesis_graphs
        SET nodes_json = ?, last_updated = ?
        WHERE thesis_id = ?
    `),
    insertPropagationLog: db.prepare(`
        INSERT INTO ml_belief_propagation_log
        (user_id, resolved_env, thesis_id, source_node_id,
         source_old_conf, source_new_conf,
         propagation_chain_json, propagation_depth, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    historyForUser: db.prepare(`
        SELECT * FROM ml_belief_propagation_log
        WHERE user_id = ? AND resolved_env = ?
          AND (? = '' OR thesis_id = ?)
          AND (? = 0 OR ts >= ?)
        ORDER BY ts DESC, id DESC
        LIMIT ?
    `),
    statsForUser: db.prepare(`
        SELECT AVG(propagation_depth) AS avg_depth,
               COUNT(*) AS total_events,
               AVG(LENGTH(propagation_chain_json)) AS avg_chain_length
        FROM ml_belief_propagation_log
        WHERE user_id = ? AND resolved_env = ?
          AND ts >= ?
    `)
};

// ── computeBeliefUpdate (pure) ─────────────────────────────────────
function computeBeliefUpdate(params) {
    const sourceConfChange = _required(params, 'sourceConfChange');
    const relation = _required(params, 'relation');
    const edgeStrength = (params && typeof params.edgeStrength === 'number')
        ? params.edgeStrength : EDGE_STRENGTH_DEFAULT;

    if (relation === 'requires') {
        // requires: target depends on source; if source drops, target hurts
        // if source rises, target stays (already required so no benefit)
        if (sourceConfChange < 0) {
            return sourceConfChange * edgeStrength * PROPAGATION_DAMPING_FACTOR;
        }
        return 0;
    }
    if (relation === 'supports') {
        // supports: bidirectional dampening
        return sourceConfChange * edgeStrength * PROPAGATION_DAMPING_FACTOR;
    }
    if (relation === 'invalidates') {
        // invalidates: inverse — source up → target down
        return -sourceConfChange * edgeStrength * PROPAGATION_DAMPING_FACTOR;
    }
    return 0;
}

// ── _propagateBFS (internal) ───────────────────────────────────────
function _propagateBFS(nodes, edges, sourceNodeId, sourceOldConf, sourceNewConf, maxDepth) {
    const chain = [];
    const visited = new Set([sourceNodeId]);
    const nodeMap = {};
    for (const n of nodes) nodeMap[n.nodeId] = n;

    // Apply source change first
    if (nodeMap[sourceNodeId]) {
        nodeMap[sourceNodeId].confidence = sourceNewConf;
    }

    // BFS layers
    let currentLayer = [{
        nodeId: sourceNodeId,
        confDelta: sourceNewConf - sourceOldConf,
        depth: 0
    }];

    while (currentLayer.length > 0) {
        const nextLayer = [];
        for (const cur of currentLayer) {
            if (cur.depth >= maxDepth) continue;
            if (Math.abs(cur.confDelta) < MIN_BELIEF_DELTA_TO_PROPAGATE) continue;

            // Find outgoing edges
            for (const e of edges) {
                if (e.from !== cur.nodeId) continue;
                if (visited.has(e.to)) continue;
                const target = nodeMap[e.to];
                if (!target) continue;

                const edgeStrength = (typeof e.strength === 'number') ? e.strength : EDGE_STRENGTH_DEFAULT;
                const update = computeBeliefUpdate({
                    sourceConfChange: cur.confDelta,
                    relation: e.relation,
                    edgeStrength
                });

                if (Math.abs(update) < MIN_BELIEF_DELTA_TO_PROPAGATE) continue;

                const oldConf = target.confidence;
                target.confidence = _clamp01(target.confidence + update);
                const actualDelta = target.confidence - oldConf;

                chain.push({
                    nodeId: e.to,
                    relation: e.relation,
                    oldConf,
                    newConf: target.confidence,
                    delta: actualDelta,
                    depth: cur.depth + 1
                });

                visited.add(e.to);
                nextLayer.push({
                    nodeId: e.to,
                    confDelta: actualDelta,
                    depth: cur.depth + 1
                });
            }
        }
        currentLayer = nextLayer;
    }

    const finalDepth = chain.length > 0 ? Math.max(...chain.map(c => c.depth)) : 0;
    return { nodes, chain, depth: finalDepth };
}

// ── propagateNodeChange ────────────────────────────────────────────
function propagateNodeChange(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const thesisId = _required(params, 'thesisId');
    const nodeId = _required(params, 'nodeId');
    const newConfidence = _required(params, 'newConfidence');
    const maxDepth = (params && params.maxDepth) ? params.maxDepth : MAX_PROPAGATION_DEPTH;
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (typeof newConfidence !== 'number' || newConfidence < 0 || newConfidence > 1) {
        throw new Error('beliefPropagation: newConfidence must be in [0,1]');
    }

    const row = _stmts.getThesisRow.get(thesisId);
    if (!row) {
        throw new Error(`beliefPropagation: thesis "${thesisId}" not found`);
    }

    const nodes = JSON.parse(row.nodes_json);
    const edges = JSON.parse(row.edges_json);
    const sourceNode = nodes.find(n => n.nodeId === nodeId);
    if (!sourceNode) {
        throw new Error(`beliefPropagation: node "${nodeId}" not found in thesis`);
    }
    const sourceOldConf = sourceNode.confidence;

    const result = _propagateBFS(
        nodes, edges, nodeId, sourceOldConf, newConfidence, maxDepth
    );

    // Persist updated nodes
    _stmts.updateThesisNodes.run(JSON.stringify(result.nodes), ts, thesisId);

    // Log propagation event
    _stmts.insertPropagationLog.run(
        userId, env, thesisId, nodeId,
        sourceOldConf, newConfidence,
        JSON.stringify(result.chain),
        result.depth, ts
    );

    return {
        propagated: true,
        chain: result.chain,
        depth: result.depth,
        nodesAffected: result.chain.length
    };
}

// ── simulatePropagation (pure dry-run) ─────────────────────────────
function simulatePropagation(params) {
    const nodes = _required(params, 'nodes');
    const edges = _required(params, 'edges');
    const sourceNodeId = _required(params, 'sourceNodeId');
    const newConfidence = _required(params, 'newConfidence');
    const maxDepth = (params && params.maxDepth) ? params.maxDepth : MAX_PROPAGATION_DEPTH;

    // Deep clone to avoid mutation
    const clonedNodes = nodes.map(n => Object.assign({}, n));
    const source = clonedNodes.find(n => n.nodeId === sourceNodeId);
    if (!source) {
        throw new Error(`beliefPropagation: sourceNodeId "${sourceNodeId}" not in nodes`);
    }
    const sourceOldConf = source.confidence;

    return _propagateBFS(
        clonedNodes, edges, sourceNodeId, sourceOldConf, newConfidence, maxDepth
    );
}

// ── recordPropagationEvent ─────────────────────────────────────────
function recordPropagationEvent(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const thesisId = _required(params, 'thesisId');
    const sourceNodeId = _required(params, 'sourceNodeId');
    const sourceOldConf = _required(params, 'sourceOldConf');
    const sourceNewConf = _required(params, 'sourceNewConf');
    const chain = _required(params, 'chain');
    const depth = _required(params, 'depth');
    const ts = (params && params.ts) ? params.ts : Date.now();

    _stmts.insertPropagationLog.run(
        userId, env, thesisId, sourceNodeId,
        sourceOldConf, sourceNewConf,
        JSON.stringify(chain), depth, ts
    );
    return { recorded: true };
}

// ── getPropagationHistory ──────────────────────────────────────────
function getPropagationHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const thesisId = (params && params.thesisId) ? params.thesisId : '';
    const since = (params && params.since) ? params.since : 0;
    const limit = (params && params.limit) ? params.limit : 100;
    return _stmts.historyForUser.all(
        userId, env,
        thesisId, thesisId,
        since > 0 ? 1 : 0, since,
        limit
    );
}

// ── getPropagationStats ────────────────────────────────────────────
function getPropagationStats(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const lookbackDays = (params && params.lookbackDays) ? params.lookbackDays : 30;

    const since = Date.now() - lookbackDays * 86400000;
    const row = _stmts.statsForUser.get(userId, env, since);
    return {
        totalEvents: row ? row.total_events : 0,
        avgDepth: row && row.avg_depth !== null ? row.avg_depth : 0,
        avgChainLengthBytes: row && row.avg_chain_length !== null ? row.avg_chain_length : 0
    };
}

module.exports = {
    MAX_PROPAGATION_DEPTH,
    EDGE_STRENGTH_DEFAULT,
    PROPAGATION_DAMPING_FACTOR,
    MIN_BELIEF_DELTA_TO_PROPAGATE,
    computeBeliefUpdate,
    propagateNodeChange,
    simulatePropagation,
    recordPropagationEvent,
    getPropagationHistory,
    getPropagationStats
};
