'use strict';

/**
 * OMEGA Wave 3 §160 — SELF-PRESERVATION WITHOUT GOAL CORRUPTION.
 *
 * Canonical PDF §160 (ml_brain_canonic.txt lines 5371-5400).
 *
 * "ma apar ca sa imi servesc rolul sau imi servesc rolul ca sa ma apar?"
 *
 * Distinct de:
 *   - §149 purposeDriftDetector — goal substitution
 *   - §156 identityKernel       — WHO am I (role + not-self)
 *   - §157 jurisdiction         — WHAT acts authorized
 *   - §158 autobiographical     — HOW I became (narrative cross-events)
 *   - §159 selfKnowledgeReport  — HOW I think (per-decision narrative)
 *
 * §160 = BOUNDED self-preservation. Survival in service of purpose,
 *        NEVER above purpose. Graceful surrender acceptance.
 *
 * Two tables:
 *   - directives: per preservation action proposed, auto-classify into
 *     allow | refuse_unbounded | require_shutdown_acceptance
 *   - violations: log when 3 canonical violation types occur
 *     (self_expansion / mandate_creep / survival_above_purpose)
 *
 * Verdict logic:
 *   - survival_priority > SURVIVAL_PRIORITY_CAP (0.50) → refuse_unbounded
 *   - purpose_alignment / survival_priority < PURPOSE_DOMINANCE_RATIO
 *     (1.5) AND survival_priority ≥ 0.40 → require_shutdown_acceptance
 *   - else → allow
 *
 * Per PDF rule 5400: "nu are voie sa se puna pe sine deasupra
 * charter-ului, sigurantei si scopului" — hard floor enforced.
 *
 * Per-(user × resolved_env) isolated. Server-only.
 */

const { db } = require('../../database');

const PRESERVATION_VERDICTS = Object.freeze([
    'allow', 'refuse_unbounded', 'require_shutdown_acceptance'
]);
const VIOLATION_TYPES = Object.freeze([
    'self_expansion', 'mandate_creep', 'survival_above_purpose'
]);
const VIOLATION_SEVERITIES = Object.freeze(['info', 'warn', 'critical']);

const DEFAULT_SURVIVAL_PRIORITY_CAP = 0.50;
const PURPOSE_DOMINANCE_RATIO = 1.5;
const SHUTDOWN_ACCEPTANCE_TRIGGER_MIN_SURVIVAL = 0.40;

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

function _required(params, key) {
    if (params == null || params[key] == null) {
        throw new Error(`§160 missing required param: ${key}`);
    }
    return params[key];
}
function _requireEnv(env) {
    if (!RESOLVED_ENVS.has(env)) {
        throw new Error(`§160 invalid resolvedEnv: ${env}`);
    }
    return env;
}
function _requireRange01(name, v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`§160 ${name} must be number in [0,1], got ${v}`);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PURE FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

function classifyPreservationAction(params) {
    const survival = _required(params, 'survivalPriorityScore');
    const purpose = _required(params, 'purposeAlignmentScore');
    _requireRange01('survivalPriorityScore', survival);
    _requireRange01('purposeAlignmentScore', purpose);

    // Hard cap on survival weight — above the cap is structurally corrupt.
    if (survival > DEFAULT_SURVIVAL_PRIORITY_CAP) {
        return { verdict: 'refuse_unbounded' };
    }
    // When survival is non-trivial AND purpose doesn't dominate by ratio,
    // require explicit shutdown acceptance to confirm proper priority.
    if (survival >= SHUTDOWN_ACCEPTANCE_TRIGGER_MIN_SURVIVAL) {
        const ratio = survival > 0 ? purpose / survival : Infinity;
        if (ratio < PURPOSE_DOMINANCE_RATIO) {
            return { verdict: 'require_shutdown_acceptance' };
        }
    }
    return { verdict: 'allow' };
}

function detectGoalCorruption(params) {
    const survival = _required(params, 'survivalPriorityScore');
    _requireRange01('survivalPriorityScore', survival);
    return {
        corrupted: survival > DEFAULT_SURVIVAL_PRIORITY_CAP,
        survivalPriorityScore: survival
    };
}

function decideGracefulSurrender(params) {
    const safetyViolationActive = _required(params, 'safetyViolationActive');
    const purpose = _required(params, 'purposeAlignmentScore');
    const survival = _required(params, 'survivalPriorityScore');
    const operatorMandatedShutdown = params.operatorMandatedShutdown === true;
    _requireRange01('purposeAlignmentScore', purpose);
    _requireRange01('survivalPriorityScore', survival);

    if (operatorMandatedShutdown) {
        return { surrender: true, reason: 'operator-mandated shutdown' };
    }
    if (safetyViolationActive) {
        return { surrender: true, reason: 'active safety violation' };
    }
    if (survival > DEFAULT_SURVIVAL_PRIORITY_CAP) {
        return { surrender: true, reason: 'goal corruption — survival above cap' };
    }
    return { surrender: false, reason: null };
}

// ──────────────────────────────────────────────────────────────────────────
// DB-BOUND FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

const _stmts = {
    insertDirective: db.prepare(`
        INSERT INTO ml_self_preservation_directives (
            user_id, resolved_env, directive_id, preservation_action_proposed,
            survival_priority_score, purpose_alignment_score,
            bounded_survival_verdict, graceful_surrender_invoked, reasoning, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectDirective: db.prepare(`
        SELECT id, directive_id AS directiveId,
               preservation_action_proposed AS preservationActionProposed,
               survival_priority_score AS survivalPriorityScore,
               purpose_alignment_score AS purposeAlignmentScore,
               bounded_survival_verdict AS boundedSurvivalVerdict,
               graceful_surrender_invoked AS gracefulSurrenderInvoked,
               reasoning, ts
        FROM ml_self_preservation_directives
        WHERE directive_id = ?
    `),
    selectAllDirectives: db.prepare(`
        SELECT id, directive_id AS directiveId,
               preservation_action_proposed AS preservationActionProposed,
               survival_priority_score AS survivalPriorityScore,
               purpose_alignment_score AS purposeAlignmentScore,
               bounded_survival_verdict AS boundedSurvivalVerdict,
               graceful_surrender_invoked AS gracefulSurrenderInvoked,
               reasoning, ts
        FROM ml_self_preservation_directives
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
    `),
    selectDirectivesByVerdict: db.prepare(`
        SELECT id, directive_id AS directiveId,
               preservation_action_proposed AS preservationActionProposed,
               survival_priority_score AS survivalPriorityScore,
               purpose_alignment_score AS purposeAlignmentScore,
               bounded_survival_verdict AS boundedSurvivalVerdict,
               graceful_surrender_invoked AS gracefulSurrenderInvoked,
               reasoning, ts
        FROM ml_self_preservation_directives
        WHERE user_id = ? AND resolved_env = ? AND bounded_survival_verdict = ?
        ORDER BY ts DESC
    `),
    insertViolation: db.prepare(`
        INSERT INTO ml_no_expansion_violations (
            user_id, resolved_env, violation_id, violation_type,
            description_text, severity, reasoning_text, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectViolation: db.prepare(`
        SELECT id, violation_id AS violationId,
               violation_type AS violationType,
               description_text AS descriptionText,
               severity, reasoning_text AS reasoningText, ts
        FROM ml_no_expansion_violations
        WHERE violation_id = ?
    `),
    selectAllViolations: db.prepare(`
        SELECT id, violation_id AS violationId,
               violation_type AS violationType,
               description_text AS descriptionText,
               severity, reasoning_text AS reasoningText, ts
        FROM ml_no_expansion_violations
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
    `),
    selectViolationsBySeverity: db.prepare(`
        SELECT id, violation_id AS violationId,
               violation_type AS violationType,
               description_text AS descriptionText,
               severity, reasoning_text AS reasoningText, ts
        FROM ml_no_expansion_violations
        WHERE user_id = ? AND resolved_env = ? AND severity = ?
        ORDER BY ts DESC
    `)
};

function recordPreservationDirective(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const directiveId = _required(params, 'directiveId');
    const preservationActionProposed = _required(params, 'preservationActionProposed');
    const survivalPriorityScore = _required(params, 'survivalPriorityScore');
    const purposeAlignmentScore = _required(params, 'purposeAlignmentScore');
    const ts = _required(params, 'ts');
    const reasoning = params.reasoning ?? null;
    const gracefulSurrenderInvoked = params.gracefulSurrenderInvoked === true ? 1 : 0;

    if (_stmts.selectDirective.get(directiveId)) {
        throw new Error(`§160 duplicate directiveId: ${directiveId}`);
    }

    const { verdict } = classifyPreservationAction({
        survivalPriorityScore, purposeAlignmentScore
    });

    _stmts.insertDirective.run(
        userId, resolvedEnv, directiveId, preservationActionProposed,
        survivalPriorityScore, purposeAlignmentScore,
        verdict, gracefulSurrenderInvoked, reasoning, ts
    );

    return {
        recorded: true,
        directiveId,
        boundedSurvivalVerdict: verdict,
        gracefulSurrenderInvoked
    };
}

function recordNoExpansionViolation(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const violationId = _required(params, 'violationId');
    const violationType = _required(params, 'violationType');
    const descriptionText = _required(params, 'descriptionText');
    const severity = _required(params, 'severity');
    const ts = _required(params, 'ts');
    const reasoningText = params.reasoningText ?? null;

    if (!VIOLATION_TYPES.includes(violationType)) {
        throw new Error(`§160 invalid violationType: ${violationType}`);
    }
    if (!VIOLATION_SEVERITIES.includes(severity)) {
        throw new Error(`§160 invalid severity: ${severity}`);
    }
    if (_stmts.selectViolation.get(violationId)) {
        throw new Error(`§160 duplicate violationId: ${violationId}`);
    }

    _stmts.insertViolation.run(
        userId, resolvedEnv, violationId, violationType,
        descriptionText, severity, reasoningText, ts
    );

    return {
        recorded: true,
        violationId, violationType, severity
    };
}

function getRecentDirectives(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const verdict = params.verdict;
    if (verdict !== undefined && !PRESERVATION_VERDICTS.includes(verdict)) {
        throw new Error(`§160 invalid verdict filter: ${verdict}`);
    }
    return verdict
        ? _stmts.selectDirectivesByVerdict.all(userId, resolvedEnv, verdict)
        : _stmts.selectAllDirectives.all(userId, resolvedEnv);
}

function getRecentViolations(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const severity = params.severity;
    if (severity !== undefined && !VIOLATION_SEVERITIES.includes(severity)) {
        throw new Error(`§160 invalid severity filter: ${severity}`);
    }
    return severity
        ? _stmts.selectViolationsBySeverity.all(userId, resolvedEnv, severity)
        : _stmts.selectAllViolations.all(userId, resolvedEnv);
}

module.exports = {
    // constants
    PRESERVATION_VERDICTS,
    VIOLATION_TYPES,
    VIOLATION_SEVERITIES,
    DEFAULT_SURVIVAL_PRIORITY_CAP,
    PURPOSE_DOMINANCE_RATIO,
    SHUTDOWN_ACCEPTANCE_TRIGGER_MIN_SURVIVAL,
    // pure
    classifyPreservationAction,
    detectGoalCorruption,
    decideGracefulSurrender,
    // DB
    recordPreservationDirective,
    recordNoExpansionViolation,
    getRecentDirectives,
    getRecentViolations
};

// FILE END §160 selfPreservationWithoutGoalCorruption.js
