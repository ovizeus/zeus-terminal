// Zeus Terminal — Server Market Radar (Phase 11.2)
// Polls Binance Futures /ticker/24hr, detects market events (price spikes,
// volume spikes, rank shifts, top-N liquidity-universe entry/exit) and
// broadcasts them over the WS sync channel to all connected clients.
//
// IMPORTANT — what "TOP 300" means here:
//   The universe is the top 300 symbols returned by Binance Futures
//   /fapi/v1/ticker/24hr, filtered to USDT-margined perpetuals, ranked
//   DESCENDING by 24-hour quoteVolume (USD traded). This is a liquidity /
//   trading-activity ranking. It is NOT a global market-cap ranking.
//   newTop300 / exitTop300 mean: the symbol entered / left THIS liquidity
//   universe between two consecutive polls. A UI surface MUST label the
//   source clearly (e.g. "TOP 300 BINANCE USDT · 24h VOL") rather than a
//   bare "TOP 300 LIVE" that would imply market cap.
//
// Feature flags (process.env):
//   MARKET_RADAR_ENABLED  — "0" / "false" disables the scanner entirely
//                           (default: enabled). When disabled: zero scan,
//                           zero emit, zero crash. Client degrades quietly
//                           because no market.radar frames are sent.
//   MARKET_RADAR_POLL_MS  — poll interval in ms (default 60000; clamped to
//                           [15000, 3600000]).
//
// Emits WS payloads of shape:
//   { type: 'market.radar', data: { ts, symbol, category, color, price,
//                                   changePct, volRatio, rank, rankPrev,
//                                   quoteVolume } }
//
// Event categories: spike1h, dump1h, spike4h, dump4h, spike24h, dump24h,
//                   volSpike, rankUp, rankDown, newTop300, exitTop300
'use strict';

const logger = require('./logger');

// ── Env flags ──
function _envEnabled() {
    const raw = process.env.MARKET_RADAR_ENABLED;
    if (raw === undefined || raw === null || raw === '') return true;
    const v = String(raw).trim().toLowerCase();
    return !(v === '0' || v === 'false' || v === 'off' || v === 'no');
}
function _envPollMs() {
    const raw = parseInt(process.env.MARKET_RADAR_POLL_MS, 10);
    if (!isFinite(raw) || raw <= 0) return 60000;
    return Math.max(15000, Math.min(raw, 3600000));
}

// ── Config ──
const BINANCE_REST = 'https://fapi.binance.com';
const ENABLED = _envEnabled();
const POLL_INTERVAL_MS = _envPollMs();
const FIRST_POLL_DELAY_MS = 20000;  // warm up after boot
const TOP_N = 300;                  // rank universe (Binance USDT perps by 24h quoteVolume — NOT market cap)
const HISTORY_MAX = 240;            // 240 ticks = 4h of 1-min snapshots
const TICKS_1H = 60;                // offset to look back for 1h delta
const TICKS_4H = 240;               // offset to look back for 4h delta
const VOL_BASELINE_WINDOW = 20;     // volume avg over last 20 ticks
const DEDUPE_WINDOW_MS = 300000;    // 1 event / symbol / category / 5 min
const THRESH = {
    spike1h: 5,      // ±5 %
    spike4h: 10,     // ±10 %
    spike24h: 15,    // ±15 %
    volRatio: 2.0,   // ≥ 200 % of 20-tick avg quote volume
    rankShift: 20,   // |Δrank| ≥ 20 within top-N
};

// ── State ──
let _timer = null;
let _running = false;
let _tickCount = 0;
const _history = new Map();    // symbol -> ring: [{ts, price, quoteVolume}]
const _prevRank = new Map();   // symbol -> rank (1-based within top-N)
let _prevTopSet = new Set();   // symbols in previous top-N snapshot
const _dedupe = new Map();     // `${symbol}:${category}` -> ts

function _broadcast(payload) {
    const fn = global.__zeusWsBroadcastAll;
    if (typeof fn !== 'function') return 0;
    try { return fn(payload); } catch (_) { return 0; }
}

function _canEmit(symbol, category, now) {
    const key = symbol + ':' + category;
    const last = _dedupe.get(key) || 0;
    if (now - last < DEDUPE_WINDOW_MS) return false;
    _dedupe.set(key, now);
    return true;
}

function _emit(event) {
    _broadcast({ type: 'market.radar', data: event });
}

function _pushHistory(symbol, entry) {
    let buf = _history.get(symbol);
    if (!buf) { buf = []; _history.set(symbol, buf); }
    buf.push(entry);
    if (buf.length > HISTORY_MAX) buf.shift();
    return buf;
}

function _deltaPctFromOffset(buf, offsetTicks, currentPrice) {
    if (!buf || buf.length <= offsetTicks) return null;
    const past = buf[buf.length - 1 - offsetTicks];
    if (!past || !past.price) return null;
    return ((currentPrice - past.price) / past.price) * 100;
}

function _volRatio(buf, currentVolume) {
    if (!buf || buf.length < VOL_BASELINE_WINDOW + 1) return null;
    // use previous N entries (exclude the just-pushed current one)
    const slice = buf.slice(-VOL_BASELINE_WINDOW - 1, -1);
    let sum = 0;
    for (const e of slice) sum += (e.quoteVolume || 0);
    const avg = sum / slice.length;
    if (avg <= 0) return null;
    return currentVolume / avg;
}

async function _fetchTicker24h() {
    const url = `${BINANCE_REST}/fapi/v1/ticker/24hr`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function _pollOnce() {
    let rows;
    try {
        rows = await _fetchTicker24h();
    } catch (err) {
        logger.error('RADAR', `fetch /ticker/24hr failed: ${err.message}`);
        return;
    }
    if (!Array.isArray(rows) || rows.length === 0) return;

    // Keep only USDT-margined perpetuals and coerce numerics
    const tickers = [];
    for (const r of rows) {
        const sym = r.symbol;
        if (typeof sym !== 'string' || !sym.endsWith('USDT')) continue;
        const price = parseFloat(r.lastPrice);
        const qv = parseFloat(r.quoteVolume);
        const pct24 = parseFloat(r.priceChangePercent);
        if (!isFinite(price) || !isFinite(qv)) continue;
        tickers.push({
            symbol: sym,
            price,
            quoteVolume: qv,
            priceChangePercent24h: isFinite(pct24) ? pct24 : 0,
        });
    }
    if (tickers.length === 0) return;

    // Rank by 24h quote volume, take top N
    tickers.sort((a, b) => b.quoteVolume - a.quoteVolume);
    const top = tickers.slice(0, TOP_N);
    const currentTopSet = new Set(top.map(t => t.symbol));
    const now = Date.now();
    _tickCount++;

    // Per-symbol detection
    for (let i = 0; i < top.length; i++) {
        const t = top[i];
        const rank = i + 1;
        const buf = _pushHistory(t.symbol, {
            ts: now,
            price: t.price,
            quoteVolume: t.quoteVolume,
        });

        // ── price spikes ──
        // 24h comes straight from the ticker and is valid from tick #1
        if (Math.abs(t.priceChangePercent24h) >= THRESH.spike24h) {
            const cat = t.priceChangePercent24h > 0 ? 'spike24h' : 'dump24h';
            if (_canEmit(t.symbol, cat, now)) {
                _emit({
                    ts: now, symbol: t.symbol, category: cat,
                    color: t.priceChangePercent24h > 0 ? 'green' : 'red',
                    price: t.price, changePct: t.priceChangePercent24h,
                    rank, quoteVolume: t.quoteVolume,
                });
            }
        }
        // 1h / 4h need enough history buffered
        const d1h = _deltaPctFromOffset(buf, TICKS_1H, t.price);
        if (d1h !== null && Math.abs(d1h) >= THRESH.spike1h) {
            const cat = d1h > 0 ? 'spike1h' : 'dump1h';
            if (_canEmit(t.symbol, cat, now)) {
                _emit({
                    ts: now, symbol: t.symbol, category: cat,
                    color: d1h > 0 ? 'green' : 'red',
                    price: t.price, changePct: d1h,
                    rank, quoteVolume: t.quoteVolume,
                });
            }
        }
        const d4h = _deltaPctFromOffset(buf, TICKS_4H, t.price);
        if (d4h !== null && Math.abs(d4h) >= THRESH.spike4h) {
            const cat = d4h > 0 ? 'spike4h' : 'dump4h';
            if (_canEmit(t.symbol, cat, now)) {
                _emit({
                    ts: now, symbol: t.symbol, category: cat,
                    color: d4h > 0 ? 'green' : 'red',
                    price: t.price, changePct: d4h,
                    rank, quoteVolume: t.quoteVolume,
                });
            }
        }

        // ── volume spike ──
        const vr = _volRatio(buf, t.quoteVolume);
        if (vr !== null && vr >= THRESH.volRatio) {
            if (_canEmit(t.symbol, 'volSpike', now)) {
                _emit({
                    ts: now, symbol: t.symbol, category: 'volSpike',
                    color: 'green',
                    price: t.price,
                    changePct: t.priceChangePercent24h,
                    volRatio: vr,
                    rank, quoteVolume: t.quoteVolume,
                });
            }
        }

        // ── rank shift (require prior rank present so first snapshot stays quiet) ──
        const prevR = _prevRank.get(t.symbol);
        if (typeof prevR === 'number') {
            const delta = prevR - rank;    // positive = moved up (better rank)
            if (Math.abs(delta) >= THRESH.rankShift) {
                const cat = delta > 0 ? 'rankUp' : 'rankDown';
                if (_canEmit(t.symbol, cat, now)) {
                    _emit({
                        ts: now, symbol: t.symbol, category: cat,
                        color: delta > 0 ? 'green' : 'red',
                        price: t.price,
                        changePct: t.priceChangePercent24h,
                        rank, rankPrev: prevR,
                        quoteVolume: t.quoteVolume,
                    });
                }
            }
        }
    }

    // ── top-N entry / exit (skip on first snapshot — _prevTopSet is empty) ──
    if (_prevTopSet.size > 0) {
        for (const sym of currentTopSet) {
            if (!_prevTopSet.has(sym) && _canEmit(sym, 'newTop300', now)) {
                const t = top.find(x => x.symbol === sym);
                if (t) _emit({
                    ts: now, symbol: sym, category: 'newTop300',
                    color: 'green', price: t.price,
                    changePct: t.priceChangePercent24h,
                    rank: top.indexOf(t) + 1,
                    quoteVolume: t.quoteVolume,
                });
            }
        }
        for (const sym of _prevTopSet) {
            if (!currentTopSet.has(sym) && _canEmit(sym, 'exitTop300', now)) {
                _emit({
                    ts: now, symbol: sym, category: 'exitTop300',
                    color: 'red', price: null, changePct: null,
                    rank: null, rankPrev: _prevRank.get(sym) || null,
                    quoteVolume: null,
                });
            }
        }
    }

    // Rotate snapshot state
    _prevRank.clear();
    top.forEach((t, i) => _prevRank.set(t.symbol, i + 1));
    _prevTopSet = currentTopSet;

    // Drop history for symbols that fell out of the universe so Map doesn't grow
    for (const sym of _history.keys()) {
        if (!currentTopSet.has(sym)) _history.delete(sym);
    }
    // GC dedupe entries older than 2× window
    const cutoff = now - DEDUPE_WINDOW_MS * 2;
    for (const [k, ts] of _dedupe) if (ts < cutoff) _dedupe.delete(k);
}

function start() {
    if (_running) return;
    if (!ENABLED) {
        logger.info('RADAR', 'scanner DISABLED via MARKET_RADAR_ENABLED — zero scan, zero emit');
        return;
    }
    _running = true;
    setTimeout(() => { _pollOnce().catch(() => { }); }, FIRST_POLL_DELAY_MS);
    _timer = setInterval(() => { _pollOnce().catch(() => { }); }, POLL_INTERVAL_MS);
    logger.info('RADAR', `scanner started — top ${TOP_N} (Binance USDT perps, by 24h quoteVolume), poll ${POLL_INTERVAL_MS / 1000}s`);
}

function stop() {
    if (_timer) { clearInterval(_timer); _timer = null; }
    _running = false;
}

function getState() {
    return {
        enabled: ENABLED,
        running: _running,
        pollMs: POLL_INTERVAL_MS,
        tickCount: _tickCount,
        trackedSymbols: _history.size,
        topSetSize: _prevTopSet.size,
        dedupeEntries: _dedupe.size,
        universe: 'binance-futures-usdt-perps/quoteVolume24h',
    };
}

module.exports = { start, stop, getState };
