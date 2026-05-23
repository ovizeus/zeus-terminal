'use strict';

/**
 * OMEGA R3A Safety — sizeRampLive (expert-obs OBS-2)
 *
 * OBS-2 SIZE-RAMP ALGORITHM PRIMELE N LIVE TRADE-URI.
 * Source: project_ml_v3_expert_observations_2026-05-05.md
 * Priority: P1.
 *
 * Variance brutală în primele N trade-uri post-deployment este risc real.
 * Reduce-then-ramp pattern:
 *   STAGE_1 → 25% normal size, advance after 5 wins
 *   STAGE_2 → 50% normal size, advance after 5 wins
 *   STAGE_3 → 75% normal size, advance after 5 wins
 *   STAGE_4 → 100% normal size, advance after 5 wins → COMPLETE
 *
 * Step-down: too many failures within stage → back to previous stage.
 *
 * Distinct from §246* graduated DD recovery (post-incident) — OBS-2 is
 * pre-production confidence ramp.
 */

const { db } = require('../../database');

const RAMP_STAGES = Object.freeze([
    'STAGE_1', 'STAGE_2', 'STAGE_3', 'STAGE_4', 'COMPLETE'
]);

const STAGE_MULTIPLIERS = Object.freeze({
    STAGE_1:  0.25,
    STAGE_2:  0.50,
    STAGE_3:  0.75,
    STAGE_4:  1.00,
    COMPLETE: 1.00
});

const DEFAULT_RAMP_PARAMS = Object.freeze({
    trades_per_stage:             5,
    failure_step_down_threshold:  3,   // 3 losses in stage → step down
    wins_for_stage_advance:       4   // 4+ wins out of 5 → advance
});

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`sizeRampLive: missing ${key}`);
    }
    return params[key];
}

function _nextStage(currentStage) {
    const idx = RAMP_STAGES.indexOf(currentStage);
    if (idx < 0 || idx >= RAMP_STAGES.length - 1) return currentStage;
    return RAMP_STAGES[idx + 1];
}

function _prevStage(currentStage) {
    const idx = RAMP_STAGES.indexOf(currentStage);
    if (idx <= 0) return 'STAGE_1';
    return RAMP_STAGES[idx - 1];
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    getState: db.prepare(`
        SELECT * FROM ml_size_ramp_state
        WHERE user_id = ? AND resolved_env = ?
    `),
    insertState: db.prepare(`
        INSERT INTO ml_size_ramp_state
        (user_id, resolved_env, stage, trades_completed, wins_count, losses_count,
         current_multiplier, planned_trades, started_at, updated_at)
        VALUES (?, ?, 'STAGE_1', 0, 0, 0, ?, ?, ?, ?)
    `),
    updateState: db.prepare(`
        UPDATE ml_size_ramp_state
        SET stage = ?, trades_completed = ?, wins_count = ?, losses_count = ?,
            current_multiplier = ?, completed_at = ?, updated_at = ?
        WHERE id = ?
    `),
    deleteState: db.prepare(`
        DELETE FROM ml_size_ramp_state
        WHERE user_id = ? AND resolved_env = ?
    `)
};

// ── initializeRamp ─────────────────────────────────────────────────
function initializeRamp(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const plannedTrades = _required(params, 'plannedTrades');
    const startMultiplier = (params && typeof params.startMultiplier === 'number')
        ? params.startMultiplier : STAGE_MULTIPLIERS.STAGE_1;

    const now = Date.now();
    _stmts.insertState.run(
        userId, env, startMultiplier, plannedTrades, now, now
    );

    return {
        initialized: true,
        stage: 'STAGE_1',
        multiplier: startMultiplier
    };
}

// ── getRampSize ────────────────────────────────────────────────────
function getRampSize(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const row = _stmts.getState.get(userId, env);
    if (!row) {
        return {
            exists: false,
            stage: 'COMPLETE',
            multiplier: 1.0
        };
    }
    return {
        exists: true,
        stage: row.stage,
        multiplier: row.current_multiplier,
        tradesCompleted: row.trades_completed,
        winsCount: row.wins_count,
        lossesCount: row.losses_count,
        plannedTrades: row.planned_trades
    };
}

// ── recordRampOutcome ──────────────────────────────────────────────
function recordRampOutcome(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const outcome = _required(params, 'outcome');
    const rampParams = (params && params.rampParams) ? params.rampParams : DEFAULT_RAMP_PARAMS;

    const state = _stmts.getState.get(userId, env);
    if (!state) return { recorded: false, reason: 'no_ramp_active' };

    const tradesCompleted = state.trades_completed + 1;
    const wins = state.wins_count + (outcome.won ? 1 : 0);
    const losses = state.losses_count + (outcome.won ? 0 : 1);

    let stage = state.stage;
    let multiplier = state.current_multiplier;

    // Check stage advance: trades_completed multiple of trades_per_stage AND wins >= threshold
    const tradesInStage = tradesCompleted - (RAMP_STAGES.indexOf(state.stage) * rampParams.trades_per_stage);
    if (tradesInStage >= rampParams.trades_per_stage) {
        const winsInStage = wins - (RAMP_STAGES.indexOf(state.stage) * rampParams.wins_for_stage_advance);
        if (winsInStage >= rampParams.wins_for_stage_advance) {
            stage = _nextStage(state.stage);
            multiplier = STAGE_MULTIPLIERS[stage];
        }
    }

    // Check step down: failure threshold within stage
    const lossesInStage = losses - (RAMP_STAGES.indexOf(state.stage) * 1);
    if (lossesInStage >= rampParams.failure_step_down_threshold && stage === state.stage) {
        stage = _prevStage(state.stage);
        multiplier = STAGE_MULTIPLIERS[stage];
    }

    const completedAt = stage === 'COMPLETE' ? Date.now() : null;

    _stmts.updateState.run(
        stage, tradesCompleted, wins, losses,
        multiplier, completedAt, Date.now(),
        state.id
    );

    return {
        recorded: true,
        stage,
        multiplier,
        tradesCompleted
    };
}

// ── isRampComplete ─────────────────────────────────────────────────
function isRampComplete(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const row = _stmts.getState.get(userId, env);
    if (!row) {
        return { exists: false, complete: false };
    }
    return {
        exists: true,
        complete: row.stage === 'COMPLETE',
        stage: row.stage,
        completedAt: row.completed_at
    };
}

// ── resetRamp ──────────────────────────────────────────────────────
function resetRamp(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const reason = _required(params, 'reason');
    const actor = _required(params, 'actor');
    void reason; void actor;

    const existing = _stmts.getState.get(userId, env);
    if (!existing) return { reset: false, reason: 'no_ramp_to_reset' };

    const now = Date.now();
    _stmts.updateState.run(
        'STAGE_1', 0, 0, 0, STAGE_MULTIPLIERS.STAGE_1,
        null, now, existing.id
    );

    return { reset: true, stage: 'STAGE_1' };
}

module.exports = {
    RAMP_STAGES,
    STAGE_MULTIPLIERS,
    DEFAULT_RAMP_PARAMS,
    initializeRamp,
    getRampSize,
    recordRampOutcome,
    isRampComplete,
    resetRamp
};
