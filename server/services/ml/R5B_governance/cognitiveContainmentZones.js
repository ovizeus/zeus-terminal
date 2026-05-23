'use strict';

/**
 * OMEGA R5B Governance — cognitiveContainmentZones (canonical §140)
 *
 * §140 COGNITIVE CONTAINMENT ZONES / IDEA QUARANTINE ENGINE.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 4181-4234.
 *
 * "Un sistem foarte complex are nevoie de zone de carantina pentru idei...
 *  o idee noua poate parea extraordinara dupa cateva cazuri... daca intra
 *  prea devreme in nucleul sistemului, poate distorsiona scoring + ontology
 *  + policy + explainability + governance... quarantine zone pentru concepte
 *  + reguli + cauzalitati candidate + heuristici + signals + ontologii +
 *  contamination risk score + incubation period + staged promotion path:
 *  idea detected → quarantined → replay tested → shadow tested → canary
 *  influence → core admission, rejection / retirement path pentru ideile
 *  care nu rezista... 'e o descoperire reala sau doar o tentatie
 *  intelectuala prematura?'..."
 *
 * Reguli explicite (canonical):
 * - "nici o idee noua nu intra direct in nucleul decizional live"
 * - "ideile speculative trebuie sa stea in carantina pana castiga drept
 *    de cetatenie"
 * - "contaminarea conceptuala este tratata ca risc operational si epistemic
 *    real"
 *
 * Distinct from §138 counterOntologySandbox (R5B — SPECIAL CASE pentru
 * ontology only, 3-state subset); §140 = GENERAL framework cu 6 idea kinds
 * (concept/rule/causality/heuristic/signal/ontology) + 7-stage progression
 * + retirement path + contamination risk scoring. §138 mechanic = subset
 * of §140 framework.
 */

const { db } = require('../../database');

const IDEA_KINDS = Object.freeze([
    'concept', 'rule', 'causality',
    'heuristic', 'signal', 'ontology'
]);
const STAGES = Object.freeze([
    'idea_detected', 'quarantined', 'replay_tested',
    'shadow_tested', 'canary_influence', 'core_admitted',
    'retired'
]);

// DAG of allowed forward transitions
const VALID_TRANSITIONS = Object.freeze({
    idea_detected: Object.freeze(['quarantined', 'retired']),
    quarantined: Object.freeze(['replay_tested', 'retired']),
    replay_tested: Object.freeze(['shadow_tested', 'retired']),
    shadow_tested: Object.freeze(['canary_influence', 'retired']),
    canary_influence: Object.freeze(['core_admitted', 'retired']),
    core_admitted: Object.freeze([]),  // terminal
    retired: Object.freeze([])          // terminal
});

const CONTAMINATION_RISK_THRESHOLDS = Object.freeze({
    high: 0.70,
    medium: 0.40
});

const MIN_INCUBATION_MS = 86400000;  // 24h
const MIN_DECISIONS_FOR_SHADOW = 10;
const MIN_DECISIONS_FOR_CANARY = 50;
const MIN_DECISIONS_FOR_CORE = 200;

const TEST_KINDS = Object.freeze(['replay', 'shadow', 'canary']);

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`cognitiveContainmentZones: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertIdea: db.prepare(`
        INSERT INTO ml_quarantined_ideas
        (user_id, resolved_env, idea_id, idea_kind, title, description,
         stage, contamination_risk, incubation_started_ts,
         replay_test_passed, shadow_test_passed, canary_test_passed,
         decision_count, active, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateStage: db.prepare(`
        UPDATE ml_quarantined_ideas
        SET stage = ?, incubation_started_ts = COALESCE(?, incubation_started_ts), ts = ?
        WHERE user_id = ? AND resolved_env = ? AND idea_id = ?
    `),
    updateTestFlag: db.prepare(`
        UPDATE ml_quarantined_ideas
        SET replay_test_passed = CASE WHEN ? = 'replay' THEN 1 ELSE replay_test_passed END,
            shadow_test_passed = CASE WHEN ? = 'shadow' THEN 1 ELSE shadow_test_passed END,
            canary_test_passed = CASE WHEN ? = 'canary' THEN 1 ELSE canary_test_passed END
        WHERE user_id = ? AND resolved_env = ? AND idea_id = ?
    `),
    incrementCount: db.prepare(`
        UPDATE ml_quarantined_ideas
        SET decision_count = decision_count + ?
        WHERE user_id = ? AND resolved_env = ? AND idea_id = ?
    `),
    getIdea: db.prepare(`
        SELECT * FROM ml_quarantined_ideas
        WHERE user_id = ? AND resolved_env = ? AND idea_id = ?
    `),
    listByStage: db.prepare(`
        SELECT * FROM ml_quarantined_ideas
        WHERE user_id = ? AND resolved_env = ? AND stage = ?
        ORDER BY ts DESC LIMIT ?
    `),
    insertPromotion: db.prepare(`
        INSERT INTO ml_idea_promotions
        (user_id, resolved_env, promotion_id, idea_id,
         from_stage, to_stage, reason, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
};

// ── classifyContaminationRisk (pure) ───────────────────────────────
function classifyContaminationRisk(params) {
    const score = _required(params, 'riskScore');
    if (score < 0 || score > 1) {
        throw new Error(
            'cognitiveContainmentZones: riskScore must be in [0,1]'
        );
    }
    let level;
    if (score >= CONTAMINATION_RISK_THRESHOLDS.high) level = 'high';
    else if (score >= CONTAMINATION_RISK_THRESHOLDS.medium) level = 'medium';
    else level = 'low';
    return { riskLevel: level };
}

// ── isValidTransition (pure) ───────────────────────────────────────
function isValidTransition(params) {
    const from = _required(params, 'fromStage');
    const to = _required(params, 'toStage');
    if (!STAGES.includes(from)) {
        throw new Error(
            `cognitiveContainmentZones: invalid fromStage "${from}"`
        );
    }
    if (!STAGES.includes(to)) {
        throw new Error(
            `cognitiveContainmentZones: invalid toStage "${to}"`
        );
    }
    return { valid: VALID_TRANSITIONS[from].includes(to) };
}

// ── evaluatePromotionEligibility (pure) ────────────────────────────
function evaluatePromotionEligibility(params) {
    const currentStage = _required(params, 'currentStage');
    const targetStage = _required(params, 'targetStage');
    const ideaState = _required(params, 'ideaState');
    const currentTs = _required(params, 'currentTs');

    const reasons = [];

    // Retirement always allowed
    if (targetStage === 'retired') {
        return { eligible: true, reasons: [] };
    }

    // Incubation period check (only after quarantined)
    if (currentStage !== 'idea_detected' && currentStage !== 'retired') {
        if (ideaState.incubation_started_ts !== null &&
            ideaState.incubation_started_ts !== undefined) {
            const elapsed = currentTs - ideaState.incubation_started_ts;
            if (elapsed < MIN_INCUBATION_MS) {
                reasons.push('incubation_period_too_short');
            }
        } else {
            reasons.push('no_incubation_start');
        }
    }

    // Test pass requirements per target stage
    if (targetStage === 'replay_tested' && ideaState.replay_test_passed !== 1) {
        reasons.push('replay_test_not_passed');
    }
    if (targetStage === 'shadow_tested' && ideaState.shadow_test_passed !== 1) {
        reasons.push('shadow_test_not_passed');
    }
    if (targetStage === 'canary_influence' && ideaState.canary_test_passed !== 1) {
        reasons.push('canary_test_not_passed');
    }

    // Decision count gates
    if (targetStage === 'shadow_tested' &&
        ideaState.decision_count < MIN_DECISIONS_FOR_SHADOW) {
        reasons.push('insufficient_decisions');
    }
    if (targetStage === 'canary_influence' &&
        ideaState.decision_count < MIN_DECISIONS_FOR_CANARY) {
        reasons.push('insufficient_decisions');
    }
    if (targetStage === 'core_admitted' &&
        ideaState.decision_count < MIN_DECISIONS_FOR_CORE) {
        reasons.push('insufficient_decisions');
    }

    return { eligible: reasons.length === 0, reasons };
}

// ── registerIdea ───────────────────────────────────────────────────
function registerIdea(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const ideaId = _required(params, 'ideaId');
    const ideaKind = _required(params, 'ideaKind');
    const title = _required(params, 'title');
    const description = _required(params, 'description');
    const risk = _required(params, 'contaminationRisk');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!IDEA_KINDS.includes(ideaKind)) {
        throw new Error(
            `cognitiveContainmentZones: invalid ideaKind "${ideaKind}"`
        );
    }
    if (risk < 0 || risk > 1) {
        throw new Error(
            'cognitiveContainmentZones: contaminationRisk must be in [0,1]'
        );
    }
    try {
        _stmts.insertIdea.run(
            userId, env, ideaId, ideaKind, title, description,
            'idea_detected', risk, null,
            0, 0, 0,  // no tests passed yet
            0,  // decision_count
            1,  // active
            ts
        );
        return { registered: true, ideaId, stage: 'idea_detected' };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `cognitiveContainmentZones: duplicate ideaId "${ideaId}"`
            );
        }
        throw err;
    }
}

// ── quarantineIdea ─────────────────────────────────────────────────
function quarantineIdea(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const ideaId = _required(params, 'ideaId');
    const ts = (params && params.ts) ? params.ts : Date.now();

    const idea = _stmts.getIdea.get(userId, env, ideaId);
    if (!idea) {
        throw new Error(
            `cognitiveContainmentZones: idea not found "${ideaId}"`
        );
    }
    if (idea.stage !== 'idea_detected') {
        throw new Error(
            `cognitiveContainmentZones: idea "${ideaId}" not in idea_detected (current stage: ${idea.stage}, wrong stage)`
        );
    }

    _stmts.updateStage.run('quarantined', ts, ts, userId, env, ideaId);
    return { quarantined: true, ideaId };
}

// ── recordTestPass ─────────────────────────────────────────────────
function recordTestPass(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const ideaId = _required(params, 'ideaId');
    const testKind = _required(params, 'testKind');

    if (!TEST_KINDS.includes(testKind)) {
        throw new Error(
            `cognitiveContainmentZones: invalid testKind "${testKind}"`
        );
    }
    const idea = _stmts.getIdea.get(userId, env, ideaId);
    if (!idea) {
        throw new Error(
            `cognitiveContainmentZones: idea not found "${ideaId}"`
        );
    }
    _stmts.updateTestFlag.run(
        testKind, testKind, testKind,
        userId, env, ideaId
    );
    return { recorded: true, ideaId, testKind };
}

// ── incrementDecisionCount ─────────────────────────────────────────
function incrementDecisionCount(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const ideaId = _required(params, 'ideaId');
    const count = _required(params, 'count');

    if (count < 0) {
        throw new Error(
            'cognitiveContainmentZones: count must be non-negative'
        );
    }
    const idea = _stmts.getIdea.get(userId, env, ideaId);
    if (!idea) {
        throw new Error(
            `cognitiveContainmentZones: idea not found "${ideaId}"`
        );
    }
    _stmts.incrementCount.run(count, userId, env, ideaId);
    return { incremented: true, ideaId, addedCount: count };
}

// ── promoteIdea (integration) ──────────────────────────────────────
function promoteIdea(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const ideaId = _required(params, 'ideaId');
    const targetStage = _required(params, 'targetStage');
    const reason = _required(params, 'reason');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!STAGES.includes(targetStage)) {
        throw new Error(
            `cognitiveContainmentZones: invalid targetStage "${targetStage}"`
        );
    }
    const idea = _stmts.getIdea.get(userId, env, ideaId);
    if (!idea) {
        throw new Error(
            `cognitiveContainmentZones: idea not found "${ideaId}"`
        );
    }
    const transition = isValidTransition({
        fromStage: idea.stage, toStage: targetStage
    });
    if (!transition.valid) {
        throw new Error(
            `cognitiveContainmentZones: invalid transition from "${idea.stage}" to "${targetStage}" (skip stages not allowed)`
        );
    }
    const eligibility = evaluatePromotionEligibility({
        currentStage: idea.stage,
        targetStage,
        ideaState: idea,
        currentTs: ts
    });
    if (!eligibility.eligible) {
        throw new Error(
            `cognitiveContainmentZones: eligibility failed: ${eligibility.reasons.join(', ')}`
        );
    }

    _stmts.updateStage.run(targetStage, null, ts, userId, env, ideaId);

    // Log promotion event
    const promotionId = `${ideaId}-prom-${ts}`;
    try {
        _stmts.insertPromotion.run(
            userId, env, promotionId, ideaId,
            idea.stage, targetStage, reason, ts
        );
    } catch (err) {
        // promotion ID collision is unlikely but tolerated; primary update succeeded
    }
    return {
        promoted: true, ideaId,
        oldStage: idea.stage,
        newStage: targetStage
    };
}

// ── retireIdea ─────────────────────────────────────────────────────
function retireIdea(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const ideaId = _required(params, 'ideaId');
    const reason = _required(params, 'reason');
    const ts = (params && params.ts) ? params.ts : Date.now();

    const idea = _stmts.getIdea.get(userId, env, ideaId);
    if (!idea) {
        throw new Error(
            `cognitiveContainmentZones: idea not found "${ideaId}"`
        );
    }
    if (idea.stage === 'retired') {
        throw new Error(
            `cognitiveContainmentZones: idea "${ideaId}" already retired (terminal)`
        );
    }
    if (idea.stage === 'core_admitted') {
        throw new Error(
            `cognitiveContainmentZones: idea "${ideaId}" already core_admitted (terminal, cannot retire)`
        );
    }

    _stmts.updateStage.run('retired', null, ts, userId, env, ideaId);

    const promotionId = `${ideaId}-ret-${ts}`;
    try {
        _stmts.insertPromotion.run(
            userId, env, promotionId, ideaId,
            idea.stage, 'retired', reason, ts
        );
    } catch (err) {
        // tolerate collision
    }
    return { retired: true, ideaId };
}

function _rowToIdea(r) {
    return {
        ideaId: r.idea_id,
        ideaKind: r.idea_kind,
        title: r.title,
        description: r.description,
        stage: r.stage,
        contaminationRisk: r.contamination_risk,
        incubationStartedTs: r.incubation_started_ts,
        replayTestPassed: r.replay_test_passed === 1,
        shadowTestPassed: r.shadow_test_passed === 1,
        canaryTestPassed: r.canary_test_passed === 1,
        decisionCount: r.decision_count,
        active: r.active === 1,
        ts: r.ts
    };
}

// ── getIdeasInStage ────────────────────────────────────────────────
function getIdeasInStage(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const stage = _required(params, 'stage');
    const limit = (params && params.limit) ? params.limit : 100;

    if (!STAGES.includes(stage)) {
        throw new Error(
            `cognitiveContainmentZones: invalid stage "${stage}"`
        );
    }
    const rows = _stmts.listByStage.all(userId, env, stage, limit);
    return rows.map(_rowToIdea);
}

// ── getIdeaById ────────────────────────────────────────────────────
function getIdeaById(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const ideaId = _required(params, 'ideaId');
    const r = _stmts.getIdea.get(userId, env, ideaId);
    if (!r) return null;
    return _rowToIdea(r);
}

module.exports = {
    IDEA_KINDS,
    STAGES,
    VALID_TRANSITIONS,
    CONTAMINATION_RISK_THRESHOLDS,
    MIN_INCUBATION_MS,
    MIN_DECISIONS_FOR_SHADOW,
    MIN_DECISIONS_FOR_CANARY,
    MIN_DECISIONS_FOR_CORE,
    TEST_KINDS,
    classifyContaminationRisk,
    isValidTransition,
    evaluatePromotionEligibility,
    registerIdea,
    quarantineIdea,
    recordTestPass,
    incrementDecisionCount,
    promoteIdea,
    retireIdea,
    getIdeasInStage,
    getIdeaById
};
