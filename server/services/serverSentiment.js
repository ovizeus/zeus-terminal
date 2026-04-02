// Zeus Terminal — Sentiment Proxy (Brain V2 — Phase 3J)
// Polls Binance public endpoints for L/S ratio, funding trend, taker ratio.
// Provides contrarian sentiment score for brain fusion.
'use strict';

const logger = require('./logger');

// ══════════════════════════════════════════════════════════════════
// Configuration
// ══════════════════════════════════════════════════════════════════
const POLL_INTERVAL = 300000;   // 5 minutes
const BASE_URL = 'https://fapi.binance.com';

// ══════════════════════════════════════════════════════════════════
// Per-symbol state
// ══════════════════════════════════════════════════════════════════
const _cache = new Map(); // symbol → { compositeScore, crowdPosition, fundingTrend, ts }
let _symbols = [];
let _timer = null;

// ══════════════════════════════════════════════════════════════════
// Start / Stop
// ══════════════════════════════════════════════════════════════════
function start(symbols) {
    _symbols = (symbols || []).map(s => s.toUpperCase());
    if (_timer) clearInterval(_timer);
    if (_symbols.length === 0) return;

    _timer = setInterval(_pollAll, POLL_INTERVAL);
    setTimeout(_pollAll, 15000); // first poll after 15s
    logger.info('SENT', `Sentiment polling started for [${_symbols.join(',')}] every ${POLL_INTERVAL / 1000}s`);
}

function stop() {
    if (_timer) { clearInterval(_timer); _timer = null; }
}

// ══════════════════════════════════════════════════════════════════
// Data fetching
// ══════════════════════════════════════════════════════════════════
async function _pollAll() {
    for (const sym of _symbols) {
        try {
            await _pollSymbol(sym);
        } catch (err) {
            logger.warn('SENT', `Poll failed for ${sym}: ${err.message}`);
        }
    }
}

async function _fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function _pollSymbol(symbol) {
    const period = '5m';
    const limit = 5; // last 5 data points

    // Fetch in parallel
    const [lsGlobal, lsTop, takerRatio, fundingHist] = await Promise.allSettled([
        _fetchJson(`${BASE_URL}/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=${period}&limit=${limit}`),
        _fetchJson(`${BASE_URL}/futures/data/topLongShortPositionRatio?symbol=${symbol}&period=${period}&limit=${limit}`),
        _fetchJson(`${BASE_URL}/futures/data/takerlongshortRatio?symbol=${symbol}&period=${period}&limit=${limit}`),
        _fetchJson(`${BASE_URL}/fapi/v1/fundingRate?symbol=${symbol}&limit=8`),
    ]);

    let crowdBullish = 0; // -1 to +1 (positive = crowd is bullish)
    let dataPoints = 0;

    // Global L/S ratio — >1 means more longs
    if (lsGlobal.status === 'fulfilled' && lsGlobal.value.length > 0) {
        const latest = lsGlobal.value[lsGlobal.value.length - 1];
        const ratio = parseFloat(latest.longShortRatio);
        if (!isNaN(ratio)) {
            // ratio 1.0 = balanced. >1.5 = very bullish crowd, <0.67 = very bearish crowd
            crowdBullish += Math.max(-1, Math.min(1, (ratio - 1) * 2));
            dataPoints++;
        }
    }

    // Top traders L/S ratio
    if (lsTop.status === 'fulfilled' && lsTop.value.length > 0) {
        const latest = lsTop.value[lsTop.value.length - 1];
        const ratio = parseFloat(latest.longShortRatio);
        if (!isNaN(ratio)) {
            crowdBullish += Math.max(-1, Math.min(1, (ratio - 1) * 2));
            dataPoints++;
        }
    }

    // Taker buy/sell ratio — >1 means more taker buying
    if (takerRatio.status === 'fulfilled' && takerRatio.value.length > 0) {
        const latest = takerRatio.value[takerRatio.value.length - 1];
        const ratio = parseFloat(latest.buySellRatio);
        if (!isNaN(ratio)) {
            crowdBullish += Math.max(-1, Math.min(1, (ratio - 1) * 3)); // taker is more sensitive
            dataPoints++;
        }
    }

    // Funding rate trend — positive = longs pay shorts = bullish crowd
    let fundingTrend = 0;
    if (fundingHist.status === 'fulfilled' && fundingHist.value.length >= 3) {
        const rates = fundingHist.value.map(f => parseFloat(f.fundingRate)).filter(r => !isNaN(r));
        if (rates.length >= 3) {
            const avg = rates.reduce((s, r) => s + r, 0) / rates.length;
            fundingTrend = Math.max(-1, Math.min(1, avg * 10000)); // scale: 0.01% → strong signal
            crowdBullish += fundingTrend * 0.5; // funding is secondary
            dataPoints += 0.5;
        }
    }

    if (dataPoints === 0) return;

    const avgCrowd = crowdBullish / dataPoints; // -1 to +1

    // Contrarian composite: if crowd is very bullish → bearish signal, and vice versa
    // Score: -100 (very bearish signal) to +100 (very bullish signal)
    const compositeScore = Math.round(-avgCrowd * 100); // flip sign = contrarian

    _cache.set(symbol, {
        compositeScore,
        crowdPosition: avgCrowd > 0.2 ? 'bullish' : avgCrowd < -0.2 ? 'bearish' : 'neutral',
        fundingTrend: fundingTrend > 0.2 ? 'positive' : fundingTrend < -0.2 ? 'negative' : 'neutral',
        rawCrowd: Math.round(avgCrowd * 100),
        ts: Date.now(),
    });
}

// ══════════════════════════════════════════════════════════════════
// Public API
// ══════════════════════════════════════════════════════════════════

/**
 * Get sentiment for a symbol.
 * @returns {{ compositeScore: number, crowdPosition: string, fundingTrend: string }}
 */
function getSentiment(symbol) {
    return _cache.get((symbol || '').toUpperCase()) || {
        compositeScore: 0,
        crowdPosition: 'neutral',
        fundingTrend: 'neutral',
        rawCrowd: 0,
        ts: 0,
    };
}

/**
 * Get sentiment score for fusion (0-1, where 0.5 = neutral).
 * Contrarian: if crowd is extremely bullish → score < 0.5 (bearish signal for longs).
 * @param {string} tradeDir - 'bull' or 'bear'
 * @param {object} sent - from getSentiment()
 * @returns {number} 0-1
 */
function getSentimentScore(tradeDir, sent) {
    if (!sent || sent.ts === 0) return 0.5;

    // compositeScore is already contrarian: positive = bullish signal
    const score = sent.compositeScore; // -100 to +100

    if (tradeDir === 'bull') {
        // Positive composite = contrarian says bullish = good for longs
        return Math.max(0, Math.min(1, 0.5 + score / 200));
    } else if (tradeDir === 'bear') {
        // Negative composite = contrarian says bearish = good for shorts
        return Math.max(0, Math.min(1, 0.5 - score / 200));
    }

    return 0.5;
}

module.exports = {
    start,
    stop,
    getSentiment,
    getSentimentScore,
};
