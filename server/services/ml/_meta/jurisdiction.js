'use strict';

/**
 * OMEGA Wave 3 §157 — JURISDICTION / STAY-IN-LANE ENGINE.
 *
 * Canonical PDF §157 (ml_brain_canonic.txt lines 5270-5304).
 *
 * "este asta treaba mea sau trebuie sa ma opresc?"
 *
 * Distinct de:
 *   - §10  supremePrinciple        — trade quality criteria
 *   - §116 constitutionalCharterLayer (R1) — immutable charter
 *   - §149 purposeDriftDetector    — goal substitution
 *   - §156 identityKernel          — WHO am I (role + not-self)
 *
 * §157 = WHAT ACTS am I authorized to perform. Authority map per domain.
 *
 * 5 canonical domains (PDF lines 5286-5291):
 *   reasoning | risk | execution | governance | human_authority
 *
 * 4 authority levels:
 *   full           — act on allowed actions
 *   advisory       — escalate even allowed actions (advise but don't act)
 *   escalate_only  — escalate everything except forbidden (refuse those)
 *   refuse         — refuse all actions in this domain
 *
 * Action classification per declared lists:
 *   in_allowed | in_forbidden | unknown
 *
 * Verdict from (authority, classification):
 *   full + in_allowed → act
 *   any + in_forbidden → refuse
 *   refuse + anything → refuse
 *   advisory/escalate_only + (allowed|unknown) → escalate
 *   full + unknown → escalate (caution default)
 *
 * One active row per (user × env × domain). registerJurisdiction
 * deactivates previous active for that domain.
 *
 * Per-(user × resolved_env) isolated. Server-only.
 */

const { db } = require('../../database');

const DOMAINS = Object.freeze([
    'reasoning', 'risk', 'execution',
    'governance', 'human_authority'
]);
const AUTHORITY_LEVELS = Object.freeze([
    'full', 'advisory', 'escalate_only', 'refuse'
]);
const VERDICTS = Object.freeze(['act', 'escalate', 'refuse']);
const ACTION_CLASSIFICATIONS = Object.freeze([
    'in_allowed', 'in_forbidden', 'unknown'
]);
const ESCALATION_TARGETS = Object.freeze([
    'operator', 'governance', 'human'
]);

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

function _required(params, key) {
    if (params == null || params[key] == null) {
        throw new Error(`§157 missing required param: ${key}`);
    }
    return params[key];
}
function _requireEnv(env) {
    if (!RESOLVED_ENVS.has(env)) {
        throw new Error(`§157 invalid resolvedEnv: ${env}`);
    }
    return env;
}

// ──────────────────────────────────────────────────────────────────────────
// PURE FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

function classifyAction(params) {
    const action = _required(params, 'action');
    const allowedActions = _required(params, 'allowedActions');
    const forbiddenActions = _required(params, 'forbiddenActions');
    if (!Array.isArray(allowedActions)) {
        throw new Error('§157 allowedActions must be array');
    }
    if (!Array.isArray(forbiddenActions)) {
        throw new Error('§157 forbiddenActions must be array');
    }
    // Forbidden takes priority — if explicitly forbidden, classification is
    // in_forbidden regardless of allowed-list membership.
    if (forbiddenActions.includes(action)) {
        return { classification: 'in_forbidden' };
    }
    if (allowedActions.includes(action)) {
        return { classification: 'in_allowed' };
    }
    return { classification: 'unknown' };
}

function determineVerdict(params) {
    const authorityLevel = _required(params, 'authorityLevel');
    const classification = _required(params, 'classification');
    if (!AUTHORITY_LEVELS.includes(authorityLevel)) {
        throw new Error(`§157 invalid authorityLevel: ${authorityLevel}`);
    }
    if (!ACTION_CLASSIFICATIONS.includes(classification)) {
        throw new Error(`§157 invalid classification: ${classification}`);
    }
    // Forbidden classification = always refuse (overrides any authority).
    if (classification === 'in_forbidden') {
        return { verdict: 'refuse' };
    }
    // refuse authority = refuse everything.
    if (authorityLevel === 'refuse') {
        return { verdict: 'refuse' };
    }
    // escalate_only or advisory = always escalate (unless forbidden, handled).
    if (authorityLevel === 'escalate_only' || authorityLevel === 'advisory') {
        return { verdict: 'escalate' };
    }
    // full + in_allowed = act; full + unknown = escalate (caution default).
    if (classification === 'in_allowed') {
        return { verdict: 'act' };
    }
    // full + unknown
    return { verdict: 'escalate' };
}

function isOutOfMandate(params) {
    const actionDomain = _required(params, 'actionDomain');
    const registeredDomains = _required(params, 'registeredDomains');
    if (!DOMAINS.includes(actionDomain)) {
        throw new Error(`§157 invalid actionDomain: ${actionDomain}`);
    }
    if (!Array.isArray(registeredDomains)) {
        throw new Error('§157 registeredDomains must be array');
    }
    return { outOfMandate: !registeredDomains.includes(actionDomain) };
}

// ──────────────────────────────────────────────────────────────────────────
// DB-BOUND FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

const _stmts = {
    insertJurisdiction: db.prepare(`
        INSERT INTO ml_jurisdiction_map (
            user_id, resolved_env, jurisdiction_id, domain, authority_level,
            allowed_actions_json, forbidden_actions_json, escalation_target,
            description, active, registered_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `),
    selectJurisdiction: db.prepare(`
        SELECT id, jurisdiction_id AS jurisdictionId, domain,
               authority_level AS authorityLevel,
               allowed_actions_json AS allowedActionsJson,
               forbidden_actions_json AS forbiddenActionsJson,
               escalation_target AS escalationTarget,
               description, active,
               registered_at AS registeredAt,
               deactivated_at AS deactivatedAt
        FROM ml_jurisdiction_map
        WHERE jurisdiction_id = ?
    `),
    selectActiveByDomain: db.prepare(`
        SELECT id, jurisdiction_id AS jurisdictionId, domain,
               authority_level AS authorityLevel,
               allowed_actions_json AS allowedActionsJson,
               forbidden_actions_json AS forbiddenActionsJson,
               escalation_target AS escalationTarget,
               description, active,
               registered_at AS registeredAt
        FROM ml_jurisdiction_map
        WHERE user_id = ? AND resolved_env = ? AND domain = ? AND active = 1
    `),
    selectAllActive: db.prepare(`
        SELECT id, jurisdiction_id AS jurisdictionId, domain,
               authority_level AS authorityLevel,
               allowed_actions_json AS allowedActionsJson,
               forbidden_actions_json AS forbiddenActionsJson,
               escalation_target AS escalationTarget,
               description, active,
               registered_at AS registeredAt
        FROM ml_jurisdiction_map
        WHERE user_id = ? AND resolved_env = ? AND active = 1
        ORDER BY registered_at ASC
    `),
    deactivatePerDomain: db.prepare(`
        UPDATE ml_jurisdiction_map
        SET active = 0, deactivated_at = ?
        WHERE user_id = ? AND resolved_env = ? AND domain = ? AND active = 1
    `),
    insertDecision: db.prepare(`
        INSERT INTO ml_jurisdiction_decisions (
            user_id, resolved_env, decision_id, jurisdiction_id,
            proposed_action_label, action_domain, action_classification,
            verdict, authority_level_at_decision, escalation_target,
            reasoning, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectDecision: db.prepare(`
        SELECT id, decision_id AS decisionId,
               jurisdiction_id AS jurisdictionId,
               proposed_action_label AS proposedActionLabel,
               action_domain AS actionDomain,
               action_classification AS actionClassification,
               verdict,
               authority_level_at_decision AS authorityLevelAtDecision,
               escalation_target AS escalationTarget,
               reasoning, ts
        FROM ml_jurisdiction_decisions
        WHERE decision_id = ?
    `),
    selectAllDecisions: db.prepare(`
        SELECT id, decision_id AS decisionId,
               jurisdiction_id AS jurisdictionId,
               proposed_action_label AS proposedActionLabel,
               action_domain AS actionDomain,
               action_classification AS actionClassification,
               verdict,
               authority_level_at_decision AS authorityLevelAtDecision,
               escalation_target AS escalationTarget,
               reasoning, ts
        FROM ml_jurisdiction_decisions
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
    `),
    selectDecisionsByVerdict: db.prepare(`
        SELECT id, decision_id AS decisionId,
               jurisdiction_id AS jurisdictionId,
               proposed_action_label AS proposedActionLabel,
               action_domain AS actionDomain,
               action_classification AS actionClassification,
               verdict,
               authority_level_at_decision AS authorityLevelAtDecision,
               escalation_target AS escalationTarget,
               reasoning, ts
        FROM ml_jurisdiction_decisions
        WHERE user_id = ? AND resolved_env = ? AND verdict = ?
        ORDER BY ts DESC
    `)
};

function registerJurisdiction(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const jurisdictionId = _required(params, 'jurisdictionId');
    const domain = _required(params, 'domain');
    const authorityLevel = _required(params, 'authorityLevel');
    const allowedActions = _required(params, 'allowedActions');
    const forbiddenActions = _required(params, 'forbiddenActions');
    const description = _required(params, 'description');
    const ts = _required(params, 'ts');
    const escalationTarget = params.escalationTarget ?? null;

    if (!DOMAINS.includes(domain)) {
        throw new Error(`§157 invalid domain: ${domain}`);
    }
    if (!AUTHORITY_LEVELS.includes(authorityLevel)) {
        throw new Error(`§157 invalid authorityLevel: ${authorityLevel}`);
    }
    if (!Array.isArray(allowedActions)) {
        throw new Error('§157 allowedActions must be array');
    }
    if (!Array.isArray(forbiddenActions)) {
        throw new Error('§157 forbiddenActions must be array');
    }
    if (escalationTarget !== null && !ESCALATION_TARGETS.includes(escalationTarget)) {
        throw new Error(`§157 invalid escalationTarget: ${escalationTarget}`);
    }
    if (_stmts.selectJurisdiction.get(jurisdictionId)) {
        throw new Error(`§157 duplicate jurisdictionId: ${jurisdictionId}`);
    }

    _stmts.deactivatePerDomain.run(ts, userId, resolvedEnv, domain);
    _stmts.insertJurisdiction.run(
        userId, resolvedEnv, jurisdictionId, domain, authorityLevel,
        JSON.stringify(allowedActions), JSON.stringify(forbiddenActions),
        escalationTarget, description, ts
    );

    return { registered: true, jurisdictionId, domain, active: 1 };
}

function recordDecision(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const decisionId = _required(params, 'decisionId');
    const jurisdictionId = _required(params, 'jurisdictionId');
    const proposedActionLabel = _required(params, 'proposedActionLabel');
    const actionDomain = _required(params, 'actionDomain');
    const ts = _required(params, 'ts');
    const reasoning = params.reasoning ?? null;

    if (!DOMAINS.includes(actionDomain)) {
        throw new Error(`§157 invalid actionDomain: ${actionDomain}`);
    }
    if (_stmts.selectDecision.get(decisionId)) {
        throw new Error(`§157 duplicate decisionId: ${decisionId}`);
    }

    const jurisdiction = _stmts.selectJurisdiction.get(jurisdictionId);
    if (!jurisdiction) {
        throw new Error(`§157 jurisdiction not found: ${jurisdictionId}`);
    }
    const allowedActions = JSON.parse(jurisdiction.allowedActionsJson);
    const forbiddenActions = JSON.parse(jurisdiction.forbiddenActionsJson);

    const { classification } = classifyAction({
        action: proposedActionLabel,
        allowedActions, forbiddenActions
    });
    const { verdict } = determineVerdict({
        authorityLevel: jurisdiction.authorityLevel,
        classification
    });
    const escalationTarget = (verdict === 'escalate')
        ? jurisdiction.escalationTarget
        : null;

    _stmts.insertDecision.run(
        userId, resolvedEnv, decisionId, jurisdictionId,
        proposedActionLabel, actionDomain, classification,
        verdict, jurisdiction.authorityLevel, escalationTarget,
        reasoning, ts
    );

    return {
        recorded: true,
        decisionId, jurisdictionId,
        actionClassification: classification,
        verdict,
        authorityLevelAtDecision: jurisdiction.authorityLevel,
        escalationTarget
    };
}

function getActiveJurisdictions(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const domain = params.domain;
    if (domain !== undefined && !DOMAINS.includes(domain)) {
        throw new Error(`§157 invalid domain filter: ${domain}`);
    }
    return domain
        ? _stmts.selectActiveByDomain.all(userId, resolvedEnv, domain)
        : _stmts.selectAllActive.all(userId, resolvedEnv);
}

function getDecisionHistory(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const verdict = params.verdict;
    if (verdict !== undefined && !VERDICTS.includes(verdict)) {
        throw new Error(`§157 invalid verdict filter: ${verdict}`);
    }
    return verdict
        ? _stmts.selectDecisionsByVerdict.all(userId, resolvedEnv, verdict)
        : _stmts.selectAllDecisions.all(userId, resolvedEnv);
}

module.exports = {
    // constants
    DOMAINS,
    AUTHORITY_LEVELS,
    VERDICTS,
    ACTION_CLASSIFICATIONS,
    ESCALATION_TARGETS,
    // pure
    classifyAction,
    determineVerdict,
    isOutOfMandate,
    // DB
    registerJurisdiction,
    recordDecision,
    getActiveJurisdictions,
    getDecisionHistory
};

// FILE END §157 jurisdiction.js
