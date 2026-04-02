// Zeus Terminal — Trade Journal Learning (Brain V2 — Phase 2F)
// Reads closed trades from at_closed, computes insights for adaptive brain.
// Hourly recompute: regime win rates, time-of-day, tier performance, feature importance.
'use strict';

const logger = require('./logger');
const db = require('./database');

// ══════════════════════════════════════════════════════════════════
// Configuration
// ══════════════════════════════════════════════════════════════════
const RECOMPUTE_INTERVAL = 3600000; // hourly
const MIN_TRADES_FOR_INSIGHTS = 10;

// ══════════════════════════════════════════════════════════════════
// Per-user insights cache
// ══════════════════════════════════════════════════════════════════
const _insights = new Map(); // userId → { regimeWinRate, tierPerf, hourPerf, dirPerf, ts }
let _timer = null;

// ══════════════════════════════════════════════════════════════════
// Start / Stop
// ══════════════════════════════════════════════════════════════════
function start() {
    if (_timer) return;
    _timer = setInterval(_recomputeAll, RECOMPUTE_INTERVAL);
    // First compute after 30s
    setTimeout(_recomputeAll, 30000);
    logger.info('JOURNAL', 'Trade journal learning started (hourly recompute)');
}

function stop() {
    if (_timer) { clearInterval(_timer); _timer = null; }
}

// ══════════════════════════════════════════════════════════════════
// Load trades from DB
// ══════════════════════════════════════════════════════════════════
function _loadTrades(userId, limit) {
    try {
        const rows = db.journalGetClosed(userId, limit || 500, 0);
        const trades = [];
        for (const row of rows) {
            try {
                const t = JSON.parse(row.data);
                t._closedAt = row.closed_at;
                trades.push(t);
            } catch (_) {}
        }
        return trades;
    } catch (err) {
        logger.error('JOURNAL', `Failed to load trades uid=${userId}: ${err.message}`);
        return [];
    }
}

// ══════════════════════════════════════════════════════════════════
// Compute insights
// ══════════════════════════════════════════════════════════════════
function _recomputeAll() {
    // Get all users with trades
    try {
        const userRows = db.db.prepare('SELECT DISTINCT user_id FROM at_closed WHERE user_id IS NOT NULL').all();
        for (const row of userRows) {
            _computeInsights(row.user_id);
        }
    } catch (err) {
        logger.error('JOURNAL', `Recompute failed: ${err.message}`);
    }
}

function _computeInsights(userId) {
    const trades = _loadTrades(userId, 500);
    // Filter to real trades (not entry failures)
    const real = trades.filter(t => t.closePnl != null && t.closeReason && !t.closeReason.startsWith('ENTRY_FAILED'));

    if (real.length < MIN_TRADES_FOR_INSIGHTS) {
        _insights.set(userId, { insufficient: true, tradeCount: real.length, ts: Date.now() });
        return;
    }

    const totalWins = real.filter(t => t.closePnl > 0).length;
    const totalLosses = real.filter(t => t.closePnl <= 0).length;
    const overallWinRate = totalWins / real.length;

    // ── Regime win rates ──
    const regimeWinRate = {};
    const byRegime = _groupBy(real, t => t.regime || 'UNKNOWN');
    for (const [regime, rTrades] of Object.entries(byRegime)) {
        const wins = rTrades.filter(t => t.closePnl > 0).length;
        regimeWinRate[regime] = {
            winRate: rTrades.length >= 3 ? wins / rTrades.length : null,
            count: rTrades.length,
            avgPnl: _avg(rTrades.map(t => t.closePnl)),
        };
    }

    // ── Tier performance ──
    const tierPerf = {};
    const byTier = _groupBy(real, t => t.tier || 'UNKNOWN');
    for (const [tier, tTrades] of Object.entries(byTier)) {
        const wins = tTrades.filter(t => t.closePnl > 0).length;
        tierPerf[tier] = {
            winRate: tTrades.length >= 3 ? wins / tTrades.length : null,
            count: tTrades.length,
            avgPnl: _avg(tTrades.map(t => t.closePnl)),
        };
    }

    // ── Direction performance ──
    const dirPerf = {};
    const byDir = _groupBy(real, t => t.side || 'UNKNOWN');
    for (const [dir, dTrades] of Object.entries(byDir)) {
        const wins = dTrades.filter(t => t.closePnl > 0).length;
        dirPerf[dir] = {
            winRate: dTrades.length >= 3 ? wins / dTrades.length : null,
            count: dTrades.length,
            avgPnl: _avg(dTrades.map(t => t.closePnl)),
        };
    }

    // ── Time of day performance (UTC hour buckets) ──
    const hourPerf = {};
    for (const t of real) {
        const ts = t.openTs || t.ts;
        if (!ts) continue;
        const hour = new Date(ts).getUTCHours();
        const bucket = Math.floor(hour / 4) * 4; // 4-hour buckets: 0,4,8,12,16,20
        if (!hourPerf[bucket]) hourPerf[bucket] = { wins: 0, losses: 0, total: 0, pnl: 0 };
        hourPerf[bucket].total++;
        hourPerf[bucket].pnl += t.closePnl || 0;
        if (t.closePnl > 0) hourPerf[bucket].wins++;
        else hourPerf[bucket].losses++;
    }
    for (const bucket of Object.keys(hourPerf)) {
        const h = hourPerf[bucket];
        h.winRate = h.total >= 3 ? h.wins / h.total : null;
    }

    // ── Symbol performance ──
    const symbolPerf = {};
    const bySym = _groupBy(real, t => t.symbol || 'UNKNOWN');
    for (const [sym, sTrades] of Object.entries(bySym)) {
        const wins = sTrades.filter(t => t.closePnl > 0).length;
        symbolPerf[sym] = {
            winRate: sTrades.length >= 3 ? wins / sTrades.length : null,
            count: sTrades.length,
            avgPnl: _avg(sTrades.map(t => t.closePnl)),
        };
    }

    // ── Average hold duration ──
    const holdDurations = real.filter(t => t.closeTs && t.openTs)
        .map(t => (t.closeTs - t.openTs) / 60000); // minutes
    const avgHoldMin = holdDurations.length > 0 ? _avg(holdDurations) : null;

    const insights = {
        insufficient: false,
        tradeCount: real.length,
        overallWinRate,
        regimeWinRate,
        tierPerf,
        dirPerf,
        hourPerf,
        symbolPerf,
        avgHoldMin,
        ts: Date.now(),
    };

    _insights.set(userId, insights);
    logger.info('JOURNAL', `Insights computed uid=${userId}: ${real.length} trades, WR=${(overallWinRate * 100).toFixed(1)}%`);
}

// ══════════════════════════════════════════════════════════════════
// Public API
// ══════════════════════════════════════════════════════════════════

/**
 * Get computed insights for a user.
 */
function getInsights(userId) {
    return _insights.get(userId) || { insufficient: true, tradeCount: 0, ts: 0 };
}

/**
 * Get adaptive weight modifier based on journal insights.
 * If user performs poorly in current regime/direction → reduce confidence.
 * @param {number} userId
 * @param {string} regime - current regime
 * @param {string} dir - 'LONG' or 'SHORT'
 * @param {string} symbol
 * @returns {number} modifier 0.8 - 1.15
 */
function getAdaptiveModifier(userId, regime, dir, symbol) {
    const ins = _insights.get(userId);
    if (!ins || ins.insufficient) return 1.0; // no data → neutral

    let mod = 1.0;

    // Regime performance modifier
    const rPerf = ins.regimeWinRate[regime];
    if (rPerf && rPerf.winRate !== null && rPerf.count >= 5) {
        if (rPerf.winRate < 0.35) mod *= 0.85;       // losing regime → penalty
        else if (rPerf.winRate > 0.60) mod *= 1.08;   // winning regime → boost
    }

    // Direction performance
    const dPerf = ins.dirPerf[dir];
    if (dPerf && dPerf.winRate !== null && dPerf.count >= 5) {
        if (dPerf.winRate < 0.35) mod *= 0.90;
        else if (dPerf.winRate > 0.60) mod *= 1.05;
    }

    // Symbol performance
    const sPerf = ins.symbolPerf[symbol];
    if (sPerf && sPerf.winRate !== null && sPerf.count >= 5) {
        if (sPerf.winRate < 0.30) mod *= 0.88;
        else if (sPerf.winRate > 0.60) mod *= 1.05;
    }

    return Math.max(0.8, Math.min(1.15, mod));
}

// ══════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════
function _groupBy(arr, fn) {
    const groups = {};
    for (const item of arr) {
        const key = fn(item);
        if (!groups[key]) groups[key] = [];
        groups[key].push(item);
    }
    return groups;
}

function _avg(arr) {
    if (arr.length === 0) return 0;
    return arr.reduce((s, v) => s + (v || 0), 0) / arr.length;
}

module.exports = {
    start,
    stop,
    getInsights,
    getAdaptiveModifier,
};
