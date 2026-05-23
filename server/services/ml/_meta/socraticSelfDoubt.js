'use strict';

/**
 * OMEGA meta — socraticSelfDoubt (canonical §101)
 *
 * §101 SOCRATIC SELF-DOUBT PROTOCOL.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt line 2619.
 *
 * "Socratic protocol ruleaza periodic — la intervale regulate si dupa fiecare
 *  perioada de performanta buna — si incearca activ sa falsifice credintele
 *  centrale: 'daca cross-venue divergence a functionat 3 saptamani, de ce
 *  ar putea sa nu mai functioneze de maine?' Diferit de critic care ataca un
 *  trade, socratic protocol ataca premisele generale. Un sistem care nu se
 *  indoieste sistematic de sine devine dogmatic, indiferent de cata
 *  calibrare are."
 *
 * Distinct from §38 intelligenceChecker (self-evaluation per decision),
 * §10 supremePrinciple (architecture invariant). §101 = worldview falsification.
 */

const { db } = require('../../database');

const SOCRATIC_TRIGGERS = Object.freeze([
    'periodic_interval', 'post_good_performance', 'manual'
]);
const FALSIFICATION_RESULTS = Object.freeze([
    'CONFIRMED', 'QUESTIONED', 'REFUTED', 'INCONCLUSIVE'
]);
const SESSION_STATUSES = Object.freeze(['OPEN', 'CLOSED']);

const DEFAULT_PERIODIC_INTERVAL_DAYS = 14;
const DOGMATISM_RISK_THRESHOLD_DAYS = 30;
const MIN_TOTAL_EVIDENCE_FOR_VERDICT = 3;
const CONFIRMED_RATIO_THRESHOLD = 0.80;
const REFUTED_RATIO_THRESHOLD = 0.20;
const DAY_MS = 86400000;

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`socraticSelfDoubt: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertSession: db.prepare(`
        INSERT INTO ml_socratic_sessions
        (user_id, resolved_env, session_id, trigger,
         beliefs_examined, beliefs_falsified, status, ts_started, ts_closed)
        VALUES (?, ?, ?, ?, 0, 0, 'OPEN', ?, NULL)
    `),
    getSession: db.prepare(`
        SELECT * FROM ml_socratic_sessions WHERE session_id = ?
    `),
    listSessions: db.prepare(`
        SELECT * FROM ml_socratic_sessions
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts_started DESC LIMIT ?
    `),
    latestSession: db.prepare(`
        SELECT * FROM ml_socratic_sessions
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts_started DESC LIMIT 1
    `),
    closeSession: db.prepare(`
        UPDATE ml_socratic_sessions
        SET status = 'CLOSED', ts_closed = ?,
            beliefs_examined = ?, beliefs_falsified = ?
        WHERE user_id = ? AND resolved_env = ? AND session_id = ?
    `),
    insertChallenge: db.prepare(`
        INSERT INTO ml_socratic_challenges
        (user_id, resolved_env, challenge_id, session_id, belief_id,
         premise, counterfactual, falsification_result,
         evidence_score, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    aggregateChallenges: db.prepare(`
        SELECT COUNT(*) AS total,
               COALESCE(SUM(CASE WHEN falsification_result IN ('REFUTED','QUESTIONED')
                                 THEN 1 ELSE 0 END), 0) AS falsified
        FROM ml_socratic_challenges
        WHERE user_id = ? AND resolved_env = ? AND session_id = ?
    `)
};

// ── evaluateBeliefRobustness (pure) ────────────────────────────────
function evaluateBeliefRobustness(params) {
    const evidenceFor = _required(params, 'evidenceFor');
    const evidenceAgainst = _required(params, 'evidenceAgainst');
    const minEvidence = (params && params.minEvidence !== undefined)
        ? params.minEvidence : MIN_TOTAL_EVIDENCE_FOR_VERDICT;

    const total = evidenceFor + evidenceAgainst;
    if (total < minEvidence) {
        return { result: 'INCONCLUSIVE', ratio: null, total };
    }
    const ratio = evidenceFor / total;
    let result;
    if (ratio >= CONFIRMED_RATIO_THRESHOLD) result = 'CONFIRMED';
    else if (ratio <= REFUTED_RATIO_THRESHOLD) result = 'REFUTED';
    else result = 'QUESTIONED';
    return { result, ratio, total };
}

// ── triggerSocraticSession ─────────────────────────────────────────
function triggerSocraticSession(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const sessionId = _required(params, 'sessionId');
    const trigger = _required(params, 'trigger');
    if (!SOCRATIC_TRIGGERS.includes(trigger)) {
        throw new Error(`socraticSelfDoubt: invalid trigger "${trigger}"`);
    }
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertSession.run(
            userId, env, sessionId, trigger, ts
        );
        return { triggered: true, sessionId, trigger, status: 'OPEN' };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`socraticSelfDoubt: duplicate sessionId "${sessionId}"`);
        }
        throw err;
    }
}

// ── recordBeliefChallenge ──────────────────────────────────────────
function recordBeliefChallenge(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const challengeId = _required(params, 'challengeId');
    const sessionId = _required(params, 'sessionId');
    const beliefId = _required(params, 'beliefId');
    const premise = _required(params, 'premise');
    const counterfactual = _required(params, 'counterfactual');
    const falsificationResult = _required(params, 'falsificationResult');
    if (!FALSIFICATION_RESULTS.includes(falsificationResult)) {
        throw new Error(
            `socraticSelfDoubt: invalid falsificationResult "${falsificationResult}"`
        );
    }
    const evidenceScore = (params && params.evidenceScore !== undefined)
        ? params.evidenceScore : null;
    const ts = (params && params.ts) ? params.ts : Date.now();

    const session = _stmts.getSession.get(sessionId);
    if (!session) {
        throw new Error(`socraticSelfDoubt: session "${sessionId}" not found`);
    }
    if (session.user_id !== userId || session.resolved_env !== env) {
        throw new Error('socraticSelfDoubt: session not owned by user/env');
    }
    if (session.status !== 'OPEN') {
        throw new Error(`socraticSelfDoubt: session "${sessionId}" is CLOSED`);
    }

    try {
        _stmts.insertChallenge.run(
            userId, env, challengeId, sessionId, beliefId,
            premise, counterfactual, falsificationResult,
            evidenceScore, ts
        );
        return { recorded: true, challengeId, falsificationResult };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`socraticSelfDoubt: duplicate challengeId "${challengeId}"`);
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

    const session = _stmts.getSession.get(sessionId);
    if (!session) {
        throw new Error(`socraticSelfDoubt: session "${sessionId}" not found`);
    }
    if (session.user_id !== userId || session.resolved_env !== env) {
        throw new Error('socraticSelfDoubt: session not owned by user/env');
    }
    if (session.status === 'CLOSED') {
        return {
            closed: false, reason: 'already_closed',
            sessionId
        };
    }

    const agg = _stmts.aggregateChallenges.get(userId, env, sessionId);
    const examined = agg ? agg.total : 0;
    const falsified = agg ? agg.falsified : 0;

    _stmts.closeSession.run(ts, examined, falsified, userId, env, sessionId);
    return {
        closed: true, sessionId,
        beliefsExamined: examined,
        beliefsFalsified: falsified
    };
}

// ── getDogmatismRisk ───────────────────────────────────────────────
function getDogmatismRisk(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const thresholdDays = (params && params.thresholdDays !== undefined)
        ? params.thresholdDays : DOGMATISM_RISK_THRESHOLD_DAYS;
    const now = (params && params.now) ? params.now : Date.now();

    const last = _stmts.latestSession.get(userId, env);
    if (!last) {
        return {
            atRisk: true, daysSinceLastSession: Infinity,
            reason: 'no_sessions_ever',
            thresholdDays
        };
    }
    const lastTs = last.ts_closed || last.ts_started;
    const daysSince = (now - lastTs) / DAY_MS;
    return {
        atRisk: daysSince >= thresholdDays,
        daysSinceLastSession: daysSince,
        thresholdDays,
        lastSessionId: last.session_id,
        lastTs
    };
}

// ── getSocraticHistory ─────────────────────────────────────────────
function getSocraticHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const limit = (params && params.limit) ? params.limit : 100;

    const rows = _stmts.listSessions.all(userId, env, limit);
    return rows.map(r => ({
        sessionId: r.session_id,
        trigger: r.trigger,
        beliefsExamined: r.beliefs_examined,
        beliefsFalsified: r.beliefs_falsified,
        status: r.status,
        tsStarted: r.ts_started,
        tsClosed: r.ts_closed
    }));
}

module.exports = {
    SOCRATIC_TRIGGERS,
    FALSIFICATION_RESULTS,
    SESSION_STATUSES,
    DEFAULT_PERIODIC_INTERVAL_DAYS,
    DOGMATISM_RISK_THRESHOLD_DAYS,
    MIN_TOTAL_EVIDENCE_FOR_VERDICT,
    evaluateBeliefRobustness,
    triggerSocraticSession,
    recordBeliefChallenge,
    closeSession,
    getDogmatismRisk,
    getSocraticHistory
};
