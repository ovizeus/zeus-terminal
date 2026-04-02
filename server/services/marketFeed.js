// Zeus Terminal — Server Market Feed (Phase 2)
// Connects to Binance Futures WebSocket streams + REST fallback.
// Populates server-side state (SD) with live market data.
// Gated by MF.SERVER_MARKET_DATA flag.
'use strict';

const Sentry = require('@sentry/node');
const WebSocket = require('ws');
const logger = require('./logger');

// ── Config ──
const BINANCE_WS = 'wss://fstream.binance.com/ws';
const BINANCE_REST = 'https://fapi.binance.com';
const RECONNECT_MS = 5000;      // reconnect delay
const MAX_RECONNECT_MS = 60000;     // max backoff
const PING_INTERVAL_MS = 180000;    // 3min ping (Binance times out at 5min)
const KLINE_HISTORY = 200;       // initial candle fetch count
const STALE_DATA_MS = 120000;    // 2min data staleness threshold

// ── Active streams ──
const _streams = {};    // { streamKey: { ws, reconnects, timer, alive } }
const _activeSymbols = new Set();  // [MULTI-SYM] all subscribed symbols (uppercase)
let _timeframes = [];   // active timeframes ['5m', '1h', '4h']

// ── Event listeners ──
const _listeners = { kline: [], price: [], fundingRate: [], openInterest: [] };

function on(event, fn) {
    if (_listeners[event]) _listeners[event].push(fn);
}

function _emit(event, data) {
    for (const fn of (_listeners[event] || [])) {
        try { fn(data); } catch (e) { logger.error('FEED', `Listener error [${event}]:`, e.message); }
    }
}

// ══════════════════════════════════════════════════════════════════
// REST — Fetch initial kline history
// ══════════════════════════════════════════════════════════════════
async function fetchKlines(symbol, interval, limit) {
    limit = limit || KLINE_HISTORY;
    const url = `${BINANCE_REST}/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${encodeURIComponent(limit)}`;
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = await res.json();
        return raw.map(k => ({
            time: k[0] / 1000,
            open: +k[1],
            high: +k[2],
            low: +k[3],
            close: +k[4],
            volume: +k[5],
        }));
    } catch (err) {
        logger.error('FEED', `fetchKlines ${symbol} ${interval} failed:`, err.message);
        return null;
    }
}

// ══════════════════════════════════════════════════════════════════
// REST — Fetch funding rate
// ══════════════════════════════════════════════════════════════════
async function fetchFundingRate(symbol) {
    const url = `${BINANCE_REST}/fapi/v1/premiumIndex?symbol=${encodeURIComponent(symbol)}`;
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) return null;
        const data = await res.json();
        return data.lastFundingRate ? parseFloat(data.lastFundingRate) : null;
    } catch (err) {
        logger.error('FEED', `fetchFundingRate ${symbol} failed:`, err.message);
        return null;
    }
}

// ══════════════════════════════════════════════════════════════════
// REST — Fetch open interest
// ══════════════════════════════════════════════════════════════════
async function fetchOpenInterest(symbol) {
    const url = `${BINANCE_REST}/fapi/v1/openInterest?symbol=${encodeURIComponent(symbol)}`;
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) return null;
        const data = await res.json();
        return data.openInterest ? parseFloat(data.openInterest) : null;
    } catch (err) {
        logger.error('FEED', `fetchOpenInterest ${symbol} failed:`, err.message);
        return null;
    }
}

// ══════════════════════════════════════════════════════════════════
// WebSocket — Stream manager with auto-reconnect
// ══════════════════════════════════════════════════════════════════
function _connectStream(streamName, onMessage) {
    const key = streamName;
    if (_streams[key]?.ws?.readyState === WebSocket.OPEN) return;

    const url = `${BINANCE_WS}/${streamName}`;
    const entry = _streams[key] || { ws: null, reconnects: 0, timer: null, alive: false };
    _streams[key] = entry;

    try {
        const ws = new WebSocket(url);
        entry.ws = ws;

        ws.on('open', () => {
            entry.reconnects = 0;
            entry.alive = true;
            logger.info('FEED', `Stream connected: ${streamName}`);

            // Periodic ping to keep alive
            if (entry.timer) clearInterval(entry.timer);
            entry.timer = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) ws.ping();
            }, PING_INTERVAL_MS);
        });

        ws.on('message', (raw) => {
            entry.alive = true;
            try {
                const data = JSON.parse(raw.toString());
                onMessage(data);
            } catch (e) { /* ignore parse errors */ }
        });

        ws.on('pong', () => { entry.alive = true; });

        ws.on('close', () => {
            entry.alive = false;
            if (entry.timer) { clearInterval(entry.timer); entry.timer = null; }
            // Exponential backoff reconnect
            entry.reconnects++;
            const delay = Math.min(RECONNECT_MS * Math.pow(2, entry.reconnects - 1), MAX_RECONNECT_MS);
            logger.warn('FEED', `Stream closed: ${streamName}, reconnecting in ${delay}ms (attempt ${entry.reconnects})`);
            setTimeout(() => _connectStream(streamName, onMessage), delay);
        });

        ws.on('error', (err) => {
            logger.error('FEED', `Stream error [${streamName}]:`, err.message);
            if (entry.reconnects >= 3) Sentry.captureException(err, { tags: { module: 'marketFeed', stream: streamName, reconnects: entry.reconnects } });
            ws.close();
        });
    } catch (err) {
        logger.error('FEED', `Failed to create WS [${streamName}]:`, err.message);
        const delay = Math.min(RECONNECT_MS * Math.pow(2, entry.reconnects), MAX_RECONNECT_MS);
        entry.reconnects++;
        setTimeout(() => _connectStream(streamName, onMessage), delay);
    }
}

// ══════════════════════════════════════════════════════════════════
// Subscribe — start all streams for a symbol
// ══════════════════════════════════════════════════════════════════
async function subscribe(symbol, timeframes) {
    const symUpper = symbol.toUpperCase();
    const symLower = symbol.toLowerCase();     // [MULTI-SYM] local capture for closures

    // [MULTI-SYM] additive subscribe — no unsubscribeAll on symbol switch
    _activeSymbols.add(symUpper);
    _timeframes = timeframes || ['5m', '1h', '4h'];

    logger.info('FEED', `Subscribing to ${symUpper} [${_timeframes.join(',')}]`);

    // 1) Fetch initial kline history for each timeframe
    const klinePromises = _timeframes.map(async (tf) => {
        const bars = await fetchKlines(symUpper, tf, KLINE_HISTORY);
        if (bars && bars.length > 0) {
            _emit('kline', { symbol: symUpper, timeframe: tf, bars, initial: true });
        }
        return { tf, count: bars ? bars.length : 0 };
    });
    const results = await Promise.all(klinePromises);
    for (const r of results) {
        logger.info('FEED', `  ${symUpper} ${r.tf}: ${r.count} initial candles`);
    }

    // 2) Fetch funding rate + OI
    const [fr, oi] = await Promise.all([
        fetchFundingRate(symUpper),
        fetchOpenInterest(symUpper),
    ]);
    if (fr !== null) _emit('fundingRate', { symbol: symUpper, rate: fr });
    if (oi !== null) _emit('openInterest', { symbol: symUpper, value: oi });

    // 3) Connect kline WebSocket streams
    for (const tf of _timeframes) {
        _connectStream(`${symLower}@kline_${tf}`, (data) => {
            if (data.e !== 'kline' || !data.k) return;
            const k = data.k;
            const bar = {
                time: k.t / 1000,
                open: +k.o,
                high: +k.h,
                low: +k.l,
                close: +k.c,
                volume: +k.v,
                closed: k.x,  // true if candle just closed
            };
            _emit('kline', { symbol: symUpper, timeframe: tf, bar, initial: false });
            // Also emit price on every kline tick
            if (+k.c > 0) _emit('price', { symbol: symUpper, price: +k.c });
        });
    }

    // 4) Connect mark price stream (includes funding rate updates)
    _connectStream(`${symLower}@markPrice@1s`, (data) => {
        if (data.p) _emit('price', { symbol: symUpper, price: +data.p });
        if (data.r) _emit('fundingRate', { symbol: symUpper, rate: +data.r });
    });

    // 5) [BRAIN-V2] Connect aggTrade stream for order flow analysis
    _connectStream(`${symLower}@aggTrade`, (data) => {
        _emit('aggTrade', {
            symbol: symUpper,
            price: +data.p,
            qty: +data.q,
            isBuyerMaker: data.m,  // true = seller aggressor (taker sell)
            ts: data.T,
        });
    });

    logger.info('FEED', `Subscription complete for ${symUpper}`);
}

// [MULTI-SYM] Subscribe to multiple symbols sequentially
async function subscribeMulti(symbols, timeframes) {
    for (const sym of symbols) {
        await subscribe(sym, timeframes);
    }
    logger.info('FEED', `All symbols subscribed: [${[..._activeSymbols].join(',')}]`);
}

// ══════════════════════════════════════════════════════════════════
// Unsubscribe — close all streams
// ══════════════════════════════════════════════════════════════════
function unsubscribeAll() {
    for (const key of Object.keys(_streams)) {
        const entry = _streams[key];
        if (entry.timer) clearInterval(entry.timer);
        if (entry.ws) {
            entry.ws.removeAllListeners();
            if (entry.ws.readyState === WebSocket.OPEN) entry.ws.close();
        }
        delete _streams[key];
    }
    _activeSymbols.clear();  // [MULTI-SYM]
    _timeframes = [];
    logger.info('FEED', 'All streams closed');
}

// ══════════════════════════════════════════════════════════════════
// Health check — are streams alive?
// ══════════════════════════════════════════════════════════════════
function getHealth() {
    const streams = {};
    for (const [key, entry] of Object.entries(_streams)) {
        streams[key] = {
            connected: entry.ws?.readyState === WebSocket.OPEN,
            alive: entry.alive,
            reconnects: entry.reconnects,
        };
    }
    return {
        symbols: [..._activeSymbols],             // [MULTI-SYM] array of all subscribed symbols
        symbol: [..._activeSymbols][0] || null,   // backward compat: primary symbol
        timeframes: _timeframes,
        streamCount: Object.keys(_streams).length,
        streams,
    };
}

module.exports = {
    subscribe,
    subscribeMulti,    // [MULTI-SYM]
    unsubscribeAll,
    fetchKlines,
    fetchFundingRate,
    fetchOpenInterest,
    on,
    getHealth,
    STALE_DATA_MS,
};
