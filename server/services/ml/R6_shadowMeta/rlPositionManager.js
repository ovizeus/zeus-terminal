'use strict';

/**
 * OMEGA R6 Shadow Meta — rlPositionManager (canonical §26)
 *
 * §26 ML AVANSAT SI RL PENTRU MANAGEMENT.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1174-1188.
 *
 * Principle (line 1174):
 *   "Reinforcement Learning poate fi folosit pentru managementul pozitiei,
 *    dar numai in cusca de risc."
 *
 * 5 CAPABILITIES (lines 1177-1181):
 *   take_partial, activate_trailing, force_exit, leave_runner,
 *   aggressive_reduce
 *
 * 5 INVARIANTS (lines 1184-1188):
 *   1. no_max_risk_breach    — nu depaseste max risk
 *   2. no_veto_override      — nu bate veto-urile
 *   3. no_size_cap_breach    — nu mareste size peste caps
 *   4. no_degraded_data      — nu actioneaza pe date degradate
 *   5. requires_validation   — trebuie validat simulator→backtest→shadow
 *                              →probation→live
 *
 * "Cusca de risc" = composition with §30 maxRisk, §14 veto, §13 freshness.
 * Wrap-not-rewrite per Plan v3: this is the RL policy + audit shell.
 * Concrete neural policy comes in later waves.
 */

const { db } = require('../../database');

const RL_ACTION_TYPES = Object.freeze([
    'take_partial',
    'activate_trailing',
    'force_exit',
    'leave_runner',
    'aggressive_reduce'
]);

const VALIDATION_STAGES = Object.freeze([
    'simulator', 'backtest', 'shadow', 'probation', 'live'
]);

const RISK_CAGE_RULES = Object.freeze([
    'no_max_risk_breach',
    'no_veto_override',
    'no_size_cap_breach',
    'no_degraded_data',
    'requires_validation'
]);

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`rlPositionManager: missing ${key}`);
    }
    return params[key];
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertDecision: db.prepare(`
        INSERT INTO ml_rl_decisions
        (user_id, resolved_env, pos_id, action_type, proposed_at,
         allowed, blockers_json, executed, reward, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateReward: db.prepare(`
        UPDATE ml_rl_decisions SET reward = ?
        WHERE user_id = ? AND resolved_env = ? AND pos_id = ?
          AND action_type = ?
          AND id = (SELECT MAX(id) FROM ml_rl_decisions
                    WHERE user_id = ? AND resolved_env = ?
                    AND pos_id = ? AND action_type = ?)
    `),
    getValidationState: db.prepare(`
        SELECT * FROM ml_rl_validation_state
        WHERE user_id = ? AND resolved_env = ?
    `),
    upsertValidationState: db.prepare(`
        INSERT INTO ml_rl_validation_state
        (user_id, resolved_env, stage, since, reason, actor, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, resolved_env) DO UPDATE SET
            stage = excluded.stage,
            since = CASE
                WHEN ml_rl_validation_state.stage != excluded.stage THEN excluded.since
                ELSE ml_rl_validation_state.since
            END,
            reason = excluded.reason,
            actor = excluded.actor,
            updated_at = excluded.updated_at
    `)
};

// ── proposeManagementAction (heuristic policy) ─────────────────────
function proposeManagementAction(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const posId = _required(params, 'posId');
    const obs = _required(params, 'observation');
    void userId; void env; void posId;

    const dd = typeof obs.ddPct === 'number' ? obs.ddPct : 0;
    const distToTp = typeof obs.distanceToTpPct === 'number' ? obs.distanceToTpPct : Infinity;
    const impulse = typeof obs.impulseStrength === 'number' ? obs.impulseStrength : 0;
    const rr = typeof obs.currentRR === 'number' ? obs.currentRR : 0;
    const noPartial = !!obs.noPartialYet;

    // High DD → reduce or exit
    if (dd > 0.06) {
        return { action: 'force_exit', confidence: 0.8, reason: 'high_dd' };
    }
    if (dd > 0.04 || rr < -0.5) {
        return { action: 'aggressive_reduce', confidence: 0.7, reason: 'dd_warning' };
    }

    // Approaching TP with strong impulse → leave runner
    if (distToTp < 0.01 && impulse > 0.7) {
        return { action: 'leave_runner', confidence: 0.85, reason: 'tp_strong_impulse' };
    }
    if (distToTp < 0.01) {
        return { action: 'activate_trailing', confidence: 0.7, reason: 'tp_proximity' };
    }

    // RR favorable + no partial taken → take partial
    if (rr >= 1.0 && noPartial) {
        return { action: 'take_partial', confidence: 0.75, reason: 'rr_favorable' };
    }

    // Default: trailing
    return { action: 'activate_trailing', confidence: 0.5, reason: 'default' };
}

// ── validateAgainstRiskCage — 5 INVARIANTS ─────────────────────────
function validateAgainstRiskCage(params) {
    const action = _required(params, 'action');
    const riskState = (params && params.riskState) ? params.riskState : {};
    const vetoState = (params && params.vetoState) ? params.vetoState : {};
    const dataFreshness = (params && params.dataFreshness) ? params.dataFreshness : {};
    const sizeCapState = (params && params.sizeCapState) ? params.sizeCapState : {};
    const validationStage = (params && params.validationStage) ? params.validationStage : 'simulator';
    void action;

    const blockers = [];

    // INVARIANT 1: max risk breach
    if (typeof riskState.currentRiskUsd === 'number' && typeof riskState.maxRiskUsd === 'number') {
        if (riskState.currentRiskUsd > riskState.maxRiskUsd) {
            blockers.push('no_max_risk_breach');
        }
    }

    // INVARIANT 2: veto active
    if (vetoState.activeVeto === true) {
        blockers.push('no_veto_override');
    }

    // INVARIANT 3: size cap breach
    if (sizeCapState.withinCap === false) {
        blockers.push('no_size_cap_breach');
    }

    // INVARIANT 4: degraded data
    if (dataFreshness.fresh === false) {
        blockers.push('no_degraded_data');
    }

    // INVARIANT 5: validation stage required for live actions
    if (validationStage !== 'live') {
        blockers.push('requires_validation');
    }

    return {
        allowed: blockers.length === 0,
        blockers,
        ruleCount: RISK_CAGE_RULES.length
    };
}

// ── executeManagementAction ────────────────────────────────────────
function executeManagementAction(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const posId = _required(params, 'posId');
    const action = _required(params, 'action');
    const validation = _required(params, 'validation');

    const executed = validation.allowed ? 1 : 0;
    _stmts.insertDecision.run(
        userId, env, posId, action.action,
        Date.now(),
        validation.allowed ? 1 : 0,
        JSON.stringify(validation.blockers || []),
        executed,
        null,
        Date.now()
    );

    return {
        executed: !!executed,
        action: action.action,
        blockers: validation.blockers || []
    };
}

// ── recordRewardSignal ─────────────────────────────────────────────
function recordRewardSignal(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const posId = _required(params, 'posId');
    const action = _required(params, 'action');
    const outcome = _required(params, 'outcome');

    // Compute reward from outcome
    const pnl = typeof outcome.pnlUsd === 'number' ? outcome.pnlUsd : 0;
    const rrAchieved = typeof outcome.rrAchieved === 'number' ? outcome.rrAchieved : 0;
    const reward = pnl / 100 + rrAchieved * 0.5;  // simple weighted combination

    _stmts.updateReward.run(
        reward,
        userId, env, posId, action,
        userId, env, posId, action
    );

    return { reward };
}

// ── getValidationStage ─────────────────────────────────────────────
function getValidationStage(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const row = _stmts.getValidationState.get(userId, env);
    if (!row) {
        return {
            stage: 'simulator',  // default starting stage
            exists: false
        };
    }
    return {
        stage: row.stage,
        exists: true,
        since: row.since,
        reason: row.reason,
        actor: row.actor
    };
}

// ── advanceValidationStage ─────────────────────────────────────────
function advanceValidationStage(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const toStage = _required(params, 'toStage');
    const reason = _required(params, 'reason');
    const actor = _required(params, 'actor');

    if (!VALIDATION_STAGES.includes(toStage)) {
        throw new Error(`rlPositionManager: invalid stage "${toStage}"`);
    }

    const now = Date.now();
    _stmts.upsertValidationState.run(
        userId, env, toStage, now, reason, actor, now, now
    );

    return { stage: toStage, since: now };
}

module.exports = {
    RL_ACTION_TYPES,
    VALIDATION_STAGES,
    RISK_CAGE_RULES,
    proposeManagementAction,
    validateAgainstRiskCage,
    executeManagementAction,
    recordRewardSignal,
    getValidationStage,
    advanceValidationStage
};
