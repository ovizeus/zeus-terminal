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
//   MARKET_RADAR_ENABLED          — master switch. "0"/"false" disables the
//                                   entire scanner (default: enabled).
//   MARKET_RADAR_POLL_MS          — main poll interval in ms (default 60000;
//                                   clamped to [15000, 3600000]).
//   MARKET_RADAR_FUNDING_ENABLED  — toggle funding-rate sub-poll (default on).
//   MARKET_RADAR_OI_ENABLED       — toggle open-interest sub-poll (default on).
//
// Emits WS payloads of shape:
//   { type: 'market.radar', data: { ts, symbol, category, color, price,
//                                   changePct, volRatio, rank, rankPrev,
//                                   quoteVolume, btcDelta, streakCount,
//                                   fundingRate, oiChangePct, notional } }
//   btcDelta / streakCount are enrichment fields attached to every emit;
//   fundingRate / oiChangePct / notional appear only on their own category.
//
// Event categories: spike1h, dump1h, spike4h, dump4h, spike24h, dump24h,
//                   volSpike, rankUp, rankDown, newTop300, exitTop300,
//                   fundingExtreme, oiSurge
// (Liquidation categories liqLong/liqShort come from liquidationFeed.js.)
'use strict';

const logger = require('./logger');
const radarCache = require('./radarCache');
const fs = require('fs');
const path = require('path');

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
function _envBool(name, defaultOn) {
    const raw = process.env[name];
    if (raw === undefined || raw === null || raw === '') return defaultOn;
    const v = String(raw).trim().toLowerCase();
    if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
    return true;
}

// ── Config ──
const BINANCE_REST = 'https://fapi.binance.com';
const ENABLED = _envEnabled();
const FUNDING_ENABLED = _envBool('MARKET_RADAR_FUNDING_ENABLED', true);
const OI_ENABLED = _envBool('MARKET_RADAR_OI_ENABLED', true);
const POLL_INTERVAL_MS = _envPollMs();
const FIRST_POLL_DELAY_MS = 20000;  // warm up after boot
const TOP_N = 300;                  // rank universe (Binance USDT perps by 24h quoteVolume — NOT market cap)
const HISTORY_MAX = 240;            // 240 ticks = 4h of 1-min snapshots
const TICKS_1H = 60;                // offset to look back for 1h delta
const TICKS_4H = 240;               // offset to look back for 4h delta
const VOL_BASELINE_WINDOW = 20;     // volume avg over last 20 ticks
const DEDUPE_WINDOW_MS = 300000;    // 1 event / symbol / category / 5 min
const STREAK_WINDOW_MS = DEDUPE_WINDOW_MS * 3;  // streak continues if re-fires within 15 min
const OI_TOP_N = 25;                // top 25 — gateway rateLimiter protects against ban (was 10 emergency, 50 original)
const THRESH = {
    spike1h: 5,      // ±5 %
    spike4h: 10,     // ±10 %
    spike24h: 15,    // ±15 %
    volRatio: 2.0,   // ≥ 200 % of 20-tick avg quote volume
    rankShift: 20,   // |Δrank| ≥ 20 within top-N
    fundingAbs: 0.0005,  // |funding rate| ≥ 0.05 % / 8 h (crowded trade)
    oiChangePct: 10,     // |OI Δ| ≥ 10 % vs 60 ticks ago
};

// ── State ──
let _timer = null;
let _running = false;
let _tickCount = 0;
const _history = new Map();    // symbol -> ring: [{ts, price, quoteVolume}]
const _oiHistory = new Map();  // symbol -> ring: [{ts, oi}] (open interest in contracts)
const _prevRank = new Map();   // symbol -> rank (1-based within top-N)
let _prevTopSet = new Set();   // symbols in previous top-N snapshot
const _dedupe = new Map();     // `${symbol}:${category}` -> ts
const _streaks = new Map();    // `${symbol}:${category}` -> { count, lastTs }
let _btcDelta = null;          // BTCUSDT priceChangePercent24h from the latest poll

// [Day 32A] Snapshot of the current top-N tickers — populated on every poll,
// queried by chatResponder / /api/market/top for top gainers/losers/volume
// without re-hitting Binance. Replaced atomically per tick.
let _lastSnapshot = null;      // { ts, tickers: [{symbol, price, quoteVolume, priceChangePercent24h, priceChangePercent1h}, ...] }
// [Phase B / Task B5] Which exchange the current universe came from. When Binance
// /ticker/24hr is IP-blocked we fall back to Bybit; the UI title must reflect the
// REAL source (no "BINANCE" label on Bybit data).
let _source = 'binance';
// [2026-06-13] P5-starvation fix: true when the in-memory snapshot was rehydrated
// from disk (a previous run's last-good) and no live poll has refreshed it yet.
// Surfaced via getTopSnapshot().stale so the panel shows last-good TOP 300 instead
// of a blank "scanning…" after a reload / sustained quota starvation.
let _snapshotStale = false;

// Disk path for the last-good snapshot — survives reloads. Read at call-time so
// tests can override via MARKET_RADAR_SNAPSHOT_PATH.
function _snapshotPath() {
    return process.env.MARKET_RADAR_SNAPSHOT_PATH
        || path.join(__dirname, '..', '..', 'data', 'marketRadar-snapshot.json');
}

// Best-effort persist of the current snapshot. Never throws into the caller.
function _persistSnapshotToDisk() {
    if (!_lastSnapshot) return false;
    try {
        const p = _snapshotPath();
        const payload = JSON.stringify({ ts: _lastSnapshot.ts, source: _source, tickers: _lastSnapshot.tickers });
        const tmp = p + '.tmp';
        fs.writeFileSync(tmp, payload);
        fs.renameSync(tmp, p);   // atomic swap so a reader never sees a half-written file
        return true;
    } catch (_) { return false; }
}

// Load the last-good snapshot from disk INTO an empty in-memory slot only. Returns
// true if it rehydrated. Never clobbers a live snapshot, never throws.
function _rehydrateIfEmpty() {
    if (_lastSnapshot) return false;
    try {
        const raw = fs.readFileSync(_snapshotPath(), 'utf8');
        const obj = JSON.parse(raw);
        if (!obj || typeof obj.ts !== 'number' || !Array.isArray(obj.tickers) || obj.tickers.length === 0) return false;
        _lastSnapshot = { ts: obj.ts, tickers: obj.tickers };
        if (typeof obj.source === 'string' && obj.source) _source = obj.source;
        _snapshotStale = true;
        return true;
    } catch (_) { return false; }
}

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

function _bumpStreak(symbol, category, now) {
    const key = symbol + ':' + category;
    const prev = _streaks.get(key);
    if (prev && (now - prev.lastTs) <= STREAK_WINDOW_MS) {
        prev.count++;
        prev.lastTs = now;
        return prev.count;
    }
    _streaks.set(key, { count: 1, lastTs: now });
    return 1;
}

// [D2] Per-timeframe real kline metrics from serverState
const TF_LIST = ['5m', '15m', '30m', '1h', '4h'];
function _computePerTfMetrics(symbol) {
    const result = {};
    try {
        const ss = require('./serverState');
        for (const tf of TF_LIST) {
            const bars = ss.getBarsForSymbol(symbol, tf);
            if (bars && bars.length >= 2) {
                const cur = bars[bars.length - 1];
                const prev = bars[bars.length - 2];
                if (cur && prev && prev.close > 0) {
                    result[tf] = +((cur.close - prev.close) / prev.close * 100).toFixed(2);
                } else { result[tf] = null; }
            } else { result[tf] = null; }
        }
    } catch (_) {}
    return result;
}

function _emit(event) {
    // Attach enrichment fields to every event so the client can render:
    //   - btcDelta: BTCUSDT's 24h % at emit time (context for altcoin moves)
    //   - streakCount: consecutive fires of (symbol, category) within 15 min
    //   - tfMetrics: per-timeframe change % from real klines (D2)
    if (event && typeof event === 'object') {
        if (event.source === undefined) event.source = _source; // [B5] honest source tag for UI title
        if (event.btcDelta === undefined) event.btcDelta = _btcDelta;
        if (event.streakCount === undefined && event.symbol && event.category) {
            event.streakCount = _bumpStreak(event.symbol, event.category, event.ts || Date.now());
        }
        if (event.tfMetrics === undefined && event.symbol) {
            try { event.tfMetrics = _computePerTfMetrics(event.symbol); } catch (_) {}
        }
    }
    // [Phase 11.7] Push to shared cache BEFORE broadcasting so a client that
    // connects mid-broadcast still receives this event via snapshot-on-connect.
    radarCache.push(event);
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
    const res = await _telemFetch(url, { signal: AbortSignal.timeout(10000), __src: 'marketRadar:ticker24h', __weight: 40 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

// [BIN-TELEM 2026-05-19] lazy-require telemetry wrapper — never blocks call path
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
    catch (_gw) { const t = _getTelem(); return t ? t.wrapFetch(fetch, url, opts) : fetch(url, opts); }
}

async function _pollOnce() {
    let rows;
    let source = 'binance';
    try {
        rows = await _fetchTicker24h();
    } catch (err) {
        // [Phase B / Task B5] Binance ticker IP-blocked → fall back to Bybit bulk
        // tickers (not blocked from this host), normalized to Binance field shape.
        try {
            const bybitRows = await require('./bybitRest').fetchTickers();
            if (Array.isArray(bybitRows) && bybitRows.length > 0) { rows = bybitRows; source = 'bybit'; }
        } catch (_) { /* fall through to error below */ }
        if (!rows) {
            logger.error('RADAR', `fetch /ticker/24hr failed: ${err.message} (Bybit fallback also unavailable)`);
            return;
        }
        logger.warn('RADAR', `Binance ticker unavailable — using Bybit fallback universe (${rows.length} symbols)`);
    }
    if (!Array.isArray(rows) || rows.length === 0) return;
    _source = source;

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

    // Capture BTC 24h delta for event enrichment BEFORE sorting/emitting.
    // Fall back to null if BTCUSDT isn't present (never expected, but safe).
    const btc = tickers.find(t => t.symbol === 'BTCUSDT');
    _btcDelta = btc ? btc.priceChangePercent24h : null;

    // Rank by 24h quote volume, take top N
    tickers.sort((a, b) => b.quoteVolume - a.quoteVolume);
    const top = tickers.slice(0, TOP_N);
    const currentTopSet = new Set(top.map(t => t.symbol));
    const now = Date.now();
    _tickCount++;

    // [Day 32A] Replace snapshot so getTopSnapshot/getSymbolFromSnapshot see
    // fresh data on the next chat query. Populated AFTER sort so 'volume' kind
    // already aligns with the polled order.
    _setSnapshot(top);

    // [T2 Gateway] Write ticker data to central cache — other modules read from here
    try {
        const mc = require('./marketCache');
        for (const t of top) {
            mc.set('ticker', 'binance:' + t.symbol, {
                price: t.price, quoteVolume: t.quoteVolume,
                priceChangePercent24h: t.priceChangePercent24h,
            }, { caller: 'marketRadar' });
        }
    } catch (_) {}

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
    for (const sym of _oiHistory.keys()) {
        if (!currentTopSet.has(sym)) _oiHistory.delete(sym);
    }
    // GC dedupe entries older than 2× window
    const cutoff = now - DEDUPE_WINDOW_MS * 2;
    for (const [k, ts] of _dedupe) if (ts < cutoff) _dedupe.delete(k);
    // GC streak entries older than 4× streak window
    const streakCutoff = now - STREAK_WINDOW_MS * 4;
    for (const [k, v] of _streaks) if (v.lastTs < streakCutoff) _streaks.delete(k);

    // ── funding-rate sub-poll (every 5th tick = ~5 min, not every 60s) ──
    // WS @markPrice@1s populates marketCache for tracked symbols in real-time.
    // REST poll only needed for full top-300 fundingExtreme radar detection.
    if (FUNDING_ENABLED && (_tickCount <= 1 || _tickCount % 5 === 0)) {
        try { await _pollFunding(top, currentTopSet, now); }
        catch (err) { logger.error('RADAR', `funding sub-poll failed: ${err.message}`); }
    }

    // ── open-interest sub-poll ──
    if (OI_ENABLED) {
        try { await _pollOpenInterest(top.slice(0, OI_TOP_N), now); }
        catch (err) { logger.error('RADAR', `OI sub-poll failed: ${err.message}`); }
    }
}

// ══════════════════════════════════════════════════════════════════
// Funding rate — /fapi/v1/premiumIndex returns ALL symbols in 1 call
// ══════════════════════════════════════════════════════════════════
async function _pollFunding(top, currentTopSet, now) {
    const url = `${BINANCE_REST}/fapi/v1/premiumIndex`;
    const res = await _telemFetch(url, { signal: AbortSignal.timeout(10000), __src: 'marketRadar:funding', __weight: 1 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) return;

    // [T2 Gateway] Write ALL funding data to cache — sentiment/feed read from here
    try {
        const mc = require('./marketCache');
        for (const r of rows) {
            if (r.symbol && r.lastFundingRate != null) {
                mc.set('funding', 'binance:' + r.symbol, {
                    rate: parseFloat(r.lastFundingRate),
                    markPrice: parseFloat(r.markPrice) || 0,
                    indexPrice: parseFloat(r.indexPrice) || 0,
                    ts: Date.now(),
                }, { caller: 'marketRadar' });
            }
        }
    } catch (_) {}

    // Index price/rank for O(1) enrichment lookup
    const ix = new Map();
    top.forEach((t, i) => ix.set(t.symbol, { rank: i + 1, price: t.price, qv: t.quoteVolume, pct24: t.priceChangePercent24h }));

    for (const r of rows) {
        const sym = r.symbol;
        if (typeof sym !== 'string' || !currentTopSet.has(sym)) continue;
        const fr = parseFloat(r.lastFundingRate);
        if (!isFinite(fr)) continue;
        if (Math.abs(fr) < THRESH.fundingAbs) continue;
        if (!_canEmit(sym, 'fundingExtreme', now)) continue;
        const meta = ix.get(sym);
        // Positive funding = longs pay shorts → crowded longs → color RED
        // Negative funding = shorts pay longs → crowded shorts → color GREEN
        _emit({
            ts: now, symbol: sym, category: 'fundingExtreme',
            color: fr > 0 ? 'red' : 'green',
            price: meta ? meta.price : null,
            changePct: meta ? meta.pct24 : null,
            fundingRate: fr,
            rank: meta ? meta.rank : null,
            quoteVolume: meta ? meta.qv : null,
        });
    }
}

// ══════════════════════════════════════════════════════════════════
// Open interest — 1 call per symbol; limit to top OI_TOP_N for rate safety
// Build our own 60-tick ring buffer; emit when |Δ1h| ≥ THRESH.oiChangePct
// ══════════════════════════════════════════════════════════════════
async function _fetchOI(symbol) {
    const url = `${BINANCE_REST}/fapi/v1/openInterest?symbol=${encodeURIComponent(symbol)}`;
    const res = await _telemFetch(url, { signal: AbortSignal.timeout(8000), __src: 'marketRadar:oi', __weight: 1 });
    if (!res.ok) return null;
    const data = await res.json();
    const oi = parseFloat(data.openInterest);
    if (!isFinite(oi)) return null;
    // [T2 Gateway] Write OI to cache
    try { require('./marketCache').set('oi', 'binance:' + symbol, oi, { caller: 'marketRadar' }); } catch (_) {}
    return oi;
}

async function _pollOpenInterest(topSubset, now) {
    // Spread requests to avoid a thundering herd on Binance: run 8 in parallel,
    // then wait a handful of ms between batches. 50 symbols ÷ 8 ≈ 7 batches → ~1-2s.
    const BATCH = 8;
    for (let i = 0; i < topSubset.length; i += BATCH) {
        const slice = topSubset.slice(i, i + BATCH);
        await Promise.all(slice.map(async (t) => {
            const oi = await _fetchOI(t.symbol);
            if (oi === null) return;
            let buf = _oiHistory.get(t.symbol);
            if (!buf) { buf = []; _oiHistory.set(t.symbol, buf); }
            buf.push({ ts: now, oi });
            if (buf.length > HISTORY_MAX) buf.shift();
            if (buf.length <= TICKS_1H) return;  // warmup
            const past = buf[buf.length - 1 - TICKS_1H];
            if (!past || !past.oi) return;
            const pct = ((oi - past.oi) / past.oi) * 100;
            if (!isFinite(pct) || Math.abs(pct) < THRESH.oiChangePct) return;
            if (!_canEmit(t.symbol, 'oiSurge', now)) return;
            _emit({
                ts: now, symbol: t.symbol, category: 'oiSurge',
                color: pct > 0 ? 'green' : 'red',
                price: t.price, changePct: t.priceChangePercent24h,
                oiChangePct: pct,
                rank: topSubset.indexOf(t) + 1,
                quoteVolume: t.quoteVolume,
            });
        }));
    }
}

function start() {
    if (_running) return;
    if (!ENABLED) {
        logger.info('RADAR', 'scanner DISABLED via MARKET_RADAR_ENABLED — zero scan, zero emit');
        return;
    }
    _running = true;
    // [2026-06-13] Rehydrate last-good snapshot from disk so the TOP 300 panel
    // serves the previous run's universe (marked stale) immediately on boot,
    // instead of a blank "scanning…" until the first live poll lands — which can
    // be minutes-to-days away under sustained Binance quota starvation (P5 lane).
    if (_rehydrateIfEmpty()) {
        logger.info('RADAR', `rehydrated last-good snapshot from disk (${_lastSnapshot.tickers.length} symbols, stale) — serving until first live poll`);
    }
    // [V6 2026-05-20] Boot jitter — deterministic delay to spread the radar
    // first poll away from marketFeed first poll fire. Same key produces same
    // delay across PM2 reloads → predictable scheduling topology in soak logs.
    let _firstDelay = FIRST_POLL_DELAY_MS;
    try {
        const { bootJitter } = require('../utils/bootJitter');
        _firstDelay = bootJitter('marketRadar.scanner');
    } catch (_) { /* keep configured default */ }
    setTimeout(() => { _pollOnce().catch(() => { }); }, _firstDelay);
    _timer = setInterval(() => { _pollOnce().catch(() => { }); }, POLL_INTERVAL_MS);
    logger.info('RADAR', `scanner started — top ${TOP_N} (Binance USDT perps, by 24h quoteVolume), poll ${POLL_INTERVAL_MS / 1000}s, funding=${FUNDING_ENABLED ? 'ON' : 'OFF'}, OI=${OI_ENABLED ? 'ON' : 'OFF'}`);
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
        fundingEnabled: FUNDING_ENABLED,
        oiEnabled: OI_ENABLED,
        tickCount: _tickCount,
        trackedSymbols: _history.size,
        trackedOI: _oiHistory.size,
        topSetSize: _prevTopSet.size,
        dedupeEntries: _dedupe.size,
        streakEntries: _streaks.size,
        btcDelta: _btcDelta,
        universe: 'binance-futures-usdt-perps/quoteVolume24h',
        snapshotTs: _lastSnapshot ? _lastSnapshot.ts : null,
        snapshotSize: _lastSnapshot ? _lastSnapshot.tickers.length : 0,
    };
}

// [Day 32A] Internal: replace _lastSnapshot atomically. Called from _pollOnce
// after the top-N sort + from _ingestSnapshotForTest in unit tests.
function _setSnapshot(tickers) {
    _lastSnapshot = {
        ts: Date.now(),
        tickers: tickers.map(t => ({
            symbol: t.symbol,
            price: t.price,
            quoteVolume: t.quoteVolume,
            priceChangePercent24h: t.priceChangePercent24h,
            priceChangePercent1h: typeof t.priceChangePercent1h === 'number' ? t.priceChangePercent1h : null,
        })),
    };
    _snapshotStale = false;        // a live poll just landed — no longer last-good-from-disk
    _persistSnapshotToDisk();      // best-effort; survives the next reload
}

// [Day 32A] Query latest snapshot — top gainers / losers / volume / oi.
// Returns null if no poll has completed yet (caller decides UX, e.g. "radar
// still warming up"). Limit floored at 1, ceiling at 50, clamped to size.
function getTopSnapshot(opts) {
    if (!_lastSnapshot) return null;
    const o = opts || {};
    let kind = o.kind;
    if (kind !== 'gainers' && kind !== 'losers' && kind !== 'volume') kind = 'volume';
    let limit = Number.isFinite(o.limit) ? Math.floor(o.limit) : 10;
    if (limit < 1) limit = 1;
    if (limit > 50) limit = 50;
    const all = _lastSnapshot.tickers.slice();
    if (kind === 'gainers') all.sort((a, b) => b.priceChangePercent24h - a.priceChangePercent24h);
    else if (kind === 'losers') all.sort((a, b) => a.priceChangePercent24h - b.priceChangePercent24h);
    else all.sort((a, b) => b.quoteVolume - a.quoteVolume);
    return {
        ts: _lastSnapshot.ts,
        kind,
        source: _source, // [B5] honest source tag (binance|bybit)
        stale: _snapshotStale, // [2026-06-13] true = last-good from a prior run, not yet refreshed
        universeSize: _lastSnapshot.tickers.length,
        symbols: all.slice(0, Math.min(limit, all.length)),
    };
}

// [Day 32A] Single-symbol lookup. Accepts "BTCUSDT" or short form "BTC" / "btc".
function getSymbolFromSnapshot(input) {
    if (!_lastSnapshot || typeof input !== 'string') return null;
    let needle = input.trim().toUpperCase();
    if (!needle) return null;
    if (!needle.endsWith('USDT')) needle = needle + 'USDT';
    return _lastSnapshot.tickers.find(t => t.symbol === needle) || null;
}

// Test hooks — never invoked în prod runtime
function _ingestSnapshotForTest(tickers) { _setSnapshot(tickers); }
function _resetSnapshotForTest() { _lastSnapshot = null; _snapshotStale = false; }

module.exports = {
    start, stop, getState,
    // [Day 32A] Snapshot accessors for chat/analytics layer
    getTopSnapshot, getSymbolFromSnapshot,
    _ingestSnapshotForTest, _resetSnapshotForTest,
    // [2026-06-13] P5-starvation fix — disk-persisted last-good snapshot
    _persistSnapshotToDisk, _rehydrateIfEmpty,
};
