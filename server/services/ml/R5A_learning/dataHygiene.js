'use strict';

/**
 * OMEGA R5A Learning Core — dataHygiene (canonical §22)
 *
 * "Date, etichetare si prevenire leakage."
 *
 * Foundational data integrity primitives. Pure functions, no DB, no migration.
 * Used by Wave 3+ feature pipeline to:
 *   - Validate chronological ordering of events
 *   - Detect lookahead bias between labels and features
 *   - Perform strict chronological train/test split (no shuffle)
 *   - Verify aligned timestamps (consistent tick grid)
 *   - Audit pipeline for leakage in label/feature pairs
 *
 * Lookahead detection is the single most important guard: ML models that
 * leak future information score brilliantly on backtest and lose money
 * in production. Better to catch leaks here than at deploy time.
 */

const DATA_SCHEMAS = Object.freeze([
    'tick',
    'l2_snapshot',
    'candle',
    'funding_snapshot',
    'oi_snapshot',
    'options_context'
]);

const FORWARD_HORIZONS = Object.freeze([
    'ultra-short', 'short', 'intraday', 'swing-short'
]);

// ── checkChronologicalOrder ─────────────────────────────────────────
function checkChronologicalOrder(events) {
    if (!Array.isArray(events)) {
        throw new Error('checkChronologicalOrder: events must be array');
    }
    if (events.length === 0) return true;
    let prev = null;
    for (let i = 0; i < events.length; i++) {
        const e = events[i];
        if (!e || typeof e.ts !== 'number' || !Number.isFinite(e.ts)) {
            throw new Error(`checkChronologicalOrder: event[${i}] missing numeric ts field`);
        }
        if (prev !== null && e.ts < prev) return false;
        prev = e.ts;
    }
    return true;
}

// ── detectLookahead ─────────────────────────────────────────────────
// Returns true if the label's timestamp falls within the future window
// that features at feature_ts can observe — i.e. label_ts < feature_ts +
// horizon_ms. The label SHOULD be at or after feature_ts + horizon_ms.
function detectLookahead(label_ts, feature_ts, horizon_ms) {
    if (typeof label_ts !== 'number' || !Number.isFinite(label_ts)) {
        throw new Error('detectLookahead: label_ts must be finite number');
    }
    if (typeof feature_ts !== 'number' || !Number.isFinite(feature_ts)) {
        throw new Error('detectLookahead: feature_ts must be finite number');
    }
    if (typeof horizon_ms !== 'number' || !Number.isFinite(horizon_ms) || horizon_ms < 0) {
        throw new Error('detectLookahead: horizon_ms must be non-negative number');
    }
    return label_ts < feature_ts + horizon_ms;
}

// ── chronologicalSplit ──────────────────────────────────────────────
// Splits events into train (ts < cutoff) and test (ts >= cutoff).
// Requires pre-sorted input — caller responsible for sort to avoid silent
// shuffle bugs.
function chronologicalSplit(events, cutoff_ts) {
    if (!Array.isArray(events)) {
        throw new Error('chronologicalSplit: events must be array');
    }
    if (events.length === 0) return { train: [], test: [] };
    if (!checkChronologicalOrder(events)) {
        throw new Error('chronologicalSplit: events must be in chronological order (sort first)');
    }
    const train = [];
    const test = [];
    for (const e of events) {
        if (e.ts < cutoff_ts) train.push(e);
        else test.push(e);
    }
    return { train, test };
}

// ── validateAlignedTimestamps ───────────────────────────────────────
function validateAlignedTimestamps(records, tickMs) {
    if (!Array.isArray(records)) {
        throw new Error('validateAlignedTimestamps: records must be array');
    }
    if (typeof tickMs !== 'number' || tickMs <= 0) {
        throw new Error('validateAlignedTimestamps: tickMs must be positive number');
    }
    for (const r of records) {
        if (!r || typeof r.ts !== 'number') continue;
        if (r.ts % tickMs !== 0) return false;
    }
    return true;
}

// ── checkLeakage ────────────────────────────────────────────────────
// Inspects {features, labels} pairs and returns array of detected leaks.
// Each label must reference its feature_ts + horizon_ms; if label_ts falls
// inside the future window, it's a leak.
function checkLeakage(payload) {
    if (!payload || typeof payload !== 'object') {
        throw new Error('checkLeakage: payload required');
    }
    if (!Array.isArray(payload.features) || !Array.isArray(payload.labels)) {
        throw new Error('checkLeakage: payload.features and payload.labels must be arrays');
    }
    const leaks = [];
    for (let i = 0; i < payload.labels.length; i++) {
        const lab = payload.labels[i];
        if (!lab || typeof lab.ts !== 'number') continue;
        if (typeof lab.feature_ts !== 'number' || typeof lab.horizon_ms !== 'number') continue;
        if (detectLookahead(lab.ts, lab.feature_ts, lab.horizon_ms)) {
            leaks.push({
                label_idx: i,
                type: 'lookahead',
                label_ts: lab.ts,
                feature_ts: lab.feature_ts,
                horizon_ms: lab.horizon_ms,
                detail: 'label_ts falls within feature future-observation window'
            });
        }
    }
    return leaks;
}

module.exports = {
    DATA_SCHEMAS,
    FORWARD_HORIZONS,
    checkChronologicalOrder,
    detectLookahead,
    chronologicalSplit,
    validateAlignedTimestamps,
    checkLeakage
};
