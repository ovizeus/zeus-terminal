'use strict';

/**
 * OMEGA R5A Learning — counterfactualEngine (canonical §42)
 *
 * §42 COUNTERFACTUAL LEARNING ENGINE — ce s-ar fi întâmplat dacă decideam altfel.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1522-1523.
 *
 * Shadow alternative simulations parallel pentru fiecare decizie. Replay
 * actual price path cu alt params (entry/SL/size/TP) → calibrate future
 * params. Zero look-ahead: price path is post-decision actual, only
 * alt-params hypothetical.
 *
 * Example: long entry 98.200, SL 96.800, price path went to 97.100 before
 * TP. Counterfactual asks: if SL was 97.400, would have triggered (loss).
 * If entry was 97.800 with SL 96.600, better RR.
 *
 * Note: distinct from counterfactualPortfolio.js (portfolio-level "what if
 * we did NOT take this trade?"). This is execution-parameter calibration.
 */

const { db } = require('../../database');

const PARAM_TYPES = Object.freeze(['entry', 'sl', 'size', 'tp']);
const MIN_TRADES_FOR_RECOMMENDATION = 20;
const RECOMMENDATION_CONFIDENCE_THRESHOLD = 0.6;

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`counterfactualEngine: missing ${key}`);
    }
    return params[key];
}

function _validateSide(side) {
    if (side !== 'LONG' && side !== 'SHORT') {
        throw new Error(`counterfactualEngine: side must be LONG or SHORT, got "${side}"`);
    }
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertRun: db.prepare(`
        INSERT INTO ml_counterfactual_runs
        (user_id, resolved_env, trade_id, param_type,
         actual_value, alt_value, actual_pnl, alt_pnl,
         would_have_hit_sl, would_have_hit_tp, improvement, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    countByUserEnv: db.prepare(`
        SELECT COUNT(*) AS count FROM ml_counterfactual_runs
        WHERE user_id = ? AND resolved_env = ?
    `),
    paramAggregate: db.prepare(`
        SELECT param_type,
               COUNT(*) AS samples,
               AVG(improvement) AS avg_improvement,
               SUM(CASE WHEN improvement > 0 THEN 1 ELSE 0 END) AS positive_count
        FROM ml_counterfactual_runs
        WHERE user_id = ? AND resolved_env = ?
          AND created_at >= ?
        GROUP BY param_type
    `),
    historyForUser: db.prepare(`
        SELECT * FROM ml_counterfactual_runs
        WHERE user_id = ? AND resolved_env = ?
          AND (? = 0 OR created_at >= ?)
        ORDER BY created_at DESC, id DESC
        LIMIT ?
    `)
};

// ── Internal: simulate alternative parameter outcome ───────────────
function _simulateAlternative(actual, alt, pricePath, side) {
    // Replay price path; check if alt SL would have triggered before alt TP.
    // Returns { altPnl, wouldHitSL, wouldHitTP }.
    const entry = alt.entry;
    const sl = alt.sl;
    const tp = alt.tp;
    const size = alt.size;

    let wouldHitSL = false;
    let wouldHitTP = false;
    let exitPrice = pricePath[pricePath.length - 1];

    for (const price of pricePath) {
        if (side === 'LONG') {
            if (price <= sl) {
                wouldHitSL = true;
                exitPrice = sl;
                break;
            }
            if (price >= tp) {
                wouldHitTP = true;
                exitPrice = tp;
                break;
            }
        } else {  // SHORT
            if (price >= sl) {
                wouldHitSL = true;
                exitPrice = sl;
                break;
            }
            if (price <= tp) {
                wouldHitTP = true;
                exitPrice = tp;
                break;
            }
        }
    }

    const priceDelta = side === 'LONG' ? (exitPrice - entry) : (entry - exitPrice);
    const altPnl = priceDelta * size;

    return { altPnl, wouldHitSL, wouldHitTP };
}

// ── runCounterfactual ──────────────────────────────────────────────
function runCounterfactual(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const tradeId = _required(params, 'tradeId');
    const side = _required(params, 'side');
    const actual = _required(params, 'actual');
    const pricePath = _required(params, 'pricePath');
    const alternatives = _required(params, 'alternatives');
    const actualPnl = _required(params, 'actualPnl');
    const ts = (params && typeof params.ts === 'number') ? params.ts : Date.now();

    _validateSide(side);

    if (!Array.isArray(pricePath) || pricePath.length === 0) {
        throw new Error('counterfactualEngine: pricePath must be non-empty array');
    }
    if (!Array.isArray(alternatives) || alternatives.length === 0) {
        throw new Error('counterfactualEngine: alternatives must be non-empty array');
    }

    const results = [];

    for (const alt of alternatives) {
        const paramType = _required(alt, 'paramType');
        if (!PARAM_TYPES.includes(paramType)) {
            throw new Error(`counterfactualEngine: invalid paramType "${paramType}"`);
        }

        // Build full alt config: actual values + overridden field
        const altConfig = {
            entry: actual.entry,
            sl: actual.sl,
            tp: actual.tp,
            size: actual.size,
            [paramType]: alt.value
        };

        const sim = _simulateAlternative(actual, altConfig, pricePath, side);
        const improvement = sim.altPnl - actualPnl;
        const actualValue = actual[paramType];

        _stmts.insertRun.run(
            userId, env, tradeId, paramType,
            actualValue, alt.value,
            actualPnl, sim.altPnl,
            sim.wouldHitSL ? 1 : 0,
            sim.wouldHitTP ? 1 : 0,
            improvement, ts
        );

        results.push({
            paramType,
            actualValue,
            altValue: alt.value,
            actualPnl,
            altPnl: sim.altPnl,
            wouldHitSL: sim.wouldHitSL,
            wouldHitTP: sim.wouldHitTP,
            improvement
        });
    }

    return { ran: results.length, results };
}

// ── recordCounterfactualResult ─────────────────────────────────────
function recordCounterfactualResult(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const tradeId = _required(params, 'tradeId');
    const paramType = _required(params, 'paramType');
    const actualValue = _required(params, 'actualValue');
    const altValue = _required(params, 'altValue');
    const actualPnl = _required(params, 'actualPnl');
    const altPnl = _required(params, 'altPnl');
    const wouldHitSL = !!params.wouldHitSL;
    const wouldHitTP = !!params.wouldHitTP;
    const ts = (params && typeof params.ts === 'number') ? params.ts : Date.now();

    if (!PARAM_TYPES.includes(paramType)) {
        throw new Error(`counterfactualEngine: invalid paramType "${paramType}"`);
    }

    const improvement = altPnl - actualPnl;

    _stmts.insertRun.run(
        userId, env, tradeId, paramType,
        actualValue, altValue, actualPnl, altPnl,
        wouldHitSL ? 1 : 0, wouldHitTP ? 1 : 0,
        improvement, ts
    );

    return { recorded: true, improvement };
}

// ── getParameterDriftRecommendations ───────────────────────────────
function getParameterDriftRecommendations(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const lookbackDays = (params && params.lookbackDays) ? params.lookbackDays : 30;

    const since = Date.now() - lookbackDays * 86400000;
    const rows = _stmts.paramAggregate.all(userId, env, since);

    const totalRow = _stmts.countByUserEnv.get(userId, env);
    const totalSamples = totalRow ? totalRow.count : 0;

    if (totalSamples < MIN_TRADES_FOR_RECOMMENDATION) {
        return {
            sufficient: false,
            totalSamples,
            recommendations: []
        };
    }

    const recommendations = [];
    for (const r of rows) {
        const positiveRate = r.samples > 0 ? r.positive_count / r.samples : 0;
        const confident = positiveRate >= RECOMMENDATION_CONFIDENCE_THRESHOLD;
        recommendations.push({
            paramType: r.param_type,
            samples: r.samples,
            avgImprovement: r.avg_improvement,
            positiveRate,
            confident,
            recommendation: confident
                ? `Adjust ${r.param_type} — ${(positiveRate * 100).toFixed(1)}% of alts improved (avg +${r.avg_improvement.toFixed(2)})`
                : null
        });
    }

    return {
        sufficient: true,
        totalSamples,
        recommendations
    };
}

// ── getCounterfactualHistory ───────────────────────────────────────
function getCounterfactualHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const since = (params && params.since) ? params.since : 0;
    const limit = (params && params.limit) ? params.limit : 100;

    const rows = _stmts.historyForUser.all(
        userId, env,
        since > 0 ? 1 : 0, since,
        limit
    );

    return rows.map(r => ({
        id: r.id,
        tradeId: r.trade_id,
        paramType: r.param_type,
        actualValue: r.actual_value,
        altValue: r.alt_value,
        actualPnl: r.actual_pnl,
        altPnl: r.alt_pnl,
        wouldHitSL: r.would_have_hit_sl === 1,
        wouldHitTP: r.would_have_hit_tp === 1,
        improvement: r.improvement,
        createdAt: r.created_at
    }));
}

module.exports = {
    PARAM_TYPES,
    MIN_TRADES_FOR_RECOMMENDATION,
    RECOMMENDATION_CONFIDENCE_THRESHOLD,
    runCounterfactual,
    recordCounterfactualResult,
    getParameterDriftRecommendations,
    getCounterfactualHistory
};
