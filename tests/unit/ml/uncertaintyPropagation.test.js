'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p92-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const up = require('../../../server/services/ml/_crosscutting/uncertaintyPropagation');

const TEST_USER = 9092;
const OTHER_USER = 9093;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_uncertainty_nodes WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
    db.prepare('DELETE FROM ml_uncertainty_pipelines WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§92 Migrations 173 + 174', () => {
    test('node_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_uncertainty_nodes
             (user_id, resolved_env, node_id, pipeline_id, kind,
              point_estimate, variance, contributing_node_ids_json, ts)
             VALUES (?, ?, 'N-UNIQ', 'P1', 'data', 0.5, 0.01, NULL, ?)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_uncertainty_nodes
             (user_id, resolved_env, node_id, pipeline_id, kind,
              point_estimate, variance, contributing_node_ids_json, ts)
             VALUES (?, ?, 'N-UNIQ', 'P2', 'data', 0.6, 0.02, NULL, ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('CHECK kind restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_uncertainty_nodes
             (user_id, resolved_env, node_id, pipeline_id, kind,
              point_estimate, variance, contributing_node_ids_json, ts)
             VALUES (?, ?, 'N-BAD', 'P', 'BOGUS', 0.5, 0.01, NULL, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK variance >= 0', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_uncertainty_nodes
             (user_id, resolved_env, node_id, pipeline_id, kind,
              point_estimate, variance, contributing_node_ids_json, ts)
             VALUES (?, ?, 'N-NEG', 'P', 'data', 0.5, -0.01, NULL, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK pipeline status restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_uncertainty_pipelines
             (user_id, resolved_env, pipeline_id, name, decision_node_id,
              total_propagated_variance, status, ts)
             VALUES (?, ?, 'P-BAD', 'x', NULL, 0.01, 'BOGUS', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§92 Constants', () => {
    test('NODE_KINDS has 4 entries', () => {
        expect(up.NODE_KINDS).toEqual(['data', 'detector', 'aggregator', 'decision']);
    });

    test('PIPELINE_STATUSES has 3 entries', () => {
        expect(up.PIPELINE_STATUSES).toEqual(['HEALTHY', 'DEGRADED', 'UNRELIABLE']);
    });

    test('CV thresholds ordered', () => {
        expect(up.CV_HEALTHY_THRESHOLD).toBeLessThan(up.CV_DEGRADED_THRESHOLD);
    });
});

describe('§92 propagateLinear', () => {
    test('single input passes through with same variance', () => {
        const r = up.propagateLinear({
            inputs: [{ value: 0.7, variance: 0.04 }],
            weights: [1.0]
        });
        expect(r.value).toBeCloseTo(0.7);
        expect(r.variance).toBeCloseTo(0.04);
    });

    test('two equally-weighted inputs averages value, halves variance', () => {
        // weights = [0.5, 0.5]; var = 0.25*0.04 + 0.25*0.04 = 0.02
        const r = up.propagateLinear({
            inputs: [
                { value: 0.6, variance: 0.04 },
                { value: 0.8, variance: 0.04 }
            ]
        });
        expect(r.value).toBeCloseTo(0.7);
        expect(r.variance).toBeCloseTo(0.02);
    });

    test('weighted aggregation respects weights', () => {
        const r = up.propagateLinear({
            inputs: [
                { value: 1.0, variance: 0.01 },
                { value: 0.0, variance: 0.01 }
            ],
            weights: [0.8, 0.2]
        });
        expect(r.value).toBeCloseTo(0.8);
        // var = 0.64*0.01 + 0.04*0.01 = 0.0068
        expect(r.variance).toBeCloseTo(0.0068);
    });

    test('throws on weights length mismatch', () => {
        expect(() => up.propagateLinear({
            inputs: [{ value: 0.5, variance: 0.01 }],
            weights: [0.5, 0.5]
        })).toThrow();
    });
});

describe('§92 propagateProduct', () => {
    test('two-product delta method', () => {
        // x=0.7 σ²=0.01, y=0.8 σ²=0.01
        // z = 0.56; logVar = 0.01/0.49 + 0.01/0.64 ≈ 0.02 + 0.0156 = 0.0359
        // var(z) ≈ 0.56² * 0.0359 ≈ 0.0113
        const r = up.propagateProduct({
            inputs: [
                { value: 0.7, variance: 0.01 },
                { value: 0.8, variance: 0.01 }
            ]
        });
        expect(r.value).toBeCloseTo(0.56);
        expect(r.variance).toBeCloseTo(0.0113, 3);
    });

    test('zero input collapses to zero variance', () => {
        const r = up.propagateProduct({
            inputs: [
                { value: 0.5, variance: 0.01 },
                { value: 0.0, variance: 0.01 }
            ]
        });
        expect(r.value).toBe(0);
        expect(r.variance).toBe(0);
    });
});

describe('§92 classifyConfidence', () => {
    test('HEALTHY when CV < 0.05', () => {
        const r = up.classifyConfidence({ pointEstimate: 0.8, variance: 0.0001 });
        // stdDev=0.01; CV=0.0125 < 0.05
        expect(r.status).toBe('HEALTHY');
    });

    test('DEGRADED when 0.05 <= CV < 0.20', () => {
        const r = up.classifyConfidence({ pointEstimate: 0.74, variance: 0.005 });
        // stdDev≈0.0707; CV≈0.0955
        expect(r.status).toBe('DEGRADED');
    });

    test('UNRELIABLE when CV >= 0.20', () => {
        const r = up.classifyConfidence({ pointEstimate: 0.74, variance: 0.04 });
        // stdDev=0.2; CV≈0.27
        expect(r.status).toBe('UNRELIABLE');
    });

    test('UNRELIABLE when point estimate near zero', () => {
        const r = up.classifyConfidence({ pointEstimate: 0, variance: 0.01 });
        expect(r.status).toBe('UNRELIABLE');
    });
});

describe('§92 recordNode', () => {
    test('persists', () => {
        const r = up.recordNode({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            nodeId: 'N-1', pipelineId: 'P-1', kind: 'data',
            pointEstimate: 0.7, variance: 0.04
        });
        expect(r.recorded).toBe(true);
    });

    test('invalid kind throws', () => {
        expect(() => up.recordNode({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            nodeId: 'N-BAD', pipelineId: 'P', kind: 'BOGUS',
            pointEstimate: 0.5, variance: 0.01
        })).toThrow();
    });

    test('duplicate throws', () => {
        up.recordNode({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            nodeId: 'N-DUP', pipelineId: 'P', kind: 'data',
            pointEstimate: 0.5, variance: 0.01
        });
        expect(() => up.recordNode({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            nodeId: 'N-DUP', pipelineId: 'P2', kind: 'data',
            pointEstimate: 0.6, variance: 0.02
        })).toThrow();
    });
});

describe('§92 evaluatePipeline', () => {
    test('HEALTHY pipeline classification', () => {
        up.recordNode({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            nodeId: 'EH-DATA', pipelineId: 'PIPE-H', kind: 'data',
            pointEstimate: 0.9, variance: 0.001
        });
        up.recordNode({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            nodeId: 'EH-DEC', pipelineId: 'PIPE-H', kind: 'decision',
            pointEstimate: 0.85, variance: 0.0009
        });
        const r = up.evaluatePipeline({
            userId: TEST_USER, resolvedEnv: TEST_ENV, pipelineId: 'PIPE-H'
        });
        expect(r.status).toBe('HEALTHY');
        expect(r.decisionNodeId).toBe('EH-DEC');
    });

    test('UNRELIABLE pipeline classification', () => {
        up.recordNode({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            nodeId: 'EU-DEC', pipelineId: 'PIPE-U', kind: 'decision',
            pointEstimate: 0.74, variance: 0.04
        });
        const r = up.evaluatePipeline({
            userId: TEST_USER, resolvedEnv: TEST_ENV, pipelineId: 'PIPE-U'
        });
        expect(r.status).toBe('UNRELIABLE');
    });

    test('no_nodes when pipeline empty', () => {
        const r = up.evaluatePipeline({
            userId: TEST_USER, resolvedEnv: TEST_ENV, pipelineId: 'EMPTY'
        });
        expect(r.evaluated).toBe(false);
    });
});

describe('§92 getPipelineHistory', () => {
    test('returns evaluated pipelines DESC by ts', () => {
        up.recordNode({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            nodeId: 'GH-1-DEC', pipelineId: 'GH-1', kind: 'decision',
            pointEstimate: 0.8, variance: 0.001
        });
        up.evaluatePipeline({
            userId: TEST_USER, resolvedEnv: TEST_ENV, pipelineId: 'GH-1',
            name: 'first', ts: 1000
        });
        up.recordNode({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            nodeId: 'GH-2-DEC', pipelineId: 'GH-2', kind: 'decision',
            pointEstimate: 0.7, variance: 0.001
        });
        up.evaluatePipeline({
            userId: TEST_USER, resolvedEnv: TEST_ENV, pipelineId: 'GH-2',
            name: 'second', ts: 2000
        });
        const r = up.getPipelineHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r).toHaveLength(2);
        expect(r[0].pipelineId).toBe('GH-2');
    });
});

describe('§92 isolation', () => {
    test('per (user × env) isolation', () => {
        up.recordNode({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            nodeId: 'ISO-1', pipelineId: 'ISO-P', kind: 'decision',
            pointEstimate: 0.5, variance: 0.001
        });
        up.evaluatePipeline({
            userId: TEST_USER, resolvedEnv: TEST_ENV, pipelineId: 'ISO-P'
        });
        const a = up.getPipelineHistory({ userId: TEST_USER, resolvedEnv: TEST_ENV });
        const b = up.getPipelineHistory({ userId: OTHER_USER, resolvedEnv: TEST_ENV });
        expect(a).toHaveLength(1);
        expect(b).toHaveLength(0);
    });
});
