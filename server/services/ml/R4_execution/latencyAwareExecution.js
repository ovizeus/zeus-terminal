'use strict';

/**
 * OMEGA R4 Execution — latencyAwareExecution (canonical §45)
 *
 * §45 LATENCY-AWARE EXECUTION.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1528-1538.
 *
 * End-to-end latency measurement (feed → decision → order → ack) +
 * behavior adaptation:
 *   <50ms → SCALPING_ALLOWED (all behaviors)
 *   50-150ms → SWING_ONLY (no scalping, only swing/HTF)
 *   >150ms → OBSERVER_ONLY (zero entries, alert operator)
 *
 * Distinct de:
 *   - §28 monitorLatency (per-component latency monitoring)
 *   - §35 monitoring (KPI snapshots)
 *   - Raid-L latencyBudgetGuard (hard-cap drop on exceeded)
 *
 * §45 is the BEHAVIOR ADAPTATION layer based on measured E2E.
 */

const { db } = require('../../database');

const LATENCY_MODES = Object.freeze([
    'SCALPING_ALLOWED',
    'SWING_ONLY',
    'OBSERVER_ONLY'
]);

const MODE_THRESHOLDS_MS = Object.freeze({
    scalping_max: 50,   // <50ms = scalping allowed
    swing_max:    150   // 50-150ms = swing only, >150ms = observer
});

const ALLOWED_BEHAVIORS_BY_MODE = Object.freeze({
    SCALPING_ALLOWED: ['scalp', 'swing', 'htf', 'observe'],
    SWING_ONLY:       ['swing', 'htf', 'observe'],
    OBSERVER_ONLY:    ['observe']
});

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`latencyAwareExecution: missing ${key}`);
    }
    return params[key];
}

function _classifyMode(e2eMs) {
    if (e2eMs < MODE_THRESHOLDS_MS.scalping_max) return 'SCALPING_ALLOWED';
    if (e2eMs <= MODE_THRESHOLDS_MS.swing_max) return 'SWING_ONLY';
    return 'OBSERVER_ONLY';
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertMeasurement: db.prepare(`
        INSERT INTO ml_latency_measurements
        (user_id, resolved_env, e2e_ms,
         feed_to_decision_ms, decision_to_order_ms, order_to_ack_ms,
         mode, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    upsertMode: db.prepare(`
        INSERT INTO ml_latency_modes
        (user_id, resolved_env, mode, current_latency_ms, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, resolved_env) DO UPDATE SET
            mode = excluded.mode,
            current_latency_ms = excluded.current_latency_ms,
            updated_at = excluded.updated_at
    `),
    getMode: db.prepare(`
        SELECT * FROM ml_latency_modes
        WHERE user_id = ? AND resolved_env = ?
    `),
    trendStats: db.prepare(`
        SELECT COUNT(*) AS count,
               AVG(e2e_ms) AS avg_e2e,
               MAX(e2e_ms) AS max_e2e,
               MIN(e2e_ms) AS min_e2e
        FROM ml_latency_measurements
        WHERE user_id = ? AND resolved_env = ?
          AND (? = 0 OR created_at >= ?)
    `)
};

// ── measureEndToEnd (PURE, then persists) ──────────────────────────
function measureEndToEnd(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const feedTs = _required(params, 'feedTs');
    const decisionTs = _required(params, 'decisionTs');
    const orderTs = _required(params, 'orderTs');
    const ackTs = _required(params, 'ackTs');

    const feedToDecision = decisionTs - feedTs;
    const decisionToOrder = orderTs - decisionTs;
    const orderToAck = ackTs - orderTs;
    const e2eMs = ackTs - feedTs;
    const mode = _classifyMode(e2eMs);

    _stmts.insertMeasurement.run(
        userId, env, e2eMs,
        feedToDecision, decisionToOrder, orderToAck,
        mode, Date.now()
    );
    _stmts.upsertMode.run(userId, env, mode, e2eMs, Date.now());

    return {
        e2eMs,
        mode,
        components: {
            feedToDecision,
            decisionToOrder,
            orderToAck
        }
    };
}

// ── getCurrentLatencyMode ──────────────────────────────────────────
function getCurrentLatencyMode(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');

    const row = _stmts.getMode.get(userId, env);
    if (!row) {
        return {
            exists: false,
            mode: 'SCALPING_ALLOWED',
            currentLatencyMs: null,
            allowedBehaviors: ALLOWED_BEHAVIORS_BY_MODE.SCALPING_ALLOWED
        };
    }
    return {
        exists: true,
        mode: row.mode,
        currentLatencyMs: row.current_latency_ms,
        allowedBehaviors: ALLOWED_BEHAVIORS_BY_MODE[row.mode],
        updatedAt: row.updated_at
    };
}

// ── getAllowedBehaviors (pure) ─────────────────────────────────────
function getAllowedBehaviors(params) {
    const mode = _required(params, 'mode');
    if (!LATENCY_MODES.includes(mode)) {
        throw new Error(`latencyAwareExecution: invalid mode "${mode}"`);
    }
    return [...ALLOWED_BEHAVIORS_BY_MODE[mode]];
}

// ── getLatencyTrend ────────────────────────────────────────────────
function getLatencyTrend(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const since = (params && params.since) ? params.since : 0;

    const row = _stmts.trendStats.get(
        userId, env,
        since > 0 ? 1 : 0, since
    );

    return {
        count: row.count || 0,
        avgE2eMs: row.avg_e2e || 0,
        maxE2eMs: row.max_e2e || 0,
        minE2eMs: row.min_e2e || 0
    };
}

module.exports = {
    LATENCY_MODES,
    MODE_THRESHOLDS_MS,
    ALLOWED_BEHAVIORS_BY_MODE,
    measureEndToEnd,
    getCurrentLatencyMode,
    getAllowedBehaviors,
    getLatencyTrend
};
