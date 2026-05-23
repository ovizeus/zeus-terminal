'use strict';

/**
 * OMEGA R5B Governance — autoQuarantine (§254* Claude-extras)
 *
 * §254* AUTO-QUARANTINE FAILED FEATURES — anti-feature-rot mechanism.
 * Source: project_ml_brain_pro_244.md "254* (R5 + R3B) — set weight=0
 * immediate când feature contribuie negativ peste 100+ trades + Brier
 * worse than null + p<0.01 + bad în ≥2 regime."
 *
 * Claude-extras approved 2026-04-29, NOT in canonical PDF.
 *
 * 4 cumulative conditions for auto-quarantine (ALL must hold):
 *   1. sample_count >= 100
 *   2. Brier score worse than null model (always predict base rate)
 *   3. p_value < 0.01 (z-test on win rate vs 50%)
 *   4. bad performance in >= 2 distinct regimes
 *
 * Composition (no new migration):
 *   - ml_attribution_events (Migration 044) — per-feature outcome data
 *   - ml_feature_global_overrides (Migration 036) — QUARANTINED override state
 *   - ml_feature_audit_log (Migration 033) — audit trail
 *
 * Feature identity: stored as decision_digest field in ml_attribution_events.
 * Caller passes `featureMarker` which matches that field for query slicing.
 */

const { db } = require('../../database');

const THRESHOLDS = Object.freeze({
    min_trades: 100,
    p_threshold: 0.01,
    min_bad_regimes: 2
});

const RECOMMENDATIONS = Object.freeze(['QUARANTINE', 'KEEP', 'INSUFFICIENT_DATA']);

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`autoQuarantine: missing ${key}`);
    }
    return params[key];
}

// One-sample z-test on win rate vs nullRate=0.5
// Returns approximate two-sided p-value.
function _zTestWinRateVsNull(wins, total, nullRate = 0.5) {
    if (total < 1) return 1;
    const observed = wins / total;
    const stdErr = Math.sqrt(nullRate * (1 - nullRate) / total);
    if (stdErr === 0) return 1;
    const z = (observed - nullRate) / stdErr;
    // Two-sided p-value via error function approximation
    return 2 * (1 - _normalCDF(Math.abs(z)));
}

function _normalCDF(x) {
    // Abramowitz & Stegun 7.1.26
    const a1 =  0.254829592, a2 = -0.284496736, a3 =  1.421413741;
    const a4 = -1.453152027, a5 =  1.061405429, p  =  0.3275911;
    const sign = x < 0 ? -1 : 1;
    const ax = Math.abs(x) / Math.sqrt(2);
    const t = 1 / (1 + p * ax);
    const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
    return 0.5 * (1 + sign * y);
}

// Brier score for binary outcomes; predictions[] = [{score in [0,1], actual_win in 0|1}]
function _brierScore(predictions) {
    if (!Array.isArray(predictions) || predictions.length === 0) return 0;
    let sum = 0;
    for (const p of predictions) {
        const diff = p.score - p.actual_win;
        sum += diff * diff;
    }
    return sum / predictions.length;
}

// Null model = always predict base rate (mean outcome).
function _nullModelBrier(predictions) {
    if (!Array.isArray(predictions) || predictions.length === 0) return 0;
    const baseRate = predictions.reduce((s, p) => s + p.actual_win, 0) / predictions.length;
    let sum = 0;
    for (const p of predictions) {
        const diff = baseRate - p.actual_win;
        sum += diff * diff;
    }
    return sum / predictions.length;
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    fetchAttributions: db.prepare(`
        SELECT outcome_class, pnl_pct, score_at_entry, regime
        FROM ml_attribution_events
        WHERE user_id = ? AND resolved_env = ? AND decision_digest = ?
          AND attributed_at >= ?
          AND outcome_class IN ('WIN', 'LOSS')
          AND score_at_entry IS NOT NULL
    `),
    listDistinctFeatures: db.prepare(`
        SELECT decision_digest AS featureMarker, COUNT(*) AS n
        FROM ml_attribution_events
        WHERE user_id = ? AND resolved_env = ? AND attributed_at >= ?
          AND outcome_class IN ('WIN', 'LOSS')
        GROUP BY decision_digest
        HAVING COUNT(*) >= ?
    `),
    insertOverride: db.prepare(`
        INSERT INTO ml_feature_global_overrides
        (scope, scope_key, feature_id, override_status, reason, created_by, created_at)
        VALUES (?, ?, ?, 'QUARANTINED', ?, ?, ?)
    `),
    getOverride: db.prepare(`
        SELECT * FROM ml_feature_global_overrides
        WHERE feature_id = ? AND override_status = 'QUARANTINED'
        LIMIT 1
    `),
    getOverrideById: db.prepare(`
        SELECT * FROM ml_feature_global_overrides WHERE id = ?
    `),
    deleteOverride: db.prepare(`
        DELETE FROM ml_feature_global_overrides WHERE id = ?
    `),
    insertAuditLog: db.prepare(`
        INSERT INTO ml_feature_audit_log
        (user_id, resolved_env, symbol, feature_id, event_type,
         old_value_json, new_value_json, actor, reason, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
};

// ── evaluateFeature ────────────────────────────────────────────────
function evaluateFeature(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const featureMarker = _required(params, 'featureMarker');
    const sinceMs = params.sinceMs || 0;

    const rows = _stmts.fetchAttributions.all(userId, env, featureMarker, sinceMs);
    const sampleCount = rows.length;

    if (sampleCount < THRESHOLDS.min_trades) {
        return {
            featureMarker,
            sample_count: sampleCount,
            win_rate: 0,
            brier_score: 0,
            null_model_brier: 0,
            p_value: 1,
            bad_regime_count: 0,
            conditions: {
                sufficient_samples: false,
                brier_worse: false,
                p_significant: false,
                multi_regime_bad: false
            },
            eligible_for_quarantine: false,
            recommendation: 'INSUFFICIENT_DATA'
        };
    }

    // Build prediction tuples + regime breakdown
    const predictions = rows.map(r => ({
        score: Number(r.score_at_entry),
        actual_win: r.outcome_class === 'WIN' ? 1 : 0
    }));
    const wins = predictions.reduce((s, p) => s + p.actual_win, 0);
    const winRate = wins / sampleCount;
    const brier = _brierScore(predictions);
    const nullBrier = _nullModelBrier(predictions);
    const pValue = _zTestWinRateVsNull(wins, sampleCount, 0.5);

    // Bad regimes: regimes where win_rate < 0.5 (worse than coin flip)
    const regimeStats = new Map();
    for (const r of rows) {
        const regime = r.regime || '_unknown';
        if (!regimeStats.has(regime)) regimeStats.set(regime, { wins: 0, total: 0 });
        const s = regimeStats.get(regime);
        s.total++;
        if (r.outcome_class === 'WIN') s.wins++;
    }
    let badRegimeCount = 0;
    for (const [, s] of regimeStats) {
        if (s.total >= 10 && (s.wins / s.total) < 0.5) badRegimeCount++;
    }

    const conditions = {
        sufficient_samples: sampleCount >= THRESHOLDS.min_trades,
        brier_worse: brier > nullBrier,
        p_significant: pValue < THRESHOLDS.p_threshold,
        multi_regime_bad: badRegimeCount >= THRESHOLDS.min_bad_regimes
    };
    const eligible = conditions.sufficient_samples
                   && conditions.brier_worse
                   && conditions.p_significant
                   && conditions.multi_regime_bad;

    return {
        featureMarker,
        sample_count: sampleCount,
        win_rate: winRate,
        brier_score: brier,
        null_model_brier: nullBrier,
        p_value: pValue,
        bad_regime_count: badRegimeCount,
        conditions,
        eligible_for_quarantine: eligible,
        recommendation: eligible ? 'QUARANTINE' : 'KEEP'
    };
}

// ── quarantineFeature ──────────────────────────────────────────────
function quarantineFeature(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const symbol = _required(params, 'symbol');
    const featureId = _required(params, 'featureId');
    const scope = params.scope || 'GLOBAL';
    const reason = _required(params, 'reason');
    const actor = _required(params, 'actor');

    const existing = _stmts.getOverride.get(featureId);
    if (existing) {
        throw new Error(`quarantineFeature: feature ${featureId} already quarantined (override #${existing.id})`);
    }

    const now = Date.now();
    let overrideId;
    try {
        const result = _stmts.insertOverride.run(
            scope, scope === 'GLOBAL' ? '*' : symbol, featureId, reason, actor, now
        );
        overrideId = result.lastInsertRowid;
    } catch (err) {
        const msg = String(err && err.message || err);
        if (/UNIQUE/i.test(msg)) {
            throw new Error(`quarantineFeature: feature ${featureId} already quarantined (UNIQUE constraint)`);
        }
        throw err;
    }

    const auditResult = _stmts.insertAuditLog.run(
        userId, env, symbol, featureId, 'QUARANTINED',
        null,
        JSON.stringify({ override_id: overrideId, scope, status: 'QUARANTINED' }),
        actor, reason, now
    );
    return { override_id: overrideId, audit_log_id: auditResult.lastInsertRowid };
}

// ── unquarantineFeature ────────────────────────────────────────────
function unquarantineFeature(params) {
    const overrideId = _required(params, 'overrideId');
    const actor = _required(params, 'actor');
    const reason = params.reason || 'manual unquarantine';

    const row = _stmts.getOverrideById.get(overrideId);
    if (!row) throw new Error(`unquarantineFeature: override ${overrideId} not found`);

    _stmts.deleteOverride.run(overrideId);
    const auditResult = _stmts.insertAuditLog.run(
        0, 'DEMO', '*', row.feature_id, 'UNQUARANTINED',
        JSON.stringify({ override_id: overrideId, status: 'QUARANTINED' }),
        null,
        actor, reason, Date.now()
    );
    return { removed_override_id: overrideId, audit_log_id: auditResult.lastInsertRowid };
}

// ── getQuarantineStatus ────────────────────────────────────────────
function getQuarantineStatus(params) {
    const featureId = _required(params, 'featureId');
    return _stmts.getOverride.get(featureId) || null;
}

// ── scanAllFeatures ────────────────────────────────────────────────
function scanAllFeatures(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const sinceMs = params.sinceMs || 0;
    const result = { evaluated: 0, quarantined: [], skipped: 0, errors: [] };

    const candidates = _stmts.listDistinctFeatures.all(
        userId, env, sinceMs, THRESHOLDS.min_trades
    );

    for (const c of candidates) {
        try {
            result.evaluated++;
            const evaluation = evaluateFeature({
                userId, resolvedEnv: env, featureMarker: c.featureMarker, sinceMs
            });
            if (!evaluation.eligible_for_quarantine) {
                result.skipped++;
                continue;
            }
            // Check not already quarantined
            const existing = _stmts.getOverride.get(c.featureMarker);
            if (existing) {
                result.skipped++;
                continue;
            }
            quarantineFeature({
                userId, resolvedEnv: env, symbol: '*',
                featureId: c.featureMarker, scope: 'GLOBAL',
                reason: `§254* auto-quarantine: ${evaluation.sample_count} trades, win_rate=${evaluation.win_rate.toFixed(3)}, p=${evaluation.p_value.toFixed(4)}, bad regimes=${evaluation.bad_regime_count}`,
                actor: '§254*_auto'
            });
            result.quarantined.push({
                featureId: c.featureMarker,
                evaluation
            });
        } catch (err) {
            result.errors.push({
                featureMarker: c.featureMarker,
                error: String(err && err.message || err)
            });
        }
    }

    return result;
}

module.exports = {
    THRESHOLDS,
    RECOMMENDATIONS,
    evaluateFeature,
    quarantineFeature,
    unquarantineFeature,
    getQuarantineStatus,
    scanAllFeatures
};
