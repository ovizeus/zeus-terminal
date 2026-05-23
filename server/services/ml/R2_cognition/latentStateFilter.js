'use strict';

/**
 * OMEGA R2 Cognition — latentStateFilter (canonical §105)
 *
 * §105 LATENT STATE ESTIMATION / BELIEF STATE FILTER.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 2628-2671.
 *
 * "Nu tot ce conteaza este observabil direct... actualizare continua a
 *  belief-urilor despre latent inventory pressure / hidden liquidity
 *  withdrawal / crowd fragility / squeeze pressure / regime transition /
 *  forced flow probability... separare intre observatie directa / inferenta /
 *  ipoteza slaba / ipoteza puternica... belief-uri probabilistice NU fapte...
 *  NU au voie sa bata singure veto-urile dure."
 *
 * R2 cognition. Distinct from §24 detectorRegistry (observable detectors),
 * §15 confidenceDecay (time-aware), §100 narrativeCoherence (story-level).
 * §105 = explicit Bayesian belief tracking over unobservables.
 */

const { db } = require('../../database');

const LATENT_KINDS = Object.freeze([
    'inventory_pressure', 'liquidity_withdrawal', 'crowd_fragility',
    'squeeze_pressure', 'regime_transition', 'forced_flow'
]);
const INFERENCE_TIERS = Object.freeze([
    'direct_observation', 'inference', 'weak_hypothesis', 'strong_hypothesis'
]);

const TIER_TRUST_PRIOR = Object.freeze({
    direct_observation: 0.95,
    strong_hypothesis: 0.70,
    inference: 0.55,
    weak_hypothesis: 0.30
});

const DEFAULT_MIN_CONFIDENCE = 0.30;
const HARD_VETO_CONFIDENCE_FLOOR = 0.90;

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`latentStateFilter: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertState: db.prepare(`
        INSERT INTO ml_latent_states
        (user_id, resolved_env, state_id, kind, belief_value,
         confidence, inference_tier, supporting_sources_json, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getState: db.prepare(`
        SELECT * FROM ml_latent_states WHERE state_id = ?
    `),
    listActiveBeliefs: db.prepare(`
        SELECT * FROM ml_latent_states
        WHERE user_id = ? AND resolved_env = ? AND confidence >= ?
        ORDER BY ts DESC LIMIT ?
    `),
    listActiveBeliefsByKind: db.prepare(`
        SELECT * FROM ml_latent_states
        WHERE user_id = ? AND resolved_env = ?
          AND kind = ? AND confidence >= ?
        ORDER BY ts DESC LIMIT ?
    `),
    updateStateBelief: db.prepare(`
        UPDATE ml_latent_states
        SET belief_value = ?, confidence = ?, ts = ?
        WHERE user_id = ? AND resolved_env = ? AND state_id = ?
    `),
    insertUpdate: db.prepare(`
        INSERT INTO ml_belief_updates
        (user_id, resolved_env, update_id, state_id,
         prior_belief, posterior_belief, likelihood,
         evidence_json, delta, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listUpdates: db.prepare(`
        SELECT * FROM ml_belief_updates
        WHERE user_id = ? AND resolved_env = ? AND state_id = ?
        ORDER BY ts DESC LIMIT ?
    `)
};

// ── computeBayesianPosterior (pure) ────────────────────────────────
// posterior = (likelihood × prior) / (likelihood × prior + (1−likelihood) × (1−prior))
function computeBayesianPosterior(params) {
    const prior = _required(params, 'prior');
    const likelihood = _required(params, 'likelihood');
    if (prior < 0 || prior > 1) {
        throw new Error('latentStateFilter: prior must be in [0,1]');
    }
    if (likelihood < 0 || likelihood > 1) {
        throw new Error('latentStateFilter: likelihood must be in [0,1]');
    }
    const numerator = likelihood * prior;
    const denominator = likelihood * prior + (1 - likelihood) * (1 - prior);
    if (denominator === 0) {
        return { posterior: prior, denominator: 0 };
    }
    const posterior = numerator / denominator;
    return {
        posterior: Math.max(0, Math.min(1, posterior)),
        numerator, denominator
    };
}

// ── canVetoHardConstraint (pure) ───────────────────────────────────
// Rule §105 line 2667: belief-urile latente NU au voie sa bata singure
// veto-urile dure. Only direct_observation with very high confidence may.
function canVetoHardConstraint(params) {
    const inferenceTier = _required(params, 'inferenceTier');
    const confidence = _required(params, 'confidence');
    if (!INFERENCE_TIERS.includes(inferenceTier)) {
        throw new Error(`latentStateFilter: invalid inferenceTier "${inferenceTier}"`);
    }
    if (confidence < 0 || confidence > 1) {
        throw new Error('latentStateFilter: confidence must be in [0,1]');
    }
    const allowed =
        inferenceTier === 'direct_observation' &&
        confidence >= HARD_VETO_CONFIDENCE_FLOOR;
    return {
        canVeto: allowed,
        reason: allowed
            ? 'direct_observation_with_floor_confidence'
            : 'latent_belief_cannot_veto_alone'
    };
}

// ── registerLatentState ────────────────────────────────────────────
function registerLatentState(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const stateId = _required(params, 'stateId');
    const kind = _required(params, 'kind');
    if (!LATENT_KINDS.includes(kind)) {
        throw new Error(`latentStateFilter: invalid kind "${kind}"`);
    }
    const initialBelief = _required(params, 'initialBelief');
    if (initialBelief < 0 || initialBelief > 1) {
        throw new Error('latentStateFilter: initialBelief must be in [0,1]');
    }
    const confidence = _required(params, 'confidence');
    if (confidence < 0 || confidence > 1) {
        throw new Error('latentStateFilter: confidence must be in [0,1]');
    }
    const inferenceTier = _required(params, 'inferenceTier');
    if (!INFERENCE_TIERS.includes(inferenceTier)) {
        throw new Error(`latentStateFilter: invalid inferenceTier "${inferenceTier}"`);
    }
    const supportingSources = (params && params.supportingSources)
        ? JSON.stringify(params.supportingSources) : null;
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertState.run(
            userId, env, stateId, kind, initialBelief, confidence,
            inferenceTier, supportingSources, ts
        );
        return { registered: true, stateId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`latentStateFilter: duplicate stateId "${stateId}"`);
        }
        throw err;
    }
}

// ── updateBelief ───────────────────────────────────────────────────
function updateBelief(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const updateId = _required(params, 'updateId');
    const stateId = _required(params, 'stateId');
    const likelihood = _required(params, 'likelihood');
    if (likelihood < 0 || likelihood > 1) {
        throw new Error('latentStateFilter: likelihood must be in [0,1]');
    }
    const evidenceContext = (params && params.evidenceContext)
        ? JSON.stringify(params.evidenceContext) : null;
    const ts = (params && params.ts) ? params.ts : Date.now();

    const state = _stmts.getState.get(stateId);
    if (!state) {
        throw new Error(`latentStateFilter: state "${stateId}" not found`);
    }
    if (state.user_id !== userId || state.resolved_env !== env) {
        throw new Error('latentStateFilter: state not owned by user/env');
    }
    const prior = state.belief_value;
    const result = computeBayesianPosterior({ prior, likelihood });
    const posterior = result.posterior;
    const delta = posterior - prior;

    // confidence increases when likelihood updates push toward extremes
    const newConfidence = Math.min(1, state.confidence + Math.abs(delta) * 0.5);

    try {
        _stmts.insertUpdate.run(
            userId, env, updateId, stateId,
            prior, posterior, likelihood,
            evidenceContext, delta, ts
        );
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`latentStateFilter: duplicate updateId "${updateId}"`);
        }
        throw err;
    }
    _stmts.updateStateBelief.run(
        posterior, newConfidence, ts, userId, env, stateId
    );

    return {
        updated: true, updateId, stateId,
        prior, posterior, delta, newConfidence
    };
}

// ── getActiveBeliefs ───────────────────────────────────────────────
function getActiveBeliefs(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const kind = params && params.kind;
    const minConfidence = (params && params.minConfidence !== undefined)
        ? params.minConfidence : DEFAULT_MIN_CONFIDENCE;
    const limit = (params && params.limit) ? params.limit : 100;

    if (kind && !LATENT_KINDS.includes(kind)) {
        throw new Error(`latentStateFilter: invalid kind "${kind}"`);
    }
    const rows = kind
        ? _stmts.listActiveBeliefsByKind.all(userId, env, kind, minConfidence, limit)
        : _stmts.listActiveBeliefs.all(userId, env, minConfidence, limit);
    return rows.map(r => ({
        stateId: r.state_id,
        kind: r.kind,
        beliefValue: r.belief_value,
        confidence: r.confidence,
        inferenceTier: r.inference_tier,
        supportingSources: r.supporting_sources_json
            ? JSON.parse(r.supporting_sources_json) : null,
        ts: r.ts
    }));
}

// ── getBeliefHistory ───────────────────────────────────────────────
function getBeliefHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const stateId = _required(params, 'stateId');
    const limit = (params && params.limit) ? params.limit : 100;

    const rows = _stmts.listUpdates.all(userId, env, stateId, limit);
    return rows.map(r => ({
        updateId: r.update_id,
        stateId: r.state_id,
        priorBelief: r.prior_belief,
        posteriorBelief: r.posterior_belief,
        likelihood: r.likelihood,
        delta: r.delta,
        ts: r.ts
    }));
}

module.exports = {
    LATENT_KINDS,
    INFERENCE_TIERS,
    TIER_TRUST_PRIOR,
    DEFAULT_MIN_CONFIDENCE,
    HARD_VETO_CONFIDENCE_FLOOR,
    computeBayesianPosterior,
    canVetoHardConstraint,
    registerLatentState,
    updateBelief,
    getActiveBeliefs,
    getBeliefHistory
};
