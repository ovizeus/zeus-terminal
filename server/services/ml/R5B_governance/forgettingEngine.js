'use strict';

/**
 * OMEGA R5B Governance — forgettingEngine (canonical §97)
 *
 * §97 KNOWLEDGE EXPIRY / FORGETTING ENGINE.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 2471-2520.
 *
 * "Memoria fara uitare devine rigiditate... TTL pentru heuristici, praguri,
 *  analogii episodice, priors, relatii cauzale slabe, execution rules...
 *  freshness score... decay bazat pe vechime, crowding, drift, edge decay,
 *  relevanta recenta... weaken / quarantine / retire / revive on evidence...
 *  uitarea NU este stergere haotica... orice cunostinta retrasa explicabila
 *  si eventual restaurata."
 *
 * R5B governance lifecycle. Distinct from §94 complexityBudget (MDL pruning),
 * §90 goodhart (gaming defense), §254 autoQuarantine (failure-based).
 */

const { db } = require('../../database');

const KNOWLEDGE_KINDS = Object.freeze([
    'heuristic', 'threshold', 'episodic_analogy',
    'prior', 'causal_relation', 'execution_rule'
]);
const ITEM_STATUSES = Object.freeze([
    'ACTIVE', 'WEAKENED', 'QUARANTINED', 'RETIRED', 'REVIVED'
]);
const FORGETTING_ACTIONS = Object.freeze([
    'WEAKEN', 'QUARANTINE', 'RETIRE', 'REVIVE'
]);

const DEFAULT_FRESHNESS_THRESHOLDS = Object.freeze({
    WEAKEN: 0.70, QUARANTINE: 0.40, RETIRE: 0.15
});
const DEFAULT_DECAY_WEIGHTS = Object.freeze({
    age: 0.4, crowding: 0.2, drift: 0.2, edgeDecay: 0.1, recency: 0.1
});
const DEFAULT_HALFLIFE_DAYS = 30;
const DAY_MS = 86400000;

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`forgettingEngine: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertItem: db.prepare(`
        INSERT INTO ml_knowledge_items
        (user_id, resolved_env, item_id, kind, content_json,
         freshness_score, status,
         ts_created, ts_last_relevance, ts_status_changed)
        VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)
    `),
    getItem: db.prepare(`
        SELECT * FROM ml_knowledge_items WHERE item_id = ?
    `),
    listItems: db.prepare(`
        SELECT * FROM ml_knowledge_items
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts_created DESC LIMIT ?
    `),
    listNonRetired: db.prepare(`
        SELECT * FROM ml_knowledge_items
        WHERE user_id = ? AND resolved_env = ? AND status != 'RETIRED'
        ORDER BY ts_created DESC LIMIT ?
    `),
    updateItemStatus: db.prepare(`
        UPDATE ml_knowledge_items
        SET status = ?, freshness_score = ?, ts_status_changed = ?
        WHERE user_id = ? AND resolved_env = ? AND item_id = ?
    `),
    bumpRelevance: db.prepare(`
        UPDATE ml_knowledge_items
        SET ts_last_relevance = ?
        WHERE user_id = ? AND resolved_env = ? AND item_id = ?
    `),
    insertDecision: db.prepare(`
        INSERT INTO ml_forgetting_decisions
        (user_id, resolved_env, decision_id, item_id, action,
         prior_status, new_status, reason, evidence_json, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
};

// ── computeFreshnessScore (pure) ───────────────────────────────────
function computeFreshnessScore(params) {
    const ageDays = _required(params, 'ageDays');
    const crowding = (params && params.crowding !== undefined) ? params.crowding : 0;
    const drift = (params && params.drift !== undefined) ? params.drift : 0;
    const edgeDecay = (params && params.edgeDecay !== undefined) ? params.edgeDecay : 0;
    const recencyHits = (params && params.recencyHits !== undefined) ? params.recencyHits : 0;
    const recencyNorm = Math.min(1, recencyHits / 10);   // 10+ hits = full
    const weights = (params && params.weights) ? params.weights : DEFAULT_DECAY_WEIGHTS;
    const halfLifeDays = (params && params.halfLifeDays !== undefined)
        ? params.halfLifeDays : DEFAULT_HALFLIFE_DAYS;

    const ageFactor = Math.exp(-Math.max(0, ageDays) / halfLifeDays);
    const score =
        weights.age       * ageFactor +
        weights.crowding  * (1 - Math.min(1, Math.max(0, crowding))) +
        weights.drift     * (1 - Math.min(1, Math.max(0, drift))) +
        weights.edgeDecay * (1 - Math.min(1, Math.max(0, edgeDecay))) +
        weights.recency   * recencyNorm;

    return {
        freshness: Math.min(1, Math.max(0, score)),
        ageFactor,
        recencyNorm
    };
}

// ── registerKnowledgeItem ──────────────────────────────────────────
function registerKnowledgeItem(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const itemId = _required(params, 'itemId');
    const kind = _required(params, 'kind');
    if (!KNOWLEDGE_KINDS.includes(kind)) {
        throw new Error(`forgettingEngine: invalid kind "${kind}"`);
    }
    const content = _required(params, 'content');
    const initialFreshness = (params && params.initialFreshness !== undefined)
        ? params.initialFreshness : 1.0;
    if (initialFreshness < 0 || initialFreshness > 1) {
        throw new Error('forgettingEngine: initialFreshness must be in [0,1]');
    }
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertItem.run(
            userId, env, itemId, kind,
            JSON.stringify(content), initialFreshness, ts, ts, ts
        );
        return { registered: true, itemId, status: 'ACTIVE' };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`forgettingEngine: duplicate itemId "${itemId}"`);
        }
        throw err;
    }
}

// ── recordRelevanceEvent ───────────────────────────────────────────
function recordRelevanceEvent(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const itemId = _required(params, 'itemId');
    const ts = (params && params.ts) ? params.ts : Date.now();

    const item = _stmts.getItem.get(itemId);
    if (!item) {
        throw new Error(`forgettingEngine: item "${itemId}" not found`);
    }
    if (item.user_id !== userId || item.resolved_env !== env) {
        throw new Error('forgettingEngine: item not owned by user/env');
    }
    _stmts.bumpRelevance.run(ts, userId, env, itemId);
    return { recorded: true, itemId, ts };
}

// ── evaluateAndDecide ──────────────────────────────────────────────
function evaluateAndDecide(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const itemId = _required(params, 'itemId');
    const thresholds = (params && params.freshnessThresholds)
        ? params.freshnessThresholds : DEFAULT_FRESHNESS_THRESHOLDS;
    const decayInputs = (params && params.decayInputs) ? params.decayInputs : {};
    const now = (params && params.ts) ? params.ts : Date.now();

    const item = _stmts.getItem.get(itemId);
    if (!item) {
        throw new Error(`forgettingEngine: item "${itemId}" not found`);
    }
    if (item.user_id !== userId || item.resolved_env !== env) {
        throw new Error('forgettingEngine: item not owned by user/env');
    }

    const ageDays = (now - item.ts_created) / DAY_MS;
    const result = computeFreshnessScore({ ageDays, ...decayInputs });
    const freshness = result.freshness;

    let recommendedAction;
    if (freshness < thresholds.RETIRE) recommendedAction = 'RETIRE';
    else if (freshness < thresholds.QUARANTINE) recommendedAction = 'QUARANTINE';
    else if (freshness < thresholds.WEAKEN) recommendedAction = 'WEAKEN';
    else recommendedAction = null;   // ACTIVE — no action

    return {
        itemId, freshness,
        recommendedAction,
        currentStatus: item.status,
        ageDays
    };
}

// ── applyForgettingAction ──────────────────────────────────────────
function applyForgettingAction(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const decisionId = _required(params, 'decisionId');
    const itemId = _required(params, 'itemId');
    const action = _required(params, 'action');
    if (!FORGETTING_ACTIONS.includes(action)) {
        throw new Error(`forgettingEngine: invalid action "${action}"`);
    }
    const reason = _required(params, 'reason');
    const evidence = (params && params.evidence) ? params.evidence : null;
    const ts = (params && params.ts) ? params.ts : Date.now();

    const item = _stmts.getItem.get(itemId);
    if (!item) {
        throw new Error(`forgettingEngine: item "${itemId}" not found`);
    }
    if (item.user_id !== userId || item.resolved_env !== env) {
        throw new Error('forgettingEngine: item not owned by user/env');
    }

    const ACTION_TO_STATUS = {
        WEAKEN: 'WEAKENED',
        QUARANTINE: 'QUARANTINED',
        RETIRE: 'RETIRED',
        REVIVE: 'REVIVED'
    };
    const newStatus = ACTION_TO_STATUS[action];

    let newFreshness = item.freshness_score;
    if (action === 'REVIVE') newFreshness = 1.0;
    else if (action === 'WEAKEN') newFreshness = Math.min(item.freshness_score, 0.6);
    else if (action === 'QUARANTINE') newFreshness = Math.min(item.freshness_score, 0.3);
    else if (action === 'RETIRE') newFreshness = 0;

    const txn = db.transaction(() => {
        _stmts.updateItemStatus.run(
            newStatus, newFreshness, ts, userId, env, itemId
        );
        _stmts.insertDecision.run(
            userId, env, decisionId, itemId, action,
            item.status, newStatus, reason,
            evidence ? JSON.stringify(evidence) : null, ts
        );
    });

    try {
        txn();
        return {
            applied: true, decisionId, itemId, action,
            priorStatus: item.status, newStatus, freshness: newFreshness
        };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`forgettingEngine: duplicate decisionId "${decisionId}"`);
        }
        throw err;
    }
}

// ── getKnowledgeAudit ──────────────────────────────────────────────
function getKnowledgeAudit(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const includeRetired = !!(params && params.includeRetired);
    const limit = (params && params.limit) ? params.limit : 100;

    const rows = includeRetired
        ? _stmts.listItems.all(userId, env, limit)
        : _stmts.listNonRetired.all(userId, env, limit);
    return rows.map(r => ({
        itemId: r.item_id,
        kind: r.kind,
        content: JSON.parse(r.content_json),
        freshnessScore: r.freshness_score,
        status: r.status,
        tsCreated: r.ts_created,
        tsLastRelevance: r.ts_last_relevance,
        tsStatusChanged: r.ts_status_changed
    }));
}

module.exports = {
    KNOWLEDGE_KINDS,
    ITEM_STATUSES,
    FORGETTING_ACTIONS,
    DEFAULT_FRESHNESS_THRESHOLDS,
    DEFAULT_DECAY_WEIGHTS,
    DEFAULT_HALFLIFE_DAYS,
    computeFreshnessScore,
    registerKnowledgeItem,
    recordRelevanceEvent,
    evaluateAndDecide,
    applyForgettingAction,
    getKnowledgeAudit
};
