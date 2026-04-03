// Zeus Terminal — Correlation Guard (Brain V3)
// Prevents opening multiple highly-correlated positions in the same direction.
// Uses live rolling correlation from serverCalibration + position awareness.
// *** Per-user isolated ***
'use strict';

const logger = require('./logger');
const serverCalibration = require('./serverCalibration');

// ══════════════════════════════════════════════════════════════════
// Configuration
// ══════════════════════════════════════════════════════════════════
const CORRELATION_BLOCK_THRESHOLD = 0.75;  // block if correlation > 75%
const MAX_CORRELATED_EXPOSURE = 2;         // max 2 positions in same correlated group + same direction

// ══════════════════════════════════════════════════════════════════
// Correlation Groups (pairs that move together)
// ══════════════════════════════════════════════════════════════════
const GROUPS = {
    'BTC_ECOSYSTEM': ['BTCUSDT'],
    'ETH_ECOSYSTEM': ['ETHUSDT'],
    'ALT_L1': ['SOLUSDT', 'AVAXUSDT', 'NEARUSDT', 'APTUSDT', 'SUIUSDT'],
    'DEFI': ['AAVEUSDT', 'LINKUSDT', 'UNIUSDT', 'MKRUSDT'],
    'MEME': ['DOGEUSDT', 'SHIBUSDT', 'PEPEUSDT', 'WIFUSDT', 'BONKUSDT'],
};

/**
 * Check if a new entry would create dangerous correlated exposure.
 * @param {string} symbol - Symbol to enter
 * @param {string} side - 'LONG' or 'SHORT'
 * @param {Array} openPositions - [{ symbol, side, size }]
 * @returns {{ allowed: bool, reason: string|null, correlatedWith: Array, exposure: object }}
 */
function checkEntry(symbol, side, openPositions) {
    if (!openPositions || openPositions.length === 0) {
        return { allowed: true, reason: null, correlatedWith: [], exposure: {} };
    }

    const correlatedWith = [];
    let sameDirCorrelated = 0;

    for (const pos of openPositions) {
        if (pos.symbol === symbol) continue; // duplicate guard is elsewhere

        const corr = serverCalibration.getCorrelation(symbol, pos.symbol);

        if (corr >= CORRELATION_BLOCK_THRESHOLD && pos.side === side) {
            sameDirCorrelated++;
            correlatedWith.push({
                symbol: pos.symbol,
                correlation: Math.round(corr * 100),
                side: pos.side,
            });
        }
    }

    if (sameDirCorrelated >= MAX_CORRELATED_EXPOSURE) {
        const pairNames = correlatedWith.map(c => c.symbol.replace('USDT', '')).join(', ');
        const reason = `Correlated exposure limit: already ${sameDirCorrelated} ${side} positions on correlated assets (${pairNames}). Max ${MAX_CORRELATED_EXPOSURE}.`;
        logger.info('CORR_GUARD', `BLOCKED ${side} ${symbol}: ${reason}`);
        return {
            allowed: false,
            reason,
            correlatedWith,
            exposure: _calcGroupExposure(openPositions, symbol, side),
        };
    }

    return {
        allowed: true,
        reason: null,
        correlatedWith,
        exposure: _calcGroupExposure(openPositions, symbol, side),
    };
}

/**
 * Calculate exposure per correlation group.
 */
function _calcGroupExposure(positions, newSymbol, newSide) {
    const exposure = {};
    const allSymbols = [...positions.map(p => ({ symbol: p.symbol, side: p.side })), { symbol: newSymbol, side: newSide }];

    for (const [group, members] of Object.entries(GROUPS)) {
        const inGroup = allSymbols.filter(p => members.includes(p.symbol));
        if (inGroup.length > 0) {
            const longs = inGroup.filter(p => p.side === 'LONG').length;
            const shorts = inGroup.filter(p => p.side === 'SHORT').length;
            exposure[group] = { longs, shorts, total: inGroup.length };
        }
    }

    // Also detect ungrouped correlated pairs
    for (let i = 0; i < allSymbols.length; i++) {
        for (let j = i + 1; j < allSymbols.length; j++) {
            const corr = serverCalibration.getCorrelation(allSymbols[i].symbol, allSymbols[j].symbol);
            if (corr >= 0.70) {
                const key = `${allSymbols[i].symbol.replace('USDT', '')}/${allSymbols[j].symbol.replace('USDT', '')}`;
                if (!exposure[key]) {
                    exposure[key] = {
                        correlation: Math.round(corr * 100),
                        sameDir: allSymbols[i].side === allSymbols[j].side,
                    };
                }
            }
        }
    }

    return exposure;
}

/**
 * Get correlation confidence modifier for brain fusion.
 * Penalizes entries that increase correlated exposure.
 * @returns {number} 0.7-1.0 multiplier
 */
function getCorrelationModifier(symbol, side, openPositions) {
    if (!openPositions || openPositions.length === 0) return 1.0;

    let maxCorr = 0;
    let sameDirCount = 0;

    for (const pos of openPositions) {
        if (pos.symbol === symbol) continue;
        const corr = serverCalibration.getCorrelation(symbol, pos.symbol);
        if (corr > maxCorr && pos.side === side) maxCorr = corr;
        if (corr >= 0.65 && pos.side === side) sameDirCount++;
    }

    // Progressive penalty: 1 correlated = 0.95, 2+ = 0.85
    if (sameDirCount >= 2 && maxCorr >= 0.7) return 0.80;
    if (sameDirCount >= 1 && maxCorr >= 0.7) return 0.90;
    if (maxCorr >= 0.6) return 0.95;
    return 1.0;
}

/**
 * Get full correlation analysis for dashboard UI.
 */
function getAnalysis(openPositions) {
    return serverCalibration.analyzeCorrelationRisk(openPositions);
}

module.exports = {
    checkEntry,
    getCorrelationModifier,
    getAnalysis,
    CORRELATION_BLOCK_THRESHOLD,
    MAX_CORRELATED_EXPOSURE,
};
