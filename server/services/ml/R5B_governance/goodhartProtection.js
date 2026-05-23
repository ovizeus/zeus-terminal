'use strict';

/**
 * OMEGA R5B Governance — goodhartProtection (canonical §90)
 *
 * §90 GOODHART'S LAW PROTECTION.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt line 2370.
 *
 * "Cand botul e antrenat sa maximizeze o metrica, va gasi sistematic cai sa o
 *  gaming-uiasca fara sa imbunatateasca performanta reala... Protectia presupune:
 *  metrici compozite care nu pot fi gaming-uite simultan, metrici holdout pe care
 *  modelul nu stie ca e evaluat, si rotirea periodica a metricilor primare."
 *
 * R5B governance — meta-layer peste metrici. Distinct de §17 regimeMetrics
 * (compute metrics) si §21 driftDetection (statistical drift) — §90 = how
 * metrics are governed against optimization-pressure gaming.
 */

const { db } = require('../../database');

const METRIC_KINDS = Object.freeze(['primary', 'secondary', 'holdout']);
const METRIC_STATUSES = Object.freeze(['ACTIVE', 'RETIRED', 'ROTATED']);
const GAMING_PATTERNS = Object.freeze([
    'VARIANCE_COLLAPSE', 'CLUSTERING', 'MONOTONIC_DRIFT', 'HEALTHY'
]);

const VARIANCE_COLLAPSE_THRESHOLD = 0.01;
const CLUSTERING_DENSITY_THRESHOLD = 0.80;
const MIN_VALUES_FOR_GAMING_EVAL = 10;

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`goodhartProtection: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertMetric: db.prepare(`
        INSERT INTO ml_metric_registry
        (user_id, resolved_env, metric_id, name, formula_hash, kind,
         model_visible, status, active_from)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)
    `),
    getMetric: db.prepare(`
        SELECT * FROM ml_metric_registry WHERE metric_id = ?
    `),
    listActive: db.prepare(`
        SELECT * FROM ml_metric_registry
        WHERE user_id = ? AND resolved_env = ? AND status = 'ACTIVE'
        ORDER BY active_from DESC
    `),
    listActiveVisible: db.prepare(`
        SELECT * FROM ml_metric_registry
        WHERE user_id = ? AND resolved_env = ?
          AND status = 'ACTIVE' AND model_visible = 1
        ORDER BY active_from DESC
    `),
    retireMetric: db.prepare(`
        UPDATE ml_metric_registry
        SET status = 'RETIRED', retired_at = ?
        WHERE user_id = ? AND resolved_env = ? AND metric_id = ?
    `),
    insertRotation: db.prepare(`
        INSERT INTO ml_metric_rotations
        (user_id, resolved_env, rotation_id, retired_metric_ids,
         new_metric_ids, rotation_reason, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    listRotations: db.prepare(`
        SELECT * FROM ml_metric_rotations
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC LIMIT ?
    `)
};

// ── registerMetric ─────────────────────────────────────────────────
function registerMetric(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const metricId = _required(params, 'metricId');
    const name = _required(params, 'name');
    const formulaHash = _required(params, 'formulaHash');
    const kind = _required(params, 'kind');
    if (!METRIC_KINDS.includes(kind)) {
        throw new Error(`goodhartProtection: invalid kind "${kind}"`);
    }
    const modelVisible = (params && params.modelVisible === false) ? 0 : 1;
    // holdout enforces invisible
    const finalVisible = (kind === 'holdout') ? 0 : modelVisible;
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertMetric.run(
            userId, env, metricId, name, formulaHash, kind, finalVisible, ts
        );
        return { registered: true, metricId, modelVisible: !!finalVisible };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`goodhartProtection: duplicate metricId "${metricId}"`);
        }
        throw err;
    }
}

// ── getActiveMetrics ───────────────────────────────────────────────
function getActiveMetrics(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const modelVisibleOnly = !!(params && params.modelVisibleOnly);

    const rows = modelVisibleOnly
        ? _stmts.listActiveVisible.all(userId, env)
        : _stmts.listActive.all(userId, env);
    return rows.map(r => ({
        metricId: r.metric_id,
        name: r.name,
        formulaHash: r.formula_hash,
        kind: r.kind,
        modelVisible: !!r.model_visible,
        status: r.status,
        activeFrom: r.active_from
    }));
}

// ── detectGamingPattern (pure) ─────────────────────────────────────
function detectGamingPattern(params) {
    const values = _required(params, 'values');
    if (!Array.isArray(values) || values.length < MIN_VALUES_FOR_GAMING_EVAL) {
        return { pattern: 'HEALTHY', sufficient: false, samples: values ? values.length : 0 };
    }

    const n = values.length;
    const mean = values.reduce((s, v) => s + v, 0) / n;
    const variance = values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / n;
    const stdDev = Math.sqrt(variance);

    // Pattern 1: variance collapse — model converged to single value
    if (stdDev < VARIANCE_COLLAPSE_THRESHOLD) {
        return {
            pattern: 'VARIANCE_COLLAPSE', sufficient: true, samples: n,
            mean, stdDev,
            reason: 'metric clustered too tightly — model converged to single optimum'
        };
    }

    // Pattern 2: clustering — >80% of values within ±1 stddev of mean
    const within = values.filter(v => Math.abs(v - mean) <= stdDev).length;
    const density = within / n;
    if (density >= CLUSTERING_DENSITY_THRESHOLD) {
        return {
            pattern: 'CLUSTERING', sufficient: true, samples: n,
            mean, stdDev, density,
            reason: 'metric values clustered — possible gaming via narrow optimization'
        };
    }

    // Pattern 3: monotonic drift — sustained climb suggests metric saturation
    let monotonicSteps = 0;
    for (let i = 1; i < n; i++) {
        if (values[i] > values[i - 1]) monotonicSteps++;
    }
    if (monotonicSteps / (n - 1) >= 0.90) {
        return {
            pattern: 'MONOTONIC_DRIFT', sufficient: true, samples: n,
            mean, stdDev, monotonicRatio: monotonicSteps / (n - 1),
            reason: 'metric monotonically climbing — possible optimization-pressure overfitting'
        };
    }

    return { pattern: 'HEALTHY', sufficient: true, samples: n, mean, stdDev };
}

// ── rotateMetrics ──────────────────────────────────────────────────
function rotateMetrics(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const rotationId = _required(params, 'rotationId');
    const retiredIds = _required(params, 'retiredIds');
    const newIds = _required(params, 'newIds');
    const reason = _required(params, 'reason');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!Array.isArray(retiredIds) || retiredIds.length === 0) {
        throw new Error('goodhartProtection: retiredIds must be non-empty array');
    }
    if (!Array.isArray(newIds)) {
        throw new Error('goodhartProtection: newIds must be array');
    }

    const txn = db.transaction(() => {
        for (const id of retiredIds) {
            _stmts.retireMetric.run(ts, userId, env, id);
        }
        _stmts.insertRotation.run(
            userId, env, rotationId,
            JSON.stringify(retiredIds),
            JSON.stringify(newIds),
            reason, ts
        );
    });

    try {
        txn();
        return { rotated: true, rotationId, retiredCount: retiredIds.length };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`goodhartProtection: duplicate rotationId "${rotationId}"`);
        }
        throw err;
    }
}

// ── evaluateHoldout ────────────────────────────────────────────────
function evaluateHoldout(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const holdoutMetricId = _required(params, 'holdoutMetricId');
    const predictions = _required(params, 'predictions');
    const groundTruth = _required(params, 'groundTruth');

    const m = _stmts.getMetric.get(holdoutMetricId);
    if (!m) {
        throw new Error(`goodhartProtection: holdout metric "${holdoutMetricId}" not found`);
    }
    if (m.user_id !== userId || m.resolved_env !== env) {
        throw new Error(`goodhartProtection: holdout metric "${holdoutMetricId}" not owned by user/env`);
    }
    if (m.kind !== 'holdout') {
        throw new Error(`goodhartProtection: metric "${holdoutMetricId}" is not holdout kind`);
    }
    if (!Array.isArray(predictions) || !Array.isArray(groundTruth)) {
        throw new Error('goodhartProtection: predictions and groundTruth must be arrays');
    }
    if (predictions.length !== groundTruth.length || predictions.length === 0) {
        throw new Error('goodhartProtection: predictions/groundTruth length mismatch or empty');
    }

    const n = predictions.length;
    let sumSq = 0;
    let correct = 0;
    for (let i = 0; i < n; i++) {
        const diff = predictions[i] - groundTruth[i];
        sumSq += diff * diff;
        // hit rule: sign agreement when groundTruth ne 0
        if ((predictions[i] >= 0.5) === (groundTruth[i] >= 0.5)) correct++;
    }

    return {
        metricId: holdoutMetricId,
        samples: n,
        mse: sumSq / n,
        rmse: Math.sqrt(sumSq / n),
        hitRate: correct / n,
        modelVisible: false
    };
}

// ── getRotationHistory ─────────────────────────────────────────────
function getRotationHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const limit = (params && params.limit) ? params.limit : 100;

    const rows = _stmts.listRotations.all(userId, env, limit);
    return rows.map(r => ({
        rotationId: r.rotation_id,
        retiredMetricIds: JSON.parse(r.retired_metric_ids),
        newMetricIds: JSON.parse(r.new_metric_ids),
        rotationReason: r.rotation_reason,
        ts: r.ts
    }));
}

module.exports = {
    METRIC_KINDS,
    METRIC_STATUSES,
    GAMING_PATTERNS,
    VARIANCE_COLLAPSE_THRESHOLD,
    CLUSTERING_DENSITY_THRESHOLD,
    MIN_VALUES_FOR_GAMING_EVAL,
    registerMetric,
    getActiveMetrics,
    detectGamingPattern,
    rotateMetrics,
    evaluateHoldout,
    getRotationHistory
};
