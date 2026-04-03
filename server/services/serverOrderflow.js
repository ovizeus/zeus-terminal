// Zeus Terminal — Order Flow Analysis (Brain V2 — Phase 1D)
// Tracks aggTrade events for CVD, taker buy/sell volume, and volume profile.
// Provides order flow score for brain fusion.
'use strict';

const logger = require('./logger');
const marketFeed = require('./marketFeed');

// ══════════════════════════════════════════════════════════════════
// Configuration
// ══════════════════════════════════════════════════════════════════
const WINDOW_MS = 300000;           // 5-minute rolling window for delta
const VP_BUCKET_COUNT = 50;         // volume profile buckets
const VP_WINDOW_MS = 86400000;      // 24h for volume profile
const CLEANUP_INTERVAL = 60000;     // cleanup old trades every 60s

// ══════════════════════════════════════════════════════════════════
// Per-symbol state
// ══════════════════════════════════════════════════════════════════
const _state = new Map(); // symbol → { trades[], cvd, buyVol, sellVol, vpBuckets, vpRange }

function _getState(symbol) {
    const key = symbol.toUpperCase();
    if (!_state.has(key)) {
        _state.set(key, {
            trades: [],         // recent trades for delta calculation
            cvd: 0,             // cumulative volume delta (running)
            buyVol5m: 0,        // cached 5-min taker buy volume
            sellVol5m: 0,       // cached 5-min taker sell volume
            vpBuckets: null,    // volume profile { buckets[], poc, vah, val }
            vpTrades: [],       // trades for VP (24h window)
            lastCleanup: 0,
        });
    }
    return _state.get(key);
}

// ══════════════════════════════════════════════════════════════════
// Initialize — listen for aggTrade events
// ══════════════════════════════════════════════════════════════════
let _initialized = false;
let _cleanupTimer = null;

function init() {
    if (_initialized) return;
    _initialized = true;

    marketFeed.on('aggTrade', _onAggTrade);
    _cleanupTimer = setInterval(_cleanupAll, CLEANUP_INTERVAL);
    logger.info('FLOW', 'Order flow analysis initialized');
}

function _onAggTrade(data) {
    const st = _getState(data.symbol);
    const now = Date.now();
    const vol = data.price * data.qty; // notional volume

    // isBuyerMaker = true means the buyer was the maker → taker is SELLER
    const isTakerBuy = !data.isBuyerMaker;
    const delta = isTakerBuy ? vol : -vol;

    // Add to trades buffer
    st.trades.push({ ts: data.ts || now, delta, vol, price: data.price });

    // Update running CVD
    st.cvd += delta;

    // Add to VP trades (lighter — just price + vol)
    st.vpTrades.push({ ts: now, price: data.price, vol });
}

// ══════════════════════════════════════════════════════════════════
// Compute 5-minute delta and volumes
// ══════════════════════════════════════════════════════════════════
function _compute5mDelta(st) {
    const now = Date.now();
    const cutoff = now - WINDOW_MS;
    let buy = 0, sell = 0;

    for (let i = st.trades.length - 1; i >= 0; i--) {
        if (st.trades[i].ts < cutoff) break;
        if (st.trades[i].delta > 0) buy += st.trades[i].delta;
        else sell += Math.abs(st.trades[i].delta);
    }

    st.buyVol5m = buy;
    st.sellVol5m = sell;
    return { buy, sell, delta: buy - sell };
}

// ══════════════════════════════════════════════════════════════════
// Volume Profile — POC, VAH, VAL
// ══════════════════════════════════════════════════════════════════
function _computeVP(st) {
    if (st.vpTrades.length < 100) return null;

    const cutoff = Date.now() - VP_WINDOW_MS;
    const trades = st.vpTrades.filter(t => t.ts >= cutoff);
    if (trades.length < 100) return null;

    // Find price range
    let minP = Infinity, maxP = -Infinity;
    for (const t of trades) {
        if (t.price < minP) minP = t.price;
        if (t.price > maxP) maxP = t.price;
    }

    const range = maxP - minP;
    if (range <= 0) return null;

    const bucketSize = range / VP_BUCKET_COUNT;
    const buckets = new Array(VP_BUCKET_COUNT).fill(0);

    // Distribute volume into buckets
    for (const t of trades) {
        const idx = Math.min(VP_BUCKET_COUNT - 1, Math.floor((t.price - minP) / bucketSize));
        buckets[idx] += t.vol;
    }

    // Find POC (Point of Control) — bucket with most volume
    let pocIdx = 0;
    for (let i = 1; i < buckets.length; i++) {
        if (buckets[i] > buckets[pocIdx]) pocIdx = i;
    }

    const poc = minP + (pocIdx + 0.5) * bucketSize;

    // VAH/VAL — value area containing 70% of volume
    const totalVol = buckets.reduce((s, v) => s + v, 0);
    const target = totalVol * 0.7;
    let accumulated = buckets[pocIdx];
    let lo = pocIdx, hi = pocIdx;

    while (accumulated < target && (lo > 0 || hi < VP_BUCKET_COUNT - 1)) {
        const loVol = lo > 0 ? buckets[lo - 1] : 0;
        const hiVol = hi < VP_BUCKET_COUNT - 1 ? buckets[hi + 1] : 0;
        if (loVol >= hiVol && lo > 0) { lo--; accumulated += buckets[lo]; }
        else if (hi < VP_BUCKET_COUNT - 1) { hi++; accumulated += buckets[hi]; }
        else if (lo > 0) { lo--; accumulated += buckets[lo]; }
        else break;
    }

    const val = minP + lo * bucketSize;
    const vah = minP + (hi + 1) * bucketSize;

    st.vpBuckets = { poc, vah, val, bucketSize, minP, maxP };
    return st.vpBuckets;
}

// ══════════════════════════════════════════════════════════════════
// Cleanup old data
// ══════════════════════════════════════════════════════════════════
function _cleanupAll() {
    const now = Date.now();
    const tradeCutoff = now - WINDOW_MS * 2; // keep 2× window for safety
    const vpCutoff = now - VP_WINDOW_MS;

    for (const [, st] of _state) {
        // [H4] Trim trades — single splice instead of O(n) shift loop
        const ti = st.trades.findIndex(t => t.ts >= tradeCutoff);
        if (ti > 0) st.trades.splice(0, ti);
        else if (ti === -1 && st.trades.length > 0) st.trades.length = 0;
        // [H4] Trim VP trades — single splice
        const vi = st.vpTrades.findIndex(t => t.ts >= vpCutoff);
        if (vi > 0) st.vpTrades.splice(0, vi);
        else if (vi === -1 && st.vpTrades.length > 0) st.vpTrades.length = 0;
        // Cap VP trades to prevent memory growth
        if (st.vpTrades.length > 50000) {
            st.vpTrades.splice(0, st.vpTrades.length - 50000);
        }
    }
}

// ══════════════════════════════════════════════════════════════════
// Public API
// ══════════════════════════════════════════════════════════════════

/**
 * Get order flow analysis for a symbol.
 * @param {string} symbol
 * @returns {{ delta5m: number, cvd: number, buyVol: number, sellVol: number, absorptionScore: number, poc: number|null, vah: number|null, val: number|null }}
 */
function getFlow(symbol) {
    const st = _getState((symbol || '').toUpperCase());
    const d = _compute5mDelta(st);
    const vp = _computeVP(st);

    // Absorption score: when one side has heavy volume but price doesn't move
    // = large volume imbalance but delta is small relative to total
    const totalVol = d.buy + d.sell;
    let absorptionScore = 0;
    if (totalVol > 0) {
        const deltaRatio = Math.abs(d.delta) / totalVol; // 0 = balanced, 1 = one-sided
        // Low delta ratio with high volume = absorption
        absorptionScore = Math.max(0, 1 - deltaRatio * 2) * Math.min(1, totalVol / 100000);
    }

    return {
        delta5m: d.delta,
        cvd: st.cvd,
        buyVol: d.buy,
        sellVol: d.sell,
        absorptionScore,
        poc: vp ? vp.poc : null,
        vah: vp ? vp.vah : null,
        val: vp ? vp.val : null,
    };
}

/**
 * Calculate flow modifier for brain fusion.
 * CVD agreeing with trade direction = boost.
 * @param {string} tradeDir - 'bull' or 'bear'
 * @param {object} flow - from getFlow()
 * @returns {number} score 0-1 for fusion (0.5 = neutral)
 */
function getFlowScore(tradeDir, flow) {
    if (!flow) return 0.5;

    let score = 0.5;

    // CVD direction alignment
    if (flow.delta5m !== 0) {
        const deltaDir = flow.delta5m > 0 ? 'bull' : 'bear';
        if (deltaDir === tradeDir) {
            // Aligned — boost proportional to strength
            const strength = Math.min(1, Math.abs(flow.delta5m) / 50000);
            score += strength * 0.3;
        } else {
            // Against — penalty proportional to strength
            const strength = Math.min(1, Math.abs(flow.delta5m) / 50000);
            score -= strength * 0.25;
        }
    }

    // Absorption (large volume absorbed without price move) = potential reversal
    if (flow.absorptionScore > 0.5) {
        score -= 0.1; // cautious when absorption detected
    }

    return Math.max(0, Math.min(1, score));
}

function destroy() {
    if (_cleanupTimer) { clearInterval(_cleanupTimer); _cleanupTimer = null; }
    _initialized = false;
}

module.exports = {
    init,
    getFlow,
    getFlowScore,
    destroy,
};
