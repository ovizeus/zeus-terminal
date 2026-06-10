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
const _seqCounters = new Map();  // 'symbol:streamType' → monotonic seq number

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
        if (isFallbackActive(sym)) {
            _stopFallbackPolling(sym);
            _broadcastAll({ type: 'market.recovered', symbol: sym, mode: 'WS', ts: Date.now() });
            _triggerReconcile(sym);
        }
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
                if (!isFallbackActive(sym)) _startFallbackPolling(sym);
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

function _nextSeq(symbol, type) {
    const key = `${symbol}:${type}`;
    const n = (_seqCounters.get(key) || 0) + 1;
    _seqCounters.set(key, n);
    return n;
}

function _broadcast(symbol, payload) {
    const sym = symbol.toUpperCase();
    if (payload.type === 'market.kline' || payload.type === 'market.aggTrade') {
        payload.seq = _nextSeq(sym, payload.type);
        _pushReplay(sym, payload.type, payload.seq, payload);
    }
    const json = JSON.stringify(payload);
    _lastValues.set(`${sym}:${payload.type}`, payload);
    const subs = _subs.get(sym);
    if (!subs) return;
    for (const ws of subs) _safeSend(ws, json);
}

function _broadcastAll(payload) {
    const json = JSON.stringify(payload);
    if (payload.symbol) _lastValues.set(`${payload.symbol.toUpperCase()}:${payload.type}`, payload);
    // Iterate all WS clients on /ws/sync (not just symbol subscribers)
    // This is needed for cross-symbol events: liq, watchlist, health, degraded
    const sent = new Set();
    for (const [, subs] of _subs) {
        for (const ws of subs) {
            if (sent.has(ws)) continue;
            sent.add(ws);
            _safeSend(ws, json);
        }
    }
    // Also broadcast to global /ws/sync clients (no symbol subscriptions)
    try {
        const globalWss = global.__zeusWss;
        if (globalWss && globalWss.clients) {
            for (const ws of globalWss.clients) {
                if (sent.has(ws)) continue;
                sent.add(ws);
                _safeSend(ws, json);
            }
        }
    } catch (_) {}
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

// ═══ Health monitor — per-symbol event tracking + staleness ═══

const HEALTH_LIVE_THRESHOLD_MS = 10_000;
const HEALTH_DEGRADED_THRESHOLD_MS = 60_000;
const HEALTH_STUCK_THRESHOLD_MS = 30_000;
const _healthState = new Map(); // symbol → { lastEventTs, lastChangeTs, lastValue, eventsCount }

function _recordEvent(symbol, streamType, value) {
    const sym = symbol.toUpperCase();
    const now = Date.now();
    if (!_healthState.has(sym)) {
        _healthState.set(sym, { lastEventTs: now, lastChangeTs: now, lastValue: value, eventsCount: 1 });
        return;
    }
    const h = _healthState.get(sym);
    h.lastEventTs = now;
    h.eventsCount++;
    if (value !== undefined && value !== h.lastValue) {
        h.lastChangeTs = now;
        h.lastValue = value;
    }
}

function _recordEventAt(symbol, streamType, value, eventTs, changeTs) {
    const sym = symbol.toUpperCase();
    if (!_healthState.has(sym)) {
        _healthState.set(sym, { lastEventTs: eventTs, lastChangeTs: changeTs || eventTs, lastValue: value, eventsCount: 1 });
        return;
    }
    const h = _healthState.get(sym);
    h.lastEventTs = eventTs;
    h.eventsCount++;
    if (changeTs !== null && changeTs !== undefined) {
        h.lastChangeTs = changeTs;
    }
    if (value !== undefined) h.lastValue = value;
}

function _computeStatus(symbol) {
    const sym = symbol.toUpperCase();
    const h = _healthState.get(sym);
    if (!h) return 'OFFLINE';
    const now = Date.now();
    const age = now - h.lastEventTs;
    if (age > HEALTH_DEGRADED_THRESHOLD_MS) return 'OFFLINE';
    const stuckAge = now - (h.lastChangeTs || 0);
    if (stuckAge > HEALTH_STUCK_THRESHOLD_MS && age < HEALTH_LIVE_THRESHOLD_MS) return 'STUCK';
    if (age > HEALTH_LIVE_THRESHOLD_MS) return 'DEGRADED';
    return 'LIVE';
}

function getHealthSnapshot() {
    const streams = {};
    let hasNonLive = false;
    for (const [sym, h] of _healthState) {
        const status = _computeStatus(sym);
        if (status !== 'LIVE') hasNonLive = true;
        streams[sym] = {
            status,
            lastEventTs: h.lastEventTs,
            lastChangeTs: h.lastChangeTs,
            eventsCount: h.eventsCount,
            subscribers: (_subs.get(sym) || new Set()).size,
        };
    }
    return { streams, overall: hasNonLive ? 'DEGRADED' : 'HEALTHY', crossExchange: getAllCrossExchangeDivergences() };
}

// ═══ Health-state GC — TTL sweep for the otherwise-unbounded _healthState map ═══
// Entries are created on first event per symbol and never evicted, so the map
// grows with every unique symbol any client ever touched. Evict entries whose
// symbol has NO active subscription AND whose last event is older than 1h.
const HEALTH_GC_MAX_AGE_MS = 60 * 60 * 1000;
const HEALTH_GC_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

function _healthStateSweep(now = Date.now()) {
    // try/catch: a corrupted entry must never crash a GC tick on the live process.
    try {
        for (const [sym, h] of _healthState) {
            const hasActiveSub = _subs.has(sym) && _subs.get(sym).size > 0;
            if (hasActiveSub) continue;
            if (!h || (h.lastEventTs || 0) < now - HEALTH_GC_MAX_AGE_MS) {
                _healthState.delete(sym);
            }
        }
    } catch (_) { /* never throw from a GC tick */ }
}

function _getHealthStateStatsForTest() {
    return { healthState: _healthState.size };
}

const _healthGcTimer = setInterval(() => _healthStateSweep(), HEALTH_GC_SWEEP_INTERVAL_MS);
if (_healthGcTimer.unref) _healthGcTimer.unref();

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
    const h = _healthState.get(sym) || {};
    return {
        reconnectFailures: recent.length,
        circuitState: recent.length >= CB_TRIP_THRESHOLD ? 'OPEN' : 'CLOSED',
        status: _computeStatus(sym),
        lastEventTs: h.lastEventTs || 0,
        lastChangeTs: h.lastChangeTs || 0,
        lastValue: h.lastValue !== undefined ? h.lastValue : null,
        eventsCount: h.eventsCount || 0,
        subscribers: (_subs.get(sym) || new Set()).size,
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

// REST fallback poller — Hetzner blocks miniTicker WS, so we poll ticker/24hr every 10s
const WATCHLIST_POLL_MS = 10_000;
let _wlPollTimer = null;

async function _pollWatchlistREST() {
    try { require('./logger').info('WS_PROXY', `Watchlist poll tick — wss clients: ${global.__zeusWss?.clients?.size || 0}, subs: ${_subs.size}`); } catch(_) {}
    for (const sym of WATCHLIST_SYMBOLS) {
        try {
            // [Phase A / Task A2] Route through gateway (rate-limiter + circuit-breaker
            // + ban gate) instead of raw fetch — never hammer a banned IP.
            const res = await require('./binanceGateway').fetch(
                `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${sym}`,
                { signal: AbortSignal.timeout(8000), __weight: 1, __src: 'wsproxy-watchlist' }
            );
            if (!res || !res.ok) continue;
            const t = await res.json();
            if (!t || !t.symbol) continue;
            const price = parseFloat(t.lastPrice);
            const chg = parseFloat(t.priceChangePercent);
            if (Number.isFinite(price) && price > 0) {
                _broadcastAll({ type: 'market.wl', symbol: t.symbol, price, chg: Number.isFinite(chg) ? chg : 0, ts: Date.now() });
            }
        } catch (_) {}
    }
}

// [LAG-FIX 2026-05-31] The proxy's per-symbol upstream is Binance fstream, which Hetzner
// BLOCKS (frames=0) → no live prices to relay → the client's WS_PROXY price path is frozen
// until an HTTP refresh. Bridge the server's FRESH marketFeed prices (fed by the 3s REST
// ticker poller) onto /ws/sync as market.price so the client stays live without fstream.
let _priceBridgeWired = false;
function _wirePriceBridge() {
    if (_priceBridgeWired) return;
    try {
        const marketFeed = require('./marketFeed');
        marketFeed.on('price', (d) => {
            if (d && d.symbol && Number.isFinite(d.price) && d.price > 0) {
                // [LAG-FIX] _broadcastAll (not _broadcast) — the client connects to /ws/sync but
                // _subs.size is observed 0 (it may not register a per-symbol market.subscribe in
                // the deployed build). _broadcastAll reaches every connected /ws/sync client; the
                // client already filters market.price by its own symbol. Guarantees fresh price
                // delivery → clears the client DATA_STALL/AT-paused gate without a client rebuild.
                try { _broadcastAll({ type: 'market.price', symbol: d.symbol, price: d.price, ts: Date.now() }); } catch (_) {}
            }
        });
        _priceBridgeWired = true;
        try { require('./logger').info('WS_PROXY', 'Price bridge wired: marketFeed price → /ws/sync market.price (fstream-independent)'); } catch (_) {}
    } catch (_) { /* marketFeed not ready — retry on next start */ }
}

function startWatchlistREST() {
    _wirePriceBridge();
    if (_wlPollTimer) return;
    // [BOOT-STAGGER A 2026-06-05] First poll fired at t=0ms (8 parallel
    // ticker calls), synchronized with quant poller + klines-init + recovery
    // → boot burst → 418-ban class incidents. Deterministic jitter spreads
    // the first fire; interval starts after it (same pattern as marketRadar).
    const jitterMs = require('../utils/bootJitter').bootJitter('wsproxy.watchlist');
    try { require('./logger').info('WS_PROXY', `Watchlist REST poller starting in ${Math.round(jitterMs / 1000)}s (boot jitter) — 10s for ${WATCHLIST_SYMBOLS.join(',')}`); } catch (_) {}
    _wlPollTimer = setTimeout(() => {
        _pollWatchlistREST().then(() => {
            try { require('./logger').info('WS_PROXY', 'Watchlist first poll complete'); } catch (_) {}
        }).catch(e => {
            try { require('./logger').error('WS_PROXY', `Watchlist poll error: ${e.message}`); } catch (_) {}
        });
        _wlPollTimer = setInterval(_pollWatchlistREST, WATCHLIST_POLL_MS);
    }, jitterMs);
}

function stopWatchlistREST() {
    if (_wlPollTimer) { clearInterval(_wlPollTimer); _wlPollTimer = null; }
}

// ═══ Quant data poller — funding + OI via REST into cache ═══

const QUANT_POLL_MS = 60_000;
const QUANT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'];
let _quantPollTimer = null;

async function _pollQuantData() {
    try {
        const mc = require('./marketCache');

        for (const sym of QUANT_SYMBOLS) {
            try {
                const frRes = await require('./binanceGateway').fetch(
                    `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${sym}`,
                    { signal: AbortSignal.timeout(8000), __weight: 1, __src: 'wsproxy-quant' }
                );
                if (frRes && frRes.ok) {
                    const d = await frRes.json();
                    if (d && d.lastFundingRate) {
                        mc.set('funding', 'binance:' + sym, {
                            rate: +d.lastFundingRate,
                            markPrice: d.markPrice ? +d.markPrice : 0,
                            indexPrice: d.indexPrice ? +d.indexPrice : 0,
                            nextFundingTime: d.nextFundingTime || 0,
                            ts: Date.now(),
                        }, { caller: 'marketRadar' });
                        recordCrossExchangePrice(sym, 'binance', +d.markPrice);
                    }
                }
            } catch (_) {}

            try {
                const oiRes = await require('./binanceGateway').fetch(
                    `https://fapi.binance.com/fapi/v1/openInterest?symbol=${sym}`,
                    { signal: AbortSignal.timeout(8000), __weight: 1, __src: 'wsproxy-quant' }
                );
                if (oiRes && oiRes.ok) {
                    const d = await oiRes.json();
                    if (d && d.openInterest != null) {
                        // [OIFIX] The marketCache 'oi' validator requires a plain
                        // number (typeof === 'number'). The old { value, ts }
                        // object was rejected (reject_schema) on every 60s poll —
                        // this writer never landed (only marketRadar's number
                        // write did). Store the number, matching marketRadar.
                        const oiNum = +d.openInterest;
                        if (Number.isFinite(oiNum)) {
                            mc.set('oi', 'binance:' + sym, oiNum, { caller: 'marketRadar' });
                        }
                    }
                }
            } catch (_) {}
        }
    } catch (_) {}
}

function startQuantPoller() {
    if (_quantPollTimer) return;
    // [BOOT-STAGGER A 2026-06-05] Same jitter treatment as the watchlist
    // poller (distinct key → distinct deterministic offset, no collision).
    const jitterMs = require('../utils/bootJitter').bootJitter('wsproxy.quant');
    console.log(`[WS_PROXY] Quant poller starting in ${Math.round(jitterMs / 1000)}s (boot jitter) — funding+OI every 60s for`, QUANT_SYMBOLS.join(','));
    _quantPollTimer = setTimeout(() => {
        _pollQuantData().then(() => console.log('[WS_PROXY] Quant first poll complete')).catch(e => console.error('[WS_PROXY] Quant first poll error:', e.message));
        _quantPollTimer = setInterval(_pollQuantData, QUANT_POLL_MS);
    }, jitterMs);
}

function stopQuantPoller() {
    if (_quantPollTimer) { clearInterval(_quantPollTimer); _quantPollTimer = null; }
}

// ═══ Protocol versioning + correlation IDs (B.16) ═══

const PROTOCOL_VERSION = '1.0';
const PROTOCOL_MIN_SUPPORTED = '1.0';
let _corrIdCounter = 0;

function generateCorrId() {
    return `ws-${Date.now().toString(36)}-${(++_corrIdCounter).toString(36)}`;
}

function handleHello(ws, msg) {
    const clientVersion = msg.protocolVersion || '0.0';
    const compatible = clientVersion >= PROTOCOL_MIN_SUPPORTED;
    const response = {
        type: 'hello.ack',
        protocolVersion: PROTOCOL_VERSION,
        minSupported: PROTOCOL_MIN_SUPPORTED,
        compatible,
        serverBuild: process.env.npm_package_version || 'dev',
        ts: Date.now(),
    };
    _safeSend(ws, JSON.stringify(response));
    if (!compatible) {
        _safeSend(ws, JSON.stringify({ type: 'force_refresh', reason: 'protocol_mismatch', clientVersion, minSupported: PROTOCOL_MIN_SUPPORTED }));
    }
    return { compatible };
}

// ═══ Replay buffer (B.15) ═══

const REPLAY_BUFFER_SIZE = 100;
const _replayBuffers = new Map(); // 'symbol:type' → Array<{seq, payload}>

function _pushReplay(symbol, type, seq, payload) {
    if (!seq) return;
    const key = `${symbol}:${type}`;
    if (!_replayBuffers.has(key)) _replayBuffers.set(key, []);
    const buf = _replayBuffers.get(key);
    buf.push({ seq, payload, ts: Date.now() });
    if (buf.length > REPLAY_BUFFER_SIZE) buf.shift();
}

function getReplay(symbol, type, afterSeq) {
    const key = `${symbol.toUpperCase()}:${type}`;
    const buf = _replayBuffers.get(key);
    if (!buf || !buf.length) return [];
    if (!afterSeq) return buf.slice(-10);
    return buf.filter(e => e.seq > afterSeq);
}

function handleReplayRequest(ws, msg) {
    if (!msg || msg.type !== 'market.replay') return;
    const { symbol, streamType, afterSeq } = msg;
    if (!symbol || !streamType) return;
    const events = getReplay(symbol, streamType, afterSeq || 0);
    for (const e of events) {
        _safeSend(ws, JSON.stringify(e.payload));
    }
}

// ═══ Cross-exchange sanity check (B.14) ═══

const _crossExchangePrices = new Map(); // symbol → { binance, bybit, ts }
const CROSS_WARN_PCT = 0.5;
const CROSS_STALE_PCT = 2.0;

function recordCrossExchangePrice(symbol, exchange, price) {
    const sym = symbol.toUpperCase();
    if (!_crossExchangePrices.has(sym)) _crossExchangePrices.set(sym, { binance: 0, bybit: 0, ts: 0 });
    const entry = _crossExchangePrices.get(sym);
    entry[exchange] = price;
    entry.ts = Date.now();
}

function getCrossExchangeDivergence(symbol) {
    const sym = symbol.toUpperCase();
    const entry = _crossExchangePrices.get(sym);
    if (!entry || !entry.binance || !entry.bybit) return null;
    if (Date.now() - entry.ts > 30000) return null;
    const div = Math.abs(entry.binance - entry.bybit) / entry.binance * 100;
    return {
        symbol: sym,
        binancePrice: entry.binance,
        bybitPrice: entry.bybit,
        divergencePct: div,
        warn: div > CROSS_WARN_PCT,
        stale: div > CROSS_STALE_PCT,
    };
}

function getAllCrossExchangeDivergences() {
    const out = [];
    for (const sym of _crossExchangePrices.keys()) {
        const d = getCrossExchangeDivergence(sym);
        if (d) out.push(d);
    }
    return out;
}

// ═══ Shadow validation — 1% sample dual-stream XOR (B.13) ═══

const SHADOW_SAMPLE_PCT = 1;
const _shadowClients = new WeakSet();
const _shadowDivergences = [];
const SHADOW_MAX_LOG = 200;

function shouldShadow(ws) {
    if (_shadowClients.has(ws)) return true;
    if (Math.random() * 100 < SHADOW_SAMPLE_PCT) {
        _shadowClients.add(ws);
        return true;
    }
    return false;
}

function recordShadowDivergence(entry) {
    _shadowDivergences.push({ ...entry, ts: Date.now() });
    if (_shadowDivergences.length > SHADOW_MAX_LOG) _shadowDivergences.shift();
}

function getShadowReport() {
    const total = _shadowDivergences.length;
    const recent = _shadowDivergences.filter(d => Date.now() - d.ts < 3600_000);
    const maxDiv = recent.reduce((m, d) => Math.max(m, Math.abs(d.divergencePct || 0)), 0);
    return { total, recent: recent.length, maxDivergencePct: maxDiv, entries: recent.slice(-10) };
}

// ═══ Graceful shutdown (B.10) ═══

const SHUTDOWN_GRACE_MS = 5000;
let _shutdownInProgress = false;

function initiateShutdown(wss) {
    if (_shutdownInProgress) return;
    _shutdownInProgress = true;
    try { console.log('[WS_PROXY] SHUTDOWN_INITIATED — broadcasting grace period'); } catch (_) {}

    const msg = JSON.stringify({ type: 'server.shutdown', graceMs: SHUTDOWN_GRACE_MS, ts: Date.now() });
    if (wss && wss.clients) {
        wss.clients.forEach(ws => {
            try { if (ws.readyState === 1) ws.send(msg); } catch (_) {}
        });
    }

    for (const [sym, conn] of _connections) {
        if (conn.pingTimer) { clearInterval(conn.pingTimer); conn.pingTimer = null; }
        try { conn.ws.close(); } catch (_) {}
    }
    _connections.clear();
    stopWatchlist();

    try { console.log('[WS_PROXY] SHUTDOWN_COMPLETE — all streams closed'); } catch (_) {}
}

function isShuttingDown() {
    return _shutdownInProgress;
}

// ═══ Forced reconcile on WS recovery (B.9) ═══

async function _triggerReconcile(symbol) {
    const sym = symbol.toUpperCase();
    try {
        const logger = require('./logger');
        const serverAT = require('./serverAT');
        const exchangeOps = require('./exchangeOps');
        const db = require('./database');

        logger.info('WS_PROXY', `[RECONCILE] START ${sym} — WS recovered, forcing position+balance sync`);

        const users = db.db.prepare(`SELECT DISTINCT user_id FROM exchange_accounts WHERE is_active=1`).all();

        for (const { user_id: uid } of users) {
            try {
                const positions = await exchangeOps.getPositions(uid, { symbol: sym });
                const balance = await exchangeOps.getBalance(uid);

                const posCount = Array.isArray(positions) ? positions.length : 0;
                const bal = balance && balance.walletBalance ? parseFloat(balance.walletBalance) : 0;

                logger.info('WS_PROXY', `[RECONCILE] uid=${uid} ${sym}: ${posCount} positions, balance=$${bal.toFixed(2)}`);

                try {
                    db.auditLog(uid, 'WS_RECOVERY_RECONCILE_COMPLETE', {
                        symbol: sym, posCount, balance: bal, ts: Date.now(),
                    }, '127.0.0.1');
                } catch (_) {}
            } catch (err) {
                try {
                    const logger2 = require('./logger');
                    logger2.warn('WS_PROXY', `[RECONCILE] uid=${uid} ${sym} FAILED: ${err.message}`);
                } catch (_) {}
            }
        }
    } catch (err) {
        try { console.error('[WS_PROXY] reconcile error:', err.message); } catch (_) {}
    }
}

// ═══ Stale data detection (trade blocker B.8) ═══

const STALE_THRESHOLD_MS = 10_000;

const _staleBroadcasted = new Set();

function _checkAndBroadcastStale() {
    for (const [sym] of _subs) {
        const stale = isSymbolStale(sym);
        const wasStale = _staleBroadcasted.has(sym);
        if (stale && !wasStale) {
            _staleBroadcasted.add(sym);
            _broadcastAll({ type: 'market.stale', symbol: sym, staleness_ms: getStalenessMs(sym), ts: Date.now() });
        } else if (!stale && wasStale) {
            _staleBroadcasted.delete(sym);
            _broadcastAll({ type: 'market.fresh', symbol: sym, ts: Date.now() });
        }
    }
}

function isSymbolStale(symbol) {
    const sym = symbol.toUpperCase();
    const h = _healthState.get(sym);
    if (!h) return true;
    return (Date.now() - h.lastEventTs) > STALE_THRESHOLD_MS;
}

function getStalenessMs(symbol) {
    const sym = symbol.toUpperCase();
    const h = _healthState.get(sym);
    if (!h) return Infinity;
    return Date.now() - h.lastEventTs;
}

// ═══ Fallback REST polling ═══

const FALLBACK_POLL_MS = 5000;
const _fallbackTimers = new Map(); // symbol → intervalId

function _checkFallbackNeeded(symbol) {
    const status = _computeStatus(symbol.toUpperCase());
    return status === 'OFFLINE' || status === 'DEGRADED';
}

function _startFallbackPolling(symbol) {
    const sym = symbol.toUpperCase();
    if (_fallbackTimers.has(sym)) return;

    const poll = async () => {
        try {
            const gateway = require('./binanceGateway');
            const klineRes = await gateway.fetch(
                `https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=5m&limit=1`,
                { __weight: 1, __src: 'wsFallback' }
            );
            if (klineRes && klineRes.ok) {
                const data = await klineRes.json();
                if (Array.isArray(data) && data.length) {
                    const k = data[0];
                    _broadcast(sym, {
                        type: 'market.kline', symbol: sym, tf: '5m',
                        bar: { time: Math.floor(k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] },
                        closed: false, ts: Date.now(), _fallback: true,
                    });
                    _recordEvent(sym, 'price', +k[4]);
                }
            }
        } catch (_) {}
    };

    _fallbackTimers.set(sym, setInterval(poll, FALLBACK_POLL_MS));
    poll();
    _broadcastAll({ type: 'market.degraded', symbol: sym, mode: 'REST', reason: 'WS offline >60s', ts: Date.now() });
}

function _stopFallbackPolling(symbol) {
    const sym = symbol.toUpperCase();
    const timer = _fallbackTimers.get(sym);
    if (timer) { clearInterval(timer); _fallbackTimers.delete(sym); }
}

function isFallbackActive(symbol) {
    return _fallbackTimers.has(symbol.toUpperCase());
}

function getFallbackStatus() {
    const out = {};
    for (const sym of _fallbackTimers.keys()) out[sym] = true;
    return out;
}

// ═══ Rate limiting + quotas ═══

const MAX_SUBSCRIBES_PER_SEC = 10;
const MAX_SYMBOLS_PER_CLIENT = 20;
const _rateCounters = new Map(); // ws → { count, resetTs }

function _checkRateLimit(ws) {
    const now = Date.now();
    if (!_rateCounters.has(ws)) _rateCounters.set(ws, { count: 0, resetTs: now + 1000 });
    const rc = _rateCounters.get(ws);
    if (now > rc.resetTs) { rc.count = 0; rc.resetTs = now + 1000; }
    rc.count++;
    return rc.count <= MAX_SUBSCRIBES_PER_SEC;
}

function _resetRateLimit(ws) {
    _rateCounters.delete(ws);
}

function getClientSymbolCount(ws) {
    const syms = _clientSyms.get(ws);
    return syms ? syms.size : 0;
}

// ═══ Client message handler (from /ws/sync) ═══

const DEFAULT_TIMEFRAMES = ['5m', '1h', '4h'];

function handleClientMessage(ws, msg) {
    if (!msg || !msg.type) return;
    const self = module.exports;
    if (msg.type === 'hello') {
        handleHello(ws, msg);
        return;
    }
    if (msg.type === 'market.subscribe') {
        if (!msg.symbol) return;
        if (!_checkRateLimit(ws)) return { ok: false, reason: 'rate_limited' };
        if (getClientSymbolCount(ws) >= MAX_SYMBOLS_PER_CLIENT) return { ok: false, reason: 'max_symbols_exceeded' };
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
    } else if (msg.type === 'market.replay') {
        handleReplayRequest(ws, msg);
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
        const price = +d.p;
        _recordEvent(symbol, 'price', price);
        recordCrossExchangePrice(symbol, 'binance', price);
        _checkAndBroadcastStale();
        _broadcast(symbol, {
            type: 'market.price', symbol,
            price, fr: +d.r, frCd: +d.T, ts: Date.now(),
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
    _seqCounters.clear();
    _cbFailures.clear();
    _healthState.clear();
    _rateCounters.clear();
    _staleBroadcasted.clear();
    _shutdownInProgress = false;
    _crossExchangePrices.clear();
    _shadowDivergences.length = 0;
    _replayBuffers.clear();
    for (const timer of _fallbackTimers.values()) clearInterval(timer);
    _fallbackTimers.clear();
    stopQuantPoller();
    stopWatchlistREST();
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
    getHealthSnapshot,
    _recordEvent,
    _recordEventAt,
    _healthStateSweep,
    _getHealthStateStatsForTest,
    _recordReconnectFailure,
    _clearReconnectFailures,
    _isCircuitOpen,
    _safeSend,
    startWatchlist,
    stopWatchlist,
    isWatchlistActive,
    startWatchlistREST,
    stopWatchlistREST,
    _buildWatchlistUrl,
    startQuantPoller,
    stopQuantPoller,
    PROTOCOL_VERSION,
    generateCorrId,
    handleHello,
    getReplay,
    handleReplayRequest,
    recordCrossExchangePrice,
    getCrossExchangeDivergence,
    getAllCrossExchangeDivergences,
    shouldShadow,
    recordShadowDivergence,
    getShadowReport,
    initiateShutdown,
    isShuttingDown,
    isSymbolStale,
    getStalenessMs,
    _triggerReconcile,
    _checkFallbackNeeded,
    _startFallbackPolling,
    _stopFallbackPolling,
    isFallbackActive,
    getFallbackStatus,
    getClientSymbolCount,
    _resetRateLimit,
    handleClientMessage,
    handleClientDisconnect,
    _broadcast,
    _broadcastAll,
    _handleBinanceMessage,
    _sendCachedValues,
    _resetForTest,
};
