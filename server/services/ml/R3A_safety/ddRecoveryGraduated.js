'use strict';

/**
 * OMEGA R3A Safety — ddRecoveryGraduated (§246* Claude-extras)
 *
 * §246* GRADUATED DD RECOVERY = partial size on partial recovery.
 * Source: project_ml_brain_pro_244.md "246* GRADUATED DD RECOVERY".
 * Claude-extras approved 2026-04-29, NOT in canonical PDF.
 *
 * Pairs with §255* (autoResumeDD) — operates on ml_dd_pauses rows
 * AFTER state has transitioned to RESUMED. Implements a 4-stage size
 * ladder so a freshly-resumed user doesn't immediately go to full size:
 *
 *   Stage 1 (0-24h post-recovery start):    25% size, no min wins
 *   Stage 2 (24-72h):                       50% size, requires 2 wins at S1
 *   Stage 3 (72-168h):                      75% size, requires 3 wins at S2
 *   Stage 4 (168h+):                        100% size, requires 5 wins at S3
 *
 * Step-DOWN: if currentDdPct > step-down threshold during recovery,
 * retrograde to stage 1 (wins counter reset). Cannot step down lower
 * than stage 1.
 *
 * Schema: ALTER ADD COLUMN x3 on ml_dd_pauses (Migration 049).
 */

const { db } = require('../../database');

const RECOVERY_LADDER = Object.freeze([
    { stage: 1, max_hours: 24,        size_pct: 25,  min_wins_at_stage: 0 },
    { stage: 2, max_hours: 72,        size_pct: 50,  min_wins_at_stage: 2 },
    { stage: 3, max_hours: 168,       size_pct: 75,  min_wins_at_stage: 3 },
    { stage: 4, max_hours: Infinity,  size_pct: 100, min_wins_at_stage: 5 }
]);

const STEP_DOWN_DD_THRESHOLD = 5;  // % DD that triggers step-down to stage 1

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`ddRecoveryGraduated: missing ${key}`);
    }
    return params[key];
}

function _stageInfo(stage) {
    return RECOVERY_LADDER.find(s => s.stage === stage) || null;
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    getById: db.prepare(`SELECT * FROM ml_dd_pauses WHERE id = ?`),
    startRecovery: db.prepare(`
        UPDATE ml_dd_pauses
        SET recovery_stage = 1, recovery_wins_at_stage = 0, recovery_started_at = ?
        WHERE id = ?
    `),
    incrementWin: db.prepare(`
        UPDATE ml_dd_pauses
        SET recovery_wins_at_stage = recovery_wins_at_stage + 1
        WHERE id = ?
    `),
    advanceStage: db.prepare(`
        UPDATE ml_dd_pauses
        SET recovery_stage = ?, recovery_wins_at_stage = 0
        WHERE id = ?
    `),
    stepDown: db.prepare(`
        UPDATE ml_dd_pauses
        SET recovery_stage = 1, recovery_wins_at_stage = 0
        WHERE id = ?
    `)
};

// ── startRecovery ──────────────────────────────────────────────────
function startRecovery(params) {
    const pauseId = _required(params, 'pauseId');
    const row = _stmts.getById.get(pauseId);
    if (!row) throw new Error(`startRecovery: pause ${pauseId} not found`);
    if (row.state !== 'RESUMED') {
        throw new Error(`startRecovery: pause ${pauseId} state is ${row.state}, must be RESUMED`);
    }
    if (row.recovery_stage > 0) {
        throw new Error(`startRecovery: pause ${pauseId} already started recovery at stage ${row.recovery_stage}`);
    }
    _stmts.startRecovery.run(Date.now(), pauseId);
    return getRecoveryStage({ pauseId });
}

// ── getRecoveryStage ───────────────────────────────────────────────
function getRecoveryStage(params) {
    const pauseId = _required(params, 'pauseId');
    const row = _stmts.getById.get(pauseId);
    if (!row) throw new Error(`getRecoveryStage: pause ${pauseId} not found`);

    const stage = row.recovery_stage || 0;
    if (stage === 0) {
        // No recovery active — return full-size convention
        return {
            pauseId,
            stage: 0,
            size_pct: 100,
            wins_at_stage: 0,
            hours_in_stage: 0,
            ready_to_advance: false
        };
    }

    const info = _stageInfo(stage);
    if (!info) {
        throw new Error(`getRecoveryStage: unknown stage ${stage}`);
    }
    const hoursInStage = row.recovery_started_at
        ? (Date.now() - row.recovery_started_at) / (3600 * 1000)
        : 0;
    const wins = row.recovery_wins_at_stage || 0;
    const ready = (stage < 4)
        && (hoursInStage >= info.max_hours)
        && (wins >= info.min_wins_at_stage);

    return {
        pauseId,
        stage,
        size_pct: info.size_pct,
        wins_at_stage: wins,
        hours_in_stage: hoursInStage,
        ready_to_advance: ready
    };
}

// ── getRecoverySize ────────────────────────────────────────────────
function getRecoverySize(params) {
    const pauseId = _required(params, 'pauseId');
    const targetSize = _required(params, 'targetSize');
    const info = getRecoveryStage({ pauseId });
    return targetSize * (info.size_pct / 100);
}

// ── recordPostResumeOutcome ────────────────────────────────────────
function recordPostResumeOutcome(params) {
    const pauseId = _required(params, 'pauseId');
    const won = !!params.won;
    const row = _stmts.getById.get(pauseId);
    if (!row) throw new Error(`recordPostResumeOutcome: pause ${pauseId} not found`);
    if (!row.recovery_stage || row.recovery_stage === 0) {
        throw new Error(`recordPostResumeOutcome: pause ${pauseId} recovery not active (stage=0)`);
    }
    if (won) {
        _stmts.incrementWin.run(pauseId);
    }
    return getRecoveryStage({ pauseId });
}

// ── maybeAdvanceStage ──────────────────────────────────────────────
// To advance from stage N → N+1 requires:
//   1. hours_in_current_stage >= current stage's max_hours
//   2. wins_at_stage >= next stage's min_wins_at_stage (prerequisite to enter)
function maybeAdvanceStage(params) {
    const pauseId = _required(params, 'pauseId');
    const row = _stmts.getById.get(pauseId);
    if (!row) throw new Error(`maybeAdvanceStage: pause ${pauseId} not found`);

    const currentStage = row.recovery_stage || 0;
    if (currentStage === 0) {
        return { advanced: false, reason: 'recovery not started (stage=0)' };
    }
    if (currentStage >= 4) {
        return { advanced: false, reason: 'already at max stage 4' };
    }

    const currentInfo = _stageInfo(currentStage);
    const nextInfo = _stageInfo(currentStage + 1);
    const hoursInStage = (Date.now() - (row.recovery_started_at || Date.now())) / (3600 * 1000);
    const wins = row.recovery_wins_at_stage || 0;

    // Check NEXT stage's prerequisite wins
    if (wins < nextInfo.min_wins_at_stage) {
        return {
            advanced: false,
            reason: `wins ${wins} < required ${nextInfo.min_wins_at_stage} to advance to stage ${currentStage + 1}`
        };
    }
    if (hoursInStage < currentInfo.max_hours) {
        return {
            advanced: false,
            reason: `hours ${hoursInStage.toFixed(1)} < required ${currentInfo.max_hours} at stage ${currentStage}`
        };
    }

    const newStage = currentStage + 1;
    _stmts.advanceStage.run(newStage, pauseId);
    return { advanced: true, new_stage: newStage, previous_stage: currentStage };
}

// ── stepDownOnDD ───────────────────────────────────────────────────
function stepDownOnDD(params) {
    const pauseId = _required(params, 'pauseId');
    const currentDdPct = _required(params, 'currentDdPct');
    const row = _stmts.getById.get(pauseId);
    if (!row) throw new Error(`stepDownOnDD: pause ${pauseId} not found`);

    const currentStage = row.recovery_stage || 0;
    if (currentStage <= 1) {
        return { stepped_down: false, reason: 'already at stage 1 or recovery not active' };
    }
    if (currentDdPct < STEP_DOWN_DD_THRESHOLD) {
        return { stepped_down: false, reason: `current DD ${currentDdPct}% within threshold ${STEP_DOWN_DD_THRESHOLD}%` };
    }
    _stmts.stepDown.run(pauseId);
    return {
        stepped_down: true,
        new_stage: 1,
        previous_stage: currentStage,
        current_dd_pct: currentDdPct
    };
}

// ── isInRecovery ───────────────────────────────────────────────────
function isInRecovery(params) {
    const pauseId = _required(params, 'pauseId');
    const row = _stmts.getById.get(pauseId);
    if (!row) return false;
    const stage = row.recovery_stage || 0;
    // Stage 1-3 = active recovery, Stage 4 = recovery complete (full size)
    return stage > 0 && stage < 4;
}

module.exports = {
    RECOVERY_LADDER,
    STEP_DOWN_DD_THRESHOLD,
    startRecovery,
    getRecoveryStage,
    getRecoverySize,
    recordPostResumeOutcome,
    maybeAdvanceStage,
    stepDownOnDD,
    isInRecovery
};
