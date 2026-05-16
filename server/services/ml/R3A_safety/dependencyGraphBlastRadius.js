'use strict';

/**
 * OMEGA R3A Safety — dependencyGraphBlastRadius (canonical §98)
 *
 * §98 OPERATIONAL DEPENDENCY GRAPH / BLAST RADIUS ENGINE.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 2524-2566.
 *
 * "Un sistem live nu moare doar dintr-un bug direct... combinatii de
 *  dependinte... dependency graph operational explicit... blast radius
 *  score per componenta... SPOF detection... critical path identification...
 *  failover priority order... 'daca pica asta, ce altceva moare odata cu el?'"
 *
 * R3A safety; complementary to §28 positionReconciliation, §29 circuitBreaker,
 * §30 portfolioGovernance.
 */

const { db } = require('../../database');

const NODE_TYPES = Object.freeze([
    'feed', 'detector', 'model', 'execution_path',
    'safety_module', 'monitoring'
]);
const CRITICALITY_LEVELS = Object.freeze([
    'critical', 'important', 'optional'
]);
const EDGE_TYPES = Object.freeze(['depends_on', 'feeds', 'monitors']);

const CRITICALITY_WEIGHTS = Object.freeze({
    critical: 1.0, important: 0.5, optional: 0.2
});

const SPOF_BLAST_THRESHOLD = 0.50;
const DEFAULT_CASCADE_DEPTH = 5;

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`dependencyGraphBlastRadius: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertNode: db.prepare(`
        INSERT INTO ml_dependency_nodes
        (user_id, resolved_env, node_id, node_type, name, owner,
         blast_radius_score, criticality, is_active, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `),
    getNode: db.prepare(`
        SELECT * FROM ml_dependency_nodes WHERE node_id = ?
    `),
    listNodes: db.prepare(`
        SELECT * FROM ml_dependency_nodes
        WHERE user_id = ? AND resolved_env = ? AND is_active = 1
    `),
    insertEdge: db.prepare(`
        INSERT INTO ml_dependency_edges
        (user_id, resolved_env, edge_id, from_node_id,
         to_node_id, edge_type, strength, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listEdges: db.prepare(`
        SELECT * FROM ml_dependency_edges
        WHERE user_id = ? AND resolved_env = ?
    `),
    listEdgesFrom: db.prepare(`
        SELECT * FROM ml_dependency_edges
        WHERE user_id = ? AND resolved_env = ? AND from_node_id = ?
    `)
};

// ── registerNode ───────────────────────────────────────────────────
function registerNode(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const nodeId = _required(params, 'nodeId');
    const nodeType = _required(params, 'nodeType');
    if (!NODE_TYPES.includes(nodeType)) {
        throw new Error(`dependencyGraphBlastRadius: invalid nodeType "${nodeType}"`);
    }
    const name = _required(params, 'name');
    const owner = _required(params, 'owner');
    const criticality = _required(params, 'criticality');
    if (!CRITICALITY_LEVELS.includes(criticality)) {
        throw new Error(`dependencyGraphBlastRadius: invalid criticality "${criticality}"`);
    }
    const initialBlastRadius = (params && params.initialBlastRadius !== undefined)
        ? params.initialBlastRadius : 0;
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertNode.run(
            userId, env, nodeId, nodeType, name, owner,
            initialBlastRadius, criticality, ts
        );
        return { registered: true, nodeId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`dependencyGraphBlastRadius: duplicate nodeId "${nodeId}"`);
        }
        throw err;
    }
}

// ── registerDependency ─────────────────────────────────────────────
function registerDependency(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const edgeId = _required(params, 'edgeId');
    const fromNodeId = _required(params, 'fromNodeId');
    const toNodeId = _required(params, 'toNodeId');
    const edgeType = _required(params, 'edgeType');
    if (!EDGE_TYPES.includes(edgeType)) {
        throw new Error(`dependencyGraphBlastRadius: invalid edgeType "${edgeType}"`);
    }
    const strength = (params && params.strength !== undefined) ? params.strength : 1.0;
    if (strength < 0 || strength > 1) {
        throw new Error('dependencyGraphBlastRadius: strength must be in [0,1]');
    }
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertEdge.run(
            userId, env, edgeId, fromNodeId, toNodeId,
            edgeType, strength, ts
        );
        return { registered: true, edgeId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`dependencyGraphBlastRadius: duplicate edgeId "${edgeId}"`);
        }
        throw err;
    }
}

// ── computeBlastRadius (pure) ──────────────────────────────────────
// BFS downstream from nodeId, accumulate strength × criticality_weight.
function computeBlastRadius(params) {
    const nodeId = _required(params, 'nodeId');
    const allNodes = _required(params, 'allNodes');
    const allEdges = _required(params, 'allEdges');
    const maxDepth = (params && params.maxDepth !== undefined)
        ? params.maxDepth : DEFAULT_CASCADE_DEPTH;

    const nodeMap = new Map();
    for (const n of allNodes) nodeMap.set(n.nodeId || n.node_id, n);

    const adjacency = new Map();
    for (const e of allEdges) {
        const from = e.fromNodeId || e.from_node_id;
        const to = e.toNodeId || e.to_node_id;
        const strength = e.strength;
        if (!adjacency.has(from)) adjacency.set(from, []);
        adjacency.get(from).push({ to, strength });
    }

    const visited = new Set([nodeId]);
    const affected = new Set();
    const queue = [{ id: nodeId, depth: 0, pathStrength: 1.0 }];
    let totalBlast = 0;

    while (queue.length > 0) {
        const { id, depth, pathStrength } = queue.shift();
        if (depth >= maxDepth) continue;
        const neighbors = adjacency.get(id) || [];
        for (const { to, strength } of neighbors) {
            if (visited.has(to)) continue;
            visited.add(to);
            const newPath = pathStrength * strength;
            const dependentNode = nodeMap.get(to);
            if (dependentNode) {
                const crit = dependentNode.criticality || 'optional';
                const weight = CRITICALITY_WEIGHTS[crit];
                totalBlast += newPath * weight;
                affected.add(to);
            }
            queue.push({ id: to, depth: depth + 1, pathStrength: newPath });
        }
    }

    return {
        nodeId, blastRadius: totalBlast,
        affectedNodeCount: affected.size,
        affectedNodes: Array.from(affected)
    };
}

// ── detectSinglePointsOfFailure ────────────────────────────────────
function detectSinglePointsOfFailure(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const blastThreshold = (params && params.blastThreshold !== undefined)
        ? params.blastThreshold : SPOF_BLAST_THRESHOLD;

    const nodes = _stmts.listNodes.all(userId, env).map(n => ({
        nodeId: n.node_id, criticality: n.criticality,
        nodeType: n.node_type, name: n.name
    }));
    const edges = _stmts.listEdges.all(userId, env).map(e => ({
        fromNodeId: e.from_node_id, toNodeId: e.to_node_id, strength: e.strength
    }));

    const spofs = [];
    for (const n of nodes) {
        if (n.criticality !== 'critical') continue;
        const r = computeBlastRadius({
            nodeId: n.nodeId, allNodes: nodes, allEdges: edges
        });
        if (r.blastRadius >= blastThreshold) {
            spofs.push({
                nodeId: n.nodeId, name: n.name, nodeType: n.nodeType,
                blastRadius: r.blastRadius,
                affectedNodeCount: r.affectedNodeCount
            });
        }
    }
    spofs.sort((a, b) => b.blastRadius - a.blastRadius);
    return spofs;
}

// ── simulateFailure ────────────────────────────────────────────────
function simulateFailure(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const failedNodeIds = _required(params, 'failedNodeIds');
    const cascadeDepth = (params && params.cascadeDepth !== undefined)
        ? params.cascadeDepth : DEFAULT_CASCADE_DEPTH;

    if (!Array.isArray(failedNodeIds) || failedNodeIds.length === 0) {
        throw new Error('dependencyGraphBlastRadius: failedNodeIds must be non-empty array');
    }

    const nodes = _stmts.listNodes.all(userId, env).map(n => ({
        nodeId: n.node_id, criticality: n.criticality,
        nodeType: n.node_type, name: n.name
    }));
    const edges = _stmts.listEdges.all(userId, env).map(e => ({
        fromNodeId: e.from_node_id, toNodeId: e.to_node_id, strength: e.strength
    }));

    const affected = new Set(failedNodeIds);
    const queue = failedNodeIds.map(id => ({ id, depth: 0 }));
    while (queue.length > 0) {
        const { id, depth } = queue.shift();
        if (depth >= cascadeDepth) continue;
        for (const e of edges) {
            if (e.fromNodeId === id && !affected.has(e.toNodeId)) {
                affected.add(e.toNodeId);
                queue.push({ id: e.toNodeId, depth: depth + 1 });
            }
        }
    }

    return {
        seedNodes: failedNodeIds,
        affectedNodes: Array.from(affected),
        totalAffected: affected.size,
        cascadeDepth
    };
}

// ── getCriticalPath ────────────────────────────────────────────────
function getCriticalPath(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const fromNodeId = _required(params, 'fromNodeId');
    const toNodeId = _required(params, 'toNodeId');

    const edges = _stmts.listEdges.all(userId, env);
    const adjacency = new Map();
    for (const e of edges) {
        if (!adjacency.has(e.from_node_id)) adjacency.set(e.from_node_id, []);
        adjacency.get(e.from_node_id).push(e.to_node_id);
    }

    // BFS shortest path
    if (fromNodeId === toNodeId) {
        return { found: true, path: [fromNodeId], length: 0 };
    }
    const visited = new Set([fromNodeId]);
    const queue = [{ id: fromNodeId, path: [fromNodeId] }];
    while (queue.length > 0) {
        const { id, path } = queue.shift();
        const neighbors = adjacency.get(id) || [];
        for (const n of neighbors) {
            if (visited.has(n)) continue;
            visited.add(n);
            const newPath = [...path, n];
            if (n === toNodeId) {
                return { found: true, path: newPath, length: newPath.length - 1 };
            }
            queue.push({ id: n, path: newPath });
        }
    }
    return { found: false, path: null, length: -1 };
}

module.exports = {
    NODE_TYPES,
    CRITICALITY_LEVELS,
    EDGE_TYPES,
    CRITICALITY_WEIGHTS,
    SPOF_BLAST_THRESHOLD,
    DEFAULT_CASCADE_DEPTH,
    registerNode,
    registerDependency,
    computeBlastRadius,
    detectSinglePointsOfFailure,
    simulateFailure,
    getCriticalPath
};
