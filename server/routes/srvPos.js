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

module.exports = router;
module.exports._resetForTest = () => {
    _reports = [];
    _postTimestamps.clear();
};
module.exports._getTimestampMapSize = () => _postTimestamps.size;
module.exports._getReportCount = () => _reports.length;
module.exports._insertDirect = (entry) => {
    _reports.push(entry);
    if (_reports.length > MAX_REPORTS) _reports = _reports.slice(-MAX_REPORTS);
};
