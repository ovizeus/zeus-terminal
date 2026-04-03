// Zeus Terminal — Multi-Entry Scaling / Pyramiding (Brain V3)
// Allows adding to winning positions (pyramiding) when conditions are met.
// Reduces size for each additional entry. Tracks scaling levels.
// *** Per-user isolated ***
'use strict';

const logger = require('./logger');

// ══════════════════════════════════════════════════════════════════
// Configuration
// ══════════════════════════════════════════════════════════════════
const MAX_SCALE_INS = 2;            // max 2 additional entries (3 total)
const MIN_PROFIT_PCT = 0.4;         // position must be +0.4% before adding
const SCALE_SIZE_DECAY = [1.0, 0.6, 0.35]; // 1st=100%, 2nd=60%, 3rd=35%
const MIN_CONFIDENCE = 70;           // brain confidence must be >= 70 for scale-in
const COOLDOWN_BETWEEN_ADDS = 120000; // 2min between scale-ins

// Per-user scaling state
const _scaleState = new Map(); // userId → Map<symbol, { count, lastAddTs, levels: [{ts, price, size}] }>

function _getState(userId, symbol) {
    if (!_scaleState.has(userId)) _scaleState.set(userId, new Map());
    const userMap = _scaleState.get(userId);
    if (!userMap.has(symbol)) userMap.set(symbol, { count: 0, lastAddTs: 0, levels: [] });
    return userMap.get(symbol);
}

// ══════════════════════════════════════════════════════════════════
// Scale-In Decision
// ══════════════════════════════════════════════════════════════════

/**
 * Check if we should add to an existing position.
 * @param {object} position - existing position { symbol, side, entryPrice, currentPrice, pnlPct, userId }
 * @param {number} confidence - brain confidence for the same direction
 * @param {string} regime - current regime
 * @returns {{ shouldScale: bool, sizeMultiplier: number, reason: string }}
 */
function checkScaleIn(position, confidence, regime) {
    if (!position || !position.userId) {
        return { shouldScale: false, sizeMultiplier: 0, reason: 'no_position' };
    }

    const state = _getState(position.userId, position.symbol);

    // Max entries reached
    if (state.count >= MAX_SCALE_INS) {
        return { shouldScale: false, sizeMultiplier: 0, reason: 'max_scale_reached' };
    }

    // Cooldown between adds
    if (Date.now() - state.lastAddTs < COOLDOWN_BETWEEN_ADDS) {
        return { shouldScale: false, sizeMultiplier: 0, reason: 'scale_cooldown' };
    }

    // Position must be profitable
    const pnlPct = position.pnlPct || 0;
    if (pnlPct < MIN_PROFIT_PCT) {
        return { shouldScale: false, sizeMultiplier: 0, reason: 'insufficient_profit' };
    }

    // Brain must be confident
    if (confidence < MIN_CONFIDENCE) {
        return { shouldScale: false, sizeMultiplier: 0, reason: 'low_confidence' };
    }

    // Don't pyramid in volatile/chaos regimes
    if (regime === 'VOLATILE' || regime === 'CHAOS' || regime === 'LIQUIDATION_EVENT') {
        return { shouldScale: false, sizeMultiplier: 0, reason: 'regime_unsafe' };
    }

    // Calculate size for this scale-in level
    const level = state.count + 1; // 0-indexed → next level
    const sizeMultiplier = SCALE_SIZE_DECAY[level] || 0.25;

    return {
        shouldScale: true,
        sizeMultiplier,
        level,
        reason: `scale_in_L${level} (profit: ${pnlPct.toFixed(2)}%, conf: ${confidence})`,
    };
}

/**
 * Record a scale-in event.
 */
function recordScaleIn(userId, symbol, price, size) {
    const state = _getState(userId, symbol);
    state.count++;
    state.lastAddTs = Date.now();
    state.levels.push({ ts: Date.now(), price, size });
    logger.info('MULTI_ENTRY', `Scale-in L${state.count} ${symbol} uid=${userId} @ $${price} size=${size}`);
}

/**
 * Reset scaling state when position is closed.
 */
function resetOnClose(userId, symbol) {
    if (_scaleState.has(userId)) {
        _scaleState.get(userId).delete(symbol);
    }
}

/**
 * Get scaling info for a position (for UI).
 */
function getScaleInfo(userId, symbol) {
    const state = _getState(userId, symbol);
    return {
        scaleCount: state.count,
        maxScales: MAX_SCALE_INS,
        levels: state.levels.map(l => ({
            ts: l.ts,
            price: +l.price.toFixed(2),
            size: l.size,
        })),
        canScaleMore: state.count < MAX_SCALE_INS,
        nextSizeDecay: SCALE_SIZE_DECAY[state.count + 1] || 0,
    };
}

/**
 * Get all scaling data for a user (for dashboard).
 */
function getAllScaleData(userId) {
    if (!_scaleState.has(userId)) return {};
    const result = {};
    for (const [symbol, state] of _scaleState.get(userId)) {
        if (state.count > 0) {
            result[symbol] = getScaleInfo(userId, symbol);
        }
    }
    return result;
}

module.exports = {
    checkScaleIn,
    recordScaleIn,
    resetOnClose,
    getScaleInfo,
    getAllScaleData,
    MAX_SCALE_INS,
    SCALE_SIZE_DECAY,
};
