'use strict';

/**
 * OMEGA R5B Governance — autoResumeDD (§255* Claude-extras)
 *
 * §255* AUTO-RESUME FROM MEDIUM DD — closes R5B auto-actions quartet.
 * Source: project_ml_brain_pro_244.md "255* (R3A + R5) — auto-resume
 * 10-15% DD pauses după 24h cooldown + 3 shadow wins + DD<8% +
 * regime stable. DD≥15% rămâne manual."
 *
 * Claude-extras approved 2026-04-29, NOT in canonical PDF.
 *
 * 4 cumulative conditions for auto-resume (ALL must hold):
 *   1. cooldown_elapsed: now >= resume_eligible_after (24h after pause)
 *   2. sufficient_wins: shadow_wins_count >= 3
 *   3. dd_recovered: current_dd_pct < 8%
 *   4. regime_stable: regime drift level === 'STABLE'
 *
 * Hard invariant: pause with dd_at_pause >= 15% → manual-only;
 * evaluateResumeEligibility always returns eligible=false regardless of
 * conditions for such pauses. Operator must explicit resume severe DD.
 *
 * Composition:
 *   - Migration 047 (ml_dd_pauses) — pause lifecycle table (NEW)
 *   - Caller provides currentDdPct + regimeDriftLevel (no implicit data fetch)
 */

const { db } = require('../../database');

const THRESHOLDS = Object.freeze({
    medium_dd_min: 10,      // % — auto-eligible range start
    medium_dd_max: 15,      // % — manual-only threshold (> = manual)
    cooldown_hours: 24,
    min_shadow_wins: 3,
    max_current_dd: 8       // % — must recover below this
});

const PAUSE_STATES = Object.freeze(['ACTIVE', 'RESUMED', 'EXPIRED']);
const RESUME_MODES = Object.freeze(['AUTO', 'MANUAL']);
const VALID_ENVS = ['DEMO', 'TESTNET', 'REAL'];

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`autoResumeDD: missing ${key}`);
    }
    return params[key];
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertPause: db.prepare(`
        INSERT INTO ml_dd_pauses
        (user_id, resolved_env, pause_reason, dd_at_pause, state,
         resume_eligible_after, shadow_wins_count, auto_resumed,
         paused_at, paused_by)
        VALUES (?, ?, ?, ?, 'ACTIVE', ?, 0, 0, ?, ?)
    `),
    getActivePause: db.prepare(`
        SELECT * FROM ml_dd_pauses
        WHERE user_id = ? AND resolved_env = ? AND state = 'ACTIVE'
        ORDER BY paused_at DESC LIMIT 1
    `),
    getById: db.prepare(`SELECT * FROM ml_dd_pauses WHERE id = ?`),
    incrementShadowWin: db.prepare(`
        UPDATE ml_dd_pauses
        SET shadow_wins_count = shadow_wins_count + 1
        WHERE id = ? AND state = 'ACTIVE'
    `),
    resumePause: db.prepare(`
        UPDATE ml_dd_pauses
        SET state = 'RESUMED', auto_resumed = ?, resumed_at = ?,
            resumed_by = ?, resume_reason = ?
        WHERE id = ? AND state = 'ACTIVE'
    `),
    listActiveForUser: db.prepare(`
        SELECT * FROM ml_dd_pauses
        WHERE user_id = ? AND resolved_env = ? AND state = 'ACTIVE'
        ORDER BY paused_at ASC
    `)
};

// ── pauseFromDD ────────────────────────────────────────────────────
function pauseFromDD(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const ddPct = _required(params, 'ddPct');
    const reason = _required(params, 'reason');
    const actor = _required(params, 'actor');

    if (!VALID_ENVS.includes(env)) {
        throw new Error(`pauseFromDD: invalid resolvedEnv "${env}"`);
    }

    const existing = _stmts.getActivePause.get(userId, env);
    if (existing) {
        throw new Error(`pauseFromDD: user ${userId}/${env} already has active pause #${existing.id}`);
    }

    const now = Date.now();
    const eligibleAfter = now + THRESHOLDS.cooldown_hours * 3600 * 1000;
    const result = _stmts.insertPause.run(
        userId, env, reason, ddPct, eligibleAfter, now, actor
    );
    return { pauseId: result.lastInsertRowid, eligibleAfter };
}

// ── recordShadowWin ────────────────────────────────────────────────
function recordShadowWin(params) {
    const pauseId = _required(params, 'pauseId');
    const row = _stmts.getById.get(pauseId);
    if (!row) throw new Error(`recordShadowWin: pause ${pauseId} not found`);
    if (row.state !== 'ACTIVE') {
        throw new Error(`recordShadowWin: pause ${pauseId} state is ${row.state}, must be ACTIVE`);
    }
    _stmts.incrementShadowWin.run(pauseId);
    return _stmts.getById.get(pauseId);
}

// ── evaluateResumeEligibility ──────────────────────────────────────
function evaluateResumeEligibility(params) {
    const pauseId = _required(params, 'pauseId');
    const currentDdPct = _required(params, 'currentDdPct');
    const regimeDriftLevel = _required(params, 'regimeDriftLevel');

    const row = _stmts.getById.get(pauseId);
    if (!row) throw new Error(`evaluateResumeEligibility: pause ${pauseId} not found`);

    // Manual-only invariant
    if (row.dd_at_pause >= THRESHOLDS.medium_dd_max) {
        return {
            pauseId,
            eligible: false,
            conditions: {
                cooldown_elapsed: false,
                sufficient_wins: false,
                dd_recovered: false,
                regime_stable: false
            },
            reason: `severe DD pause (dd_at_pause=${row.dd_at_pause}% >= ${THRESHOLDS.medium_dd_max}%) — manual-only, no auto-resume`
        };
    }

    const now = Date.now();
    const conditions = {
        cooldown_elapsed: now >= row.resume_eligible_after,
        sufficient_wins: row.shadow_wins_count >= THRESHOLDS.min_shadow_wins,
        dd_recovered: typeof currentDdPct === 'number' && currentDdPct < THRESHOLDS.max_current_dd,
        regime_stable: regimeDriftLevel === 'STABLE'
    };
    const eligible = conditions.cooldown_elapsed
                   && conditions.sufficient_wins
                   && conditions.dd_recovered
                   && conditions.regime_stable;

    const reasons = [];
    if (!conditions.cooldown_elapsed) {
        const remaining = Math.max(0, row.resume_eligible_after - now);
        reasons.push(`cooldown ${(remaining / 3600000).toFixed(1)}h remaining`);
    }
    if (!conditions.sufficient_wins) {
        reasons.push(`only ${row.shadow_wins_count}/${THRESHOLDS.min_shadow_wins} shadow wins`);
    }
    if (!conditions.dd_recovered) {
        reasons.push(`current DD ${currentDdPct}% >= ${THRESHOLDS.max_current_dd}%`);
    }
    if (!conditions.regime_stable) {
        reasons.push(`regime drift ${regimeDriftLevel}, need STABLE`);
    }

    return {
        pauseId,
        eligible,
        conditions,
        reason: eligible ? 'all conditions met' : reasons.join('; ')
    };
}

// ── resumeFromPause ────────────────────────────────────────────────
function resumeFromPause(params) {
    const pauseId = _required(params, 'pauseId');
    const mode = _required(params, 'mode');
    const actor = _required(params, 'actor');
    const reason = params.reason || (mode === 'AUTO' ? '§255* auto-resume' : 'manual resume');

    if (!RESUME_MODES.includes(mode)) {
        throw new Error(`resumeFromPause: invalid mode "${mode}" (must be ${RESUME_MODES.join('|')})`);
    }
    const row = _stmts.getById.get(pauseId);
    if (!row) throw new Error(`resumeFromPause: pause ${pauseId} not found`);
    if (row.state !== 'ACTIVE') {
        throw new Error(`resumeFromPause: pause ${pauseId} state is ${row.state}, must be ACTIVE`);
    }
    _stmts.resumePause.run(
        mode === 'AUTO' ? 1 : 0,
        Date.now(),
        actor,
        reason,
        pauseId
    );
    return _stmts.getById.get(pauseId);
}

// ── getActivePause ─────────────────────────────────────────────────
function getActivePause(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    return _stmts.getActivePause.get(userId, env) || null;
}

// ── scanAllPauses ──────────────────────────────────────────────────
function scanAllPauses(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const getCurrentDdFn = params.getCurrentDdFn || (() => null);
    const getDriftLevelFn = params.getDriftLevelFn || (() => 'STABLE');

    const result = { evaluated: 0, auto_resumed: [], skipped: 0, errors: [] };
    const pauses = _stmts.listActiveForUser.all(userId, env);

    for (const p of pauses) {
        try {
            result.evaluated++;
            const currentDd = getCurrentDdFn(p);
            const driftLevel = getDriftLevelFn(p);
            const evaluation = evaluateResumeEligibility({
                pauseId: p.id,
                currentDdPct: currentDd === null ? 999 : currentDd,
                regimeDriftLevel: driftLevel
            });
            if (!evaluation.eligible) {
                result.skipped++;
                continue;
            }
            resumeFromPause({
                pauseId: p.id,
                mode: 'AUTO',
                actor: '§255*_auto_resume',
                reason: `auto-resume: ${evaluation.reason}`
            });
            result.auto_resumed.push({ pauseId: p.id, evaluation });
        } catch (err) {
            result.errors.push({
                pauseId: p.id,
                error: String(err && err.message || err)
            });
        }
    }

    return result;
}

module.exports = {
    THRESHOLDS,
    PAUSE_STATES,
    RESUME_MODES,
    pauseFromDD,
    recordShadowWin,
    evaluateResumeEligibility,
    resumeFromPause,
    getActivePause,
    scanAllPauses
};
