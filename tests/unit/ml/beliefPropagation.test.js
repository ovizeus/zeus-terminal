'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p75-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const tg = require('../../../server/services/ml/R2_cognition/thesisGraphEngine');
const bp = require('../../../server/services/ml/R2_cognition/beliefPropagation');

const TEST_USER = 9075;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_belief_propagation_log WHERE user_id IN (?, ?)').run(TEST_USER, 9076);
    db.prepare('DELETE FROM ml_thesis_graphs WHERE user_id IN (?, ?)').run(TEST_USER, 9076);
}

function buildThesis(thesisId, nodeConfs = [0.9, 0.8, 0.7]) {
    tg.createThesisGraph({
        userId: TEST_USER, resolvedEnv: TEST_ENV,
        thesisId, positionId: 'POS-' + thesisId,
        nodes: [
            { nodeId: 'A', type: 'context', confidence: nodeConfs[0] },
            { nodeId: 'B', type: 'liquidity', confidence: nodeConfs[1] },
            { nodeId: 'C', type: 'macro', confidence: nodeConfs[2] }
        ],
        edges: [
            { from: 'A', to: 'B', relation: 'requires' },
            { from: 'B', to: 'C', relation: 'supports' }
        ]
    });
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§75 Migration 141', () => {
    test('ml_belief_propagation_log exists', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_belief_propagation_log)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'thesis_id', 'source_node_id', 'source_old_conf',
            'source_new_conf', 'propagation_chain_json',
            'propagation_depth', 'ts'
        ]));
    });
});

describe('§75 Constants', () => {
    test('MAX_PROPAGATION_DEPTH positive', () => {
        expect(bp.MAX_PROPAGATION_DEPTH).toBeGreaterThan(0);
    });

    test('damping in (0,1)', () => {
        expect(bp.PROPAGATION_DAMPING_FACTOR).toBeGreaterThan(0);
        expect(bp.PROPAGATION_DAMPING_FACTOR).toBeLessThan(1);
    });

    test('MIN_BELIEF_DELTA in (0,1)', () => {
        expect(bp.MIN_BELIEF_DELTA_TO_PROPAGATE).toBeGreaterThan(0);
        expect(bp.MIN_BELIEF_DELTA_TO_PROPAGATE).toBeLessThan(1);
    });
});

describe('§75 computeBeliefUpdate', () => {
    test('requires: source drop → target loses confidence', () => {
        const r = bp.computeBeliefUpdate({
            sourceConfChange: -0.5, relation: 'requires'
        });
        expect(r).toBeLessThan(0);
    });

    test('requires: source rise → no propagation', () => {
        const r = bp.computeBeliefUpdate({
            sourceConfChange: 0.5, relation: 'requires'
        });
        expect(r).toBe(0);
    });

    test('supports: bidirectional dampening', () => {
        const rUp = bp.computeBeliefUpdate({
            sourceConfChange: 0.5, relation: 'supports'
        });
        const rDown = bp.computeBeliefUpdate({
            sourceConfChange: -0.5, relation: 'supports'
        });
        expect(rUp).toBeGreaterThan(0);
        expect(rDown).toBeLessThan(0);
        expect(Math.abs(rUp)).toBeCloseTo(Math.abs(rDown));
    });

    test('invalidates: inverse', () => {
        const rUp = bp.computeBeliefUpdate({
            sourceConfChange: 0.5, relation: 'invalidates'
        });
        expect(rUp).toBeLessThan(0);  // source up → target down
    });

    test('unknown relation returns 0', () => {
        const r = bp.computeBeliefUpdate({
            sourceConfChange: 0.5, relation: 'unknown'
        });
        expect(r).toBe(0);
    });
});

describe('§75 propagateNodeChange', () => {
    test('persists chain + updates thesis nodes', () => {
        buildThesis('TH-P1');
        const r = bp.propagateNodeChange({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            thesisId: 'TH-P1',
            nodeId: 'A', newConfidence: 0.2  // drop A from 0.9 → 0.2
        });
        expect(r.propagated).toBe(true);
        expect(r.chain.length).toBeGreaterThan(0);

        // B (requires A) should be affected
        const updated = tg.getThesisGraph({ thesisId: 'TH-P1' });
        const nodeB = updated.nodes.find(n => n.nodeId === 'B');
        expect(nodeB.confidence).toBeLessThan(0.8);
    });

    test('logs propagation event', () => {
        buildThesis('TH-LOG');
        bp.propagateNodeChange({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            thesisId: 'TH-LOG',
            nodeId: 'A', newConfidence: 0.3
        });
        const rows = db.prepare(
            `SELECT * FROM ml_belief_propagation_log WHERE thesis_id = 'TH-LOG'`
        ).all();
        expect(rows).toHaveLength(1);
    });

    test('respects maxDepth', () => {
        buildThesis('TH-DEPTH');
        const r = bp.propagateNodeChange({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            thesisId: 'TH-DEPTH',
            nodeId: 'A', newConfidence: 0.2,
            maxDepth: 1
        });
        expect(r.depth).toBeLessThanOrEqual(1);
    });

    test('below threshold → no cascade beyond source', () => {
        buildThesis('TH-SMALL');
        const r = bp.propagateNodeChange({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            thesisId: 'TH-SMALL',
            nodeId: 'A', newConfidence: 0.89  // delta only 0.01 < threshold
        });
        expect(r.chain.length).toBe(0);
    });

    test('throws on unknown thesis', () => {
        expect(() => bp.propagateNodeChange({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            thesisId: 'NONEXISTENT',
            nodeId: 'A', newConfidence: 0.5
        })).toThrow();
    });

    test('throws on unknown node', () => {
        buildThesis('TH-BAD-NODE');
        expect(() => bp.propagateNodeChange({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            thesisId: 'TH-BAD-NODE',
            nodeId: 'NONEXISTENT', newConfidence: 0.5
        })).toThrow();
    });

    test('throws on out-of-range confidence', () => {
        buildThesis('TH-BAD-CONF');
        expect(() => bp.propagateNodeChange({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            thesisId: 'TH-BAD-CONF',
            nodeId: 'A', newConfidence: 1.5
        })).toThrow();
    });
});

describe('§75 simulatePropagation (pure dry-run)', () => {
    test('does not mutate input nodes', () => {
        const nodes = [
            { nodeId: 'A', type: 'context', confidence: 0.9 },
            { nodeId: 'B', type: 'liquidity', confidence: 0.8 }
        ];
        const edges = [{ from: 'A', to: 'B', relation: 'requires' }];
        bp.simulatePropagation({
            nodes, edges,
            sourceNodeId: 'A', newConfidence: 0.2
        });
        expect(nodes[0].confidence).toBe(0.9);
        expect(nodes[1].confidence).toBe(0.8);
    });

    test('returns simulated chain', () => {
        const nodes = [
            { nodeId: 'A', type: 'context', confidence: 0.9 },
            { nodeId: 'B', type: 'liquidity', confidence: 0.8 }
        ];
        const edges = [{ from: 'A', to: 'B', relation: 'requires' }];
        const r = bp.simulatePropagation({
            nodes, edges,
            sourceNodeId: 'A', newConfidence: 0.2
        });
        expect(r.chain.length).toBeGreaterThan(0);
    });

    test('throws on unknown source', () => {
        expect(() => bp.simulatePropagation({
            nodes: [{ nodeId: 'A', confidence: 0.5 }],
            edges: [],
            sourceNodeId: 'NONEXISTENT', newConfidence: 0.5
        })).toThrow();
    });
});

describe('§75 cycle safety', () => {
    test('cycle in graph terminates at maxDepth', () => {
        tg.createThesisGraph({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            thesisId: 'TH-CYCLE', positionId: 'POS-CYCLE',
            nodes: [
                { nodeId: 'X', type: 'context', confidence: 0.9 },
                { nodeId: 'Y', type: 'liquidity', confidence: 0.9 },
                { nodeId: 'Z', type: 'macro', confidence: 0.9 }
            ],
            edges: [
                { from: 'X', to: 'Y', relation: 'supports' },
                { from: 'Y', to: 'Z', relation: 'supports' },
                { from: 'Z', to: 'X', relation: 'supports' }
            ]
        });
        const r = bp.propagateNodeChange({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            thesisId: 'TH-CYCLE',
            nodeId: 'X', newConfidence: 0.3
        });
        expect(r.depth).toBeLessThanOrEqual(bp.MAX_PROPAGATION_DEPTH);
    });
});

describe('§75 recordPropagationEvent + history + stats', () => {
    test('manual record', () => {
        bp.recordPropagationEvent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            thesisId: 'TH-MANUAL',
            sourceNodeId: 'A', sourceOldConf: 0.9, sourceNewConf: 0.3,
            chain: [{ nodeId: 'B', delta: -0.3, depth: 1 }],
            depth: 1
        });
        const h = bp.getPropagationHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(h).toHaveLength(1);
    });

    test('stats aggregates', () => {
        buildThesis('TH-S1');
        bp.propagateNodeChange({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            thesisId: 'TH-S1',
            nodeId: 'A', newConfidence: 0.2
        });
        buildThesis('TH-S2');
        bp.propagateNodeChange({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            thesisId: 'TH-S2',
            nodeId: 'A', newConfidence: 0.1
        });
        const stats = bp.getPropagationStats({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(stats.totalEvents).toBe(2);
    });
});

describe('§75 isolation', () => {
    test('per (user × env) isolation on history', () => {
        const OTHER_USER = 9076;
        bp.recordPropagationEvent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            thesisId: 'TH-ISO',
            sourceNodeId: 'A', sourceOldConf: 0.9, sourceNewConf: 0.3,
            chain: [], depth: 0
        });
        const h1 = bp.getPropagationHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const h2 = bp.getPropagationHistory({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(h1.length).toBe(1);
        expect(h2.length).toBe(0);
    });
});
