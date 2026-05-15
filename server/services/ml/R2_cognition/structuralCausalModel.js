'use strict';

/**
 * OMEGA R2 Cognition — structuralCausalModel (canonical §40)
 *
 * §40 CAUZALITATE STRUCTURALĂ — NU CORELAȚIE, CI DE CE SE ÎNTÂMPLĂ.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1518-1519.
 *
 * Replace correlation-based reasoning with explicit causal chains:
 *   DXY spike → presiune risk assets → liquidations → bounce opportunity
 *   funding extrem → squeeze inevitable → directie
 *
 * Robust la distribution shift: correlations break when regime changes,
 * causal mechanisms remain stable. "Bot care funcționează în 2021 și
 * încă funcționează în 2026" vs "bot reantrenat constant".
 */

const { db } = require('../../database');

const CHAIN_STATES = Object.freeze([
    'LATENT', 'TRIGGERED', 'RESOLVED', 'INVALIDATED'
]);

const EDGE_TYPES = Object.freeze([
    'causal',          // strict A → B mechanism
    'correlational',   // A correlates with B (weaker)
    'conditional'      // A → B given conditions C
]);

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`structuralCausalModel: missing ${key}`);
    }
    return params[key];
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertChain: db.prepare(`
        INSERT INTO ml_causal_chains
        (chain_id, name, edges_json, expected_outcome, created_at)
        VALUES (?, ?, ?, ?, ?)
    `),
    getChain: db.prepare(`
        SELECT * FROM ml_causal_chains WHERE chain_id = ?
    `),
    insertObservation: db.prepare(`
        INSERT INTO ml_causal_observations
        (user_id, resolved_env, chain_id, state, trigger_event_json,
         evidence_json, actual_outcome, matched, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateObservationOutcome: db.prepare(`
        UPDATE ml_causal_observations
        SET state = ?, actual_outcome = ?, matched = ?
        WHERE id = ?
    `),
    listActive: db.prepare(`
        SELECT * FROM ml_causal_observations
        WHERE user_id = ? AND resolved_env = ?
          AND state = 'TRIGGERED'
          AND (? = 0 OR created_at >= ?)
        ORDER BY created_at DESC, id DESC
    `),
    latestForChain: db.prepare(`
        SELECT * FROM ml_causal_observations
        WHERE user_id = ? AND resolved_env = ? AND chain_id = ?
        ORDER BY id DESC LIMIT 1
    `),
    countObservations: db.prepare(`
        SELECT state, COUNT(*) AS count FROM ml_causal_observations
        WHERE user_id = ? AND resolved_env = ? AND chain_id = ?
        GROUP BY state
    `)
};

// ── registerChain ──────────────────────────────────────────────────
function registerChain(params) {
    const chainId = _required(params, 'chainId');
    const name = _required(params, 'name');
    const edges = _required(params, 'edges');
    const expectedOutcome = _required(params, 'expectedOutcome');

    _stmts.insertChain.run(
        chainId, name,
        JSON.stringify(edges),
        expectedOutcome, Date.now()
    );

    return { registered: true, chainId };
}

// ── observeTrigger ─────────────────────────────────────────────────
function observeTrigger(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const chainId = _required(params, 'chainId');
    const triggerEvent = _required(params, 'triggerEvent');
    const evidence = _required(params, 'evidence');

    const chain = _stmts.getChain.get(chainId);
    if (!chain) {
        throw new Error(`structuralCausalModel: chain "${chainId}" not registered`);
    }

    _stmts.insertObservation.run(
        userId, env, chainId, 'TRIGGERED',
        JSON.stringify(triggerEvent),
        JSON.stringify(evidence),
        null, null, Date.now()
    );

    return { observed: true };
}

// ── getActiveChains ────────────────────────────────────────────────
function getActiveChains(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const since = (params && params.since) ? params.since : 0;

    const rows = _stmts.listActive.all(
        userId, env,
        since > 0 ? 1 : 0, since
    );

    return rows.map(r => ({
        id: r.id,
        chainId: r.chain_id,
        state: r.state,
        triggerEvent: r.trigger_event_json ? JSON.parse(r.trigger_event_json) : null,
        evidence: r.evidence_json ? JSON.parse(r.evidence_json) : null,
        createdAt: r.created_at
    }));
}

// ── evaluateCausalSignal ───────────────────────────────────────────
function evaluateCausalSignal(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const chainId = _required(params, 'chainId');

    const chain = _stmts.getChain.get(chainId);
    if (!chain) {
        return { strength: 0, predictedOutcome: null, evidenceCount: 0 };
    }

    const counts = _stmts.countObservations.all(userId, env, chainId);
    let triggered = 0;
    let resolved = 0;
    let invalidated = 0;
    for (const c of counts) {
        if (c.state === 'TRIGGERED') triggered = c.count;
        if (c.state === 'RESOLVED') resolved = c.count;
        if (c.state === 'INVALIDATED') invalidated = c.count;
    }

    const total = triggered + resolved + invalidated;
    const successRate = (resolved + invalidated) > 0
        ? resolved / (resolved + invalidated) : 0.5;
    const currentlyTriggered = triggered > 0;

    let strength = 0;
    if (currentlyTriggered) {
        // Strength = base 0.3 for triggered + success rate boost
        strength = 0.3 + successRate * 0.7;
    }

    return {
        strength,
        predictedOutcome: chain.expected_outcome,
        evidenceCount: total,
        currentlyTriggered,
        historicalSuccessRate: successRate
    };
}

// ── recordChainOutcome ─────────────────────────────────────────────
function recordChainOutcome(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const chainId = _required(params, 'chainId');
    const actualOutcome = _required(params, 'actualOutcome');
    const matched = !!params.matched;

    const latest = _stmts.latestForChain.get(userId, env, chainId);
    if (!latest) {
        return { recorded: false, reason: 'no_active_observation' };
    }

    const newState = matched ? 'RESOLVED' : 'INVALIDATED';
    _stmts.updateObservationOutcome.run(
        newState, actualOutcome,
        matched ? 1 : 0, latest.id
    );

    return { recorded: true, state: newState };
}

module.exports = {
    CHAIN_STATES,
    EDGE_TYPES,
    registerChain,
    observeTrigger,
    getActiveChains,
    evaluateCausalSignal,
    recordChainOutcome
};
