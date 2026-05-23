'use strict';

/**
 * OMEGA _meta — selfModel (canonical §122)
 *
 * §122 SELF-MODEL / INTROSPECTIVE CAPABILITY GRAPH.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 3350-3398.
 *
 * "Botul trebuie sa aiba un model explicit despre sine: nu doar despre
 *  piata, ci despre propriile sale capacitati, limite si stari interne...
 *  capability graph pentru: detectoare/scorere/policy modules/execution
 *  modules/memory & learning modules/safety modules... trust score per
 *  modul intern... health × reliability × recency... self-capability state:
 *  strong/degraded/uncertain/unavailable... 'pot sa am incredere in mine
 *  insumi acum?'... separare: competenta pe piata vs competenta proprie...
 *  modulele cu self-trust scazut trebuie sa aiba influenta redusa."
 *
 * Distinct from §106 competenceMap (R5B — market validity), §35 monitoring
 * (cross-cutting — raw KPI), §98 dependencyGraphBlastRadius (R3A —
 * topology), §38 intelligenceChecker (_meta — per-decision eval).
 * §122 = module-level introspection graph.
 */

const { db } = require('../../database');

const MODULE_KINDS = Object.freeze([
    'detector', 'scorer', 'policy',
    'execution', 'memory_learning', 'safety'
]);
const CAPABILITY_STATES = Object.freeze([
    'strong', 'degraded', 'uncertain', 'unavailable'
]);

const STRONG_THRESHOLD = 0.80;
const DEGRADED_THRESHOLD = 0.50;
const UNCERTAIN_THRESHOLD = 0.30;

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`selfModel: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertCapability: db.prepare(`
        INSERT INTO ml_self_capability_graph
        (user_id, resolved_env, capability_id, module_id, module_kind,
         health, reliability, recency, trust_score, state,
         ts_last_assessed, ts_created)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listCapabilities: db.prepare(`
        SELECT * FROM ml_self_capability_graph
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts_last_assessed DESC LIMIT ?
    `),
    listByState: db.prepare(`
        SELECT * FROM ml_self_capability_graph
        WHERE user_id = ? AND resolved_env = ? AND state = ?
        ORDER BY ts_last_assessed DESC LIMIT ?
    `),
    listByKind: db.prepare(`
        SELECT * FROM ml_self_capability_graph
        WHERE user_id = ? AND resolved_env = ? AND module_kind = ?
        ORDER BY ts_last_assessed DESC LIMIT ?
    `),
    listByStateAndKind: db.prepare(`
        SELECT * FROM ml_self_capability_graph
        WHERE user_id = ? AND resolved_env = ?
          AND state = ? AND module_kind = ?
        ORDER BY ts_last_assessed DESC LIMIT ?
    `),
    insertSummary: db.prepare(`
        INSERT INTO ml_introspective_summaries
        (user_id, resolved_env, summary_id, decision_id,
         modules_relied_on_json, self_trust_aggregate,
         confidence_modifier, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listSummaries: db.prepare(`
        SELECT * FROM ml_introspective_summaries
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC LIMIT ?
    `)
};

// ── computeTrustScore (pure) ───────────────────────────────────────
function computeTrustScore(params) {
    const health = _required(params, 'health');
    const reliability = _required(params, 'reliability');
    const recency = _required(params, 'recency');
    for (const [k, v] of [['health', health], ['reliability', reliability],
                           ['recency', recency]]) {
        if (v < 0 || v > 1) {
            throw new Error(`selfModel: ${k} must be in [0,1]`);
        }
    }
    const weights = (params && params.weights) ? params.weights
        : { health: 1, reliability: 1, recency: 1 };
    const sum = weights.health + weights.reliability + weights.recency;
    const trust = (weights.health * health + weights.reliability * reliability
                 + weights.recency * recency) / sum;
    return {
        trustScore: Math.max(0, Math.min(1, trust)),
        health, reliability, recency
    };
}

// ── classifyCapabilityState (pure) ─────────────────────────────────
function classifyCapabilityState(params) {
    const trustScore = _required(params, 'trustScore');
    const strongT = (params && params.strongThreshold !== undefined)
        ? params.strongThreshold : STRONG_THRESHOLD;
    const degradedT = (params && params.degradedThreshold !== undefined)
        ? params.degradedThreshold : DEGRADED_THRESHOLD;
    const uncertainT = (params && params.uncertainThreshold !== undefined)
        ? params.uncertainThreshold : UNCERTAIN_THRESHOLD;

    let state;
    if (trustScore >= strongT) state = 'strong';
    else if (trustScore >= degradedT) state = 'degraded';
    else if (trustScore >= uncertainT) state = 'uncertain';
    else state = 'unavailable';
    return { state, trustScore };
}

// ── assessModuleCapability ─────────────────────────────────────────
function assessModuleCapability(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const capabilityId = _required(params, 'capabilityId');
    const moduleId = _required(params, 'moduleId');
    const moduleKind = _required(params, 'moduleKind');
    if (!MODULE_KINDS.includes(moduleKind)) {
        throw new Error(`selfModel: invalid moduleKind "${moduleKind}"`);
    }
    const ts = (params && params.ts) ? params.ts : Date.now();

    const { trustScore } = computeTrustScore(params);
    const { state } = classifyCapabilityState({ trustScore });

    try {
        _stmts.insertCapability.run(
            userId, env, capabilityId, moduleId, moduleKind,
            params.health, params.reliability, params.recency,
            trustScore, state, ts, ts
        );
        return {
            assessed: true, capabilityId,
            trustScore, state, moduleKind
        };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`selfModel: duplicate capabilityId "${capabilityId}"`);
        }
        throw err;
    }
}

// ── recordIntrospectiveSummary ─────────────────────────────────────
function recordIntrospectiveSummary(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const summaryId = _required(params, 'summaryId');
    const decisionId = _required(params, 'decisionId');
    const modulesReliedOn = _required(params, 'modulesReliedOn');
    if (!Array.isArray(modulesReliedOn) || modulesReliedOn.length === 0) {
        throw new Error('selfModel: modulesReliedOn must be non-empty array');
    }
    const selfTrustAggregate = _required(params, 'selfTrustAggregate');
    if (selfTrustAggregate < 0 || selfTrustAggregate > 1) {
        throw new Error('selfModel: selfTrustAggregate must be in [0,1]');
    }
    const ts = (params && params.ts) ? params.ts : Date.now();

    // confidence_modifier = avg of trustScores of relied-on modules
    const sum = modulesReliedOn.reduce((s, m) => s + (m.trustScore || 0), 0);
    const confidenceModifier = Math.max(0, Math.min(1,
        sum / modulesReliedOn.length));

    try {
        _stmts.insertSummary.run(
            userId, env, summaryId, decisionId,
            JSON.stringify(modulesReliedOn),
            selfTrustAggregate, confidenceModifier, ts
        );
        return {
            recorded: true, summaryId,
            confidenceModifier
        };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`selfModel: duplicate summaryId "${summaryId}"`);
        }
        throw err;
    }
}

// ── getCapabilityGraph ─────────────────────────────────────────────
function getCapabilityGraph(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const stateFilter = params && params.stateFilter;
    const kindFilter = params && params.kindFilter;
    const limit = (params && params.limit) ? params.limit : 100;

    if (stateFilter && !CAPABILITY_STATES.includes(stateFilter)) {
        throw new Error(`selfModel: invalid stateFilter "${stateFilter}"`);
    }
    if (kindFilter && !MODULE_KINDS.includes(kindFilter)) {
        throw new Error(`selfModel: invalid kindFilter "${kindFilter}"`);
    }

    let rows;
    if (stateFilter && kindFilter) {
        rows = _stmts.listByStateAndKind.all(
            userId, env, stateFilter, kindFilter, limit
        );
    } else if (stateFilter) {
        rows = _stmts.listByState.all(userId, env, stateFilter, limit);
    } else if (kindFilter) {
        rows = _stmts.listByKind.all(userId, env, kindFilter, limit);
    } else {
        rows = _stmts.listCapabilities.all(userId, env, limit);
    }
    return rows.map(r => ({
        capabilityId: r.capability_id,
        moduleId: r.module_id,
        moduleKind: r.module_kind,
        health: r.health, reliability: r.reliability, recency: r.recency,
        trustScore: r.trust_score, state: r.state,
        tsLastAssessed: r.ts_last_assessed, tsCreated: r.ts_created
    }));
}

// ── getIntrospectionHistory ────────────────────────────────────────
function getIntrospectionHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const limit = (params && params.limit) ? params.limit : 100;

    const rows = _stmts.listSummaries.all(userId, env, limit);
    return rows.map(r => ({
        summaryId: r.summary_id,
        decisionId: r.decision_id,
        modulesReliedOn: JSON.parse(r.modules_relied_on_json),
        selfTrustAggregate: r.self_trust_aggregate,
        confidenceModifier: r.confidence_modifier,
        ts: r.ts
    }));
}

module.exports = {
    MODULE_KINDS,
    CAPABILITY_STATES,
    STRONG_THRESHOLD,
    DEGRADED_THRESHOLD,
    UNCERTAIN_THRESHOLD,
    computeTrustScore,
    classifyCapabilityState,
    assessModuleCapability,
    recordIntrospectiveSummary,
    getCapabilityGraph,
    getIntrospectionHistory
};
