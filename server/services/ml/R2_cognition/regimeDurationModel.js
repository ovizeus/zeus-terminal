'use strict';

/**
 * OMEGA R2 Cognition — regimeDurationModel (canonical §64)
 *
 * §64 REGIME DURATION MODELING — nu doar ce regim, ci cat de batran
 * e si cand se termina.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1737-1738.
 *
 * "Un bot care stie ca trendul actual are in medie 80 de ore si sunt
 *  deja 72 de ore in el se comporta diferit fata de unul care doar
 *  stie ca e trend."
 *
 * Complements §17 regimeMetrics (current regime detection). §64 adds:
 *   - historical duration distributions per regime_type
 *   - age tracking of current regime
 *   - maturity score (age / median lifetime)
 *   - aggressiveness recommendation based on maturity
 */

const { db } = require('../../database');

const REGIME_TYPES = Object.freeze([
    'trend_up', 'trend_down', 'range', 'chop', 'volatile_expansion'
]);
const AGGRESSIVENESS_LEVELS = Object.freeze(['high', 'normal', 'reduced', 'minimal']);

const MIN_SAMPLES_FOR_DURATION_STATS = 5;
const MATURITY_HIGH_THRESHOLD = 0.85;
const MATURITY_END_THRESHOLD = 1.20;

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`regimeDurationModel: missing ${key}`);
    }
    return params[key];
}

function _percentile(sorted, p) {
    if (sorted.length === 0) return 0;
    const idx = Math.min(
        sorted.length - 1,
        Math.max(0, Math.floor((p / 100) * sorted.length))
    );
    return sorted[idx];
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertHistory: db.prepare(`
        INSERT INTO ml_regime_history
        (user_id, resolved_env, regime_type, start_ts, created_at)
        VALUES (?, ?, ?, ?, ?)
    `),
    closeHistory: db.prepare(`
        UPDATE ml_regime_history
        SET end_ts = ?, duration_ms = ? - start_ts, terminated_naturally = ?
        WHERE id = ? AND end_ts IS NULL
    `),
    getCurrent: db.prepare(`
        SELECT * FROM ml_regime_current_state
        WHERE user_id = ? AND resolved_env = ?
    `),
    upsertCurrent: db.prepare(`
        INSERT INTO ml_regime_current_state
        (user_id, resolved_env, regime_type, started_at, history_id, last_updated)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, resolved_env) DO UPDATE SET
            regime_type = excluded.regime_type,
            started_at = excluded.started_at,
            history_id = excluded.history_id,
            last_updated = excluded.last_updated
    `),
    clearCurrent: db.prepare(`
        DELETE FROM ml_regime_current_state
        WHERE user_id = ? AND resolved_env = ?
    `),
    historyForRegime: db.prepare(`
        SELECT duration_ms FROM ml_regime_history
        WHERE user_id = ? AND resolved_env = ? AND regime_type = ?
          AND duration_ms IS NOT NULL AND start_ts >= ?
        ORDER BY start_ts
    `)
};

// ── recordRegimeStart ──────────────────────────────────────────────
function recordRegimeStart(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const regimeType = _required(params, 'regimeType');
    const startTs = (params && params.startTs) ? params.startTs : Date.now();

    if (!REGIME_TYPES.includes(regimeType)) {
        throw new Error(`regimeDurationModel: invalid regimeType "${regimeType}"`);
    }

    // Close prior current regime (terminated_naturally=1 by default)
    const current = _stmts.getCurrent.get(userId, env);
    if (current && current.history_id) {
        _stmts.closeHistory.run(startTs, startTs, 1, current.history_id);
    }

    // Open new history row
    const result = _stmts.insertHistory.run(
        userId, env, regimeType, startTs, startTs
    );
    const historyId = result.lastInsertRowid;

    // Update current state
    _stmts.upsertCurrent.run(
        userId, env, regimeType, startTs, historyId, startTs
    );

    return { started: true, historyId, regimeType, startTs };
}

// ── recordRegimeEnd ────────────────────────────────────────────────
function recordRegimeEnd(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const endTs = (params && params.endTs) ? params.endTs : Date.now();
    const terminatedNaturally = (params && params.terminatedNaturally !== undefined)
        ? !!params.terminatedNaturally : true;

    const current = _stmts.getCurrent.get(userId, env);
    if (!current) {
        return { ended: false, reason: 'no_current_regime' };
    }

    if (current.history_id) {
        _stmts.closeHistory.run(endTs, endTs, terminatedNaturally ? 1 : 0, current.history_id);
    }
    _stmts.clearCurrent.run(userId, env);

    return {
        ended: true,
        durationMs: endTs - current.started_at,
        regimeType: current.regime_type
    };
}

// ── getRegimeAge ───────────────────────────────────────────────────
function getRegimeAge(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const now = (params && params.now) ? params.now : Date.now();

    const current = _stmts.getCurrent.get(userId, env);
    if (!current) return { exists: false, ageMs: 0 };

    return {
        exists: true,
        regimeType: current.regime_type,
        startedAt: current.started_at,
        ageMs: now - current.started_at
    };
}

// ── getDurationDistribution ────────────────────────────────────────
function getDurationDistribution(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const regimeType = _required(params, 'regimeType');
    const lookbackDays = (params && params.lookbackDays) ? params.lookbackDays : 90;

    if (!REGIME_TYPES.includes(regimeType)) {
        throw new Error(`regimeDurationModel: invalid regimeType "${regimeType}"`);
    }

    const since = Date.now() - lookbackDays * 86400000;
    const rows = _stmts.historyForRegime.all(userId, env, regimeType, since);
    const durations = rows.map(r => r.duration_ms).filter(d => d > 0).sort((a, b) => a - b);

    if (durations.length < MIN_SAMPLES_FOR_DURATION_STATS) {
        return {
            regimeType,
            sufficient: false,
            samples: durations.length
        };
    }

    const sum = durations.reduce((s, x) => s + x, 0);
    return {
        regimeType,
        sufficient: true,
        samples: durations.length,
        meanMs: sum / durations.length,
        medianMs: _percentile(durations, 50),
        p25Ms: _percentile(durations, 25),
        p75Ms: _percentile(durations, 75),
        p95Ms: _percentile(durations, 95)
    };
}

// ── getMaturityScore ───────────────────────────────────────────────
function getMaturityScore(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const now = (params && params.now) ? params.now : Date.now();

    const age = getRegimeAge({ userId, resolvedEnv: env, now });
    if (!age.exists) return { exists: false, score: 0 };

    const dist = getDurationDistribution({
        userId, resolvedEnv: env, regimeType: age.regimeType
    });

    if (!dist.sufficient) {
        return {
            exists: true,
            score: null,
            reason: 'insufficient_history',
            ageMs: age.ageMs
        };
    }

    const score = age.ageMs / dist.medianMs;
    return {
        exists: true,
        score,
        regimeType: age.regimeType,
        ageMs: age.ageMs,
        medianLifetimeMs: dist.medianMs
    };
}

// ── recommendAggressiveness ────────────────────────────────────────
function recommendAggressiveness(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const now = (params && params.now) ? params.now : Date.now();

    const maturity = getMaturityScore({ userId, resolvedEnv: env, now });
    if (!maturity.exists || maturity.score === null) {
        return { level: 'normal', reason: 'no_data', maturityScore: null };
    }

    let level;
    if (maturity.score < 0.30) level = 'high';
    else if (maturity.score < MATURITY_HIGH_THRESHOLD) level = 'normal';
    else if (maturity.score < MATURITY_END_THRESHOLD) level = 'reduced';
    else level = 'minimal';

    return {
        level,
        maturityScore: maturity.score,
        regimeType: maturity.regimeType,
        reason: `regime age ${(maturity.ageMs / 3600000).toFixed(1)}h vs median ${(maturity.medianLifetimeMs / 3600000).toFixed(1)}h`
    };
}

// ── getCurrentRegime ───────────────────────────────────────────────
function getCurrentRegime(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const row = _stmts.getCurrent.get(userId, env);
    if (!row) return { exists: false };
    return {
        exists: true,
        regimeType: row.regime_type,
        startedAt: row.started_at,
        historyId: row.history_id,
        lastUpdated: row.last_updated
    };
}

module.exports = {
    REGIME_TYPES,
    AGGRESSIVENESS_LEVELS,
    MIN_SAMPLES_FOR_DURATION_STATS,
    MATURITY_HIGH_THRESHOLD,
    MATURITY_END_THRESHOLD,
    recordRegimeStart,
    recordRegimeEnd,
    getRegimeAge,
    getDurationDistribution,
    getMaturityScore,
    recommendAggressiveness,
    getCurrentRegime
};
