// Zeus Terminal — Volatility-Forecast Entry Engine (Brain V3)
// Proactively adjusts SL/TP based on volatility forecast, not just fixed %.
// Uses ATR percentile, Bollinger bandwidth, and OI/funding signals.
// Integrates with serverCalibration forecast data.
'use strict';

const logger = require('./logger');
const serverCalibration = require('./serverCalibration');

// ══════════════════════════════════════════════════════════════════
// Configuration
// ══════════════════════════════════════════════════════════════════
const ATR_LOOKBACK = 50;            // bars for ATR percentile
const BB_SQUEEZE_THRESHOLD = 0.015; // Bollinger bandwidth < 1.5% = squeeze

// ══════════════════════════════════════════════════════════════════
// Volatility Assessment
// ══════════════════════════════════════════════════════════════════

/**
 * Compute comprehensive volatility profile for a symbol.
 * @param {object} snap - serverState snapshot
 * @param {Array} bars - kline bars
 * @returns {{ level, score, atrPct, slMultiplier, tpMultiplier, recommendation }}
 */
function assessVolatility(snap, bars) {
    if (!snap || !bars || bars.length < 30) {
        return _defaultProfile();
    }

    let score = 0;
    const signals = [];

    // ── 1. ATR Percentile ──
    const atrPctRank = _calcATRPercentile(bars);
    if (atrPctRank >= 85) {
        score += 30;
        signals.push(`ATR P${atrPctRank} (very high)`);
    } else if (atrPctRank >= 70) {
        score += 15;
        signals.push(`ATR P${atrPctRank} (elevated)`);
    } else if (atrPctRank <= 15) {
        score -= 10; // low vol = compression possible
        signals.push(`ATR P${atrPctRank} (compressed)`);
    }

    // ── 2. Bollinger Bandwidth ──
    const bbWidth = snap.indicators ? snap.indicators.bbWidth : null;
    if (bbWidth != null) {
        if (bbWidth < BB_SQUEEZE_THRESHOLD) {
            score += 20; // squeeze = expect expansion
            signals.push(`BB squeeze (${(bbWidth * 100).toFixed(2)}%)`);
        } else if (bbWidth > 0.06) {
            score += 15;
            signals.push(`BB expanded (${(bbWidth * 100).toFixed(2)}%)`);
        }
    }

    // ── 3. Calibration forecast ──
    const forecast = serverCalibration.forecastVolatility(snap.symbol, snap);
    score += forecast.score * 0.5; // blend with our own assessment

    // ── 4. Recent bar range expansion ──
    const recentBars = bars.slice(-10);
    const avgRange = recentBars.reduce((s, b) => s + (b.high - b.low) / b.close * 100, 0) / recentBars.length;
    const olderBars = bars.slice(-30, -10);
    if (olderBars.length > 0) {
        const olderAvgRange = olderBars.reduce((s, b) => s + (b.high - b.low) / b.close * 100, 0) / olderBars.length;
        if (avgRange > olderAvgRange * 1.5) {
            score += 15;
            signals.push('Range expanding');
        } else if (avgRange < olderAvgRange * 0.5) {
            score += 10; // contraction → expect expansion
            signals.push('Range contracting');
        }
    }

    score = Math.max(0, Math.min(100, Math.round(score)));

    // ── Determine level & multipliers ──
    let level, slMult, tpMult;
    if (score >= 70) {
        level = 'EXTREME';
        slMult = 1.6;  // wider SL in high vol
        tpMult = 1.8;  // but also wider TP
    } else if (score >= 50) {
        level = 'HIGH';
        slMult = 1.35;
        tpMult = 1.5;
    } else if (score >= 30) {
        level = 'ELEVATED';
        slMult = 1.15;
        tpMult = 1.2;
    } else if (score >= 15) {
        level = 'NORMAL';
        slMult = 1.0;
        tpMult = 1.0;
    } else {
        level = 'LOW';
        slMult = 0.85; // tighter SL in low vol
        tpMult = 0.9;
    }

    return {
        level,
        score,
        atrPercentile: atrPctRank,
        slMultiplier: slMult,
        tpMultiplier: tpMult,
        signals,
        recommendation: _getRecommendation(level, score),
    };
}

/**
 * Adjust STC params based on volatility profile.
 * @param {object} stc - adapted STC (already regime-adjusted)
 * @param {object} volProfile - from assessVolatility()
 * @returns {object} modified STC copy
 */
function adjustParams(stc, volProfile) {
    if (!stc || !volProfile) return stc;

    const adjusted = { ...stc };

    // Adjust SL based on volatility
    adjusted.slPct = +(stc.slPct * volProfile.slMultiplier).toFixed(3);

    // Adjust RR — in high vol, demand higher RR
    if (volProfile.score >= 50) {
        adjusted.rr = Math.max(stc.rr, stc.rr * volProfile.tpMultiplier * 0.8);
    }

    // In extreme vol, reduce position size
    if (volProfile.level === 'EXTREME') {
        adjusted.size = Math.round(stc.size * 0.7);
    } else if (volProfile.level === 'HIGH') {
        adjusted.size = Math.round(stc.size * 0.85);
    }

    return adjusted;
}

/**
 * Get confidence modifier based on volatility.
 * Extreme vol = slightly penalize (harder to predict).
 * @returns {number} 0.85 - 1.05
 */
function getVolatilityModifier(volProfile) {
    if (!volProfile) return 1.0;
    if (volProfile.level === 'EXTREME') return 0.85;
    if (volProfile.level === 'HIGH') return 0.92;
    if (volProfile.level === 'LOW') return 0.95; // low vol = less movement = less opportunity
    return 1.0;
}

// ══════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════
function _calcATRPercentile(bars) {
    if (bars.length < ATR_LOOKBACK) return 50;

    const atrs = [];
    for (let i = 1; i < bars.length; i++) {
        const tr = Math.max(
            bars[i].high - bars[i].low,
            Math.abs(bars[i].high - bars[i - 1].close),
            Math.abs(bars[i].low - bars[i - 1].close)
        );
        atrs.push(tr);
    }

    // Current ATR (14-period)
    const recent14 = atrs.slice(-14);
    const currentATR = recent14.reduce((s, v) => s + v, 0) / recent14.length;

    // Historical ATR values (14-period rolling)
    const historicalATRs = [];
    for (let i = 14; i < atrs.length; i++) {
        const window = atrs.slice(i - 14, i);
        historicalATRs.push(window.reduce((s, v) => s + v, 0) / window.length);
    }

    if (historicalATRs.length === 0) return 50;

    // Percentile rank
    const below = historicalATRs.filter(a => a <= currentATR).length;
    return Math.round((below / historicalATRs.length) * 100);
}

function _defaultProfile() {
    return { level: 'NORMAL', score: 25, atrPercentile: 50, slMultiplier: 1.0, tpMultiplier: 1.0, signals: [], recommendation: null };
}

function _getRecommendation(level, score) {
    if (level === 'EXTREME') return 'Reduce size, widen SL, demand higher RR';
    if (level === 'HIGH') return 'Widen SL slightly, use ATR-based DSL';
    if (level === 'LOW') return 'Tighten SL, lower RR target acceptable';
    return null;
}

module.exports = {
    assessVolatility,
    adjustParams,
    getVolatilityModifier,
};
