'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p98-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const dg = require('../../../server/services/ml/R3A_safety/dependencyGraphBlastRadius');

const TEST_USER = 9098;
const OTHER_USER = 9099;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_dependency_nodes WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
    db.prepare('DELETE FROM ml_dependency_edges WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§98 Migrations 185 + 186', () => {
    test('node_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_dependency_nodes
             (user_id, resolved_env, node_id, node_type, name, owner,
              blast_radius_score, criticality, is_active, ts)
             VALUES (?, ?, 'N-UNIQ', 'feed', 'n', 'op', 0, 'critical', 1, ?)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_dependency_nodes
             (user_id, resolved_env, node_id, node_type, name, owner,
              blast_radius_score, criticality, is_active, ts)
             VALUES (?, ?, 'N-UNIQ', 'detector', 'n2', 'op2', 0, 'critical', 1, ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('CHECK node_type restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_dependency_nodes
             (user_id, resolved_env, node_id, node_type, name, owner,
              blast_radius_score, criticality, is_active, ts)
             VALUES (?, ?, 'N-BAD', 'BOGUS', 'n', 'op', 0, 'critical', 1, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK edge strength in [0,1]', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_dependency_edges
             (user_id, resolved_env, edge_id, from_node_id,
              to_node_id, edge_type, strength, ts)
             VALUES (?, ?, 'E-BAD', 'A', 'B', 'feeds', 1.5, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK criticality restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_dependency_nodes
             (user_id, resolved_env, node_id, node_type, name, owner,
              blast_radius_score, criticality, is_active, ts)
             VALUES (?, ?, 'N-CRIT', 'feed', 'n', 'op', 0, 'BOGUS', 1, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§98 Constants', () => {
    test('NODE_TYPES has 6 entries', () => {
        expect(dg.NODE_TYPES).toHaveLength(6);
    });

    test('CRITICALITY_LEVELS ordered weights', () => {
        expect(dg.CRITICALITY_WEIGHTS.critical)
            .toBeGreaterThan(dg.CRITICALITY_WEIGHTS.important);
        expect(dg.CRITICALITY_WEIGHTS.important)
            .toBeGreaterThan(dg.CRITICALITY_WEIGHTS.optional);
    });

    test('EDGE_TYPES has 3 entries', () => {
        expect(dg.EDGE_TYPES).toEqual(['depends_on', 'feeds', 'monitors']);
    });
});

describe('§98 registerNode', () => {
    test('persists', () => {
        const r = dg.registerNode({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            nodeId: 'NODE-1', nodeType: 'feed',
            name: 'binance_ws', owner: 'ops', criticality: 'critical'
        });
        expect(r.registered).toBe(true);
    });

    test('duplicate throws', () => {
        dg.registerNode({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            nodeId: 'N-DUP', nodeType: 'feed',
            name: 'n', owner: 'op', criticality: 'critical'
        });
        expect(() => dg.registerNode({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            nodeId: 'N-DUP', nodeType: 'detector',
            name: 'n2', owner: 'op2', criticality: 'optional'
        })).toThrow();
    });

    test('invalid nodeType throws', () => {
        expect(() => dg.registerNode({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            nodeId: 'N-BAD', nodeType: 'BOGUS',
            name: 'n', owner: 'op', criticality: 'critical'
        })).toThrow();
    });
});

describe('§98 registerDependency', () => {
    test('persists', () => {
        const r = dg.registerDependency({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            edgeId: 'E-1', fromNodeId: 'A', toNodeId: 'B',
            edgeType: 'feeds', strength: 0.8
        });
        expect(r.registered).toBe(true);
    });

    test('strength > 1 throws', () => {
        expect(() => dg.registerDependency({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            edgeId: 'E-BAD', fromNodeId: 'A', toNodeId: 'B',
            edgeType: 'feeds', strength: 1.5
        })).toThrow();
    });
});

describe('§98 computeBlastRadius (pure)', () => {
    test('isolated node has zero blast', () => {
        const r = dg.computeBlastRadius({
            nodeId: 'X', allNodes: [{ nodeId: 'X', criticality: 'critical' }],
            allEdges: []
        });
        expect(r.blastRadius).toBe(0);
        expect(r.affectedNodeCount).toBe(0);
    });

    test('chain accumulates weighted blast', () => {
        const nodes = [
            { nodeId: 'A', criticality: 'critical' },
            { nodeId: 'B', criticality: 'critical' },
            { nodeId: 'C', criticality: 'important' }
        ];
        const edges = [
            { fromNodeId: 'A', toNodeId: 'B', strength: 1.0 },
            { fromNodeId: 'B', toNodeId: 'C', strength: 1.0 }
        ];
        const r = dg.computeBlastRadius({
            nodeId: 'A', allNodes: nodes, allEdges: edges
        });
        // B: 1.0 × 1.0 (critical) = 1.0; C: 1.0 × 0.5 (important) = 0.5
        expect(r.affectedNodeCount).toBe(2);
        expect(r.blastRadius).toBeCloseTo(1.5);
    });

    test('depth limit cuts off cascade', () => {
        const nodes = [
            { nodeId: 'A', criticality: 'critical' },
            { nodeId: 'B', criticality: 'critical' },
            { nodeId: 'C', criticality: 'critical' }
        ];
        const edges = [
            { fromNodeId: 'A', toNodeId: 'B', strength: 1.0 },
            { fromNodeId: 'B', toNodeId: 'C', strength: 1.0 }
        ];
        const r = dg.computeBlastRadius({
            nodeId: 'A', allNodes: nodes, allEdges: edges, maxDepth: 1
        });
        expect(r.affectedNodeCount).toBe(1);   // only B
    });
});

describe('§98 detectSinglePointsOfFailure', () => {
    test('flags critical node with high blast', () => {
        dg.registerNode({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            nodeId: 'FEED', nodeType: 'feed',
            name: 'binance', owner: 'ops', criticality: 'critical'
        });
        dg.registerNode({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            nodeId: 'DET-1', nodeType: 'detector',
            name: 'd1', owner: 'ops', criticality: 'critical'
        });
        dg.registerNode({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            nodeId: 'DET-2', nodeType: 'detector',
            name: 'd2', owner: 'ops', criticality: 'critical'
        });
        dg.registerDependency({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            edgeId: 'E-FD1', fromNodeId: 'FEED', toNodeId: 'DET-1',
            edgeType: 'feeds', strength: 1.0
        });
        dg.registerDependency({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            edgeId: 'E-FD2', fromNodeId: 'FEED', toNodeId: 'DET-2',
            edgeType: 'feeds', strength: 1.0
        });
        const spofs = dg.detectSinglePointsOfFailure({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(spofs.some(s => s.nodeId === 'FEED')).toBe(true);
    });

    test('ignores non-critical nodes', () => {
        dg.registerNode({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            nodeId: 'OPT', nodeType: 'monitoring',
            name: 'opt', owner: 'ops', criticality: 'optional'
        });
        const spofs = dg.detectSinglePointsOfFailure({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(spofs.some(s => s.nodeId === 'OPT')).toBe(false);
    });
});

describe('§98 simulateFailure', () => {
    test('cascades downstream', () => {
        dg.registerNode({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            nodeId: 'F-A', nodeType: 'feed', name: 'a',
            owner: 'ops', criticality: 'critical'
        });
        dg.registerNode({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            nodeId: 'F-B', nodeType: 'detector', name: 'b',
            owner: 'ops', criticality: 'important'
        });
        dg.registerDependency({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            edgeId: 'F-EAB', fromNodeId: 'F-A', toNodeId: 'F-B',
            edgeType: 'feeds', strength: 1.0
        });
        const r = dg.simulateFailure({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            failedNodeIds: ['F-A']
        });
        expect(r.totalAffected).toBe(2);
        expect(r.affectedNodes).toContain('F-B');
    });

    test('empty failedNodeIds throws', () => {
        expect(() => dg.simulateFailure({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            failedNodeIds: []
        })).toThrow();
    });
});

describe('§98 getCriticalPath', () => {
    test('finds shortest path A→B→C', () => {
        dg.registerDependency({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            edgeId: 'CP-1', fromNodeId: 'P-A', toNodeId: 'P-B',
            edgeType: 'feeds', strength: 1.0
        });
        dg.registerDependency({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            edgeId: 'CP-2', fromNodeId: 'P-B', toNodeId: 'P-C',
            edgeType: 'feeds', strength: 1.0
        });
        const r = dg.getCriticalPath({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            fromNodeId: 'P-A', toNodeId: 'P-C'
        });
        expect(r.found).toBe(true);
        expect(r.path).toEqual(['P-A', 'P-B', 'P-C']);
    });

    test('returns not-found for disconnected', () => {
        const r = dg.getCriticalPath({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            fromNodeId: 'X', toNodeId: 'Y'
        });
        expect(r.found).toBe(false);
    });
});

describe('§98 isolation', () => {
    test('per (user × env) isolation', () => {
        dg.registerNode({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            nodeId: 'ISO-1', nodeType: 'feed', name: 'n',
            owner: 'ops', criticality: 'critical'
        });
        const a = dg.detectSinglePointsOfFailure({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const b = dg.detectSinglePointsOfFailure({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        // a may have SPOFs from earlier tests, but b should be empty
        expect(b).toEqual([]);
    });
});
