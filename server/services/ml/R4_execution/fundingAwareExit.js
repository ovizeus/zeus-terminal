'use strict';

/**
 * OMEGA R4 Execution — fundingAwareExit (audit-gap EXEC-N2)
 *
 * EXEC-N2 FUNDING-AWARE EXIT TIMING PROTOCOL.
 * Source: audit 2026-05-05 (project_ml_v3_additional_gaps_audit_2026-05-05.md)
 * Priority: P1 HIGH (money risk on 8h funding pings, annualized 35%+).
 *
 * 8h funding ping schedule (Binance/Bybit perpetuals):
 *   00:00 UTC / 08:00 UTC / 16:00 UTC
 *
 * Decision logic:
 *   - LONG + positive funding → LONG pays SHORT (cost)
 *   - LONG + negative funding → LONG receives (earn)
 *   - SHORT + positive funding → SHORT receives (earn)
 *   - SHORT + negative funding → SHORT pays LONG (cost)
 *
 * Cost spike + proximity to ping → EXIT/REDUCE recommendation before ping.
 *
 * Composability:
 *   - §26 rlPositionManager: consume should_exit signal
 *   - §14 conflictResolution: consume funding_high signal (downstream)
 */

const { db } = require('../../database');

const FUNDING_PING_INTERVAL_MS = 28800000;       // 8 hours
const FUNDING_PING_HOURS_UTC = Object.freeze([0, 8, 16]);
const EXIT_RECOMMENDATIONS = Object.freeze(['HOLD', 'REDUCE', 'EXIT']);

const DEFAULT_THRESHOLDS = Object.freeze({
    exit_cost_pct_balance:     0.001,    // ≥0.1% balance cost → EXIT (annualized: scary)
    reduce_cost_pct_balance:   0.0002,   // ≥0.02% balance cost → REDUCE
    proximity_ms_warning:      1800000,  // 30 min from ping = warning
    high_funding_rate:         0.0005    // 0.05% rate considered high (~55% annualized)
});

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`fundingAwareExit: missing ${key}`);
    }
    return params[key];
}

// ── getNextFundingPing (pure) ──────────────────────────────────────
function getNextFundingPing(params) {
    const timestamp = _required(params, 'timestamp');
    const now = new Date(timestamp);
    const currentHour = now.getUTCHours();
    const currentMinute = now.getUTCMinutes();

    let nextHour = null;
    let nextDay = now.getUTCDate();

    for (const pingHour of FUNDING_PING_HOURS_UTC) {
        if (pingHour > currentHour || (pingHour === currentHour && currentMinute === 0)) {
            nextHour = pingHour;
            break;
        }
    }

    if (nextHour === null) {
        // All pings today passed → next is 00:00 UTC tomorrow
        nextHour = 0;
        nextDay = now.getUTCDate() + 1;
    }

    const next = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        nextDay,
        nextHour, 0, 0, 0
    ));
    return next.getTime();
}

// ── evaluateFundingExposure (pure) ─────────────────────────────────
function evaluateFundingExposure(params) {
    const position = (params && params.position) ? params.position : null;
    const currentFundingRate = (params && typeof params.currentFundingRate === 'number')
        ? params.currentFundingRate : 0;
    const timeToFundingMs = (params && typeof params.timeToFundingMs === 'number')
        ? params.timeToFundingMs : Infinity;

    if (!position || typeof position.sizeUsd !== 'number') {
        return {
            estimatedCostUsd: 0,
            nearFunding: false,
            fundingSide: null
        };
    }

    // LONG pays positive funding (cost = -ve)
    // SHORT receives positive funding (cost = +ve)
    let signMultiplier;
    if (position.side === 'LONG') signMultiplier = -1;
    else if (position.side === 'SHORT') signMultiplier = 1;
    else signMultiplier = 0;

    const estimatedCostUsd = position.sizeUsd * currentFundingRate * signMultiplier;
    const nearFunding = timeToFundingMs <= DEFAULT_THRESHOLDS.proximity_ms_warning;

    return {
        estimatedCostUsd,
        nearFunding,
        fundingSide: signMultiplier > 0 ? 'earning' : (signMultiplier < 0 ? 'paying' : 'flat'),
        rateMagnitude: Math.abs(currentFundingRate),
        sizeUsd: position.sizeUsd
    };
}

// ── shouldExitBeforeFunding (pure) ─────────────────────────────────
function shouldExitBeforeFunding(params) {
    const position = _required(params, 'position');
    const currentFundingRate = _required(params, 'currentFundingRate');
    const timeToFundingMs = _required(params, 'timeToFundingMs');
    const balanceUsd = (params && typeof params.balanceUsd === 'number')
        ? params.balanceUsd : 100000;
    const thresholds = (params && params.thresholds) ? params.thresholds : DEFAULT_THRESHOLDS;

    const exposure = evaluateFundingExposure({
        position, currentFundingRate, timeToFundingMs
    });

    // Earning side or zero → HOLD
    if (exposure.estimatedCostUsd >= 0) {
        return {
            shouldExit: false,
            recommendation: 'HOLD',
            reason: 'funding_earning_or_neutral',
            exposure
        };
    }

    // Cost magnitude relative to balance
    const costPctBalance = Math.abs(exposure.estimatedCostUsd) / balanceUsd;

    let recommendation = 'HOLD';
    let reason = 'within_thresholds';
    let shouldExit = false;

    if (costPctBalance >= thresholds.exit_cost_pct_balance) {
        recommendation = 'EXIT';
        reason = 'funding_cost_exceeds_exit_threshold';
        shouldExit = true;
    } else if (costPctBalance >= thresholds.reduce_cost_pct_balance) {
        recommendation = 'REDUCE';
        reason = 'funding_cost_above_reduce_threshold';
        shouldExit = false;
    } else if (Math.abs(currentFundingRate) >= thresholds.high_funding_rate
               && exposure.nearFunding) {
        recommendation = 'REDUCE';
        reason = 'high_funding_rate_near_ping';
        shouldExit = false;
    }

    return {
        shouldExit,
        recommendation,
        reason,
        exposure,
        costPctBalance
    };
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertEvaluation: db.prepare(`
        INSERT INTO ml_funding_evaluations
        (user_id, resolved_env, pos_id, current_funding_rate, time_to_funding_ms,
         estimated_cost_usd, recommendation, should_exit, reason, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listHistory: db.prepare(`
        SELECT * FROM ml_funding_evaluations
        WHERE user_id = ? AND resolved_env = ?
          AND (? IS NULL OR pos_id = ?)
          AND (? = 0 OR created_at >= ?)
        ORDER BY created_at DESC, id DESC
        LIMIT ?
    `)
};

// ── recordFundingEvaluation ────────────────────────────────────────
function recordFundingEvaluation(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const posId = (params && params.posId) ? params.posId : null;
    const evaluation = _required(params, 'evaluation');
    const recommendation = evaluation.recommendation;

    if (!EXIT_RECOMMENDATIONS.includes(recommendation)) {
        throw new Error(`fundingAwareExit: invalid recommendation "${recommendation}"`);
    }

    _stmts.insertEvaluation.run(
        userId, env, posId,
        evaluation.currentFundingRate || 0,
        evaluation.timeToFundingMs || 0,
        evaluation.estimatedCostUsd || 0,
        recommendation,
        evaluation.shouldExit ? 1 : 0,
        evaluation.reason || null,
        Date.now()
    );

    return { recorded: true };
}

// ── getFundingHistory ──────────────────────────────────────────────
function getFundingHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const posId = (params && params.posId) ? params.posId : null;
    const since = (params && params.since) ? params.since : 0;
    const limit = (params && params.limit) ? params.limit : 100;

    const rows = _stmts.listHistory.all(
        userId, env, posId, posId,
        since > 0 ? 1 : 0, since, limit
    );

    return rows.map(r => ({
        id: r.id,
        posId: r.pos_id,
        currentFundingRate: r.current_funding_rate,
        timeToFundingMs: r.time_to_funding_ms,
        estimatedCostUsd: r.estimated_cost_usd,
        recommendation: r.recommendation,
        shouldExit: r.should_exit === 1,
        reason: r.reason,
        createdAt: r.created_at
    }));
}

module.exports = {
    FUNDING_PING_INTERVAL_MS,
    FUNDING_PING_HOURS_UTC,
    EXIT_RECOMMENDATIONS,
    DEFAULT_THRESHOLDS,
    getNextFundingPing,
    evaluateFundingExposure,
    shouldExitBeforeFunding,
    recordFundingEvaluation,
    getFundingHistory
};
