'use strict';

/**
 * OMEGA R5A Learning Core — calibration (canonical §20)
 *
 * Probabilistic calibration measurement per spec:
 *   "Daca botul spune 80% confidence, trades din acea clasa trebuie
 *    sa castige aproximativ in jurul acelui nivel."
 *
 * Provides:
 *   - Pure math primitives (Brier, reliability diagram, ECE, Wilson CI)
 *   - DB-driven aggregate (getCalibration / getRegimeCalibration)
 *
 * Fills the §17 `calibration_quality` stub: caller composes
 *   { ...regimeMetrics, calibration: getRegimeCalibration(...) }
 *
 * DEFERRED to Wave 5+:
 *   - Platt scaling / isotonic regression remap (retraining loop)
 *   - Aleatoric uncertainty (irreducible noise — needs variance modeling)
 *   - Epistemic uncertainty (knowledge gap — needs ensemble disagreement)
 * Stubs returned as `null` so API contract survives future implementation.
 */

const { db } = require('../../database');

// ── Pure math primitives ────────────────────────────────────────────

/**
 * Brier score: mean squared difference between predicted prob and actual.
 * predictions: Array<{ score: 0..1, actual_win: 0|1 }>
 * Lower = better; 0 = perfect; 1 = worst.
 */
function brierScore(predictions) {
    if (!Array.isArray(predictions)) {
        throw new Error('brierScore: predictions must be array');
    }
    if (predictions.length === 0) return 0;
    let sum = 0;
    for (const p of predictions) {
        const diff = p.score - p.actual_win;
        sum += diff * diff;
    }
    return sum / predictions.length;
}

/**
 * Reliability diagram bins. Predictions grouped into nBins buckets by score;
 * each bucket reports mean predicted vs mean actual win rate.
 *
 * Bin i covers [i/N, (i+1)/N), except last bin which includes 1.0 endpoint.
 */
function reliabilityDiagram(predictions, nBins = 10) {
    if (!Array.isArray(predictions)) {
        throw new Error('reliabilityDiagram: predictions must be array');
    }
    if (!Number.isInteger(nBins) || nBins < 2) {
        throw new Error('reliabilityDiagram: nBins must be integer >= 2');
    }
    const bins = [];
    for (let i = 0; i < nBins; i++) {
        bins.push({
            bin_min: i / nBins,
            bin_max: (i + 1) / nBins,
            sum_pred: 0,
            sum_actual: 0,
            count: 0,
            mean_pred: null,
            mean_actual: null
        });
    }
    for (const p of predictions) {
        let idx = Math.floor(p.score * nBins);
        if (idx >= nBins) idx = nBins - 1;   // include 1.0 endpoint
        if (idx < 0) idx = 0;
        bins[idx].sum_pred += p.score;
        bins[idx].sum_actual += p.actual_win;
        bins[idx].count += 1;
    }
    for (const b of bins) {
        if (b.count > 0) {
            b.mean_pred = b.sum_pred / b.count;
            b.mean_actual = b.sum_actual / b.count;
        }
        // omit raw sums from output
        delete b.sum_pred;
        delete b.sum_actual;
    }
    return bins;
}

/**
 * Expected Calibration Error: weighted mean |mean_pred − mean_actual| across
 * non-empty bins.
 */
function expectedCalibrationError(bins) {
    if (!Array.isArray(bins)) return 0;
    let totalCount = 0;
    let totalWeightedError = 0;
    for (const b of bins) {
        if (!b || !b.count) continue;
        totalCount += b.count;
        const mp = b.mean_pred ?? 0;
        const ma = b.mean_actual ?? 0;
        totalWeightedError += Math.abs(mp - ma) * b.count;
    }
    if (totalCount === 0) return 0;
    return totalWeightedError / totalCount;
}

/**
 * Calibration quality: 1 - ECE clamped to [0, 1]. Fills §17 stub.
 * 1 = perfectly calibrated; 0 = completely miscalibrated.
 */
function calibrationQuality(predictions) {
    if (!Array.isArray(predictions) || predictions.length === 0) return 0;
    const bins = reliabilityDiagram(predictions, 10);
    const ece = expectedCalibrationError(bins);
    return Math.max(0, Math.min(1, 1 - ece));
}

/**
 * Wilson confidence interval for a binomial proportion.
 * confidence: number in (0, 1), e.g. 0.95
 */
function wilsonInterval(wins, total, confidence = 0.95) {
    if (!Number.isFinite(wins) || wins < 0) throw new Error('wilsonInterval: wins must be >= 0');
    if (!Number.isFinite(total) || total < 0) throw new Error('wilsonInterval: total must be >= 0');
    if (wins > total) throw new Error('wilsonInterval: wins cannot exceed total');
    if (!Number.isFinite(confidence) || confidence <= 0 || confidence >= 1) {
        throw new Error('wilsonInterval: confidence must be in (0, 1)');
    }
    if (total === 0) return { low: 0, high: 0 };
    // z-score for two-sided confidence (approximated via erfcinv)
    // For common confidences hardcode to avoid numeric library dependency
    const Z_TABLE = { 0.9: 1.6449, 0.95: 1.96, 0.99: 2.5758 };
    let z = Z_TABLE[confidence];
    if (z === undefined) {
        // Fallback: rational approximation
        const p = (1 + confidence) / 2;
        z = _normalQuantile(p);
    }
    const p = wins / total;
    const denom = 1 + (z * z) / total;
    const centre = p + (z * z) / (2 * total);
    const halfWidth = z * Math.sqrt((p * (1 - p) / total) + (z * z) / (4 * total * total));
    return {
        low: Math.max(0, (centre - halfWidth) / denom),
        high: Math.min(1, (centre + halfWidth) / denom)
    };
}

/**
 * Acklam's rational approximation of the standard normal inverse CDF.
 * Used by wilsonInterval as fallback for non-standard confidence levels.
 */
function _normalQuantile(p) {
    if (p <= 0 || p >= 1) return p < 0.5 ? -Infinity : Infinity;
    const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.3577518672690, -30.66479806614716, 2.506628277459239];
    const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
    const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
    const pLow = 0.02425;
    const pHigh = 1 - pLow;
    let q, r;
    if (p < pLow) {
        q = Math.sqrt(-2 * Math.log(p));
        return (((((c[0]*q + c[1])*q + c[2])*q + c[3])*q + c[4])*q + c[5]) / ((((d[0]*q + d[1])*q + d[2])*q + d[3])*q + 1);
    }
    if (p <= pHigh) {
        q = p - 0.5;
        r = q * q;
        return (((((a[0]*r + a[1])*r + a[2])*r + a[3])*r + a[4])*r + a[5])*q / (((((b[0]*r + b[1])*r + b[2])*r + b[3])*r + b[4])*r + 1);
    }
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]*q + c[1])*q + c[2])*q + c[3])*q + c[4])*q + c[5]) / ((((d[0]*q + d[1])*q + d[2])*q + d[3])*q + 1);
}

// ── DB-driven aggregates ────────────────────────────────────────────

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`calibration: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    fetchDecisive: db.prepare(`
        SELECT score_at_entry AS score, outcome_class
        FROM ml_attribution_events
        WHERE user_id = @userId AND resolved_env = @env
          AND attributed_at >= @sinceMs
          AND outcome_class IN ('WIN', 'LOSS')
          AND score_at_entry IS NOT NULL
          AND (@regime IS NULL OR regime = @regime)
          AND (@session IS NULL OR session = @session)
    `)
};

function _toPredictions(rows) {
    return rows.map(r => ({
        score: Number(r.score),
        actual_win: r.outcome_class === 'WIN' ? 1 : 0
    }));
}

function _zeroResult() {
    const emptyBins = reliabilityDiagram([], 10);
    return {
        sample_count: 0,
        brier_score: 0,
        ece: 0,
        calibration_quality: 0,
        reliability_diagram: emptyBins,
        isotonic_correction: null,      // Wave 5+ remap
        aleatoric_uncertainty: null,    // Wave 5+ variance modeling
        epistemic_uncertainty: null     // Wave 5+ ensemble disagreement
    };
}

function _calibrationFromPredictions(predictions) {
    if (predictions.length === 0) return _zeroResult();
    const bins = reliabilityDiagram(predictions, 10);
    const brier = brierScore(predictions);
    const ece = expectedCalibrationError(bins);
    const quality = Math.max(0, Math.min(1, 1 - ece));
    return {
        sample_count: predictions.length,
        brier_score: brier,
        ece,
        calibration_quality: quality,
        reliability_diagram: bins,
        isotonic_correction: null,
        aleatoric_uncertainty: null,
        epistemic_uncertainty: null
    };
}

function getCalibration(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const sinceMs = params.sinceMs || 0;
    const regime = params.regime || null;
    const session = params.session || null;
    const rows = _stmts.fetchDecisive.all({ userId, env, sinceMs, regime, session });
    return _calibrationFromPredictions(_toPredictions(rows));
}

function getRegimeCalibration(params) {
    const regime = _required(params, 'regime');
    return getCalibration({ ...params, regime });
}

module.exports = {
    brierScore,
    reliabilityDiagram,
    expectedCalibrationError,
    calibrationQuality,
    wilsonInterval,
    getCalibration,
    getRegimeCalibration
};
