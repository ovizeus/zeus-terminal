// Zeus Terminal — Server Market Feed (Phase 2)
// Connects to Binance Futures WebSocket streams + REST fallback.
// Populates server-side state (SD) with live market data.
// Gated by MF.SERVER_MARKET_DATA flag.
'use strict';

const Sentry = require('@sentry/node');
const WebSocket = require('ws');
const logger = require('./logger');
const MF = require('../migrationFlags');

// ── Config ──
const BINANCE_WS = 'wss://fstream.binance.com/ws';
const BINANCE_REST = 'https://fapi.binance.com';
// [CFG-11 2026-05-13] Env-overridable feed tuning. Defaults preserved pentru
// zero behavior change. Override prin env pentru tuning operational fără
// rebuild — ex. STALE_DATA_MS=180000 pentru toleranță mai mare la network jitter.
const RECONNECT_MS = parseInt(process.env.FEED_RECONNECT_MS, 10) || 5000;            // reconnect delay
const MAX_RECONNECT_MS = parseInt(process.env.FEED_MAX_RECONNECT_MS, 10) || 60000;   // max backoff
const PING_INTERVAL_MS = parseInt(process.env.FEED_PING_INTERVAL_MS, 10) || 180000;  // 3min ping (Binance times out at 5min)
const KLINE_HISTORY = parseInt(process.env.FEED_KLINE_HISTORY, 10) || 200;           // initial candle fetch count
const STALE_DATA_MS = parseInt(process.env.FEED_STALE_DATA_MS, 10) || 120000;        // 2min data staleness threshold

// [BIN-TELEM 2026-05-19] lazy-require telemetry wrapper
let _telem = null;
function _getTelem() {
    if (_telem === null) {
        try { _telem = require('./binanceTelemetry'); } catch (_) { _telem = false; }
    }
    return _telem || null;
}
async function _telemFetch(url, opts) {
    // [Phase 2] Route through gateway (rateLimiter + circuitBreaker integrated)
    try { return await require('./binanceGateway').fetch(url, opts); }
    catch (_) { return fetch(url, opts); }
}

// ── Active streams ──
const _streams = {};    // { streamKey: { ws, reconnects, timer, alive } }
const _activeSymbols = new Set();  // [MULTI-SYM] all subscribed symbols (uppercase)
let _timeframes = [];   // active timeframes ['5m', '1h', '4h']

// ── [Phase 2 S3.1d] ALT_WS_FEEDS poller state ──
// When the primary lane (kline / markPrice / aggTrade) is dead, we poll klines
// via REST at ALT_KLINE_POLL_MS and derive price + kline events locally.
// bookTicker/trade streams take over price + aggTrade emission.
const ALT_KLINE_POLL_MS = 60000;    // 60s — Binance kline WS blocked on this IP; REST polls at 60s = 12 req/min (was 30s=24, caused 418 IP ban cycle)
const _altKlinePollers = {};        // { 'BTCUSDT|5m': { timer, lastOpenTs } }

// [BIN-TELEM Phase B 2026-05-19] Ref-counting for symbol subscriptions.
// Each symbol holds a Set of refKeys. refKey = "userId|env|posSeq" for
// position-driven subs, "boot|system" for sticky boot symbols.
// When a symbol's Set becomes empty (and contains no boot|system ref),
// fully unsubscribe the symbol (close WS + clear ALT pollers).
const _symbolRefs = new Map();  // symbol -> Set<refKey>

function _addRef(symbol, refKey) {
    const sym = String(symbol).toUpperCase();
    if (!_symbolRefs.has(sym)) _symbolRefs.set(sym, new Set());
    _symbolRefs.get(sym).add(refKey);
}

function _releaseRefByKey(refKey) {
    // Remove refKey from every symbol's Set; return list of symbols whose
    // Set became empty (or only contains zero non-boot refs). The
    // 'boot|system' refKey is sticky by data-structure invariant — never
    // removable by this function regardless of caller intent.
    if (refKey === 'boot|system') return [];
    const emptied = [];
    for (const [sym, refs] of _symbolRefs) {
        if (refs.delete(refKey)) {
            if (refs.size === 0) emptied.push(sym);
        }
    }
    return emptied;
}

function _hasSymbolRef(symbol) {
    const refs = _symbolRefs.get(String(symbol).toUpperCase());
    return !!(refs && refs.size > 0);
}

function _refCount(symbol) {
    const refs = _symbolRefs.get(String(symbol).toUpperCase());
    return refs ? refs.size : 0;
}

// [BIN-TELEM Phase B 2026-05-19] Pluggable subscribe/unsubscribe for tests.
let _subscribeFn = null;          // override default subscribe(symbol, timeframes)
let _unsubscribeSymbolFn = null;  // override default _unsubscribeSymbolReal(symbol)

async function subscribeForRef(symbol, refKey, timeframes) {
    const sym = String(symbol).toUpperCase();
    const had = _symbolRefs.has(sym) && _symbolRefs.get(sym).has(refKey);
    if (had) return false;
    _addRef(sym, refKey);
    // First ref for this symbol → trigger actual subscribe.
    // If subscribe throws on first-ref path, rollback ref so caller can retry
    // (otherwise the symbol is permanently marked subscribed with no underlying
    // connection and retry returns false on duplicate).
    if (_symbolRefs.get(sym).size === 1) {
        const fn = _subscribeFn || subscribe;
        try {
            await fn(sym, timeframes);
        } catch (err) {
            logger.warn('FEED', `[refcount] subscribe ${sym} for ${refKey} failed: ${err.message}`);
            _releaseRefByKey(refKey);
            return false;
        }
    }
    return true;
}

function releaseRef(refKey) {
    const emptied = _releaseRefByKey(refKey);
    for (const sym of emptied) {
        const fn = _unsubscribeSymbolFn || _unsubscribeSymbolReal;
        try { fn(sym); } catch (err) {
            logger.warn('FEED', `[refcount] unsubscribe ${sym} failed: ${err.message}`);
        }
    }
    return emptied;
}

// [BIN-TELEM Phase B 2026-05-19] Orphan sweep — defensive cleanup.
// _closePosition already releases refs on normal close paths, but
// reconciliation gaps, crashes, missed events, or restarts may leave
// dangling refs. Sweep queries DB for each refKey "uid|env|seq" — if
// seq is not OPEN in at_positions, release the ref.
function _sweepOrphanRefs(db) {
    if (!db || typeof db.prepare !== 'function') return [];
    const released = [];
    const stmt = db.prepare("SELECT COUNT(*) as c FROM at_positions WHERE seq=? AND status='OPEN'");
    // Snapshot keys first — releaseRef mutates _symbolRefs
    const allRefs = new Set();
    for (const refs of _symbolRefs.values()) for (const k of refs) allRefs.add(k);
    for (const refKey of allRefs) {
        if (refKey === 'boot|system') continue;  // sticky
        const parts = refKey.split('|');
        if (parts.length !== 3) continue;        // malformed → skip defensive
        const seq = parseInt(parts[2], 10);
        if (!Number.isFinite(seq)) continue;
        try {
            const row = stmt.get(seq);
            if (!row || row.c === 0) {
                releaseRef(refKey);
                released.push(refKey);
            }
        } catch (e) {
            logger.warn('FEED', `[refcount] sweep error refKey=${refKey}: ${e.message}`);
        }
    }
    if (released.length > 0) logger.info('FEED', `[refcount] orphan sweep released ${released.length} refs: ${released.join(',')}`);
    return released;
}

let _sweepTimer = null;
function startOrphanSweep(db, intervalMs) {
    if (_sweepTimer) clearInterval(_sweepTimer);
    const ms = intervalMs || 5 * 60 * 1000;  // 5min default
    _sweepTimer = setInterval(() => {
        try { _sweepOrphanRefs(db); } catch (e) {
            logger.warn('FEED', `[refcount] sweep tick error: ${e.message}`);
        }
    }, ms);
    if (typeof _sweepTimer.unref === 'function') _sweepTimer.unref();
    logger.info('FEED', `[refcount] orphan sweeper started, interval ${ms / 1000}s`);
}

function stopOrphanSweep() {
    if (_sweepTimer) { clearInterval(_sweepTimer); _sweepTimer = null; }
}

function _unsubscribeSymbolReal(symbol) {
    const sym = String(symbol).toUpperCase();
    const symLower = sym.toLowerCase();

    // Remove from combined stream — send UNSUBSCRIBE for each stream key
    const combinedKeys = Array.from(_combinedHandlers.keys()).filter(k => k.startsWith(symLower + '@'));
    for (const key of combinedKeys) {
        _combinedHandlers.delete(key);
        if (_combinedWs?.readyState === WebSocket.OPEN) {
            _combinedWs.send(JSON.stringify({
                method: 'UNSUBSCRIBE',
                params: [key],
                id: Date.now(),
            }));
        }
    }
    if (combinedKeys.length > 0) {
        logger.info('FEED', `[combined] unsubscribed ${combinedKeys.length} streams for ${sym}`);
    }

    // Also clean up any legacy individual streams (backward compat)
    for (const key of Object.keys(_streams)) {
        if (key.startsWith(symLower + '@')) {
            const entry = _streams[key];
            if (entry.timer) clearInterval(entry.timer);
            if (entry.ws) {
                try { entry.ws.removeAllListeners(); } catch (_) {}
                if (entry.ws.readyState === WebSocket.OPEN) {
                    try { entry.ws.close(); } catch (_) {}
                }
            }
            delete _streams[key];
        }
    }
    // Stop ALT klinePollers for this symbol
    for (const key of Object.keys(_altKlinePollers)) {
        if (key.startsWith(sym + '|')) {
            const state = _altKlinePollers[key];
            if (state && state.timer) clearInterval(state.timer);
            delete _altKlinePollers[key];
        }
    }
    _activeSymbols.delete(sym);
    _symbolRefs.delete(sym);
    logger.info('FEED', `[refcount] ${sym} unsubscribed (last ref released)`);
}

// ── Event listeners ──
const _listeners = { kline: [], price: [], fundingRate: [], openInterest: [], aggTrade: [] };

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
        const res = await _telemFetch(url, { signal: AbortSignal.timeout(10000), __src: 'marketFeed:klines-init', __weight: 5 });
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
    // [T2 Gateway] Read from cache first (marketRadar is owner)
    try {
        const mc = require('./marketCache');
        const cached = mc.get('funding', 'binance:' + symbol);
        if (cached && cached.rate != null) return cached.rate;
    } catch (_) {}
    // Fallback: direct fetch (only if cache miss — e.g. radar hasn't polled yet)
    const url = `${BINANCE_REST}/fapi/v1/premiumIndex?symbol=${encodeURIComponent(symbol)}`;
    try {
        const res = await _telemFetch(url, { signal: AbortSignal.timeout(8000), __src: 'marketFeed:funding', __weight: 1 });
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
    // [T2 Gateway] Read from cache first (marketRadar is owner)
    try {
        const mc = require('./marketCache');
        const cached = mc.get('oi', 'binance:' + symbol);
        if (cached != null) return cached;
    } catch (_) {}
    // Fallback: direct fetch (only if cache miss)
    const url = `${BINANCE_REST}/fapi/v1/openInterest?symbol=${encodeURIComponent(symbol)}`;
    try {
        const res = await _telemFetch(url, { signal: AbortSignal.timeout(8000), __src: 'marketFeed:oi', __weight: 1 });
        if (!res.ok) return null;
        const data = await res.json();
        return data.openInterest ? parseFloat(data.openInterest) : null;
    } catch (err) {
        logger.error('FEED', `fetchOpenInterest ${symbol} failed:`, err.message);
        return null;
    }
}

// ══════════════════════════════════════════════════════════════════
// WebSocket — Combined stream (single TCP connection for all streams)
// Binance best practice: wss://fstream.binance.com/stream?streams=a@trade/b@bookTicker/...
// Reduces 8+ individual connections to 1, preventing 429 rate-limit bans.
// ══════════════════════════════════════════════════════════════════
const _combinedHandlers = new Map();  // streamName → onMessage handler
let _combinedWs = null;
let _combinedReconnects = 0;
let _combinedTimer = null;
let _combinedPending = [];  // streams queued before WS opens
let _combinedLastMessageTs = 0;

function _connectCombinedStream() {
    if (_combinedWs?.readyState === WebSocket.OPEN || _combinedWs?.readyState === WebSocket.CONNECTING) return;

    const streams = Array.from(_combinedHandlers.keys());
    if (streams.length === 0) return;

    const url = `${BINANCE_WS.replace('/ws', '')}/stream?streams=${streams.join('/')}`;

    try {
        const ws = new WebSocket(url);
        _combinedWs = ws;

        ws.on('open', () => {
            _combinedReconnects = 0;
            logger.info('FEED', `Combined stream connected: ${streams.length} streams in 1 connection`);

            if (_combinedTimer) clearInterval(_combinedTimer);
            _combinedTimer = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) ws.ping();
            }, PING_INTERVAL_MS);

            // Process any pending subscriptions added while connecting
            for (const pending of _combinedPending) {
                ws.send(JSON.stringify({ method: 'SUBSCRIBE', params: [pending], id: Date.now() }));
                logger.info('FEED', `Stream connected: ${pending} (added to combined)`);
            }
            _combinedPending = [];
        });

        ws.on('message', (raw) => {
            try {
                _combinedLastMessageTs = Date.now();
                const msg = JSON.parse(raw.toString());
                // Combined stream format: { stream: "btcusdt@trade", data: {...} }
                if (msg.stream && msg.data) {
                    const handler = _combinedHandlers.get(msg.stream);
                    if (handler) handler(msg.data);
                }
                // Some messages come unwrapped (pong, subscribe ack, etc.) — ignore
            } catch (_) {}
        });

        ws.on('pong', () => {});

        ws.on('close', () => {
            if (_combinedTimer) { clearInterval(_combinedTimer); _combinedTimer = null; }
            _combinedReconnects++;
            const delay = Math.min(RECONNECT_MS * Math.pow(2, _combinedReconnects - 1), MAX_RECONNECT_MS);
            logger.warn('FEED', `Combined stream closed, reconnecting in ${delay}ms (attempt ${_combinedReconnects}, ${_combinedHandlers.size} streams)`);
            _combinedWs = null;
            setTimeout(() => _connectCombinedStream(), delay);
        });

        ws.on('error', (err) => {
            logger.error('FEED', `Combined stream error:`, err.message);
            if (_combinedReconnects >= 3) Sentry.captureException(err, { tags: { module: 'marketFeed', stream: 'combined', reconnects: _combinedReconnects } });
            ws.close();
        });
    } catch (err) {
        logger.error('FEED', `Failed to create combined WS:`, err.message);
        _combinedReconnects++;
        const delay = Math.min(RECONNECT_MS * Math.pow(2, _combinedReconnects), MAX_RECONNECT_MS);
        setTimeout(() => _connectCombinedStream(), delay);
    }
}

function _addToCombinedStream(streamName, onMessage) {
    _combinedHandlers.set(streamName, onMessage);

    if (_combinedWs?.readyState === WebSocket.OPEN) {
        // WS already open — subscribe dynamically via Binance runtime subscribe
        _combinedWs.send(JSON.stringify({
            method: 'SUBSCRIBE',
            params: [streamName],
            id: Date.now(),
        }));
        logger.info('FEED', `Stream connected: ${streamName} (added to combined)`);
    } else if (!_combinedWs || _combinedWs.readyState === WebSocket.CLOSED) {
        // No WS yet — will be included in URL on next connect
        _combinedPending.push(streamName);
        _connectCombinedStream();
    } else {
        // WS connecting — queue for post-open
        _combinedPending.push(streamName);
    }
}

// ══════════════════════════════════════════════════════════════════
// WebSocket — Individual stream manager (kept for backward compat,
// e.g. liquidationFeed standalone WS). New subscriptions use
// _addToCombinedStream above.
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
// [Phase 2 S3.1d] REST kline poller — used when MF.ALT_WS_FEEDS is ON.
// Polls `/fapi/v1/klines?limit=2` every ALT_KLINE_POLL_MS, tracks the last
// open timestamp per (symbol, tf), and emits compat 'kline' events:
//   - `closed:false` live update on the current forming candle
//   - `closed:true` transition event when a new candle begins
// Price is also emitted on every poll so downstream priceTs stays fresh.
// ══════════════════════════════════════════════════════════════════
async function _altFetchKlinesLatest(symbol, interval, limit) {
    const url = `${BINANCE_REST}/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${encodeURIComponent(limit)}`;
    const res = await _telemFetch(url, { signal: AbortSignal.timeout(8000), __src: 'marketFeed:alt-klines', __weight: 1 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    return raw.map(k => ({
        time: k[0] / 1000,
        openTime: k[0],
        open: +k[1],
        high: +k[2],
        low: +k[3],
        close: +k[4],
        volume: +k[5],
        closeTime: k[6],
    }));
}

function _altStartKlinePoller(symUpper, tf) {
    const key = `${symUpper}|${tf}`;
    if (_altKlinePollers[key]) return;
    const state = { timer: null, lastOpenTs: 0, lastBar: null };
    _altKlinePollers[key] = state;

    const tick = async () => {
        try {
            const bars = await _altFetchKlinesLatest(symUpper, tf, 2);
            if (!bars || bars.length === 0) return;
            const latest = bars[bars.length - 1];
            const prev = bars.length > 1 ? bars[0] : null;

            if (state.lastOpenTs === 0) {
                // First poll — emit latest as live update, nothing to close yet.
                state.lastOpenTs = latest.openTime;
                state.lastBar = latest;
                _emit('kline', { symbol: symUpper, timeframe: tf, bar: { ...latest, closed: false }, initial: false });
                if (latest.close > 0) _emit('price', { symbol: symUpper, price: latest.close });
                return;
            }

            if (latest.openTime > state.lastOpenTs) {
                // New candle started — prev is the candle that just closed.
                if (prev && prev.openTime === state.lastOpenTs) {
                    _emit('kline', { symbol: symUpper, timeframe: tf, bar: { ...prev, closed: true }, initial: false });
                }
                state.lastOpenTs = latest.openTime;
                state.lastBar = latest;
                _emit('kline', { symbol: symUpper, timeframe: tf, bar: { ...latest, closed: false }, initial: false });
            } else {
                // Same candle — live update
                state.lastBar = latest;
                _emit('kline', { symbol: symUpper, timeframe: tf, bar: { ...latest, closed: false }, initial: false });
            }
            if (latest.close > 0) _emit('price', { symbol: symUpper, price: latest.close });
        } catch (err) {
            // Quiet failure — next tick retries
            if (err && err.message && !/HTTP 4\d\d/.test(err.message)) {
                logger.warn('FEED', `[ALT_WS_FEEDS] kline poll failed [${symUpper} ${tf}]: ${err.message}`);
            }
        }
    };

    state.timer = setInterval(tick, ALT_KLINE_POLL_MS);
    // [V6 2026-05-20] Boot jitter — spread initial fetches across 0-25s window
    // to avoid synchronized burst when 4 symbols × N timeframes fire at boot+500ms.
    // Deterministic per (symbol|tf) key — same value across reloads for
    // predictable scheduling topology in soak logs.
    let _firstFireDelay = 500;
    try {
        const { bootJitter } = require('../utils/bootJitter');
        _firstFireDelay = bootJitter(`marketFeed.altKline.${symUpper}.${tf}`);
    } catch (_) { /* fall back to 500ms if utility missing */ }
    setTimeout(tick, _firstFireDelay);
}

function _altStopKlinePoller(symUpper, tf) {
    const key = `${symUpper}|${tf}`;
    const state = _altKlinePollers[key];
    if (!state) return;
    if (state.timer) clearInterval(state.timer);
    delete _altKlinePollers[key];
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

    // [Phase 2 S3.1d] Lane selection — when the primary Binance streams are
    // throttled (markPrice@1s / kline_* / aggTrade), MF.ALT_WS_FEEDS routes
    // kline updates through REST polling and swaps markPrice→bookTicker,
    // aggTrade→trade. Both branches emit identical 'kline'/'price'/'aggTrade'
    // event shapes so downstream (serverState, serverOrderflow, shadow cycle)
    // is oblivious to the source.
    if (MF.ALT_WS_FEEDS) {
        logger.info('FEED', `[ALT_WS_FEEDS=ON] ${symUpper} — using REST klines + bookTicker + trade`);

        // 3a) REST kline polling — one poller per timeframe
        for (const tf of _timeframes) {
            _altStartKlinePoller(symUpper, tf);
        }

        // 4a) bookTicker stream → mid price emit (via combined WS)
        _addToCombinedStream(`${symLower}@bookTicker`, (data) => {
            const bid = +data.b, ask = +data.a;
            if (bid > 0 && ask > 0) {
                const mid = (bid + ask) / 2;
                _emit('price', { symbol: symUpper, price: mid });
            }
        });

        // 5a) raw trade stream → aggTrade-shape emit (via combined WS)
        _addToCombinedStream(`${symLower}@trade`, (data) => {
            _emit('aggTrade', {
                symbol: symUpper,
                price: +data.p,
                qty: +data.q,
                isBuyerMaker: data.m,
                ts: data.T,
            });
        });
    } else {
        // 3) Connect kline WebSocket streams (via combined WS)
        for (const tf of _timeframes) {
            _addToCombinedStream(`${symLower}@kline_${tf}`, (data) => {
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

        // 4) Connect mark price stream (via combined WS)
        _addToCombinedStream(`${symLower}@markPrice@1s`, (data) => {
            if (data.p) _emit('price', { symbol: symUpper, price: +data.p });
            if (data.r) _emit('fundingRate', { symbol: symUpper, rate: +data.r });
        });

        // 5) [BRAIN-V2] aggTrade stream for order flow analysis (via combined WS)
        _addToCombinedStream(`${symLower}@aggTrade`, (data) => {
            _emit('aggTrade', {
                symbol: symUpper,
                price: +data.p,
                qty: +data.q,
                isBuyerMaker: data.m,  // true = seller aggressor (taker sell)
                ts: data.T,
            });
        });
    }

    logger.info('FEED', `Subscription complete for ${symUpper}`);
}

// [MULTI-SYM] Subscribe to multiple symbols sequentially
async function subscribeMulti(symbols, timeframes) {
    for (const sym of symbols) {
        await subscribe(sym, timeframes);
    }
    logger.info('FEED', `All symbols subscribed: [${[..._activeSymbols].join(',')}]`);
}

// [BIN-TELEM Phase B 2026-05-19] Boot-time subscribe with sticky ref so
// SD_SYMBOLS (BTC/ETH/SOL/BNB) cannot be torn down by position close.
// Each boot symbol gets the 'boot|system' refKey, which is sticky by
// _releaseRefByKey invariant (Task 1).
async function subscribeMultiWithBootRef(symbols, timeframes) {
    for (const sym of symbols) {
        await subscribeForRef(sym, 'boot|system', timeframes);
    }
}

// ══════════════════════════════════════════════════════════════════
// Unsubscribe — close all streams
// ══════════════════════════════════════════════════════════════════
function unsubscribeAll() {
    // Close combined stream
    if (_combinedWs) {
        try { _combinedWs.removeAllListeners(); } catch (_) {}
        if (_combinedWs.readyState === WebSocket.OPEN) {
            try { _combinedWs.close(); } catch (_) {}
        }
        _combinedWs = null;
    }
    _combinedHandlers.clear();
    _combinedPending = [];
    if (_combinedTimer) { clearInterval(_combinedTimer); _combinedTimer = null; }
    _combinedReconnects = 0;

    // Close any legacy individual streams
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
    logger.info('FEED', 'All streams closed (combined + individual)');
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
        lastMessageTs: _combinedLastMessageTs,
        combinedStream: {
            connected: _combinedWs?.readyState === WebSocket.OPEN,
            streamCount: _combinedHandlers.size,
            reconnects: _combinedReconnects,
            streams: Array.from(_combinedHandlers.keys()),
        },
    };
}

// [RECON-SUBSCRIBE 2026-05-14] Expose immutable view of subscribed symbols.
// Used by serverAT recon loop pentru a auto-subscribe missing symbols
// (positions on non-mainstream symbols like ZECUSDT). Returns NEW Set
// pentru a preveni external mutation a internal _activeSymbols state.
function getActiveSymbols() {
    return new Set(_activeSymbols);
}

// [BIN-TELEM 2026-05-19] Snapshot pollers state pentru diag endpoint.
// activeSymbols + altKlinePollers count + WS streams count = leak indicator.
function getPollerStats() {
    const symbolRefs = {};
    for (const [sym, refs] of _symbolRefs) {
        symbolRefs[sym] = refs.size;
    }
    return {
        activeSymbols: Array.from(_activeSymbols),
        activeSymbolsCount: _activeSymbols.size,
        altKlinePollersCount: Object.keys(_altKlinePollers).length,
        altKlinePollerKeys: Object.keys(_altKlinePollers),
        wsStreamsCount: Object.keys(_streams).length,
        combinedStreamCount: _combinedHandlers.size,
        combinedConnected: _combinedWs?.readyState === WebSocket.OPEN,
        timeframes: _timeframes.slice(),
        symbolRefs,
        symbolRefsTotal: Object.values(symbolRefs).reduce((s, n) => s + n, 0),
    };
}

module.exports = {
    subscribe,
    subscribeMulti,    // [MULTI-SYM]
    subscribeMultiWithBootRef,  // [BIN-TELEM Phase B 2026-05-19]
    subscribeForRef,   // [BIN-TELEM Phase B 2026-05-19]
    releaseRef,        // [BIN-TELEM Phase B 2026-05-19]
    startOrphanSweep,  // [BIN-TELEM Phase B 2026-05-19]
    stopOrphanSweep,   // [BIN-TELEM Phase B 2026-05-19]
    _sweepOrphanRefs,  // [BIN-TELEM Phase B 2026-05-19]
    unsubscribeAll,
    fetchKlines,
    fetchFundingRate,
    fetchOpenInterest,
    on,
    getHealth,
    getActiveSymbols,  // [RECON-SUBSCRIBE 2026-05-14]
    getPollerStats,    // [BIN-TELEM 2026-05-19]
    STALE_DATA_MS,
    // [BIN-TELEM Phase B 2026-05-19] Test helpers
    _resetRefsForTest: () => {
        _symbolRefs.clear();
        _subscribeFn = null;
        _unsubscribeSymbolFn = null;
    },
    _addRefForTest: _addRef,
    _releaseRefByKeyForTest: _releaseRefByKey,
    _hasSymbolRefForTest: _hasSymbolRef,
    _refCountForTest: _refCount,
    _setSubscribeFnForTest: (fn) => { _subscribeFn = fn; },
    _setUnsubscribeSymbolFnForTest: (fn) => { _unsubscribeSymbolFn = fn; },
};
