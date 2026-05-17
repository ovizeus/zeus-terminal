'use strict';

/**
 * OMEGA R2 Cognition — institutionalGravityScanner (Claude-Extra #1)
 *
 * Operator-flagged "Retrocausal Gravity Engine":
 * "Tratează viitorul imediat ca pe o masă gravitațională masivă care
 *  trage prețul spre ea, din cauza unor necesități matematice absolute
 *  ale marilor jucători... În loc să se întrebe 'unde va merge prețul?',
 *  modelul scanează piața globală pentru a detecta 'tensiunea de vacuum'."
 *
 * LEGAL: pură analiză a obligațiilor altora (CME futures expiry windows,
 * options GEX hedging cliffs, known TWAP/VWAP execution schedules, on-chain
 * liquidation clusters, funding/spot arbitrage). NO market manipulation,
 * NO spoofing — doar lectură a constrângerilor matematice publice.
 *
 * Distinct from §141 ergodicityAwareness (regime detector, NOT institutional
 * flow), §111 scenarioTreePlanner (general planning, NOT institutional
 * gravity), §51 dataIntegrityConsensus (data layer).
 */

const { db } = require('../../database');

const ZONE_KINDS = Object.freeze([
    'futures_expiry', 'gamma_wall', 'twap_target',
    'liquidation_cluster', 'funding_arbitrage'
]);

const GRAVITY_STRENGTH_THRESHOLDS = Object.freeze({
    strong: 0.70,
    moderate: 0.40
});

// Per operator emphasis: futures_expiry heaviest (most binding obligation),
// gamma_wall second (MM hedging cliffs), then liquidation/funding/twap.
const SOURCE_WEIGHTS = Object.freeze({
    futures_expiry: 0.30,
    gamma_wall: 0.25,
    liquidation_cluster: 0.20,
    funding_arbitrage: 0.15,
    twap_target: 0.10
});

const MAX_TIME_HORIZON_MS = 86400000;  // 24h

// Scale factor to ensure clean composition: weighted product can land
// anywhere in [0,1]. We multiply by 1/max_weight to allow theoretical
// gravity 1.0 with full concentration + full time within horizon + heaviest
// kind. Max product = 0.30 × 1.0 × 1.0 = 0.30. Divide by max_weight (0.30).
const _NORMALIZATION_DIVISOR = SOURCE_WEIGHTS.futures_expiry;

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`institutionalGravityScanner: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertZone: db.prepare(`
        INSERT INTO ml_gravity_zones
        (user_id, resolved_env, zone_id, asset, zone_kind,
         target_price, gravity_strength, time_to_settlement_ms,
         source_data_json, active, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    deactivateZone: db.prepare(`
        UPDATE ml_gravity_zones SET active = 0, ts = ?
        WHERE user_id = ? AND resolved_env = ? AND zone_id = ?
    `),
    getZone: db.prepare(`
        SELECT * FROM ml_gravity_zones
        WHERE user_id = ? AND resolved_env = ? AND zone_id = ?
    `),
    listActiveByAssetStrength: db.prepare(`
        SELECT * FROM ml_gravity_zones
        WHERE user_id = ? AND resolved_env = ? AND asset = ?
          AND active = 1 AND gravity_strength >= ?
        ORDER BY gravity_strength DESC, ts DESC LIMIT ?
    `),
    insertObs: db.prepare(`
        INSERT INTO ml_gravity_observations
        (user_id, resolved_env, observation_id, zone_id,
         predicted_price, actual_price_at_settlement,
         distance_to_target, prediction_was_correct, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listObsByKind: db.prepare(`
        SELECT o.* FROM ml_gravity_observations o
        JOIN ml_gravity_zones z
          ON z.zone_id = o.zone_id AND z.user_id = o.user_id
          AND z.resolved_env = o.resolved_env
        WHERE o.user_id = ? AND o.resolved_env = ?
          AND z.zone_kind = ?
        ORDER BY o.ts DESC LIMIT ?
    `)
};

// ── computeTimeDecay (pure) ────────────────────────────────────────
// More reliable when within horizon, 0 when beyond. Linear.
function computeTimeDecay(params) {
    const ttsMs = _required(params, 'timeToSettlementMs');
    if (ttsMs < 0) {
        throw new Error('institutionalGravityScanner: timeToSettlementMs must be ≥ 0');
    }
    if (ttsMs > MAX_TIME_HORIZON_MS) return { timeDecay: 0 };
    // Within horizon: signal weight scales linearly with how much of
    // horizon remains. A signal at horizon=24h = full reliability.
    // A signal at 12h = 0.5. A signal at 0h (now) = 0 (already expired).
    return { timeDecay: ttsMs / MAX_TIME_HORIZON_MS };
}

// ── computeGravityStrength (pure) ──────────────────────────────────
// = SOURCE_WEIGHTS[kind] × concentration × time_decay / normalization
function computeGravityStrength(params) {
    const oi = _required(params, 'openInterestAtStrike');
    const total = _required(params, 'totalOpenInterest');
    const ttsMs = _required(params, 'timeToSettlementMs');
    const kind = _required(params, 'sourceKind');

    if (!ZONE_KINDS.includes(kind)) {
        throw new Error(
            `institutionalGravityScanner: invalid sourceKind "${kind}"`
        );
    }
    if (total <= 0) return { gravityStrength: 0 };
    if (oi < 0 || total < 0) {
        throw new Error('institutionalGravityScanner: counts must be ≥ 0');
    }

    const concentration = Math.min(1, Math.max(0, oi / total));
    const { timeDecay } = computeTimeDecay({ timeToSettlementMs: ttsMs });
    const weight = SOURCE_WEIGHTS[kind];
    const raw = weight * concentration * timeDecay / _NORMALIZATION_DIVISOR;
    return { gravityStrength: Math.max(0, Math.min(1, raw)) };
}

// ── classifyZoneStrength (pure) ────────────────────────────────────
function classifyZoneStrength(params) {
    const s = _required(params, 'gravityStrength');
    if (s < 0 || s > 1) {
        throw new Error(
            'institutionalGravityScanner: gravityStrength must be in [0,1]'
        );
    }
    if (s >= GRAVITY_STRENGTH_THRESHOLDS.strong) return { strength: 'strong' };
    if (s >= GRAVITY_STRENGTH_THRESHOLDS.moderate) return { strength: 'moderate' };
    return { strength: 'weak' };
}

// ── computeDistanceToTarget (pure) ─────────────────────────────────
function computeDistanceToTarget(params) {
    const cur = _required(params, 'currentPrice');
    const tgt = _required(params, 'targetPrice');
    if (cur <= 0 || tgt <= 0) {
        throw new Error('institutionalGravityScanner: prices must be > 0');
    }
    return { distancePct: Math.abs(cur - tgt) / tgt };
}

// ── assessAccuracy (pure) ──────────────────────────────────────────
function assessAccuracy(params) {
    const pred = _required(params, 'predicted');
    const act = _required(params, 'actual');
    const tol = _required(params, 'tolerancePct');
    if (pred <= 0 || act <= 0 || tol < 0) {
        throw new Error('institutionalGravityScanner: invalid prices/tolerance');
    }
    const distPct = Math.abs(pred - act) / pred;
    return { correct: distPct <= tol, distancePct: distPct };
}

// ── registerGravityZone ────────────────────────────────────────────
function registerGravityZone(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const zoneId = _required(params, 'zoneId');
    const asset = _required(params, 'asset');
    const zoneKind = _required(params, 'zoneKind');
    const targetPrice = _required(params, 'targetPrice');
    const gravityStrength = _required(params, 'gravityStrength');
    const ttsMs = _required(params, 'timeToSettlementMs');
    const sourceData = _required(params, 'sourceData');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!ZONE_KINDS.includes(zoneKind)) {
        throw new Error(
            `institutionalGravityScanner: invalid zoneKind "${zoneKind}"`
        );
    }
    if (targetPrice <= 0) {
        throw new Error(
            'institutionalGravityScanner: targetPrice must be > 0'
        );
    }
    if (gravityStrength < 0 || gravityStrength > 1) {
        throw new Error(
            'institutionalGravityScanner: gravityStrength must be in [0,1]'
        );
    }
    if (ttsMs < 0) {
        throw new Error(
            'institutionalGravityScanner: timeToSettlementMs must be ≥ 0'
        );
    }
    try {
        _stmts.insertZone.run(
            userId, env, zoneId, asset, zoneKind,
            targetPrice, gravityStrength, ttsMs,
            JSON.stringify(sourceData), 1, ts
        );
        return { registered: true, zoneId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `institutionalGravityScanner: duplicate zoneId "${zoneId}"`
            );
        }
        throw err;
    }
}

// ── recordObservation (integration) ────────────────────────────────
function recordObservation(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const obsId = _required(params, 'observationId');
    const zoneId = _required(params, 'zoneId');
    const predicted = _required(params, 'predictedPrice');
    const actual = _required(params, 'actualPriceAtSettlement');
    const tol = (params && params.tolerancePct !== undefined)
        ? params.tolerancePct : 0.01;
    const ts = (params && params.ts) ? params.ts : Date.now();

    const { correct, distancePct } = assessAccuracy({
        predicted, actual, tolerancePct: tol
    });
    try {
        _stmts.insertObs.run(
            userId, env, obsId, zoneId,
            predicted, actual, distancePct,
            correct ? 1 : 0, ts
        );
        return {
            recorded: true, observationId: obsId,
            distancePct, predictionWasCorrect: correct
        };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `institutionalGravityScanner: duplicate observationId "${obsId}"`
            );
        }
        throw err;
    }
}

// ── deactivateZone ─────────────────────────────────────────────────
function deactivateZone(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const zoneId = _required(params, 'zoneId');
    const reason = _required(params, 'reason');
    const ts = (params && params.ts) ? params.ts : Date.now();

    const zone = _stmts.getZone.get(userId, env, zoneId);
    if (!zone) {
        throw new Error(
            `institutionalGravityScanner: zone not found "${zoneId}"`
        );
    }
    _stmts.deactivateZone.run(ts, userId, env, zoneId);
    return { deactivated: true, zoneId, reason };
}

function _rowToZone(r) {
    return {
        zoneId: r.zone_id,
        asset: r.asset,
        zoneKind: r.zone_kind,
        targetPrice: r.target_price,
        gravityStrength: r.gravity_strength,
        timeToSettlementMs: r.time_to_settlement_ms,
        sourceData: JSON.parse(r.source_data_json),
        active: r.active === 1,
        ts: r.ts
    };
}

// ── getActiveZones ─────────────────────────────────────────────────
function getActiveZones(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const asset = _required(params, 'asset');
    const minStrength = (params && params.minStrength !== undefined)
        ? params.minStrength : 0;
    const limit = (params && params.limit) ? params.limit : 100;
    const rows = _stmts.listActiveByAssetStrength.all(
        userId, env, asset, minStrength, limit
    );
    return rows.map(_rowToZone);
}

// ── getZoneAccuracyHistory ─────────────────────────────────────────
function getZoneAccuracyHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const kind = _required(params, 'zoneKind');
    const limit = (params && params.limit) ? params.limit : 100;
    if (!ZONE_KINDS.includes(kind)) {
        throw new Error(
            `institutionalGravityScanner: invalid zoneKind "${kind}"`
        );
    }
    const rows = _stmts.listObsByKind.all(userId, env, kind, limit);
    return rows.map(r => ({
        observationId: r.observation_id,
        zoneId: r.zone_id,
        predictedPrice: r.predicted_price,
        actualPriceAtSettlement: r.actual_price_at_settlement,
        distanceToTarget: r.distance_to_target,
        predictionWasCorrect: r.prediction_was_correct === 1,
        ts: r.ts
    }));
}

module.exports = {
    ZONE_KINDS,
    GRAVITY_STRENGTH_THRESHOLDS,
    SOURCE_WEIGHTS,
    MAX_TIME_HORIZON_MS,
    computeTimeDecay,
    computeGravityStrength,
    classifyZoneStrength,
    computeDistanceToTarget,
    assessAccuracy,
    registerGravityZone,
    recordObservation,
    deactivateZone,
    getActiveZones,
    getZoneAccuracyHistory
};
