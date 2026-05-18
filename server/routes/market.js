'use strict';

/**
 * Market data routes — surfaces the marketRadar snapshot to the client.
 *
 * Day 32A: GET /api/market/top?kind=gainers|losers|volume&limit=N
 *   Returns the latest top-N USDT-perp tickers from the radar cache,
 *   sorted by gainers (24h % desc), losers (24h % asc) or volume.
 *
 * Auth: standard sessionAuth (applied at app.use('/api') level in server.js).
 */

const express = require('express');
const router = express.Router();
const marketRadar = require('../services/marketRadar');

const ALLOWED_KINDS = new Set(['gainers', 'losers', 'volume']);

router.get('/top', (req, res) => {
    const kindRaw = String(req.query.kind || 'volume').toLowerCase();
    const kind = ALLOWED_KINDS.has(kindRaw) ? kindRaw : 'volume';
    const limitRaw = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 10;
    const snap = marketRadar.getTopSnapshot({ kind, limit });
    if (!snap) return res.json({ ok: false, error: 'radar_warming_up', symbols: [] });
    res.json({ ok: true, ...snap });
});

router.get('/symbol/:symbol', (req, res) => {
    const entry = marketRadar.getSymbolFromSnapshot(req.params.symbol);
    if (!entry) return res.status(404).json({ ok: false, error: 'symbol_not_in_top300' });
    res.json({ ok: true, ts: Date.now(), ...entry });
});

module.exports = router;
