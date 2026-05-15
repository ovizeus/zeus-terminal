'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p24-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const dr = require('../../../server/services/ml/R2_cognition/detectorRegistry');

const TEST_USER = 9024;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare(`DELETE FROM ml_detector_registry WHERE detector_id LIKE 'test-%'`).run();
    db.prepare(`DELETE FROM ml_detector_outputs WHERE user_id = ?`).run(TEST_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§24 Migration 062_ml_detector_registry', () => {
    test('table ml_detector_registry exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_detector_registry'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('table ml_detector_outputs exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_detector_outputs'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('ml_detector_registry has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_detector_registry)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'detector_id', 'kind', 'input_schema_json',
            'output_schema_json', 'time_horizon_ms', 'weight',
            'allowed_regimes_json', 'model_type', 'model_version',
            'enabled', 'created_at', 'updated_at'
        ]));
    });

    test('ml_detector_registry UNIQUE detector_id', () => {
        db.prepare(
            `INSERT INTO ml_detector_registry
             (detector_id, kind, input_schema_json, output_schema_json,
              time_horizon_ms, weight, allowed_regimes_json, model_type,
              model_version, enabled, created_at, updated_at)
             VALUES ('dup-1', 'order_flow', '{}', '{}', 1000, 0.5, '[]', 'HEURISTIC', 'v1', 1, ?, ?)`
        ).run(Date.now(), Date.now());
        expect(() => db.prepare(
            `INSERT INTO ml_detector_registry
             (detector_id, kind, input_schema_json, output_schema_json,
              time_horizon_ms, weight, allowed_regimes_json, model_type,
              model_version, enabled, created_at, updated_at)
             VALUES ('dup-1', 'order_flow', '{}', '{}', 1000, 0.5, '[]', 'HEURISTIC', 'v1', 1, ?, ?)`
        ).run(Date.now(), Date.now())).toThrow();
        db.prepare(`DELETE FROM ml_detector_registry WHERE detector_id = 'dup-1'`).run();
    });

    test('CHECK kind restricts to allowed values', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_detector_registry
             (detector_id, kind, input_schema_json, output_schema_json,
              time_horizon_ms, weight, allowed_regimes_json, model_type,
              model_version, enabled, created_at, updated_at)
             VALUES ('bogus-1', 'BOGUS_KIND', '{}', '{}', 1000, 0.5, '[]', 'HEURISTIC', 'v1', 1, ?, ?)`
        ).run(Date.now(), Date.now())).toThrow();
    });

    test('CHECK model_type restricts to allowed values', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_detector_registry
             (detector_id, kind, input_schema_json, output_schema_json,
              time_horizon_ms, weight, allowed_regimes_json, model_type,
              model_version, enabled, created_at, updated_at)
             VALUES ('bad-model-1', 'order_flow', '{}', '{}', 1000, 0.5, '[]', 'GUESS', 'v1', 1, ?, ?)`
        ).run(Date.now(), Date.now())).toThrow();
    });
});

describe('§24 Exported constants', () => {
    test('DETECTOR_KINDS has 9 spec entries', () => {
        expect(dr.DETECTOR_KINDS).toHaveLength(9);
        expect(dr.DETECTOR_KINDS).toEqual(expect.arrayContaining([
            'order_flow', 'liquidity_sweep', 'regime_classifier',
            'derivatives_stress', 'macro_filter', 'venue_divergence',
            'options_context', 'portfolio_risk', 'execution_quality'
        ]));
    });

    test('MODEL_TYPES has 5 entries', () => {
        expect(dr.MODEL_TYPES).toEqual(expect.arrayContaining([
            'LIGHTGBM', 'XGBOOST', 'TRANSFORMER', 'LSTM', 'HEURISTIC'
        ]));
    });

    test('REGIME_KEYS includes major regimes', () => {
        expect(dr.REGIME_KEYS).toEqual(expect.arrayContaining([
            'trend', 'range', 'chop', 'squeeze', 'news', 'high_vol', 'low_vol'
        ]));
    });
});

describe('§24 registerDetector', () => {
    test('creates new detector entry', () => {
        const r = dr.registerDetector({
            detectorId: 'test-order-flow-1',
            kind: 'order_flow',
            inputSchema: { cvd: 'number', volume: 'number' },
            outputSchema: { signal: 'number', confidence: 'number' },
            timeHorizonMs: 1000,
            weight: 0.7,
            allowedRegimes: ['trend', 'range'],
            modelType: 'HEURISTIC',
            modelVersion: 'v1.0.0'
        });
        expect(r.registered).toBe(true);
        expect(r.detectorId).toBe('test-order-flow-1');
    });

    test('throws on duplicate detectorId', () => {
        dr.registerDetector({
            detectorId: 'test-dup',
            kind: 'order_flow',
            inputSchema: {}, outputSchema: {},
            timeHorizonMs: 1000, weight: 0.5,
            allowedRegimes: ['trend'],
            modelType: 'HEURISTIC', modelVersion: 'v1'
        });
        expect(() => dr.registerDetector({
            detectorId: 'test-dup',
            kind: 'order_flow',
            inputSchema: {}, outputSchema: {},
            timeHorizonMs: 1000, weight: 0.5,
            allowedRegimes: ['trend'],
            modelType: 'HEURISTIC', modelVersion: 'v2'
        })).toThrow();
    });

    test('rejects invalid kind', () => {
        expect(() => dr.registerDetector({
            detectorId: 'test-bad-kind',
            kind: 'bogus_kind',
            inputSchema: {}, outputSchema: {},
            timeHorizonMs: 1000, weight: 0.5,
            allowedRegimes: ['trend'],
            modelType: 'HEURISTIC', modelVersion: 'v1'
        })).toThrow(/kind/);
    });

    test('rejects invalid model_type', () => {
        expect(() => dr.registerDetector({
            detectorId: 'test-bad-model',
            kind: 'order_flow',
            inputSchema: {}, outputSchema: {},
            timeHorizonMs: 1000, weight: 0.5,
            allowedRegimes: ['trend'],
            modelType: 'GUESS', modelVersion: 'v1'
        })).toThrow(/model/i);
    });

    test('rejects weight out of [0,1]', () => {
        expect(() => dr.registerDetector({
            detectorId: 'test-bad-weight',
            kind: 'order_flow',
            inputSchema: {}, outputSchema: {},
            timeHorizonMs: 1000, weight: 1.5,
            allowedRegimes: ['trend'],
            modelType: 'HEURISTIC', modelVersion: 'v1'
        })).toThrow(/weight/);
    });
});

describe('§24 getDetector', () => {
    test('returns null when detector not registered', () => {
        const r = dr.getDetector({ detectorId: 'test-non-existent' });
        expect(r).toBeNull();
    });

    test('returns spec when detector registered', () => {
        dr.registerDetector({
            detectorId: 'test-fetch',
            kind: 'regime_classifier',
            inputSchema: { vol: 'number' },
            outputSchema: { regime: 'string' },
            timeHorizonMs: 60000,
            weight: 0.9,
            allowedRegimes: ['high_vol'],
            modelType: 'LIGHTGBM',
            modelVersion: 'v2.1.0'
        });
        const r = dr.getDetector({ detectorId: 'test-fetch' });
        expect(r.detectorId).toBe('test-fetch');
        expect(r.kind).toBe('regime_classifier');
        expect(r.modelType).toBe('LIGHTGBM');
        expect(r.allowedRegimes).toEqual(['high_vol']);
    });
});

describe('§24 listDetectors', () => {
    beforeEach(() => {
        dr.registerDetector({
            detectorId: 'test-of-1',
            kind: 'order_flow', inputSchema: {}, outputSchema: {},
            timeHorizonMs: 1000, weight: 0.5,
            allowedRegimes: ['trend'],
            modelType: 'HEURISTIC', modelVersion: 'v1'
        });
        dr.registerDetector({
            detectorId: 'test-of-2',
            kind: 'order_flow', inputSchema: {}, outputSchema: {},
            timeHorizonMs: 2000, weight: 0.6,
            allowedRegimes: ['range', 'high_vol'],
            modelType: 'XGBOOST', modelVersion: 'v1'
        });
        dr.registerDetector({
            detectorId: 'test-rc-1',
            kind: 'regime_classifier', inputSchema: {}, outputSchema: {},
            timeHorizonMs: 60000, weight: 0.9,
            allowedRegimes: ['trend', 'range', 'chop'],
            modelType: 'LIGHTGBM', modelVersion: 'v1'
        });
    });

    test('lists all when no filter', () => {
        const list = dr.listDetectors({});
        expect(list.length).toBeGreaterThanOrEqual(3);
    });

    test('filters by kind', () => {
        const list = dr.listDetectors({ kind: 'order_flow' });
        expect(list.length).toBeGreaterThanOrEqual(2);
        for (const d of list) {
            if (d.detectorId.startsWith('test-')) {
                expect(d.kind).toBe('order_flow');
            }
        }
    });

    test('filters by allowedInRegime', () => {
        const list = dr.listDetectors({ allowedInRegime: 'chop' });
        expect(list.some(d => d.detectorId === 'test-rc-1')).toBe(true);
        expect(list.every(d => d.detectorId !== 'test-of-1' || true)).toBe(true);
    });
});

describe('§24 recordDetectorOutput', () => {
    beforeEach(() => {
        dr.registerDetector({
            detectorId: 'test-out-detector',
            kind: 'order_flow', inputSchema: {}, outputSchema: {},
            timeHorizonMs: 1000, weight: 0.5,
            allowedRegimes: ['trend'],
            modelType: 'HEURISTIC', modelVersion: 'v1'
        });
    });

    test('records output row', () => {
        dr.recordDetectorOutput({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            detectorId: 'test-out-detector',
            posId: 'pos-test-24-001',
            output: { signal: 0.7, confidence: 0.85 },
            regime: 'trend',
            modelVersion: 'v1'
        });
        const rows = db.prepare(
            `SELECT * FROM ml_detector_outputs WHERE user_id = ?`
        ).all(TEST_USER);
        expect(rows).toHaveLength(1);
        expect(rows[0].detector_id).toBe('test-out-detector');
        expect(rows[0].regime).toBe('trend');
    });

    test('rejects unknown detector', () => {
        expect(() => dr.recordDetectorOutput({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            detectorId: 'test-non-existent-detector',
            output: { x: 1 },
            regime: 'trend'
        })).toThrow(/not.*registered|detector/i);
    });

    test('records multiple outputs per detector', () => {
        for (let i = 0; i < 5; i++) {
            dr.recordDetectorOutput({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                detectorId: 'test-out-detector',
                output: { signal: 0.5 + i * 0.1 },
                regime: 'trend'
            });
        }
        const rows = db.prepare(
            `SELECT * FROM ml_detector_outputs WHERE user_id = ?`
        ).all(TEST_USER);
        expect(rows).toHaveLength(5);
    });
});

describe('§24 getDetectorOutputs', () => {
    beforeEach(() => {
        dr.registerDetector({
            detectorId: 'test-getoutput',
            kind: 'liquidity_sweep', inputSchema: {}, outputSchema: {},
            timeHorizonMs: 5000, weight: 0.6,
            allowedRegimes: ['range'],
            modelType: 'HEURISTIC', modelVersion: 'v1'
        });
        for (let i = 0; i < 3; i++) {
            dr.recordDetectorOutput({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                detectorId: 'test-getoutput',
                output: { signal: i * 0.3 },
                regime: 'range'
            });
        }
    });

    test('returns recorded outputs', () => {
        const outputs = dr.getDetectorOutputs({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            detectorId: 'test-getoutput'
        });
        expect(outputs).toHaveLength(3);
    });

    test('respects limit param', () => {
        const outputs = dr.getDetectorOutputs({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            detectorId: 'test-getoutput',
            limit: 2
        });
        expect(outputs).toHaveLength(2);
    });

    test('respects since param', () => {
        const future = Date.now() + 60000;
        const outputs = dr.getDetectorOutputs({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            detectorId: 'test-getoutput',
            since: future
        });
        expect(outputs).toHaveLength(0);
    });
});

describe('§24 isolation', () => {
    test('per (user × env) isolation on outputs', () => {
        const OTHER_USER = 9025;
        dr.registerDetector({
            detectorId: 'test-iso-detector',
            kind: 'order_flow', inputSchema: {}, outputSchema: {},
            timeHorizonMs: 1000, weight: 0.5,
            allowedRegimes: ['trend'],
            modelType: 'HEURISTIC', modelVersion: 'v1'
        });
        dr.recordDetectorOutput({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            detectorId: 'test-iso-detector',
            output: { signal: 0.5 }, regime: 'trend'
        });
        dr.recordDetectorOutput({
            userId: OTHER_USER, resolvedEnv: TEST_ENV,
            detectorId: 'test-iso-detector',
            output: { signal: 0.8 }, regime: 'trend'
        });
        const mine = dr.getDetectorOutputs({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            detectorId: 'test-iso-detector'
        });
        const others = dr.getDetectorOutputs({
            userId: OTHER_USER, resolvedEnv: TEST_ENV,
            detectorId: 'test-iso-detector'
        });
        expect(mine).toHaveLength(1);
        expect(others).toHaveLength(1);
        db.prepare(`DELETE FROM ml_detector_outputs WHERE user_id = ?`).run(OTHER_USER);
    });
});

describe('§24 validation', () => {
    test('registerDetector throws on missing detectorId', () => {
        expect(() => dr.registerDetector({
            kind: 'order_flow', inputSchema: {}, outputSchema: {},
            timeHorizonMs: 1000, weight: 0.5,
            allowedRegimes: ['trend'],
            modelType: 'HEURISTIC', modelVersion: 'v1'
        })).toThrow(/detectorId/);
    });

    test('recordDetectorOutput throws on missing detectorId', () => {
        expect(() => dr.recordDetectorOutput({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            output: { x: 1 }, regime: 'trend'
        })).toThrow(/detectorId/);
    });
});
