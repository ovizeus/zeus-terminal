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

// [LIQ-HISTORY 2026-10-25] Harta de lichidari REALE, din istoricul de pe
// server. Clientul tinea 24h in localStorage, pe un singur telefon; asta e
// aceeasi harta dar pe 30 de zile si la fel pe orice dispozitiv.
//
// `ref` vine de la client (pretul lui curent) ca gruparea pe procente sa fie
// facuta dupa o SINGURA regula, aceeasi ca in liqMap.ts — nu doua care se
// contrazic la primul caz ambiguu (R-C-23).
router.get('/liq-map', (req, res) => {
    try {
        const liqStore = require('../services/liqStore');
        const symbol = String(req.query.symbol || 'BTCUSDT').toUpperCase();
        const ref = Number(req.query.ref);
        const days = Number(req.query.days) || liqStore.DEFAULT_DAYS;
        const m = liqStore.map({ symbol, ref, days });
        // `coverage` pleaca spre client dinadins: fara el o scara goala in jos
        // arata identic cu una care n-are date deloc.
        res.json(m);
    } catch (err) {
        res.status(200).json({ buckets: [], events: 0, coverage: { upPct: 0, downPct: 0 }, error: 'unavailable' });
    }
});

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

// [2026-06-20] Live Binance markPrice for open-position symbols (fstream is Hetzner-blocked, so we
// poll premiumIndex server-side ~1s and cache it). Returns { SYM: markPrice }. ?symbols=BTC,ETH.
router.get('/markprice', (req, res) => {
    try {
        const symbols = req.query.symbols ? String(req.query.symbols).split(',').filter(Boolean) : null;
        res.json(require('../services/markPriceCache').get(symbols));
    } catch (e) { res.status(500).json({ error: e.message }); }
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

router.get('/funding', (req, res) => {
    const sym = (req.query.symbol || 'BTCUSDT').toUpperCase();
    const exch = req.query.exchange || 'binance';
    res.json({ ok: true, data: mc.get('funding', exch + ':' + sym) || null });
});

router.get('/oi', (req, res) => {
    const sym = (req.query.symbol || 'BTCUSDT').toUpperCase();
    const exch = req.query.exchange || 'binance';
    res.json({ ok: true, data: mc.get('oi', exch + ':' + sym) || null });
});

router.get('/depth', (req, res) => {
    const sym = (req.query.symbol || 'BTCUSDT').toUpperCase();
    const exch = req.query.exchange || 'binance';
    res.json({ ok: true, data: mc.get('depth', exch + ':' + sym) || null });
});

router.get('/sentiment', (req, res) => {
    const sym = (req.query.symbol || 'BTCUSDT').toUpperCase();
    const exch = req.query.exchange || 'binance';
    res.json({ ok: true, data: mc.get('sentiment', exch + ':' + sym) || null });
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
