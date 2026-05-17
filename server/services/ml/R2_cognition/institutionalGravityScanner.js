'use strict';

/**
 * OMEGA R2 Cognition — institutionalGravityScanner v3 (Claude-Extra #1)
 *
 * "Institutional force-field simulator" — research-grade. Pure analysis of
 * others' contractual/mathematical obligations (futures expiry, GEX
 * hedging cliffs, TWAP/VWAP execution schedules, liquidation clusters,
 * funding arbitrage windows). NO market manipulation, NO spoofing.
 *
 * SEMANTIC CLARIFICATION (v3, per reviewer):
 * - gravity_strength = ESTIMATED PULLING FORCE MAGNITUDE [0,1]
 *   "How strong is the institutional obligation pulling price?"
 * - confidence_score = CERTAINTY THE ESTIMATE IS CORRECT [0,1]
 *   "How confident are we in the gravity_strength number?"
 * Downstream consumers must NOT confuse these two.
 *
 * v3 changes vs v2:
 * - lifecycle_state CHECK enum (5: emerging/active/decaying/settled/
 *   invalidated) — granular replaces simple active 0/1
 * - inference_method (manual/ml_inferred/rule_based) + model_version +
 *   source_provider — reproducibility provenance
 * - settlement_accuracy_score REAL [0,1] continuous (replaces binary
 *   prediction_was_correct as primary signal; binary kept for backward
 *   compat). Linear decay: 1.0 perfect → 0.5 at tolerance → 0 at 2×.
 * - net_vector_strength REAL [-1,1] numeric alongside enum direction
 * - ml_gravity_conflict_members table normalizes participating zones
 *   (FK conflict_id + FK zone_id + weight). UNIQUE(conflict_id, zone_id).
 * - transitionZoneLifecycle helper with valid transition graph
 *
 * source_data_json discipline (v3): raw evidence blob ONLY. All
 * critical fields MUST live as explicit columns. No JSON swamp.
 *
 * NOT A "PRICE MAGNET ORACLE": this is constraint analysis +
 * probabilistic directional pressure. Deterministic price prediction is
 * NOT the goal — and zones can be invalidated, decay, or fail to settle.
 *
 * Distinct from §141 (regime), §111 (planning), §51 (data layer).
 */

const { db } = require('../../database');

const ZONE_KINDS = Object.freeze([
    'futures_expiry', 'gamma_wall', 'twap_target',
    'liquidation_cluster', 'funding_arbitrage'
]);

const SETTLEMENT_TYPES = Object.freeze([
    'cme_quarterly', 'monthly_options',
    'perpetual_funding', 'twap_window',
    'liquidation_cascade'
]);

const NET_VECTOR_DIRECTIONS = Object.freeze(['up', 'down', 'sideways']);

// v3: lifecycle states (5 canonical, replaces simple active 0/1).
const LIFECYCLE_STATES = Object.freeze([
    'emerging', 'active', 'decaying', 'settled', 'invalidated'
]);

// v3: inference method (provenance metadata).
const INFERENCE_METHODS = Object.freeze([
    'manual', 'ml_inferred', 'rule_based'
]);

// v3: valid lifecycle transitions (DAG). Any active state → invalidated.
const VALID_LIFECYCLE_TRANSITIONS = Object.freeze({
    emerging: Object.freeze(['active', 'invalidated']),
    active: Object.freeze(['decaying', 'invalidated']),
    decaying: Object.freeze(['settled', 'invalidated']),
    settled: Object.freeze([]),          // terminal
    invalidated: Object.freeze([])        // terminal
});

const GRAVITY_STRENGTH_THRESHOLDS = Object.freeze({
    strong: 0.70, moderate: 0.40
});

// Source weights per zone_kind. futures_expiry heaviest = most binding
// obligation (CME settlement is contractual law).
const SOURCE_WEIGHTS = Object.freeze({
    futures_expiry: 0.30,
    gamma_wall: 0.25,
    liquidation_cluster: 0.20,
    funding_arbitrage: 0.15,
    twap_target: 0.10
});

// Confidence sub-score weights (sum 1.0). Source quality slightly highest
// because bad source = unreliable everything else.
const CONFIDENCE_WEIGHTS = Object.freeze({
    source_quality: 0.40,
    liquidity_depth: 0.30,
    volatility_sensitivity: 0.30
});

const MAX_TIME_HORIZON_MS = 86400000;  // 24h
const _NORMALIZATION_DIVISOR = SOURCE_WEIGHTS.futures_expiry;

// Sideways threshold: net vector magnitude below this = sideways.
const _SIDEWAYS_NET_THRESHOLD = 0.10;

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`institutionalGravityScanner: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertZone: db.prepare(`
        INSERT INTO ml_gravity_zones
        (user_id, resolved_env, zone_id, asset, zone_kind, settlement_type,
         zone_center_price, gravity_strength,
         confidence_score, source_quality_score,
         liquidity_depth_score, volatility_sensitivity_score,
         time_to_settlement_ms, zone_expires_at_ts,
         source_data_json, active, ts,
         lifecycle_state, inference_method, model_version, source_provider)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateLifecycleState: db.prepare(`
        UPDATE ml_gravity_zones SET lifecycle_state = ?, ts = ?
        WHERE user_id = ? AND resolved_env = ? AND zone_id = ?
    `),
    deactivateZone: db.prepare(`
        UPDATE ml_gravity_zones SET active = 0, ts = ?
        WHERE user_id = ? AND resolved_env = ? AND zone_id = ?
    `),
    getZone: db.prepare(`
        SELECT * FROM ml_gravity_zones
        WHERE user_id = ? AND resolved_env = ? AND zone_id = ?
    `),
    listActiveByAssetStrengthNotExpired: db.prepare(`
        SELECT * FROM ml_gravity_zones
        WHERE user_id = ? AND resolved_env = ? AND asset = ?
          AND active = 1 AND gravity_strength >= ?
          AND zone_expires_at_ts > ?
        ORDER BY gravity_strength DESC, ts DESC LIMIT ?
    `),
    insertObs: db.prepare(`
        INSERT INTO ml_gravity_observations
        (user_id, resolved_env, observation_id, zone_id,
         predicted_settlement_price, actual_price_at_settlement,
         observation_window_ms, distance_to_target_pct,
         prediction_was_correct, tolerance_pct, ts,
         settlement_accuracy_score)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listObsByKind: db.prepare(`
        SELECT o.* FROM ml_gravity_observations o
        JOIN ml_gravity_zones z
          ON z.zone_id = o.zone_id AND z.user_id = o.user_id
          AND z.resolved_env = o.resolved_env
        WHERE o.user_id = ? AND o.resolved_env = ?
          AND z.zone_kind = ?
        ORDER BY o.ts DESC LIMIT ?
    `),
    insertConflict: db.prepare(`
        INSERT INTO ml_gravity_conflicts
        (user_id, resolved_env, conflict_id, asset,
         participating_zone_ids_json,
         gravity_conflict_score, net_vector_direction,
         dominant_zone_id, ts, net_vector_strength)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertConflictMember: db.prepare(`
        INSERT INTO ml_gravity_conflict_members
        (user_id, resolved_env, conflict_id, zone_id, weight, ts)
        VALUES (?, ?, ?, ?, ?, ?)
    `)
};

// ── computeTimeDecay (pure) ────────────────────────────────────────
function computeTimeDecay(params) {
    const tts = _required(params, 'timeToSettlementMs');
    if (tts < 0) {
        throw new Error('institutionalGravityScanner: timeToSettlementMs ≥ 0');
    }
    if (tts > MAX_TIME_HORIZON_MS) return { timeDecay: 0 };
    return { timeDecay: tts / MAX_TIME_HORIZON_MS };
}

// ── computeGravityStrength (pure) ──────────────────────────────────
function computeGravityStrength(params) {
    const oi = _required(params, 'openInterestAtStrike');
    const total = _required(params, 'totalOpenInterest');
    const tts = _required(params, 'timeToSettlementMs');
    const kind = _required(params, 'sourceKind');

    if (!ZONE_KINDS.includes(kind)) {
        throw new Error(
            `institutionalGravityScanner: invalid sourceKind "${kind}"`
        );
    }
    if (total <= 0) return { gravityStrength: 0 };
    if (oi < 0 || total < 0) {
        throw new Error('institutionalGravityScanner: counts ≥ 0');
    }
    const conc = Math.min(1, Math.max(0, oi / total));
    const { timeDecay } = computeTimeDecay({ timeToSettlementMs: tts });
    const w = SOURCE_WEIGHTS[kind];
    const raw = w * conc * timeDecay / _NORMALIZATION_DIVISOR;
    return { gravityStrength: Math.max(0, Math.min(1, raw)) };
}

// ── computeCompositeConfidence (pure) — NEW v2 ─────────────────────
function computeCompositeConfidence(params) {
    const sq = _required(params, 'sourceQualityScore');
    const ld = _required(params, 'liquidityDepthScore');
    const vs = _required(params, 'volatilitySensitivityScore');
    for (const [k, v] of [['sourceQualityScore', sq],
                          ['liquidityDepthScore', ld],
                          ['volatilitySensitivityScore', vs]]) {
        if (v < 0 || v > 1) {
            throw new Error(
                `institutionalGravityScanner: ${k} must be in [0,1]`
            );
        }
    }
    const W = CONFIDENCE_WEIGHTS;
    const composite = sq * W.source_quality +
                      ld * W.liquidity_depth +
                      vs * W.volatility_sensitivity;
    return { compositeConfidence: Math.max(0, Math.min(1, composite)) };
}

// ── classifyZoneStrength (pure) ────────────────────────────────────
function classifyZoneStrength(params) {
    const s = _required(params, 'gravityStrength');
    if (s < 0 || s > 1) {
        throw new Error('institutionalGravityScanner: gravityStrength [0,1]');
    }
    if (s >= GRAVITY_STRENGTH_THRESHOLDS.strong) return { strength: 'strong' };
    if (s >= GRAVITY_STRENGTH_THRESHOLDS.moderate) return { strength: 'moderate' };
    return { strength: 'weak' };
}

// ── computeNetVector (pure) — NEW v2 ───────────────────────────────
// Computes net direction by weighted-summing each zone's pull direction.
// Returns 'up' / 'down' / 'sideways' (sideways if magnitude < threshold).
function computeNetVector(params) {
    const cur = _required(params, 'currentPrice');
    const zones = _required(params, 'zones');
    if (!Array.isArray(zones) || zones.length === 0) {
        throw new Error('institutionalGravityScanner: zones must be non-empty array');
    }
    if (cur <= 0) {
        throw new Error('institutionalGravityScanner: currentPrice must be > 0');
    }
    let net = 0;
    let totalWeight = 0;
    for (const z of zones) {
        const diff = (z.zoneCenterPrice - cur) / cur;  // signed % distance
        net += diff * z.gravityStrength;
        totalWeight += z.gravityStrength;
    }
    const normalized = totalWeight > 0 ? net / totalWeight : 0;
    let direction;
    if (Math.abs(normalized) < _SIDEWAYS_NET_THRESHOLD / 10) {
        direction = 'sideways';
    } else if (normalized > 0) {
        direction = 'up';
    } else {
        direction = 'down';
    }
    return {
        netVectorDirection: direction,
        netMagnitude: Math.abs(normalized)
    };
}

// ── computeGravityConflictScore (pure) — NEW v2 ────────────────────
// Conflict score = std dev of pull directions weighted by strength.
// High conflict = zones pull opposite directions with similar strength.
function computeGravityConflictScore(params) {
    const cur = _required(params, 'currentPrice');
    const zones = _required(params, 'zones');
    if (!Array.isArray(zones) || zones.length < 2) {
        return { conflictScore: 0 };
    }
    if (cur <= 0) {
        throw new Error('institutionalGravityScanner: currentPrice must be > 0');
    }
    const directions = zones.map(z => {
        const diff = (z.zoneCenterPrice - cur) / cur;
        return diff >= 0 ? 1 : -1;
    });
    const weights = zones.map(z => z.gravityStrength);
    const upWeight = directions.reduce(
        (s, d, i) => s + (d > 0 ? weights[i] : 0), 0);
    const downWeight = directions.reduce(
        (s, d, i) => s + (d < 0 ? weights[i] : 0), 0);
    const total = upWeight + downWeight;
    if (total === 0) return { conflictScore: 0 };
    // Min ratio = conflict measure (1.0 = perfectly balanced opposition)
    const minRatio = Math.min(upWeight, downWeight) / total;
    const conflict = minRatio * 2;  // scale [0, 1]
    return { conflictScore: Math.max(0, Math.min(1, conflict)) };
}

// ── computeDistanceToTarget (pure) ─────────────────────────────────
function computeDistanceToTarget(params) {
    const cur = _required(params, 'currentPrice');
    const tgt = _required(params, 'targetPrice');
    if (cur <= 0 || tgt <= 0) {
        throw new Error('institutionalGravityScanner: prices > 0');
    }
    return { distancePct: Math.abs(cur - tgt) / tgt };
}

// ── computeSettlementAccuracyScore (pure) — NEW v3 ─────────────────
// Linear decay: 1.0 at perfect match → 0.5 at tolerance → 0 at 2× tolerance.
// Replaces binary prediction_was_correct as primary signal.
function computeSettlementAccuracyScore(params) {
    const dist = _required(params, 'distancePct');
    const tol = _required(params, 'tolerancePct');
    if (tol <= 0) {
        throw new Error('institutionalGravityScanner: tolerancePct must be > 0');
    }
    if (dist < 0) {
        throw new Error('institutionalGravityScanner: distancePct must be ≥ 0');
    }
    const score = 1 - dist / (2 * tol);
    return { accuracyScore: Math.max(0, Math.min(1, score)) };
}

// ── computeNetVectorStrength (pure) — NEW v3 ───────────────────────
// Numeric [-1,1] equivalent of net_vector_direction.
// +1 = strong UP, -1 = strong DOWN, 0 = balanced sideways.
// Computed as weighted average of normalized signed distances.
function computeNetVectorStrength(params) {
    const cur = _required(params, 'currentPrice');
    const zones = _required(params, 'zones');
    if (!Array.isArray(zones) || zones.length === 0) {
        throw new Error('institutionalGravityScanner: zones must be non-empty array');
    }
    if (cur <= 0) {
        throw new Error('institutionalGravityScanner: currentPrice must be > 0');
    }
    let weightedSum = 0;
    let totalWeight = 0;
    for (const z of zones) {
        const signedDistPct = (z.zoneCenterPrice - cur) / cur;
        // tanh squashes magnitude into [-1,1] gracefully
        const squashed = Math.tanh(signedDistPct * 10);
        weightedSum += squashed * z.gravityStrength;
        totalWeight += z.gravityStrength;
    }
    if (totalWeight === 0) return { netVectorStrength: 0 };
    const raw = weightedSum / totalWeight;
    return { netVectorStrength: Math.max(-1, Math.min(1, raw)) };
}

// ── isValidLifecycleTransition (pure) — NEW v3 ─────────────────────
function isValidLifecycleTransition(params) {
    const from = _required(params, 'fromState');
    const to = _required(params, 'toState');
    if (!LIFECYCLE_STATES.includes(from)) {
        throw new Error(
            `institutionalGravityScanner: invalid fromState "${from}"`
        );
    }
    if (!LIFECYCLE_STATES.includes(to)) {
        throw new Error(
            `institutionalGravityScanner: invalid toState "${to}"`
        );
    }
    return { valid: VALID_LIFECYCLE_TRANSITIONS[from].includes(to) };
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
    const settlementType = _required(params, 'settlementType');
    const zoneCenter = _required(params, 'zoneCenterPrice');
    const gravityStrength = _required(params, 'gravityStrength');
    const conf = _required(params, 'confidenceScore');
    const srcQ = _required(params, 'sourceQualityScore');
    const liqD = _required(params, 'liquidityDepthScore');
    const volS = _required(params, 'volatilitySensitivityScore');
    const tts = _required(params, 'timeToSettlementMs');
    const expiresAt = _required(params, 'zoneExpiresAtTs');
    const sourceData = _required(params, 'sourceData');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!ZONE_KINDS.includes(zoneKind)) {
        throw new Error(
            `institutionalGravityScanner: invalid zoneKind "${zoneKind}"`
        );
    }
    if (!SETTLEMENT_TYPES.includes(settlementType)) {
        throw new Error(
            `institutionalGravityScanner: invalid settlementType "${settlementType}"`
        );
    }
    if (zoneCenter <= 0) {
        throw new Error('institutionalGravityScanner: zoneCenterPrice > 0');
    }
    for (const [k, v] of [['gravityStrength', gravityStrength],
                          ['confidenceScore', conf],
                          ['sourceQualityScore', srcQ],
                          ['liquidityDepthScore', liqD],
                          ['volatilitySensitivityScore', volS]]) {
        if (v < 0 || v > 1) {
            throw new Error(`institutionalGravityScanner: ${k} must be in [0,1]`);
        }
    }
    if (tts < 0) {
        throw new Error('institutionalGravityScanner: timeToSettlementMs ≥ 0');
    }
    // v3: lifecycle + provenance (with defaults)
    const lifecycleState = (params && params.lifecycleState !== undefined &&
                             params.lifecycleState !== null)
        ? params.lifecycleState : 'active';
    const inferenceMethod = (params && params.inferenceMethod !== undefined &&
                              params.inferenceMethod !== null)
        ? params.inferenceMethod : 'manual';
    const modelVersion = (params && params.modelVersion !== undefined)
        ? params.modelVersion : null;
    const sourceProvider = (params && params.sourceProvider !== undefined)
        ? params.sourceProvider : null;
    if (!LIFECYCLE_STATES.includes(lifecycleState)) {
        throw new Error(
            `institutionalGravityScanner: invalid lifecycleState "${lifecycleState}"`
        );
    }
    if (!INFERENCE_METHODS.includes(inferenceMethod)) {
        throw new Error(
            `institutionalGravityScanner: invalid inferenceMethod "${inferenceMethod}"`
        );
    }
    try {
        _stmts.insertZone.run(
            userId, env, zoneId, asset, zoneKind, settlementType,
            zoneCenter, gravityStrength,
            conf, srcQ, liqD, volS,
            tts, expiresAt,
            JSON.stringify(sourceData), 1, ts,
            lifecycleState, inferenceMethod, modelVersion, sourceProvider
        );
        return { registered: true, zoneId, lifecycleState };
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

// ── transitionZoneLifecycle — NEW v3 ───────────────────────────────
function transitionZoneLifecycle(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const zoneId = _required(params, 'zoneId');
    const newState = _required(params, 'newState');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!LIFECYCLE_STATES.includes(newState)) {
        throw new Error(
            `institutionalGravityScanner: invalid lifecycleState "${newState}"`
        );
    }
    const zone = _stmts.getZone.get(userId, env, zoneId);
    if (!zone) {
        throw new Error(
            `institutionalGravityScanner: zone not found "${zoneId}"`
        );
    }
    const transition = isValidLifecycleTransition({
        fromState: zone.lifecycle_state, toState: newState
    });
    if (!transition.valid) {
        throw new Error(
            `institutionalGravityScanner: invalid transition from "${zone.lifecycle_state}" to "${newState}"`
        );
    }
    _stmts.updateLifecycleState.run(newState, ts, userId, env, zoneId);
    return {
        transitioned: true, zoneId,
        oldState: zone.lifecycle_state,
        newState
    };
}

// ── recordObservation (integration) ────────────────────────────────
function recordObservation(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const obsId = _required(params, 'observationId');
    const zoneId = _required(params, 'zoneId');
    const predicted = _required(params, 'predictedSettlementPrice');
    const actual = _required(params, 'actualPriceAtSettlement');
    const winMs = (params && params.observationWindowMs !== undefined)
        ? params.observationWindowMs : 0;
    const tol = (params && params.tolerancePct !== undefined)
        ? params.tolerancePct : 0.01;
    const ts = (params && params.ts) ? params.ts : Date.now();

    const { correct, distancePct } = assessAccuracy({
        predicted, actual, tolerancePct: tol
    });
    // v3: continuous accuracy score
    const { accuracyScore } = computeSettlementAccuracyScore({
        distancePct, tolerancePct: tol
    });
    try {
        _stmts.insertObs.run(
            userId, env, obsId, zoneId,
            predicted, actual, winMs, distancePct,
            correct ? 1 : 0, tol, ts, accuracyScore
        );
        return {
            recorded: true, observationId: obsId,
            distanceToTargetPct: distancePct,
            predictionWasCorrect: correct,
            settlementAccuracyScore: accuracyScore
        };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `institutionalGravityScanner: duplicate observationId "${obsId}"`
            );
        }
        if (err.message && err.message.toLowerCase().includes('foreign key')) {
            throw err;  // pass FK errors through
        }
        throw err;
    }
}

// ── recordConflict (integration) — NEW v2 ──────────────────────────
function recordConflict(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const conflictId = _required(params, 'conflictId');
    const asset = _required(params, 'asset');
    const currentPrice = _required(params, 'currentPrice');
    const zoneIds = _required(params, 'participatingZoneIds');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!Array.isArray(zoneIds) || zoneIds.length < 2) {
        throw new Error(
            'institutionalGravityScanner: participatingZoneIds must have ≥ 2 entries'
        );
    }

    // Fetch all participating zones; reject if any missing
    const zones = [];
    for (const zid of zoneIds) {
        const z = _stmts.getZone.get(userId, env, zid);
        if (!z) {
            throw new Error(
                `institutionalGravityScanner: zone not found "${zid}"`
            );
        }
        zones.push({
            zoneId: z.zone_id,
            zoneCenterPrice: z.zone_center_price,
            gravityStrength: z.gravity_strength
        });
    }

    const { conflictScore } = computeGravityConflictScore({
        currentPrice, zones
    });
    const { netVectorDirection } = computeNetVector({
        currentPrice, zones
    });
    const { netVectorStrength } = computeNetVectorStrength({
        currentPrice, zones
    });

    // Dominant zone = highest gravityStrength
    const dominant = zones.reduce((a, b) =>
        a.gravityStrength >= b.gravityStrength ? a : b);

    // Compute weights for member rows: normalize gravityStrength to [0,1]
    // share of total. (Already in [0,1] but make explicit it's a share.)
    const totalGrav = zones.reduce((s, z) => s + z.gravityStrength, 0);
    const memberWeights = zones.map(z => ({
        zoneId: z.zoneId,
        weight: totalGrav > 0 ? z.gravityStrength / totalGrav : 0
    }));

    try {
        _stmts.insertConflict.run(
            userId, env, conflictId, asset,
            JSON.stringify(zoneIds),
            conflictScore, netVectorDirection,
            dominant.zoneId, ts, netVectorStrength
        );
        // v3: insert normalized members
        for (const m of memberWeights) {
            _stmts.insertConflictMember.run(
                userId, env, conflictId, m.zoneId, m.weight, ts
            );
        }
        return {
            recorded: true, conflictId,
            gravityConflictScore: conflictScore,
            netVectorDirection,
            netVectorStrength,
            dominantZoneId: dominant.zoneId,
            memberCount: memberWeights.length
        };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `institutionalGravityScanner: duplicate conflictId "${conflictId}"`
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
        settlementType: r.settlement_type,
        zoneCenterPrice: r.zone_center_price,
        gravityStrength: r.gravity_strength,
        confidenceScore: r.confidence_score,
        sourceQualityScore: r.source_quality_score,
        liquidityDepthScore: r.liquidity_depth_score,
        volatilitySensitivityScore: r.volatility_sensitivity_score,
        timeToSettlementMs: r.time_to_settlement_ms,
        zoneExpiresAtTs: r.zone_expires_at_ts,
        sourceData: JSON.parse(r.source_data_json),
        active: r.active === 1,
        ts: r.ts,
        // v3 fields
        lifecycleState: r.lifecycle_state,
        inferenceMethod: r.inference_method,
        modelVersion: r.model_version,
        sourceProvider: r.source_provider
    };
}

// ── getActiveZones ─────────────────────────────────────────────────
function getActiveZones(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const asset = _required(params, 'asset');
    const minStrength = (params && params.minStrength !== undefined)
        ? params.minStrength : 0;
    const currentTs = (params && params.currentTs !== undefined)
        ? params.currentTs : Date.now();
    const limit = (params && params.limit) ? params.limit : 100;
    const rows = _stmts.listActiveByAssetStrengthNotExpired.all(
        userId, env, asset, minStrength, currentTs, limit
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
        predictedSettlementPrice: r.predicted_settlement_price,
        actualPriceAtSettlement: r.actual_price_at_settlement,
        observationWindowMs: r.observation_window_ms,
        distanceToTargetPct: r.distance_to_target_pct,
        predictionWasCorrect: r.prediction_was_correct === 1,
        tolerancePct: r.tolerance_pct,
        ts: r.ts
    }));
}

module.exports = {
    ZONE_KINDS,
    SETTLEMENT_TYPES,
    NET_VECTOR_DIRECTIONS,
    LIFECYCLE_STATES,
    INFERENCE_METHODS,
    VALID_LIFECYCLE_TRANSITIONS,
    GRAVITY_STRENGTH_THRESHOLDS,
    SOURCE_WEIGHTS,
    CONFIDENCE_WEIGHTS,
    MAX_TIME_HORIZON_MS,
    computeTimeDecay,
    computeGravityStrength,
    computeCompositeConfidence,
    classifyZoneStrength,
    computeNetVector,
    computeNetVectorStrength,
    computeGravityConflictScore,
    computeSettlementAccuracyScore,
    isValidLifecycleTransition,
    computeDistanceToTarget,
    assessAccuracy,
    registerGravityZone,
    transitionZoneLifecycle,
    recordObservation,
    recordConflict,
    deactivateZone,
    getActiveZones,
    getZoneAccuracyHistory
};
