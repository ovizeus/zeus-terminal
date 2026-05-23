// Zeus Terminal — Liquidation Feed (Phase 11.4 extra #5)
// Maintains a single persistent WebSocket to Binance Futures'
// `!forceOrder@arr` aggregated stream, filters each force-order event to
// those with notional ≥ LIQ_NOTIONAL_MIN, and broadcasts them over the
// shared /ws/sync channel as `market.radar` frames so they render in the
// same UI bands as polled radar events.
//
// Side semantics as used by the radar band:
//   - force order side = SELL → a LONG position got liquidated (dumped into
//     the market) → bearish, category 'liqLong', color RED
//   - force order side = BUY  → a SHORT position got liquidated (bought
//     back from the market) → bullish, category 'liqShort', color GREEN
//
// Feature flag (process.env):
//   MARKET_RADAR_LIQ_ENABLED — "0" / "false" disables this feed (default:
//                              enabled). When off: no socket is opened, no
//                              frames are emitted, zero CPU cost.
//
// Isolation: this module does NOT touch trading / AT / brain / DSL state.
// Read-only consumer of Binance public data; output path is purely UI.
'use strict';

const WebSocket = require('ws');
const logger = require('./logger');
const radarCache = require('./radarCache');

// ── Env flag ──
function _envBool(name, defaultOn) {
    const raw = process.env[name];
    if (raw === undefined || raw === null || raw === '') return defaultOn;
    const v = String(raw).trim().toLowerCase();
    if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
    return true;
}
const ENABLED = _envBool('MARKET_RADAR_LIQ_ENABLED', true);

// ── Config ──
const WS_URL = 'wss://fstream.binance.com/ws/!forceOrder@arr';
const RECONNECT_MIN_MS = 5000;
const RECONNECT_MAX_MS = 60000;
const PING_INTERVAL_MS = 180000;    // 3 min (Binance closes idle sockets at 10 min)
const LIQ_NOTIONAL_MIN = 100000;    // $100k minimum to bubble up as a radar event
const PER_SYMBOL_DEDUPE_MS = 30000; // swallow repeat liqs same symbol+side within 30s

// ── State ──
let _ws = null;
let _reconnectMs = RECONNECT_MIN_MS;
let _pingTimer = null;
let _reconnectTimer = null;
let _running = false;
let _closing = false;
let _eventsEmitted = 0;
let _framesReceived = 0;
const _dedupe = new Map();  // `${symbol}:${side}` -> ts

function _broadcast(payload) {
    const fn = global.__zeusWsBroadcastAll;
    if (typeof fn !== 'function') return 0;
    try { return fn(payload); } catch (_) { return 0; }
}

function _canEmit(symbol, side, now) {
    const key = symbol + ':' + side;
    const last = _dedupe.get(key) || 0;
    if (now - last < PER_SYMBOL_DEDUPE_MS) return false;
    _dedupe.set(key, now);
    return true;
}

function _handleForceOrder(msg) {
    // Binance payload shape: { e: 'forceOrder', E: <ts>, o: { s, S, o, f, q, p, ap, X, l, z, T } }
    // Fields we need: o.s (symbol), o.S (side), o.ap (avg fill price) fallback o.p, o.q (origQty)
    if (!msg || msg.e !== 'forceOrder' || !msg.o) return;
    const o = msg.o;
    const symbol = typeof o.s === 'string' ? o.s : null;
    const side = o.S;                                  // 'BUY' | 'SELL'
    const price = parseFloat(o.ap || o.p);
    const qty = parseFloat(o.q);
    const ts = Number(o.T) || Number(msg.E) || Date.now();
    if (!symbol || !symbol.endsWith('USDT')) return;
    if (side !== 'BUY' && side !== 'SELL') return;
    if (!isFinite(price) || !isFinite(qty) || price <= 0 || qty <= 0) return;
    const notional = price * qty;
    if (notional < LIQ_NOTIONAL_MIN) return;
    if (!_canEmit(symbol, side, ts)) return;

    const category = side === 'SELL' ? 'liqLong' : 'liqShort';
    const color = side === 'SELL' ? 'red' : 'green';
    _eventsEmitted++;
    const event = {
        ts, symbol, category, color,
        price, changePct: null,
        notional,
        rank: null, quoteVolume: null,
    };
    // [Phase 11.7] push to shared cache so reconnecting clients see recent liqs
    radarCache.push(event);
    _broadcast({ type: 'market.radar', data: event });
}

function _onMessage(raw) {
    _framesReceived++;
    let parsed;
    try { parsed = JSON.parse(raw.toString()); }
    catch (_) { return; }
    // `!forceOrder@arr` emits individual forceOrder objects (not arrays),
    // one event per socket frame. Be defensive either way.
    if (Array.isArray(parsed)) {
        for (const m of parsed) _handleForceOrder(m);
    } else {
        _handleForceOrder(parsed);
    }
}

function _clearTimers() {
    if (_pingTimer) { clearInterval(_pingTimer); _pingTimer = null; }
    if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
}

function _scheduleReconnect() {
    if (_closing) return;
    _clearTimers();
    _reconnectTimer = setTimeout(() => _connect(), _reconnectMs);
    _reconnectMs = Math.min(_reconnectMs * 2, RECONNECT_MAX_MS);
}

function _connect() {
    if (_closing) return;
    try {
        _ws = new WebSocket(WS_URL);
    } catch (err) {
        logger.error('LIQ', `WebSocket ctor failed: ${err.message}`);
        _scheduleReconnect();
        return;
    }
    _ws.on('open', () => {
        _reconnectMs = RECONNECT_MIN_MS;
        logger.info('LIQ', 'liquidation feed connected');
        _pingTimer = setInterval(() => {
            try { if (_ws && _ws.readyState === WebSocket.OPEN) _ws.ping(); }
            catch (_) { /* ignored */ }
        }, PING_INTERVAL_MS);
    });
    _ws.on('message', _onMessage);
    _ws.on('error', (err) => {
        logger.error('LIQ', `socket error: ${err.message}`);
    });
    _ws.on('close', (code) => {
        _clearTimers();
        if (_closing) return;
        logger.warn('LIQ', `socket closed (code=${code}) — reconnect in ${_reconnectMs}ms`);
        _scheduleReconnect();
    });
}

function start() {
    if (_running) return;
    if (!ENABLED) {
        logger.info('LIQ', 'feed DISABLED via MARKET_RADAR_LIQ_ENABLED — no socket opened');
        return;
    }
    _running = true;
    _closing = false;
    _connect();
    // GC dedupe map every minute
    setInterval(() => {
        const cutoff = Date.now() - PER_SYMBOL_DEDUPE_MS * 4;
        for (const [k, ts] of _dedupe) if (ts < cutoff) _dedupe.delete(k);
    }, 60000).unref();
}

function stop() {
    _closing = true;
    _clearTimers();
    if (_ws) {
        try { _ws.close(); } catch (_) { /* ignored */ }
        _ws = null;
    }
    _running = false;
}

function getState() {
    return {
        enabled: ENABLED,
        running: _running,
        connected: !!_ws && _ws.readyState === WebSocket.OPEN,
        framesReceived: _framesReceived,
        eventsEmitted: _eventsEmitted,
        dedupeEntries: _dedupe.size,
        minNotionalUsd: LIQ_NOTIONAL_MIN,
    };
}

module.exports = { start, stop, getState };
