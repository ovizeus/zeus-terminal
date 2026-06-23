'use strict';

// Zeus Terminal — Admin operations route
// Operator-only endpoints for emergency control: global halt toggle, status read.
// Mounted at /api/admin after sessionAuth middleware in server.js.

const express = require('express');
const router = express.Router();

function _requireAuth(req, res, next) {
    if (!req.user || !req.user.id) {
        return res.status(401).json({ ok: false, error: 'Authentication required' });
    }
    next();
}

function _requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ ok: false, error: 'admin only' });
    }
    next();
}

// POST /api/admin/halt — arm or disarm global halt
// Body: { active: boolean, reason?: string }
router.post('/halt', _requireAuth, _requireAdmin, (req, res) => {
    if (typeof req.body.active !== 'boolean') {
        return res.status(400).json({ ok: false, error: 'active (boolean) required' });
    }
    const reason = String(req.body.reason || 'admin_api').slice(0, 200);
    try {
        const serverAT = require('../services/serverAT');
        const result = serverAT.setGlobalHalt(req.body.active, req.user.id, reason);
        return res.json({ ok: true, halt: result });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/admin/halt — current state
router.get('/halt', _requireAuth, _requireAdmin, (req, res) => {
    try {
        const serverAT = require('../services/serverAT');
        const state = serverAT.getGlobalHaltState
            ? serverAT.getGlobalHaltState()
            : { active: false, by: null, ts: null, reason: null };
        return res.json(state);
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/admin/binance-telemetry — live request-telemetry snapshot
// (per-source counts, quota pressure, scheduler lane stats). [2026-06-05]
// Built to attribute the recurring testnet weight saturations (6000+/min
// bursts at 12:45/13:30/17:30) — the ring is in-memory, so when the next
// BINANCE_RATE warn fires, hit this endpoint to see WHO spent the weight.
router.get('/binance-telemetry', _requireAuth, _requireAdmin, (req, res) => {
    try {
        const snap = require('../services/binanceTelemetry').getSnapshot();
        return res.json({ ok: true, snapshot: snap });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/admin/user-stats/:id — per-user live stats for the admin drawer
// [P2 2026-06-06] On-demand only (fetched when the drawer opens, no polling →
// at most one exchange balance call per open). Exchange balance is fail-soft:
// a Binance hiccup returns balance:null + balanceError, never a 500 — the
// drawer still renders mode/positions/demo balance.
router.get('/user-stats/:id', _requireAuth, _requireAdmin, async (req, res) => {
    const targetId = parseInt(req.params.id, 10);
    if (!Number.isFinite(targetId) || targetId <= 0) {
        return res.status(400).json({ ok: false, error: 'numeric user id required' });
    }
    try {
        const serverAT = require('../services/serverAT');
        const credentialStore = require('../services/credentialStore');

        const mode = serverAT.getMode(targetId);
        const stats = serverAT.getStats(targetId);
        const demo = serverAT.getDemoBalance(targetId);
        const positions = (serverAT.getOpenPositions(targetId) || []).map(p => ({
            seq: p.seq, symbol: p.symbol, side: p.side, mode: p.mode,
            size: p.size, lev: p.lev, entryPrice: p.price, sl: p.sl, tp: p.tp,
            openedAt: p.ts, liveStatus: p.live ? p.live.status : null,
        }));

        const creds = credentialStore.getExchangeCreds(targetId);
        const exchange = { connected: !!creds };
        if (creds) {
            exchange.exchange = creds.exchange;
            exchange.mode = creds.mode;
            try {
                const bal = await require('../services/exchangeOps').getBalance(targetId);
                // Canonical ops shape (binanceOps/bybitOps) is walletBalance;
                // accept legacy `balance` defensively.
                exchange.balance = bal ? parseFloat(bal.walletBalance != null ? bal.walletBalance : (bal.balance || 0)) : null;
                exchange.availableBalance = bal ? parseFloat(bal.availableBalance || 0) : null;
            } catch (balErr) {
                exchange.balance = null;
                exchange.availableBalance = null;
                exchange.balanceError = balErr.message;
            }
        }

        return res.json({
            ok: true,
            stats: {
                mode,
                openCount: stats.openCount,
                dailyPnLLive: stats.dailyPnLLive,
                dailyPnLDemo: stats.dailyPnLDemo,
                killActive: stats.killActive,
                killPct: stats.killPct,
                demo,
                exchange,
                positions,
            },
        });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/admin/leaderboard?env=REAL|TESTNET|DEMO&window=today|7d|30d|all
// Read-only aggregated ranking of all users. ~10s server cache per (env,window).
router.get('/leaderboard', _requireAuth, _requireAdmin, async (req, res) => {
    const env = ['REAL', 'TESTNET', 'DEMO'].includes(String(req.query.env)) ? String(req.query.env) : 'TESTNET';
    const window = ['today', '7d', '30d', 'all'].includes(String(req.query.window)) ? String(req.query.window) : 'all';
    try {
        const data = await require('../services/leaderboard').gatherLeaderboardData({ env, window });
        return res.json(data);
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
});

module.exports = router;
