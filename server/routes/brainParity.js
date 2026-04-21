// Zeus Terminal — Phase 2 S3 Brain Parity Harness route.
// Shadow-only instrumentation: clients POST their computeFusionDecision
// output; the report endpoint aggregates client vs server fusion rows
// written by serverBrain._runShadowCycle. Zero runtime influence on live
// AutoTrade / Brain paths. Gated by MF.PARITY_SHADOW_ENABLED (default OFF).
'use strict';

const express = require('express');
const router = express.Router();
const db = require('../services/database');
const MF = require('../migrationFlags');

function _requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ ok: false, error: 'admin only' });
    }
    next();
}

// POST /api/brain/parity/client
// Body: { symbol, cycle?, dir, decision, confidence, score, reasons?, ts? }
// Auth: per-user (req.user.id from JWT via createSessionAuth middleware).
// Behaviour: writes a source='client' row when MF.PARITY_SHADOW_ENABLED is
// true; otherwise returns { ok: true, logged: false } so the client can emit
// unconditionally without error handling. Never mutates any live state.
router.post('/client', (req, res) => {
    if (!req.user || !req.user.id) {
        return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    if (!MF.PARITY_SHADOW_ENABLED) {
        return res.status(200).json({ ok: true, logged: false, reason: 'shadow_disabled' });
    }
    const body = req.body || {};
    const symbol = body.symbol;
    const decision = body.decision;
    if (typeof symbol !== 'string' || !symbol) {
        return res.status(400).json({ ok: false, error: 'symbol required' });
    }
    if (typeof decision !== 'string') {
        return res.status(400).json({ ok: false, error: 'decision required' });
    }
    db.logParityRow(req.user.id, symbol, 'client', {
        dir: body.dir,
        decision: decision,
        confidence: body.confidence,
        score: body.score,
        reasons: body.reasons,
    }, body.cycle);
    return res.status(200).json({ ok: true, logged: true });
});

// GET /api/brain/parity/report
// Query: ?since=<ms>&symbol=<SYMUSDT>&userId=<n>
// Auth: admin-only (role check).
// Returns aggregate client/server match counts, top mismatch reasons,
// per-symbol breakdown. Used for the ≥95% agreement gate before S6/S8/S10/S11.
router.get('/report', _requireAdmin, (req, res) => {
    const report = db.queryParityReport({
        since: req.query.since,
        symbol: req.query.symbol,
        userId: req.query.userId,
    });
    return res.status(200).json(Object.assign({ ok: true }, report));
});

module.exports = router;
