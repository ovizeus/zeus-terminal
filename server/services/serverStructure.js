// Zeus Terminal — Market Structure Analysis (Brain V2 — Phase 1B)
// Detects Break of Structure (BOS) and Change of Character (CHoCH)
// from swing pivots. Provides structural trend bias for brain fusion.
'use strict';

const logger = require('./logger');
const { teacherSwingPivots } = require('../shared/teacher/teacherIndicators');

// ══════════════════════════════════════════════════════════════════
// Per-symbol structure cache
// ══════════════════════════════════════════════════════════════════
const _cache = new Map(); // symbol → { trend, lastBOS, lastCHoCH, structureScore, ts }

const RECOMPUTE_MIN_MS = 5000; // min 5s between recomputes

// ══════════════════════════════════════════════════════════════════
// Core: detect structure from swing pivots
// ══════════════════════════════════════════════════════════════════

/**
 * Classify swing pivot sequence into trend + BOS/CHoCH events.
 *
 * HH + HL = uptrend (BOS up = continuation)
 * LL + LH = downtrend (BOS down = continuation)
 * Break of previous swing in opposite direction = CHoCH (reversal)
 *
 * @param {Array} bars - OHLCV bars (need ≥60)
 * @returns {{ trend: string, lastBOS: object|null, lastCHoCH: object|null, structureScore: number }}
 */
function _analyzeStructure(bars) {
    if (!bars || bars.length < 60) {
        return { trend: 'none', lastBOS: null, lastCHoCH: null, structureScore: 0.5 };
    }

    // Get swing pivots — use lookback=100 for more data, win=3 for confirmed swings
    const pivots = teacherSwingPivots(bars, Math.min(bars.length, 100), 3);
    const highs = pivots.highs; // up to 3 most recent
    const lows = pivots.lows;   // up to 3 most recent

    if (highs.length < 2 || lows.length < 2) {
        return { trend: 'none', lastBOS: null, lastCHoCH: null, structureScore: 0.5 };
    }

    // Compare last two swing highs and lows
    const h1 = highs[highs.length - 2], h2 = highs[highs.length - 1]; // h2 = most recent
    const l1 = lows[lows.length - 2],   l2 = lows[lows.length - 1];

    const HH = h2.price > h1.price;
    const HL = l2.price > l1.price;
    const LL = l2.price < l1.price;
    const LH = h2.price < h1.price;

    let trend = 'range';
    let lastBOS = null;
    let lastCHoCH = null;

    // ── Determine trend from structure ──
    if (HH && HL) {
        // Uptrend: higher highs + higher lows
        trend = 'up';
        lastBOS = { dir: 'up', price: h2.price, ts: h2.ts, type: 'BOS' };
    } else if (LL && LH) {
        // Downtrend: lower lows + lower highs
        trend = 'down';
        lastBOS = { dir: 'down', price: l2.price, ts: l2.ts, type: 'BOS' };
    }

    // ── Detect CHoCH (Change of Character = reversal signal) ──
    // CHoCH up: was making LL but now made HL (or broke last swing high)
    // CHoCH down: was making HH but now made LH (or broke last swing low)
    const price = bars[bars.length - 1].close;

    if (trend === 'up' || (HH && !HL)) {
        // In uptrend or mixed-up: if price breaks below last swing low → CHoCH down
        if (price < l2.price) {
            lastCHoCH = { dir: 'down', price: l2.price, ts: Date.now(), type: 'CHoCH' };
            trend = 'choch_down'; // structure breaking
        }
    }
    if (trend === 'down' || (LL && !LH)) {
        // In downtrend or mixed-down: if price breaks above last swing high → CHoCH up
        if (price > h2.price) {
            lastCHoCH = { dir: 'up', price: h2.price, ts: Date.now(), type: 'CHoCH' };
            trend = 'choch_up'; // structure breaking
        }
    }

    // ── Structure score: 0 (bearish) to 1 (bullish) ──
    // Weighted by recency and clarity
    let score = 0.5; // neutral baseline

    if (trend === 'up') {
        // Strong uptrend: how clear are the HH/HL?
        const hhPct = (h2.price - h1.price) / h1.price;
        const hlPct = (l2.price - l1.price) / l1.price;
        score = Math.min(1, 0.65 + (hhPct + hlPct) * 50); // slight bull bias, grows with clarity
    } else if (trend === 'down') {
        const llPct = (l1.price - l2.price) / l1.price;
        const lhPct = (h1.price - h2.price) / h1.price;
        score = Math.max(0, 0.35 - (llPct + lhPct) * 50);
    } else if (trend === 'choch_down') {
        score = 0.25; // bearish reversal signal
    } else if (trend === 'choch_up') {
        score = 0.75; // bullish reversal signal
    }

    return { trend, lastBOS, lastCHoCH, structureScore: Math.max(0, Math.min(1, score)) };
}

// ══════════════════════════════════════════════════════════════════
// Public API
// ══════════════════════════════════════════════════════════════════

/**
 * Get market structure for a symbol.
 * @param {string} symbol
 * @param {Array} bars - kline bars for analysis (typically 5m chartTf)
 * @returns {{ trend: string, lastBOS: object|null, lastCHoCH: object|null, structureScore: number }}
 */
function getStructure(symbol, bars) {
    const key = (symbol || '').toUpperCase();
    const cached = _cache.get(key);
    const now = Date.now();

    // Return cache if fresh enough
    if (cached && (now - cached.ts) < RECOMPUTE_MIN_MS) {
        return cached;
    }

    const result = _analyzeStructure(bars);
    result.ts = now;
    _cache.set(key, result);

    return result;
}

/**
 * Calculate structure modifier for brain fusion.
 * CHoCH against trade direction = penalty.
 * BOS with trade direction = slight boost.
 * @param {string} tradeDir - 'bull' or 'bear'
 * @param {object} structure - from getStructure()
 * @returns {number} modifier 0.85 - 1.05
 */
function getStructureModifier(tradeDir, structure) {
    if (!structure || structure.trend === 'none' || structure.trend === 'range') {
        return 1.0; // no structural info → neutral
    }

    // CHoCH against trade direction → strong penalty
    if (structure.lastCHoCH) {
        if (tradeDir === 'bull' && structure.lastCHoCH.dir === 'down') return 0.85;
        if (tradeDir === 'bear' && structure.lastCHoCH.dir === 'up') return 0.85;
        // CHoCH with direction → slight boost
        if (tradeDir === 'bull' && structure.lastCHoCH.dir === 'up') return 1.05;
        if (tradeDir === 'bear' && structure.lastCHoCH.dir === 'down') return 1.05;
    }

    // BOS with trend = continuation confirmation
    if (structure.lastBOS) {
        if (tradeDir === 'bull' && structure.lastBOS.dir === 'up') return 1.03;
        if (tradeDir === 'bear' && structure.lastBOS.dir === 'down') return 1.03;
        // BOS against direction → mild penalty
        if (tradeDir === 'bull' && structure.lastBOS.dir === 'down') return 0.92;
        if (tradeDir === 'bear' && structure.lastBOS.dir === 'up') return 0.92;
    }

    return 1.0;
}

module.exports = {
    getStructure,
    getStructureModifier,
};
