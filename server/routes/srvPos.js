'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../services/logger');

let _reports = [];
const MAX_REPORTS = 100;

router.post('/shadow-report', express.json(), (req, res) => {
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
module.exports._resetForTest = () => { _reports = []; };
