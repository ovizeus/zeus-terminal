'use strict';

/**
 * OMEGA §217 — UNCHOSEN QUESTION DETECTOR / FRAMING-ERROR ENGINE.
 * Canonical PDF lines 6775-6835.
 */

const { db } = require('../../database');

const QUESTION_STATUSES = Object.freeze([
    'answered_question', 'avoided_question',
    'suppressed_question', 'missing_higher_order_question'
]);
const RECOMMENDED_ACTIONS = Object.freeze([
    'proceed', 'wait', 'reframe', 'escalate', 'observe'
]);
const HIGH_FRAMING_STRESS = 0.60;

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);
function _required(p, k) { if (p == null || p[k] == null) throw new Error(`§217 missing param: ${k}`); return p[k]; }
function _requireEnv(env) { if (!RESOLVED_ENVS.has(env)) throw new Error(`§217 invalid env: ${env}`); return env; }
function _requireRange01(name, v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`§217 ${name} must be in [0,1]`);
    }
}

function classifyQuestionStatus(params) {
    const status = _required(params, 'questionStatus');
    if (!QUESTION_STATUSES.includes(status)) throw new Error(`§217 invalid status: ${status}`);
    return { status };
}

function recommendAction(params) {
    const framingStress = _required(params, 'framingStressScore');
    const status = _required(params, 'questionStatus');
    _requireRange01('framingStressScore', framingStress);
    if (!QUESTION_STATUSES.includes(status)) throw new Error(`§217 invalid status: ${status}`);
    if (framingStress >= HIGH_FRAMING_STRESS) {
        if (status === 'missing_higher_order_question') return { action: 'escalate' };
        return { action: 'reframe' };
    }
    if (status === 'suppressed_question') return { action: 'observe' };
    if (status === 'avoided_question') return { action: 'wait' };
    return { action: 'proceed' };
}

const _stmts = {
    insert: db.prepare(`
        INSERT INTO ml_unchosen_question_audits (
            user_id, resolved_env, audit_id, current_question,
            latent_questions_json, framing_stress_score,
            question_status, recommended_action, reasoning, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectById: db.prepare(`SELECT * FROM ml_unchosen_question_audits WHERE audit_id = ?`),
    selectAll: db.prepare(`
        SELECT id, audit_id AS auditId, current_question AS currentQuestion,
               framing_stress_score AS framingStressScore,
               question_status AS questionStatus,
               recommended_action AS recommendedAction, ts
        FROM ml_unchosen_question_audits
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
    `)
};

function recordAudit(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const auditId = _required(params, 'auditId');
    const currentQuestion = _required(params, 'currentQuestion');
    const latentQuestions = _required(params, 'latentQuestions');
    const framingStressScore = _required(params, 'framingStressScore');
    const questionStatus = _required(params, 'questionStatus');
    const ts = _required(params, 'ts');
    const reasoning = params.reasoning ?? null;

    if (!Array.isArray(latentQuestions)) throw new Error('§217 latentQuestions must be array');
    if (!QUESTION_STATUSES.includes(questionStatus)) throw new Error(`§217 invalid status`);
    _requireRange01('framingStressScore', framingStressScore);
    if (_stmts.selectById.get(auditId)) throw new Error(`§217 duplicate auditId: ${auditId}`);

    const { action } = recommendAction({ framingStressScore, questionStatus });

    _stmts.insert.run(
        userId, resolvedEnv, auditId, currentQuestion,
        JSON.stringify(latentQuestions), framingStressScore,
        questionStatus, action, reasoning, ts
    );
    return { recorded: true, auditId, recommendedAction: action };
}

function getRecentAudits(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    return _stmts.selectAll.all(userId, resolvedEnv);
}

module.exports = { QUESTION_STATUSES, RECOMMENDED_ACTIONS, HIGH_FRAMING_STRESS,
    classifyQuestionStatus, recommendAction, recordAudit, getRecentAudits };
