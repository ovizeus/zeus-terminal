'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p68-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const tg = require('../../../server/services/ml/R2_cognition/thesisGraphEngine');

const TEST_USER = 9068;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_thesis_graphs WHERE user_id IN (?, ?)').run(TEST_USER, 9069);
    db.prepare('DELETE FROM ml_thesis_evaluations WHERE user_id IN (?, ?)').run(TEST_USER, 9069);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

function buildSimpleGraph(thesisId, nodeConfs = [0.9, 0.8, 0.7]) {
    return {
        userId: TEST_USER, resolvedEnv: TEST_ENV,
        thesisId, positionId: 'POS-' + thesisId,
        nodes: [
            { nodeId: 'A', type: 'context', confidence: nodeConfs[0], decayRate: 0 },
            { nodeId: 'B', type: 'liquidity', confidence: nodeConfs[1], decayRate: 0 },
            { nodeId: 'C', type: 'macro', confidence: nodeConfs[2], decayRate: 0 }
        ],
        edges: [
            { from: 'A', to: 'B', relation: 'requires' },
            { from: 'C', to: 'B', relation: 'supports' }
        ]
    };
}

describe('§68 Migrations 127 + 128', () => {
    test('ml_thesis_graphs exists', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_thesis_graphs)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'user_id', 'resolved_env', 'thesis_id', 'position_id',
            'nodes_json', 'edges_json', 'status', 'created_at', 'last_updated'
        ]));
    });

    test('thesis_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_thesis_graphs
             (user_id, resolved_env, thesis_id, nodes_json, edges_json,
              status, created_at, last_updated)
             VALUES (?, ?, 'UNIQ-1', '[]', '[]', 'ACTIVE', ?, ?)`
        ).run(TEST_USER, TEST_ENV, ts, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_thesis_graphs
             (user_id, resolved_env, thesis_id, nodes_json, edges_json,
              status, created_at, last_updated)
             VALUES (?, ?, 'UNIQ-1', '[]', '[]', 'ACTIVE', ?, ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1, ts + 1)).toThrow();
    });

    test('CHECK status restricts', () => {
        const ts = Date.now();
        expect(() => db.prepare(
            `INSERT INTO ml_thesis_graphs
             (user_id, resolved_env, thesis_id, nodes_json, edges_json,
              status, created_at, last_updated)
             VALUES (?, ?, 'BAD-1', '[]', '[]', 'BOGUS', ?, ?)`
        ).run(TEST_USER, TEST_ENV, ts, ts)).toThrow();
    });

    test('CHECK action_recommended restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_thesis_evaluations
             (user_id, resolved_env, thesis_id, evaluation_ts,
              overall_health, action_recommended, ts)
             VALUES (?, ?, 'T', ?, 'active', 'BOGUS', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now(), Date.now())).toThrow();
    });
});

describe('§68 Constants', () => {
    test('NODE_TYPES has 7 entries per spec', () => {
        expect(tg.NODE_TYPES).toHaveLength(7);
        expect(tg.NODE_TYPES).toEqual(expect.arrayContaining([
            'context', 'liquidity', 'order_flow', 'derivatives',
            'macro', 'execution', 'portfolio_permission'
        ]));
    });

    test('EDGE_RELATIONS has 3 entries', () => {
        expect(tg.EDGE_RELATIONS).toEqual(['requires', 'supports', 'invalidates']);
    });

    test('THESIS_STATUSES has 4 entries', () => {
        expect(tg.THESIS_STATUSES).toEqual([
            'ACTIVE', 'PARTIAL_DEGRADED', 'INVALID', 'CONFIRMED_STRENGTHENED'
        ]);
    });

    test('ACTION_RECOMMENDATIONS has 4 entries', () => {
        expect(tg.ACTION_RECOMMENDATIONS).toEqual([
            'HOLD', 'EXIT_PARTIAL', 'EXIT_FULL', 'SCALE_UP'
        ]);
    });
});

describe('§68 createThesisGraph', () => {
    test('persists valid graph', () => {
        const r = tg.createThesisGraph(buildSimpleGraph('TH-1'));
        expect(r.created).toBe(true);
    });

    test('duplicate thesisId throws', () => {
        tg.createThesisGraph(buildSimpleGraph('TH-DUP'));
        expect(() => tg.createThesisGraph(buildSimpleGraph('TH-DUP'))).toThrow(/duplicate/i);
    });

    test('invalid node type throws', () => {
        const g = buildSimpleGraph('TH-BAD-NODE');
        g.nodes[0].type = 'BOGUS';
        expect(() => tg.createThesisGraph(g)).toThrow(/type/i);
    });

    test('invalid edge relation throws', () => {
        const g = buildSimpleGraph('TH-BAD-EDGE');
        g.edges[0].relation = 'BOGUS';
        expect(() => tg.createThesisGraph(g)).toThrow();
    });

    test('confidence out of [0,1] throws', () => {
        const g = buildSimpleGraph('TH-BAD-CONF');
        g.nodes[0].confidence = 1.5;
        expect(() => tg.createThesisGraph(g)).toThrow();
    });
});

describe('§68 updateNodeConfidence', () => {
    test('updates single node', () => {
        tg.createThesisGraph(buildSimpleGraph('TH-UP-1'));
        tg.updateNodeConfidence({
            thesisId: 'TH-UP-1', nodeId: 'A', newConfidence: 0.5
        });
        const g = tg.getThesisGraph({ thesisId: 'TH-UP-1' });
        const nodeA = g.nodes.find(n => n.nodeId === 'A');
        expect(nodeA.confidence).toBe(0.5);
    });

    test('throws on unknown node', () => {
        tg.createThesisGraph(buildSimpleGraph('TH-UP-2'));
        expect(() => tg.updateNodeConfidence({
            thesisId: 'TH-UP-2', nodeId: 'NONEXISTENT', newConfidence: 0.5
        })).toThrow();
    });
});

describe('§68 applyNodeDecay', () => {
    test('reduces confidence over time when decayRate > 0', () => {
        const g = buildSimpleGraph('TH-DECAY-1');
        g.nodes[0].decayRate = 0.001;  // per ms — fast for test
        g.ts = 1000;
        tg.createThesisGraph(g);
        // Decay 5000ms → exp(-0.001 * 5000) ≈ 0.0067
        tg.applyNodeDecay({ thesisId: 'TH-DECAY-1', now: 6000 });
        const after = tg.getThesisGraph({ thesisId: 'TH-DECAY-1' });
        const nodeA = after.nodes.find(n => n.nodeId === 'A');
        expect(nodeA.confidence).toBeLessThan(g.nodes[0].confidence);
    });

    test('decayRate=0 → no change', () => {
        const g = buildSimpleGraph('TH-DECAY-NONE');
        g.ts = 1000;
        tg.createThesisGraph(g);
        tg.applyNodeDecay({ thesisId: 'TH-DECAY-NONE', now: 1000000 });
        const after = tg.getThesisGraph({ thesisId: 'TH-DECAY-NONE' });
        expect(after.nodes[0].confidence).toBe(0.9);
    });
});

describe('§68 evaluateThesisHealth', () => {
    test('all-strong → CONFIRMED_STRENGTHENED + SCALE_UP', () => {
        const g = buildSimpleGraph('TH-STRONG', [0.95, 0.90, 0.85]);
        tg.createThesisGraph(g);
        const r = tg.evaluateThesisHealth({ thesisId: 'TH-STRONG' });
        expect(r.status).toBe('CONFIRMED_STRENGTHENED');
        expect(r.action).toBe('SCALE_UP');
    });

    test('requires node below floor → INVALID + EXIT_FULL', () => {
        // A → B requires. A drops to 0.1 → requires fails.
        const g = buildSimpleGraph('TH-REQ-FAIL', [0.1, 0.8, 0.7]);
        tg.createThesisGraph(g);
        const r = tg.evaluateThesisHealth({ thesisId: 'TH-REQ-FAIL' });
        expect(r.status).toBe('INVALID');
        expect(r.action).toBe('EXIT_FULL');
        expect(r.failingNodes.some(n => n.nodeId === 'A')).toBe(true);
    });

    test('supports degraded but requires intact → PARTIAL_DEGRADED + EXIT_PARTIAL', () => {
        // C → B supports. C drops to 0.1 → only supports failing
        const g = buildSimpleGraph('TH-SUP-FAIL', [0.8, 0.7, 0.1]);
        tg.createThesisGraph(g);
        const r = tg.evaluateThesisHealth({ thesisId: 'TH-SUP-FAIL' });
        expect(r.status).toBe('PARTIAL_DEGRADED');
        expect(r.action).toBe('EXIT_PARTIAL');
    });

    test('mid-confidence → ACTIVE + HOLD', () => {
        const g = buildSimpleGraph('TH-MID', [0.5, 0.5, 0.5]);
        tg.createThesisGraph(g);
        const r = tg.evaluateThesisHealth({ thesisId: 'TH-MID' });
        expect(r.status).toBe('ACTIVE');
        expect(r.action).toBe('HOLD');
    });

    test('throws on unknown thesis', () => {
        expect(() => tg.evaluateThesisHealth({
            thesisId: 'NONEXISTENT'
        })).toThrow();
    });
});

describe('§68 recordEvaluation', () => {
    test('persists eval row', () => {
        tg.recordEvaluation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            thesisId: 'TH-EVAL-1',
            evaluation: {
                health: 'degraded',
                action: 'EXIT_PARTIAL',
                failingNodes: [{ nodeId: 'A' }]
            }
        });
        const rows = db.prepare(
            `SELECT * FROM ml_thesis_evaluations WHERE thesis_id = 'TH-EVAL-1'`
        ).all();
        expect(rows).toHaveLength(1);
    });

    test('throws on invalid health', () => {
        expect(() => tg.recordEvaluation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            thesisId: 'TH-BAD',
            evaluation: { health: 'BOGUS', action: 'HOLD' }
        })).toThrow();
    });
});

describe('§68 listActiveThesis + history + getThesisGraph', () => {
    test('listActiveThesis returns ACTIVE/PARTIAL/STRENGTHENED', () => {
        tg.createThesisGraph(buildSimpleGraph('TH-L1'));
        tg.createThesisGraph(buildSimpleGraph('TH-L2'));
        const list = tg.listActiveThesis({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(list.length).toBeGreaterThanOrEqual(2);
    });

    test('getThesisGraph retrieves persisted', () => {
        tg.createThesisGraph(buildSimpleGraph('TH-GET'));
        const g = tg.getThesisGraph({ thesisId: 'TH-GET' });
        expect(g.nodes).toHaveLength(3);
        expect(g.edges).toHaveLength(2);
    });

    test('returns null when not found', () => {
        const g = tg.getThesisGraph({ thesisId: 'NONEXISTENT' });
        expect(g).toBe(null);
    });
});

describe('§68 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9069;
        tg.createThesisGraph(buildSimpleGraph('TH-ISO'));
        const a1 = tg.listActiveThesis({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const a2 = tg.listActiveThesis({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(a1.length).toBeGreaterThan(0);
        expect(a2.length).toBe(0);
    });
});
