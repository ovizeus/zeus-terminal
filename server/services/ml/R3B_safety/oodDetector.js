'use strict';

// [Wave 4] OOD Detector — feature-bin histograms per known feature. Each
// numeric feature bucketed into N=20 bins. Score = avg per-feature rarity
// (1 - p_bin/p_max). Cold start (< MIN_OBS observations) returns score=0,
// isOOD=false. Novel features (never observed) flagged separately.

const { db } = require('../../database');

const BIN_COUNT = 20;
const MIN_OBS = 50;
const OOD_THRESHOLD = 0.6;

// Known feature ranges. Unknown features fall back to [0, 100].
const FEATURE_RANGES = {
    rsi: [0, 100],
    adx: [0, 100],
    confidence: [0, 100],
    atr: [0, 1000],
    score: [0, 100],
};

function _bin(featureName, value) {
    const range = FEATURE_RANGES[featureName] || [0, 100];
    const [lo, hi] = range;
    const clamped = Math.max(lo, Math.min(hi, value));
    const norm = (clamped - lo) / (hi - lo);
    return Math.max(0, Math.min(BIN_COUNT - 1, Math.floor(norm * BIN_COUNT)));
}

function observe(features) {
    for (const [name, value] of Object.entries(features || {})) {
        if (typeof value !== 'number' || !isFinite(value)) continue;
        const bin = _bin(name, value);
        db.prepare(
            `INSERT INTO ml_r3b_ood_histogram (feature_name, bin_id, count, updated_at) VALUES (?, ?, 1, ?)
             ON CONFLICT(feature_name, bin_id) DO UPDATE SET count = count + 1, updated_at = excluded.updated_at`
        ).run(name, bin, Date.now());
    }
}

function score(features) {
    const totalObs = db.prepare(
        `SELECT SUM(count) AS n FROM ml_r3b_ood_histogram`
    ).get().n || 0;

    // Detect novel features regardless of cold-start state — operator
    // visibility into "I've never seen this feature before" doesn't need
    // a calibrated baseline. OOD score gating still requires MIN_OBS.
    const novelFeatures = [];
    const rarityScores = [];

    for (const [name, value] of Object.entries(features || {})) {
        if (typeof value !== 'number' || !isFinite(value)) continue;
        const knownRow = db.prepare(
            `SELECT COUNT(*) AS n FROM ml_r3b_ood_histogram WHERE feature_name = ?`
        ).get(name);
        if (!knownRow || knownRow.n === 0) {
            novelFeatures.push(name);
            rarityScores.push(1.0);
            continue;
        }
        const bin = _bin(name, value);
        const binCount = db.prepare(
            `SELECT count FROM ml_r3b_ood_histogram WHERE feature_name = ? AND bin_id = ?`
        ).get(name, bin);
        const maxRow = db.prepare(
            `SELECT MAX(count) AS m FROM ml_r3b_ood_histogram WHERE feature_name = ?`
        ).get(name);
        const maxCount = (maxRow && maxRow.m) || 1;
        const pBin = (binCount ? binCount.count : 0) / maxCount;
        rarityScores.push(1 - pBin);
    }

    const avgRarity = rarityScores.length > 0
        ? rarityScores.reduce((a, b) => a + b, 0) / rarityScores.length
        : 0;

    // Cold start: don't trust the score, but DO surface novel features
    // (those are detectable independent of calibration).
    if (totalObs < MIN_OBS) {
        return {
            score: 0,
            isOOD: false,
            coldStart: true,
            novelFeatures,
            samples: totalObs,
        };
    }

    return {
        score: avgRarity,
        isOOD: avgRarity > OOD_THRESHOLD || novelFeatures.length > 0,
        coldStart: false,
        novelFeatures,
        samples: totalObs,
    };
}

module.exports = { observe, score };
