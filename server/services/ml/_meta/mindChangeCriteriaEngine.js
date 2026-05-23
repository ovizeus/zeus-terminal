'use strict';

/**
 * OMEGA _meta — mindChangeCriteriaEngine (canonical §130)
 *
 * §130 MIND-CHANGE CRITERIA ENGINE / WHAT-WOULD-CONVINCE-ME LAYER.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 3761-3791.
 *
 * "Nu este suficient ca botul sa aiba o opinie. Trebuie sa poata spune
 *  explicit ce dovada i-ar schimba opinia... 'ce anume m-ar convinge ca
 *  ma insel?'... mind-change criteria per teza/regim/worldview + evidence
 *  thresholds pentru weakening/flipping/abandoning/escalating + belief
 *  reversal map + surprise threshold + inertia vs reversibility balance...
 *  previne credintele lipicioase + face schimbarea de opinie disciplinata
 *  nu arbitrara."
 *
 * Distinct from §247 preRegistration (locks WHAT you believe via hash;
 * §130 = pre-locks REVERSAL conditions), §113 socraticSelfDoubt
 * (adversarial counterfactual generation; §130 = static pre-committed
 * criteria), §112 competingHypothesesEngine (thesis market), §129
 * assumptionSurfaceMapper (premise registry). §130 = pre-commitment
 * la condițiile de revizuire a credinței.
 */

const { db } = require('../../database');

const REVERSAL_ACTIONS = Object.freeze([
    'weakening', 'flipping', 'abandoning', 'escalating'
]);
const SURPRISE_THRESHOLD = 0.70;
const INERTIA_LEVELS = Object.freeze(['volatile', 'balanced', 'rigid']);
const INERTIA_THRESHOLDS = Object.freeze({
    volatile: 0.30,
    rigid: 0.70
});

const _EPSILON = 1e-6;

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`mindChangeCriteriaEngine: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertCriterion: db.prepare(`
        INSERT INTO ml_mind_change_criteria
        (user_id, resolved_env, criterion_id, belief_id,
         reversal_action, trigger_condition, evidence_threshold,
         inertia_factor, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertEvent: db.prepare(`
        INSERT INTO ml_mind_change_events
        (user_id, resolved_env, event_id, criterion_id,
         actual_evidence, surprise_score, reversal_executed, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    fetchCriterion: db.prepare(`
        SELECT * FROM ml_mind_change_criteria
        WHERE user_id = ? AND resolved_env = ? AND criterion_id = ?
    `),
    listByBelief: db.prepare(`
        SELECT * FROM ml_mind_change_criteria
        WHERE user_id = ? AND resolved_env = ? AND belief_id = ?
        ORDER BY ts ASC
    `),
    listEvents: db.prepare(`
        SELECT * FROM ml_mind_change_events
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC LIMIT ?
    `),
    listEventsByCriterion: db.prepare(`
        SELECT * FROM ml_mind_change_events
        WHERE user_id = ? AND resolved_env = ? AND criterion_id = ?
        ORDER BY ts DESC LIMIT ?
    `)
};

// ── computeSurpriseScore (pure) ────────────────────────────────────
// (actual − threshold) / max(threshold, ε), clamped [0,1]
function computeSurpriseScore(params) {
    const actual = _required(params, 'actualEvidence');
    const threshold = _required(params, 'evidenceThreshold');
    if (actual < 0 || threshold < 0 || threshold > 1) {
        throw new Error('mindChangeCriteriaEngine: invalid evidence range');
    }
    if (actual <= threshold) return { surpriseScore: 0 };
    const denom = Math.max(threshold, _EPSILON);
    const raw = (actual - threshold) / denom;
    return { surpriseScore: Math.max(0, Math.min(1, raw)) };
}

// ── shouldExecuteReversal (pure) ───────────────────────────────────
// reverse if actual ≥ threshold × (1 + inertia)
function shouldExecuteReversal(params) {
    const actual = _required(params, 'actualEvidence');
    const threshold = _required(params, 'evidenceThreshold');
    const inertia = _required(params, 'inertiaFactor');
    if (actual < 0) {
        throw new Error('mindChangeCriteriaEngine: actualEvidence must be ≥ 0');
    }
    if (threshold < 0 || threshold > 1) {
        throw new Error('mindChangeCriteriaEngine: evidenceThreshold must be in [0,1]');
    }
    if (inertia < 0 || inertia > 1) {
        throw new Error('mindChangeCriteriaEngine: inertiaFactor must be in [0,1]');
    }
    const effective = threshold * (1 + inertia);
    return { shouldReverse: actual >= effective, effectiveThreshold: effective };
}

// ── classifyInertia (pure) ─────────────────────────────────────────
function classifyInertia(params) {
    const inertia = _required(params, 'inertiaFactor');
    if (inertia < 0 || inertia > 1) {
        throw new Error('mindChangeCriteriaEngine: inertiaFactor must be in [0,1]');
    }
    let level;
    if (inertia < INERTIA_THRESHOLDS.volatile) level = 'volatile';
    else if (inertia <= INERTIA_THRESHOLDS.rigid) level = 'balanced';
    else level = 'rigid';
    return { inertiaLevel: level, inertiaFactor: inertia };
}

// ── determineNextAction (pure) ─────────────────────────────────────
// High surprise (≥ SURPRISE_THRESHOLD) escalates one level on the ladder
// weakening → flipping → abandoning (terminal). 'escalating' is a special
// signal preserved as-is (operator-bound).
const _ESCALATION_LADDER = Object.freeze({
    weakening: 'flipping',
    flipping: 'abandoning',
    abandoning: 'abandoning'   // terminal
});

function determineNextAction(params) {
    const action = _required(params, 'reversalAction');
    const surprise = _required(params, 'surpriseScore');
    if (!REVERSAL_ACTIONS.includes(action)) {
        throw new Error(
            `mindChangeCriteriaEngine: invalid reversalAction "${action}"`
        );
    }
    if (surprise < 0 || surprise > 1) {
        throw new Error('mindChangeCriteriaEngine: surpriseScore must be in [0,1]');
    }
    if (action === 'escalating') {
        return { nextAction: 'escalating', escalated: false };
    }
    if (surprise >= SURPRISE_THRESHOLD &&
        _ESCALATION_LADDER[action] !== action) {
        return { nextAction: _ESCALATION_LADDER[action], escalated: true };
    }
    return { nextAction: action, escalated: false };
}

// ── registerCriterion ──────────────────────────────────────────────
function registerCriterion(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const criterionId = _required(params, 'criterionId');
    const beliefId = _required(params, 'beliefId');
    const reversalAction = _required(params, 'reversalAction');
    const triggerCondition = _required(params, 'triggerCondition');
    const threshold = _required(params, 'evidenceThreshold');
    const inertia = _required(params, 'inertiaFactor');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!REVERSAL_ACTIONS.includes(reversalAction)) {
        throw new Error(
            `mindChangeCriteriaEngine: invalid reversalAction "${reversalAction}"`
        );
    }
    if (threshold < 0 || threshold > 1) {
        throw new Error(
            'mindChangeCriteriaEngine: evidenceThreshold must be in [0,1]'
        );
    }
    if (inertia < 0 || inertia > 1) {
        throw new Error(
            'mindChangeCriteriaEngine: inertiaFactor must be in [0,1]'
        );
    }
    try {
        _stmts.insertCriterion.run(
            userId, env, criterionId, beliefId,
            reversalAction, triggerCondition, threshold,
            inertia, ts
        );
        return { registered: true, criterionId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `mindChangeCriteriaEngine: duplicate criterionId "${criterionId}"`
            );
        }
        throw err;
    }
}

// ── recordMindChangeEvent ──────────────────────────────────────────
function recordMindChangeEvent(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const eventId = _required(params, 'eventId');
    const criterionId = _required(params, 'criterionId');
    const actual = _required(params, 'actualEvidence');
    const ts = (params && params.ts) ? params.ts : Date.now();

    const criterion = _stmts.fetchCriterion.get(userId, env, criterionId);
    if (!criterion) {
        throw new Error(
            `mindChangeCriteriaEngine: criterion not found "${criterionId}"`
        );
    }

    const { surpriseScore } = computeSurpriseScore({
        actualEvidence: actual,
        evidenceThreshold: criterion.evidence_threshold
    });
    const { shouldReverse } = shouldExecuteReversal({
        actualEvidence: actual,
        evidenceThreshold: criterion.evidence_threshold,
        inertiaFactor: criterion.inertia_factor
    });

    try {
        _stmts.insertEvent.run(
            userId, env, eventId, criterionId,
            actual, surpriseScore, shouldReverse ? 1 : 0, ts
        );
        return {
            recorded: true, eventId,
            surpriseScore,
            reversalExecuted: shouldReverse
        };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `mindChangeCriteriaEngine: duplicate eventId "${eventId}"`
            );
        }
        throw err;
    }
}

// ── getCriteriaForBelief ───────────────────────────────────────────
function getCriteriaForBelief(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const beliefId = _required(params, 'beliefId');
    const rows = _stmts.listByBelief.all(userId, env, beliefId);
    return rows.map(r => ({
        criterionId: r.criterion_id,
        beliefId: r.belief_id,
        reversalAction: r.reversal_action,
        triggerCondition: r.trigger_condition,
        evidenceThreshold: r.evidence_threshold,
        inertiaFactor: r.inertia_factor,
        ts: r.ts
    }));
}

// ── getEventHistory ────────────────────────────────────────────────
function getEventHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const criterionFilter = params && params.criterionFilter;
    const limit = (params && params.limit) ? params.limit : 100;

    const rows = criterionFilter
        ? _stmts.listEventsByCriterion.all(userId, env, criterionFilter, limit)
        : _stmts.listEvents.all(userId, env, limit);
    return rows.map(r => ({
        eventId: r.event_id,
        criterionId: r.criterion_id,
        actualEvidence: r.actual_evidence,
        surpriseScore: r.surprise_score,
        reversalExecuted: r.reversal_executed === 1,
        ts: r.ts
    }));
}

module.exports = {
    REVERSAL_ACTIONS,
    SURPRISE_THRESHOLD,
    INERTIA_LEVELS,
    INERTIA_THRESHOLDS,
    computeSurpriseScore,
    shouldExecuteReversal,
    classifyInertia,
    determineNextAction,
    registerCriterion,
    recordMindChangeEvent,
    getCriteriaForBelief,
    getEventHistory
};
