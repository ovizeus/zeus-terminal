// Zeus Terminal — Liquidity Mapping (Brain V2 — Phase 1C)
// Identifies liquidity zones from swing pivots + order book walls.
// Provides liquidity risk assessment for brain fusion.
'use strict';

const logger = require('./logger');
const { teacherSwingPivots } = require('../shared/teacher/teacherIndicators');

// ══════════════════════════════════════════════════════════════════
// Configuration
// ══════════════════════════════════════════════════════════════════
const CLUSTER_PCT = 0.003;          // 0.3% — pivots within this range form a cluster
const MIN_CLUSTER_TOUCHES = 2;      // minimum touches to form a zone
const ZONE_PROXIMITY_PCT = 0.005;   // 0.5% — "near" a zone
const DEPTH_POLL_INTERVAL = 60000;  // 60s between depth polls
const DEPTH_LIMIT = 20;             // top 20 levels from order book
const WALL_THRESHOLD_MULT = 3.0;    // wall = level with 3× average qty

// ══════════════════════════════════════════════════════════════════
// Per-symbol state
// ══════════════════════════════════════════════════════════════════
const _cache = new Map();       // symbol → { zones, walls, ts }
const _depthCache = new Map();  // symbol → { bids, asks, ts }
let _depthTimer = null;
let _depthSymbols = [];

// ══════════════════════════════════════════════════════════════════
// Swing-based liquidity zones
// ══════════════════════════════════════════════════════════════════

/**
 * Find liquidity zones by clustering swing highs and lows.
 * Swing highs = potential short liquidation / SL clusters above.
 * Swing lows = potential long liquidation / SL clusters below.
 */
function _findZonesFromPivots(bars) {
    if (!bars || bars.length < 60) return [];

    // Use larger lookback for more pivot data
    const pivots = teacherSwingPivots(bars, Math.min(bars.length, 200), 3);
    const allPivots = [];

    for (const h of pivots.highs) {
        allPivots.push({ price: h.price, type: 'high', ts: h.ts });
    }
    for (const l of pivots.lows) {
        allPivots.push({ price: l.price, type: 'low', ts: l.ts });
    }

    if (allPivots.length < 2) return [];

    // Sort by price
    allPivots.sort((a, b) => a.price - b.price);

    // Cluster pivots within CLUSTER_PCT of each other
    const zones = [];
    let cluster = [allPivots[0]];

    for (let i = 1; i < allPivots.length; i++) {
        const pctDiff = Math.abs(allPivots[i].price - cluster[0].price) / cluster[0].price;
        if (pctDiff <= CLUSTER_PCT) {
            cluster.push(allPivots[i]);
        } else {
            if (cluster.length >= MIN_CLUSTER_TOUCHES) {
                zones.push(_clusterToZone(cluster));
            }
            cluster = [allPivots[i]];
        }
    }
    if (cluster.length >= MIN_CLUSTER_TOUCHES) {
        zones.push(_clusterToZone(cluster));
    }

    return zones;
}

function _clusterToZone(cluster) {
    const prices = cluster.map(p => p.price);
    const low = Math.min(...prices);
    const high = Math.max(...prices);
    const mid = (low + high) / 2;
    const types = cluster.map(p => p.type);
    const highCount = types.filter(t => t === 'high').length;
    const lowCount = types.filter(t => t === 'low').length;

    return {
        low,
        high,
        mid,
        touches: cluster.length,
        bias: highCount > lowCount ? 'resistance' : lowCount > highCount ? 'support' : 'neutral',
        strength: Math.min(1, cluster.length / 4), // 0.5 at 2 touches, 1.0 at 4+
    };
}

// ══════════════════════════════════════════════════════════════════
// Order book wall detection (REST poll)
// ══════════════════════════════════════════════════════════════════

/**
 * Start polling order book depth for given symbols.
 */
function startDepthPolling(symbols) {
    _depthSymbols = (symbols || []).map(s => s.toUpperCase());
    if (_depthTimer) clearInterval(_depthTimer);
    if (_depthSymbols.length === 0) return;

    _depthTimer = setInterval(_pollAllDepth, DEPTH_POLL_INTERVAL);
    // First poll after 10s to let system settle
    setTimeout(_pollAllDepth, 10000);
    logger.info('LIQ', `Depth polling started for [${_depthSymbols.join(',')}] every ${DEPTH_POLL_INTERVAL / 1000}s`);
}

async function _pollAllDepth() {
    for (const sym of _depthSymbols) {
        try {
            await _pollDepth(sym);
        } catch (err) {
            logger.warn('LIQ', `Depth poll failed for ${sym}: ${err.message}`);
        }
    }
}

async function _pollDepth(symbol) {
    // Use public endpoint — no auth needed
    const url = `https://fapi.binance.com/fapi/v1/depth?symbol=${symbol}&limit=${DEPTH_LIMIT}`;
    const res = await fetch(url);
    if (!res.ok) return;

    const data = await res.json();
    if (!data.bids || !data.asks) return;

    _depthCache.set(symbol, {
        bids: data.bids.map(([p, q]) => ({ price: parseFloat(p), qty: parseFloat(q) })),
        asks: data.asks.map(([p, q]) => ({ price: parseFloat(p), qty: parseFloat(q) })),
        ts: Date.now(),
    });
}

/**
 * Detect order book walls from cached depth data.
 */
function _findWalls(symbol) {
    const depth = _depthCache.get(symbol);
    if (!depth || (Date.now() - depth.ts) > DEPTH_POLL_INTERVAL * 3) return [];

    const walls = [];
    const allLevels = [...depth.bids, ...depth.asks];
    if (allLevels.length === 0) return [];

    const avgQty = allLevels.reduce((s, l) => s + l.qty, 0) / allLevels.length;
    const threshold = avgQty * WALL_THRESHOLD_MULT;

    for (const bid of depth.bids) {
        if (bid.qty >= threshold) {
            walls.push({ price: bid.price, qty: bid.qty, side: 'bid', strength: bid.qty / avgQty });
        }
    }
    for (const ask of depth.asks) {
        if (ask.qty >= threshold) {
            walls.push({ price: ask.price, qty: ask.qty, side: 'ask', strength: ask.qty / avgQty });
        }
    }

    return walls;
}

// ══════════════════════════════════════════════════════════════════
// Public API
// ══════════════════════════════════════════════════════════════════

/**
 * Get liquidity analysis for a symbol.
 * @param {string} symbol
 * @param {Array} bars - kline bars
 * @param {number} price - current price
 * @returns {{ zones: Array, walls: Array, nearestAbove: object|null, nearestBelow: object|null, liquidityGrabRisk: number }}
 */
function getLiquidity(symbol, bars, price) {
    const key = (symbol || '').toUpperCase();
    const cached = _cache.get(key);

    // Return cache if fresh (recompute every 10s)
    if (cached && (Date.now() - cached.ts) < 10000) {
        return cached;
    }

    const zones = _findZonesFromPivots(bars);
    const walls = _findWalls(key);

    // Combine zones + walls into unified liquidity levels
    const allLevels = [
        ...zones.map(z => ({ price: z.mid, type: 'pivot_zone', ...z })),
        ...walls.map(w => ({ price: w.price, type: 'wall', ...w })),
    ];

    // Find nearest above and below current price
    let nearestAbove = null;
    let nearestBelow = null;

    for (const level of allLevels) {
        if (level.price > price) {
            if (!nearestAbove || level.price < nearestAbove.price) {
                nearestAbove = level;
            }
        } else if (level.price < price) {
            if (!nearestBelow || level.price > nearestBelow.price) {
                nearestBelow = level;
            }
        }
    }

    // Liquidity grab risk: how close is price to a zone?
    // Higher = more dangerous (price is being pulled toward liquidity)
    let liquidityGrabRisk = 0;
    if (nearestAbove && price > 0) {
        const distAbove = (nearestAbove.price - price) / price;
        if (distAbove < ZONE_PROXIMITY_PCT) {
            liquidityGrabRisk = Math.max(liquidityGrabRisk,
                (1 - distAbove / ZONE_PROXIMITY_PCT) * (nearestAbove.strength || 0.5));
        }
    }
    if (nearestBelow && price > 0) {
        const distBelow = (price - nearestBelow.price) / price;
        if (distBelow < ZONE_PROXIMITY_PCT) {
            liquidityGrabRisk = Math.max(liquidityGrabRisk,
                (1 - distBelow / ZONE_PROXIMITY_PCT) * (nearestBelow.strength || 0.5));
        }
    }

    const result = {
        zones,
        walls,
        nearestAbove,
        nearestBelow,
        liquidityGrabRisk: Math.min(1, liquidityGrabRisk),
        ts: Date.now(),
    };

    _cache.set(key, result);
    return result;
}

/**
 * Calculate liquidity modifier for brain fusion.
 * Near liquidity zone in trade direction = penalty (trap risk).
 * @param {string} tradeDir - 'bull' or 'bear'
 * @param {object} liq - from getLiquidity()
 * @returns {number} modifier 0.7 - 1.1
 */
function getLiquidityModifier(tradeDir, liq) {
    if (!liq) return 1.0;

    let mod = 1.0;

    // If approaching liquidity in trade direction → penalty (likely to get swept)
    if (tradeDir === 'bull' && liq.nearestAbove) {
        const dist = liq.nearestAbove.price && liq.nearestAbove.mid
            ? (liq.nearestAbove.mid - liq.nearestAbove.price) : 0;
        if (liq.liquidityGrabRisk > 0.3) {
            mod *= (1 - liq.liquidityGrabRisk * 0.3); // up to 30% penalty
        }
    }
    if (tradeDir === 'bear' && liq.nearestBelow) {
        if (liq.liquidityGrabRisk > 0.3) {
            mod *= (1 - liq.liquidityGrabRisk * 0.3);
        }
    }

    return Math.max(0.7, Math.min(1.1, mod));
}

// ══════════════════════════════════════════════════════════════════
// [3I] Liquidity Anticipation
// ══════════════════════════════════════════════════════════════════

/**
 * Detect if price is approaching a liquidity zone or has just grabbed liquidity.
 * "Liquidity grab" = wick through zone but close back inside (last 3 bars).
 * @param {string} symbol
 * @param {Array} bars - recent kline bars
 * @param {number} price - current price
 * @returns {{ approachingLiquidity: string|null, liquidityGrabbed: string|null, tradeBias: string }}
 */
function getAnticipation(symbol, bars, price) {
    const liq = getLiquidity(symbol, bars, price);
    let approachingLiquidity = null;
    let liquidityGrabbed = null;
    let tradeBias = 'neutral';

    if (!bars || bars.length < 5 || !price) {
        return { approachingLiquidity, liquidityGrabbed, tradeBias };
    }

    const lastBars = bars.slice(-3);

    // Check if approaching zone above (LONG trap risk)
    if (liq.nearestAbove) {
        const distPct = (liq.nearestAbove.price - price) / price;
        if (distPct > 0 && distPct < 0.003) { // within 0.3%
            approachingLiquidity = 'above';
        }

        // Check for liquidity grab above: wick went above zone, close came back below
        for (const bar of lastBars) {
            if (bar.high > liq.nearestAbove.price && bar.close < liq.nearestAbove.price) {
                liquidityGrabbed = 'above'; // grabbed liq above → expect reversal down
                tradeBias = 'bear'; // bearish after grab
                break;
            }
        }
    }

    // Check if approaching zone below (SHORT trap risk)
    if (liq.nearestBelow) {
        const distPct = (price - liq.nearestBelow.price) / price;
        if (distPct > 0 && distPct < 0.003) {
            approachingLiquidity = 'below';
        }

        for (const bar of lastBars) {
            if (bar.low < liq.nearestBelow.price && bar.close > liq.nearestBelow.price) {
                liquidityGrabbed = 'below'; // grabbed liq below → expect reversal up
                tradeBias = 'bull';
                break;
            }
        }
    }

    // Approaching without grab = cautious (trap)
    if (approachingLiquidity === 'above' && !liquidityGrabbed) {
        tradeBias = 'avoid_long'; // don't go long into resistance liquidity
    }
    if (approachingLiquidity === 'below' && !liquidityGrabbed) {
        tradeBias = 'avoid_short'; // don't go short into support liquidity
    }

    return { approachingLiquidity, liquidityGrabbed, tradeBias };
}

function stopDepthPolling() {
    if (_depthTimer) { clearInterval(_depthTimer); _depthTimer = null; }
}

module.exports = {
    getLiquidity,
    getLiquidityModifier,
    getAnticipation,
    startDepthPolling,
    stopDepthPolling,
};
