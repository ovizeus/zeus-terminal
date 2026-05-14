'use strict';

/**
 * OMEGA R0 Substrate — timeIntegrity (spec 245*)
 *
 * Foundation primitives for time consistency across rings:
 * - `monotonicNow()` — strictly non-decreasing high-resolution clock
 *   (process.hrtime.bigint based, immune to system clock adjustments).
 * - `detectTimeSkew(referenceMs)` — measure local clock drift vs an
 *   externally-trusted reference (NTP server-truth source, exchange API time).
 * - `validateTimestamp(ts, maxSkewMs)` — reject stale or future timestamps.
 *
 * Every ML decision logs `created_at` (epoch ms). Without integrity checks,
 * an unsynced clock would corrupt audit trails, replay determinism (spec
 * invariant #6), and operator-approval cooldown windows.
 *
 * Real production wiring: feed `detectTimeSkew` from exchange `time` REST
 * endpoints + NTP — that lands in Wave 6 R4 execution prep.
 */

const MAX_SKEW_MS = 5_000;

let _monotonicOrigin = null;

function monotonicNow() {
    if (_monotonicOrigin === null) {
        _monotonicOrigin = process.hrtime.bigint();
        return 0;
    }
    const delta = process.hrtime.bigint() - _monotonicOrigin;
    return Number(delta / 1_000_000n);
}

function detectTimeSkew(referenceMs) {
    if (typeof referenceMs !== 'number' || !Number.isFinite(referenceMs)) {
        throw new Error('detectTimeSkew: referenceMs must be a finite numeric value');
    }
    return Date.now() - referenceMs;
}

function validateTimestamp(ts, maxSkewMs = MAX_SKEW_MS) {
    if (typeof ts !== 'number' || !Number.isFinite(ts)) {
        throw new Error('validateTimestamp: ts must be a finite numeric value');
    }
    if (!Number.isFinite(maxSkewMs) || maxSkewMs < 0) {
        throw new Error('validateTimestamp: maxSkewMs must be a non-negative number');
    }
    const skew = Date.now() - ts;
    if (skew > maxSkewMs) {
        throw new Error(`time skew detected: timestamp is stale (${skew}ms > ${maxSkewMs}ms threshold)`);
    }
    if (skew < -maxSkewMs) {
        throw new Error(`time skew detected: timestamp is in future (${-skew}ms ahead, ${maxSkewMs}ms threshold)`);
    }
    return true;
}

module.exports = {
    monotonicNow,
    detectTimeSkew,
    validateTimestamp,
    MAX_SKEW_MS
};
