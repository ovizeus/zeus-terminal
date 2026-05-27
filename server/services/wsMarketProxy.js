'use strict';

// ═══════════════════════════════════════════════════════════════
// WS Market Proxy — server-side Binance WS → client broadcast.
// Spec: docs/superpowers/specs/2026-05-28-ws-proxy-phase-b-design.md
// Plan: docs/superpowers/plans/2026-05-28-ws-proxy-B1-core.md
// ═══════════════════════════════════════════════════════════════

const _subs = new Map();       // symbol → Set<ws>
const _clientSyms = new Map(); // ws → Set<symbol>

function subscribe(ws, symbol) {
    if (!ws || !symbol) return { isNewSymbol: false };
    const sym = symbol.toUpperCase();
    if (!_subs.has(sym)) _subs.set(sym, new Set());
    const wasEmpty = _subs.get(sym).size === 0;
    const isNew = !_subs.get(sym).has(ws);
    _subs.get(sym).add(ws);
    if (!_clientSyms.has(ws)) _clientSyms.set(ws, new Set());
    _clientSyms.get(ws).add(sym);
    if (isNew) _sendCachedValues(ws, sym);
    return { isNewSymbol: wasEmpty };
}

function unsubscribe(ws, symbol) {
    if (!ws || !symbol) return { isLastSubscriber: false };
    const sym = symbol.toUpperCase();
    const set = _subs.get(sym);
    if (set) {
        set.delete(ws);
        if (set.size === 0) _subs.delete(sym);
    }
    const clientSet = _clientSyms.get(ws);
    if (clientSet) clientSet.delete(sym);
    return { isLastSubscriber: !_subs.has(sym) };
}

function unsubscribeAll(ws) {
    const syms = _clientSyms.get(ws);
    if (!syms) return [];
    const removed = [];
    for (const sym of syms) {
        const set = _subs.get(sym);
        if (set) {
            set.delete(ws);
            if (set.size === 0) { _subs.delete(sym); removed.push(sym); }
        }
    }
    _clientSyms.delete(ws);
    return removed;
}

function getSubscribers(symbol) {
    return _subs.get(symbol.toUpperCase()) || new Set();
}

function getActiveSymbols() {
    return Array.from(_subs.keys());
}

// ═══ Binance WS connection manager ═══

const WebSocket = require('ws');

const BINANCE_STREAM_BASE = 'wss://fstream.binance.com';
const PING_INTERVAL_MS = 180_000;
const RECONNECT_BASE_MS = 3000;
const RECONNECT_MAX_MS = 60000;

const _connections = new Map();  // symbol → { ws, state, reconnects, pingTimer, timeframes }
const _lastValues = new Map();   // 'symbol:streamType' → lastEvent

function _buildStreamUrl(symbol, timeframes) {
    const sym = symbol.toLowerCase();
    const streams = [
        `${sym}@markPrice@1s`,
        `${sym}@depth20@500ms`,
        ...timeframes.map(tf => `${sym}@kline_${tf}`),
        `${sym}@aggTrade`,
        '!forceOrder@arr',
    ];
    return `${BINANCE_STREAM_BASE}/stream?streams=${streams.join('/')}`;
}

function _createBinanceWs(url) {
    return new WebSocket(url);
}

function _connectSymbol(symbol, timeframes) {
    const sym = symbol.toUpperCase();
    if (_connections.has(sym)) return;

    const tfs = timeframes || ['5m', '1h', '4h'];
    const url = _buildStreamUrl(sym, tfs);
    const ws = module.exports._createBinanceWs(url);
    const conn = { ws, state: 'CONNECTING', reconnects: 0, pingTimer: null, timeframes: tfs };
    _connections.set(sym, conn);

    ws.on('open', () => {
        conn.state = 'OPEN';
        conn.reconnects = 0;
        _clearReconnectFailures(sym);
        conn.pingTimer = setInterval(() => {
            try { if (ws.readyState === WebSocket.OPEN) ws.ping(); } catch (_) {}
        }, PING_INTERVAL_MS);
    });

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw);
            _handleBinanceMessage(sym, msg);
        } catch (_) {}
    });

    ws.on('close', () => {
        conn.state = 'CLOSED';
        if (conn.pingTimer) { clearInterval(conn.pingTimer); conn.pingTimer = null; }
        if (_subs.has(sym) && _subs.get(sym).size > 0) {
            _recordReconnectFailure(sym);
            if (_isCircuitOpen(sym)) {
                conn._reconnectTimer = setTimeout(() => {
                    _connections.delete(sym);
                    _connectSymbol(sym, conn.timeframes);
                }, CB_PAUSE_MS + Math.random() * 3000);
            } else {
                const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * Math.pow(2, conn.reconnects));
                conn.reconnects++;
                conn._reconnectTimer = setTimeout(() => {
                    _connections.delete(sym);
                    _connectSymbol(sym, conn.timeframes);
                }, delay + Math.random() * 1000);
            }
        } else {
            _connections.delete(sym);
        }
    });

    ws.on('error', () => {});
}

function _disconnectSymbol(symbol) {
    const sym = symbol.toUpperCase();
    const conn = _connections.get(sym);
    if (!conn) return;
    if (conn.pingTimer) { clearInterval(conn.pingTimer); conn.pingTimer = null; }
    if (conn._reconnectTimer) { clearTimeout(conn._reconnectTimer); conn._reconnectTimer = null; }
    conn.state = 'CLOSED';
    try { conn.ws.close(); } catch (_) {}
    _connections.delete(sym);
}

function getConnectionState(symbol) {
    const conn = _connections.get(symbol.toUpperCase());
    return conn ? conn.state : 'CLOSED';
}

// ═══ Broadcast engine + last value cache ═══

function _broadcast(symbol, payload) {
    const sym = symbol.toUpperCase();
    const json = JSON.stringify(payload);
    _lastValues.set(`${sym}:${payload.type}`, payload);
    const subs = _subs.get(sym);
    if (!subs) return;
    for (const ws of subs) _safeSend(ws, json);
}

function _broadcastAll(payload) {
    const json = JSON.stringify(payload);
    if (payload.symbol) _lastValues.set(`${payload.symbol.toUpperCase()}:${payload.type}`, payload);
    for (const [, subs] of _subs) {
        for (const ws of subs) _safeSend(ws, json);
    }
}

function getLastValue(symbol, type) {
    return _lastValues.get(`${symbol.toUpperCase()}:${type}`) || null;
}

function _sendCachedValues(ws, symbol) {
    const sym = symbol.toUpperCase();
    const types = ['market.price', 'market.depth', 'market.wl'];
    for (const type of types) {
        const cached = _lastValues.get(`${sym}:${type}`);
        if (cached) {
            try { if (ws.readyState === 1) ws.send(JSON.stringify(cached)); } catch (_) {}
        }
    }
}

// ═══ Circuit breaker per stream ═══

const CB_TRIP_THRESHOLD = 5;
const CB_WINDOW_MS = 60_000;
const CB_PAUSE_MS = 30_000;
const _cbFailures = new Map(); // symbol → [{ ts }]

function _recordReconnectFailure(symbol) {
    const sym = symbol.toUpperCase();
    if (!_cbFailures.has(sym)) _cbFailures.set(sym, []);
    _cbFailures.get(sym).push({ ts: Date.now() });
    const cutoff = Date.now() - CB_WINDOW_MS;
    _cbFailures.set(sym, _cbFailures.get(sym).filter(f => f.ts > cutoff));
}

function _clearReconnectFailures(symbol) {
    _cbFailures.delete(symbol.toUpperCase());
}

function _isCircuitOpen(symbol) {
    const sym = symbol.toUpperCase();
    const failures = _cbFailures.get(sym);
    if (!failures) return false;
    const cutoff = Date.now() - CB_WINDOW_MS;
    const recent = failures.filter(f => f.ts > cutoff);
    return recent.length >= CB_TRIP_THRESHOLD;
}

function getStreamHealth(symbol) {
    const sym = symbol.toUpperCase();
    const failures = _cbFailures.get(sym) || [];
    const cutoff = Date.now() - CB_WINDOW_MS;
    const recent = failures.filter(f => f.ts > cutoff);
    return {
        reconnectFailures: recent.length,
        circuitState: recent.length >= CB_TRIP_THRESHOLD ? 'OPEN' : 'CLOSED',
    };
}

// ═══ Backpressure — safe send with buffer check ═══

const BACKPRESSURE_THRESHOLD = 128 * 1024; // 128KB buffered = skip

function _safeSend(ws, json) {
    try {
        if (!ws || ws.readyState !== 1) return false;
        if (ws.bufferedAmount > BACKPRESSURE_THRESHOLD) return false;
        ws.send(json);
        return true;
    } catch (_) {
        return false;
    }
}

// ═══ Watchlist always-on stream ═══

const WATCHLIST_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'ZECUSDT'];
let _wlWs = null;
let _wlPingTimer = null;
let _wlReconnectTimer = null;

function _buildWatchlistUrl(symbols) {
    const syms = symbols || WATCHLIST_SYMBOLS;
    const streams = syms.map(s => s.toLowerCase() + '@miniTicker').join('/');
    return `${BINANCE_STREAM_BASE}/stream?streams=${streams}`;
}

function startWatchlist(symbols) {
    if (_wlWs) return;
    const url = _buildWatchlistUrl(symbols);
    const ws = module.exports._createBinanceWs(url);
    _wlWs = ws;

    ws.on('open', () => {
        _wlPingTimer = setInterval(() => {
            try { if (ws.readyState === 1) ws.ping(); } catch (_) {}
        }, PING_INTERVAL_MS);
    });

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw);
            if (msg.data) {
                const d = msg.data;
                const sym = d.s;
                if (!sym) return;
                const price = +d.c;
                const chg = d.o && +d.o > 0 ? ((+d.c - +d.o) / +d.o * 100) : 0;
                _broadcastAll({ type: 'market.wl', symbol: sym, price, chg, ts: Date.now() });
            }
        } catch (_) {}
    });

    ws.on('close', () => {
        if (_wlPingTimer) { clearInterval(_wlPingTimer); _wlPingTimer = null; }
        _wlWs = null;
        _wlReconnectTimer = setTimeout(() => startWatchlist(symbols), 5000);
    });

    ws.on('error', () => {});
}

function stopWatchlist() {
    if (_wlPingTimer) { clearInterval(_wlPingTimer); _wlPingTimer = null; }
    if (_wlReconnectTimer) { clearTimeout(_wlReconnectTimer); _wlReconnectTimer = null; }
    if (_wlWs) { try { _wlWs.close(); } catch (_) {} _wlWs = null; }
}

function isWatchlistActive() {
    return _wlWs !== null;
}

// ═══ Client message handler (from /ws/sync) ═══

const DEFAULT_TIMEFRAMES = ['5m', '1h', '4h'];

function handleClientMessage(ws, msg) {
    if (!msg || !msg.type) return;
    const self = module.exports;
    if (msg.type === 'market.subscribe') {
        if (!msg.symbol) return;
        const result = subscribe(ws, msg.symbol);
        if (result.isNewSymbol) {
            self._connectSymbol(msg.symbol, msg.timeframes || DEFAULT_TIMEFRAMES);
        }
    } else if (msg.type === 'market.unsubscribe') {
        if (!msg.symbol) return;
        const result = unsubscribe(ws, msg.symbol);
        if (result.isLastSubscriber) {
            self._disconnectSymbol(msg.symbol);
        }
    } else if (msg.type === 'market.subscribe.wl') {
        const symbols = msg.symbols || [];
        for (const sym of symbols) subscribe(ws, sym);
    }
}

function handleClientDisconnect(ws) {
    const self = module.exports;
    const removedSymbols = unsubscribeAll(ws);
    for (const sym of removedSymbols) {
        self._disconnectSymbol(sym);
    }
}

// ═══ Binance message handler ═══

function _handleBinanceMessage(symbol, msg) {
    if (!msg || (!msg.stream && !msg.data)) return;
    const d = msg.data;
    if (!d) return;
    const stream = msg.stream || '';

    if (stream.includes('markPrice')) {
        _broadcast(symbol, {
            type: 'market.price', symbol,
            price: +d.p, fr: +d.r, frCd: +d.T, ts: Date.now(),
        });
    } else if (stream.includes('depth20')) {
        _broadcast(symbol, {
            type: 'market.depth', symbol,
            bids: (d.b || []).map(([p, q]) => ({ p: +p, q: +q })),
            asks: (d.a || []).map(([p, q]) => ({ p: +p, q: +q })),
            ts: Date.now(),
        });
    } else if (stream.includes('kline_')) {
        const k = d.k;
        if (!k) return;
        _broadcast(symbol, {
            type: 'market.kline', symbol,
            tf: k.i,
            bar: { time: Math.floor(k.t / 1000), open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v },
            closed: !!k.x, ts: Date.now(),
        });
    } else if (stream.includes('aggTrade') || stream.includes('@trade')) {
        _broadcast(symbol, {
            type: 'market.aggTrade', symbol,
            p: +d.p, q: +d.q, m: !!d.m, T: d.T, ts: Date.now(),
        });
    } else if (stream.includes('forceOrder')) {
        const o = d.o || d;
        _broadcastAll({
            type: 'market.liq', symbol: o.s || symbol,
            side: o.S, qty: +o.q, price: +o.p, exchange: 'binance', ts: Date.now(),
        });
    } else if (stream.includes('miniTicker') || stream.includes('bookTicker')) {
        const sym = d.s || symbol;
        const price = stream.includes('bookTicker') ? (+d.b + +d.a) / 2 : +d.c;
        const chg = stream.includes('bookTicker') ? 0 : ((+d.c - +d.o) / +d.o * 100);
        _broadcastAll({
            type: 'market.wl', symbol: sym,
            price, chg, ts: Date.now(),
        });
    }
}

function _resetForTest() {
    _subs.clear();
    _clientSyms.clear();
    for (const [, conn] of _connections) {
        if (conn.pingTimer) clearInterval(conn.pingTimer);
        if (conn._reconnectTimer) clearTimeout(conn._reconnectTimer);
        try { conn.ws.close(); } catch (_) {}
    }
    _connections.clear();
    _lastValues.clear();
    _cbFailures.clear();
    stopWatchlist();
}

module.exports = {
    subscribe,
    unsubscribe,
    unsubscribeAll,
    getSubscribers,
    getActiveSymbols,
    getConnectionState,
    getLastValue,
    _buildStreamUrl,
    _createBinanceWs,
    _connectSymbol,
    _disconnectSymbol,
    getStreamHealth,
    _recordReconnectFailure,
    _clearReconnectFailures,
    _isCircuitOpen,
    _safeSend,
    startWatchlist,
    stopWatchlist,
    isWatchlistActive,
    _buildWatchlistUrl,
    handleClientMessage,
    handleClientDisconnect,
    _broadcast,
    _broadcastAll,
    _handleBinanceMessage,
    _sendCachedValues,
    _resetForTest,
};
