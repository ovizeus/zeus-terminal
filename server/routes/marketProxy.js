'use strict';

const express = require('express');
const router = express.Router();
const gateway = require('../services/binanceGateway');
const bybitRest = require('../services/bybitRest');

// [Phase B / Task B3b] Bybit REST kline fallback — Bybit isn't IP-blocked from this
// host, so when Binance is unavailable we serve FRESH Bybit klines (normalized to
// Binance shape) in preference to STALE Binance data. Returns null on any failure.
async function _bybitKlineFallback(symbol, interval, limit) {
    try { return await bybitRest.fetchKlines(symbol, interval, limit); }
    catch (_) { return null; }
}

const FUTURES_BASE = 'https://fapi.binance.com';
const SPOT_BASE = 'https://api.binance.com';

const CACHE_TTL = {
    klines_poll: 10000,
    klines_init: 60000,
    klines_history: 3600000,
    ticker24hr: 30000,
    topLongShort: 60000,
    spot_klines: 120000,
};

// [2026-06-19] Pure, testable helpers for the /klines route. endTime is additive:
// when absent the URL + cache key are byte-identical to the pre-backfill behavior.
function _validEndTime(endTime) {
    const n = Number(endTime);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}
function _buildKlinesUrl(symbol, interval, lim, endTime) {
    let url = `${FUTURES_BASE}/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${lim}`;
    const et = _validEndTime(endTime);
    if (et !== null) url += `&endTime=${et}`;
    return url;
}
function _klinesCacheKeyParams(symbol, interval, lim, endTime) {
    const params = { symbol, interval, limit: lim };
    const et = _validEndTime(endTime);
    if (et !== null) params.endTime = et;
    return params;
}
function _klinesTtl(lim, endTime) {
    if (_validEndTime(endTime) !== null) return CACHE_TTL.klines_history; // immutable closed window
    return lim <= 2 ? CACHE_TTL.klines_poll : CACHE_TTL.klines_init;
}

const _cache = new Map();
const _pending = new Map();
// [Phase A / Task A1] Last-good payload per key, NEVER purged on TTL. When Binance
// fails, we serve this (marked stale via X-Zeus-Stale header) instead of a 502 blank,
// so the chart shows last-known data rather than going dark.
const _lastGood = new Map();

function _cacheKey(endpoint, params) {
    return endpoint + '|' + JSON.stringify(params);
}

function _getCached(key, ttl) {
    const entry = _cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > ttl) { _cache.delete(key); return null; }
    return entry.data;
}

function _setCache(key, data) {
    _cache.set(key, { data, ts: Date.now() });
}

// [Phase A / Task A1] Pure stale-serve decision. fresh wins; else last-good as stale;
// else miss (route 502s). Keeps payload shape untouched (same reference) so array
// responses (klines/ticker) are unaffected.
function _resolveServe(fresh, lastGood, nowMs) {
    if (fresh !== null && fresh !== undefined) return { data: fresh, stale: false };
    if (lastGood) return { data: lastGood.data, stale: true, ageMs: nowMs - lastGood.ts };
    return { data: null, stale: false, miss: true };
}

// Returns { data, stale, ageMs? } — callers set X-Zeus-Stale header when stale,
// or 502 when the promise rejects (no last-good ever existed).
async function _proxyFetch(url, cacheKey, ttlMs, weight) {
    const fresh = _getCached(cacheKey, ttlMs);
    if (fresh) return { data: fresh, stale: false };

    if (_pending.has(cacheKey)) return _pending.get(cacheKey);

    const promise = (async () => {
        try {
            const res = await gateway.fetch(url, { __weight: weight, __src: 'marketProxy' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            _setCache(cacheKey, data);
            _lastGood.set(cacheKey, { data, ts: Date.now() });
            _pending.delete(cacheKey);
            return { data, stale: false };
        } catch (err) {
            _pending.delete(cacheKey);
            const served = _resolveServe(null, _lastGood.get(cacheKey), Date.now());
            if (served.miss) throw err; // no last-good ever → let route 502
            return served;
        }
    })();

    _pending.set(cacheKey, promise);
    promise.catch(() => _pending.delete(cacheKey));
    return promise;
}

router.get('/klines', async (req, res) => {
    const { symbol, interval, limit } = req.query;
    if (!symbol || !interval) return res.status(400).json({ error: 'symbol and interval required' });
    const lim = Math.min(parseInt(limit) || 500, 1500);
    const url = _buildKlinesUrl(symbol, interval, lim, req.query.endTime);
    const ttl = _klinesTtl(lim, req.query.endTime);
    const key = _cacheKey('klines', _klinesCacheKeyParams(symbol, interval, lim, req.query.endTime));
    try {
        const r = await _proxyFetch(url, key, ttl, lim <= 2 ? 1 : 5);
        if (!r.stale) { res.json(r.data); return; }
        // Binance failed → prefer FRESH Bybit over STALE Binance for a live chart.
        const bybit = await _bybitKlineFallback(symbol, interval, lim);
        if (bybit) { res.set('X-Zeus-Source', 'bybit'); res.json(bybit); return; }
        res.set('X-Zeus-Stale', String(r.ageMs)); res.json(r.data);
    } catch (err) {
        // No Binance data at all → last-resort Bybit, else 502.
        const bybit = await _bybitKlineFallback(symbol, interval, lim);
        if (bybit) { res.set('X-Zeus-Source', 'bybit'); res.json(bybit); return; }
        res.status(502).json({ error: 'Binance unavailable', detail: err.message });
    }
});

router.get('/ticker24hr', async (req, res) => {
    const { symbols } = req.query;
    const url = symbols
        ? `${FUTURES_BASE}/fapi/v1/ticker/24hr?symbols=${encodeURIComponent(symbols)}`
        : `${FUTURES_BASE}/fapi/v1/ticker/24hr`;
    const key = _cacheKey('ticker24hr', { symbols: symbols || 'all' });
    try {
        const r = await _proxyFetch(url, key, CACHE_TTL.ticker24hr, 40);
        if (r.stale) res.set('X-Zeus-Stale', String(r.ageMs));
        res.json(r.data);
    } catch (err) {
        res.status(502).json({ error: 'Binance unavailable', detail: err.message });
    }
});

router.get('/topLongShort', async (req, res) => {
    const { symbol, period, limit } = req.query;
    const sym = symbol || 'BTCUSDT';
    const per = period || '5m';
    const lim = limit || '1';
    const url = `${FUTURES_BASE}/futures/data/topLongShortPositionRatio?symbol=${sym}&period=${per}&limit=${lim}`;
    const key = _cacheKey('topLongShort', { symbol: sym, period: per, limit: lim });
    try {
        const r = await _proxyFetch(url, key, CACHE_TTL.topLongShort, 1);
        if (r.stale) res.set('X-Zeus-Stale', String(r.ageMs));
        res.json(r.data);
    } catch (err) {
        res.status(502).json({ error: 'Binance unavailable', detail: err.message });
    }
});

router.get('/spot/klines', async (req, res) => {
    const { symbol, interval, limit } = req.query;
    if (!symbol || !interval) return res.status(400).json({ error: 'symbol and interval required' });
    const lim = Math.min(parseInt(limit) || 500, 1500);
    const url = `${SPOT_BASE}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${lim}`;
    const key = _cacheKey('spot_klines', { symbol, interval, limit: lim });
    try {
        const r = await _proxyFetch(url, key, CACHE_TTL.spot_klines, 5);
        if (r.stale) res.set('X-Zeus-Stale', String(r.ageMs));
        res.json(r.data);
    } catch (err) {
        res.status(502).json({ error: 'Binance unavailable', detail: err.message });
    }
});

router.get('/funding', (req, res) => {
    try {
        const mc = require('../services/marketCache');
        const sym = (req.query.symbol || 'BTCUSDT').toUpperCase();
        const exch = req.query.exchange || 'binance';
        res.json({ ok: true, data: mc.get('funding', exch + ':' + sym) || null });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/oi', (req, res) => {
    try {
        const mc = require('../services/marketCache');
        const sym = (req.query.symbol || 'BTCUSDT').toUpperCase();
        const exch = req.query.exchange || 'binance';
        res.json({ ok: true, data: mc.get('oi', exch + ':' + sym) || null });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// [Phase A / Task A1] Pure-logic export for unit testing (no runtime use).
router._serveTest = { resolveServe: _resolveServe };

module.exports = router;
module.exports._buildKlinesUrl = _buildKlinesUrl;
module.exports._klinesCacheKeyParams = _klinesCacheKeyParams;
module.exports._klinesTtl = _klinesTtl;
module.exports.FUTURES_BASE = FUTURES_BASE;
