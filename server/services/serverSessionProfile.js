// Zeus Terminal — Session Profiling (Brain V3)
// Identifies trading sessions (Asia, London, NY) and adjusts brain behavior
// based on historical performance per session.
// *** Per-user isolated ***
'use strict';

const logger = require('./logger');
const db = require('./database');

// ══════════════════════════════════════════════════════════════════
// Session Definitions (UTC hours)
// ══════════════════════════════════════════════════════════════════
const SESSIONS = {
    ASIA:     { start: 0,  end: 8,  name: 'Asia',    volatility: 'low' },
    LONDON:   { start: 7,  end: 16, name: 'London',  volatility: 'high' },
    NY:       { start: 13, end: 22, name: 'New York', volatility: 'high' },
    LATE_NY:  { start: 20, end: 24, name: 'Late NY',  volatility: 'medium' },
};

// Overlap zones — highest volume periods
const OVERLAPS = {
    LONDON_NY: { start: 13, end: 16, name: 'London/NY Overlap', volatility: 'very_high' },
};

const RECOMPUTE_INTERVAL = 3600000; // 1h
const _sessionStats = new Map(); // userId → { session → { winRate, avgPnl, trades, ... }, ts }

// ══════════════════════════════════════════════════════════════════
// Current Session Detection
// ══════════════════════════════════════════════════════════════════
function getCurrentSession() {
    const hour = new Date().getUTCHours();

    // Check overlaps first
    for (const [key, sess] of Object.entries(OVERLAPS)) {
        if (hour >= sess.start && hour < sess.end) {
            return { id: key, ...sess, overlap: true };
        }
    }

    // Then primary sessions
    for (const [key, sess] of Object.entries(SESSIONS)) {
        if (hour >= sess.start && hour < sess.end) {
            return { id: key, ...sess, overlap: false };
        }
    }

    return { id: 'OFF_HOURS', name: 'Off Hours', volatility: 'low', overlap: false, start: 0, end: 0 };
}

/**
 * Get session for a given UTC hour.
 */
function getSessionForHour(hour) {
    for (const [key, sess] of Object.entries(OVERLAPS)) {
        if (hour >= sess.start && hour < sess.end) return key;
    }
    for (const [key, sess] of Object.entries(SESSIONS)) {
        if (hour >= sess.start && hour < sess.end) return key;
    }
    return 'OFF_HOURS';
}

// ══════════════════════════════════════════════════════════════════
// Session Performance Stats
// ══════════════════════════════════════════════════════════════════
function _computeSessionStats(userId) {
    if (!userId) return;
    const cached = _sessionStats.get(userId);
    if (cached && Date.now() - cached.ts < RECOMPUTE_INTERVAL) return;

    try {
        const rows = db.journalGetClosed(userId, 500, 0);
        const trades = [];
        for (const r of rows) {
            try { trades.push(JSON.parse(r.data)); } catch (_) {}
        }

        const bySession = {};
        for (const t of trades) {
            const openHour = t.openTs ? new Date(t.openTs).getUTCHours() : null;
            if (openHour == null) continue;
            const sess = getSessionForHour(openHour);
            if (!bySession[sess]) bySession[sess] = [];
            bySession[sess].push(t);
        }

        const stats = {};
        for (const [sess, sTrades] of Object.entries(bySession)) {
            const wins = sTrades.filter(t => t.closePnl > 0);
            const losses = sTrades.filter(t => t.closePnl <= 0);
            const totalPnl = sTrades.reduce((s, t) => s + (t.closePnl || 0), 0);
            stats[sess] = {
                trades: sTrades.length,
                winRate: sTrades.length > 0 ? wins.length / sTrades.length : 0,
                avgPnl: sTrades.length > 0 ? totalPnl / sTrades.length : 0,
                totalPnl,
                wins: wins.length,
                losses: losses.length,
                bestTrade: sTrades.reduce((best, t) => (t.closePnl || 0) > (best || 0) ? t.closePnl : best, 0),
                worstTrade: sTrades.reduce((worst, t) => (t.closePnl || 0) < (worst || 0) ? t.closePnl : worst, 0),
            };
        }

        _sessionStats.set(userId, { ...stats, ts: Date.now() });
    } catch (err) {
        logger.error('SESSION', `Stats compute failed uid=${userId}: ${err.message}`);
    }
}

/**
 * Get session-based confidence modifier for brain fusion.
 * Boosts confidence in sessions where user historically performs well,
 * penalizes sessions with poor track record.
 * @returns {number} 0.80 - 1.15 multiplier
 */
function getSessionModifier(userId) {
    _computeSessionStats(userId);
    const stats = _sessionStats.get(userId);
    const session = getCurrentSession();

    if (!stats || !stats[session.id]) {
        // No history for this session — use volatility-based default
        if (session.volatility === 'very_high') return 1.05; // overlap = good liquidity
        if (session.volatility === 'low') return 0.92;       // Asia = less movement
        return 1.0;
    }

    const sessStats = stats[session.id];
    if (sessStats.trades < 5) return 1.0; // insufficient data

    // Performance-based modifier
    if (sessStats.winRate >= 0.65 && sessStats.avgPnl > 0) return 1.10;    // strong session
    if (sessStats.winRate >= 0.55) return 1.05;                              // decent session
    if (sessStats.winRate < 0.35 && sessStats.trades >= 10) return 0.80;    // bad session — reduce
    if (sessStats.winRate < 0.45) return 0.90;                               // below average
    return 1.0;
}

/**
 * Check if current session should block trading entirely.
 * @returns {{ blocked: bool, reason: string|null }}
 */
function checkSessionBlock(userId) {
    _computeSessionStats(userId);
    const stats = _sessionStats.get(userId);
    const session = getCurrentSession();

    if (!stats || !stats[session.id] || stats[session.id].trades < 10) {
        return { blocked: false, reason: null };
    }

    const sessStats = stats[session.id];

    // Block if win rate is terrible in this session (> 10 trades, < 25% WR)
    if (sessStats.winRate < 0.25 && sessStats.trades >= 10) {
        return {
            blocked: true,
            reason: `Session ${session.name}: ${Math.round(sessStats.winRate * 100)}% WR over ${sessStats.trades} trades. Auto-blocked.`,
        };
    }

    return { blocked: false, reason: null };
}

/**
 * Get session data for UI.
 */
function getSessionData(userId) {
    _computeSessionStats(userId);
    const stats = _sessionStats.get(userId) || {};
    const current = getCurrentSession();
    const modifier = getSessionModifier(userId);

    const sessPerf = {};
    for (const [sess, s] of Object.entries(stats)) {
        if (sess === 'ts') continue;
        sessPerf[sess] = {
            trades: s.trades,
            winRate: Math.round(s.winRate * 100),
            avgPnl: +s.avgPnl.toFixed(2),
            totalPnl: +s.totalPnl.toFixed(2),
        };
    }

    return {
        current: { id: current.id, name: current.name, volatility: current.volatility, overlap: current.overlap },
        modifier: +modifier.toFixed(2),
        performance: sessPerf,
    };
}

module.exports = {
    getCurrentSession,
    getSessionForHour,
    getSessionModifier,
    checkSessionBlock,
    getSessionData,
    SESSIONS,
    OVERLAPS,
};
