'use strict';

/**
 * OMEGA R6 ShadowMeta — pluralSelfChamber (canonical §124)
 *
 * §124 PLURAL SELF ARCHITECTURE / RIVAL WORLDVIEW CHAMBER.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 3445-3491.
 *
 * "Critic intern NU e suficient... 'sine-uri' rivale cu worldview-uri
 *  diferite... trend_following / mean_reversion / liquidity_hunt /
 *  macro_dominant / risk_minimalist self... fiecare cu propriile priors /
 *  preferinte de semnal / mod de a povesti piata... rival worldview
 *  scoring... dissent index... 'daca as interpreta piata dintr-o filozofie
 *  complet diferita, ce verdict as obtine?'... sine-urile rivale trebuie
 *  suficient de diferite ONTOLOGIC... dissent mare → size_reduce / WAIT /
 *  active_sensing / observer."
 *
 * Distinct from §71 internalDebate (same ontology, 3 voices), §112
 * competingHypothesesEngine (market explanations), §111 scenarioTreePlanner
 * (future worlds), §48 ensembleVoting (predictions aggregation).
 * §124 = N worldview agents cu ontologii incompatibile.
 */

const { db } = require('../../database');

const WORLDVIEW_KINDS = Object.freeze([
    'trend_following', 'mean_reversion',
    'liquidity_hunt', 'macro_dominant',
    'risk_minimalist', 'custom'
]);
const CONSENSUS_ACTIONS = Object.freeze([
    'proceed', 'reduce_size', 'wait', 'active_sensing', 'observer'
]);

const HIGH_DISSENT_THRESHOLD = 0.30;
const MODERATE_DISSENT_THRESHOLD = 0.15;
const LOW_CONFIDENCE_FLOOR = 0.30;
const MIN_AGENTS_FOR_CHAMBER = 2;

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`pluralSelfChamber: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertAgent: db.prepare(`
        INSERT INTO ml_worldview_agents
        (user_id, resolved_env, agent_id, worldview_kind,
         priors_json, signal_preferences_json, is_active,
         ts_registered, ts_retired)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, NULL)
    `),
    getAgent: db.prepare(`
        SELECT * FROM ml_worldview_agents WHERE agent_id = ?
    `),
    listActiveAgents: db.prepare(`
        SELECT * FROM ml_worldview_agents
        WHERE user_id = ? AND resolved_env = ? AND is_active = 1
        ORDER BY ts_registered DESC LIMIT ?
    `),
    listActiveAgentsByKind: db.prepare(`
        SELECT * FROM ml_worldview_agents
        WHERE user_id = ? AND resolved_env = ?
          AND is_active = 1 AND worldview_kind = ?
        ORDER BY ts_registered DESC LIMIT ?
    `),
    retireAgentStmt: db.prepare(`
        UPDATE ml_worldview_agents
        SET is_active = 0, ts_retired = ?
        WHERE user_id = ? AND resolved_env = ? AND agent_id = ?
    `),
    insertDecision: db.prepare(`
        INSERT INTO ml_plural_decisions
        (user_id, resolved_env, decision_id, market_context_json,
         votes_json, dissent_index, dominant_agent_id,
         consensus_action, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listDecisions: db.prepare(`
        SELECT * FROM ml_plural_decisions
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC LIMIT ?
    `)
};

// ── computeDissentIndex (pure) ─────────────────────────────────────
// stddev of confidence scores, normalized to [0,1]
function computeDissentIndex(params) {
    const votes = _required(params, 'votes');
    if (!Array.isArray(votes) || votes.length < 2) {
        return { dissentIndex: 0, agentCount: votes ? votes.length : 0 };
    }
    const confidences = votes.map(v => {
        if (typeof v.confidence !== 'number') {
            throw new Error('pluralSelfChamber: vote.confidence must be number');
        }
        if (v.confidence < 0 || v.confidence > 1) {
            throw new Error('pluralSelfChamber: vote.confidence must be in [0,1]');
        }
        return v.confidence;
    });
    const mean = confidences.reduce((s, c) => s + c, 0) / confidences.length;
    const variance = confidences.reduce((s, c) => s + (c - mean) ** 2, 0) / confidences.length;
    const stddev = Math.sqrt(Math.max(0, variance));
    // stddev is in [0, 0.5] for confidences in [0,1]; scale to [0,1] then clamp
    const raw = stddev * 2;
    // Snap near-zero artifacts to exact 0 (float precision)
    const dissentIndex = raw < 1e-10 ? 0 : Math.max(0, Math.min(1, raw));
    return { dissentIndex, agentCount: confidences.length, mean, stddev };
}

// ── aggregateConsensus (pure) ──────────────────────────────────────
function aggregateConsensus(params) {
    const votes = _required(params, 'votes');
    const dissentThreshold = (params && params.dissentThreshold !== undefined)
        ? params.dissentThreshold : HIGH_DISSENT_THRESHOLD;
    const moderateThreshold = (params && params.moderateThreshold !== undefined)
        ? params.moderateThreshold : MODERATE_DISSENT_THRESHOLD;
    const lowConfidenceFloor = (params && params.lowConfidenceFloor !== undefined)
        ? params.lowConfidenceFloor : LOW_CONFIDENCE_FLOOR;

    const { dissentIndex } = computeDissentIndex({ votes });
    const anyLowConfidence = votes.some(v => v.confidence < lowConfidenceFloor);

    let action;
    let reason;
    if (dissentIndex >= dissentThreshold) {
        if (anyLowConfidence) {
            action = 'wait';
            reason = 'high_dissent_with_low_confidence_voice';
        } else {
            action = 'reduce_size';
            reason = 'high_dissent_all_moderate';
        }
    } else if (dissentIndex >= moderateThreshold) {
        action = 'active_sensing';
        reason = 'moderate_dissent_needs_more_info';
    } else {
        action = 'proceed';
        reason = 'consensus_low_dissent';
    }
    return { action, dissentIndex, reason };
}

// ── registerWorldviewAgent ─────────────────────────────────────────
function registerWorldviewAgent(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const agentId = _required(params, 'agentId');
    const worldviewKind = _required(params, 'worldviewKind');
    if (!WORLDVIEW_KINDS.includes(worldviewKind)) {
        throw new Error(`pluralSelfChamber: invalid worldviewKind "${worldviewKind}"`);
    }
    const priors = _required(params, 'priors');
    const signalPreferences = _required(params, 'signalPreferences');
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertAgent.run(
            userId, env, agentId, worldviewKind,
            JSON.stringify(priors),
            JSON.stringify(signalPreferences), ts
        );
        return { registered: true, agentId, worldviewKind };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`pluralSelfChamber: duplicate agentId "${agentId}"`);
        }
        throw err;
    }
}

// ── recordPluralDecision ───────────────────────────────────────────
function recordPluralDecision(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const decisionId = _required(params, 'decisionId');
    const marketContext = _required(params, 'marketContext');
    const votes = _required(params, 'votes');
    if (!Array.isArray(votes) || votes.length === 0) {
        throw new Error('pluralSelfChamber: votes must be non-empty array');
    }
    const dominantAgentId = (params && params.dominantAgentId) ? params.dominantAgentId : null;
    const ts = (params && params.ts) ? params.ts : Date.now();

    const { action, dissentIndex } = aggregateConsensus({ votes });

    try {
        _stmts.insertDecision.run(
            userId, env, decisionId,
            JSON.stringify(marketContext),
            JSON.stringify(votes),
            dissentIndex, dominantAgentId, action, ts
        );
        return {
            recorded: true, decisionId,
            dissentIndex, consensusAction: action
        };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`pluralSelfChamber: duplicate decisionId "${decisionId}"`);
        }
        throw err;
    }
}

// ── retireAgent ────────────────────────────────────────────────────
function retireAgent(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const agentId = _required(params, 'agentId');
    const reason = _required(params, 'reason');
    const ts = (params && params.ts) ? params.ts : Date.now();

    const a = _stmts.getAgent.get(agentId);
    if (!a) {
        throw new Error(`pluralSelfChamber: agent "${agentId}" not found`);
    }
    if (a.user_id !== userId || a.resolved_env !== env) {
        throw new Error('pluralSelfChamber: agent not owned by user/env');
    }
    _stmts.retireAgentStmt.run(ts, userId, env, agentId);
    return { retired: true, agentId, reason };
}

// ── getActiveAgents ────────────────────────────────────────────────
function getActiveAgents(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const kindFilter = params && params.kindFilter;
    const limit = (params && params.limit) ? params.limit : 100;

    if (kindFilter && !WORLDVIEW_KINDS.includes(kindFilter)) {
        throw new Error(`pluralSelfChamber: invalid kindFilter "${kindFilter}"`);
    }
    const rows = kindFilter
        ? _stmts.listActiveAgentsByKind.all(userId, env, kindFilter, limit)
        : _stmts.listActiveAgents.all(userId, env, limit);
    return rows.map(r => ({
        agentId: r.agent_id,
        worldviewKind: r.worldview_kind,
        priors: JSON.parse(r.priors_json),
        signalPreferences: JSON.parse(r.signal_preferences_json),
        isActive: !!r.is_active,
        tsRegistered: r.ts_registered,
        tsRetired: r.ts_retired
    }));
}

// ── getDecisionHistory ─────────────────────────────────────────────
function getDecisionHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const limit = (params && params.limit) ? params.limit : 100;

    const rows = _stmts.listDecisions.all(userId, env, limit);
    return rows.map(r => ({
        decisionId: r.decision_id,
        marketContext: JSON.parse(r.market_context_json),
        votes: JSON.parse(r.votes_json),
        dissentIndex: r.dissent_index,
        dominantAgentId: r.dominant_agent_id,
        consensusAction: r.consensus_action,
        ts: r.ts
    }));
}

module.exports = {
    WORLDVIEW_KINDS,
    CONSENSUS_ACTIONS,
    HIGH_DISSENT_THRESHOLD,
    MODERATE_DISSENT_THRESHOLD,
    LOW_CONFIDENCE_FLOOR,
    MIN_AGENTS_FOR_CHAMBER,
    computeDissentIndex,
    aggregateConsensus,
    registerWorldviewAgent,
    recordPluralDecision,
    retireAgent,
    getActiveAgents,
    getDecisionHistory
};
