'use strict';

/**
 * OMEGA R5A Learning Core — counterfactualPortfolio (§242 chat-precedent)
 *
 * §242 = chat-precedent addition (2026-04). NOT canonical PDF, NOT
 * Claude-extras `*`. Source: project_ml_brain_pro_244.md "242 → R5
 * (counterfactual portfolio addition)".
 *
 * Before opening a candidate position, compute the counterfactual
 * portfolio (current + candidate) and score it against limits:
 *   - max_total_exposure_pct
 *   - max_concentration_pct
 *   - max_correlation (pair)
 *   - min_score_delta (candidate must improve avg score)
 *
 * Catches common bug: candidate symbol 90%+ correlated with existing
 * positions = effectively duplicate exposure (real risk doubled while
 * portfolio thinks it's diversified).
 *
 * Pure logic, no DB writes, no migration. Wave 5+ will replace heuristic
 * estimateCorrelation with a real correlation matrix from price data.
 */

const THRESHOLDS = Object.freeze({
    max_total_exposure_pct: 5.0,
    max_concentration_pct: 2.0,
    max_correlation: 0.8,
    min_score_delta: 0
});

const RECOMMENDATIONS = Object.freeze(['ADD', 'SKIP']);

const MAJOR_SYMBOLS = new Set(['BTC', 'ETH']);

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`counterfactualPortfolio: missing ${key}`);
    }
    return params[key];
}

function _symbolBase(symbol) {
    if (typeof symbol !== 'string') return null;
    const m = symbol.toUpperCase().match(/^([A-Z]+?)(USDT?|USDC|BUSD|TUSD)?$/);
    return m ? m[1] : symbol.toUpperCase();
}

// ── estimateCorrelation ────────────────────────────────────────────
// Wave 3 heuristic — symbol-family-based. Wave 5+ replaces with real
// rolling correlation matrix from market data.
function estimateCorrelation(symbolA, symbolB) {
    if (!symbolA || !symbolB) {
        throw new Error('estimateCorrelation: both symbols required');
    }
    if (symbolA === symbolB) return 1.0;
    const baseA = _symbolBase(symbolA);
    const baseB = _symbolBase(symbolB);
    if (!baseA || !baseB) return 0.3;

    if (baseA === baseB) return 0.95;   // same family (BTC family across stablecoins)

    const aMajor = MAJOR_SYMBOLS.has(baseA);
    const bMajor = MAJOR_SYMBOLS.has(baseB);
    if (aMajor && bMajor) return 0.7;   // BTC vs ETH
    if (aMajor || bMajor) return 0.5;    // major vs alt
    return 0.3;                          // two alts
}

// ── computeCounterfactualPortfolio ─────────────────────────────────
function computeCounterfactualPortfolio(params) {
    const current = params && Array.isArray(params.currentPositions)
        ? params.currentPositions
        : null;
    const candidate = _required(params, 'candidate');
    if (current === null) {
        throw new Error('computeCounterfactualPortfolio: currentPositions must be array');
    }
    return [...current, candidate];
}

// ── scorePortfolio ─────────────────────────────────────────────────
function scorePortfolio(portfolio, balance) {
    if (!Array.isArray(portfolio)) {
        throw new Error('scorePortfolio: portfolio must be array');
    }
    if (typeof balance !== 'number' || balance <= 0) {
        throw new Error('scorePortfolio: balance must be positive number');
    }

    const n = portfolio.length;
    if (n === 0) {
        return {
            total_exposure_pct: 0,
            max_concentration_pct: 0,
            max_correlation_pair: null,
            avg_score: 0,
            position_count: 0,
            score: 0
        };
    }

    const totalUsd = portfolio.reduce((s, p) => s + (Number(p.sizeUsd) || 0), 0);
    const maxConcentrationUsd = portfolio.reduce(
        (m, p) => Math.max(m, Number(p.sizeUsd) || 0), 0
    );
    const avgScore = portfolio.reduce(
        (s, p) => s + (Number(p.score) || 0), 0
    ) / n;

    // Max correlation pair
    let maxCorrelationPair = null;
    let maxCorrelation = 0;
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            const corr = estimateCorrelation(portfolio[i].symbol, portfolio[j].symbol);
            if (corr > maxCorrelation) {
                maxCorrelation = corr;
                maxCorrelationPair = {
                    symbol_a: portfolio[i].symbol,
                    symbol_b: portfolio[j].symbol,
                    correlation: corr
                };
            }
        }
    }

    const totalExposurePct = (totalUsd / balance) * 100;
    const maxConcentrationPct = (maxConcentrationUsd / balance) * 100;

    // Composite score: prefer high avg_score, low concentration, low correlation
    const concentrationPenalty = Math.max(0, maxConcentrationPct - THRESHOLDS.max_concentration_pct);
    const correlationPenalty = Math.max(0, maxCorrelation - THRESHOLDS.max_correlation);
    const score = avgScore - 0.1 * concentrationPenalty - 0.5 * correlationPenalty;

    return {
        total_exposure_pct: totalExposurePct,
        max_concentration_pct: maxConcentrationPct,
        max_correlation_pair: maxCorrelationPair,
        avg_score: avgScore,
        position_count: n,
        score
    };
}

// ── evaluateAddition ───────────────────────────────────────────────
function evaluateAddition(params) {
    const current = params && Array.isArray(params.currentPositions)
        ? params.currentPositions
        : null;
    const candidate = _required(params, 'candidate');
    const balance = _required(params, 'balance');
    if (current === null) {
        throw new Error('evaluateAddition: currentPositions must be array');
    }
    const thresholds = Object.assign({}, THRESHOLDS, params.thresholds || {});

    const counterfactual = computeCounterfactualPortfolio({
        currentPositions: current, candidate
    });
    const currentMetrics = scorePortfolio(current, balance);
    const cfMetrics = scorePortfolio(counterfactual, balance);

    const violations = [];
    if (cfMetrics.total_exposure_pct > thresholds.max_total_exposure_pct) {
        violations.push({
            type: 'total_exposure',
            value: cfMetrics.total_exposure_pct,
            limit: thresholds.max_total_exposure_pct
        });
    }
    if (cfMetrics.max_concentration_pct > thresholds.max_concentration_pct) {
        violations.push({
            type: 'concentration',
            value: cfMetrics.max_concentration_pct,
            limit: thresholds.max_concentration_pct
        });
    }
    if (cfMetrics.max_correlation_pair
        && cfMetrics.max_correlation_pair.correlation > thresholds.max_correlation) {
        violations.push({
            type: 'correlation',
            value: cfMetrics.max_correlation_pair.correlation,
            limit: thresholds.max_correlation,
            pair: cfMetrics.max_correlation_pair
        });
    }
    const delta = cfMetrics.score - currentMetrics.score;
    if (delta < thresholds.min_score_delta) {
        violations.push({
            type: 'score_delta',
            value: delta,
            limit: thresholds.min_score_delta
        });
    }

    const recommendation = violations.length === 0 ? 'ADD' : 'SKIP';
    const reason = violations.length === 0
        ? 'all limits respected; candidate improves portfolio'
        : `violations: ${violations.map(v => v.type).join(', ')}`;

    return {
        recommendation,
        reason,
        current_metrics: currentMetrics,
        counterfactual_metrics: cfMetrics,
        delta,
        violations
    };
}

module.exports = {
    THRESHOLDS,
    RECOMMENDATIONS,
    estimateCorrelation,
    computeCounterfactualPortfolio,
    scorePortfolio,
    evaluateAddition
};
