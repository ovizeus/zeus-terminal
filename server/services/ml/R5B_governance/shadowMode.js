'use strict';

/**
 * OMEGA R5B Governance — shadowMode (canonical §18)
 *
 * Canonical PDF §18 SHADOW MODE SI LANSARE CONTROLATA.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 990-1015.
 *
 * "Brain-ul nu trece direct din test în live."
 *
 * 6-stage deployment ladder (linear progression):
 *   1. offline_backtest    — historical backtest only
 *   2. walk_forward        — forward-walking backtest
 *   3. paper               — simulated trading on live data
 *   4. shadow_live         — runs alongside production, no real orders (4-week min)
 *   5. limited_probation   — small-size real orders (4-week min)
 *   6. normal_live         — full deployment
 *
 * 5 transition types logged in ml_shadow_stage_log:
 *   ENTER     — stage activation
 *   EXIT      — clean exit (advance or shutdown)
 *   DEGRADE   — auto-move down 1 stage due to performance breach
 *   PAUSE     — manual halt by operator
 *   ROLLBACK  — trigger versionRegistry.rollbackVersion (cross-module)
 *
 * Performance gating via evaluatePerformance: compares metrics against
 * DEFAULT_DEGRADE_THRESHOLDS (or custom override). Returns breaches[]
 * which caller routes to degrade() or pauseDeployment().
 *
 * Min duration enforced on shadow_live + limited_probation (4 weeks each
 * per spec "Durata minimă recomandată pentru shadow/live: 4–8 săptămâni").
 */

const { db } = require('../../database');

const STAGES = Object.freeze([
    'offline_backtest', 'walk_forward', 'paper',
    'shadow_live', 'limited_probation', 'normal_live'
]);

const TRANSITION_TYPES = Object.freeze([
    'ENTER', 'EXIT', 'DEGRADE', 'PAUSE', 'ROLLBACK'
]);

const DEFAULT_DEGRADE_THRESHOLDS = Object.freeze({
    hit_rate_min: 0.45,
    calibration_quality_min: 0.6,
    drift_max: 0.25
});

const MIN_DURATION_DAYS_PER_STAGE = Object.freeze({
    shadow_live: 28,
    limited_probation: 28
});

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`shadowMode: missing ${key}`);
    }
    return params[key];
}

function _validateStage(stage) {
    if (!STAGES.includes(stage)) {
        throw new Error(`shadowMode: invalid stage "${stage}" (must be one of ${STAGES.join(', ')})`);
    }
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insert: db.prepare(`
        INSERT INTO ml_shadow_stage_log
        (version_id, stage, transition_type, metrics_json, threshold_breach_json,
         reason, actor, started_at, ended_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getActiveEnter: db.prepare(`
        SELECT * FROM ml_shadow_stage_log
        WHERE version_id = ? AND stage = ?
          AND transition_type = 'ENTER' AND ended_at IS NULL
        ORDER BY started_at DESC LIMIT 1
    `),
    getCurrentByVersion: db.prepare(`
        SELECT * FROM ml_shadow_stage_log
        WHERE version_id = ? AND transition_type = 'ENTER' AND ended_at IS NULL
        ORDER BY started_at DESC LIMIT 1
    `),
    closeEnter: db.prepare(`
        UPDATE ml_shadow_stage_log SET ended_at = ? WHERE id = ?
    `),
    history: db.prepare(`
        SELECT * FROM ml_shadow_stage_log
        WHERE version_id = ?
        ORDER BY started_at ASC, id ASC
        LIMIT ?
    `)
};

// ── enterStage ─────────────────────────────────────────────────────
function enterStage(params) {
    const versionId = _required(params, 'versionId');
    const stage = _required(params, 'stage');
    const actor = _required(params, 'actor');
    const reason = _required(params, 'reason');
    _validateStage(stage);

    const existing = _stmts.getActiveEnter.get(versionId, stage);
    if (existing) {
        throw new Error(`enterStage: version ${versionId} already active in stage ${stage} (log #${existing.id})`);
    }
    const result = _stmts.insert.run(
        versionId, stage, 'ENTER', null, null, reason, actor, Date.now(), null
    );
    return { logId: result.lastInsertRowid };
}

// ── exitStage ──────────────────────────────────────────────────────
function exitStage(params) {
    const versionId = _required(params, 'versionId');
    const stage = _required(params, 'stage');
    const actor = _required(params, 'actor');
    const reason = _required(params, 'reason');
    _validateStage(stage);

    const active = _stmts.getActiveEnter.get(versionId, stage);
    if (!active) {
        throw new Error(`exitStage: no active ENTER for version ${versionId} stage ${stage} (not entered)`);
    }
    const now = Date.now();
    _stmts.closeEnter.run(now, active.id);
    const result = _stmts.insert.run(
        versionId, stage, 'EXIT', null, null, reason, actor, now, now
    );
    return { logId: result.lastInsertRowid };
}

// ── advanceStage ───────────────────────────────────────────────────
function advanceStage(params) {
    const versionId = _required(params, 'versionId');
    const actor = _required(params, 'actor');
    const reason = params.reason || 'advance to next stage';

    const current = _stmts.getCurrentByVersion.get(versionId);
    if (!current) {
        throw new Error(`advanceStage: no current stage for version ${versionId}`);
    }
    const currentIdx = STAGES.indexOf(current.stage);
    if (currentIdx === STAGES.length - 1) {
        throw new Error(`advanceStage: version ${versionId} at last stage (${current.stage}), cannot advance further`);
    }
    const nextStage = STAGES[currentIdx + 1];
    exitStage({ versionId, stage: current.stage, actor, reason: `auto-exit on advance to ${nextStage}` });
    const enter = enterStage({ versionId, stage: nextStage, actor, reason });
    return { logId: enter.logId, new_stage: nextStage, previous_stage: current.stage };
}

// ── degrade ────────────────────────────────────────────────────────
function degrade(params) {
    const versionId = _required(params, 'versionId');
    const reason = _required(params, 'reason');
    const actor = _required(params, 'actor');
    const metrics = params.metrics || {};

    const current = _stmts.getCurrentByVersion.get(versionId);
    if (!current) {
        throw new Error(`degrade: no current stage for version ${versionId}`);
    }
    const currentIdx = STAGES.indexOf(current.stage);
    if (currentIdx === 0) {
        throw new Error(`degrade: version ${versionId} already at first stage (${current.stage}), cannot degrade further (floor)`);
    }
    const targetStage = STAGES[currentIdx - 1];
    const now = Date.now();
    _stmts.closeEnter.run(now, current.id);
    const result = _stmts.insert.run(
        versionId, targetStage, 'DEGRADE',
        JSON.stringify(metrics), null,
        reason, actor, now, null
    );
    return { logId: result.lastInsertRowid, new_stage: targetStage, previous_stage: current.stage };
}

// ── pauseDeployment ────────────────────────────────────────────────
function pauseDeployment(params) {
    const versionId = _required(params, 'versionId');
    const reason = _required(params, 'reason');
    const actor = _required(params, 'actor');

    const current = _stmts.getCurrentByVersion.get(versionId);
    if (!current) {
        throw new Error(`pauseDeployment: no active stage for version ${versionId}`);
    }
    const now = Date.now();
    _stmts.closeEnter.run(now, current.id);
    const result = _stmts.insert.run(
        versionId, current.stage, 'PAUSE', null, null, reason, actor, now, now
    );
    return { logId: result.lastInsertRowid, paused_at_stage: current.stage };
}

// ── evaluatePerformance ────────────────────────────────────────────
function evaluatePerformance(params) {
    const metrics = _required(params, 'metrics');
    const thresholds = Object.assign({}, DEFAULT_DEGRADE_THRESHOLDS, params.thresholds || {});

    const breaches = [];
    if (typeof metrics.hit_rate === 'number' && metrics.hit_rate < thresholds.hit_rate_min) {
        breaches.push({
            metric: 'hit_rate',
            value: metrics.hit_rate,
            threshold: thresholds.hit_rate_min,
            type: 'below_min'
        });
    }
    if (typeof metrics.calibration_quality === 'number'
        && metrics.calibration_quality < thresholds.calibration_quality_min) {
        breaches.push({
            metric: 'calibration_quality',
            value: metrics.calibration_quality,
            threshold: thresholds.calibration_quality_min,
            type: 'below_min'
        });
    }
    if (typeof metrics.drift_score === 'number' && metrics.drift_score > thresholds.drift_max) {
        breaches.push({
            metric: 'drift_score',
            value: metrics.drift_score,
            threshold: thresholds.drift_max,
            type: 'above_max'
        });
    }
    return {
        passing: breaches.length === 0,
        breaches,
        evaluated_metrics: metrics
    };
}

// ── getCurrentStage ────────────────────────────────────────────────
function getCurrentStage(params) {
    const versionId = _required(params, 'versionId');
    return _stmts.getCurrentByVersion.get(versionId) || null;
}

// ── getStageHistory ────────────────────────────────────────────────
function getStageHistory(params) {
    const versionId = _required(params, 'versionId');
    const limit = Math.max(1, Math.min(500, params.limit || 100));
    return _stmts.history.all(versionId, limit);
}

// ── hasMinDuration ─────────────────────────────────────────────────
function hasMinDuration(params) {
    const versionId = _required(params, 'versionId');
    const stage = _required(params, 'stage');
    _validateStage(stage);

    const minDays = MIN_DURATION_DAYS_PER_STAGE[stage];
    if (!minDays) return true;  // no min duration requirement

    const enter = _stmts.getActiveEnter.get(versionId, stage);
    if (!enter) return false;   // not entered yet
    const elapsedDays = (Date.now() - enter.started_at) / (86400 * 1000);
    return elapsedDays >= minDays;
}

module.exports = {
    STAGES,
    TRANSITION_TYPES,
    DEFAULT_DEGRADE_THRESHOLDS,
    MIN_DURATION_DAYS_PER_STAGE,
    enterStage,
    exitStage,
    advanceStage,
    degrade,
    pauseDeployment,
    evaluatePerformance,
    getCurrentStage,
    getStageHistory,
    hasMinDuration
};
