'use strict';

/**
 * OMEGA R6 ShadowMeta — internalDebate (canonical §71)
 *
 * §71 INTERNAL DEBATE ARCHITECTURE / PROPOSER-CRITIC-JUDGE.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1924-1973.
 *
 * "Nu exista doar 'semnal pozitiv'. Orice semnal trebuie contestat
 *  intern. Aprobarea finala = confruntare structurata, NU o singura
 *  voce."
 *
 * R6 shadow_meta. 4-role internal debate per decision:
 *   PROPOSER          → builds entry thesis + pro_score
 *   CRITIC            → invalidation / fragilities / hidden costs
 *   RISK PROSECUTOR   → tail risk + failure scenarios
 *   JUDGE             → final verdict (LONG/SHORT/NO_TRADE/WAIT/REDUCE)
 *
 * Hard veto: any veto + pro/con ratio < VETO_OVERRIDE_RATIO → NO_TRADE
 * Soft veto: pro >> con (≥ 1.5x) → judge may override
 *
 * Per-role quality tracking for tuning analysis (proposer too aggressive?
 * critic too conservative? judge too permissive?).
 *
 * Distinct from §48 ensembleVoting (3-model vote average). §71 is
 * structured debate with veto powers + role specialization.
 */

const { db } = require('../../database');

const DEBATE_ROLES = Object.freeze([
    'proposer', 'critic', 'risk_prosecutor', 'judge'
]);
const JUDGE_VERDICTS = Object.freeze([
    'LONG', 'SHORT', 'NO_TRADE', 'WAIT', 'REDUCE'
]);
const VETO_SOURCES = Object.freeze([
    'none', 'critic', 'risk_prosecutor', 'both'
]);
const VETO_OVERRIDE_RATIO = 1.5;

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`internalDebate: missing ${key}`);
    }
    return params[key];
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertSession: db.prepare(`
        INSERT INTO ml_debate_sessions
        (user_id, resolved_env, debate_id, proposer_thesis, pro_score,
         created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `),
    updateCritic: db.prepare(`
        UPDATE ml_debate_sessions
        SET critic_concerns_json = ?, con_score = ?, vetoed_by = ?
        WHERE debate_id = ?
    `),
    updateRiskProsecutor: db.prepare(`
        UPDATE ml_debate_sessions
        SET risk_prosecutor_args_json = ?, con_score = ?, vetoed_by = ?
        WHERE debate_id = ?
    `),
    updateVerdict: db.prepare(`
        UPDATE ml_debate_sessions
        SET judge_verdict = ?, explanation = ?, verdict_ts = ?
        WHERE debate_id = ?
    `),
    getSession: db.prepare(`
        SELECT * FROM ml_debate_sessions WHERE debate_id = ?
    `),
    upsertRolePerf: db.prepare(`
        INSERT INTO ml_role_performance
        (user_id, resolved_env, role, total_decisions,
         correct_calls, false_positives, false_negatives,
         quality_score, last_updated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, resolved_env, role) DO UPDATE SET
            total_decisions = excluded.total_decisions,
            correct_calls = excluded.correct_calls,
            false_positives = excluded.false_positives,
            false_negatives = excluded.false_negatives,
            quality_score = excluded.quality_score,
            last_updated = excluded.last_updated
    `),
    getRolePerf: db.prepare(`
        SELECT * FROM ml_role_performance
        WHERE user_id = ? AND resolved_env = ? AND role = ?
    `),
    historyForUser: db.prepare(`
        SELECT * FROM ml_debate_sessions
        WHERE user_id = ? AND resolved_env = ?
          AND (? = '' OR judge_verdict = ?)
          AND (? = 0 OR created_at >= ?)
        ORDER BY created_at DESC, id DESC
        LIMIT ?
    `)
};

// ── recordProposerThesis ───────────────────────────────────────────
function recordProposerThesis(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const debateId = _required(params, 'debateId');
    const thesis = _required(params, 'thesis');
    const proScore = _required(params, 'proScore');
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertSession.run(userId, env, debateId, thesis, proScore, ts);
        return { recorded: true, debateId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`internalDebate: duplicate debateId "${debateId}"`);
        }
        throw err;
    }
}

// ── recordCriticConcerns ───────────────────────────────────────────
function recordCriticConcerns(params) {
    const debateId = _required(params, 'debateId');
    const concerns = _required(params, 'concerns');
    const conScore = _required(params, 'conScore');
    const vetoTriggered = !!params.vetoTriggered;

    const session = _stmts.getSession.get(debateId);
    if (!session) throw new Error(`internalDebate: debate "${debateId}" not found`);

    // If risk_prosecutor already vetoed, combine.
    let vetoedBy = session.vetoed_by;
    if (vetoTriggered) {
        if (vetoedBy === 'risk_prosecutor') vetoedBy = 'both';
        else if (vetoedBy === 'none') vetoedBy = 'critic';
    }

    _stmts.updateCritic.run(
        JSON.stringify(concerns),
        Math.max(session.con_score, conScore),
        vetoedBy, debateId
    );

    return { recorded: true, vetoedBy };
}

// ── recordRiskProsecutorArgs ───────────────────────────────────────
function recordRiskProsecutorArgs(params) {
    const debateId = _required(params, 'debateId');
    const args = _required(params, 'args');
    const conScore = _required(params, 'conScore');
    const vetoTriggered = !!params.vetoTriggered;

    const session = _stmts.getSession.get(debateId);
    if (!session) throw new Error(`internalDebate: debate "${debateId}" not found`);

    let vetoedBy = session.vetoed_by;
    if (vetoTriggered) {
        if (vetoedBy === 'critic') vetoedBy = 'both';
        else if (vetoedBy === 'none') vetoedBy = 'risk_prosecutor';
    }

    _stmts.updateRiskProsecutor.run(
        JSON.stringify(args),
        Math.max(session.con_score, conScore),
        vetoedBy, debateId
    );

    return { recorded: true, vetoedBy };
}

// ── evaluateDebate (pure) ──────────────────────────────────────────
function evaluateDebate(params) {
    const proScore = _required(params, 'proScore');
    const conScore = _required(params, 'conScore');
    const criticVeto = !!params.criticVeto;
    const riskVeto = !!params.riskVeto;
    const proposerDirection = (params && params.proposerDirection)
        ? params.proposerDirection : 'LONG';

    if (proposerDirection !== 'LONG' && proposerDirection !== 'SHORT') {
        throw new Error('internalDebate: proposerDirection must be LONG or SHORT');
    }

    const ratio = conScore > 0 ? proScore / conScore : Infinity;

    // Hard veto path
    if ((criticVeto || riskVeto) && ratio < VETO_OVERRIDE_RATIO) {
        return {
            verdict: 'NO_TRADE',
            reasoning: `veto active (critic=${criticVeto} risk=${riskVeto}) and pro/con ratio ${ratio.toFixed(2)} < ${VETO_OVERRIDE_RATIO}`,
            ratio
        };
    }

    // Soft veto with override
    if (criticVeto || riskVeto) {
        return {
            verdict: 'REDUCE',
            reasoning: `veto present but override-eligible (ratio ${ratio.toFixed(2)} >= ${VETO_OVERRIDE_RATIO})`,
            ratio
        };
    }

    // No veto path
    if (proScore > conScore && ratio >= 1.5) {
        return { verdict: proposerDirection, reasoning: `strong positive (ratio ${ratio.toFixed(2)})`, ratio };
    }
    if (proScore > conScore) {
        return { verdict: 'WAIT', reasoning: `weak positive (ratio ${ratio.toFixed(2)})`, ratio };
    }
    return { verdict: 'NO_TRADE', reasoning: `con outweighs (ratio ${ratio.toFixed(2)})`, ratio };
}

// ── recordJudgeVerdict ─────────────────────────────────────────────
function recordJudgeVerdict(params) {
    const debateId = _required(params, 'debateId');
    const verdict = _required(params, 'verdict');
    const explanation = _required(params, 'explanation');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!JUDGE_VERDICTS.includes(verdict)) {
        throw new Error(`internalDebate: invalid verdict "${verdict}"`);
    }

    const session = _stmts.getSession.get(debateId);
    if (!session) throw new Error(`internalDebate: debate "${debateId}" not found`);

    _stmts.updateVerdict.run(verdict, explanation, ts, debateId);
    return { recorded: true, verdict };
}

// ── recordRoleOutcome ──────────────────────────────────────────────
function recordRoleOutcome(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const role = _required(params, 'role');
    const correct = !!params.correct;
    const falsePositive = !!params.falsePositive;
    const falseNegative = !!params.falseNegative;
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!DEBATE_ROLES.includes(role)) {
        throw new Error(`internalDebate: invalid role "${role}"`);
    }

    const current = _stmts.getRolePerf.get(userId, env, role);
    const total = (current ? current.total_decisions : 0) + 1;
    const correctCount = (current ? current.correct_calls : 0) + (correct ? 1 : 0);
    const fpCount = (current ? current.false_positives : 0) + (falsePositive ? 1 : 0);
    const fnCount = (current ? current.false_negatives : 0) + (falseNegative ? 1 : 0);
    const qualityScore = total > 0
        ? (correctCount - 0.5 * fpCount - 0.5 * fnCount) / total
        : 0;

    _stmts.upsertRolePerf.run(
        userId, env, role, total,
        correctCount, fpCount, fnCount,
        qualityScore, ts
    );

    return { recorded: true, qualityScore };
}

// ── getRoleQuality ─────────────────────────────────────────────────
function getRoleQuality(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const role = _required(params, 'role');
    const row = _stmts.getRolePerf.get(userId, env, role);
    if (!row) return { exists: false };
    return {
        exists: true,
        role: row.role,
        totalDecisions: row.total_decisions,
        correctCalls: row.correct_calls,
        falsePositives: row.false_positives,
        falseNegatives: row.false_negatives,
        qualityScore: row.quality_score,
        lastUpdated: row.last_updated
    };
}

// ── getDebateHistory ───────────────────────────────────────────────
function getDebateHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const verdict = (params && params.verdict) ? params.verdict : '';
    const since = (params && params.since) ? params.since : 0;
    const limit = (params && params.limit) ? params.limit : 100;
    return _stmts.historyForUser.all(
        userId, env,
        verdict, verdict,
        since > 0 ? 1 : 0, since,
        limit
    );
}

module.exports = {
    DEBATE_ROLES,
    JUDGE_VERDICTS,
    VETO_SOURCES,
    VETO_OVERRIDE_RATIO,
    recordProposerThesis,
    recordCriticConcerns,
    recordRiskProsecutorArgs,
    evaluateDebate,
    recordJudgeVerdict,
    recordRoleOutcome,
    getRoleQuality,
    getDebateHistory
};
