'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p117-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const ep = require('../../../server/services/ml/_audit/epistemicProvenance');

const TEST_USER = 9117;
const OTHER_USER = 9118;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_belief_nodes WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
    db.prepare('DELETE FROM ml_belief_lineages WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§117 Migrations 223 + 224', () => {
    test('node_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_belief_nodes
             (user_id, resolved_env, node_id, belief_id, kind,
              source_type, parent_node_ids_json, content_summary, ts)
             VALUES (?, ?, 'BN-UNIQ', 'B1', 'raw_feed', 'direct_observation',
                     '[]', 'price tick', ?)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_belief_nodes
             (user_id, resolved_env, node_id, belief_id, kind,
              source_type, parent_node_ids_json, content_summary, ts)
             VALUES (?, ?, 'BN-UNIQ', 'B2', 'preprocess', 'derived_inference',
                     '[]', 'd', ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('CHECK kind restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_belief_nodes
             (user_id, resolved_env, node_id, belief_id, kind,
              source_type, parent_node_ids_json, content_summary, ts)
             VALUES (?, ?, 'BN-BAD', 'B', 'BOGUS', 'direct_observation',
                     '[]', 'd', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK source_type restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_belief_nodes
             (user_id, resolved_env, node_id, belief_id, kind,
              source_type, parent_node_ids_json, content_summary, ts)
             VALUES (?, ?, 'BN-SBAD', 'B', 'raw_feed', 'BOGUS',
                     '[]', 'd', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK node_count >= 1', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_belief_lineages
             (user_id, resolved_env, lineage_id, belief_id,
              root_node_id, terminal_node_id, decision_id,
              node_count, ts)
             VALUES (?, ?, 'BL-ZERO', 'B', 'R', 'T', 'D', 0, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§117 Constants', () => {
    test('NODE_KINDS has 7 entries', () => {
        expect(ep.NODE_KINDS).toEqual([
            'raw_feed', 'preprocess', 'detector_output',
            'score_transform', 'gating_event',
            'thesis_node', 'policy_verdict'
        ]);
    });

    test('SOURCE_TYPES has 5 entries', () => {
        expect(ep.SOURCE_TYPES).toEqual([
            'direct_observation', 'derived_inference',
            'propagated_hypothesis',
            'historical_prior', 'episodic_analogy'
        ]);
    });
});

describe('§117 validateLineageCompleteness (pure)', () => {
    test('valid lineage with root + terminal passes', () => {
        const r = ep.validateLineageCompleteness({
            nodes: [
                { nodeId: 'N1', kind: 'raw_feed', parentNodeIds: [] },
                { nodeId: 'N2', kind: 'preprocess', parentNodeIds: ['N1'] },
                { nodeId: 'N3', kind: 'policy_verdict', parentNodeIds: ['N2'] }
            ]
        });
        expect(r.valid).toBe(true);
    });

    test('orphan parent ref throws', () => {
        expect(() => ep.validateLineageCompleteness({
            nodes: [
                { nodeId: 'N1', kind: 'preprocess', parentNodeIds: ['MISSING'] }
            ]
        })).toThrow();
    });

    test('no root (raw_feed) throws', () => {
        expect(() => ep.validateLineageCompleteness({
            nodes: [
                { nodeId: 'N1', kind: 'preprocess', parentNodeIds: [] }
            ]
        })).toThrow();
    });

    test('no terminal (policy_verdict) throws', () => {
        expect(() => ep.validateLineageCompleteness({
            nodes: [
                { nodeId: 'N1', kind: 'raw_feed', parentNodeIds: [] }
            ]
        })).toThrow();
    });

    test('root with non-empty parents throws', () => {
        expect(() => ep.validateLineageCompleteness({
            nodes: [
                { nodeId: 'N1', kind: 'raw_feed', parentNodeIds: ['X'] },
                { nodeId: 'N2', kind: 'policy_verdict', parentNodeIds: ['N1'] }
            ]
        })).toThrow();
    });
});

describe('§117 registerBeliefNode', () => {
    test('persists', () => {
        const r = ep.registerBeliefNode({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            nodeId: 'RN-1', beliefId: 'B-1',
            kind: 'raw_feed', sourceType: 'direct_observation',
            parentNodeIds: [], contentSummary: 'BTC ticker'
        });
        expect(r.registered).toBe(true);
    });

    test('duplicate throws', () => {
        ep.registerBeliefNode({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            nodeId: 'RN-DUP', beliefId: 'B', kind: 'raw_feed',
            sourceType: 'direct_observation',
            parentNodeIds: [], contentSummary: 'x'
        });
        expect(() => ep.registerBeliefNode({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            nodeId: 'RN-DUP', beliefId: 'B2', kind: 'preprocess',
            sourceType: 'derived_inference',
            parentNodeIds: [], contentSummary: 'y'
        })).toThrow();
    });

    test('invalid kind throws', () => {
        expect(() => ep.registerBeliefNode({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            nodeId: 'RN-BAD', beliefId: 'B', kind: 'BOGUS',
            sourceType: 'direct_observation',
            parentNodeIds: [], contentSummary: 'x'
        })).toThrow();
    });

    test('invalid sourceType throws', () => {
        expect(() => ep.registerBeliefNode({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            nodeId: 'RN-SBAD', beliefId: 'B', kind: 'raw_feed',
            sourceType: 'BOGUS',
            parentNodeIds: [], contentSummary: 'x'
        })).toThrow();
    });
});

describe('§117 traceBeliefLineage', () => {
    test('returns nodes ordered by ts', () => {
        ep.registerBeliefNode({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            nodeId: 'T1', beliefId: 'B-TRACE',
            kind: 'raw_feed', sourceType: 'direct_observation',
            parentNodeIds: [], contentSummary: 'feed', ts: 1000
        });
        ep.registerBeliefNode({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            nodeId: 'T2', beliefId: 'B-TRACE',
            kind: 'preprocess', sourceType: 'derived_inference',
            parentNodeIds: ['T1'], contentSummary: 'normalized', ts: 2000
        });
        ep.registerBeliefNode({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            nodeId: 'T3', beliefId: 'B-TRACE',
            kind: 'policy_verdict', sourceType: 'derived_inference',
            parentNodeIds: ['T2'], contentSummary: 'LONG', ts: 3000
        });
        const r = ep.traceBeliefLineage({
            userId: TEST_USER, resolvedEnv: TEST_ENV, beliefId: 'B-TRACE'
        });
        expect(r).toHaveLength(3);
        expect(r[0].nodeId).toBe('T1');
        expect(r[2].nodeId).toBe('T3');
    });
});

describe('§117 recordBeliefLineage', () => {
    test('persists', () => {
        const r = ep.recordBeliefLineage({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            lineageId: 'RL-1', beliefId: 'B',
            rootNodeId: 'R', terminalNodeId: 'T',
            decisionId: 'D', nodeCount: 5
        });
        expect(r.recorded).toBe(true);
    });

    test('duplicate throws', () => {
        ep.recordBeliefLineage({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            lineageId: 'RL-DUP', beliefId: 'B',
            rootNodeId: 'R', terminalNodeId: 'T',
            decisionId: 'D', nodeCount: 1
        });
        expect(() => ep.recordBeliefLineage({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            lineageId: 'RL-DUP', beliefId: 'B2',
            rootNodeId: 'R2', terminalNodeId: 'T2',
            decisionId: 'D2', nodeCount: 2
        })).toThrow();
    });

    test('zero node_count throws', () => {
        expect(() => ep.recordBeliefLineage({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            lineageId: 'RL-ZERO', beliefId: 'B',
            rootNodeId: 'R', terminalNodeId: 'T',
            decisionId: 'D', nodeCount: 0
        })).toThrow();
    });
});

describe('§117 getLineageById', () => {
    test('returns lineage + nodes', () => {
        ep.registerBeliefNode({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            nodeId: 'GL-N1', beliefId: 'B-GL',
            kind: 'raw_feed', sourceType: 'direct_observation',
            parentNodeIds: [], contentSummary: 'x'
        });
        ep.recordBeliefLineage({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            lineageId: 'GL-L1', beliefId: 'B-GL',
            rootNodeId: 'GL-N1', terminalNodeId: 'GL-N1',
            decisionId: 'D', nodeCount: 1
        });
        const r = ep.getLineageById({
            userId: TEST_USER, resolvedEnv: TEST_ENV, lineageId: 'GL-L1'
        });
        expect(r.lineage.lineageId).toBe('GL-L1');
        expect(r.nodes).toHaveLength(1);
    });

    test('unknown lineage throws', () => {
        expect(() => ep.getLineageById({
            userId: TEST_USER, resolvedEnv: TEST_ENV, lineageId: 'NOEXIST'
        })).toThrow();
    });
});

describe('§117 isolation', () => {
    test('per (user × env) isolation', () => {
        ep.registerBeliefNode({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            nodeId: 'ISO-N', beliefId: 'B-ISO',
            kind: 'raw_feed', sourceType: 'direct_observation',
            parentNodeIds: [], contentSummary: 'x'
        });
        const a = ep.traceBeliefLineage({
            userId: TEST_USER, resolvedEnv: TEST_ENV, beliefId: 'B-ISO'
        });
        const b = ep.traceBeliefLineage({
            userId: OTHER_USER, resolvedEnv: TEST_ENV, beliefId: 'B-ISO'
        });
        expect(a).toHaveLength(1);
        expect(b).toHaveLength(0);
    });
});
