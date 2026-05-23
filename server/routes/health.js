'use strict';

/**
 * Health routes — Phase 10 Tasks 54-56.
 *
 * GET /api/health/feed/:exchange  — feed connection state + silence classification
 * GET /api/health/locks           — orderLock active locks
 * GET /api/health/recovery        — last RECOVERY_BOOT_COMPLETE from audit_log
 */

const express = require('express');
const router = express.Router();

// ─── Task 54: GET /feed/:exchange ─────────────────────────────────────────────
router.get('/feed/:exchange', (req, res) => {
    const exchange = req.params.exchange;
    if (!['binance', 'bybit'].includes(exchange)) {
        return res.status(400).json({ error: 'exchange must be binance or bybit' });
    }

    let connectionState;
    try {
        if (exchange === 'bybit') {
            const bybitFeed = require('../services/bybitFeed');
            connectionState = bybitFeed.getConnectionState();
        } else {
            const binanceFeed = require('../services/binanceFeed');
            connectionState = binanceFeed.getConnectionState();
        }
    } catch (_) {
        connectionState = { connected: false };
    }

    const now = Date.now();
    const lastTs = connectionState.lastMessageTs || 0;
    const silentMs = lastTs > 0 ? now - lastTs : Infinity;

    let state = 'healthy';
    if (silentMs > 600000) state = 'dead';
    else if (silentMs > 120000) state = 'silent';
    else if (silentMs > 30000) state = 'degraded';

    res.json({
        exchange,
        connected: !!connectionState.connected,
        lastMessageTs: lastTs,
        silentMs: lastTs > 0 ? silentMs : null,
        state,
    });
});

// ─── Task 55: GET /locks ───────────────────────────────────────────────────────
router.get('/locks', (req, res) => {
    try {
        const orderLock = require('../services/orderLock');
        const locks = orderLock.getActiveLocks ? orderLock.getActiveLocks() : [];
        res.json({ activeLocks: locks.length, locks });
    } catch (_) {
        res.json({ activeLocks: 0, locks: [] });
    }
});

// ─── Task 56: GET /recovery ───────────────────────────────────────────────────
router.get('/recovery', (req, res) => {
    try {
        const { db } = require('../services/database');
        const row = db.prepare(
            `SELECT details, created_at FROM audit_log WHERE action='RECOVERY_BOOT_COMPLETE' ORDER BY id DESC LIMIT 1`
        ).get();
        if (!row) return res.json({ lastRun: null, status: 'never_run' });
        const details = JSON.parse(row.details);
        res.json({
            lastRun: row.created_at,
            ...details,
            status: details.errors > 0 ? 'errors' : 'clean',
        });
    } catch (_) {
        res.json({ lastRun: null, status: 'error' });
    }
});

module.exports = router;
