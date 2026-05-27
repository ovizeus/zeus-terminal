'use strict';

const express = require('express');
const router = express.Router();
const gateway = require('../services/binanceGateway');

const FUTURES_BASE = 'https://fapi.binance.com';
const SPOT_BASE = 'https://api.binance.com';

const CACHE_TTL = {
    klines_poll: 10000,
    klines_init: 60000,
    ticker24hr: 30000,
    topLongShort: 60000,
    spot_klines: 120000,
};

const _cache = new Map();
const _pending = new Map();

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

async function _proxyFetch(url, cacheKey, ttlMs, weight) {
    const cached = _getCached(cacheKey, ttlMs);
    if (cached) return cached;

    if (_pending.has(cacheKey)) return _pending.get(cacheKey);

    const promise = (async () => {
        const res = await gateway.fetch(url, { __weight: weight, __src: 'marketProxy' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        _setCache(cacheKey, data);
        _pending.delete(cacheKey);
        return data;
    })();

    _pending.set(cacheKey, promise);
    promise.catch(() => _pending.delete(cacheKey));
    return promise;
}

router.get('/klines', async (req, res) => {
    const { symbol, interval, limit } = req.query;
    if (!symbol || !interval) return res.status(400).json({ error: 'symbol and interval required' });
    const lim = Math.min(parseInt(limit) || 500, 1500);
    const url = `${FUTURES_BASE}/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${lim}`;
    const ttl = lim <= 2 ? CACHE_TTL.klines_poll : CACHE_TTL.klines_init;
    const key = _cacheKey('klines', { symbol, interval, limit: lim });
    try {
        const data = await _proxyFetch(url, key, ttl, lim <= 2 ? 1 : 5);
        res.json(data);
    } catch (err) {
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
        const data = await _proxyFetch(url, key, CACHE_TTL.ticker24hr, 40);
        res.json(data);
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
        const data = await _proxyFetch(url, key, CACHE_TTL.topLongShort, 1);
        res.json(data);
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
        const data = await _proxyFetch(url, key, CACHE_TTL.spot_klines, 5);
        res.json(data);
    } catch (err) {
        res.status(502).json({ error: 'Binance unavailable', detail: err.message });
    }
});

module.exports = router;
