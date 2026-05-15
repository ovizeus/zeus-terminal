'use strict';

/**
 * OMEGA R2 Cognition — smartMoneyDetector (canonical §31)
 *
 * §31 CROSS-VENUE, SMART MONEY SI CASCADE PREDICTION.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1291-1307.
 *
 * 10 detection signals (lines 1293-1302):
 *   institutional_divergence, venue_divergence, smart_money_signature,
 *   absorption_post_sweep, hidden_distribution, cluster_short_above,
 *   cluster_long_below, cascade_probability, heatmap_pressure,
 *   liquidation_magnet
 *
 * Central logic (lines 1304-1307):
 *   - nu doar "ce face pretul"
 *   - ci "unde este durerea celorlalti"
 *   - si "cine controleaza miscarea"
 */

const { db } = require('../../database');

const SIGNAL_TYPES = Object.freeze([
    'institutional_divergence',
    'venue_divergence',
    'smart_money_signature',
    'absorption_post_sweep',
    'hidden_distribution',
    'cluster_short_above',
    'cluster_long_below',
    'cascade_probability',
    'heatmap_pressure',
    'liquidation_magnet'
]);

const VENUE_KEYS = Object.freeze([
    'binance', 'bybit', 'coinbase', 'okx', 'bitget', 'deribit'
]);

const CASCADE_THRESHOLDS = Object.freeze({
    cluster_size_pct:         0.5,    // 0.5% of price away considered near-magnet
    cascade_prob_alert:       0.35,   // 35% prob of cascade triggers alert
    divergence_pct:           0.20,   // 20pp deviation in buyPct = divergence
    price_divergence_pct:     0.20    // 0.2% inter-venue price divergence
});

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`smartMoneyDetector: missing ${key}`);
    }
    return params[key];
}

function _clampUnit(x) {
    return Math.max(0, Math.min(1, x));
}

// ── detectInstitutionalDivergence (pure) ───────────────────────────
function detectInstitutionalDivergence(params) {
    const venueData = (params && params.venueData) ? params.venueData : {};
    const venues = Object.keys(venueData);
    if (venues.length < 2) {
        return {
            divergenceDetected: false,
            severity: 0,
            leadingVenue: null,
            venueCount: venues.length
        };
    }

    // Calculate venue price spread
    const prices = venues.map(v => venueData[v].price).filter(p => typeof p === 'number');
    if (prices.length < 2) {
        return { divergenceDetected: false, severity: 0, leadingVenue: null };
    }
    const maxPrice = Math.max(...prices);
    const minPrice = Math.min(...prices);
    const pricePctDiff = ((maxPrice - minPrice) / minPrice) * 100;

    // Calculate buyPct spread (institutional vs retail flow proxy)
    const buyPcts = venues
        .map(v => ({ venue: v, buyPct: venueData[v].buyPct }))
        .filter(x => typeof x.buyPct === 'number');
    let maxBuyPct = { venue: null, buyPct: 0 };
    let avgBuyPct = 0;
    for (const x of buyPcts) {
        if (x.buyPct > maxBuyPct.buyPct) maxBuyPct = x;
        avgBuyPct += x.buyPct;
    }
    avgBuyPct = buyPcts.length > 0 ? avgBuyPct / buyPcts.length : 0;
    const buyPctDeviation = Math.abs(maxBuyPct.buyPct - avgBuyPct);

    const severity = _clampUnit(
        (pricePctDiff / 1.0) * 0.5 + (buyPctDeviation / 0.3) * 0.5
    );

    const divergenceDetected = pricePctDiff > CASCADE_THRESHOLDS.price_divergence_pct
        || buyPctDeviation > CASCADE_THRESHOLDS.divergence_pct;

    // Coinbase often leads on institutional flow (USA spot)
    let leadingVenue = null;
    if (divergenceDetected) {
        if (venueData.coinbase && venueData.coinbase.buyPct > 0.7) {
            leadingVenue = 'coinbase';
        } else if (maxBuyPct.venue) {
            leadingVenue = maxBuyPct.venue;
        }
    }

    return {
        divergenceDetected,
        severity,
        leadingVenue,
        pricePctDiff,
        buyPctDeviation
    };
}

// ── detectLiquidationClusters (pure) ───────────────────────────────
function detectLiquidationClusters(params) {
    const currentPrice = _required(params, 'currentPrice');
    const heatmap = (params && params.orderBookHeatmap) ? params.orderBookHeatmap : {};
    const shortLiqs = heatmap.shortLiqs || {};
    const longLiqs = heatmap.longLiqs || {};

    const clustersAbove = [];
    const clustersBelow = [];

    let totalShortLiqAbove = 0;
    for (const [levelStr, size] of Object.entries(shortLiqs)) {
        const level = Number(levelStr);
        if (level > currentPrice) {
            clustersAbove.push({ level, size });
            totalShortLiqAbove += size;
        }
    }
    let totalLongLiqBelow = 0;
    for (const [levelStr, size] of Object.entries(longLiqs)) {
        const level = Number(levelStr);
        if (level < currentPrice) {
            clustersBelow.push({ level, size });
            totalLongLiqBelow += size;
        }
    }

    // Sort clusters by size descending
    clustersAbove.sort((a, b) => b.size - a.size);
    clustersBelow.sort((a, b) => b.size - a.size);

    // Magnet detection: both clusters significant
    let magnetLevel = null;
    if (clustersAbove.length > 0 && clustersBelow.length > 0
        && totalShortLiqAbove > 1000000 && totalLongLiqBelow > 1000000) {
        // Magnet biases toward larger cluster
        magnetLevel = totalShortLiqAbove > totalLongLiqBelow
            ? clustersAbove[0].level
            : clustersBelow[0].level;
    }

    return {
        clustersAbove,
        clustersBelow,
        totalShortLiqAbove,
        totalLongLiqBelow,
        magnetLevel
    };
}

// ── estimateCascadeProbability (pure) ──────────────────────────────
function estimateCascadeProbability(params) {
    const clusters = (params && params.liquidationClusters)
        ? params.liquidationClusters : {};
    const currentPrice = _required(params, 'currentPrice');
    const volatility = (params && typeof params.volatility === 'number')
        ? params.volatility : 0.02;

    const totalShortLiqAbove = clusters.totalShortLiqAbove || 0;
    const totalLongLiqBelow = clusters.totalLongLiqBelow || 0;
    const total = totalShortLiqAbove + totalLongLiqBelow;

    if (total === 0) {
        return { cascadeProb: 0, predictedDirection: 'NEUTRAL' };
    }

    // Heuristic: bigger clusters relative to position × higher vol = higher cascade prob
    const sizeFactor = Math.min(1, total / 100000000);  // normalize to 100M
    const volFactor = Math.min(2, volatility / 0.02);   // 2% = 1x
    const cascadeProb = _clampUnit(sizeFactor * volFactor * 0.6);

    // Direction biased toward larger cluster (price goes TO the pain)
    let predictedDirection;
    if (totalShortLiqAbove > totalLongLiqBelow * 1.5) {
        predictedDirection = 'UP';   // shorts get squeezed up
    } else if (totalLongLiqBelow > totalShortLiqAbove * 1.5) {
        predictedDirection = 'DOWN'; // longs get liquidated down
    } else {
        predictedDirection = 'NEUTRAL';
    }

    return {
        cascadeProb,
        predictedDirection,
        sizeFactor,
        volFactor
    };
}

// ── detectAbsorption (pure) ────────────────────────────────────────
function detectAbsorption(params) {
    const tradeHistory = (params && Array.isArray(params.tradeHistory))
        ? params.tradeHistory : [];
    const sweepEvents = (params && Array.isArray(params.sweepEvents))
        ? params.sweepEvents : [];

    if (sweepEvents.length === 0 || tradeHistory.length < 3) {
        return { absorptionDetected: false };
    }

    // Find post-sweep recovery: price below pre-sweep level then recovers
    for (const sweep of sweepEvents) {
        const sweepLevel = sweep.level;
        // Find trades after sweep
        let recovered = false;
        let maxAfterSweep = 0;
        for (const trade of tradeHistory) {
            if (trade.price < sweepLevel) {
                // potential sweep target
            } else if (trade.price > sweepLevel) {
                maxAfterSweep = Math.max(maxAfterSweep, trade.price);
                if (trade.price > sweepLevel) {
                    recovered = true;
                }
            }
        }
        if (recovered) {
            return {
                absorptionDetected: true,
                sweepLevel,
                recoveryStrength: maxAfterSweep
            };
        }
    }

    return { absorptionDetected: false };
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    getObservation: db.prepare(`
        SELECT * FROM ml_smart_money_observations
        WHERE user_id = ? AND resolved_env = ?
          AND signal_type = ?
          AND (regime IS NULL AND ? IS NULL OR regime = ?)
    `),
    insertObservation: db.prepare(`
        INSERT INTO ml_smart_money_observations
        (user_id, resolved_env, signal_type, sample_count, mean_strength,
         regime, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?, ?, ?)
    `),
    updateObservation: db.prepare(`
        UPDATE ml_smart_money_observations
        SET sample_count = sample_count + 1,
            mean_strength = ((mean_strength * sample_count) + ?) / (sample_count + 1),
            updated_at = ?
        WHERE id = ?
    `)
};

// ── recordObservation ──────────────────────────────────────────────
function recordObservation(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const signalType = _required(params, 'signalType');
    const payload = _required(params, 'payload');
    const regime = (params && params.regime) ? params.regime : null;
    const strength = (payload && typeof payload.strength === 'number')
        ? payload.strength
        : (payload && typeof payload.severity === 'number') ? payload.severity : 0.5;

    if (!SIGNAL_TYPES.includes(signalType)) {
        throw new Error(`smartMoneyDetector: invalid signal_type "${signalType}"`);
    }

    const now = Date.now();
    const existing = _stmts.getObservation.get(userId, env, signalType, regime, regime);

    if (!existing) {
        _stmts.insertObservation.run(
            userId, env, signalType, strength, regime, now, now
        );
    } else {
        _stmts.updateObservation.run(strength, now, existing.id);
    }

    return { recorded: true, signalType, regime };
}

// ── getSignalStrength ──────────────────────────────────────────────
function getSignalStrength(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const signalType = _required(params, 'signalType');
    const regime = (params && params.regime) ? params.regime : null;
    const minSamples = (params && params.minSamples) ? params.minSamples : 1;

    const row = _stmts.getObservation.get(userId, env, signalType, regime, regime);
    if (!row || row.sample_count < minSamples) return null;

    return {
        signalType: row.signal_type,
        regime: row.regime,
        mean: row.mean_strength,
        count: row.sample_count,
        lastUpdated: row.updated_at
    };
}

module.exports = {
    SIGNAL_TYPES,
    VENUE_KEYS,
    CASCADE_THRESHOLDS,
    detectInstitutionalDivergence,
    detectLiquidationClusters,
    estimateCascadeProbability,
    detectAbsorption,
    recordObservation,
    getSignalStrength
};
