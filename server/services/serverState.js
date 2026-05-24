// Zeus Terminal — Server State (Phase 2)
// SD = Server Data — mirrors client's S fields needed for brain decisions.
// Fed by marketFeed.js streams, computes indicators via teacher pure functions.
// Gated by MF.SERVER_MARKET_DATA flag.
// [MULTI-SYM] Supports multiple symbols via _sdMap.
'use strict';

const logger = require('./logger');
const marketFeed = require('./marketFeed');
const { TEACHER_IND_DEFAULTS } = require('../shared/teacher/teacherConfig');
const {
    teacherComputeIndicators,
    teacherCalcRSI,
    teacherCalcADX,
    teacherCalcATR,
} = require('../shared/teacher/teacherIndicators');

// ══════════════════════════════════════════════════════════════════
// [MULTI-SYM] Per-symbol state map
// ══════════════════════════════════════════════════════════════════
const _sdMap = new Map();       // symbol (uppercase) → SD object
let _primarySymbol = null;      // first symbol = backward compat alias

// [Bybit Phase 1A] Bi-namespaced per-exchange state.
// Existing _sdMap = Binance namespace (backward compat — all existing call sites
// continue to work unchanged via serverState.X(symbol)).
// _sdMap_bybit = separate per-symbol state populated by bybitFeed events (Task 22).
const _sdMap_binance = _sdMap; // alias the existing map (same reference)
const _sdMap_bybit = new Map();

function _getStateMapForExchange(exchange) {
    if (exchange === 'binance') return _sdMap_binance;
    if (exchange === 'bybit') return _sdMap_bybit;
    throw new Error(`serverState.forExchange: unknown exchange '${exchange}'`);
}

function forExchange(exchange) {
    const map = _getStateMapForExchange(exchange);
    return {
        rawExchange: exchange,

        getSnapshotForSymbol(symbol) {
            const sd = map.get(symbol ? symbol.toUpperCase() : '');
            if (!sd) return null;
            // Return a copy with exchange marker (don't expose internal mutation)
            return Object.assign({}, sd, { exchange });
        },

        getBarsForSymbol(symbol, tf) {
            const sd = map.get(symbol ? symbol.toUpperCase() : '');
            const k = sd && (sd.bars || sd.klines);
            if (!k) return [];
            return k[tf || sd.chartTf] || [];
        },

        getReadySymbols() {
            const ready = [];
            for (const [sym, sd] of map.entries()) {
                const k = sd && (sd.bars || sd.klines);
                if (sd && sd.price > 0 && k && Object.keys(k).length > 0) {
                    ready.push(sym);
                }
            }
            return ready;
        },

        isDataReadyForSymbol(symbol) {
            const sd = map.get(symbol ? symbol.toUpperCase() : '');
            const k = sd && (sd.bars || sd.klines);
            return !!(sd && sd.price > 0 && k && Object.keys(k).length > 0);
        },

        _getMap() {
            // Internal helper for Task 22 wiring (allows feed handlers to mutate the map)
            return map;
        },
    };
}

const MIN_COMPUTE_INTERVAL = 2000;  // min 2s between recomputes per symbol

// ── Factory: create a fresh SD for one symbol ──
function _createSD(symbol, timeframes) {
    const sd = {
        symbol: symbol,
        chartTf: (timeframes && timeframes[0]) || '5m',
        price: 0,
        priceTs: 0,
        klines: {},
        rsi: {},
        adx: null,
        atr: null,
        indicators: null,
        fr: null,
        oi: null,
        oiPrev: null,
        lastUpdate: 0,
        lastKlineClose: {},
        feedHealth: null,
        mtfIndicators: {},       // [BRAIN-V2] tf → { regime, stDir, rsi, adx, macdDir, trendBias }
        _lastComputeTs: 0,       // per-symbol recompute throttle
    };
    for (const tf of (timeframes || ['5m'])) {
        sd.klines[tf] = [];
        sd.lastKlineClose[tf] = 0;
    }
    return sd;
}

// ══════════════════════════════════════════════════════════════════
// SD — backward compat alias to primary symbol's state
// ══════════════════════════════════════════════════════════════════
const SD = _createSD(null, ['5m']);

// ══════════════════════════════════════════════════════════════════
// Initialize — subscribe to market feed events
// [MULTI-SYM] Accepts string or array of symbols
// ══════════════════════════════════════════════════════════════════
let _feedWired = false; // [RT-09] guard against duplicate listener registration
function init(symbols, timeframes) {
    const symArr = Array.isArray(symbols) ? symbols : [symbols];

    for (const sym of symArr) {
        const symUpper = sym.toUpperCase();
        const sd = _createSD(symUpper, timeframes);
        _sdMap.set(symUpper, sd);

        // First symbol = primary (backward compat)
        if (!_primarySymbol) {
            _primarySymbol = symUpper;
            // Copy into SD alias
            Object.assign(SD, sd);
            SD.symbol = symUpper;
        }
    }

    // [RT-09] Wire market feed events — guard prevents duplicate registration
    if (!_feedWired) {
        _feedWired = true;
        marketFeed.on('kline', _onKline);
        marketFeed.on('price', _onPrice);
        marketFeed.on('fundingRate', _onFundingRate);
        marketFeed.on('openInterest', _onOpenInterest);
    }

    // [Bybit Phase 1A Task 22] Wire bybit feed listeners (idempotent via flag)
    _wireBybitListeners();

    logger.info('SD', `Server state initialized for [${symArr.join(',')}] [${(timeframes || ['5m']).join(',')}]`);
}

// ══════════════════════════════════════════════════════════════════
// Event handlers — [MULTI-SYM] dispatch by symbol
// ══════════════════════════════════════════════════════════════════
function _getSD(symbol) {
    return _sdMap.get(symbol?.toUpperCase()) || null;
}

function _onKline(data) {
    const sd = _getSD(data.symbol);
    if (!sd) return;

    const tf = data.timeframe;
    if (!sd.klines[tf]) sd.klines[tf] = [];

    if (data.initial && data.bars) {
        sd.klines[tf] = data.bars;
        logger.info('SD', `Loaded ${data.bars.length} initial candles for ${sd.symbol} ${tf}`);
        _recomputeIndicators(sd, tf);
        // Sync SD alias
        if (sd.symbol === _primarySymbol) _syncAlias(sd);
        return;
    }

    if (data.bar) {
        const bars = sd.klines[tf];
        const bar = data.bar;

        if (bars.length > 0 && bars[bars.length - 1].time === bar.time) {
            bars[bars.length - 1] = { time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume };
        } else {
            bars.push({ time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume });
            if (bars.length > 1000) bars.splice(0, bars.length - 1000);
        }

        if (bar.close > 0) {
            sd.price = bar.close;
            sd.priceTs = Date.now();
        }

        if (bar.closed) {
            sd.lastKlineClose[tf] = Date.now();
            _recomputeIndicators(sd, tf);
        } else {
            const now = Date.now();
            if (now - sd._lastComputeTs > MIN_COMPUTE_INTERVAL) {
                _recomputeIndicators(sd, tf);
            }
        }

        // Sync SD alias
        if (sd.symbol === _primarySymbol) _syncAlias(sd);
    }
}

function _onPrice(data) {
    const sd = _getSD(data.symbol);
    if (!sd) return;

    if (data.price > 0) {
        sd.price = data.price;
        sd.priceTs = Date.now();
        // Feed price to AT for SL/TP tracking
        try {
            const serverAT = require('./serverAT');
            serverAT.onPriceUpdate(sd.symbol, data.price);
        } catch (_) { }
        // Sync SD alias
        if (sd.symbol === _primarySymbol) _syncAlias(sd);
    }
}

function _onFundingRate(data) {
    const sd = _getSD(data.symbol);
    if (!sd) return;
    sd.fr = data.rate;
    if (sd.symbol === _primarySymbol) SD.fr = data.rate;
}

function _onOpenInterest(data) {
    const sd = _getSD(data.symbol);
    if (!sd) return;
    sd.oiPrev = sd.oi;
    sd.oi = data.value;
    if (sd.symbol === _primarySymbol) { SD.oiPrev = SD.oi; SD.oi = data.value; }
}

// ══════════════════════════════════════════════════════════════════
// [Bybit Phase 1A Task 22] Bybit event handlers — populate _sdMap_bybit namespace.
// Mirror existing Binance handlers but write to the bybit-scoped Map.
// Snapshot shape uses `bars[tf]` (matches forExchange accessor in Task 21).
// Brain logic (Task 23) reads via serverState.forExchange('bybit').
// ══════════════════════════════════════════════════════════════════

function _createBybitSD(symbol) {
    return {
        symbol: symbol,
        price: 0,
        priceTs: 0,
        bid: null,
        ask: null,
        fr: null,
        markPrice: null,
        indexPrice: null,
        bars: {},   // tf → bar[]  (forExchange accessor uses sd.bars[tf])
        // Fix #1: Brain checks `if (!snap.indicators) continue` — without this field
        // all Bybit symbols are skipped. Initialize as null; populated by _recomputeBybitIndicators.
        indicators: null,
        rsi: {},
        adx: null,
        atr: null,
        klines: {},          // alias for bars — _recomputeIndicators reads sd.klines[tf]
        chartTf: '5m',
        lastUpdate: 0,
        lastKlineClose: {},
        mtfIndicators: {},
        _lastComputeTs: 0,
    };
}

function _onKlineBybit(data) {
    if (!data || !data.symbol || !data.tf) return;
    const sym = data.symbol.toUpperCase();
    let sd = _sdMap_bybit.get(sym);
    if (!sd) {
        sd = _createBybitSD(sym);
        _sdMap_bybit.set(sym, sd);
    }
    if (!sd.bars[data.tf]) sd.bars[data.tf] = [];
    // Fix #1 cont'd: keep klines in sync with bars (klines is the alias _recomputeIndicators reads)
    if (!sd.klines[data.tf]) sd.klines[data.tf] = sd.bars[data.tf];
    const arr = sd.bars[data.tf];
    const last = arr.length > 0 ? arr[arr.length - 1] : null;
    // Fix #13: Use 'time' key (matching Binance convention) so indicator computation
    // and brain logic see a consistent bar shape across exchanges.
    if (last && last.time === data.ts) {
        // Update existing bar (same timestamp = live candle update)
        last.close = data.close;
        last.high = Math.max(last.high, data.high);
        last.low = Math.min(last.low, data.low);
        last.volume = data.volume;
    } else {
        arr.push({ time: data.ts, open: data.open, high: data.high, low: data.low, close: data.close, volume: data.volume });
        // Cap buffer at 500 candles (matches Binance 1000-candle pattern, halved for bybit)
        if (arr.length > 500) arr.shift();
    }
    // Fix #1 cont'd: Trigger indicator recomputation after kline update (same as Binance path).
    // Throttled to MIN_COMPUTE_INTERVAL to avoid excessive computation.
    if (arr.length >= 30) {
        const now = Date.now();
        if (now - sd._lastComputeTs > MIN_COMPUTE_INTERVAL) {
            _recomputeIndicators(sd, data.tf);
        }
    }
}

function _onTradeBybit(data) {
    if (!data || !data.symbol) return;
    const sym = data.symbol.toUpperCase();
    let sd = _sdMap_bybit.get(sym);
    if (!sd) {
        sd = _createBybitSD(sym);
        _sdMap_bybit.set(sym, sd);
    }
    if (data.price > 0) {
        sd.price = data.price;
        sd.priceTs = Date.now();
    }
}

function _onBookTickerBybit(data) {
    if (!data || !data.symbol) return;
    const sym = data.symbol.toUpperCase();
    let sd = _sdMap_bybit.get(sym);
    if (!sd) {
        sd = _createBybitSD(sym);
        _sdMap_bybit.set(sym, sd);
    }
    if (data.bid > 0 && data.ask > 0) {
        sd.bid = data.bid;
        sd.ask = data.ask;
        sd.price = (data.bid + data.ask) / 2;
        sd.priceTs = Date.now();
    }
}

function _onMarkPriceBybit(data) {
    if (!data || !data.symbol) return;
    const sym = data.symbol.toUpperCase();
    let sd = _sdMap_bybit.get(sym);
    if (!sd) {
        // markPrice can arrive before kline/trade — create empty entry
        sd = _createBybitSD(sym);
        _sdMap_bybit.set(sym, sd);
    }
    if (data.markPrice != null) sd.markPrice = data.markPrice;
    if (data.fundingRate != null) sd.fr = data.fundingRate;
    if (data.indexPrice != null) sd.indexPrice = data.indexPrice;
}

// [Bybit Phase 1A Task 22] Wire bybit listeners — idempotent.
let _bybitFeedWired = false;
function _wireBybitListeners() {
    if (_bybitFeedWired) return;
    _bybitFeedWired = true;
    try {
        const bybitFeed = require('./bybitFeed');
        bybitFeed.on('kline', _onKlineBybit);
        bybitFeed.on('trade', _onTradeBybit);
        bybitFeed.on('bookTicker', _onBookTickerBybit);
        bybitFeed.on('markPrice', _onMarkPriceBybit);
    } catch (err) {
        try { logger.error('SERVER_STATE', `bybit wire failed: ${err.message}`); } catch (_) {}
        _bybitFeedWired = false;  // allow retry on next init() call
    }
}

// ── Sync SD alias (backward compat for code reading SD directly) ──
function _syncAlias(sd) {
    SD.price = sd.price;
    SD.priceTs = sd.priceTs;
    SD.klines = sd.klines;
    SD.rsi = sd.rsi;
    SD.adx = sd.adx;
    SD.atr = sd.atr;
    SD.indicators = sd.indicators;
    SD.mtfIndicators = sd.mtfIndicators;
    SD.lastUpdate = sd.lastUpdate;
    SD.lastKlineClose = sd.lastKlineClose;
}

// ══════════════════════════════════════════════════════════════════
// Indicator computation (uses teacher pure functions)
// ══════════════════════════════════════════════════════════════════
function _recomputeIndicators(sd, tf) {
    const bars = sd.klines[tf];
    if (!bars || bars.length < 30) return;

    sd._lastComputeTs = Date.now();

    try {
        const ind = teacherComputeIndicators(bars);

        // [BRAIN-V2] Store per-TF indicator snapshot for multi-timeframe analysis
        sd.mtfIndicators[tf] = {
            regime: ind.regime || 'RANGE',
            stDir: ind.stDir || 'neut',
            macdDir: ind.macdDir || 'neut',
            adx: ind.adx,
            trendBias: ind.trendBias || 'neutral',
        };

        // Primary indicators (overwritten by whichever TF recomputes — chartTf takes priority)
        if (tf === sd.chartTf) {
            sd.indicators = ind;
            sd.adx = ind.adx;
            sd.atr = ind.atr;
        }
        sd.lastUpdate = Date.now();

        const closes = bars.map(b => b.close);
        const rsiArr = teacherCalcRSI(closes);
        sd.rsi[tf] = rsiArr[rsiArr.length - 1];
        sd.mtfIndicators[tf].rsi = sd.rsi[tf];

    } catch (err) {
        logger.error('SD', `Indicator computation failed [${sd.symbol} ${tf}]:`, err.message);
    }
}

// ══════════════════════════════════════════════════════════════════
// Snapshot — get current state for brain/AT decision
// ══════════════════════════════════════════════════════════════════

// [MULTI-SYM] Get snapshot for a specific symbol
function getSnapshotForSymbol(symbol) {
    const sd = _sdMap.get(symbol?.toUpperCase());
    if (!sd) return null;
    return {
        symbol: sd.symbol,
        price: sd.price,
        priceTs: sd.priceTs,
        rsi: { ...sd.rsi },
        adx: sd.adx,
        atr: sd.atr,
        fr: sd.fr,
        oi: sd.oi,
        oiPrev: sd.oiPrev,
        indicators: sd.indicators ? { ...sd.indicators } : null,
        mtfIndicators: sd.mtfIndicators ? { ...sd.mtfIndicators } : {},  // [BRAIN-V2]
        klineCount: Object.fromEntries(Object.entries(sd.klines).map(([tf, bars]) => [tf, bars.length])),
        lastUpdate: sd.lastUpdate,
        feedHealth: marketFeed.getHealth(),
        stale: (Date.now() - sd.priceTs) > marketFeed.STALE_DATA_MS,
    };
}

// Backward compat: returns primary symbol snapshot
function getSnapshot() {
    return getSnapshotForSymbol(_primarySymbol);
}

// ══════════════════════════════════════════════════════════════════
// isDataReady — check if we have enough data for brain decisions
// ══════════════════════════════════════════════════════════════════

// [MULTI-SYM] Check specific symbol
function isDataReadyForSymbol(symbol) {
    const sd = _sdMap.get(symbol?.toUpperCase());
    if (!sd) return false;
    const primaryBars = sd.klines[sd.chartTf] || [];
    return (
        sd.symbol !== null &&
        sd.price > 0 &&
        primaryBars.length >= 50 &&
        sd.indicators !== null &&
        sd.adx !== null
    );
}

// Backward compat: checks primary symbol
function isDataReady() {
    return isDataReadyForSymbol(_primarySymbol);
}

// [MULTI-SYM] Get all symbols that have enough data
function getReadySymbols() {
    const ready = [];
    for (const sym of _sdMap.keys()) {
        if (isDataReadyForSymbol(sym)) ready.push(sym);
    }
    return ready;
}

// [MULTI-SYM] Get all configured symbols
function getConfiguredSymbols() {
    return [..._sdMap.keys()];
}

// [BRAIN-V2] Get raw kline bars for a symbol+tf (for structure/liquidity analysis)
function getBarsForSymbol(symbol, tf) {
    const sd = _sdMap.get(symbol?.toUpperCase());
    if (!sd) return [];
    return sd.klines[tf || sd.chartTf] || [];
}

// ══════════════════════════════════════════════════════════════════
// Expose
// ══════════════════════════════════════════════════════════════════
module.exports = {
    SD,                      // backward compat alias (primary symbol)
    init,
    getSnapshot,             // backward compat (primary symbol)
    getSnapshotForSymbol,    // [MULTI-SYM]
    isDataReady,             // backward compat (primary symbol)
    isDataReadyForSymbol,    // [MULTI-SYM]
    getReadySymbols,         // [MULTI-SYM]
    getConfiguredSymbols,    // [MULTI-SYM]
    getBarsForSymbol,        // [BRAIN-V2] raw kline bars for structure/liquidity analysis
    forExchange,             // [Bybit Phase 1A Task 21]
    _wireBybitListeners,     // [Bybit Phase 1A Task 22] exposed for test setup / re-wire
};
