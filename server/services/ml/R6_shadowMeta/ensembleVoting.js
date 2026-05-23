'use strict';

/**
 * OMEGA R6 Shadow Meta — ensembleVoting (canonical §48)
 *
 * §48 ENSEMBLE VOTING ÎNTRE MODELE ARHITECTURAL DIFERITE.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1562-1572.
 *
 * Min 3 modele arhitectural distincte (ex: LSTM + XGBoost + Transformer):
 *   3/3 acord → size 100%
 *   2/3 acord → size 50%
 *   1/3 sau 0 → NO_TRADE
 *
 * "Un singur model, oricât de bun, are orbite. Standard în sistemele
 * de ultra-high-reliability."
 */

const { db } = require('../../database');

const VOTE_ACTIONS = Object.freeze(['BUY', 'SELL', 'NO_TRADE']);

const AGREEMENT_SIZE_MAP = Object.freeze({
    0: 0,
    1: 0,
    2: 0.5,
    3: 1.0
});

const MIN_VOTERS = 3;

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`ensembleVoting: missing ${key}`);
    }
    return params[key];
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertVote: db.prepare(`
        INSERT INTO ml_ensemble_votes
        (user_id, resolved_env, decision_id, model_type,
         vote_action, vote_confidence, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    listForDecision: db.prepare(`
        SELECT * FROM ml_ensemble_votes
        WHERE user_id = ? AND resolved_env = ? AND decision_id = ?
        ORDER BY created_at ASC
    `),
    listHistory: db.prepare(`
        SELECT * FROM ml_ensemble_votes
        WHERE user_id = ? AND resolved_env = ?
          AND (? = 0 OR created_at >= ?)
        ORDER BY created_at DESC, id DESC
        LIMIT ?
    `),
    listPairDecisions: db.prepare(`
        SELECT decision_id, model_type, vote_action
        FROM ml_ensemble_votes
        WHERE user_id = ? AND resolved_env = ?
          AND model_type IN (?, ?)
        ORDER BY decision_id ASC, model_type ASC
    `)
};

// ── recordModelVote ────────────────────────────────────────────────
function recordModelVote(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const decisionId = _required(params, 'decisionId');
    const modelType = _required(params, 'modelType');
    const voteAction = _required(params, 'voteAction');
    const voteConfidence = _required(params, 'voteConfidence');

    if (!VOTE_ACTIONS.includes(voteAction)) {
        throw new Error(`ensembleVoting: invalid voteAction "${voteAction}"`);
    }

    _stmts.insertVote.run(
        userId, env, decisionId, modelType,
        voteAction, voteConfidence, Date.now()
    );

    return { recorded: true };
}

// ── aggregateVotes ─────────────────────────────────────────────────
function aggregateVotes(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const decisionId = _required(params, 'decisionId');

    const rows = _stmts.listForDecision.all(userId, env, decisionId);

    if (rows.length < MIN_VOTERS) {
        return {
            sizeMultiplier: 0,
            agreementCount: rows.length,
            finalDecision: 'NO_TRADE',
            dominantAction: null,
            reason: 'insufficient_voters'
        };
    }

    // Count vote occurrences per action
    const tally = { BUY: 0, SELL: 0, NO_TRADE: 0 };
    for (const r of rows) tally[r.vote_action]++;

    // Find dominant action
    let dominantAction = null;
    let agreementCount = 0;
    for (const [act, count] of Object.entries(tally)) {
        if (count > agreementCount) {
            agreementCount = count;
            dominantAction = act;
        }
    }

    const sizeMultiplier = AGREEMENT_SIZE_MAP[agreementCount] !== undefined
        ? AGREEMENT_SIZE_MAP[agreementCount] : 0;

    let finalDecision;
    if (sizeMultiplier === 0 || dominantAction === 'NO_TRADE') {
        finalDecision = 'NO_TRADE';
    } else {
        finalDecision = dominantAction;
    }

    return {
        sizeMultiplier,
        agreementCount,
        dominantAction,
        finalDecision,
        tally,
        totalVotes: rows.length
    };
}

// ── getVotingHistory ───────────────────────────────────────────────
function getVotingHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const since = (params && params.since) ? params.since : 0;
    const limit = (params && params.limit) ? params.limit : 100;

    const rows = _stmts.listHistory.all(
        userId, env,
        since > 0 ? 1 : 0, since,
        limit
    );

    return rows.map(r => ({
        id: r.id,
        decisionId: r.decision_id,
        modelType: r.model_type,
        voteAction: r.vote_action,
        voteConfidence: r.vote_confidence,
        createdAt: r.created_at
    }));
}

// ── getModelAgreementRate ──────────────────────────────────────────
function getModelAgreementRate(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const modelA = _required(params, 'modelA');
    const modelB = _required(params, 'modelB');

    const rows = _stmts.listPairDecisions.all(userId, env, modelA, modelB);

    // Group by decision_id
    const byDecision = new Map();
    for (const r of rows) {
        if (!byDecision.has(r.decision_id)) byDecision.set(r.decision_id, {});
        byDecision.get(r.decision_id)[r.model_type] = r.vote_action;
    }

    let totalDecisions = 0;
    let agreedCount = 0;
    for (const votes of byDecision.values()) {
        if (votes[modelA] && votes[modelB]) {
            totalDecisions++;
            if (votes[modelA] === votes[modelB]) agreedCount++;
        }
    }

    if (totalDecisions === 0) {
        return {
            modelA, modelB,
            agreementRate: null,
            totalDecisions: 0,
            agreedCount: 0
        };
    }

    return {
        modelA, modelB,
        totalDecisions,
        agreedCount,
        agreementRate: agreedCount / totalDecisions
    };
}

module.exports = {
    VOTE_ACTIONS,
    AGREEMENT_SIZE_MAP,
    MIN_VOTERS,
    recordModelVote,
    aggregateVotes,
    getVotingHistory,
    getModelAgreementRate
};
