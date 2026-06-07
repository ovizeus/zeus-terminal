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
// [LIQ-FIX 2026-06-06] OKX idle-closes at ~30s (code 4004) — ping must beat it.
const OKX_PING_INTERVAL_MS = 20000;
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
    // [LIQ-FIX 2026-06-06] Bybit DEPRECATED `liquidation.*` (live probe:
    // "error:handler not found") — replaced by `allLiquidation.*` with shape
    // {T,s,S,v,p} and INVERTED side semantics per the docs: S='Buy' means a
    // LONG position has been liquidated (old topic: Buy = short bought back).
    // Canonical convention here: side 'SELL' = long liq (matches Binance
    // forceOrder, where longs are force-SOLD). Legacy shape kept defensively.
    if (typeof data.s === 'string' && typeof data.S === 'string') {
        const symbol = data.s;
        const rawS = data.S.toLowerCase();
        if (rawS !== 'buy' && rawS !== 'sell') return null;
        const p = parseFloat(data.p);
        const q = parseFloat(data.v);
        if (!isFinite(p) || !isFinite(q) || p <= 0 || q <= 0) return null;
        const side = rawS === 'buy' ? 'SELL' : 'BUY'; // Buy=long liquidated → canonical SELL
        const time = Number(data.T) || Date.now();
        return { exchange: 'bybit', symbol, side, isLong: side === 'SELL', p, q, vol: p * q, time };
    }
    const symbol = typeof data.symbol === 'string' ? data.symbol : null;
    const rawSide = typeof data.side === 'string' ? data.side.toLowerCase() : null;
    if (!symbol || (rawSide !== 'buy' && rawSide !== 'sell')) return null;
    const p = parseFloat(data.price);
    const q = parseFloat(data.size);
    if (!isFinite(p) || !isFinite(q) || p <= 0 || q <= 0) return null;
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

// [LIQ-FIX 2026-06-06 #2] OKX wraps the liquidation fields in
// data[i].details[] (docs push example) — flatten with the parent instId so
// _normalizeOkx sees side/sz/bkPx/ts. Items without details pass through
// unchanged (defensive).
function _okxFlatten(dataArr) {
    const out = [];
    for (const d of (dataArr || [])) {
        if (!d) continue;
        if (Array.isArray(d.details) && d.details.length) {
            for (const det of d.details) {
                if (det) out.push(Object.assign({ instId: d.instId }, det));
            }
        } else {
            out.push(d);
        }
    }
    return out;
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
        // [LIQ-FIX 2026-06-06] allLiquidation replaces the deprecated
        // liquidation.* topic (Bybit rejects it: "handler not found").
        logger.info('LIQ-FEED', 'BYB connected — allLiquidation.BTCUSDT');
        try { s.ws.send(JSON.stringify({ op: 'subscribe', args: ['allLiquidation.BTCUSDT'] })); } catch (_) {}
        s.pingTimer = setInterval(() => {
            try { if (s.ws && s.ws.readyState === WebSocket.OPEN) s.ws.send(JSON.stringify({ op: 'ping' })); } catch (_) {}
        }, BYB_PING_INTERVAL_MS);
    });
    s.ws.on('message', (raw) => {
        s.framesReceived++;
        let j; try { j = JSON.parse(raw.toString()); } catch (_) { return; }
        if (j && j.topic && (j.topic.startsWith('allLiquidation') || j.topic.startsWith('liquidation')) && j.data) {
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
        logger.info('LIQ-FEED', 'OKX connected — liquidation-orders SWAP (all instruments)');
        try {
            // [LIQ-FEED OKX FIX 2026-05-14] Subscribe with instType only.
            // Previously included `instFamily: 'BTC-USDT'` care a returnat
            // close code 4004 (invalid args). instType alone subscribes la
            // ALL SWAP liquidations (multi-symbol filter applied client-side
            // in _normalizeOkx). Verified live via wscat — subscribe ack OK.
            s.ws.send(JSON.stringify({
                op: 'subscribe',
                args: [{ channel: 'liquidation-orders', instType: 'SWAP' }],
            }));
        } catch (_) {}
        // [LIQ-FIX 2026-06-06] OKX closes idle connections after ~30s with
        // code 4004 (proven: 814 reconnects today; the liquidation-orders
        // channel is sparse so silence is normal). OKX expects a literal
        // 'ping' text frame and answers 'pong'. Probe: with this ping the
        // connection stayed OPEN past 70s.
        s.pingTimer = setInterval(() => {
            try { if (s.ws && s.ws.readyState === WebSocket.OPEN) s.ws.send('ping'); } catch (_) { /* ignored */ }
        }, OKX_PING_INTERVAL_MS);
    });
    s.ws.on('message', (raw) => {
        s.framesReceived++;
        const _txt = raw.toString();
        if (_txt === 'pong') return; // OKX ping reply — not JSON
        let m; try { m = JSON.parse(_txt); } catch (_) { return; }
        if (m && m.data && Array.isArray(m.data)) {
            for (const d of _okxFlatten(m.data)) {
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

// [LIQ-FEED DIAG 2026-05-14] Periodic state log — surface frame/event
// counts every 30s pentru post-deploy verification. Cheap (1 log line/30s).
// Plus prominent warning if BNB silent >2min (datacenter network issue with
// fstream.binance.com confirmed by direct WS test — handshake OK but zero
// data flow despite REST + SPOT WS + Bybit + OKX all working).
let _diagTimer = null;
let _bnbSilentSince = Date.now();
function _startDiagLog() {
    if (_diagTimer) return;
    _diagTimer = setInterval(() => {
        const s = _state;
        logger.info('LIQ-FEED', `state | BNB[conn=${s.bnb.connected} frames=${s.bnb.framesReceived} ev=${s.bnb.eventsEmitted}] BYB[conn=${s.byb.connected} frames=${s.byb.framesReceived} ev=${s.byb.eventsEmitted}] OKX[conn=${s.okx.connected} frames=${s.okx.framesReceived} ev=${s.okx.eventsEmitted}]`);
        // Persistent BNB silence detection — known datacenter issue 2026-05-14
        if (s.bnb.framesReceived === 0 && (Date.now() - _bnbSilentSince) > 120000) {
            logger.warn('LIQ-FEED', `BNB silent >2min — datacenter network appears to block fstream.binance.com WS data flow (REST+SPOT WS work; FUTURES WS silent). Quant heatmap will populate from Bybit + OKX only until network path restored.`);
            _bnbSilentSince = Date.now(); // re-log every 2 min
        } else if (s.bnb.framesReceived > 0) {
            _bnbSilentSince = Date.now(); // reset on any successful frame
        }
    }, 30000);
    _diagTimer.unref && _diagTimer.unref();
}

// ── Public API ──
function start() {
    if (_running) return;
    _running = true;
    _closing = false;
    _connectBnb();
    _connectByb();
    _connectOkx();
    _startDiagLog();
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

// [LIQ-WARMUP 2026-06-07] New-client warmup — the ring buffer existed since
// Plan A (b114) precisely for this, but no consumer was ever wired: every
// page load started the Liquidation Overview/Monitor/Feed counters at $0
// until the next ≥threshold event happened to arrive while the page was
// open (operator-reported "toate $0"). Returns the merged buffers sorted by
// time ASC (replay order); `limit` keeps the most recent events.
function getRecent(limit = 300) {
    const all = [..._buffer.bnb, ..._buffer.byb, ..._buffer.okx]
        .sort((a, b) => (a.time || 0) - (b.time || 0));
    return limit > 0 && all.length > limit ? all.slice(all.length - limit) : all;
}

module.exports = {
    start,
    stop,
    getState,
    getRecent,
    _internal_for_test: {
        _normalizeBinance,
        _normalizeBybit,
        _normalizeOkx,
        _okxFlatten,
        _buffer,
        _broadcast,
    },
};
