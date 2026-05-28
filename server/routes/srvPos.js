'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../services/logger');

let _reports = [];
const MAX_REPORTS = 100;
const _postTimestamps = new Map();
const POST_RATE_WINDOW_MS = 60000;
const POST_RATE_MAX = 5;

function _isLocalhost(req) {
    const ip = req.ip || req.connection.remoteAddress || '';
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

// Prune empty IP entries from rate limit map to prevent unbounded growth
let _cleanupTimer = setInterval(() => {
    for (const [ip, ts] of _postTimestamps) {
        // Remove entries with no timestamps or all timestamps expired
        if (ts.length === 0) {
            _postTimestamps.delete(ip);
        } else {
            const now = Date.now();
            while (ts.length > 0 && now - ts[0] > POST_RATE_WINDOW_MS) ts.shift();
            if (ts.length === 0) _postTimestamps.delete(ip);
        }
    }
}, 300000);

router.post('/shadow-report', express.json(), (req, res) => {
    // Auth: localhost always allowed (curl diagnostics).
    // Remote: require x-zeus-request header (custom header = CSRF proof, browser won't
    // send it cross-origin without preflight which server doesn't allow).
    if (!_isLocalhost(req) && req.headers['x-zeus-request'] !== '1') {
        return res.status(403).json({ ok: false, error: 'missing x-zeus-request header' });
    }

    const ip = req.ip || '0.0.0.0';
    const now = Date.now();
    let timestamps = _postTimestamps.get(ip);
    if (!timestamps) { timestamps = []; _postTimestamps.set(ip, timestamps); }
    while (timestamps.length > 0 && now - timestamps[0] > POST_RATE_WINDOW_MS) timestamps.shift();
    if (timestamps.length >= POST_RATE_MAX) {
        return res.status(429).json({ ok: false, error: 'rate limited (5/min)' });
    }
    timestamps.push(now);

    const data = req.body;
    if (!data || typeof data.count !== 'number') {
        return res.status(400).json({ ok: false, error: 'invalid payload' });
    }
    const entry = {
        ts: data.ts || Date.now(),
        count: data.count,
        vectors: data.vectors || {},
        writeDrops: data.writeDrops || 0,
        details: (data.details || []).slice(0, 10),
        receivedAt: Date.now(),
    };
    _reports.push(entry);
    if (_reports.length > MAX_REPORTS) _reports = _reports.slice(-MAX_REPORTS);

    if (data.count > 0) {
        logger.warn('SRV-POS', `SHADOW DIVERGENCE REPORT: ${data.count} divergences, vectors=${JSON.stringify(data.vectors)}, writeDrops=${data.writeDrops}`);
    }

    res.json({ ok: true });
});

router.get('/shadow-report', (req, res) => {
    // [FA-P0-2 2026-05-28] Localhost-only — this router is mounted BEFORE
    // sessionAuth, and the GET handlers previously had NO guard (only POST
    // did). Remote callers could read divergence reports (position fragments).
    // No client UI consumes this GET — operator-only diagnostic via curl.
    if (!_isLocalhost(req)) {
        return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    const last = parseInt(req.query.last) || 20;
    const recent = _reports.slice(-last);
    const totalDivergences = _reports.reduce((sum, r) => sum + r.count, 0);
    res.json({
        ok: true,
        totalReports: _reports.length,
        totalDivergences,
        recent,
    });
});

router.get('/status', (req, res) => {
    // [FA-P0-2 2026-05-28] Localhost-only — leaked _SRV_POS_REAL_ENABLED
    // (confirms real-money trading to any anonymous remote caller). No client
    // UI consumes this — operator diagnostic only.
    if (!_isLocalhost(req)) {
        return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    const MF = require('../migrationFlags');
    res.json({
        ok: true,
        flags: {
            SERVER_AUTHORITATIVE_POSITIONS: MF.SERVER_AUTHORITATIVE_POSITIONS,
            _SRV_POS_TESTNET_ENABLED: MF._SRV_POS_TESTNET_ENABLED,
            _SRV_POS_REAL_ENABLED: MF._SRV_POS_REAL_ENABLED,
        },
        shadow: {
            reportsCollected: _reports.length,
            lastReport: _reports.length > 0 ? _reports[_reports.length - 1] : null,
        },
    });
});

// ── Orphan Report + Threshold Logic ──────────────────────────────────────────
const _orphanWindows = new Map(); // userId → [{ts, count}]
const ORPHAN_WINDOW_MS = 300000; // 5min
const ORPHAN_DEBOUNCE_MS = 10000; // 10s per user
const _orphanLastReport = new Map(); // userId → ts

function _getOrphanCount5min(userId) {
    const entries = _orphanWindows.get(userId) || [];
    const cutoff = Date.now() - ORPHAN_WINDOW_MS;
    const recent = entries.filter(e => e.ts > cutoff);
    _orphanWindows.set(userId, recent);
    return recent.reduce((sum, e) => sum + e.count, 0);
}

router.post('/orphan-report', express.json(), (req, res) => {
    if (!_isLocalhost(req) && req.headers['x-zeus-request'] !== '1') {
        return res.status(403).json({ ok: false, error: 'missing x-zeus-request header' });
    }
    // Auth: extract userId from cookie JWT
    let userId = null;
    try {
        const jwt = require('jsonwebtoken');
        const config = require('../config');
        const token = (req.cookies && req.cookies.zeus_token) || null;
        if (token) {
            const decoded = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
            userId = decoded && decoded.id;
        }
    } catch (_) {}
    if (!userId) return res.status(401).json({ ok: false, error: 'auth required' });

    // Debounce: 10s per user
    const lastTs = _orphanLastReport.get(userId) || 0;
    if (Date.now() - lastTs < ORPHAN_DEBOUNCE_MS) {
        return res.json({ ok: true, debounced: true });
    }
    _orphanLastReport.set(userId, Date.now());

    const { orphans, ts } = req.body || {};
    if (!Array.isArray(orphans) || orphans.length === 0) {
        return res.status(400).json({ ok: false, error: 'orphans array required' });
    }

    // Record in sliding window
    const entries = _orphanWindows.get(userId) || [];
    entries.push({ ts: Date.now(), count: orphans.length });
    _orphanWindows.set(userId, entries);

    // Audit log
    const { db } = require('../services/database');
    for (const o of orphans.slice(0, 10)) {
        try {
            db.prepare(
                `INSERT INTO position_classifications (ts, symbol, side, classified_as, vector, flag_state, source, exchange)
                 VALUES (?, ?, ?, 'orphan', 'exchange_only', 'authoritative', 'liveApi_sync', ?)`
            ).run(Date.now(), o.sym || '', o.side || '', o.exchange || 'binance');
        } catch (_) {}
    }

    // Threshold check
    const total5min = _getOrphanCount5min(userId);
    let severity = 'info';
    const telegram = require('../services/telegram');

    if (total5min >= 5) {
        severity = 'critical';
        const serverAT = require('../services/serverAT');
        const us = serverAT.getUserState(userId);
        if (us && !us.killActive) {
            serverAT.activateKillSwitch(userId);
            telegram.sendToUser(userId,
                `🚨 *AT SUSPENDED — ${total5min} orphans in 5min*\n` +
                `Positions on exchange not tracked by server.\n` +
                `Symbols: ${orphans.map(o => o.sym).join(', ')}\n` +
                `Manual review needed. Re-enable: Settings → Kill Switch reset`
            );
        }
        logger.error('SRV-POS', `ORPHAN CRITICAL uid=${userId} total5min=${total5min} — AT SUSPENDED`);
    } else if (total5min >= 2) {
        severity = 'urgent';
        telegram.sendToUser(userId,
            `⚠️ *URGENT: ${total5min} orphans in 5min*\n` +
            `Possible server-exchange drift.\n` +
            `Symbols: ${orphans.map(o => o.sym).join(', ')}\n` +
            `Check ZeuS Settings → SRV-POS`
        );
        logger.warn('SRV-POS', `ORPHAN URGENT uid=${userId} total5min=${total5min}`);
    } else {
        telegram.sendToUser(userId,
            `ℹ️ Orphan detected: ${orphans.map(o => `${o.sym} ${o.side}`).join(', ')}`
        );
        logger.info('SRV-POS', `ORPHAN INFO uid=${userId} count=${orphans.length}`);
    }

    res.json({ ok: true, severity, total5min });
});

module.exports = router;
module.exports._resetForTest = () => {
    _reports = [];
    _postTimestamps.clear();
    _orphanWindows.clear();
    _orphanLastReport.clear();
};
module.exports._getTimestampMapSize = () => _postTimestamps.size;
module.exports._getReportCount = () => _reports.length;
module.exports._insertDirect = (entry) => {
    _reports.push(entry);
    if (_reports.length > MAX_REPORTS) _reports = _reports.slice(-MAX_REPORTS);
};
module.exports._getOrphanCount5min = _getOrphanCount5min;
