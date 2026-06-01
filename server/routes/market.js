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

// ═══════════════════════════════════════════════════════════════════
// [T3 Gateway] Proxy endpoints — client reads from marketCache, NOT Binance
// ═══════════════════════════════════════════════════════════════════
const mc = require('../services/marketCache');

router.get('/ticker', (req, res) => {
    const sym = (req.query.symbol || 'BTCUSDT').toUpperCase();
    const exch = req.query.exchange || 'binance';
    const data = mc.get('ticker', exch + ':' + sym);
    res.json({ ok: true, data: data || null, cached: !!data });
});

router.get('/ticker/all', (req, res) => {
    const exch = req.query.exchange || 'binance';
    const all = mc.getAll('ticker');
    const filtered = {};
    for (const [k, v] of Object.entries(all)) {
        if (k.startsWith(exch + ':')) filtered[k.split(':')[1]] = v;
    }
    res.json({ ok: true, data: filtered, count: Object.keys(filtered).length });
});

// [RADAR-FIX 2026-06-01] OI / funding / sentiment are GLOBAL market metrics (sourced
// from Binance), NOT per-exchange. The producers write them under the 'binance:' key.
// A user on Bybit requested 'bybit:'+sym → null → radar showed 0. Fall back to the
// binance key so these global metrics show on any active exchange. (depth stays
// exchange-specific — order book IS per-exchange.)
const _mcGlobal = (kind, exch, sym) => mc.get(kind, exch + ':' + sym) || mc.get(kind, 'binance:' + sym) || null;

router.get('/funding', (req, res) => {
    const sym = (req.query.symbol || 'BTCUSDT').toUpperCase();
    const exch = req.query.exchange || 'binance';
    res.json({ ok: true, data: _mcGlobal('funding', exch, sym) });
});

router.get('/oi', (req, res) => {
    const sym = (req.query.symbol || 'BTCUSDT').toUpperCase();
    const exch = req.query.exchange || 'binance';
    res.json({ ok: true, data: _mcGlobal('oi', exch, sym) });
});

router.get('/depth', (req, res) => {
    const sym = (req.query.symbol || 'BTCUSDT').toUpperCase();
    const exch = req.query.exchange || 'binance';
    res.json({ ok: true, data: mc.get('depth', exch + ':' + sym) || null });
});

router.get('/sentiment', (req, res) => {
    const sym = (req.query.symbol || 'BTCUSDT').toUpperCase();
    const exch = req.query.exchange || 'binance';
    res.json({ ok: true, data: _mcGlobal('sentiment', exch, sym) });
});

router.get('/time', (req, res) => {
    res.json({ ok: true, serverTime: Date.now() });
});

router.get('/klines', (req, res) => {
    const sym = (req.query.symbol || 'BTCUSDT').toUpperCase();
    const tf = req.query.tf || '5m';
    const limit = Math.min(parseInt(req.query.limit) || 200, 1000);
    try {
        const serverState = require('../services/serverState');
        const bars = serverState.getBarsForSymbol(sym, tf);
        res.json({ ok: true, data: (bars || []).slice(-limit) });
    } catch (_) { res.json({ ok: true, data: [] }); }
});

router.get('/cache/stats', (req, res) => {
    res.json({ ok: true, ...mc.getStats() });
});

router.get('/cache/health', (req, res) => {
    res.json({ ok: true, ...mc.health() });
});

module.exports = router;
