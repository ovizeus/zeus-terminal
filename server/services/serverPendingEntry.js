// Zeus Terminal — Pending Entry System (Brain V2 Phase 2G)
// Instead of entering instantly, brain creates a "pending" entry that waits
// for a pullback to a better price. If pullback comes → FILL at better price.
// If momentum continues → MOMENTUM FILL (don't miss the trade).
// If timeout → EXPIRE (discipline > FOMO).
'use strict';

const logger = require('./logger');
const db = require('./database');
const telegram = require('./telegram');

// ── Config ──
const MAX_CANDLES = 6;          // max 6 cycles (30s each = 3 minutes)
const MOMENTUM_PCT = 0.3;       // 0.3% move in our direction = momentum fill
const PULLBACK_MIN_PCT = 0.05;  // minimum 0.05% improvement to count as pullback

// ── Per-user pending entries: Map<userId, Map<symbol, PendingEntry>> ──
const _pending = new Map();

function _userPending(userId) {
    if (!_pending.has(userId)) _pending.set(userId, new Map());
    return _pending.get(userId);
}

/**
 * Create a pending entry instead of executing immediately.
 * @param {object} decision - Brain decision (symbol, price, fusion, regime, etc.)
 * @param {object} stc - Adapted STC params
 * @param {string} userId
 * @param {object} marketCtx - { structure, liquidity, bars }
 * @returns {object|null} The pending entry object, or null if can't create
 */
function createPending(decision, stc, userId, marketCtx) {
    if (!decision || !userId) return null;

    const up = _userPending(userId);
    const symbol = decision.symbol;

    // Already have a pending for this symbol
    if (up.has(symbol)) {
        logger.info('PENDING', `Already pending ${symbol} for uid=${userId} — skipping`);
        return null;
    }

    const price = decision.price;
    const dir = decision.fusion.dir;
    if (!price || price <= 0 || !dir) return null;

    // Calculate target price (pullback zone)
    const targetPrice = _calcTargetPrice(price, dir, marketCtx);

    const pending = {
        userId,
        symbol,
        dir,
        tier: decision.fusion.decision,
        confidence: decision.fusion.confidence,
        entryPrice: price,          // price when brain decided
        targetPrice,                // ideal pullback price
        currentPrice: price,
        candleCount: 0,
        maxCandles: MAX_CANDLES,
        createdAt: Date.now(),
        decision,                   // full decision for AT execution
        stc,                        // adapted STC
        status: 'WAITING',         // WAITING → FILLED | MOMENTUM_FILLED | EXPIRED | CANCELLED
        bestPrice: price,           // track best pullback seen
    };

    up.set(symbol, pending);
    _persist(userId);

    logger.info('PENDING', `Created ${dir} ${symbol} uid=${userId} — target $${targetPrice.toFixed(2)} (current $${price.toFixed(2)}), max ${MAX_CANDLES} cycles`);
    telegram.sendToUser(userId, `⏳ *Pending Entry*\n${dir} \`${symbol}\` — waiting for pullback\nTarget: \`$${targetPrice.toFixed(2)}\` (now: \`$${price.toFixed(2)}\`)\nExpires in ${MAX_CANDLES * 30}s`);

    return pending;
}

/**
 * Calculate target pullback price based on market context.
 * Uses EMA proximity, support/resistance zones, or a fixed % pullback.
 */
function _calcTargetPrice(price, dir, ctx) {
    // Try to use liquidity zones or structure levels
    if (ctx && ctx.liquidity) {
        const liq = ctx.liquidity;
        if (dir === 'LONG' && liq.nearestBelow && liq.nearestBelow.price) {
            const support = liq.nearestBelow.price;
            // Only use if within 0.5% of current price
            if ((price - support) / price < 0.005 && support < price) {
                return support;
            }
        }
        if (dir === 'SHORT' && liq.nearestAbove && liq.nearestAbove.price) {
            const resist = liq.nearestAbove.price;
            if ((resist - price) / price < 0.005 && resist > price) {
                return resist;
            }
        }
    }

    // Default: 0.1% pullback from current price
    const pullbackPct = 0.001;
    if (dir === 'LONG') return +(price * (1 - pullbackPct)).toFixed(2);
    return +(price * (1 + pullbackPct)).toFixed(2);
}

/**
 * Check all pending entries — called every brain cycle (30s).
 * @param {string} symbol
 * @param {number} currentPrice
 * @param {string} userId
 * @returns {object|null} { action: 'FILL'|'MOMENTUM'|'EXPIRE'|'CANCEL'|null, pending }
 */
function checkPending(symbol, currentPrice, userId) {
    const up = _userPending(userId);
    if (!up.has(symbol)) return null;

    const p = up.get(symbol);
    p.candleCount++;
    p.currentPrice = currentPrice;

    // Track best pullback price seen
    if (p.dir === 'LONG' && currentPrice < p.bestPrice) p.bestPrice = currentPrice;
    if (p.dir === 'SHORT' && currentPrice > p.bestPrice) p.bestPrice = currentPrice;

    // 1. Check pullback fill — price reached or passed target
    if (_hitTarget(p, currentPrice)) {
        p.status = 'FILLED';
        // Update decision price to the better pullback price
        p.decision.price = currentPrice;
        p.decision.priceTs = Date.now();
        up.delete(symbol);
        _persist(userId);

        const improvement = Math.abs(currentPrice - p.entryPrice) / p.entryPrice * 100;
        logger.info('PENDING', `FILL ${p.dir} ${symbol} uid=${userId} @ $${currentPrice.toFixed(2)} (improvement: ${improvement.toFixed(3)}%, ${p.candleCount} cycles)`);
        telegram.sendToUser(userId, `✅ *Pending FILLED*\n${p.dir} \`${symbol}\` @ \`$${currentPrice.toFixed(2)}\`\nImprovement: \`${improvement.toFixed(3)}%\` (${p.candleCount * 30}s wait)`);

        return { action: 'FILL', pending: p };
    }

    // 2. Check momentum fill — price moved strongly in our direction
    const moveFromEntry = (currentPrice - p.entryPrice) / p.entryPrice * 100;
    const isOurDirection = (p.dir === 'LONG' && moveFromEntry > 0) || (p.dir === 'SHORT' && moveFromEntry < 0);

    if (isOurDirection && Math.abs(moveFromEntry) >= MOMENTUM_PCT) {
        p.status = 'MOMENTUM_FILLED';
        p.decision.price = currentPrice;
        p.decision.priceTs = Date.now();
        up.delete(symbol);
        _persist(userId);

        logger.info('PENDING', `MOMENTUM FILL ${p.dir} ${symbol} uid=${userId} @ $${currentPrice.toFixed(2)} (+${Math.abs(moveFromEntry).toFixed(2)}% in ${p.candleCount} cycles)`);
        telegram.sendToUser(userId, `🚀 *Momentum FILL*\n${p.dir} \`${symbol}\` @ \`$${currentPrice.toFixed(2)}\`\nMoved \`${Math.abs(moveFromEntry).toFixed(2)}%\` — entering on momentum`);

        return { action: 'MOMENTUM', pending: p };
    }

    // 3. Check timeout — expired without fill
    if (p.candleCount >= p.maxCandles) {
        p.status = 'EXPIRED';
        up.delete(symbol);
        _persist(userId);

        logger.info('PENDING', `EXPIRED ${p.dir} ${symbol} uid=${userId} — no fill in ${MAX_CANDLES} cycles`);
        telegram.sendToUser(userId, `⏰ *Pending Expired*\n${p.dir} \`${symbol}\` — no pullback in ${MAX_CANDLES * 30}s\nDiscipline > FOMO`);

        return { action: 'EXPIRE', pending: p };
    }

    return null; // still waiting
}

function _hitTarget(p, currentPrice) {
    if (p.dir === 'LONG') {
        return currentPrice <= p.targetPrice;
    }
    return currentPrice >= p.targetPrice;
}

/**
 * Cancel a pending entry (e.g., conditions changed, kill switch).
 */
function cancelPending(symbol, userId, reason) {
    const up = _userPending(userId);
    if (!up.has(symbol)) return false;

    const p = up.get(symbol);
    p.status = 'CANCELLED';
    up.delete(symbol);
    _persist(userId);

    logger.info('PENDING', `CANCELLED ${p.dir} ${symbol} uid=${userId} — ${reason}`);
    return true;
}

/**
 * Cancel all pending entries for a user (e.g., kill switch activated).
 */
function cancelAllForUser(userId) {
    const up = _userPending(userId);
    if (up.size === 0) return;
    for (const [symbol] of up) {
        cancelPending(symbol, userId, 'user_cancel_all');
    }
}

/**
 * Get pending entry for a symbol/user (for UI display).
 */
function getPending(symbol, userId) {
    const up = _userPending(userId);
    return up.get(symbol) || null;
}

/**
 * Get all pending entries for a user.
 */
function getAllPending(userId) {
    const up = _userPending(userId);
    const result = [];
    for (const [, p] of up) {
        result.push({
            symbol: p.symbol,
            dir: p.dir,
            tier: p.tier,
            confidence: p.confidence,
            entryPrice: p.entryPrice,
            targetPrice: p.targetPrice,
            currentPrice: p.currentPrice,
            candleCount: p.candleCount,
            maxCandles: p.maxCandles,
            createdAt: p.createdAt,
            status: p.status,
        });
    }
    return result;
}

// ── Persistence ──
function _persist(userId) {
    try {
        const up = _userPending(userId);
        const data = {};
        for (const [sym, p] of up) {
            data[sym] = { symbol: p.symbol, dir: p.dir, tier: p.tier, confidence: p.confidence,
                entryPrice: p.entryPrice, targetPrice: p.targetPrice, candleCount: p.candleCount,
                maxCandles: p.maxCandles, createdAt: p.createdAt, status: p.status };
        }
        db.atSetState('pending:' + userId, data, parseInt(userId, 10) || null);
    } catch (_) { /* best effort */ }
}

function _loadFromDisk() {
    try {
        const rows = db.db.prepare("SELECT key, value FROM at_state WHERE key LIKE 'pending:%'").all();
        for (const row of rows) {
            const m = /^pending:(.+)$/.exec(row.key);
            if (!m) continue;
            try {
                const data = JSON.parse(row.value);
                // Don't restore old pending entries — they're stale after restart
                // Just clean them up
            } catch (_) {}
        }
        // Clear all pending entries on startup — they're time-sensitive
        db.db.prepare("DELETE FROM at_state WHERE key LIKE 'pending:%'").run();
        logger.info('PENDING', 'Cleared stale pending entries on startup');
    } catch (_) {}
}

_loadFromDisk();

module.exports = {
    createPending,
    checkPending,
    cancelPending,
    cancelAllForUser,
    getPending,
    getAllPending,
};
