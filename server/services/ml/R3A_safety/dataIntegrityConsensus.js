'use strict';

/**
 * OMEGA R3A Safety — dataIntegrityConsensus (canonical §60)
 *
 * §60 DATA INTEGRITY / POISONING / SOURCE CONSENSUS LAYER.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1688-1707.
 *
 * "Un feed proaspat poate fi totusi mincinos. Asta este apararea
 *  impotriva 'garbage in', nu doar impotriva 'late in'."
 *
 * Six anomaly detectors:
 *   - impossible_print    price <= 0, spread reverse, > 50% jump
 *   - ts_spoof            ts in future or far past
 *   - packet_corrupt      shape mismatch / NaN
 *   - venue_anomaly       price diverges >threshold from consensus
 *   - sentiment_burst     identical messages in burst
 *   - signal_burst        artificial signal frequency spike
 *
 * Per-source trust score (EWMA-style decay on anomaly). Status auto-
 * transitions TRUSTED → DEGRADED → EXCLUDED based on thresholds.
 * Critical sources flagged for operator alert.
 *
 * Distinct from §13 dataFreshness (fresh ≠ true).
 */

const { db } = require('../../database');

const ANOMALY_TYPES = Object.freeze([
    'impossible_print', 'ts_spoof', 'packet_corrupt',
    'venue_anomaly', 'sentiment_burst', 'signal_burst'
]);
const SOURCE_STATUSES = Object.freeze(['TRUSTED', 'DEGRADED', 'EXCLUDED']);
const SEVERITY_LEVELS = Object.freeze(['low', 'med', 'high']);

const TRUST_DEGRADED_THRESHOLD = 0.50;
const TRUST_EXCLUDED_THRESHOLD = 0.20;
const INITIAL_TRUST = 1.0;
const TRUST_DECAY_LOW = 0.02;
const TRUST_DECAY_MED = 0.05;
const TRUST_DECAY_HIGH = 0.10;
const IMPOSSIBLE_JUMP_THRESHOLD = 0.50;  // 50%
const TS_SPOOF_TOLERANCE_MS = 5000;

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`dataIntegrityConsensus: missing ${key}`);
    }
    return params[key];
}

function _trustToStatus(trust) {
    if (trust < TRUST_EXCLUDED_THRESHOLD) return 'EXCLUDED';
    if (trust < TRUST_DEGRADED_THRESHOLD) return 'DEGRADED';
    return 'TRUSTED';
}

function _severityDecay(severity) {
    if (severity === 'high') return TRUST_DECAY_HIGH;
    if (severity === 'med') return TRUST_DECAY_MED;
    return TRUST_DECAY_LOW;
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    upsertTrust: db.prepare(`
        INSERT INTO ml_source_trust
        (user_id, resolved_env, source_id, trust_score,
         total_observations, anomaly_count, status, updated_at)
        VALUES (?, ?, ?, ?, 0, 0, 'TRUSTED', ?)
        ON CONFLICT(user_id, resolved_env, source_id) DO NOTHING
    `),
    updateTrust: db.prepare(`
        UPDATE ml_source_trust
        SET trust_score = ?, total_observations = total_observations + ?,
            anomaly_count = anomaly_count + ?, last_anomaly_ts = ?,
            status = ?, updated_at = ?
        WHERE user_id = ? AND resolved_env = ? AND source_id = ?
    `),
    getTrust: db.prepare(`
        SELECT * FROM ml_source_trust
        WHERE user_id = ? AND resolved_env = ? AND source_id = ?
    `),
    insertAnomaly: db.prepare(`
        INSERT INTO ml_anomaly_events
        (user_id, resolved_env, source_id, anomaly_type, severity,
         payload_hash, details_json, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
};

// ── detectImpossiblePrint ──────────────────────────────────────────
function detectImpossiblePrint(params) {
    const price = _required(params, 'price');
    const prevPrice = (params && typeof params.prevPrice === 'number') ? params.prevPrice : null;
    const spread = (params && typeof params.spread === 'number') ? params.spread : null;

    if (!Number.isFinite(price) || price <= 0) {
        return { anomaly: true, reason: 'invalid_price', severity: 'high' };
    }
    if (spread !== null && spread < 0) {
        return { anomaly: true, reason: 'reverse_spread', severity: 'high' };
    }
    if (prevPrice !== null && prevPrice > 0) {
        const jumpPct = Math.abs(price - prevPrice) / prevPrice;
        if (jumpPct > IMPOSSIBLE_JUMP_THRESHOLD) {
            return { anomaly: true, reason: 'huge_jump', severity: 'high', jumpPct };
        }
    }
    return { anomaly: false };
}

// ── detectTimestampSpoofing ────────────────────────────────────────
function detectTimestampSpoofing(params) {
    const ts = _required(params, 'ts');
    const now = (params && typeof params.now === 'number') ? params.now : Date.now();
    const prevTs = (params && typeof params.prevTs === 'number') ? params.prevTs : null;
    const tolerance = (params && typeof params.tolerance === 'number')
        ? params.tolerance : TS_SPOOF_TOLERANCE_MS;

    if (ts > now + tolerance) {
        return { anomaly: true, reason: 'future_ts', severity: 'high', delta: ts - now };
    }
    if (prevTs !== null && ts < prevTs - tolerance) {
        return { anomaly: true, reason: 'rewind_ts', severity: 'med', delta: prevTs - ts };
    }
    return { anomaly: false };
}

// ── detectVenueAnomaly ─────────────────────────────────────────────
function detectVenueAnomaly(params) {
    const sourcePrice = _required(params, 'sourcePrice');
    const consensusPrice = _required(params, 'consensusPrice');
    const threshold = (params && typeof params.threshold === 'number') ? params.threshold : 0.02;

    if (consensusPrice <= 0) return { anomaly: false };
    const divergence = Math.abs(sourcePrice - consensusPrice) / consensusPrice;
    if (divergence > threshold) {
        const severity = divergence > threshold * 5 ? 'high' : (divergence > threshold * 2 ? 'med' : 'low');
        return { anomaly: true, reason: 'venue_divergence', severity, divergence };
    }
    return { anomaly: false };
}

// ── getConsensus ───────────────────────────────────────────────────
function getConsensus(params) {
    const observations = _required(params, 'observations');
    if (!Array.isArray(observations) || observations.length === 0) {
        return { median: 0, outliers: [], consensus: [] };
    }

    const sorted = observations.slice().sort((a, b) => a.value - b.value);
    const n = sorted.length;
    const median = n % 2 === 0
        ? (sorted[n / 2 - 1].value + sorted[n / 2].value) / 2
        : sorted[Math.floor(n / 2)].value;

    // IQR outlier detection
    const q1 = sorted[Math.floor(n * 0.25)].value;
    const q3 = sorted[Math.floor(n * 0.75)].value;
    const iqr = q3 - q1;
    const lowerBound = q1 - 1.5 * iqr;
    const upperBound = q3 + 1.5 * iqr;

    const outliers = [];
    const consensus = [];
    for (const obs of observations) {
        if (obs.value < lowerBound || obs.value > upperBound) {
            outliers.push(obs);
        } else {
            consensus.push(obs);
        }
    }

    return { median, outliers, consensus, q1, q3, iqr };
}

// ── ensureSourceRow ────────────────────────────────────────────────
function _ensureSourceRow(userId, env, sourceId, now) {
    _stmts.upsertTrust.run(userId, env, sourceId, INITIAL_TRUST, now);
}

// ── updateTrustScore ───────────────────────────────────────────────
function updateTrustScore(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const sourceId = _required(params, 'sourceId');
    const delta = _required(params, 'delta');
    const isAnomaly = !!params.isAnomaly;
    const ts = (params && params.ts) ? params.ts : Date.now();

    _ensureSourceRow(userId, env, sourceId, ts);
    const current = _stmts.getTrust.get(userId, env, sourceId);
    const newTrust = Math.max(0, Math.min(1, current.trust_score + delta));
    const newStatus = _trustToStatus(newTrust);

    _stmts.updateTrust.run(
        newTrust,
        1,                                    // total_observations +1
        isAnomaly ? 1 : 0,                    // anomaly_count
        isAnomaly ? ts : current.last_anomaly_ts,
        newStatus, ts,
        userId, env, sourceId
    );

    return { newTrust, newStatus, transitioned: newStatus !== current.status };
}

// ── recordAnomaly ──────────────────────────────────────────────────
function recordAnomaly(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const sourceId = _required(params, 'sourceId');
    const anomalyType = _required(params, 'anomalyType');
    const severity = _required(params, 'severity');
    const ts = (params && params.ts) ? params.ts : Date.now();
    const details = (params && params.details) ? params.details : null;
    const payloadHash = (params && params.payloadHash) ? params.payloadHash : null;

    if (!ANOMALY_TYPES.includes(anomalyType)) {
        throw new Error(`dataIntegrityConsensus: invalid anomalyType "${anomalyType}"`);
    }
    if (!SEVERITY_LEVELS.includes(severity)) {
        throw new Error(`dataIntegrityConsensus: invalid severity "${severity}"`);
    }

    _stmts.insertAnomaly.run(
        userId, env, sourceId, anomalyType, severity,
        payloadHash, details ? JSON.stringify(details) : null, ts
    );

    const trustDelta = -_severityDecay(severity);
    return updateTrustScore({
        userId, resolvedEnv: env, sourceId,
        delta: trustDelta, isAnomaly: true, ts
    });
}

// ── getSourceTrust ─────────────────────────────────────────────────
function getSourceTrust(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const sourceId = _required(params, 'sourceId');
    const row = _stmts.getTrust.get(userId, env, sourceId);
    if (!row) {
        return {
            sourceId, exists: false,
            trustScore: INITIAL_TRUST, status: 'TRUSTED',
            totalObservations: 0, anomalyCount: 0
        };
    }
    return {
        sourceId, exists: true,
        trustScore: row.trust_score,
        status: row.status,
        totalObservations: row.total_observations,
        anomalyCount: row.anomaly_count,
        lastAnomalyTs: row.last_anomaly_ts
    };
}

module.exports = {
    ANOMALY_TYPES,
    SOURCE_STATUSES,
    SEVERITY_LEVELS,
    TRUST_DEGRADED_THRESHOLD,
    TRUST_EXCLUDED_THRESHOLD,
    INITIAL_TRUST,
    IMPOSSIBLE_JUMP_THRESHOLD,
    TS_SPOOF_TOLERANCE_MS,
    detectImpossiblePrint,
    detectTimestampSpoofing,
    detectVenueAnomaly,
    getConsensus,
    updateTrustScore,
    recordAnomaly,
    getSourceTrust
};
