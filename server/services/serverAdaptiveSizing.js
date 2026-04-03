// Zeus Terminal — Adaptive Position Sizing (Brain V3)
// Kelly-inspired sizing: adjusts position size based on edge, confidence, and drawdown.
// Replaces fixed TIER_MULT with dynamic sizing from trade history.
// *** Per-user isolated ***
'use strict';

const logger = require('./logger');
const db = require('./database');

// ══════════════════════════════════════════════════════════════════
// Configuration
// ══════════════════════════════════════════════════════════════════
const MIN_TRADES_FOR_KELLY = 20;    // need 20+ trades before using Kelly
const KELLY_FRACTION = 0.25;        // use 25% Kelly (conservative = Quarter Kelly)
const SIZE_FLOOR = 0.4;             // minimum 40% of base size
const SIZE_CEIL = 2.0;              // maximum 200% of base size
const RECOMPUTE_INTERVAL = 3600000; // recompute hourly

// ══════════════════════════════════════════════════════════════════
// Per-user edge statistics
// ══════════════════════════════════════════════════════════════════
const _edgeStats = new Map(); // userId → { winRate, avgWin, avgLoss, kelly, ts }

/**
 * Compute edge statistics from closed trades.
 */
function _computeEdge(userId) {
    if (!userId) return null;
    const cached = _edgeStats.get(userId);
    if (cached && Date.now() - cached.ts < RECOMPUTE_INTERVAL) return cached;

    try {
        const rows = db.journalGetClosed(userId, 200, 0);
        const trades = [];
        for (const r of rows) {
            try { trades.push(JSON.parse(r.data)); } catch (_) {}
        }

        if (trades.length < MIN_TRADES_FOR_KELLY) {
            const fallback = { winRate: 0.5, avgWin: 1, avgLoss: 1, kelly: 0, sampleSize: trades.length, ts: Date.now(), sufficient: false };
            _edgeStats.set(userId, fallback);
            return fallback;
        }

        const wins = trades.filter(t => t.closePnl > 0);
        const losses = trades.filter(t => t.closePnl <= 0);
        const winRate = wins.length / trades.length;
        const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.closePnl, 0) / wins.length : 0;
        const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.closePnl, 0) / losses.length) : 1;

        // Kelly Criterion: f* = (p * b - q) / b
        // where p = win rate, q = 1 - p, b = avg_win / avg_loss
        const b = avgLoss > 0 ? avgWin / avgLoss : 1;
        const q = 1 - winRate;
        const kelly = b > 0 ? Math.max(0, (winRate * b - q) / b) : 0;

        // Per-regime edge
        const regimeEdge = {};
        const byRegime = {};
        for (const t of trades) {
            const r = t.regime || 'UNKNOWN';
            if (!byRegime[r]) byRegime[r] = [];
            byRegime[r].push(t);
        }
        for (const [regime, rTrades] of Object.entries(byRegime)) {
            if (rTrades.length < 5) continue;
            const rWins = rTrades.filter(t => t.closePnl > 0);
            const rLosses = rTrades.filter(t => t.closePnl <= 0);
            const rWR = rWins.length / rTrades.length;
            const rAvgWin = rWins.length > 0 ? rWins.reduce((s, t) => s + t.closePnl, 0) / rWins.length : 0;
            const rAvgLoss = rLosses.length > 0 ? Math.abs(rLosses.reduce((s, t) => s + t.closePnl, 0) / rLosses.length) : 1;
            const rB = rAvgLoss > 0 ? rAvgWin / rAvgLoss : 1;
            regimeEdge[regime] = {
                winRate: rWR,
                avgWin: +rAvgWin.toFixed(2),
                avgLoss: +rAvgLoss.toFixed(2),
                kelly: rB > 0 ? Math.max(0, (rWR * rB - (1 - rWR)) / rB) : 0,
                sampleSize: rTrades.length,
            };
        }

        const stats = {
            winRate, avgWin: +avgWin.toFixed(2), avgLoss: +avgLoss.toFixed(2),
            kelly, sampleSize: trades.length, regimeEdge,
            ts: Date.now(), sufficient: true,
        };
        _edgeStats.set(userId, stats);
        return stats;
    } catch (err) {
        logger.error('SIZING', `Edge compute failed uid=${userId}: ${err.message}`);
        return null;
    }
}

/**
 * Calculate adaptive size multiplier.
 * @param {string} userId
 * @param {string} tier - 'SMALL' | 'MEDIUM' | 'LARGE'
 * @param {number} confidence - 0-100 brain confidence
 * @param {string} regime - current market regime
 * @param {number} dailyPnL - today's PnL
 * @param {number} baseSize - user's configured base size
 * @returns {{ multiplier: number, reason: string, kelly: number, edge: object }}
 */
function calcSizeMultiplier(userId, tier, confidence, regime, dailyPnL, baseSize) {
    const TIER_BASE = { LARGE: 1.75, MEDIUM: 1.35, SMALL: 1.0 };
    const tierMult = TIER_BASE[tier] || 1.0;

    const edge = _computeEdge(userId);
    if (!edge || !edge.sufficient) {
        // Not enough data — use standard tier multiplier
        return { multiplier: tierMult, reason: 'insufficient_history', kelly: 0, edge: null };
    }

    // ── Kelly-based sizing ──
    // Use regime-specific edge if available, otherwise overall
    const regimeStats = edge.regimeEdge[regime];
    const kelly = regimeStats ? regimeStats.kelly : edge.kelly;
    const effKelly = kelly * KELLY_FRACTION; // Quarter Kelly for safety

    // Confidence scaling: higher confidence → closer to Kelly optimal
    const confScale = Math.max(0.5, confidence / 100);

    // Drawdown scaling: reduce size as daily PnL goes negative
    let drawdownScale = 1.0;
    if (dailyPnL < 0 && baseSize > 0) {
        const drawdownPct = Math.abs(dailyPnL) / baseSize * 100;
        if (drawdownPct >= 8) drawdownScale = 0.3;       // severe drawdown
        else if (drawdownPct >= 5) drawdownScale = 0.5;   // significant drawdown
        else if (drawdownPct >= 3) drawdownScale = 0.7;   // moderate drawdown
        else if (drawdownPct >= 1) drawdownScale = 0.85;  // light drawdown
    }

    // Combined multiplier
    let multiplier = tierMult * (1 + effKelly) * confScale * drawdownScale;

    // Clamp
    multiplier = Math.max(SIZE_FLOOR, Math.min(SIZE_CEIL, multiplier));

    const reason = drawdownScale < 1 ? `kelly+drawdown_scale(${drawdownScale})` :
                   effKelly > 0.05 ? `kelly_edge(${(effKelly * 100).toFixed(1)}%)` : 'standard';

    return {
        multiplier: +multiplier.toFixed(3),
        reason,
        kelly: +kelly.toFixed(4),
        drawdownScale,
        confScale: +confScale.toFixed(2),
        edge: {
            winRate: Math.round(edge.winRate * 100),
            avgWin: edge.avgWin,
            avgLoss: edge.avgLoss,
            sampleSize: edge.sampleSize,
        },
    };
}

/**
 * Get edge stats for UI display.
 */
function getEdgeStats(userId) {
    const edge = _computeEdge(userId);
    if (!edge) return null;
    return {
        sufficient: edge.sufficient,
        winRate: Math.round(edge.winRate * 100),
        avgWin: edge.avgWin,
        avgLoss: edge.avgLoss,
        kelly: +(edge.kelly * 100).toFixed(1),
        quarterKelly: +(edge.kelly * KELLY_FRACTION * 100).toFixed(1),
        sampleSize: edge.sampleSize,
        regimeEdge: edge.regimeEdge ? Object.fromEntries(
            Object.entries(edge.regimeEdge).map(([r, s]) => [r, {
                winRate: Math.round(s.winRate * 100),
                kelly: +(s.kelly * 100).toFixed(1),
                samples: s.sampleSize,
            }])
        ) : {},
    };
}

module.exports = {
    calcSizeMultiplier,
    getEdgeStats,
    MIN_TRADES_FOR_KELLY,
};
