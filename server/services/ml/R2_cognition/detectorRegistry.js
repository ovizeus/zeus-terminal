'use strict';

/**
 * OMEGA R2 Cognition — detectorRegistry (canonical §24)
 *
 * §24 ARHITECTURA ML SI DETECTORS.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1122-1150.
 *
 * Per-detector spec (lines 1122-1128):
 *   - detectorId (name)
 *   - input schema (input tensors / feature schema)
 *   - output schema
 *   - time horizon (ms)
 *   - weight [0, 1]
 *   - allowed regimes (which regimes detector may run in)
 *
 * 9 canonical detector kinds (lines 1130-1139):
 *   order_flow / liquidity_sweep / regime_classifier /
 *   derivatives_stress / macro_filter / venue_divergence /
 *   options_context / portfolio_risk / execution_quality
 *
 * Model types (lines 1143-1145):
 *   LIGHTGBM / XGBOOST (meta-tabular) /
 *   TRANSFORMER / LSTM (microstructure / temporal) /
 *   HEURISTIC (rule-based fallback)
 *
 * Per Plan v3 wrap-not-rewrite strategy: this module is the REGISTRY
 * SCAFFOLD (catalog + audit). Concrete ML models come in subsequent waves
 * with calibration loss, ensemble logic, attention (only validated edge).
 *
 * Composability: detector outputs → §16 attribution, §17 regime metrics,
 * §20 calibration; weight × output → ensemble decision in R3B.
 */

const { db } = require('../../database');

const DETECTOR_KINDS = Object.freeze([
    'order_flow',
    'liquidity_sweep',
    'regime_classifier',
    'derivatives_stress',
    'macro_filter',
    'venue_divergence',
    'options_context',
    'portfolio_risk',
    'execution_quality'
]);

const MODEL_TYPES = Object.freeze([
    'LIGHTGBM',
    'XGBOOST',
    'TRANSFORMER',
    'LSTM',
    'HEURISTIC'
]);

// Regime keys per §17 + common quantitative regimes.
const REGIME_KEYS = Object.freeze([
    'trend', 'range', 'chop', 'squeeze', 'news', 'high_vol', 'low_vol'
]);

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`detectorRegistry: missing ${key}`);
    }
    return params[key];
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertRegistry: db.prepare(`
        INSERT INTO ml_detector_registry
        (detector_id, kind, input_schema_json, output_schema_json,
         time_horizon_ms, weight, allowed_regimes_json,
         model_type, model_version, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getRegistry: db.prepare(`
        SELECT * FROM ml_detector_registry WHERE detector_id = ?
    `),
    listAll: db.prepare(`
        SELECT * FROM ml_detector_registry ORDER BY created_at ASC, id ASC
    `),
    listByKind: db.prepare(`
        SELECT * FROM ml_detector_registry
        WHERE kind = ? ORDER BY created_at ASC, id ASC
    `),
    insertOutput: db.prepare(`
        INSERT INTO ml_detector_outputs
        (user_id, resolved_env, detector_id, pos_id,
         output_json, regime, model_version, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getOutputs: db.prepare(`
        SELECT * FROM ml_detector_outputs
        WHERE user_id = ? AND resolved_env = ? AND detector_id = ?
          AND created_at >= ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?
    `)
};

// ── Helpers ─────────────────────────────────────────────────────────
function _rowToSpec(row) {
    if (!row) return null;
    return {
        detectorId: row.detector_id,
        kind: row.kind,
        inputSchema: JSON.parse(row.input_schema_json),
        outputSchema: JSON.parse(row.output_schema_json),
        timeHorizonMs: row.time_horizon_ms,
        weight: row.weight,
        allowedRegimes: JSON.parse(row.allowed_regimes_json),
        modelType: row.model_type,
        modelVersion: row.model_version,
        enabled: row.enabled === 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

// ── registerDetector ───────────────────────────────────────────────
function registerDetector(params) {
    const detectorId = _required(params, 'detectorId');
    const kind = _required(params, 'kind');
    const inputSchema = _required(params, 'inputSchema');
    const outputSchema = _required(params, 'outputSchema');
    const timeHorizonMs = _required(params, 'timeHorizonMs');
    const weight = _required(params, 'weight');
    const allowedRegimes = _required(params, 'allowedRegimes');
    const modelType = _required(params, 'modelType');
    const modelVersion = _required(params, 'modelVersion');

    if (!DETECTOR_KINDS.includes(kind)) {
        throw new Error(`detectorRegistry: invalid kind "${kind}"`);
    }
    if (!MODEL_TYPES.includes(modelType)) {
        throw new Error(`detectorRegistry: invalid model_type "${modelType}"`);
    }
    if (typeof weight !== 'number' || weight < 0 || weight > 1) {
        throw new Error(`detectorRegistry: weight out of range [0,1]`);
    }

    const now = Date.now();
    _stmts.insertRegistry.run(
        detectorId, kind,
        JSON.stringify(inputSchema), JSON.stringify(outputSchema),
        timeHorizonMs, weight,
        JSON.stringify(allowedRegimes),
        modelType, modelVersion, 1, now, now
    );

    return { registered: true, detectorId };
}

// ── getDetector ────────────────────────────────────────────────────
function getDetector(params) {
    const detectorId = _required(params, 'detectorId');
    return _rowToSpec(_stmts.getRegistry.get(detectorId));
}

// ── listDetectors ──────────────────────────────────────────────────
function listDetectors(params) {
    const filter = params || {};
    let rows;
    if (filter.kind) {
        rows = _stmts.listByKind.all(filter.kind);
    } else {
        rows = _stmts.listAll.all();
    }
    let specs = rows.map(_rowToSpec);
    if (filter.allowedInRegime) {
        specs = specs.filter(s => s.allowedRegimes.includes(filter.allowedInRegime));
    }
    return specs;
}

// ── recordDetectorOutput ───────────────────────────────────────────
function recordDetectorOutput(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const detectorId = _required(params, 'detectorId');
    const output = _required(params, 'output');
    const regime = (params && params.regime) ? params.regime : null;
    const modelVersion = (params && params.modelVersion) ? params.modelVersion : null;
    const posId = (params && params.posId) ? params.posId : null;

    const registry = _stmts.getRegistry.get(detectorId);
    if (!registry) {
        throw new Error(`detectorRegistry: detector "${detectorId}" not registered`);
    }

    _stmts.insertOutput.run(
        userId, env, detectorId, posId,
        JSON.stringify(output), regime,
        modelVersion || registry.model_version,
        Date.now()
    );

    return { recorded: true };
}

// ── getDetectorOutputs ─────────────────────────────────────────────
function getDetectorOutputs(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const detectorId = _required(params, 'detectorId');
    const since = (params && params.since) ? params.since : 0;
    const limit = (params && params.limit) ? params.limit : 1000;

    const rows = _stmts.getOutputs.all(userId, env, detectorId, since, limit);
    return rows.map(r => ({
        id: r.id,
        detectorId: r.detector_id,
        posId: r.pos_id,
        output: JSON.parse(r.output_json),
        regime: r.regime,
        modelVersion: r.model_version,
        createdAt: r.created_at
    }));
}

module.exports = {
    DETECTOR_KINDS,
    MODEL_TYPES,
    REGIME_KEYS,
    registerDetector,
    getDetector,
    listDetectors,
    recordDetectorOutput,
    getDetectorOutputs
};
