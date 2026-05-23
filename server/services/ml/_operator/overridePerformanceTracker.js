'use strict';

/**
 * OMEGA Operator Interaction — overridePerformanceTracker (canonical §49)
 *
 * §49 HUMAN OVERRIDE LOGGING + PERFORMANCE COMPARISON.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1574-1582.
 *
 * §34 humanInTheLoop = override MECHANISM.
 * §49 = override PERFORMANCE AUDIT.
 *
 * Per override:
 *   - log: time, symbol, direction, override_type, original vs final decision
 *   - outcome: actual_pnl vs hypothetical_bot_pnl (had operator NOT intervened)
 *   - delta = actual_pnl - hypothetical_bot_pnl
 *
 * Weekly report: "human overrides added +X% or -Y%"
 */

const { db } = require('../../database');

const OVERRIDE_TYPES = Object.freeze([
    'entry', 'exit', 'size', 'sl', 'tp', 'cancel', 'skip'
]);

const DELTA_CLASSIFICATION = Object.freeze(['POSITIVE', 'NEGATIVE', 'NEUTRAL']);

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`overridePerformanceTracker: missing ${key}`);
    }
    return params[key];
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertOverride: db.prepare(`
        INSERT INTO ml_override_performance
        (user_id, resolved_env, pos_id, symbol, direction, override_type,
         original_decision_json, final_decision_json, actor, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateOutcome: db.prepare(`
        UPDATE ml_override_performance
        SET actual_pnl = ?, hypothetical_bot_pnl = ?, delta = ?
        WHERE id = ?
    `),
    stats: db.prepare(`
        SELECT COUNT(*) AS total,
               SUM(CASE WHEN delta IS NOT NULL THEN delta ELSE 0 END) AS net_delta,
               SUM(CASE WHEN delta > 0 THEN 1 ELSE 0 END) AS positive_count,
               SUM(CASE WHEN delta < 0 THEN 1 ELSE 0 END) AS negative_count
        FROM ml_override_performance
        WHERE user_id = ? AND resolved_env = ?
          AND (? = 0 OR created_at >= ?)
    `)
};

// ── recordOverride ─────────────────────────────────────────────────
function recordOverride(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const symbol = _required(params, 'symbol');
    const direction = _required(params, 'direction');
    const overrideType = _required(params, 'overrideType');
    const originalDecision = _required(params, 'originalDecision');
    const finalDecision = _required(params, 'finalDecision');
    const actor = _required(params, 'actor');
    const posId = (params && params.posId) ? params.posId : null;

    if (!OVERRIDE_TYPES.includes(overrideType)) {
        throw new Error(`overridePerformanceTracker: invalid overrideType "${overrideType}"`);
    }

    const result = _stmts.insertOverride.run(
        userId, env, posId, symbol, direction, overrideType,
        JSON.stringify(originalDecision),
        JSON.stringify(finalDecision),
        actor, Date.now()
    );

    return { recorded: true, overrideId: result.lastInsertRowid };
}

// ── recordOverrideOutcome ──────────────────────────────────────────
function recordOverrideOutcome(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const overrideId = _required(params, 'overrideId');
    const actualPnl = _required(params, 'actualPnl');
    const hypotheticalBotPnl = _required(params, 'hypotheticalBotPnl');
    void userId; void env;

    const delta = actualPnl - hypotheticalBotPnl;
    _stmts.updateOutcome.run(actualPnl, hypotheticalBotPnl, delta, overrideId);

    return { recorded: true, delta };
}

// ── getOverrideStats ───────────────────────────────────────────────
function getOverrideStats(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const since = (params && params.since) ? params.since : 0;

    const row = _stmts.stats.get(
        userId, env,
        since > 0 ? 1 : 0, since
    );

    const totalOverrides = row.total || 0;
    const netDelta = row.net_delta || 0;
    const positiveCount = row.positive_count || 0;
    const negativeCount = row.negative_count || 0;

    let classification;
    if (totalOverrides === 0) {
        classification = 'NEUTRAL';
    } else if (netDelta > 0) {
        classification = 'POSITIVE';
    } else if (netDelta < 0) {
        classification = 'NEGATIVE';
    } else {
        classification = 'NEUTRAL';
    }

    return {
        totalOverrides,
        netDelta,
        positiveCount,
        negativeCount,
        classification
    };
}

// ── generateWeeklyReport ───────────────────────────────────────────
function generateWeeklyReport(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const weekStart = _required(params, 'weekStart');

    const stats = getOverrideStats({
        userId, resolvedEnv: env, since: weekStart
    });

    let narrative;
    if (stats.totalOverrides === 0) {
        narrative = `Week ${new Date(weekStart).toISOString().slice(0, 10)}: no overrides recorded.`;
    } else {
        const sign = stats.netDelta >= 0 ? '+' : '';
        narrative = `Week ${new Date(weekStart).toISOString().slice(0, 10)}: ` +
            `${stats.totalOverrides} overrides, ` +
            `${sign}${stats.netDelta.toFixed(2)} delta vs bot baseline ` +
            `(${stats.positiveCount} positive / ${stats.negativeCount} negative). ` +
            `Classification: ${stats.classification}.`;
    }

    return {
        weekStart,
        ...stats,
        narrative
    };
}

module.exports = {
    OVERRIDE_TYPES,
    DELTA_CLASSIFICATION,
    recordOverride,
    recordOverrideOutcome,
    getOverrideStats,
    generateWeeklyReport
};
