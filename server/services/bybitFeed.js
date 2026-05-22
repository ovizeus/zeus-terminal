'use strict';

/**
 * bybitFeed — Bybit V5 WS market feed (Phase 1A connection lifecycle).
 *
 * Mirror of marketFeed.js (Binance) and liqFeedAggregator.js (Bybit liq) patterns.
 *
 * URL: wss://stream.bybit.com/v5/public/linear (REAL ws always, even for testnet
 * users — per spec Q5 decision, brain reads real prices, testnet differs only
 * at signed REST level).
 *
 * Heartbeat: send {op:'ping'} every 20s, expect {op:'pong'} (Bybit quirk vs
 * Binance ping frame).
 *
 * Reconnect: exponential backoff 1s → 60s max with grace period.
 *
 * Tasks 14-17 add: subscribe batching + per-topic retry + kline/trade/bookTicker
 * /markPrice normalizers. Task 13 is JUST connection lifecycle.
 *
 * Emits canonical events: 'kline', 'trade', 'bookTicker', 'markPrice' (Tasks 14+).
 */

const WebSocket = require('ws');
const EventEmitter = require('events');

const WS_URL = 'wss://stream.bybit.com/v5/public/linear';
const PING_INTERVAL_MS = 20_000;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;

const SYMBOLS = Object.freeze(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT']);
const TIMEFRAMES_BYBIT = Object.freeze({ '5m': '5', '1h': '60', '4h': '240' });

const _emitter = new EventEmitter();
let _ws = null;
let _connected = false;
let _running = false;
let _closing = false;
let _framesReceived = 0;
let _eventsEmitted = 0;
let _lastMessageTs = 0;
let _pingTimer = null;
let _reconnectTimer = null;
let _reconnectMs = RECONNECT_MIN_MS;

function _clearTimers() {
    if (_pingTimer) { clearInterval(_pingTimer); _pingTimer = null; }
    if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
}

function _scheduleReconnect() {
    if (_closing) return;
    _clearTimers();
    _reconnectTimer = setTimeout(() => _connect(), _reconnectMs);
    _reconnectMs = Math.min(_reconnectMs * 2, RECONNECT_MAX_MS);
    if (_reconnectTimer.unref) _reconnectTimer.unref();
}

function _connect() {
    if (_closing) return;
    try {
        _ws = new WebSocket(WS_URL);
    } catch (err) {
        try { require('./logger').error('BYBIT_FEED', `ctor failed: ${err.message}`); } catch (_) {}
        _scheduleReconnect();
        return;
    }

    _ws.on('open', () => {
        _connected = true;
        _reconnectMs = RECONNECT_MIN_MS;
        _lastMessageTs = Date.now();
        try { require('./logger').info('BYBIT_FEED', `connected to ${WS_URL}`); } catch (_) {}
        _pingTimer = setInterval(() => {
            try {
                if (_ws && _ws.readyState === WebSocket.OPEN) {
                    _ws.send(JSON.stringify({ op: 'ping' }));
                }
            } catch (_) {}
        }, PING_INTERVAL_MS);
        if (_pingTimer.unref) _pingTimer.unref();
    });

    _ws.on('message', (raw) => {
        _framesReceived++;
        _lastMessageTs = Date.now();
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
        _dispatchMessage(msg);
    });

    _ws.on('error', (err) => {
        try { require('./logger').error('BYBIT_FEED', `error: ${err.message}`); } catch (_) {}
    });

    _ws.on('close', (code) => {
        _connected = false;
        _clearTimers();
        if (_closing) return;
        try { require('./logger').warn('BYBIT_FEED', `closed code=${code}, reconnect in ${_reconnectMs}ms`); } catch (_) {}
        _scheduleReconnect();
    });
}

function _dispatchMessage(msg) {
    // Topic dispatcher — Tasks 14-17 wire kline/trade/bookTicker/markPrice
    // Handle pong here (no-op acknowledge)
    if (msg && msg.op === 'pong') return;
}

function start() {
    if (_running) return;
    _running = true;
    _closing = false;
    _connect();
}

function stop() {
    _closing = true;
    _running = false;
    _clearTimers();
    if (_ws) {
        try { _ws.close(); } catch (_) {}
        _ws = null;
    }
    _connected = false;
}

function getConnectionState() {
    return {
        url: WS_URL,
        connected: _connected,
        running: _running,
        framesReceived: _framesReceived,
        eventsEmitted: _eventsEmitted,
        lastMessageTs: _lastMessageTs,
        silentMs: _lastMessageTs ? Date.now() - _lastMessageTs : 0,
        reconnectMs: _reconnectMs,
    };
}

function on(event, handler) { _emitter.on(event, handler); }
function off(event, handler) { _emitter.off(event, handler); }

function _resetForTest() {
    _closing = true;
    _running = false;
    _clearTimers();
    if (_ws) { try { _ws.close(); } catch (_) {} _ws = null; }
    _connected = false;
    _framesReceived = 0;
    _eventsEmitted = 0;
    _lastMessageTs = 0;
    _reconnectMs = RECONNECT_MIN_MS;
    _closing = false;
    _emitter.removeAllListeners();
}

module.exports = {
    start, stop,
    on, off,
    getConnectionState,
    SYMBOLS, TIMEFRAMES_BYBIT,
    _resetForTest,
    _dispatchMessage,
};
