'use strict';

/**
 * OMEGA R5A Learning Core — regimeMetrics (canonical §17)
 *
 * METRICI PE REGIM per spec — slice attribution data by regime, session,
 * direction, and confidence bucket. Compute hit_rate, RR, slippage, PnL,
 * MFE/MAE, time-in-trade. Drift + calibration scores are NULL stubs here;
 * real wiring happens in §21 (drift detection) + §20 (calibration).
 *
 * Builds on Migration 044 columns added to ml_attribution_events. Pure
 * read-only queries; no writes. All queries are per-user × per-env scoped.
 *
 * NOT IMPLEMENTED HERE (other §):
 *   - drift_score → §21
 *   - calibration_quality → §20
 *   - false_breakout_rate → needs breakout-specific metadata (§ later)
 */

const { db } = require('../../database');

const REGIME_VALUES = Object.freeze([
    'trend', 'range', 'chop', 'squeeze', 'news-risk', 'high-vol', 'low-vol'
]);

const CONFIDENCE_BUCKETS = Object.freeze(['low', 'mid', 'high', 'very_high']);

function getConfidenceBucket(score) {
    if (typeof score !== 'number' || !Number.isFinite(score)) return null;
    if (score < 0.55) return 'low';
    if (score < 0.7) return 'mid';
    if (score < 0.85) return 'high';
    return 'very_high';
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    aggregateByFilter: db.prepare(`
        SELECT
            COUNT(*) AS total_count,
            SUM(CASE WHEN outcome_class = 'WIN' THEN 1 ELSE 0 END) AS wins,
            SUM(CASE WHEN outcome_class IN ('WIN', 'LOSS') THEN 1 ELSE 0 END) AS decisive,
            AVG(r_multiple) AS avg_rr,
            AVG(slippage_pct) AS avg_slippage_pct,
            SUM(pnl_pct) AS sum_pnl_pct,
            AVG(mfe_pct) AS avg_mfe,
            AVG(mae_pct) AS avg_mae,
            AVG(time_in_trade_min) AS avg_time_in_trade_min
        FROM ml_attribution_events
        WHERE user_id = ? AND resolved_env = ?
          AND attributed_at >= ?
          AND ($regimeNull = 1 OR regime = $regime)
          AND ($sessionNull = 1 OR session = $session)
          AND ($sideNull = 1 OR side = $side)
          AND ($scoreMin IS NULL OR score_at_entry >= $scoreMin)
          AND ($scoreMaxExclusive IS NULL OR score_at_entry < $scoreMaxExclusive)
    `),
    listRegimes: db.prepare(`
        SELECT DISTINCT regime FROM ml_attribution_events
        WHERE user_id = ? AND resolved_env = ? AND attributed_at >= ? AND regime IS NOT NULL
    `)
};

// Helper that wraps the parametrized aggregate with named bindings.
function _aggregate(userId, env, sinceMs, opts = {}) {
    const regime = opts.regime ?? null;
    const session = opts.session ?? null;
    const side = opts.side ?? null;
    const scoreMin = opts.scoreMin ?? null;
    const scoreMaxExclusive = opts.scoreMaxExclusive ?? null;

    // The prepared statement uses positional ? for user/env/since and then
    // bind-by-name; better-sqlite3 supports mixing if we run with object params.
    // For simplicity, rebuild without positional ? for the conditional fields.
    return db.prepare(`
        SELECT
            COUNT(*) AS total_count,
            SUM(CASE WHEN outcome_class = 'WIN' THEN 1 ELSE 0 END) AS wins,
            SUM(CASE WHEN outcome_class IN ('WIN', 'LOSS') THEN 1 ELSE 0 END) AS decisive,
            AVG(r_multiple) AS avg_rr,
            AVG(slippage_pct) AS avg_slippage_pct,
            SUM(pnl_pct) AS sum_pnl_pct,
            AVG(mfe_pct) AS avg_mfe,
            AVG(mae_pct) AS avg_mae,
            AVG(time_in_trade_min) AS avg_time_in_trade_min
        FROM ml_attribution_events
        WHERE user_id = @userId AND resolved_env = @env
          AND attributed_at >= @sinceMs
          AND (@regime IS NULL OR regime = @regime)
          AND (@session IS NULL OR session = @session)
          AND (@side IS NULL OR side = @side)
          AND (@scoreMin IS NULL OR score_at_entry >= @scoreMin)
          AND (@scoreMaxExclusive IS NULL OR score_at_entry < @scoreMaxExclusive)
    `).get({
        userId, env, sinceMs,
        regime, session, side, scoreMin, scoreMaxExclusive
    });
}

function _shape(row) {
    const total = row.total_count || 0;
    const decisive = row.decisive || 0;
    return {
        total_count: total,
        hit_rate: decisive > 0 ? (row.wins || 0) / decisive : 0,
        avg_rr: row.avg_rr === null ? 0 : Number(row.avg_rr) || 0,
        avg_slippage_pct: row.avg_slippage_pct === null ? 0 : Number(row.avg_slippage_pct) || 0,
        sum_pnl_pct: row.sum_pnl_pct === null ? 0 : Number(row.sum_pnl_pct) || 0,
        avg_mfe: row.avg_mfe === null ? 0 : Number(row.avg_mfe) || 0,
        avg_mae: row.avg_mae === null ? 0 : Number(row.avg_mae) || 0,
        avg_time_in_trade_min: row.avg_time_in_trade_min === null ? 0 : Number(row.avg_time_in_trade_min) || 0,
        drift_score: null,           // [§21 stub] real wiring in drift detection point
        calibration_quality: null    // [§20 stub] real wiring in calibration point
    };
}

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`regimeMetrics: missing ${key}`);
    }
    return params[key];
}

// ── Public API ─────────────────────────────────────────────────────
function getRegimeMetrics(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const regime = _required(params, 'regime');
    const sinceMs = params.sinceMs || 0;
    return _shape(_aggregate(userId, env, sinceMs, { regime }));
}

function getAllRegimeMetrics(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const sinceMs = params.sinceMs || 0;
    const regimes = _stmts.listRegimes.all(userId, env, sinceMs).map(r => r.regime);
    const out = {};
    for (const r of regimes) {
        out[r] = _shape(_aggregate(userId, env, sinceMs, { regime: r }));
    }
    return out;
}

function getSessionMetrics(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const session = _required(params, 'session');
    const sinceMs = params.sinceMs || 0;
    return _shape(_aggregate(userId, env, sinceMs, { session }));
}

function getDirectionMetrics(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const sinceMs = params.sinceMs || 0;
    return {
        long: _shape(_aggregate(userId, env, sinceMs, { side: 'long' })),
        short: _shape(_aggregate(userId, env, sinceMs, { side: 'short' }))
    };
}

function getMetricsByConfidenceBucket(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const sinceMs = params.sinceMs || 0;
    const ranges = {
        low: { scoreMin: null, scoreMaxExclusive: 0.55 },
        mid: { scoreMin: 0.55, scoreMaxExclusive: 0.7 },
        high: { scoreMin: 0.7, scoreMaxExclusive: 0.85 },
        very_high: { scoreMin: 0.85, scoreMaxExclusive: null }
    };
    const out = {};
    for (const b of CONFIDENCE_BUCKETS) {
        const row = _aggregate(userId, env, sinceMs, ranges[b]);
        const total = row.total_count || 0;
        const decisive = row.decisive || 0;
        out[b] = {
            n: total,
            hit_rate: decisive > 0 ? (row.wins || 0) / decisive : 0,
            avg_pnl_pct: total > 0 && row.sum_pnl_pct !== null ? row.sum_pnl_pct / total : 0
        };
    }
    return out;
}

module.exports = {
    getRegimeMetrics,
    getAllRegimeMetrics,
    getSessionMetrics,
    getDirectionMetrics,
    getMetricsByConfidenceBucket,
    getConfidenceBucket,
    CONFIDENCE_BUCKETS,
    REGIME_VALUES
};
