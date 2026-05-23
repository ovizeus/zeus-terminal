'use strict';

// [Wave 4] Conformal Prediction split CP — given regime + confidence, returns
// statistically valid prediction interval at target coverage (90%).
//
// Method: Split conformal — per-regime calibration buffer holds last N residuals
// (actual - predicted). Interval = predicted ± quantile_{1-α}(|residuals|).
// Cold start (< MIN_SAMPLES): wide default interval ±0.20 (50% of [0,1] range).
// Buffer capped at MAX_PER_BUCKET via FIFO eviction (oldest deleted on overflow).

const { db } = require('../../database');

const TARGET_ALPHA = 0.1;          // 90% coverage
const MIN_SAMPLES = 30;            // below this → cold start
const MAX_PER_BUCKET = 200;        // buffer cap per regime
const DEFAULT_HALF_WIDTH = 0.20;   // cold-start fallback

function _bucketConfidence(c) {
    return Math.max(0, Math.min(9, Math.floor((c || 0) / 10)));
}

function _quantile(sortedAbsResiduals, alpha) {
    if (sortedAbsResiduals.length === 0) return DEFAULT_HALF_WIDTH;
    const idx = Math.ceil((1 - alpha) * (sortedAbsResiduals.length + 1)) - 1;
    return sortedAbsResiduals[Math.max(0, Math.min(idx, sortedAbsResiduals.length - 1))];
}

function predictInterval({ regime, confidence, predicted }) {
    const rows = db.prepare(
        `SELECT residual FROM ml_r3b_calibration WHERE regime = ? ORDER BY ts DESC LIMIT ?`
    ).all(regime, MAX_PER_BUCKET);

    if (rows.length < MIN_SAMPLES) {
        return {
            lower: Math.max(0, predicted - DEFAULT_HALF_WIDTH),
            upper: Math.min(1, predicted + DEFAULT_HALF_WIDTH),
            halfWidth: DEFAULT_HALF_WIDTH,
            sampleSize: rows.length,
            coldStart: true,
            validity: 'cold_start',
        };
    }

    const abs = rows.map(r => Math.abs(r.residual)).sort((a, b) => a - b);
    const halfWidth = _quantile(abs, TARGET_ALPHA);
    return {
        lower: Math.max(0, predicted - halfWidth),
        upper: Math.min(1, predicted + halfWidth),
        halfWidth,
        sampleSize: rows.length,
        coldStart: false,
        validity: 'cp_split',
    };
}

function recordOutcome({ regime, confidence, predicted, actual }) {
    const residual = (actual || 0) - (predicted || 0);
    const bucket = _bucketConfidence(confidence);
    db.prepare(
        `INSERT INTO ml_r3b_calibration (regime, confidence_bucket, residual, outcome, ts) VALUES (?, ?, ?, ?, ?)`
    ).run(regime, bucket, residual, actual || 0, Date.now());

    const count = db.prepare(
        `SELECT COUNT(*) AS n FROM ml_r3b_calibration WHERE regime = ?`
    ).get(regime).n;
    if (count > MAX_PER_BUCKET) {
        db.prepare(
            `DELETE FROM ml_r3b_calibration WHERE id IN (
                SELECT id FROM ml_r3b_calibration WHERE regime = ? ORDER BY ts ASC LIMIT ?
            )`
        ).run(regime, count - MAX_PER_BUCKET);
    }
}

module.exports = { predictInterval, recordOutcome };
