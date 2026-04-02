// Zeus Terminal — Confidence Calibration + Correlation Awareness
// Tracks predicted confidence vs actual outcomes for recalibration.
// Detects correlated positions and regime transitions.
'use strict';

const logger = require('./logger');

// ══════════════════════════════════════════════════════════════════
// Correlation Matrix (simplified — based on historical co-movement)
// ══════════════════════════════════════════════════════════════════
const BASE_CORRELATIONS = {
    'BTCUSDT:ETHUSDT': 0.92,
    'BTCUSDT:SOLUSDT': 0.85,
    'BTCUSDT:BNBUSDT': 0.80,
    'ETHUSDT:SOLUSDT': 0.88,
    'ETHUSDT:BNBUSDT': 0.78,
    'SOLUSDT:BNBUSDT': 0.75,
};

// Rolling correlation tracker (updated from price data)
const _rollingCorr = new Map(); // 'SYM1:SYM2' → { corr, ts }
const _priceHistory = new Map(); // symbol → [{ ts, price }] (last 100 prices)
const PRICE_HISTORY_MAX = 100;

// ══════════════════════════════════════════════════════════════════
// Regime Transition Detection
// ══════════════════════════════════════════════════════════════════
const _regimeHistory = new Map(); // symbol → [{ regime, ts, adx, vol }]
const REGIME_HISTORY_MAX = 20;

function trackRegime(symbol, regime, adx, volatilityState) {
    if (!_regimeHistory.has(symbol)) _regimeHistory.set(symbol, []);
    const history = _regimeHistory.get(symbol);
    history.push({ regime, ts: Date.now(), adx, volatilityState });
    if (history.length > REGIME_HISTORY_MAX) history.shift();
}

/**
 * Detect if regime is transitioning (not just current state, but the direction of change).
 * @returns {{ transitioning: bool, from: string, to: string, confidence: number, warning: string }}
 */
function detectRegimeTransition(symbol) {
    const history = _regimeHistory.get(symbol);
    if (!history || history.length < 3) return { transitioning: false };

    const recent = history.slice(-5);
    const current = recent[recent.length - 1];
    const prev = recent[recent.length - 2];

    // Check ADX trend (falling ADX in TREND = transitioning to RANGE)
    const adxValues = recent.filter(r => r.adx != null).map(r => r.adx);
    let adxTrend = 'stable';
    if (adxValues.length >= 3) {
        const first = adxValues.slice(0, Math.ceil(adxValues.length / 2));
        const second = adxValues.slice(Math.ceil(adxValues.length / 2));
        const avgFirst = first.reduce((s, v) => s + v, 0) / first.length;
        const avgSecond = second.reduce((s, v) => s + v, 0) / second.length;
        if (avgSecond < avgFirst * 0.85) adxTrend = 'falling';
        else if (avgSecond > avgFirst * 1.15) adxTrend = 'rising';
    }

    // Detect transitions
    if (current.regime.startsWith('TREND') && adxTrend === 'falling') {
        return {
            transitioning: true,
            from: current.regime,
            to: 'RANGE',
            confidence: 65,
            warning: 'ADX falling in trend — possible transition to RANGE',
            adxTrend,
        };
    }

    if (current.regime === 'RANGE' && adxTrend === 'rising') {
        return {
            transitioning: true,
            from: 'RANGE',
            to: 'TREND',
            confidence: 60,
            warning: 'ADX rising in range — possible breakout incoming',
            adxTrend,
        };
    }

    if (current.regime === 'SQUEEZE') {
        return {
            transitioning: true,
            from: 'SQUEEZE',
            to: 'BREAKOUT',
            confidence: 70,
            warning: 'Squeeze detected — expansion imminent',
            adxTrend,
        };
    }

    // Check for rapid regime changes (instability)
    const uniqueRegimes = new Set(recent.map(r => r.regime));
    if (uniqueRegimes.size >= 3) {
        return {
            transitioning: true,
            from: current.regime,
            to: 'VOLATILE',
            confidence: 55,
            warning: `${uniqueRegimes.size} different regimes in last ${recent.length} cycles — unstable`,
            adxTrend,
        };
    }

    return { transitioning: false, adxTrend };
}

// ══════════════════════════════════════════════════════════════════
// Correlation Analysis
// ══════════════════════════════════════════════════════════════════
function trackPrice(symbol, price) {
    if (!_priceHistory.has(symbol)) _priceHistory.set(symbol, []);
    const hist = _priceHistory.get(symbol);
    hist.push({ ts: Date.now(), price });
    if (hist.length > PRICE_HISTORY_MAX) hist.shift();
}

function getCorrelation(sym1, sym2) {
    const key = [sym1, sym2].sort().join(':');

    // Try rolling correlation first
    const rolling = _rollingCorr.get(key);
    if (rolling && Date.now() - rolling.ts < 300000) return rolling.corr;

    // Calculate from price history
    const h1 = _priceHistory.get(sym1);
    const h2 = _priceHistory.get(sym2);
    if (h1 && h2 && h1.length >= 20 && h2.length >= 20) {
        const corr = _calcCorrelation(
            h1.slice(-50).map(p => p.price),
            h2.slice(-50).map(p => p.price)
        );
        _rollingCorr.set(key, { corr, ts: Date.now() });
        return corr;
    }

    // Fallback to base
    return BASE_CORRELATIONS[key] || 0.5;
}

/**
 * Analyze correlation risk for open positions.
 * @param {Array} positions - [{symbol, side, size}]
 * @returns {{ totalRisk: number, warning: string, details: [] }}
 */
function analyzeCorrelationRisk(positions) {
    if (!positions || positions.length < 2) return { totalRisk: 0, warning: null, details: [] };

    const details = [];
    let maxCorrelatedExposure = 0;

    for (let i = 0; i < positions.length; i++) {
        for (let j = i + 1; j < positions.length; j++) {
            const p1 = positions[i];
            const p2 = positions[j];
            const corr = getCorrelation(p1.symbol, p2.symbol);
            const sameDir = p1.side === p2.side;

            // Same direction + high correlation = high risk
            if (sameDir && corr > 0.7) {
                const risk = corr * Math.min(p1.size || 1, p2.size || 1);
                maxCorrelatedExposure += risk;
                details.push({
                    pair: `${p1.symbol}/${p2.symbol}`,
                    correlation: Math.round(corr * 100),
                    sameDirection: true,
                    risk: 'high',
                });
            }
            // Opposite direction + high correlation = hedge (good)
            if (!sameDir && corr > 0.7) {
                details.push({
                    pair: `${p1.symbol}/${p2.symbol}`,
                    correlation: Math.round(corr * 100),
                    sameDirection: false,
                    risk: 'hedged',
                });
            }
        }
    }

    const highRiskPairs = details.filter(d => d.risk === 'high');
    let warning = null;
    if (highRiskPairs.length > 0) {
        warning = `${highRiskPairs.length} correlated position pair(s): ${highRiskPairs.map(d => d.pair).join(', ')}. Effective risk is amplified.`;
    }

    return {
        totalRisk: Math.min(100, Math.round(maxCorrelatedExposure * 10)),
        warning,
        details,
    };
}

// ══════════════════════════════════════════════════════════════════
// Volatility Forecast
// ══════════════════════════════════════════════════════════════════
function forecastVolatility(symbol, snap) {
    const signals = [];
    let score = 0; // 0=calm, 100=expect major volatility

    // Funding rate extreme
    if (snap && snap.fr != null) {
        if (Math.abs(snap.fr) > 0.03) {
            signals.push('Extreme funding rate (' + snap.fr.toFixed(4) + ')');
            score += 25;
        } else if (Math.abs(snap.fr) > 0.01) {
            signals.push('Elevated funding rate');
            score += 10;
        }
    }

    // OI spike
    if (snap && snap.oi != null && snap.oiPrev != null) {
        const oiChange = ((snap.oi - snap.oiPrev) / snap.oiPrev) * 100;
        if (Math.abs(oiChange) > 5) {
            signals.push('OI spike (' + oiChange.toFixed(1) + '%)');
            score += 20;
        }
    }

    // Price compression (Bollinger bandwidth)
    if (snap && snap.indicators && snap.indicators.bbWidth != null) {
        if (snap.indicators.bbWidth < 0.02) {
            signals.push('Bollinger squeeze — compression');
            score += 20;
        }
    }

    // ADX rising fast
    if (snap && snap.indicators && snap.indicators.adx > 30) {
        signals.push('High ADX (' + snap.indicators.adx.toFixed(1) + ')');
        score += 15;
    }

    return {
        score: Math.min(100, score),
        level: score >= 50 ? 'high' : score >= 25 ? 'elevated' : 'normal',
        signals,
        recommendation: score >= 50 ? 'Tighten SL or reduce size' : score >= 25 ? 'Monitor closely' : null,
    };
}

// ══════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════
function _calcCorrelation(arr1, arr2) {
    const n = Math.min(arr1.length, arr2.length);
    if (n < 10) return 0.5;
    // Returns from prices
    const r1 = [], r2 = [];
    for (let i = 1; i < n; i++) {
        r1.push((arr1[i] - arr1[i - 1]) / arr1[i - 1]);
        r2.push((arr2[i] - arr2[i - 1]) / arr2[i - 1]);
    }
    const mean1 = r1.reduce((s, v) => s + v, 0) / r1.length;
    const mean2 = r2.reduce((s, v) => s + v, 0) / r2.length;
    let cov = 0, var1 = 0, var2 = 0;
    for (let i = 0; i < r1.length; i++) {
        const d1 = r1[i] - mean1;
        const d2 = r2[i] - mean2;
        cov += d1 * d2;
        var1 += d1 * d1;
        var2 += d2 * d2;
    }
    const denom = Math.sqrt(var1 * var2);
    return denom > 0 ? cov / denom : 0;
}

// ══════════════════════════════════════════════════════════════════
// Public API
// ══════════════════════════════════════════════════════════════════
function getStatus() {
    return {
        regimeTransitions: Object.fromEntries(
            [..._regimeHistory.keys()].map(s => [s, detectRegimeTransition(s)])
        ),
        correlations: Object.fromEntries(_rollingCorr),
        priceHistorySize: Object.fromEntries(
            [..._priceHistory.keys()].map(s => [s, (_priceHistory.get(s) || []).length])
        ),
    };
}

module.exports = {
    trackRegime,
    detectRegimeTransition,
    trackPrice,
    getCorrelation,
    analyzeCorrelationRisk,
    forecastVolatility,
    getStatus,
};
