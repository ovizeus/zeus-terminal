'use strict';

/**
 * OMEGA R4 Execution — queueFillModel (canonical §56)
 *
 * §56 LIMIT ORDER QUEUE POSITION + FILL PROBABILITY MODEL.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1605-1623.
 *
 * "Diferenta dintre model bun pe hartie si executie reala."
 *
 * Models:
 *   - queue rank at limit order submit (aggregated size before us)
 *   - fill probability decay over elapsed time AND adverse price movement
 *   - maker vs taker decision based on fill prob + cost differential
 *   - cancel/reprice penalty (repeated cancels degrade priority)
 *
 * Distinct from R4 transactionCostAnalyzer (§23 = post-trade TCA / slippage
 * model) and R4 smartPostOnly (EXEC-N1 = whether to use post-only flag).
 * §56 is pre-trade fill-probability + maker/taker decision logic.
 */

const { db } = require('../../database');

const MAKER_TAKER_DECISIONS = Object.freeze(['maker', 'taker', 'reprice', 'abstain']);
const DEFAULT_FILL_DECAY_RATE = 0.001;     // per ms
const CANCEL_PENALTY_THRESHOLD = 3;         // cancels in window → penalty applies
const MIN_QUEUE_RANK_FOR_MAKER = 5;         // worse rank → prefer taker
const ABSTAIN_FILL_PROB_FLOOR = 0.10;       // below this → abstain entirely

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`queueFillModel: missing ${key}`);
    }
    return params[key];
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertObs: db.prepare(`
        INSERT INTO ml_queue_fill_observations
        (user_id, resolved_env, symbol, side, queue_rank_est, fill_prob_est,
         decay_rate, maker_cost_bps, taker_cost_bps, decision,
         actual_filled, time_to_fill_ms, cancelled, cancel_count, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    statsForSymbol: db.prepare(`
        SELECT COUNT(*) AS samples,
               AVG(fill_prob_est) AS avg_pred_prob,
               AVG(CAST(actual_filled AS REAL)) AS actual_fill_rate,
               AVG(time_to_fill_ms) AS avg_fill_ms,
               SUM(cancelled) AS total_cancelled
        FROM ml_queue_fill_observations
        WHERE user_id = ? AND resolved_env = ? AND symbol = ?
          AND ts >= ?
    `),
    decisionBreakdown: db.prepare(`
        SELECT decision, COUNT(*) AS count,
               AVG(CAST(actual_filled AS REAL)) AS fill_rate
        FROM ml_queue_fill_observations
        WHERE user_id = ? AND resolved_env = ? AND symbol = ?
          AND ts >= ?
        GROUP BY decision
    `)
};

// ── estimateQueuePosition ──────────────────────────────────────────
// Returns aggregated size at-or-better than our submitted price.
// For LONG (buy limit): sum bids at price >= ours.
// For SHORT (sell limit): sum asks at price <= ours.
function estimateQueuePosition(params) {
    const symbol = _required(params, 'symbol');
    const side = _required(params, 'side');
    const price = _required(params, 'price');
    const depthBook = _required(params, 'depthBook');

    if (side !== 'LONG' && side !== 'SHORT') {
        throw new Error(`queueFillModel: side must be LONG or SHORT`);
    }

    const levels = side === 'LONG' ? depthBook.bids : depthBook.asks;
    if (!Array.isArray(levels)) {
        throw new Error(`queueFillModel: depthBook.${side === 'LONG' ? 'bids' : 'asks'} must be array`);
    }

    let queueSize = 0;
    let levelsAhead = 0;
    for (const lvl of levels) {
        const lvlPrice = lvl[0];
        const lvlSize = lvl[1];
        const isAhead = side === 'LONG' ? lvlPrice >= price : lvlPrice <= price;
        if (isAhead) {
            queueSize += lvlSize;
            levelsAhead += 1;
        }
    }

    return {
        symbol,
        queueRank: queueSize,
        levelsAhead
    };
}

// ── estimateFillProbability ────────────────────────────────────────
// P(fill) = baseRate * exp(-decay * elapsed) * priceMovementFactor.
function estimateFillProbability(params) {
    const queueRank = _required(params, 'queueRank');
    const baseFillRate = (params && params.baseFillRate !== undefined)
        ? params.baseFillRate : 0.75;
    const decayRate = (params && params.decayRate !== undefined)
        ? params.decayRate : DEFAULT_FILL_DECAY_RATE;
    const elapsedMs = (params && params.elapsedMs !== undefined) ? params.elapsedMs : 0;
    const priceMovementBps = (params && params.priceMovementBps !== undefined)
        ? params.priceMovementBps : 0;

    if (queueRank < 0) {
        throw new Error('queueFillModel: queueRank must be >= 0');
    }

    // Queue penalty: deeper queue = lower base prob.
    // Use 1 / (1 + log(1 + rank/100)) — soft attenuation for large books.
    const queuePenalty = 1 / (1 + Math.log(1 + queueRank / 100));

    // Time decay: exp(-decay * ms).
    const timeDecay = Math.exp(-decayRate * elapsedMs);

    // Adverse movement: linear penalty (>20bps adverse → ~0).
    const ADVERSE_THRESHOLD = 20;
    const movementFactor = Math.max(0, 1 - Math.abs(priceMovementBps) / ADVERSE_THRESHOLD);

    const prob = baseFillRate * queuePenalty * timeDecay * movementFactor;

    return {
        fillProb: Math.max(0, Math.min(1, prob)),
        queuePenalty,
        timeDecay,
        movementFactor
    };
}

// ── decideMakerVsTaker ─────────────────────────────────────────────
function decideMakerVsTaker(params) {
    const makerCostBps = _required(params, 'makerCostBps');
    const takerCostBps = _required(params, 'takerCostBps');
    const fillProb = _required(params, 'fillProb');
    const missedFillRiskBps = (params && params.missedFillRiskBps !== undefined)
        ? params.missedFillRiskBps : 10;
    const queueRank = (params && params.queueRank !== undefined) ? params.queueRank : 0;
    const cancelCount = (params && params.cancelCount !== undefined) ? params.cancelCount : 0;

    if (fillProb < ABSTAIN_FILL_PROB_FLOOR) {
        return {
            decision: 'abstain',
            reason: `fill_prob ${fillProb.toFixed(3)} below floor ${ABSTAIN_FILL_PROB_FLOOR}`,
            makerExpectedCost: null,
            takerExpectedCost: takerCostBps
        };
    }

    // Cancel penalty: > threshold consecutive cancels → discourage maker.
    if (cancelCount >= CANCEL_PENALTY_THRESHOLD) {
        return {
            decision: 'taker',
            reason: `cancel_count ${cancelCount} >= threshold ${CANCEL_PENALTY_THRESHOLD}`,
            makerExpectedCost: null,
            takerExpectedCost: takerCostBps
        };
    }

    // Maker expected cost = makerCost + (1 - fillProb) * missedFillRisk.
    const makerExpectedCost = makerCostBps + (1 - fillProb) * missedFillRiskBps;

    // Queue too deep — fill prob already weak — reprice closer to top.
    if (queueRank > 0 && fillProb < 0.30 && queueRank > MIN_QUEUE_RANK_FOR_MAKER * 100) {
        return {
            decision: 'reprice',
            reason: `queue_rank ${queueRank} too deep with fill_prob ${fillProb.toFixed(2)}`,
            makerExpectedCost,
            takerExpectedCost: takerCostBps
        };
    }

    if (makerExpectedCost < takerCostBps) {
        return {
            decision: 'maker',
            reason: `maker_expected ${makerExpectedCost.toFixed(2)}bps < taker ${takerCostBps}bps`,
            makerExpectedCost,
            takerExpectedCost: takerCostBps
        };
    }

    return {
        decision: 'taker',
        reason: `maker_expected ${makerExpectedCost.toFixed(2)}bps >= taker ${takerCostBps}bps`,
        makerExpectedCost,
        takerExpectedCost: takerCostBps
    };
}

// ── recordFillObservation ──────────────────────────────────────────
function recordFillObservation(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const symbol = _required(params, 'symbol');
    const side = _required(params, 'side');
    const queueRankEst = _required(params, 'queueRankEst');
    const fillProbEst = _required(params, 'fillProbEst');
    const decision = _required(params, 'decision');
    const actualFilled = !!params.actualFilled;
    const cancelled = !!params.cancelled;
    const cancelCount = (params && params.cancelCount !== undefined) ? params.cancelCount : 0;
    const makerCostBps = (params && params.makerCostBps !== undefined) ? params.makerCostBps : 0;
    const takerCostBps = (params && params.takerCostBps !== undefined) ? params.takerCostBps : 0;
    const decayRate = (params && params.decayRate !== undefined) ? params.decayRate : DEFAULT_FILL_DECAY_RATE;
    const timeToFillMs = (params && params.timeToFillMs !== undefined) ? params.timeToFillMs : null;
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!MAKER_TAKER_DECISIONS.includes(decision)) {
        throw new Error(`queueFillModel: invalid decision "${decision}"`);
    }
    if (side !== 'LONG' && side !== 'SHORT') {
        throw new Error(`queueFillModel: invalid side "${side}"`);
    }

    _stmts.insertObs.run(
        userId, env, symbol, side, queueRankEst, fillProbEst,
        decayRate, makerCostBps, takerCostBps, decision,
        actualFilled ? 1 : 0, timeToFillMs,
        cancelled ? 1 : 0, cancelCount, ts
    );

    return { recorded: true };
}

// ── getFillStats ───────────────────────────────────────────────────
function getFillStats(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const symbol = _required(params, 'symbol');
    const lookbackDays = (params && params.lookbackDays) ? params.lookbackDays : 30;

    const since = Date.now() - lookbackDays * 86400000;

    const stats = _stmts.statsForSymbol.get(userId, env, symbol, since);
    const breakdown = _stmts.decisionBreakdown.all(userId, env, symbol, since);

    return {
        symbol,
        samples: stats.samples || 0,
        avgPredProb: stats.avg_pred_prob || 0,
        actualFillRate: stats.actual_fill_rate || 0,
        avgFillMs: stats.avg_fill_ms || null,
        totalCancelled: stats.total_cancelled || 0,
        decisionBreakdown: breakdown.map(b => ({
            decision: b.decision,
            count: b.count,
            fillRate: b.fill_rate
        }))
    };
}

module.exports = {
    MAKER_TAKER_DECISIONS,
    DEFAULT_FILL_DECAY_RATE,
    CANCEL_PENALTY_THRESHOLD,
    MIN_QUEUE_RANK_FOR_MAKER,
    ABSTAIN_FILL_PROB_FLOOR,
    estimateQueuePosition,
    estimateFillProbability,
    decideMakerVsTaker,
    recordFillObservation,
    getFillStats
};
