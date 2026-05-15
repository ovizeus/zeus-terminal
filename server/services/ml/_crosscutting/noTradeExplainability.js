'use strict';

/**
 * OMEGA Cross-cutting — noTradeExplainability (canonical §43)
 *
 * §43 NO TRADE EXPLAINABILITY.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1524-1525.
 *
 * Closes ASYMMETRIC LEARNING GAP: spec explică doar de ce intră, nu de ce nu
 * intră. Dacă botul refuză 40 trades/săpt + intră în 8, pierzi 83% din info.
 *
 * Per NO_TRADE: signal_candidate + veto_reason + score + threshold + regime
 * Retrospective outcome:
 *   - market moved ≥3R în direction anticipated → MISSED_OPPORTUNITY
 *   - market moved ≥1R against → GOOD_SKIP
 *   - small move (<1R) → NEUTRAL
 *
 * Selectivity score = miss_rate vs good_skip_rate → TOO_SELECTIVE vs APPROPRIATE.
 */

const { db } = require('../../database');

const NO_TRADE_REASONS = Object.freeze([
    'signal_below_threshold',
    'veto_active',
    'regime_mismatch',
    'data_stale',
    'portfolio_full',
    'observer_mode',
    'circuit_breaker',
    'low_confidence'
]);

const OUTCOME_TYPES = Object.freeze([
    'MISSED_OPPORTUNITY', 'GOOD_SKIP', 'NEUTRAL', 'PENDING'
]);

const MISSED_OPPORTUNITY_R_THRESHOLD = 3.0;  // per spec line 1525
const GOOD_SKIP_R_THRESHOLD = 1.0;
const NEUTRAL_R_THRESHOLD = 1.0;

// Selectivity classification thresholds
const TOO_SELECTIVE_MISS_RATE = 0.5;
const APPROPRIATE_MIN_OUTCOMES = 10;

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`noTradeExplainability: missing ${key}`);
    }
    return params[key];
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertDecision: db.prepare(`
        INSERT INTO ml_no_trade_decisions
        (user_id, resolved_env, symbol, signal_candidate_json,
         veto_reason, score, threshold, regime, expected_direction, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertOutcome: db.prepare(`
        INSERT INTO ml_no_trade_outcomes
        (no_trade_id, user_id, resolved_env, market_move_r,
         direction_matched, outcome_type, validated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    statsByReason: db.prepare(`
        SELECT veto_reason, COUNT(*) AS count FROM ml_no_trade_decisions
        WHERE user_id = ? AND resolved_env = ?
          AND (? IS NULL OR regime = ?)
          AND (? = 0 OR created_at >= ?)
        GROUP BY veto_reason
    `),
    missedOpportunities: db.prepare(`
        SELECT d.*, o.market_move_r, o.outcome_type
        FROM ml_no_trade_decisions d
        JOIN ml_no_trade_outcomes o ON o.no_trade_id = d.id
        WHERE d.user_id = ? AND d.resolved_env = ?
          AND o.outcome_type = 'MISSED_OPPORTUNITY'
          AND o.market_move_r >= ?
          AND (? = 0 OR d.created_at >= ?)
        ORDER BY o.market_move_r DESC, d.id DESC
        LIMIT ?
    `),
    outcomeStats: db.prepare(`
        SELECT outcome_type, COUNT(*) AS count FROM ml_no_trade_outcomes
        WHERE user_id = ? AND resolved_env = ?
          AND (? = 0 OR validated_at >= ?)
        GROUP BY outcome_type
    `)
};

// ── _classifyOutcome (pure) ────────────────────────────────────────
function _classifyOutcome(marketMoveR, directionMatched) {
    const absMove = Math.abs(marketMoveR);
    if (absMove < NEUTRAL_R_THRESHOLD) return 'NEUTRAL';
    if (directionMatched && absMove >= MISSED_OPPORTUNITY_R_THRESHOLD) return 'MISSED_OPPORTUNITY';
    if (!directionMatched && absMove >= GOOD_SKIP_R_THRESHOLD) return 'GOOD_SKIP';
    return 'NEUTRAL';
}

// ── recordNoTrade ──────────────────────────────────────────────────
function recordNoTrade(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const signalCandidate = _required(params, 'signalCandidate');
    const vetoReason = _required(params, 'vetoReason');
    const score = _required(params, 'score');
    const threshold = _required(params, 'threshold');
    const symbol = (params && params.symbol) ? params.symbol : null;
    const regime = (params && params.regime) ? params.regime : null;
    const expectedDirection = (params && params.expectedDirection) ? params.expectedDirection : null;

    if (!NO_TRADE_REASONS.includes(vetoReason)) {
        throw new Error(`noTradeExplainability: invalid vetoReason "${vetoReason}"`);
    }

    const result = _stmts.insertDecision.run(
        userId, env, symbol,
        JSON.stringify(signalCandidate),
        vetoReason, score, threshold, regime,
        expectedDirection, Date.now()
    );

    return { recorded: true, noTradeId: result.lastInsertRowid };
}

// ── recordRetrospectiveOutcome ─────────────────────────────────────
function recordRetrospectiveOutcome(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const noTradeId = _required(params, 'noTradeId');
    const marketMoveR = _required(params, 'marketMoveR');
    const directionMatched = !!params.directionMatched;

    const outcomeType = _classifyOutcome(marketMoveR, directionMatched);

    _stmts.insertOutcome.run(
        noTradeId, userId, env,
        marketMoveR,
        directionMatched ? 1 : 0,
        outcomeType, Date.now()
    );

    return { recorded: true, outcomeType };
}

// ── getNoTradeStats ────────────────────────────────────────────────
function getNoTradeStats(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const regime = (params && params.regime) ? params.regime : null;
    const since = (params && params.since) ? params.since : 0;

    const rows = _stmts.statsByReason.all(
        userId, env, regime, regime,
        since > 0 ? 1 : 0, since
    );

    const byReason = {};
    let totalNoTrades = 0;
    for (const row of rows) {
        byReason[row.veto_reason] = row.count;
        totalNoTrades += row.count;
    }

    return { totalNoTrades, byReason };
}

// ── getMissedOpportunities ─────────────────────────────────────────
function getMissedOpportunities(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const minMissedR = (params && typeof params.minMissedR === 'number')
        ? params.minMissedR : MISSED_OPPORTUNITY_R_THRESHOLD;
    const since = (params && params.since) ? params.since : 0;
    const limit = (params && params.limit) ? params.limit : 100;

    const rows = _stmts.missedOpportunities.all(
        userId, env, minMissedR,
        since > 0 ? 1 : 0, since,
        limit
    );

    return rows.map(r => ({
        noTradeId: r.id,
        symbol: r.symbol,
        vetoReason: r.veto_reason,
        score: r.score,
        threshold: r.threshold,
        regime: r.regime,
        expectedDirection: r.expected_direction,
        marketMoveR: r.market_move_r,
        outcomeType: r.outcome_type,
        createdAt: r.created_at
    }));
}

// ── getSelectivityScore ────────────────────────────────────────────
function getSelectivityScore(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const since = (params && params.since) ? params.since : 0;

    const rows = _stmts.outcomeStats.all(
        userId, env,
        since > 0 ? 1 : 0, since
    );

    let totalOutcomes = 0;
    let missed = 0;
    let goodSkip = 0;
    let neutral = 0;
    for (const row of rows) {
        totalOutcomes += row.count;
        if (row.outcome_type === 'MISSED_OPPORTUNITY') missed = row.count;
        if (row.outcome_type === 'GOOD_SKIP') goodSkip = row.count;
        if (row.outcome_type === 'NEUTRAL') neutral = row.count;
    }

    if (totalOutcomes < APPROPRIATE_MIN_OUTCOMES) {
        return {
            score: null,
            classification: 'INSUFFICIENT_DATA',
            totalOutcomes,
            missed, goodSkip, neutral
        };
    }

    const missRate = missed / totalOutcomes;
    const goodSkipRate = goodSkip / totalOutcomes;

    let classification;
    if (missRate >= TOO_SELECTIVE_MISS_RATE) {
        classification = 'TOO_SELECTIVE';
    } else if (goodSkipRate >= 0.5) {
        classification = 'GOOD';
    } else if (goodSkipRate >= 0.3) {
        classification = 'APPROPRIATE';
    } else {
        classification = 'AMBIGUOUS';
    }

    const score = goodSkipRate - missRate;  // higher = better selectivity

    return {
        score,
        classification,
        missRate,
        goodSkipRate,
        totalOutcomes,
        missed, goodSkip, neutral
    };
}

module.exports = {
    NO_TRADE_REASONS,
    OUTCOME_TYPES,
    MISSED_OPPORTUNITY_R_THRESHOLD,
    GOOD_SKIP_R_THRESHOLD,
    NEUTRAL_R_THRESHOLD,
    recordNoTrade,
    recordRetrospectiveOutcome,
    getNoTradeStats,
    getMissedOpportunities,
    getSelectivityScore
};
