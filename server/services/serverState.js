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
};
