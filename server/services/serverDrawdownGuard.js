// Zeus Terminal — Progressive Drawdown Guard (Brain V3)
// Instead of all-or-nothing kill switch, progressively reduces risk as drawdown deepens.
// Tracks intraday equity curve and adjusts sizing/entry gates.
// *** Per-user isolated ***
'use strict';

const logger = require('./logger');

// ══════════════════════════════════════════════════════════════════
// Drawdown Tiers (progressive risk reduction)
// ══════════════════════════════════════════════════════════════════
const DRAWDOWN_TIERS = [
    { pctThreshold: 1,  sizeScale: 0.90, confBoost: 0,   label: 'NORMAL',   action: 'slight_reduce' },
    { pctThreshold: 2,  sizeScale: 0.75, confBoost: 5,   label: 'CAUTION',  action: 'reduce_size' },
    { pctThreshold: 3,  sizeScale: 0.55, confBoost: 10,  label: 'WARNING',  action: 'reduce_aggressively' },
    { pctThreshold: 5,  sizeScale: 0.35, confBoost: 15,  label: 'DANGER',   action: 'minimal_size' },
    { pctThreshold: 8,  sizeScale: 0.0,  confBoost: 0,   label: 'LOCKOUT',  action: 'stop_trading' },
];

// Per-user equity tracking
const _equityCurve = new Map(); // userId → [{ ts, equity, pnlEvent }]
const _peakEquity = new Map();  // userId → highest equity today
const MAX_CURVE_POINTS = 500;

// ══════════════════════════════════════════════════════════════════
// Drawdown Assessment
// ══════════════════════════════════════════════════════════════════

/**
 * Get current drawdown tier and scaling factors.
 * @param {number} dailyPnL - today's realized + unrealized PnL
 * @param {number} referenceBalance - starting balance or reference equity
 * @returns {{ tier: object, drawdownPct: number, sizeScale: number, confBoost: number, locked: bool }}
 */
function assessDrawdown(dailyPnL, referenceBalance) {
    if (!referenceBalance || referenceBalance <= 0) {
        return { tier: DRAWDOWN_TIERS[0], drawdownPct: 0, sizeScale: 1.0, confBoost: 0, locked: false };
    }

    const drawdownPct = dailyPnL < 0 ? (Math.abs(dailyPnL) / referenceBalance) * 100 : 0;

    // Find applicable tier (highest threshold that drawdown exceeds)
    let activeTier = null;
    for (let i = DRAWDOWN_TIERS.length - 1; i >= 0; i--) {
        if (drawdownPct >= DRAWDOWN_TIERS[i].pctThreshold) {
            activeTier = DRAWDOWN_TIERS[i];
            break;
        }
    }

    if (!activeTier) {
        return { tier: null, drawdownPct: +drawdownPct.toFixed(2), sizeScale: 1.0, confBoost: 0, locked: false };
    }

    return {
        tier: activeTier,
        drawdownPct: +drawdownPct.toFixed(2),
        sizeScale: activeTier.sizeScale,
        confBoost: activeTier.confBoost, // raise confMin requirement
        locked: activeTier.sizeScale === 0,
    };
}

/**
 * Track equity point for curve visualization.
 */
function trackEquity(userId, equity, pnlEvent) {
    if (!_equityCurve.has(userId)) _equityCurve.set(userId, []);
    const curve = _equityCurve.get(userId);
    curve.push({ ts: Date.now(), equity, pnlEvent: pnlEvent || null });
    if (curve.length > MAX_CURVE_POINTS) curve.splice(0, curve.length - MAX_CURVE_POINTS);

    // Track peak
    const peak = _peakEquity.get(userId);
    if (peak == null || equity > peak) _peakEquity.set(userId, equity);
}

/**
 * Get max drawdown from peak (intraday).
 */
function getMaxDrawdown(userId) {
    const peak = _peakEquity.get(userId);
    const curve = _equityCurve.get(userId);
    if (!peak || !curve || curve.length === 0) return 0;

    const current = curve[curve.length - 1].equity;
    if (current >= peak) return 0;
    return +((peak - current) / peak * 100).toFixed(2);
}

/**
 * Count consecutive losses (tilt detection).
 */
function getConsecutiveLosses(userId) {
    const curve = _equityCurve.get(userId);
    if (!curve) return 0;

    let count = 0;
    for (let i = curve.length - 1; i >= 0; i--) {
        if (curve[i].pnlEvent === 'loss') count++;
        else if (curve[i].pnlEvent === 'win') break;
    }
    return count;
}

/**
 * Get tilt modifier — consecutive losses reduce confidence.
 * @returns {number} 0.7-1.0
 */
function getTiltModifier(userId) {
    const losses = getConsecutiveLosses(userId);
    if (losses >= 5) return 0.70; // 5+ consecutive losses = severe tilt risk
    if (losses >= 4) return 0.80;
    if (losses >= 3) return 0.85;
    if (losses >= 2) return 0.92;
    return 1.0;
}

/**
 * Get drawdown data for UI.
 */
function getDrawdownData(userId, dailyPnL, referenceBalance) {
    const dd = assessDrawdown(dailyPnL, referenceBalance);
    return {
        drawdownPct: dd.drawdownPct,
        maxDrawdown: getMaxDrawdown(userId),
        tier: dd.tier ? dd.tier.label : 'GREEN',
        sizeScale: Math.round(dd.sizeScale * 100),
        confBoost: dd.confBoost,
        locked: dd.locked,
        consecutiveLosses: getConsecutiveLosses(userId),
        tiltModifier: +getTiltModifier(userId).toFixed(2),
        equityCurveLength: (_equityCurve.get(userId) || []).length,
    };
}

/**
 * Reset daily tracking (call on day change).
 */
function resetDaily(userId) {
    _equityCurve.delete(userId);
    _peakEquity.delete(userId);
}

module.exports = {
    assessDrawdown,
    trackEquity,
    getMaxDrawdown,
    getConsecutiveLosses,
    getTiltModifier,
    getDrawdownData,
    resetDaily,
    DRAWDOWN_TIERS,
};
