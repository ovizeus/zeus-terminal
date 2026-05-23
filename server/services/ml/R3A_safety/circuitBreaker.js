'use strict';

/**
 * OMEGA R3A Safety — circuitBreaker (canonical §29)
 *
 * §29 CIRCUIT BREAKER MULTI-NIVEL, GRACEFUL DEGRADATION SI RECOVERY.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1237-1267.
 *
 * "Nu doar kill switch total."
 *
 * 5-level escalation (lines 1240-1253):
 *   L0  normal operation (no degradation)
 *   L1  reduce size
 *   L2  no new entries
 *   L3  management/exits only
 *   L4  full stop (no any action)
 *   L5  flatten (force-close positions)
 *
 * Graceful degradation (lines 1255-1260): missing data feeds disable
 * specific capabilities without forcing full halt.
 *
 * Recovery logic (lines 1262-1267):
 *   - never resume directly to full power
 *   - probation mode after incident
 *   - manual approval required if incident was severe
 *   - auto-resume only after health checks pass
 */

const { db } = require('../../database');

const BREAKER_LEVELS = Object.freeze(['L0', 'L1', 'L2', 'L3', 'L4', 'L5']);

const BREAKER_LEVEL_LABELS = Object.freeze({
    L0: 'NORMAL OPERATION',
    L1: 'REDUCE SIZE',
    L2: 'NO NEW ENTRIES',
    L3: 'MANAGEMENT / EXITS ONLY',
    L4: 'FULL STOP',
    L5: 'FLATTEN POSITIONS'
});

// 5 feeds whose absence triggers graceful degradation per spec lines 1256-1260
const DEGRADATION_FEEDS = Object.freeze([
    'order_book',
    'open_interest',
    'venue_comparison',
    'options_context',
    'sentiment_feed'
]);

// Capabilities that can be disabled by graceful degradation
const CAPABILITY_KEYS = Object.freeze([
    'derivatives_weighting',
    'cross_venue_compare',
    'options_setup',
    'sentiment_filter',
    'orderbook_microstructure'
]);

// Feed → capability impact map (per spec lines 1256-1260)
const FEED_TO_CAPABILITY = Object.freeze({
    order_book:        ['orderbook_microstructure'],
    open_interest:     ['derivatives_weighting'],
    venue_comparison:  ['cross_venue_compare'],
    options_context:   ['options_setup'],
    sentiment_feed:    ['sentiment_filter']
});

const FEED_CONFIDENCE_PENALTY = Object.freeze({
    order_book:       0.10,
    open_interest:    0.08,
    venue_comparison: 0.12,
    options_context:  0.05,
    sentiment_feed:   0.06
});

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`circuitBreaker: missing ${key}`);
    }
    return params[key];
}

function _validateLevel(level) {
    if (!BREAKER_LEVELS.includes(level)) {
        throw new Error(`circuitBreaker: invalid level "${level}" (must be ${BREAKER_LEVELS.join('|')})`);
    }
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    getState: db.prepare(`
        SELECT * FROM ml_circuit_state WHERE user_id = ? AND resolved_env = ?
    `),
    upsertState: db.prepare(`
        INSERT INTO ml_circuit_state
        (user_id, resolved_env, level, reason, actor,
         probation_active, probation_trades_remaining, manual_required,
         since, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, resolved_env) DO UPDATE SET
            level = excluded.level,
            reason = excluded.reason,
            actor = excluded.actor,
            probation_active = excluded.probation_active,
            probation_trades_remaining = excluded.probation_trades_remaining,
            manual_required = excluded.manual_required,
            updated_at = excluded.updated_at,
            since = CASE
                WHEN ml_circuit_state.level != excluded.level THEN excluded.since
                ELSE ml_circuit_state.since
            END
    `),
    insertHistory: db.prepare(`
        INSERT INTO ml_circuit_history
        (user_id, resolved_env, old_level, new_level, transition_type, reason, actor, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
};

// ── getBreakerState ────────────────────────────────────────────────
function getBreakerState(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const row = _stmts.getState.get(userId, env);
    if (!row) {
        return {
            level: 'L0',
            reason: null,
            actor: null,
            probationActive: false,
            probationTradesRemaining: 0,
            manualRequired: false,
            since: null
        };
    }
    return {
        level: row.level,
        reason: row.reason,
        actor: row.actor,
        probationActive: row.probation_active === 1,
        probationTradesRemaining: row.probation_trades_remaining,
        manualRequired: row.manual_required === 1,
        since: row.since
    };
}

// ── setBreakerLevel ────────────────────────────────────────────────
function setBreakerLevel(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const level = _required(params, 'level');
    const reason = _required(params, 'reason');
    const actor = _required(params, 'actor');

    _validateLevel(level);

    const now = Date.now();
    const prior = _stmts.getState.get(userId, env);
    const oldLevel = prior ? prior.level : null;

    _stmts.upsertState.run(
        userId, env, level, reason, actor,
        prior ? prior.probation_active : 0,
        prior ? prior.probation_trades_remaining : 0,
        prior ? prior.manual_required : 0,
        now, now
    );

    _stmts.insertHistory.run(
        userId, env, oldLevel, level, 'ESCALATE', reason, actor, now
    );

    return { level, oldLevel };
}

// ── evaluateGracefulDegradation ────────────────────────────────────
function evaluateGracefulDegradation(params) {
    _required(params, 'userId');
    _required(params, 'resolvedEnv');
    const missingFeeds = (params && Array.isArray(params.missingFeeds))
        ? params.missingFeeds : [];

    const disabledSet = new Set();
    let confidenceReduction = 0;

    for (const feed of missingFeeds) {
        if (!DEGRADATION_FEEDS.includes(feed)) continue;
        const caps = FEED_TO_CAPABILITY[feed] || [];
        for (const c of caps) disabledSet.add(c);
        confidenceReduction += FEED_CONFIDENCE_PENALTY[feed] || 0;
    }

    return {
        disabledCapabilities: Array.from(disabledSet),
        confidenceReduction: Math.min(1.0, confidenceReduction),
        missingFeeds: missingFeeds.filter(f => DEGRADATION_FEEDS.includes(f))
    };
}

// ── enterProbation ─────────────────────────────────────────────────
function enterProbation(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const probationTrades = _required(params, 'probationTrades');
    const manualRequired = !!params.manualRequired;
    const reason = _required(params, 'reason');

    const now = Date.now();
    const prior = _stmts.getState.get(userId, env);
    const currentLevel = prior ? prior.level : 'L0';

    _stmts.upsertState.run(
        userId, env, currentLevel, reason,
        prior ? prior.actor : 'system',
        1,
        probationTrades,
        manualRequired ? 1 : 0,
        prior ? prior.since : now,
        now
    );

    _stmts.insertHistory.run(
        userId, env, currentLevel, currentLevel,
        'PROBATION_ENTER', reason, 'system', now
    );

    return {
        probationActive: true,
        probationTradesRemaining: probationTrades,
        manualRequired
    };
}

// ── attemptAutoResume ──────────────────────────────────────────────
function attemptAutoResume(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const healthChecks = (params && params.healthChecks) ? params.healthChecks : {};

    const prior = _stmts.getState.get(userId, env);
    if (!prior) {
        return { resumed: false, blockers: ['no_state'] };
    }

    const blockers = [];

    if (prior.manual_required === 1) {
        blockers.push('manual_required');
    }
    if (prior.probation_trades_remaining > 0) {
        blockers.push('probation_trades');
    }
    for (const [check, pass] of Object.entries(healthChecks)) {
        if (pass !== true) blockers.push(check);
    }

    if (blockers.length > 0) {
        return { resumed: false, blockers };
    }

    const now = Date.now();
    _stmts.upsertState.run(
        userId, env, 'L0', 'auto_resume_success',
        'system', 0, 0, 0, now, now
    );
    _stmts.insertHistory.run(
        userId, env, prior.level, 'L0',
        'RESUME', 'auto_resume_success', 'system', now
    );

    return { resumed: true, blockers: [] };
}

module.exports = {
    BREAKER_LEVELS,
    BREAKER_LEVEL_LABELS,
    DEGRADATION_FEEDS,
    CAPABILITY_KEYS,
    FEED_TO_CAPABILITY,
    getBreakerState,
    setBreakerLevel,
    evaluateGracefulDegradation,
    enterProbation,
    attemptAutoResume
};
