'use strict';

/**
 * OMEGA R3A Safety — preMortemRehearsal (canonical §119)
 *
 * §119 PRE-MORTEM FAILURE REHEARSAL / FAILURE-FIRST SIMULATION.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 3204-3246.
 *
 * "Inainte de a aproba o decizie importanta, sistemul trebuie sa simuleze
 *  explicit modurile cele mai probabile si mai periculoase prin care acea
 *  decizie poate esua... NU este acelasi lucru cu scenario tree general...
 *  accentul e pe mecanisme de esec si pe caile de salvare... 8 failure
 *  modes: thesis_invalidation_rapid/fakeout/liquidity_vacuum/slippage_blowout/
 *  venue_failure/latency_miss/macro_interruption/cross_asset_contagion...
 *  severity/detectability/recoverability scores... action plan: reduce/hedge/
 *  exit/observer/lock... 'daca trade-ul moare urat, cum moare cel mai
 *  probabil si ce fac atunci?'... failure rehearsal NU teatru — trebuie sa
 *  modifice size/SL/execution mode sau abstentie."
 *
 * Distinct from §111 scenarioTreePlanner (FUTURE worlds projection cu
 * probability×pnl), §44 adversarialSelfTester (post-hoc attacks),
 * §88 accountStressEngine (liquidation paths only), §29 circuitBreaker
 * (active circuit), §246 ddRecoveryGraduated (drawdown recovery).
 * §119 = PRE-decision failure-mode rehearsal cu action plans.
 */

const { db } = require('../../database');

const FAILURE_KINDS = Object.freeze([
    'thesis_invalidation_rapid', 'fakeout',
    'liquidity_vacuum', 'slippage_blowout',
    'venue_failure', 'latency_miss',
    'macro_interruption', 'cross_asset_contagion'
]);
const ACTION_PLANS = Object.freeze([
    'reduce', 'hedge', 'exit', 'observer', 'lock'
]);
const SESSION_STATUSES = Object.freeze(['OPEN', 'CLOSED']);

const CRITICAL_RISK_THRESHOLD = 0.50;
const HIGH_RISK_THRESHOLD = 0.30;

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`preMortemRehearsal: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertSession: db.prepare(`
        INSERT INTO ml_premortem_sessions
        (user_id, resolved_env, session_id, decision_id,
         dominant_failure_mode, total_failure_modes,
         max_severity, aggregate_risk_score,
         status, ts_started, ts_closed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, NULL)
    `),
    getSession: db.prepare(`
        SELECT * FROM ml_premortem_sessions WHERE session_id = ?
    `),
    listSessions: db.prepare(`
        SELECT * FROM ml_premortem_sessions
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts_started DESC LIMIT ?
    `),
    listSessionsByDecision: db.prepare(`
        SELECT * FROM ml_premortem_sessions
        WHERE user_id = ? AND resolved_env = ? AND decision_id = ?
        ORDER BY ts_started DESC LIMIT ?
    `),
    closeSession: db.prepare(`
        UPDATE ml_premortem_sessions
        SET status = 'CLOSED', ts_closed = ?
        WHERE user_id = ? AND resolved_env = ? AND session_id = ?
    `),
    insertMode: db.prepare(`
        INSERT INTO ml_premortem_failure_modes
        (user_id, resolved_env, mode_id, session_id, failure_kind,
         severity, detectability, recoverability, action_plan, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
};

// ── computeRiskScore (pure) ────────────────────────────────────────
// risk = severity × (1 − detectability) × (1 − recoverability)
function computeRiskScore(params) {
    const severity = _required(params, 'severity');
    const detectability = _required(params, 'detectability');
    const recoverability = _required(params, 'recoverability');
    for (const [k, v] of [['severity', severity], ['detectability', detectability],
                           ['recoverability', recoverability]]) {
        if (v < 0 || v > 1) {
            throw new Error(`preMortemRehearsal: ${k} must be in [0,1]`);
        }
    }
    const riskScore = severity * (1 - detectability) * (1 - recoverability);
    return { riskScore, severity, detectability, recoverability };
}

// ── selectActionPlan (pure) ────────────────────────────────────────
function selectActionPlan(params) {
    const { riskScore } = computeRiskScore(params);
    const recoverability = params.recoverability;

    let actionPlan;
    let reason;
    if (riskScore >= CRITICAL_RISK_THRESHOLD) {
        if (recoverability < 0.20) {
            actionPlan = 'lock';
            reason = 'critical_risk_unrecoverable';
        } else {
            actionPlan = 'exit';
            reason = 'critical_risk_exit_when_recoverable';
        }
    } else if (riskScore >= HIGH_RISK_THRESHOLD) {
        if (recoverability >= 0.50) {
            actionPlan = 'reduce';
            reason = 'high_risk_recoverable_reduce';
        } else {
            actionPlan = 'hedge';
            reason = 'high_risk_hedge_when_recovery_uncertain';
        }
    } else {
        actionPlan = 'observer';
        reason = 'low_risk_observer_only';
    }
    return { actionPlan, riskScore, reason };
}

// ── registerFailureMode ────────────────────────────────────────────
function registerFailureMode(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const modeId = _required(params, 'modeId');
    const sessionId = _required(params, 'sessionId');
    const failureKind = _required(params, 'failureKind');
    if (!FAILURE_KINDS.includes(failureKind)) {
        throw new Error(
            `preMortemRehearsal: invalid failureKind "${failureKind}"`
        );
    }
    const severity = _required(params, 'severity');
    const detectability = _required(params, 'detectability');
    const recoverability = _required(params, 'recoverability');
    for (const [k, v] of [['severity', severity], ['detectability', detectability],
                           ['recoverability', recoverability]]) {
        if (v < 0 || v > 1) {
            throw new Error(`preMortemRehearsal: ${k} must be in [0,1]`);
        }
    }
    const actionPlan = _required(params, 'actionPlan');
    if (!ACTION_PLANS.includes(actionPlan)) {
        throw new Error(
            `preMortemRehearsal: invalid actionPlan "${actionPlan}"`
        );
    }
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertMode.run(
            userId, env, modeId, sessionId, failureKind,
            severity, detectability, recoverability,
            actionPlan, ts
        );
        return { registered: true, modeId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`preMortemRehearsal: duplicate modeId "${modeId}"`);
        }
        throw err;
    }
}

// ── runPreMortemSession ────────────────────────────────────────────
function runPreMortemSession(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const sessionId = _required(params, 'sessionId');
    const decisionId = _required(params, 'decisionId');
    const modes = _required(params, 'modes');
    if (!Array.isArray(modes) || modes.length === 0) {
        throw new Error('preMortemRehearsal: modes must be non-empty array');
    }
    // Validate all modes BEFORE inserting any
    for (const m of modes) {
        if (!FAILURE_KINDS.includes(m.failureKind)) {
            throw new Error(
                `preMortemRehearsal: invalid failureKind "${m.failureKind}"`
            );
        }
        if (!ACTION_PLANS.includes(m.actionPlan)) {
            throw new Error(
                `preMortemRehearsal: invalid actionPlan "${m.actionPlan}"`
            );
        }
    }
    const ts = (params && params.ts) ? params.ts : Date.now();

    // Compute aggregates pre-insert
    let maxSeverity = 0;
    let dominantMode = null;
    let aggregateRisk = 0;
    for (const m of modes) {
        const { riskScore } = computeRiskScore({
            severity: m.severity,
            detectability: m.detectability,
            recoverability: m.recoverability
        });
        aggregateRisk += riskScore;
        if (m.severity > maxSeverity) {
            maxSeverity = m.severity;
            dominantMode = m.failureKind;
        }
    }

    const txn = db.transaction(() => {
        _stmts.insertSession.run(
            userId, env, sessionId, decisionId,
            dominantMode, modes.length,
            maxSeverity, aggregateRisk, ts
        );
        for (const m of modes) {
            _stmts.insertMode.run(
                userId, env, m.modeId, sessionId, m.failureKind,
                m.severity, m.detectability, m.recoverability,
                m.actionPlan, ts
            );
        }
    });

    try {
        txn();
        return {
            runned: true, sessionId,
            totalFailureModes: modes.length,
            dominantFailureMode: dominantMode,
            maxSeverity,
            aggregateRiskScore: aggregateRisk
        };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `preMortemRehearsal: duplicate sessionId or modeId in "${sessionId}"`
            );
        }
        throw err;
    }
}

// ── closeSession ───────────────────────────────────────────────────
function closeSession(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const sessionId = _required(params, 'sessionId');
    const ts = (params && params.ts) ? params.ts : Date.now();

    const s = _stmts.getSession.get(sessionId);
    if (!s) {
        throw new Error(`preMortemRehearsal: session "${sessionId}" not found`);
    }
    if (s.user_id !== userId || s.resolved_env !== env) {
        throw new Error('preMortemRehearsal: session not owned by user/env');
    }
    if (s.status === 'CLOSED') {
        return { closed: false, reason: 'already_closed', sessionId };
    }
    _stmts.closeSession.run(ts, userId, env, sessionId);
    return { closed: true, sessionId };
}

// ── getPreMortemHistory ────────────────────────────────────────────
function getPreMortemHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const decisionId = params && params.decisionId;
    const limit = (params && params.limit) ? params.limit : 100;

    const rows = decisionId
        ? _stmts.listSessionsByDecision.all(userId, env, decisionId, limit)
        : _stmts.listSessions.all(userId, env, limit);
    return rows.map(r => ({
        sessionId: r.session_id,
        decisionId: r.decision_id,
        dominantFailureMode: r.dominant_failure_mode,
        totalFailureModes: r.total_failure_modes,
        maxSeverity: r.max_severity,
        aggregateRiskScore: r.aggregate_risk_score,
        status: r.status,
        tsStarted: r.ts_started,
        tsClosed: r.ts_closed
    }));
}

module.exports = {
    FAILURE_KINDS,
    ACTION_PLANS,
    SESSION_STATUSES,
    CRITICAL_RISK_THRESHOLD,
    HIGH_RISK_THRESHOLD,
    computeRiskScore,
    selectActionPlan,
    registerFailureMode,
    runPreMortemSession,
    closeSession,
    getPreMortemHistory
};
