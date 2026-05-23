'use strict';

/**
 * OMEGA R2 Cognition — competingHypothesesEngine (canonical §112)
 *
 * §112 COMPETING HYPOTHESES ENGINE / THESIS MARKET.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 2936-2968.
 *
 * "Trebuie sa existe mai multe ipoteze rivale care concureaza intre ele...
 *  continuation/distribution/short_covering/liquidity_grab/macro_override
 *  thesis... posterior score pentru fiecare... conditii de invalidare...
 *  transfer de probabilitate intre ipoteze cand apar dovezi noi...
 *  nicio teza dominanta nu are voie sa existe fara alternative explicite...
 *  ipotezele slabe se retrag, intarite cresc... schimbarea ipotezei dominante
 *  trebuie logata si justificata."
 *
 * Distinct from §68 thesisGraphEngine (1 trade evidence DAG), §247
 * preRegistration (hash-locked pre-test), §111 scenarioTreePlanner (FUTURE
 * worlds), §100 narrativeCoherence (1 story), §71 internalDebate (3 voices).
 */

const { db } = require('../../database');

const HYPOTHESIS_KINDS = Object.freeze([
    'continuation', 'distribution',
    'short_covering', 'liquidity_grab', 'macro_override'
]);
const STATUS_VALUES = Object.freeze(['ACTIVE', 'RETIRED', 'DOMINANT']);

const MIN_POSTERIOR_TO_KEEP = 0.05;
const DOMINANCE_THRESHOLD = 0.50;
const MIN_ALTERNATIVES_FOR_DOMINANT = 2;

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`competingHypothesesEngine: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertHypothesis: db.prepare(`
        INSERT INTO ml_hypothesis_registry
        (user_id, resolved_env, hypothesis_id, kind,
         posterior_score, status, invalidation_conditions_json,
         ts_created, ts_last_updated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getHypothesis: db.prepare(`
        SELECT * FROM ml_hypothesis_registry WHERE hypothesis_id = ?
    `),
    listActiveHypotheses: db.prepare(`
        SELECT * FROM ml_hypothesis_registry
        WHERE user_id = ? AND resolved_env = ? AND status != 'RETIRED'
        ORDER BY posterior_score DESC LIMIT ?
    `),
    listActiveHypothesesByKind: db.prepare(`
        SELECT * FROM ml_hypothesis_registry
        WHERE user_id = ? AND resolved_env = ?
          AND status != 'RETIRED' AND kind = ?
        ORDER BY posterior_score DESC LIMIT ?
    `),
    updateHypothesisPosterior: db.prepare(`
        UPDATE ml_hypothesis_registry
        SET posterior_score = ?, ts_last_updated = ?
        WHERE user_id = ? AND resolved_env = ? AND hypothesis_id = ?
    `),
    updateHypothesisStatus: db.prepare(`
        UPDATE ml_hypothesis_registry
        SET status = ?, ts_last_updated = ?
        WHERE user_id = ? AND resolved_env = ? AND hypothesis_id = ?
    `),
    insertTransition: db.prepare(`
        INSERT INTO ml_hypothesis_transitions
        (user_id, resolved_env, transition_id, from_hypothesis_id,
         to_hypothesis_id, evidence_summary,
         posterior_from_before, posterior_from_after,
         posterior_to_before, posterior_to_after,
         amount_transferred, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listTransitions: db.prepare(`
        SELECT * FROM ml_hypothesis_transitions
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC LIMIT ?
    `)
};

// ── evaluateDominance (pure) ───────────────────────────────────────
// Rule §112 line 2962: "nicio teza dominanta fara alternative explicite"
function evaluateDominance(params) {
    const hypotheses = _required(params, 'hypotheses');
    const dominanceThreshold = (params && params.dominanceThreshold !== undefined)
        ? params.dominanceThreshold : DOMINANCE_THRESHOLD;
    const minAlternatives = (params && params.minAlternatives !== undefined)
        ? params.minAlternatives : MIN_ALTERNATIVES_FOR_DOMINANT;

    const active = hypotheses.filter(h => h.status !== 'RETIRED');
    if (active.length < minAlternatives + 1) {
        return {
            dominant: null,
            alternatives: active.map(h => h.hypothesisId),
            reason: 'no_dominant_without_alternatives'
        };
    }
    const sorted = [...active].sort((a, b) => b.posteriorScore - a.posteriorScore);
    const top = sorted[0];
    if (top.posteriorScore < dominanceThreshold) {
        return {
            dominant: null,
            alternatives: active.map(h => h.hypothesisId),
            reason: 'no_hypothesis_above_dominance_threshold'
        };
    }
    return {
        dominant: top.hypothesisId,
        dominantPosterior: top.posteriorScore,
        alternatives: sorted.slice(1).map(h => h.hypothesisId),
        reason: 'dominance_with_alternatives'
    };
}

// ── registerHypothesis ─────────────────────────────────────────────
function registerHypothesis(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const hypothesisId = _required(params, 'hypothesisId');
    const kind = _required(params, 'kind');
    if (!HYPOTHESIS_KINDS.includes(kind)) {
        throw new Error(`competingHypothesesEngine: invalid kind "${kind}"`);
    }
    const initialPosterior = _required(params, 'initialPosterior');
    if (initialPosterior < 0 || initialPosterior > 1) {
        throw new Error('competingHypothesesEngine: initialPosterior must be in [0,1]');
    }
    const invalidationConditions = _required(params, 'invalidationConditions');
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertHypothesis.run(
            userId, env, hypothesisId, kind,
            initialPosterior, 'ACTIVE',
            JSON.stringify(invalidationConditions),
            ts, ts
        );
        return { registered: true, hypothesisId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`competingHypothesesEngine: duplicate hypothesisId "${hypothesisId}"`);
        }
        throw err;
    }
}

// ── transferProbability ────────────────────────────────────────────
function transferProbability(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const transitionId = _required(params, 'transitionId');
    const fromHypothesisId = _required(params, 'fromHypothesisId');
    const toHypothesisId = _required(params, 'toHypothesisId');
    const evidenceSummary = _required(params, 'evidenceSummary');
    const amount = _required(params, 'amount');
    if (amount < 0) {
        throw new Error('competingHypothesesEngine: amount must be >= 0');
    }
    const ts = (params && params.ts) ? params.ts : Date.now();

    const from = _stmts.getHypothesis.get(fromHypothesisId);
    const to = _stmts.getHypothesis.get(toHypothesisId);
    if (!from || !to) {
        throw new Error(
            `competingHypothesesEngine: hypothesis not found ` +
            `(from=${!!from} to=${!!to})`
        );
    }
    if (from.user_id !== userId || from.resolved_env !== env ||
        to.user_id !== userId || to.resolved_env !== env) {
        throw new Error('competingHypothesesEngine: hypothesis not owned by user/env');
    }

    const fromBefore = from.posterior_score;
    const toBefore = to.posterior_score;
    const fromAfter = Math.max(0, fromBefore - amount);
    const toAfter = Math.min(1, toBefore + amount);

    const txn = db.transaction(() => {
        _stmts.updateHypothesisPosterior.run(
            fromAfter, ts, userId, env, fromHypothesisId
        );
        _stmts.updateHypothesisPosterior.run(
            toAfter, ts, userId, env, toHypothesisId
        );
        _stmts.insertTransition.run(
            userId, env, transitionId,
            fromHypothesisId, toHypothesisId, evidenceSummary,
            fromBefore, fromAfter, toBefore, toAfter,
            amount, ts
        );
    });

    try {
        txn();
        return {
            transferred: true, transitionId,
            fromPosteriorBefore: fromBefore,
            fromPosteriorAfter: fromAfter,
            toPosteriorBefore: toBefore,
            toPosteriorAfter: toAfter
        };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `competingHypothesesEngine: duplicate transitionId "${transitionId}"`
            );
        }
        throw err;
    }
}

// ── retireWeakHypothesis ───────────────────────────────────────────
function retireWeakHypothesis(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const hypothesisId = _required(params, 'hypothesisId');
    const reason = _required(params, 'reason');
    const minPosterior = (params && params.minPosterior !== undefined)
        ? params.minPosterior : MIN_POSTERIOR_TO_KEEP;
    const ts = (params && params.ts) ? params.ts : Date.now();

    const h = _stmts.getHypothesis.get(hypothesisId);
    if (!h) {
        throw new Error(
            `competingHypothesesEngine: hypothesis "${hypothesisId}" not found`
        );
    }
    if (h.user_id !== userId || h.resolved_env !== env) {
        throw new Error('competingHypothesesEngine: hypothesis not owned by user/env');
    }
    if (h.posterior_score >= minPosterior) {
        throw new Error(
            `competingHypothesesEngine: hypothesis "${hypothesisId}" posterior ` +
            `${h.posterior_score} >= ${minPosterior} — not eligible for retire`
        );
    }
    _stmts.updateHypothesisStatus.run('RETIRED', ts, userId, env, hypothesisId);
    return { retired: true, hypothesisId, reason, finalPosterior: h.posterior_score };
}

// ── getCompetingHypotheses ─────────────────────────────────────────
function getCompetingHypotheses(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const kindFilter = params && params.kindFilter;
    const limit = (params && params.limit) ? params.limit : 100;

    if (kindFilter && !HYPOTHESIS_KINDS.includes(kindFilter)) {
        throw new Error(`competingHypothesesEngine: invalid kindFilter "${kindFilter}"`);
    }
    const rows = kindFilter
        ? _stmts.listActiveHypothesesByKind.all(userId, env, kindFilter, limit)
        : _stmts.listActiveHypotheses.all(userId, env, limit);
    return rows.map(r => ({
        hypothesisId: r.hypothesis_id,
        kind: r.kind,
        posteriorScore: r.posterior_score,
        status: r.status,
        invalidationConditions: JSON.parse(r.invalidation_conditions_json),
        tsCreated: r.ts_created,
        tsLastUpdated: r.ts_last_updated
    }));
}

// ── getTransitionHistory ───────────────────────────────────────────
function getTransitionHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const limit = (params && params.limit) ? params.limit : 100;

    const rows = _stmts.listTransitions.all(userId, env, limit);
    return rows.map(r => ({
        transitionId: r.transition_id,
        fromHypothesisId: r.from_hypothesis_id,
        toHypothesisId: r.to_hypothesis_id,
        evidenceSummary: r.evidence_summary,
        posteriorFromBefore: r.posterior_from_before,
        posteriorFromAfter: r.posterior_from_after,
        posteriorToBefore: r.posterior_to_before,
        posteriorToAfter: r.posterior_to_after,
        amountTransferred: r.amount_transferred,
        ts: r.ts
    }));
}

module.exports = {
    HYPOTHESIS_KINDS,
    STATUS_VALUES,
    MIN_POSTERIOR_TO_KEEP,
    DOMINANCE_THRESHOLD,
    MIN_ALTERNATIVES_FOR_DOMINANT,
    evaluateDominance,
    registerHypothesis,
    transferProbability,
    retireWeakHypothesis,
    getCompetingHypotheses,
    getTransitionHistory
};
