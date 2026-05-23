'use strict';

/**
 * OMEGA R2 Cognition — topologicalAnalyzer (canonical §91)
 *
 * §91 TOPOLOGICAL DATA ANALYSIS.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt line 2372.
 *
 * "Preturile formeaza bucle, goluri si componente conexe in spatiul feature-urilor...
 *  Persistent homology detecteaza cand structura topologica a pietei se transforma
 *  fundamental, chiar daca media si varianta par normale... Un squeeze pre-explozie
 *  are o topologie diferita de un range sanatos cu statistici similare... TDA
 *  detecteaza correlations breakdown — cand activele care se miscau impreuna topologic
 *  incep sa se separe, inainte ca correlation matrix sa o confirme numeric."
 *
 * Pragmatic implementation (NO external lib): Betti numbers via union-find on
 * eps-neighborhood graph (B0=connected components) + cycle approximation (B1=loops).
 * Distinct from §21 driftDetection (statistical) and §31 smartMoneyDetector (flow).
 */

const { db } = require('../../database');

const TRANSITION_TYPES = Object.freeze([
    'STABLE', 'REGIME_SHIFT', 'CORRELATION_BREAKDOWN'
]);

const DEFAULT_EPSILON = 0.30;
const MIN_POINTS_FOR_TOPOLOGY = 5;
const BETTI_SHIFT_THRESHOLD = 2;

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`topologicalAnalyzer: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertSnapshot: db.prepare(`
        INSERT INTO ml_topology_snapshots
        (user_id, resolved_env, snapshot_id, feature_window_size,
         betti_0, betti_1, persistence_diagram_json, regime_label, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getSnapshot: db.prepare(`
        SELECT * FROM ml_topology_snapshots WHERE snapshot_id = ?
    `),
    listSnapshots: db.prepare(`
        SELECT * FROM ml_topology_snapshots
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC LIMIT ?
    `),
    insertTransition: db.prepare(`
        INSERT INTO ml_topology_transitions
        (user_id, resolved_env, transition_id, from_snapshot_id,
         to_snapshot_id, betti_delta_json, transition_type, severity, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
};

// ── buildPointCloud (pure) ─────────────────────────────────────────
function buildPointCloud(params) {
    const features = _required(params, 'features');
    const normalize = (params && params.normalize !== false);

    if (!Array.isArray(features) || features.length === 0) {
        return { points: [], dim: 0 };
    }
    const dim = features[0].length;
    if (!normalize) {
        return { points: features.map(f => [...f]), dim };
    }

    const mins = new Array(dim).fill(Infinity);
    const maxs = new Array(dim).fill(-Infinity);
    for (const f of features) {
        for (let i = 0; i < dim; i++) {
            if (f[i] < mins[i]) mins[i] = f[i];
            if (f[i] > maxs[i]) maxs[i] = f[i];
        }
    }
    const points = features.map(f => {
        const out = new Array(dim);
        for (let i = 0; i < dim; i++) {
            const range = maxs[i] - mins[i];
            out[i] = range > 0 ? (f[i] - mins[i]) / range : 0.5;
        }
        return out;
    });
    return { points, dim };
}

function _euclidean(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) {
        const d = a[i] - b[i];
        s += d * d;
    }
    return Math.sqrt(s);
}

// ── computeBettiNumbers (pure) ─────────────────────────────────────
function computeBettiNumbers(params) {
    const pointCloud = _required(params, 'pointCloud');
    const epsilon = (params && params.epsilon !== undefined)
        ? params.epsilon : DEFAULT_EPSILON;

    const points = pointCloud.points || pointCloud;
    const n = points.length;
    if (n < MIN_POINTS_FOR_TOPOLOGY) {
        return { betti0: n, betti1: 0, edges: 0, sufficient: false };
    }

    // Union-Find for B0 (connected components)
    const parent = new Array(n);
    for (let i = 0; i < n; i++) parent[i] = i;
    function find(x) {
        while (parent[x] !== x) {
            parent[x] = parent[parent[x]];
            x = parent[x];
        }
        return x;
    }
    function union(x, y) {
        const rx = find(x), ry = find(y);
        if (rx !== ry) { parent[rx] = ry; return true; }
        return false;
    }

    let edges = 0;
    const adjacency = Array.from({ length: n }, () => []);
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            if (_euclidean(points[i], points[j]) <= epsilon) {
                union(i, j);
                edges++;
                adjacency[i].push(j);
                adjacency[j].push(i);
            }
        }
    }

    const roots = new Set();
    for (let i = 0; i < n; i++) roots.add(find(i));
    const betti0 = roots.size;

    // B1 approximation via Euler characteristic for 1-complex:
    // V - E + F = chi; for graph: chi = V - E; B0 - B1 = chi → B1 = E - V + B0
    // This counts independent cycles (loops) in the eps-graph.
    const betti1 = Math.max(0, edges - n + betti0);

    return { betti0, betti1, edges, sufficient: true, epsilon };
}

// ── recordTopologySnapshot ─────────────────────────────────────────
function recordTopologySnapshot(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const snapshotId = _required(params, 'snapshotId');
    const featureWindow = _required(params, 'featureWindowSize');
    const bettiNumbers = _required(params, 'bettiNumbers');
    const regimeLabel = (params && params.regimeLabel) ? params.regimeLabel : null;
    const persistenceDiagram = (params && params.persistenceDiagram)
        ? JSON.stringify(params.persistenceDiagram) : null;
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertSnapshot.run(
            userId, env, snapshotId, featureWindow,
            bettiNumbers.betti0, bettiNumbers.betti1,
            persistenceDiagram, regimeLabel, ts
        );
        return { recorded: true, snapshotId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`topologicalAnalyzer: duplicate snapshotId "${snapshotId}"`);
        }
        throw err;
    }
}

// ── detectTopologyTransition ───────────────────────────────────────
function detectTopologyTransition(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const fromId = _required(params, 'fromSnapshotId');
    const toId = _required(params, 'toSnapshotId');
    const transitionId = _required(params, 'transitionId');
    const ts = (params && params.ts) ? params.ts : Date.now();

    const from = _stmts.getSnapshot.get(fromId);
    const to = _stmts.getSnapshot.get(toId);
    if (!from || !to) {
        throw new Error('topologicalAnalyzer: snapshot not found');
    }
    if (from.user_id !== userId || to.user_id !== userId ||
        from.resolved_env !== env || to.resolved_env !== env) {
        throw new Error('topologicalAnalyzer: snapshots not owned by user/env');
    }

    const dB0 = to.betti_0 - from.betti_0;
    const dB1 = to.betti_1 - from.betti_1;
    const absMagnitude = Math.abs(dB0) + Math.abs(dB1);

    let transitionType;
    if (dB0 >= BETTI_SHIFT_THRESHOLD && dB1 < 0) {
        // components increased while loops collapsed = correlation breakdown
        transitionType = 'CORRELATION_BREAKDOWN';
    } else if (absMagnitude >= BETTI_SHIFT_THRESHOLD) {
        transitionType = 'REGIME_SHIFT';
    } else {
        transitionType = 'STABLE';
    }

    const severity = absMagnitude / (from.betti_0 + from.betti_1 + 1);
    const deltaJson = JSON.stringify({ dB0, dB1, absMagnitude });

    _stmts.insertTransition.run(
        userId, env, transitionId, fromId, toId,
        deltaJson, transitionType, severity, ts
    );

    return { transitionType, dB0, dB1, severity };
}

// ── evaluateCorrelationBreakdown ───────────────────────────────────
function evaluateCorrelationBreakdown(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const currentBetti = _required(params, 'currentBettiNumbers');
    const historicalSnapshotId = _required(params, 'historicalSnapshotId');
    const separationThreshold = (params && params.separationThreshold !== undefined)
        ? params.separationThreshold : BETTI_SHIFT_THRESHOLD;

    const hist = _stmts.getSnapshot.get(historicalSnapshotId);
    if (!hist) {
        throw new Error(`topologicalAnalyzer: historical snapshot "${historicalSnapshotId}" not found`);
    }
    if (hist.user_id !== userId || hist.resolved_env !== env) {
        throw new Error('topologicalAnalyzer: historical snapshot not owned by user/env');
    }

    const dB0 = currentBetti.betti0 - hist.betti_0;
    // breakdown signal: components rising = active separating from cluster
    const breakdownDetected = dB0 >= separationThreshold;
    return {
        breakdownDetected,
        dB0,
        historicalBetti0: hist.betti_0,
        currentBetti0: currentBetti.betti0,
        reason: breakdownDetected
            ? 'components increased — topological separation precedes statistical correlation drop'
            : 'topology stable'
    };
}

// ── getSnapshotHistory ─────────────────────────────────────────────
function getSnapshotHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const limit = (params && params.limit) ? params.limit : 100;

    const rows = _stmts.listSnapshots.all(userId, env, limit);
    return rows.map(r => ({
        snapshotId: r.snapshot_id,
        featureWindowSize: r.feature_window_size,
        betti0: r.betti_0,
        betti1: r.betti_1,
        regimeLabel: r.regime_label,
        ts: r.ts
    }));
}

module.exports = {
    TRANSITION_TYPES,
    DEFAULT_EPSILON,
    MIN_POINTS_FOR_TOPOLOGY,
    BETTI_SHIFT_THRESHOLD,
    buildPointCloud,
    computeBettiNumbers,
    recordTopologySnapshot,
    detectTopologyTransition,
    evaluateCorrelationBreakdown,
    getSnapshotHistory
};
