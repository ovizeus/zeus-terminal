// Zeus Terminal — Smart Exit Manager
// Analyzes open positions and recommends exit timing based on
// MFE/MAE statistics, regime behavior, and market structure.
// Does NOT execute exits — provides recommendations to DSL/Brain.
// *** Per-user isolated: regimeStats keyed by userId ***
'use strict';

const logger = require('./logger');
const db = require('./database');

// ══════════════════════════════════════════════════════════════════
// Per-user MFE/MAE statistics (computed from historical trades)
// ══════════════════════════════════════════════════════════════════
const _regimeStats = new Map(); // userId → { regime → { avgMFE, avgMAE, ... } }
const _statsTs = new Map();     // userId → lastComputeTs

function _computeRegimeStats(userId) {
    if (!userId) return;
    const lastTs = _statsTs.get(userId) || 0;
    if (Date.now() - lastTs < 3600000) return; // recompute hourly
    try {
        const rows = db.journalGetClosed(userId, 500, 0);
        const allTrades = [];
        for (const r of rows) {
            try { allTrades.push(JSON.parse(r.data)); } catch (_) {}
        }

        const byRegime = {};
        for (const t of allTrades) {
            const r = t.regime || 'UNKNOWN';
            if (!byRegime[r]) byRegime[r] = [];
            byRegime[r].push(t);
        }

        const stats = {};
        for (const [regime, trades] of Object.entries(byRegime)) {
            if (trades.length < 5) continue;
            const mfes = trades.filter(t => t.mfe != null).map(t => t.mfe).sort((a, b) => a - b);
            const maes = trades.filter(t => t.mae != null).map(t => Math.abs(t.mae)).sort((a, b) => a - b);
            const holds = trades.filter(t => t.closeTs && t.openTs).map(t => (t.closeTs - t.openTs) / 60000).sort((a, b) => a - b);

            stats[regime] = {
                avgMFE: mfes.length > 0 ? mfes.reduce((s, v) => s + v, 0) / mfes.length : 0,
                medianMFE: mfes.length > 0 ? mfes[Math.floor(mfes.length / 2)] : 0,
                p75MFE: mfes.length > 3 ? mfes[Math.floor(mfes.length * 0.75)] : 0,
                avgMAE: maes.length > 0 ? maes.reduce((s, v) => s + v, 0) / maes.length : 0,
                medianHoldMin: holds.length > 0 ? holds[Math.floor(holds.length / 2)] : 0,
                avgHoldMin: holds.length > 0 ? holds.reduce((s, v) => s + v, 0) / holds.length : 0,
                sampleSize: trades.length,
                winRate: trades.filter(t => t.closePnl > 0).length / trades.length,
            };
        }
        _regimeStats.set(userId, stats);
        _statsTs.set(userId, Date.now());
    } catch (err) {
        logger.error('EXIT_MGR', `Stats compute failed uid=${userId}: ${err.message}`);
    }
}

// ══════════════════════════════════════════════════════════════════
// Smart Exit Analysis for a single position
// ══════════════════════════════════════════════════════════════════
function analyzePosition(pos, marketCtx, userId) {
    _computeRegimeStats(userId);

    const now = Date.now();
    const holdMin = pos.openTs ? (now - pos.openTs) / 60000 : 0;
    const regime = pos.regime || (marketCtx && marketCtx.regime) || 'UNKNOWN';
    const userStats = _regimeStats.get(userId) || {};
    const stats = userStats[regime] || {};
    const pnlPct = pos.pnlPct || 0;
    const mfe = pos.mfe || Math.max(0, pnlPct);

    const result = {
        action: 'hold',
        urgency: 'low',
        reason: '',
        details: {
            holdMin: Math.round(holdMin),
            pnlPct: +pnlPct.toFixed(3),
            mfe: +mfe.toFixed(3),
            regimeAvgMFE: stats.avgMFE ? +stats.avgMFE.toFixed(3) : null,
            regimeMedianHold: stats.medianHoldMin ? Math.round(stats.medianHoldMin) : null,
        },
    };

    // ── 1. MFE approaching historical limit ──
    if (stats.p75MFE && mfe > 0 && mfe >= stats.p75MFE * 0.85) {
        result.action = 'trail_tight';
        result.urgency = 'medium';
        result.reason = `MFE (${mfe.toFixed(2)}%) near 75th percentile for ${regime} (${stats.p75MFE.toFixed(2)}%). Trail tight.`;
    }

    if (stats.avgMFE && mfe >= stats.avgMFE * 1.3) {
        result.action = 'take_profit';
        result.urgency = 'high';
        result.reason = `MFE (${mfe.toFixed(2)}%) exceeds avg for ${regime} (${stats.avgMFE.toFixed(2)}%) by 30%+. Consider taking profit.`;
    }

    // ── 2. Profit giving back ──
    if (mfe > 0 && pnlPct > 0 && pnlPct < mfe * 0.5 && mfe > 0.5) {
        result.action = 'trail_tight';
        result.urgency = 'high';
        result.reason = `Gave back ${Math.round((1 - pnlPct / mfe) * 100)}% of max profit. MFE=${mfe.toFixed(2)}%, now=${pnlPct.toFixed(2)}%`;
    }

    // ── 3. Hold duration exceeding typical ──
    if (stats.medianHoldMin && holdMin > stats.medianHoldMin * 2 && pnlPct < 0.3) {
        result.action = 'exit_now';
        result.urgency = 'medium';
        result.reason = `Held ${Math.round(holdMin)}min (2x median ${Math.round(stats.medianHoldMin)}min for ${regime}) with minimal profit. Dead trade.`;
    }

    // ── 4. Structure change against position ──
    if (marketCtx && marketCtx.structure) {
        const struct = marketCtx.structure;
        if (struct.lastCHoCH) {
            const chochAgainst = (pos.side === 'LONG' && struct.lastCHoCH.dir === 'bearish') ||
                                 (pos.side === 'SHORT' && struct.lastCHoCH.dir === 'bullish');
            if (chochAgainst && pnlPct > 0) {
                result.action = 'trail_aggressive';
                result.urgency = 'high';
                result.reason = `CHoCH ${struct.lastCHoCH.dir} detected against ${pos.side} position. Protect profits.`;
            }
            if (chochAgainst && pnlPct <= 0) {
                result.action = 'exit_now';
                result.urgency = 'critical';
                result.reason = `CHoCH ${struct.lastCHoCH.dir} against ${pos.side} while in loss. Structure invalidated.`;
            }
        }
    }

    // ── 5. Regime transition ──
    if (marketCtx && marketCtx.regimeTransition && marketCtx.regimeTransition.transitioning) {
        const rt = marketCtx.regimeTransition;
        if (rt.to === 'VOLATILE' || rt.to === 'CHAOS') {
            if (result.urgency !== 'critical') {
                result.action = pnlPct > 0 ? 'trail_tight' : 'exit_now';
                result.urgency = 'high';
                result.reason = `Regime transitioning to ${rt.to}. ${pnlPct > 0 ? 'Protect profits.' : 'Cut losses.'}`;
            }
        }
    }

    // ── 6. Liquidity zone approach ──
    if (marketCtx && marketCtx.liquidity) {
        const liq = marketCtx.liquidity;
        if (pos.side === 'LONG' && liq.nearestAbove && pos.currentPrice) {
            const distToLiq = ((liq.nearestAbove.price - pos.currentPrice) / pos.currentPrice) * 100;
            if (distToLiq < 0.3 && distToLiq > 0 && pnlPct > 0) {
                result.action = 'take_profit';
                result.urgency = 'high';
                result.reason = `Price approaching liquidity zone above (${distToLiq.toFixed(2)}% away). Expect resistance/reversal.`;
            }
        }
        if (pos.side === 'SHORT' && liq.nearestBelow && pos.currentPrice) {
            const distToLiq = ((pos.currentPrice - liq.nearestBelow.price) / pos.currentPrice) * 100;
            if (distToLiq < 0.3 && distToLiq > 0 && pnlPct > 0) {
                result.action = 'take_profit';
                result.urgency = 'high';
                result.reason = `Price approaching liquidity zone below (${distToLiq.toFixed(2)}% away). Expect support/reversal.`;
            }
        }
    }

    return result;
}

// ══════════════════════════════════════════════════════════════════
// Batch analysis for all open positions
// ══════════════════════════════════════════════════════════════════
function analyzeAllPositions(positions, getMarketContext, userId) {
    const results = [];
    for (const pos of positions) {
        const ctx = typeof getMarketContext === 'function' ? getMarketContext(pos.symbol) : {};
        const analysis = analyzePosition(pos, ctx, userId);
        results.push({ symbol: pos.symbol, side: pos.side, ...analysis });
    }
    return results;
}

// ══════════════════════════════════════════════════════════════════
// Get regime statistics (for UI) — per user
// ══════════════════════════════════════════════════════════════════
function getRegimeStats(userId) {
    _computeRegimeStats(userId);
    return Object.assign({}, _regimeStats.get(userId) || {});
}

module.exports = {
    analyzePosition,
    analyzeAllPositions,
    getRegimeStats,
};
