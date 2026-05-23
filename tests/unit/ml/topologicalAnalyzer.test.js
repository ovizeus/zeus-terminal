'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p91-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const tda = require('../../../server/services/ml/R2_cognition/topologicalAnalyzer');

const TEST_USER = 9091;
const OTHER_USER = 9092;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_topology_snapshots WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
    db.prepare('DELETE FROM ml_topology_transitions WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§91 Migrations 171 + 172', () => {
    test('snapshot_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_topology_snapshots
             (user_id, resolved_env, snapshot_id, feature_window_size,
              betti_0, betti_1, persistence_diagram_json, regime_label, ts)
             VALUES (?, ?, 'S-UNIQ', 50, 1, 0, NULL, NULL, ?)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_topology_snapshots
             (user_id, resolved_env, snapshot_id, feature_window_size,
              betti_0, betti_1, persistence_diagram_json, regime_label, ts)
             VALUES (?, ?, 'S-UNIQ', 60, 2, 1, NULL, NULL, ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('CHECK transition_type restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_topology_transitions
             (user_id, resolved_env, transition_id, from_snapshot_id,
              to_snapshot_id, betti_delta_json, transition_type, severity, ts)
             VALUES (?, ?, 'T-BAD', 'A', 'B', '{}', 'BOGUS', 0.5, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('transition_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_topology_transitions
             (user_id, resolved_env, transition_id, from_snapshot_id,
              to_snapshot_id, betti_delta_json, transition_type, severity, ts)
             VALUES (?, ?, 'T-UNIQ', 'A', 'B', '{}', 'STABLE', 0.1, ?)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_topology_transitions
             (user_id, resolved_env, transition_id, from_snapshot_id,
              to_snapshot_id, betti_delta_json, transition_type, severity, ts)
             VALUES (?, ?, 'T-UNIQ', 'C', 'D', '{}', 'STABLE', 0.1, ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });
});

describe('§91 Constants', () => {
    test('TRANSITION_TYPES has 3 entries', () => {
        expect(tda.TRANSITION_TYPES).toEqual([
            'STABLE', 'REGIME_SHIFT', 'CORRELATION_BREAKDOWN'
        ]);
    });

    test('DEFAULT_EPSILON positive', () => {
        expect(tda.DEFAULT_EPSILON).toBeGreaterThan(0);
    });

    test('MIN_POINTS_FOR_TOPOLOGY >= 3', () => {
        expect(tda.MIN_POINTS_FOR_TOPOLOGY).toBeGreaterThanOrEqual(3);
    });
});

describe('§91 buildPointCloud', () => {
    test('normalizes to [0,1] range per dim', () => {
        const r = tda.buildPointCloud({
            features: [[0, 100], [10, 200], [5, 150]]
        });
        expect(r.points[0]).toEqual([0, 0]);
        expect(r.points[1]).toEqual([1, 1]);
        expect(r.points[2]).toEqual([0.5, 0.5]);
        expect(r.dim).toBe(2);
    });

    test('handles empty input', () => {
        const r = tda.buildPointCloud({ features: [] });
        expect(r.points).toEqual([]);
    });

    test('skip normalize when normalize=false', () => {
        const r = tda.buildPointCloud({
            features: [[1, 2], [3, 4]], normalize: false
        });
        expect(r.points[0]).toEqual([1, 2]);
    });
});

describe('§91 computeBettiNumbers', () => {
    test('insufficient points → sufficient=false', () => {
        const r = tda.computeBettiNumbers({
            pointCloud: { points: [[0, 0], [1, 1]] }
        });
        expect(r.sufficient).toBe(false);
    });

    test('single tight cluster → betti0=1', () => {
        const points = [];
        for (let i = 0; i < 10; i++) {
            points.push([Math.random() * 0.1, Math.random() * 0.1]);
        }
        const r = tda.computeBettiNumbers({
            pointCloud: { points }, epsilon: 0.3
        });
        expect(r.betti0).toBe(1);
    });

    test('two distant clusters → betti0=2', () => {
        const points = [
            [0, 0], [0.05, 0], [0, 0.05], [0.05, 0.05], [0.025, 0.025],
            [1, 1], [0.95, 1], [1, 0.95], [0.95, 0.95], [0.975, 0.975]
        ];
        const r = tda.computeBettiNumbers({
            pointCloud: { points }, epsilon: 0.1
        });
        expect(r.betti0).toBe(2);
    });

    test('cycle ring → betti1 >= 1', () => {
        // 8 points on a circle radius 0.4 around (0.5, 0.5)
        const points = [];
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * 2 * Math.PI;
            points.push([0.5 + 0.4 * Math.cos(angle), 0.5 + 0.4 * Math.sin(angle)]);
        }
        // epsilon just large enough to connect adjacent points (~0.306) but not opposite
        const r = tda.computeBettiNumbers({
            pointCloud: { points }, epsilon: 0.35
        });
        expect(r.betti0).toBe(1);
        expect(r.betti1).toBeGreaterThanOrEqual(1);
    });
});

describe('§91 recordTopologySnapshot', () => {
    test('persists', () => {
        const r = tda.recordTopologySnapshot({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            snapshotId: 'SNAP-1', featureWindowSize: 50,
            bettiNumbers: { betti0: 2, betti1: 1 },
            regimeLabel: 'range_healthy'
        });
        expect(r.recorded).toBe(true);
    });

    test('duplicate throws', () => {
        tda.recordTopologySnapshot({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            snapshotId: 'SNAP-DUP', featureWindowSize: 50,
            bettiNumbers: { betti0: 1, betti1: 0 }
        });
        expect(() => tda.recordTopologySnapshot({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            snapshotId: 'SNAP-DUP', featureWindowSize: 60,
            bettiNumbers: { betti0: 2, betti1: 1 }
        })).toThrow();
    });
});

describe('§91 detectTopologyTransition', () => {
    test('stable when delta small', () => {
        tda.recordTopologySnapshot({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            snapshotId: 'TS-A', featureWindowSize: 50,
            bettiNumbers: { betti0: 2, betti1: 1 }
        });
        tda.recordTopologySnapshot({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            snapshotId: 'TS-B', featureWindowSize: 50,
            bettiNumbers: { betti0: 2, betti1: 1 }
        });
        const r = tda.detectTopologyTransition({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            transitionId: 'TR-STABLE',
            fromSnapshotId: 'TS-A', toSnapshotId: 'TS-B'
        });
        expect(r.transitionType).toBe('STABLE');
    });

    test('regime_shift when betti changes large', () => {
        tda.recordTopologySnapshot({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            snapshotId: 'TS-C', featureWindowSize: 50,
            bettiNumbers: { betti0: 1, betti1: 3 }
        });
        tda.recordTopologySnapshot({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            snapshotId: 'TS-D', featureWindowSize: 50,
            bettiNumbers: { betti0: 1, betti1: 0 }
        });
        const r = tda.detectTopologyTransition({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            transitionId: 'TR-SHIFT',
            fromSnapshotId: 'TS-C', toSnapshotId: 'TS-D'
        });
        expect(r.transitionType).toBe('REGIME_SHIFT');
    });

    test('correlation_breakdown when components rise + loops collapse', () => {
        tda.recordTopologySnapshot({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            snapshotId: 'TS-E', featureWindowSize: 50,
            bettiNumbers: { betti0: 1, betti1: 2 }
        });
        tda.recordTopologySnapshot({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            snapshotId: 'TS-F', featureWindowSize: 50,
            bettiNumbers: { betti0: 4, betti1: 0 }
        });
        const r = tda.detectTopologyTransition({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            transitionId: 'TR-BREAK',
            fromSnapshotId: 'TS-E', toSnapshotId: 'TS-F'
        });
        expect(r.transitionType).toBe('CORRELATION_BREAKDOWN');
    });
});

describe('§91 evaluateCorrelationBreakdown', () => {
    test('detects breakdown when components rise', () => {
        tda.recordTopologySnapshot({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            snapshotId: 'HIST-1', featureWindowSize: 50,
            bettiNumbers: { betti0: 1, betti1: 2 }
        });
        const r = tda.evaluateCorrelationBreakdown({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            historicalSnapshotId: 'HIST-1',
            currentBettiNumbers: { betti0: 4, betti1: 0 }
        });
        expect(r.breakdownDetected).toBe(true);
    });

    test('no breakdown when topology stable', () => {
        tda.recordTopologySnapshot({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            snapshotId: 'HIST-2', featureWindowSize: 50,
            bettiNumbers: { betti0: 2, betti1: 1 }
        });
        const r = tda.evaluateCorrelationBreakdown({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            historicalSnapshotId: 'HIST-2',
            currentBettiNumbers: { betti0: 2, betti1: 1 }
        });
        expect(r.breakdownDetected).toBe(false);
    });
});

describe('§91 getSnapshotHistory', () => {
    test('returns ordered list', () => {
        tda.recordTopologySnapshot({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            snapshotId: 'H-1', featureWindowSize: 50,
            bettiNumbers: { betti0: 1, betti1: 0 }, ts: 1000
        });
        tda.recordTopologySnapshot({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            snapshotId: 'H-2', featureWindowSize: 50,
            bettiNumbers: { betti0: 2, betti1: 1 }, ts: 2000
        });
        const r = tda.getSnapshotHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r).toHaveLength(2);
        expect(r[0].snapshotId).toBe('H-2');   // DESC order
    });
});

describe('§91 isolation', () => {
    test('per (user × env) isolation', () => {
        tda.recordTopologySnapshot({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            snapshotId: 'ISO-1', featureWindowSize: 50,
            bettiNumbers: { betti0: 1, betti1: 0 }
        });
        const a = tda.getSnapshotHistory({ userId: TEST_USER, resolvedEnv: TEST_ENV });
        const b = tda.getSnapshotHistory({ userId: OTHER_USER, resolvedEnv: TEST_ENV });
        expect(a).toHaveLength(1);
        expect(b).toHaveLength(0);
    });
});
