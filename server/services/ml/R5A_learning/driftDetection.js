'use strict';

/**
 * OMEGA R5A Learning Core — driftDetection (canonical §21)
 *
 * "Piata se schimba. Modelul trebuie sa stie cand nu mai intelege piata."
 *
 * Provides:
 *   - Pure math primitives (Kolmogorov-Smirnov test, PSI)
 *   - DB-driven aggregate comparing reference window vs current window
 *     across outcome, score, and pnl distributions
 *
 * Fills the §17 `drift_score` stub: caller composes
 *   { ...regimeMetrics, drift_score: getRegimeDrift(...).drift_score }
 *
 * DEFERRED to later waves:
 *   - Feature drift (needs per-decision feature snapshots) — Wave 3+
 *   - Relationship drift (feature covariance) — Wave 3+
 *   - Auto-retrain trigger — Wave 5+ retraining infrastructure
 *   - Rolling-window retraining — same
 *   - Canary deploy — R6 Shadow/Meta (Wave 7)
 *   - Auto-suspend — R5B governance integration (Wave 4)
 *   - Alert at suspend — Operator Interaction notification (Wave 5)
 * Stubs returned as `null` so API contract survives future implementation.
 */

const { db } = require('../../database');

const DRIFT_LEVELS = Object.freeze(['STABLE', 'MODERATE', 'UNSTABLE']);

// ── Pure math primitives ────────────────────────────────────────────

/**
 * Kolmogorov-Smirnov two-sample test. Returns {D, p_value} where
 *   D = max |CDF1(x) - CDF2(x)|
 *   p_value approximated via Kolmogorov distribution series.
 */
function ksTest(sample1, sample2) {
    if (!Array.isArray(sample1) || !Array.isArray(sample2)) {
        throw new Error('ksTest: both samples must be arrays');
    }
    if (sample1.length === 0 || sample2.length === 0) {
        return { D: 0, p_value: 1 };
    }
    const s1 = sample1.slice().sort((a, b) => a - b);
    const s2 = sample2.slice().sort((a, b) => a - b);
    let i = 0, j = 0;
    let D = 0;
    const n1 = s1.length;
    const n2 = s2.length;
    while (i < n1 && j < n2) {
        const v = Math.min(s1[i], s2[j]);
        while (i < n1 && s1[i] <= v) i++;
        while (j < n2 && s2[j] <= v) j++;
        const cdf1 = i / n1;
        const cdf2 = j / n2;
        const diff = Math.abs(cdf1 - cdf2);
        if (diff > D) D = diff;
    }
    // Asymptotic p-value via Kolmogorov distribution
    const nEff = (n1 * n2) / (n1 + n2);
    const lambda = (Math.sqrt(nEff) + 0.12 + 0.11 / Math.sqrt(nEff)) * D;
    const p_value = _kolmogorovQ(lambda);
    return { D, p_value: Math.max(0, Math.min(1, p_value)) };
}

function _kolmogorovQ(lambda) {
    if (lambda <= 0) return 1;
    const x = -2 * lambda * lambda;
    let sum = 0;
    let prevTerm = 0;
    for (let j = 1; j <= 100; j++) {
        const term = 2 * Math.pow(-1, j - 1) * Math.exp(x * j * j);
        sum += term;
        if (Math.abs(term) < 1e-10 || (j > 1 && Math.abs(term) < 1e-3 * Math.abs(prevTerm))) break;
        prevTerm = term;
    }
    return Math.max(0, Math.min(1, sum));
}

/**
 * Population Stability Index. Bins data into nBins equal-width buckets
 * over the reference range, then computes Σ (cur% - ref%) × ln(cur%/ref%).
 * Small epsilon avoids log(0) when a bin is empty in one distribution.
 */
function psi(reference, current, nBins = 10) {
    if (!Array.isArray(reference) || !Array.isArray(current)) {
        throw new Error('psi: both inputs must be arrays');
    }
    if (!Number.isInteger(nBins) || nBins < 2) {
        throw new Error('psi: nBins must be integer >= 2');
    }
    if (reference.length === 0 || current.length === 0) return 0;

    // Compute bin edges from reference range
    let min = Infinity, max = -Infinity;
    for (const v of reference) {
        if (typeof v === 'number' && Number.isFinite(v)) {
            if (v < min) min = v;
            if (v > max) max = v;
        }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
        return 0;  // degenerate reference
    }

    const edges = [];
    for (let i = 0; i <= nBins; i++) edges.push(min + (max - min) * i / nBins);

    const refCounts = new Array(nBins).fill(0);
    const curCounts = new Array(nBins).fill(0);
    const refTotal = reference.length;
    const curTotal = current.length;

    function bucket(v) {
        if (v < min) return 0;
        if (v >= max) return nBins - 1;
        return Math.min(nBins - 1, Math.floor((v - min) / (max - min) * nBins));
    }

    for (const v of reference) {
        if (typeof v === 'number' && Number.isFinite(v)) refCounts[bucket(v)]++;
    }
    for (const v of current) {
        if (typeof v === 'number' && Number.isFinite(v)) curCounts[bucket(v)]++;
    }

    const eps = 1e-6;
    let psiVal = 0;
    for (let i = 0; i < nBins; i++) {
        const refPct = refCounts[i] / refTotal || eps;
        const curPct = curCounts[i] / curTotal || eps;
        psiVal += (curPct - refPct) * Math.log(curPct / refPct);
    }
    return Math.max(0, psiVal);
}

function psiLevel(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 'STABLE';
    if (value < 0.1) return 'STABLE';
    if (value < 0.25) return 'MODERATE';
    return 'UNSTABLE';
}

// ── DB-driven aggregates ────────────────────────────────────────────

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`driftDetection: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    fetchWindow: db.prepare(`
        SELECT outcome_class, score_at_entry, pnl_pct
        FROM ml_attribution_events
        WHERE user_id = @userId AND resolved_env = @env
          AND attributed_at >= @fromMs AND attributed_at <= @toMs
          AND outcome_class IN ('WIN', 'LOSS')
          AND (@regime IS NULL OR regime = @regime)
          AND (@session IS NULL OR session = @session)
    `)
};

function _toDistributions(rows) {
    const outcomes = [];
    const scores = [];
    const pnls = [];
    for (const r of rows) {
        outcomes.push(r.outcome_class === 'WIN' ? 1 : 0);
        if (Number.isFinite(Number(r.score_at_entry))) scores.push(Number(r.score_at_entry));
        if (Number.isFinite(Number(r.pnl_pct))) pnls.push(Number(r.pnl_pct));
    }
    return { outcomes, scores, pnls };
}

function _computeDrift(refDist, curDist, nBins = 10) {
    const psiV = psi(refDist, curDist, nBins);
    const ks = ksTest(refDist, curDist);
    return {
        psi: psiV,
        ks_d: ks.D,
        ks_p: ks.p_value,
        level: psiLevel(psiV)
    };
}

function _aggregateDriftScore(driftSlices) {
    // Average PSI clamped to [0, 1]; UNSTABLE level bumps the score.
    let sumPsi = 0;
    let count = 0;
    let anyUnstable = false;
    let anyModerate = false;
    for (const slice of driftSlices) {
        if (!slice) continue;
        sumPsi += Math.min(1, slice.psi);
        count++;
        if (slice.level === 'UNSTABLE') anyUnstable = true;
        if (slice.level === 'MODERATE') anyModerate = true;
    }
    if (count === 0) return { score: 0, level: 'STABLE' };
    let score = sumPsi / count;
    if (anyUnstable) score = Math.max(score, 0.25);
    return {
        score: Math.max(0, Math.min(1, score)),
        level: anyUnstable ? 'UNSTABLE' : (anyModerate ? 'MODERATE' : 'STABLE')
    };
}

function getDrift(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const refW = _required(params, 'referenceWindow');
    const curW = _required(params, 'currentWindow');
    const regime = params.regime || null;
    const session = params.session || null;

    const refRows = _stmts.fetchWindow.all({
        userId, env, fromMs: refW.fromMs, toMs: refW.toMs, regime, session
    });
    const curRows = _stmts.fetchWindow.all({
        userId, env, fromMs: curW.fromMs, toMs: curW.toMs, regime, session
    });
    const refDist = _toDistributions(refRows);
    const curDist = _toDistributions(curRows);

    const outcome_drift = _computeDrift(refDist.outcomes, curDist.outcomes, 2);
    const score_drift = _computeDrift(refDist.scores, curDist.scores, 10);
    const pnl_drift = _computeDrift(refDist.pnls, curDist.pnls, 10);

    const { score: drift_score, level: drift_level } = _aggregateDriftScore([
        outcome_drift, score_drift, pnl_drift
    ]);

    return {
        sample_count: {
            reference: refRows.length,
            current: curRows.length
        },
        outcome_drift,
        score_drift,
        pnl_drift,
        drift_score,
        drift_level,
        // Wave 5+ stubs:
        feature_drift: null,
        relationship_drift: null,
        retrain_recommended: null,
        auto_suspend_triggered: null
    };
}

function getRegimeDrift(params) {
    const regime = _required(params, 'regime');
    return getDrift({ ...params, regime });
}

module.exports = {
    ksTest,
    psi,
    psiLevel,
    getDrift,
    getRegimeDrift,
    DRIFT_LEVELS
};
