// Zeus Terminal — Journal API
// Reads closed trades from SQLite at_closed table (source of truth)
'use strict';

const { Router } = require('express');
const db = require('../services/database');
const router = Router();

// GET /api/journal?limit=100&offset=0&mode=demo|live&side=LONG|SHORT&from=2026-01-01&to=2026-12-31
router.get('/', (req, res) => {
    try {
        const userId = req.user.id;
        const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
        const offset = parseInt(req.query.offset, 10) || 0;

        // Read all closed trades for this user
        const rows = db.journalGetClosed(userId, limit, offset);
        const total = db.journalCountClosed(userId);

        // Parse JSON data and apply filters
        let trades = rows.map(r => {
            try {
                const d = JSON.parse(r.data);
                return {
                    seq: d.seq,
                    symbol: d.symbol,
                    side: d.side,
                    mode: d.mode || 'demo',
                    entryPrice: d.price,
                    exitPrice: d.closePnl != null ? _calcExitPrice(d) : null,
                    size: d.size,
                    margin: d.margin,
                    leverage: d.lev,
                    sl: d.sl,
                    tp: d.tp,
                    pnl: d.closePnl || 0,
                    exitReason: d.closeReason || d.status || '—',
                    openTs: d.ts,
                    closeTs: d.closeTs,
                    holdMs: d.closeTs && d.ts ? d.closeTs - d.ts : 0,
                    tier: d.tier,
                    confluence: d.confluence,
                    regime: d.regime,
                    closedAt: r.closed_at,
                    isLive: !!(d.live && d.live.status && d.live.status !== 'ERROR'),
                    liveAvgPrice: d.live ? d.live.avgPrice : null,
                };
            } catch (_) { return null; }
        }).filter(Boolean);

        // Server-side filters
        const { mode, side, from, to } = req.query;
        if (mode) trades = trades.filter(t => t.mode === mode);
        if (side) trades = trades.filter(t => t.side === side);
        if (from) {
            const fromTs = new Date(from).getTime();
            trades = trades.filter(t => t.openTs >= fromTs);
        }
        if (to) {
            const toTs = new Date(to).getTime() + 86400000; // end of day
            trades = trades.filter(t => t.openTs < toTs);
        }

        // Stats
        const wins = trades.filter(t => t.pnl > 0);
        const losses = trades.filter(t => t.pnl < 0);
        const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
        const avgHoldMs = trades.length > 0 ? trades.reduce((s, t) => s + t.holdMs, 0) / trades.length : 0;

        res.json({
            ok: true,
            trades,
            total,
            stats: {
                count: trades.length,
                wins: wins.length,
                losses: losses.length,
                winRate: trades.length > 0 ? +(wins.length / trades.length * 100).toFixed(1) : 0,
                totalPnl: +totalPnl.toFixed(2),
                avgPnl: trades.length > 0 ? +(totalPnl / trades.length).toFixed(2) : 0,
                bestTrade: trades.length > 0 ? +Math.max(...trades.map(t => t.pnl)).toFixed(2) : 0,
                worstTrade: trades.length > 0 ? +Math.min(...trades.map(t => t.pnl)).toFixed(2) : 0,
                avgHoldMs: Math.round(avgHoldMs),
                avgHoldStr: _msToStr(avgHoldMs),
                totalVolume: +trades.reduce((s, t) => s + (t.size || 0), 0).toFixed(2),
            },
        });
    } catch (err) {
        console.error('[JOURNAL] Error:', err.message);
        res.status(500).json({ ok: false, error: 'Failed to load journal' });
    }
});

// GET /api/journal/stats — summary only (lightweight)
router.get('/stats', (req, res) => {
    try {
        const userId = req.user.id;
        const rows = db.journalGetClosed(userId, 500, 0);
        const trades = rows.map(r => {
            try { return JSON.parse(r.data); } catch (_) { return null; }
        }).filter(Boolean);

        const demo = trades.filter(t => t.mode !== 'live');
        const live = trades.filter(t => t.mode === 'live');

        res.json({
            ok: true,
            demo: _calcStats(demo),
            live: _calcStats(live),
            all: _calcStats(trades),
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

function _calcStats(trades) {
    const wins = trades.filter(t => (t.closePnl || 0) > 0);
    const losses = trades.filter(t => (t.closePnl || 0) < 0);
    const totalPnl = trades.reduce((s, t) => s + (t.closePnl || 0), 0);
    return {
        count: trades.length,
        wins: wins.length,
        losses: losses.length,
        winRate: trades.length > 0 ? +(wins.length / trades.length * 100).toFixed(1) : 0,
        totalPnl: +totalPnl.toFixed(2),
        avgPnl: trades.length > 0 ? +(totalPnl / trades.length).toFixed(2) : 0,
    };
}

function _calcExitPrice(d) {
    if (d.live && d.live.avgPrice && d.closeReason !== d.status) return d.live.avgPrice;
    if (d.closePnl != null && d.price && d.size && d.lev) {
        // Reverse PnL formula: pnl = (exit - entry) / entry * size * lev (LONG)
        const dir = d.side === 'LONG' ? 1 : -1;
        const exit = d.price * (1 + dir * d.closePnl / (d.size * d.lev));
        return +exit.toFixed(2);
    }
    return null;
}

function _msToStr(ms) {
    if (ms < 60000) return Math.round(ms / 1000) + 's';
    if (ms < 3600000) return Math.round(ms / 60000) + 'm';
    if (ms < 86400000) return +(ms / 3600000).toFixed(1) + 'h';
    return +(ms / 86400000).toFixed(1) + 'd';
}

module.exports = router;
