'use strict';

/**
 * OMEGA R5A Learning — strategyCrowdingDetector (canonical §41)
 *
 * §41 STRATEGY CROWDING DETECTION.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1520-1521.
 *
 * "Există un al treilea tip de drift pe care aproape nimeni nu îl implementează:
 *  edge decay din crowding de strategie."
 *
 * Distinct de:
 *   - market drift (regime change)
 *   - model drift (input distribution shift detectable prin KS/PSI)
 *   - CROWDING drift: edge gradually disappears as more participants
 *     identify same setup. Distribution looks NORMAL but edge dispare.
 *
 * Track hit rate per setup_type rolling window. Compare baseline (old)
 * vs recent. If recent_hit_rate drops >20% relative to baseline →
 * crowding signal.
 */

const { db } = require('../../database');

const SETUP_TYPES = Object.freeze([
    'liquidity_sweep',
    'funding_extreme',
    'cross_venue_div',
    'stop_run_reclaim',
    'cvd_divergence',
    'breakout',
    'mean_reversion',
    'momentum_continuation'
]);

const DEGRADATION_THRESHOLD = 0.20;  // 20% drop in hit rate
const MIN_SAMPLES_FOR_DETECTION = 10;
const DEFAULT_WINDOW_DAYS = 30;
const BASELINE_LOOKBACK_DAYS = 90;
const DAYS_MS = 86400000;

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`strategyCrowdingDetector: missing ${key}`);
    }
    return params[key];
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertOutcome: db.prepare(`
        INSERT INTO ml_strategy_crowding
        (user_id, resolved_env, setup_type, hit_rate, slippage_bps, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `),
    statsForWindow: db.prepare(`
        SELECT COUNT(*) AS count,
               AVG(hit_rate) AS avg_hit_rate,
               AVG(COALESCE(slippage_bps, 0)) AS avg_slippage
        FROM ml_strategy_crowding
        WHERE user_id = ? AND resolved_env = ?
          AND setup_type = ?
          AND created_at >= ? AND created_at < ?
    `),
    listAllSetups: db.prepare(`
        SELECT DISTINCT setup_type FROM ml_strategy_crowding
        WHERE user_id = ? AND resolved_env = ?
    `),
    overallStats: db.prepare(`
        SELECT COUNT(*) AS count,
               AVG(hit_rate) AS avg_hit_rate
        FROM ml_strategy_crowding
        WHERE user_id = ? AND resolved_env = ?
          AND setup_type = ?
          AND (? = 0 OR created_at >= ?)
    `)
};

// ── recordSetupOutcome ─────────────────────────────────────────────
function recordSetupOutcome(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const setupType = _required(params, 'setupType');
    const hitRate = _required(params, 'hitRate');
    const slippage = (params && typeof params.slippage === 'number') ? params.slippage : null;
    const ts = (params && typeof params.ts === 'number') ? params.ts : Date.now();

    if (!SETUP_TYPES.includes(setupType)) {
        throw new Error(`strategyCrowdingDetector: invalid setupType "${setupType}"`);
    }

    _stmts.insertOutcome.run(userId, env, setupType, hitRate, slippage, ts);
    return { recorded: true };
}

// ── detectCrowding ─────────────────────────────────────────────────
function detectCrowding(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const setupType = _required(params, 'setupType');
    const windowDays = (params && params.windowDays) ? params.windowDays : DEFAULT_WINDOW_DAYS;

    const now = Date.now();
    const recentStart = now - windowDays * DAYS_MS;
    const baselineEnd = recentStart;
    const baselineStart = now - BASELINE_LOOKBACK_DAYS * DAYS_MS;

    const recent = _stmts.statsForWindow.get(userId, env, setupType, recentStart, now + 1);
    const baseline = _stmts.statsForWindow.get(userId, env, setupType, baselineStart, baselineEnd);

    if (!recent || recent.count < MIN_SAMPLES_FOR_DETECTION
        || !baseline || baseline.count < MIN_SAMPLES_FOR_DETECTION) {
        return {
            crowdingDetected: false,
            reason: 'insufficient_samples',
            recentCount: recent ? recent.count : 0,
            baselineCount: baseline ? baseline.count : 0
        };
    }

    const baselineHitRate = baseline.avg_hit_rate;
    const recentHitRate = recent.avg_hit_rate;
    const degradationPct = baselineHitRate > 0
        ? (baselineHitRate - recentHitRate) / baselineHitRate
        : 0;

    const crowdingDetected = degradationPct >= DEGRADATION_THRESHOLD;

    return {
        crowdingDetected,
        degradationPct,
        currentHitRate: recentHitRate,
        baselineHitRate,
        recentCount: recent.count,
        baselineCount: baseline.count
    };
}

// ── getDegradedSetups ──────────────────────────────────────────────
function getDegradedSetups(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const threshold = (params && typeof params.threshold === 'number')
        ? params.threshold : DEGRADATION_THRESHOLD;

    const setupTypes = _stmts.listAllSetups.all(userId, env).map(r => r.setup_type);

    const degraded = [];
    for (const setupType of setupTypes) {
        const r = detectCrowding({ userId, resolvedEnv: env, setupType });
        if (r.crowdingDetected && r.degradationPct >= threshold) {
            degraded.push({
                setupType,
                degradationPct: r.degradationPct,
                currentHitRate: r.currentHitRate,
                baselineHitRate: r.baselineHitRate
            });
        }
    }

    return degraded;
}

// ── getSetupTrend ──────────────────────────────────────────────────
function getSetupTrend(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const setupType = _required(params, 'setupType');
    const since = (params && params.since) ? params.since : 0;

    const row = _stmts.overallStats.get(
        userId, env, setupType,
        since > 0 ? 1 : 0, since
    );

    return {
        setupType,
        totalObservations: row.count || 0,
        avgHitRate: row.avg_hit_rate || 0
    };
}

module.exports = {
    SETUP_TYPES,
    DEGRADATION_THRESHOLD,
    MIN_SAMPLES_FOR_DETECTION,
    DEFAULT_WINDOW_DAYS,
    BASELINE_LOOKBACK_DAYS,
    recordSetupOutcome,
    detectCrowding,
    getDegradedSetups,
    getSetupTrend
};
