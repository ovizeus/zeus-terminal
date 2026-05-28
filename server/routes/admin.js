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

module.exports = router;
