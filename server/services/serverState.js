// Zeus Terminal — Server State (Phase 2)
// SD = Server Data — mirrors client's S fields needed for brain decisions.
// Fed by marketFeed.js streams, computes indicators via teacher pure functions.
// Gated by MF.SERVER_MARKET_DATA flag.
'use strict';

const logger = require('./logger');
const marketFeed = require('./marketFeed');
const { TEACHER_IND_DEFAULTS } = require('../../public/js/teacher/teacherConfig');
const {
    teacherComputeIndicators,
    teacherCalcRSI,
    teacherCalcADX,
    teacherCalcATR,
} = require('../../public/js/teacher/teacherIndicators');

// ══════════════════════════════════════════════════════════════════
// SD — Server Data (mirrors client S fields for brain)
// ══════════════════════════════════════════════════════════════════
const SD = {
    // ── Identity ──
    symbol: null,
    chartTf: '5m',

    // ── Price ──
    price: 0,
    priceTs: 0,

    // ── Klines per timeframe ──
    klines: {},          // { '5m': [{time, open, high, low, close, volume}...], '1h': [...] }

    // ── Core indicators (latest values) ──
    rsi: {},             // { '5m': number, '1h': number }
    adx: null,           // number (from primary TF)
    atr: null,           // number (from primary TF)

    // ── Full indicator snapshot (from teacherComputeIndicators) ──
    indicators: null,    // { rsi, adx, macd, macdDir, stDir, atr, bb*, regime, confluence, ... }

    // ── Funding & OI ──
    fr: null,            // funding rate
    oi: null,            // open interest
    oiPrev: null,        // previous OI (for direction)

    // ── Metadata ──
    lastUpdate: 0,       // timestamp of last indicator computation
    lastKlineClose: {},  // { '5m': ts, '1h': ts } — last closed candle timestamp
    feedHealth: null,    // marketFeed health snapshot
};

// ── Indicator recompute throttle ──
let _lastComputeTs = 0;
const MIN_COMPUTE_INTERVAL = 2000;  // min 2s between recomputes

// ══════════════════════════════════════════════════════════════════
// Initialize — subscribe to market feed events
// ══════════════════════════════════════════════════════════════════
function init(symbol, timeframes) {
    SD.symbol = symbol;
    SD.chartTf = (timeframes && timeframes[0]) || '5m';
    SD.klines = {};
    SD.rsi = {};
    SD.lastKlineClose = {};
    for (const tf of (timeframes || ['5m'])) {
        SD.klines[tf] = [];
        SD.lastKlineClose[tf] = 0;
    }

    // Wire market feed events → SD
    marketFeed.on('kline', _onKline);
    marketFeed.on('price', _onPrice);
    marketFeed.on('fundingRate', _onFundingRate);
    marketFeed.on('openInterest', _onOpenInterest);

    logger.info('SD', `Server state initialized for ${symbol} [${(timeframes || ['5m']).join(',')}]`);
}

// ══════════════════════════════════════════════════════════════════
// Event handlers
// ══════════════════════════════════════════════════════════════════
function _onKline(data) {
    const tf = data.timeframe;
    if (!SD.klines[tf]) SD.klines[tf] = [];

    if (data.initial && data.bars) {
        // Initial candle load — replace entire array
        SD.klines[tf] = data.bars;
        logger.info('SD', `Loaded ${data.bars.length} initial candles for ${tf}`);
        _recomputeIndicators(tf);
        return;
    }

    if (data.bar) {
        const bars = SD.klines[tf];
        const bar = data.bar;

        // Update or append candle
        if (bars.length > 0 && bars[bars.length - 1].time === bar.time) {
            // Update current (unclosed) candle
            bars[bars.length - 1] = { time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume };
        } else {
            // New candle
            bars.push({ time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume });
            // Trim to keep max 1000 candles
            if (bars.length > 1000) bars.splice(0, bars.length - 1000);
        }

        // Update price
        if (bar.close > 0) {
            SD.price = bar.close;
            SD.priceTs = Date.now();
        }

        // Recompute indicators on candle close or periodic
        if (bar.closed) {
            SD.lastKlineClose[tf] = Date.now();
            _recomputeIndicators(tf);
        } else {
            // Throttled recompute for live candle updates
            const now = Date.now();
            if (now - _lastComputeTs > MIN_COMPUTE_INTERVAL) {
                _recomputeIndicators(tf);
            }
        }
    }
}

function _onPrice(data) {
    if (data.price > 0) {
        SD.price = data.price;
        SD.priceTs = Date.now();
        // [P5] Feed price to shadow AT for SL/TP tracking
        try {
            const serverAT = require('./serverAT');
            serverAT.onPriceUpdate(SD.symbol, data.price);
        } catch (_) { }
    }
}

function _onFundingRate(data) {
    SD.fr = data.rate;
}

function _onOpenInterest(data) {
    SD.oiPrev = SD.oi;
    SD.oi = data.value;
}

// ══════════════════════════════════════════════════════════════════
// Indicator computation (uses teacher pure functions)
// ══════════════════════════════════════════════════════════════════
function _recomputeIndicators(tf) {
    const bars = SD.klines[tf];
    if (!bars || bars.length < 30) return;

    _lastComputeTs = Date.now();

    try {
        // Full indicator computation via teacher master function
        const ind = teacherComputeIndicators(bars);
        SD.indicators = ind;
        SD.adx = ind.adx;
        SD.atr = ind.atr;
        SD.lastUpdate = Date.now();

        // Per-timeframe RSI
        const closes = bars.map(b => b.close);
        const rsiArr = teacherCalcRSI(closes);
        SD.rsi[tf] = rsiArr[rsiArr.length - 1];

    } catch (err) {
        logger.error('SD', `Indicator computation failed [${tf}]:`, err.message);
    }
}

// ══════════════════════════════════════════════════════════════════
// Snapshot — get current state for brain/AT decision
// ══════════════════════════════════════════════════════════════════
function getSnapshot() {
    return {
        symbol: SD.symbol,
        price: SD.price,
        priceTs: SD.priceTs,
        rsi: { ...SD.rsi },
        adx: SD.adx,
        atr: SD.atr,
        fr: SD.fr,
        oi: SD.oi,
        oiPrev: SD.oiPrev,
        indicators: SD.indicators ? { ...SD.indicators } : null,
        klineCount: Object.fromEntries(Object.entries(SD.klines).map(([tf, bars]) => [tf, bars.length])),
        lastUpdate: SD.lastUpdate,
        feedHealth: marketFeed.getHealth(),
        stale: (Date.now() - SD.priceTs) > marketFeed.STALE_DATA_MS,
    };
}

// ══════════════════════════════════════════════════════════════════
// isDataReady — check if we have enough data for brain decisions
// ══════════════════════════════════════════════════════════════════
function isDataReady() {
    const primaryBars = SD.klines[SD.chartTf] || [];
    return (
        SD.symbol !== null &&
        SD.price > 0 &&
        primaryBars.length >= 50 &&
        SD.indicators !== null &&
        SD.adx !== null
    );
}

// ══════════════════════════════════════════════════════════════════
// Expose
// ══════════════════════════════════════════════════════════════════
module.exports = {
    SD,         // direct access (read-only semantics)
    init,
    getSnapshot,
    isDataReady,
};
