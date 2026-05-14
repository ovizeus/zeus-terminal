// Zeus Terminal — Liquidation Feed Aggregator (Plan A 2026-05-14)
//
// Connects 3 exchange WebSocket feeds server-side, aggregates ALL liquidation
// events (unfiltered, no $100k minimum, no dedup), buffers last 1000 per
// exchange, broadcasts each event as `liq.feed` frame via existing
// `global.__zeusWsBroadcastAll`. Eliminates client-side dependency on direct
// exchange WS connections (DNS failures, network filters).
//
// Separate concern from `liquidationFeed.js` (Market Radar, filtered $100k+ and
// 30s dedup, broadcasts `market.radar`). THIS module is for Quant Monitor
// heatmap consumption — raw, full-density data for percentile bucketing.
//
// Spec: _review/audit/LIQ_FEED_PROXY_PLAN_20260514.md
'use strict';

const WebSocket = require('ws');
const logger = require('./logger');

// ── Config ──
const BNB_URL = 'wss://fstream.binance.com/ws/!forceOrder@arr';
const BYB_URL = 'wss://stream.bybit.com/v5/public/linear';
const OKX_URL = 'wss://ws.okx.com:8443/ws/v5/public';
const RECONNECT_MIN_MS = 5000;
const RECONNECT_MAX_MS = 60000;
const PING_INTERVAL_MS = 180000;
const BYB_PING_INTERVAL_MS = 20000;
const BUFFER_SIZE = 1000;

// ── State ──
const _state = {
    bnb: { ws: null, reconnectMs: RECONNECT_MIN_MS, pingTimer: null, reconnectTimer: null, framesReceived: 0, eventsEmitted: 0, lastEventTs: 0, connected: false },
    byb: { ws: null, reconnectMs: RECONNECT_MIN_MS, pingTimer: null, reconnectTimer: null, framesReceived: 0, eventsEmitted: 0, lastEventTs: 0, connected: false },
    okx: { ws: null, reconnectMs: RECONNECT_MIN_MS, pingTimer: null, reconnectTimer: null, framesReceived: 0, eventsEmitted: 0, lastEventTs: 0, connected: false },
};
let _running = false;
let _closing = false;

// ── Ring buffer ──
const _buffer = {
    bnb: [],
    byb: [],
    okx: [],
    add(liq) {
        const arr = this[liq.exchange === 'bybit' ? 'byb' : liq.exchange === 'okx' ? 'okx' : 'bnb'];
        arr.push(liq);
        while (arr.length > BUFFER_SIZE) arr.shift();
    },
    snapshot(exchange) {
        const k = exchange === 'bybit' ? 'byb' : exchange === 'okx' ? 'okx' : 'bnb';
        return [...this[k]];
    },
    clear() {
        this.bnb.length = 0;
        this.byb.length = 0;
        this.okx.length = 0;
    },
};

// ── Normalizers (pure) ──
function _normalizeBinance(msg) {
    if (!msg || msg.e !== 'forceOrder' || !msg.o) return null;
    const o = msg.o;
    const symbol = typeof o.s === 'string' ? o.s : null;
    const side = o.S;
    if (!symbol || (side !== 'BUY' && side !== 'SELL')) return null;
    const p = parseFloat(o.ap || o.p);
    const q = parseFloat(o.q);
    if (!isFinite(p) || !isFinite(q) || p <= 0 || q <= 0) return null;
    const time = Number(o.T) || Number(msg.E) || Date.now();
    return {
        exchange: 'binance',
        symbol,
        side,
        isLong: side === 'SELL',
        p,
        q,
        vol: p * q,
        time,
    };
}

function _normalizeBybit(data) {
    if (!data) return null;
    const symbol = typeof data.symbol === 'string' ? data.symbol : null;
    const rawSide = typeof data.side === 'string' ? data.side.toLowerCase() : null;
    if (!symbol || (rawSide !== 'buy' && rawSide !== 'sell')) return null;
    const p = parseFloat(data.price);
    const q = parseFloat(data.size);
    if (!isFinite(p) || !isFinite(q) || p <= 0 || q <= 0) return null;
    // Bybit side='Buy' means a BUY trade happened — i.e. a SHORT position was
    // closed via buying back. For client convention side='SELL' = long liq.
    const side = rawSide === 'buy' ? 'SELL' : 'BUY';
    const time = Number(data.updatedTime) || Date.now();
    return {
        exchange: 'bybit',
        symbol,
        side,
        isLong: side === 'SELL',
        p,
        q,
        vol: p * q,
        time,
    };
}

function _normalizeOkx(d) {
    if (!d) return null;
    const instId = typeof d.instId === 'string' ? d.instId : null;
    if (!instId) return null;
    const symbol = instId.split('-')[0] + 'USDT';
    if (!symbol.endsWith('USDT')) return null;
    const rawSide = typeof d.side === 'string' ? d.side.toLowerCase() : null;
    if (rawSide !== 'buy' && rawSide !== 'sell') return null;
    const p = parseFloat(d.bkPx || d.markPx || 0);
    const q = parseFloat(d.sz || 0);
    if (!isFinite(p) || !isFinite(q) || p <= 0 || q <= 0) return null;
    const side = rawSide === 'sell' ? 'SELL' : 'BUY';
    const time = Number(d.ts) || Date.now();
    return {
        exchange: 'okx',
        symbol,
        side,
        isLong: side === 'SELL',
        p,
        q,
        vol: p * q,
        time,
    };
}

// ── Broadcast ──
function _broadcast(liq) {
    const fn = global.__zeusWsBroadcastAll;
    if (typeof fn !== 'function') return 0;
    try { return fn({ type: 'liq.feed', data: liq }); } catch (_) { return 0; }
}

function _emitLiq(liq) {
    _buffer.add(liq);
    _broadcast(liq);
    const s = _state[liq.exchange === 'bybit' ? 'byb' : liq.exchange === 'okx' ? 'okx' : 'bnb'];
    s.eventsEmitted++;
    s.lastEventTs = liq.time;
}

// ── WS lifecycle: BINANCE ──
function _connectBnb() {
    if (_closing) return;
    const s = _state.bnb;
    try { s.ws = new WebSocket(BNB_URL); } catch (err) {
        logger.error('LIQ-FEED', `BNB ctor failed: ${err.message}`);
        _scheduleReconnect('bnb', _connectBnb);
        return;
    }
    s.ws.on('open', () => {
        s.connected = true;
        s.reconnectMs = RECONNECT_MIN_MS;
        logger.info('LIQ-FEED', 'BNB connected — forceOrder@arr');
        s.pingTimer = setInterval(() => {
            try { if (s.ws && s.ws.readyState === WebSocket.OPEN) s.ws.ping(); } catch (_) { /* ignored */ }
        }, PING_INTERVAL_MS);
    });
    s.ws.on('message', (raw) => {
        s.framesReceived++;
        let parsed;
        try { parsed = JSON.parse(raw.toString()); } catch (_) { return; }
        const msgs = Array.isArray(parsed) ? parsed : [parsed];
        for (const m of msgs) {
            const liq = _normalizeBinance(m);
            if (liq) _emitLiq(liq);
        }
    });
    s.ws.on('error', (err) => { logger.error('LIQ-FEED', `BNB error: ${err.message}`); });
    s.ws.on('close', (code) => {
        s.connected = false;
        _clearTimers('bnb');
        if (_closing) return;
        logger.warn('LIQ-FEED', `BNB closed code=${code} — reconnect in ${s.reconnectMs}ms`);
        _scheduleReconnect('bnb', _connectBnb);
    });
}

// ── WS lifecycle: BYBIT ──
function _connectByb() {
    if (_closing) return;
    const s = _state.byb;
    try { s.ws = new WebSocket(BYB_URL); } catch (err) {
        logger.error('LIQ-FEED', `BYB ctor failed: ${err.message}`);
        _scheduleReconnect('byb', _connectByb);
        return;
    }
    s.ws.on('open', () => {
        s.connected = true;
        s.reconnectMs = RECONNECT_MIN_MS;
        logger.info('LIQ-FEED', 'BYB connected — liquidation.BTCUSDT');
        try { s.ws.send(JSON.stringify({ op: 'subscribe', args: ['liquidation.BTCUSDT'] })); } catch (_) {}
        s.pingTimer = setInterval(() => {
            try { if (s.ws && s.ws.readyState === WebSocket.OPEN) s.ws.send(JSON.stringify({ op: 'ping' })); } catch (_) {}
        }, BYB_PING_INTERVAL_MS);
    });
    s.ws.on('message', (raw) => {
        s.framesReceived++;
        let j; try { j = JSON.parse(raw.toString()); } catch (_) { return; }
        if (j && j.topic && j.topic.startsWith('liquidation') && j.data) {
            const data = Array.isArray(j.data) ? j.data : [j.data];
            for (const d of data) {
                const liq = _normalizeBybit(d);
                if (liq) _emitLiq(liq);
            }
        }
    });
    s.ws.on('error', (err) => { logger.error('LIQ-FEED', `BYB error: ${err.message}`); });
    s.ws.on('close', (code) => {
        s.connected = false;
        _clearTimers('byb');
        if (_closing) return;
        logger.warn('LIQ-FEED', `BYB closed code=${code} — reconnect in ${s.reconnectMs}ms`);
        _scheduleReconnect('byb', _connectByb);
    });
}

// ── WS lifecycle: OKX ──
function _connectOkx() {
    if (_closing) return;
    const s = _state.okx;
    try { s.ws = new WebSocket(OKX_URL); } catch (err) {
        logger.error('LIQ-FEED', `OKX ctor failed: ${err.message}`);
        _scheduleReconnect('okx', _connectOkx);
        return;
    }
    s.ws.on('open', () => {
        s.connected = true;
        s.reconnectMs = RECONNECT_MIN_MS;
        logger.info('LIQ-FEED', 'OKX connected — liquidation-orders SWAP BTC-USDT');
        try {
            s.ws.send(JSON.stringify({
                op: 'subscribe',
                args: [{ channel: 'liquidation-orders', instType: 'SWAP', instFamily: 'BTC-USDT' }],
            }));
        } catch (_) {}
    });
    s.ws.on('message', (raw) => {
        s.framesReceived++;
        let m; try { m = JSON.parse(raw.toString()); } catch (_) { return; }
        if (m && m.data && Array.isArray(m.data)) {
            for (const d of m.data) {
                const liq = _normalizeOkx(d);
                if (liq) _emitLiq(liq);
            }
        }
    });
    s.ws.on('error', (err) => { logger.error('LIQ-FEED', `OKX error: ${err.message}`); });
    s.ws.on('close', (code) => {
        s.connected = false;
        _clearTimers('okx');
        if (_closing) return;
        logger.warn('LIQ-FEED', `OKX closed code=${code} — reconnect in ${s.reconnectMs}ms`);
        _scheduleReconnect('okx', _connectOkx);
    });
}

// ── Helpers ──
function _clearTimers(ex) {
    const s = _state[ex];
    if (s.pingTimer) { clearInterval(s.pingTimer); s.pingTimer = null; }
    if (s.reconnectTimer) { clearTimeout(s.reconnectTimer); s.reconnectTimer = null; }
}

function _scheduleReconnect(ex, connectFn) {
    if (_closing) return;
    const s = _state[ex];
    _clearTimers(ex);
    s.reconnectTimer = setTimeout(() => connectFn(), s.reconnectMs);
    s.reconnectMs = Math.min(s.reconnectMs * 2, RECONNECT_MAX_MS);
}

// ── Public API ──
function start() {
    if (_running) return;
    _running = true;
    _closing = false;
    _connectBnb();
    _connectByb();
    _connectOkx();
    logger.info('LIQ-FEED', 'aggregator started (BNB + BYB + OKX)');
}

function stop() {
    _closing = true;
    for (const ex of ['bnb', 'byb', 'okx']) {
        _clearTimers(ex);
        const s = _state[ex];
        if (s.ws) { try { s.ws.close(); } catch (_) {} s.ws = null; }
        s.connected = false;
    }
    _running = false;
}

function getState() {
    return {
        running: _running,
        bnb: { connected: _state.bnb.connected, frames: _state.bnb.framesReceived, events: _state.bnb.eventsEmitted, lastEventTs: _state.bnb.lastEventTs },
        byb: { connected: _state.byb.connected, frames: _state.byb.framesReceived, events: _state.byb.eventsEmitted, lastEventTs: _state.byb.lastEventTs },
        okx: { connected: _state.okx.connected, frames: _state.okx.framesReceived, events: _state.okx.eventsEmitted, lastEventTs: _state.okx.lastEventTs },
        bufferSizes: { bnb: _buffer.bnb.length, byb: _buffer.byb.length, okx: _buffer.okx.length },
    };
}

module.exports = {
    start,
    stop,
    getState,
    _internal_for_test: {
        _normalizeBinance,
        _normalizeBybit,
        _normalizeOkx,
        _buffer,
        _broadcast,
    },
};
