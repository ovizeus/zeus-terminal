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
    _subs.get(sym).add(ws);
    if (!_clientSyms.has(ws)) _clientSyms.set(ws, new Set());
    _clientSyms.get(ws).add(sym);
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
            const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * Math.pow(2, conn.reconnects));
            conn.reconnects++;
            conn._reconnectTimer = setTimeout(() => {
                _connections.delete(sym);
                _connectSymbol(sym, conn.timeframes);
            }, delay + Math.random() * 1000);
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

function _handleBinanceMessage(_symbol, _msg) {
    // Task 3 implements full routing
}

function _resetForTest() {
    _subs.clear();
    _clientSyms.clear();
    for (const [sym, conn] of _connections) {
        if (conn.pingTimer) clearInterval(conn.pingTimer);
        if (conn._reconnectTimer) clearTimeout(conn._reconnectTimer);
        try { conn.ws.close(); } catch (_) {}
    }
    _connections.clear();
    _lastValues.clear();
}

module.exports = {
    subscribe,
    unsubscribe,
    unsubscribeAll,
    getSubscribers,
    getActiveSymbols,
    getConnectionState,
    _buildStreamUrl,
    _createBinanceWs,
    _connectSymbol,
    _disconnectSymbol,
    _resetForTest,
};
