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

module.exports = router;
