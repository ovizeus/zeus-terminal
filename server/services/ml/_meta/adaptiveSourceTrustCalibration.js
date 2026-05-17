'use strict';

/**
 * OMEGA _meta — adaptiveSourceTrustCalibration (canonical §144)
 *
 * §144 ADAPTIVE SOURCE TRUST CALIBRATION — fiecare sursă de informație își
 * câștigă și pierde credibilitate dinamic.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt line 4713.
 *
 * "Spec-ul are data integrity layer (60) care detectează manipularea și
 *  datele corupte. Are data freshness (13). Are false consensus detector
 *  (128). Dar nu există un modul care recalibrează dinamic cât de mult
 *  merită să crezi fiecare sursă externă în funcție de performanța ei
 *  recentă în regimul actual... Santiment a prezis corect 3 mișcări majore
 *  luna trecută, dar nu a prins nimic din ultimele 2 săptămâni de chop.
 *  CVD de pe Bybit a fost predictiv în trend, dar zgomotos în range.
 *  Cross-venue divergence a funcționat excepțional în bull market dar a
 *  dat semnale false în bear lateral... O sursă care performează bine
 *  global dar prost în condițiile de acum primește autoritate redusă acum,
 *  indiferent de track record-ul ei lung."
 *
 * Algorithm: per (source × regime), compute:
 *   decayed_accuracy = weighted average where newest predictions × 1.0,
 *                       each older × DECAY_FACTOR (0.95)
 *   confidence_in_score = min(1, sample_count / MIN_SAMPLES_FOR_FULL)
 *   trust_score = decayed_accuracy × confidence + DEFAULT_BASELINE × (1 − confidence)
 *
 * Bayesian-flavored shrinkage to baseline when low samples — avoids
 * over-trusting source with only 2 predictions, even if both correct.
 *
 * Distinct from §60 dataIntegrityLayer (manipulation/corruption detection
 * — TECHNICAL), §13 dataFreshness (staleness — TECHNICAL), §128
 * falseConsensusDetector (artificial agreement — DEPENDENCE). §144 =
 * EPISTEMIC RELEVANCE CONTEXTUAL.
 */

const { db } = require('../../database');

const REGIMES = Object.freeze(['trend', 'range', 'chop', 'breakout']);
const TRUST_LEVELS = Object.freeze(['low', 'moderate', 'high']);
const TRUST_THRESHOLDS = Object.freeze({ high: 0.70, low: 0.30 });
const DECAY_FACTOR = 0.95;
const MIN_SAMPLES_FOR_FULL_CONFIDENCE = 20;
const DEFAULT_TRUST_BASELINE = 0.50;
const ACCURACY_THRESHOLD_FOR_CORRECT = 0.70;
const RECENT_WINDOW_SIZE = 100;  // max predictions considered per update

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`adaptiveSourceTrustCalibration: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertPrediction: db.prepare(`
        INSERT INTO ml_source_trust_predictions
        (user_id, resolved_env, prediction_id, source_name, regime,
         setup_kind, predicted_value_json, actual_value_json,
         accuracy_score, prediction_was_correct, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listRecentPredictions: db.prepare(`
        SELECT * FROM ml_source_trust_predictions
        WHERE user_id = ? AND resolved_env = ?
          AND source_name = ? AND regime = ?
        ORDER BY ts DESC LIMIT ?
    `),
    upsertScore: db.prepare(`
        INSERT INTO ml_source_trust_scores
        (user_id, resolved_env, score_id, source_name, regime,
         trust_score, sample_count, decayed_accuracy,
         confidence_in_score, last_updated_ts, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, resolved_env, source_name, regime) DO UPDATE SET
            trust_score = excluded.trust_score,
            sample_count = excluded.sample_count,
            decayed_accuracy = excluded.decayed_accuracy,
            confidence_in_score = excluded.confidence_in_score,
            last_updated_ts = excluded.last_updated_ts,
            ts = excluded.ts
    `),
    getScore: db.prepare(`
        SELECT * FROM ml_source_trust_scores
        WHERE user_id = ? AND resolved_env = ?
          AND source_name = ? AND regime = ?
    `),
    listScoresForSource: db.prepare(`
        SELECT * FROM ml_source_trust_scores
        WHERE user_id = ? AND resolved_env = ? AND source_name = ?
    `),
    listScoresForRegime: db.prepare(`
        SELECT * FROM ml_source_trust_scores
        WHERE user_id = ? AND resolved_env = ? AND regime = ?
        ORDER BY trust_score DESC LIMIT ?
    `)
};

// ── computeDecayedAccuracy (pure) ──────────────────────────────────
// Predictions assumed newest-first (DESC by ts). Each older × decay.
function computeDecayedAccuracy(params) {
    const predictions = _required(params, 'predictions');
    const decayFactor = _required(params, 'decayFactor');
    if (!Array.isArray(predictions)) {
        throw new Error('adaptiveSourceTrustCalibration: predictions must be array');
    }
    if (predictions.length === 0) return { decayedAccuracy: 0 };
    let weightedSum = 0;
    let totalWeight = 0;
    let weight = 1.0;
    for (const p of predictions) {
        weightedSum += p.accuracy_score * weight;
        totalWeight += weight;
        weight *= decayFactor;
    }
    return { decayedAccuracy: weightedSum / totalWeight };
}

// ── computeConfidenceInScore (pure) ────────────────────────────────
function computeConfidenceInScore(params) {
    const sampleCount = _required(params, 'sampleCount');
    const minSamples = _required(params, 'minSamples');
    if (sampleCount < 0 || minSamples <= 0) {
        throw new Error('adaptiveSourceTrustCalibration: invalid counts');
    }
    return { confidence: Math.min(1, sampleCount / minSamples) };
}

// ── combineTrust (pure) ────────────────────────────────────────────
// Bayesian shrinkage: low samples → trust toward baseline
function combineTrust(params) {
    const accuracy = _required(params, 'decayedAccuracy');
    const confidence = _required(params, 'confidenceInScore');
    const baseline = _required(params, 'defaultBaseline');
    const trust = accuracy * confidence + baseline * (1 - confidence);
    return { trustScore: Math.max(0, Math.min(1, trust)) };
}

// ── classifyTrustLevel (pure) ──────────────────────────────────────
function classifyTrustLevel(params) {
    const trust = _required(params, 'trustScore');
    if (trust < 0 || trust > 1) {
        throw new Error('adaptiveSourceTrustCalibration: trustScore [0,1]');
    }
    if (trust >= TRUST_THRESHOLDS.high) return { trustLevel: 'high' };
    if (trust < TRUST_THRESHOLDS.low) return { trustLevel: 'low' };
    return { trustLevel: 'moderate' };
}

// ── recordPrediction ───────────────────────────────────────────────
function recordPrediction(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const pid = _required(params, 'predictionId');
    const source = _required(params, 'sourceName');
    const regime = _required(params, 'regime');
    const setup = _required(params, 'setupKind');
    const predicted = _required(params, 'predictedValue');
    const actual = _required(params, 'actualValue');
    const accuracy = _required(params, 'accuracyScore');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!REGIMES.includes(regime)) {
        throw new Error(
            `adaptiveSourceTrustCalibration: invalid regime "${regime}"`
        );
    }
    if (accuracy < 0 || accuracy > 1) {
        throw new Error(
            'adaptiveSourceTrustCalibration: accuracyScore must be in [0,1]'
        );
    }
    const correct = accuracy >= ACCURACY_THRESHOLD_FOR_CORRECT ? 1 : 0;
    try {
        _stmts.insertPrediction.run(
            userId, env, pid, source, regime, setup,
            JSON.stringify(predicted), JSON.stringify(actual),
            accuracy, correct, ts
        );
        return {
            recorded: true, predictionId: pid,
            predictionWasCorrect: correct === 1
        };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `adaptiveSourceTrustCalibration: duplicate predictionId "${pid}"`
            );
        }
        throw err;
    }
}

// ── updateSourceTrust (integration) ────────────────────────────────
function updateSourceTrust(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const source = _required(params, 'sourceName');
    const regime = _required(params, 'regime');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!REGIMES.includes(regime)) {
        throw new Error(
            `adaptiveSourceTrustCalibration: invalid regime "${regime}"`
        );
    }
    const predictions = _stmts.listRecentPredictions.all(
        userId, env, source, regime, RECENT_WINDOW_SIZE
    );
    const sampleCount = predictions.length;
    const { decayedAccuracy } = computeDecayedAccuracy({
        predictions, decayFactor: DECAY_FACTOR
    });
    const { confidence } = computeConfidenceInScore({
        sampleCount, minSamples: MIN_SAMPLES_FOR_FULL_CONFIDENCE
    });
    const { trustScore } = combineTrust({
        decayedAccuracy, confidenceInScore: confidence,
        defaultBaseline: DEFAULT_TRUST_BASELINE
    });
    const scoreId = `${source}_${regime}_${userId}_${env}`;
    _stmts.upsertScore.run(
        userId, env, scoreId, source, regime,
        trustScore, sampleCount, decayedAccuracy, confidence, ts, ts
    );
    return {
        updated: true, sourceName: source, regime,
        trustScore, sampleCount, decayedAccuracy,
        confidenceInScore: confidence
    };
}

// ── getSourceTrust ─────────────────────────────────────────────────
function getSourceTrust(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const source = _required(params, 'sourceName');
    const regime = _required(params, 'regime');
    if (!REGIMES.includes(regime)) {
        throw new Error(
            `adaptiveSourceTrustCalibration: invalid regime "${regime}"`
        );
    }
    const r = _stmts.getScore.get(userId, env, source, regime);
    if (!r) {
        return {
            sourceName: source, regime,
            trustScore: DEFAULT_TRUST_BASELINE,
            sampleCount: 0,
            decayedAccuracy: 0,
            confidenceInScore: 0,
            isDefault: true
        };
    }
    return {
        sourceName: r.source_name,
        regime: r.regime,
        trustScore: r.trust_score,
        sampleCount: r.sample_count,
        decayedAccuracy: r.decayed_accuracy,
        confidenceInScore: r.confidence_in_score,
        lastUpdatedTs: r.last_updated_ts,
        isDefault: false
    };
}

// ── getSourceTrustAcrossRegimes ────────────────────────────────────
function getSourceTrustAcrossRegimes(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const source = _required(params, 'sourceName');
    const rows = _stmts.listScoresForSource.all(userId, env, source);
    const map = {};
    for (const regime of REGIMES) {
        const found = rows.find(r => r.regime === regime);
        if (found) {
            map[regime] = {
                trustScore: found.trust_score,
                sampleCount: found.sample_count,
                decayedAccuracy: found.decayed_accuracy,
                confidenceInScore: found.confidence_in_score,
                isDefault: false
            };
        } else {
            map[regime] = {
                trustScore: DEFAULT_TRUST_BASELINE,
                sampleCount: 0,
                decayedAccuracy: 0,
                confidenceInScore: 0,
                isDefault: true
            };
        }
    }
    return map;
}

// ── getTopSourcesForRegime ─────────────────────────────────────────
function getTopSourcesForRegime(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const regime = _required(params, 'regime');
    const limit = (params && params.limit) ? params.limit : 10;
    if (!REGIMES.includes(regime)) {
        throw new Error(
            `adaptiveSourceTrustCalibration: invalid regime "${regime}"`
        );
    }
    const rows = _stmts.listScoresForRegime.all(userId, env, regime, limit);
    return rows.map(r => ({
        sourceName: r.source_name,
        regime: r.regime,
        trustScore: r.trust_score,
        sampleCount: r.sample_count,
        decayedAccuracy: r.decayed_accuracy,
        confidenceInScore: r.confidence_in_score
    }));
}

module.exports = {
    REGIMES,
    TRUST_LEVELS,
    TRUST_THRESHOLDS,
    DECAY_FACTOR,
    MIN_SAMPLES_FOR_FULL_CONFIDENCE,
    DEFAULT_TRUST_BASELINE,
    ACCURACY_THRESHOLD_FOR_CORRECT,
    RECENT_WINDOW_SIZE,
    computeDecayedAccuracy,
    computeConfidenceInScore,
    combineTrust,
    classifyTrustLevel,
    recordPrediction,
    updateSourceTrust,
    getSourceTrust,
    getSourceTrustAcrossRegimes,
    getTopSourcesForRegime
};
