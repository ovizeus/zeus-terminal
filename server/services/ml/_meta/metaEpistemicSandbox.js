'use strict';

/**
 * OMEGA Wave 3 §150 — META-EPISTEMIC SANDBOX / ALTERNATE LAWS OF MIND LAB.
 *
 * Canonical PDF §150 (ml_brain_canonic.txt lines 4924-4982).
 *
 * Distinct de:
 *   - §125 epistemicTensionField    — intra-regime tension between sources
 *   - §135 epistemicHumilityGovernor — humility WITHIN current knowledge
 *   - §138 counterOntologySandbox    — alien frames pe CONTENT (ontology)
 *   - §147 intellectualHonestyAudit  — reason drift on decisions
 *   - §149 purposeDriftDetector      — scope substitution
 *
 * §150 = REGIMURI DE A ȘTI. "daca as schimba regulile dupa care decid ce
 *        inseamna a sti ceva, as deveni mai bun sau doar mai exotic?"
 *
 * 6 candidate epistemic regimes (PDF lines 4952-4957):
 *   evidence-first | causality-first | prudence-first |
 *   simplicity-first | antifragility-first | dissent-first
 *
 * 6 evaluation axes (PDF lines 4960-4965):
 *   robustness | coherence | humility | speed | tail_survival | alpha_quality
 *
 * Quarantine layer — candidates NEVER touch live core directly.
 * Admission path: quarantined → shadow → canary → live.
 * Rejection: any → rejected (terminal).
 *
 * Per-(user × resolved_env) isolated. Server-only.
 */

const { db } = require('../../database');

const DECLARED_PRIORITIES = Object.freeze([
    'evidence', 'causality', 'prudence',
    'simplicity', 'antifragility', 'dissent'
]);
const REGIME_STATUSES = Object.freeze([
    'quarantined', 'shadow', 'canary', 'live', 'rejected'
]);
const EVAL_AXES = Object.freeze([
    'robustness', 'coherence', 'humility',
    'speed', 'tail_survival', 'alpha_quality'
]);
const VERDICTS = Object.freeze(['pass', 'fail', 'inconclusive']);

// Tail_survival weighted heaviest per canonical PDF rule (line 4977):
// "novelty fara supravietuire, coerenta si valoare explicativa este respinsa"
const COMPOSITE_WEIGHTS = Object.freeze({
    robustness: 0.20,
    coherence: 0.15,
    humility: 0.15,
    speed: 0.10,
    tail_survival: 0.25,
    alpha_quality: 0.15
});

const PASS_THRESHOLD = 0.65;
const FAIL_THRESHOLD = 0.40;
const MIN_AXIS_FLOOR = 0.40;

// Admission path: quarantined → shadow → canary → live (forward-only).
// any → rejected (terminal). rejected is sink, no exits.
const VALID_TRANSITIONS = Object.freeze({
    quarantined: new Set(['shadow', 'rejected']),
    shadow:      new Set(['canary', 'rejected']),
    canary:      new Set(['live', 'rejected']),
    live:        new Set(['rejected']),
    rejected:    new Set()
});

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

function _required(params, key) {
    if (params == null || params[key] == null) {
        throw new Error(`§150 missing required param: ${key}`);
    }
    return params[key];
}
function _requireEnv(env) {
    if (!RESOLVED_ENVS.has(env)) {
        throw new Error(`§150 invalid resolvedEnv: ${env}`);
    }
    return env;
}
function _requireRange01(name, v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`§150 ${name} must be number in [0,1], got ${v}`);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PURE FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

function computeCompositeScore(params) {
    const axes = _required(params, 'axes');
    let composite = 0;
    for (const axis of EVAL_AXES) {
        if (axes[axis] === undefined || axes[axis] === null) {
            throw new Error(`§150 missing axis: ${axis}`);
        }
        _requireRange01(axis, axes[axis]);
        composite += axes[axis] * COMPOSITE_WEIGHTS[axis];
    }
    const clamped = Math.max(0, Math.min(1, composite));
    return { composite: clamped };
}

function classifyVerdict(params) {
    const compositeScore = _required(params, 'compositeScore');
    const axes = _required(params, 'axes');
    _requireRange01('compositeScore', compositeScore);
    // Floor check first — even good composite fails if any axis below floor.
    // Rationale: "humility=0.20" means the regime is dangerously overconfident
    // regardless of how strong alpha and tail look on paper.
    let belowFloor = false;
    for (const axis of EVAL_AXES) {
        if (axes[axis] === undefined || axes[axis] === null) {
            throw new Error(`§150 missing axis: ${axis}`);
        }
        _requireRange01(axis, axes[axis]);
        if (axes[axis] < MIN_AXIS_FLOOR) belowFloor = true;
    }
    let verdict;
    if (compositeScore >= PASS_THRESHOLD && !belowFloor) verdict = 'pass';
    else if (compositeScore < FAIL_THRESHOLD) verdict = 'fail';
    else verdict = 'inconclusive';
    return { verdict, compositeScore, belowFloor };
}

function validStatusTransition(params) {
    const fromStatus = _required(params, 'fromStatus');
    const toStatus = _required(params, 'toStatus');
    if (!REGIME_STATUSES.includes(fromStatus)) {
        throw new Error(`§150 invalid fromStatus: ${fromStatus}`);
    }
    if (!REGIME_STATUSES.includes(toStatus)) {
        throw new Error(`§150 invalid toStatus: ${toStatus}`);
    }
    const allowed = VALID_TRANSITIONS[fromStatus];
    return { valid: allowed.has(toStatus), fromStatus, toStatus };
}

// ──────────────────────────────────────────────────────────────────────────
// DB-BOUND FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

const _stmts = {
    insertRegime: db.prepare(`
        INSERT INTO ml_epistemic_regime_candidates (
            user_id, resolved_env, regime_id, regime_name, declared_priority,
            description, status, registered_at, last_transition_at, last_transition_note
        ) VALUES (?, ?, ?, ?, ?, ?, 'quarantined', ?, ?, ?)
    `),
    selectRegime: db.prepare(`
        SELECT id, regime_id AS regimeId, regime_name AS regimeName,
               declared_priority AS declaredPriority,
               description, status,
               registered_at AS registeredAt,
               last_transition_at AS lastTransitionAt,
               last_transition_note AS lastTransitionNote
        FROM ml_epistemic_regime_candidates
        WHERE regime_id = ?
    `),
    selectAllRegimes: db.prepare(`
        SELECT id, regime_id AS regimeId, regime_name AS regimeName,
               declared_priority AS declaredPriority,
               description, status,
               registered_at AS registeredAt,
               last_transition_at AS lastTransitionAt,
               last_transition_note AS lastTransitionNote
        FROM ml_epistemic_regime_candidates
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY registered_at ASC
    `),
    selectRegimesByStatus: db.prepare(`
        SELECT id, regime_id AS regimeId, regime_name AS regimeName,
               declared_priority AS declaredPriority,
               description, status,
               registered_at AS registeredAt,
               last_transition_at AS lastTransitionAt,
               last_transition_note AS lastTransitionNote
        FROM ml_epistemic_regime_candidates
        WHERE user_id = ? AND resolved_env = ? AND status = ?
        ORDER BY registered_at ASC
    `),
    updateRegimeStatus: db.prepare(`
        UPDATE ml_epistemic_regime_candidates
        SET status = ?, last_transition_at = ?, last_transition_note = ?
        WHERE regime_id = ? AND user_id = ? AND resolved_env = ?
    `),
    insertEvaluation: db.prepare(`
        INSERT INTO ml_epistemic_regime_evaluations (
            user_id, resolved_env, evaluation_id, regime_id,
            eval_window_start_ts, eval_window_end_ts,
            robustness_score, coherence_score, humility_score,
            speed_score, tail_survival_score, alpha_quality_score,
            composite_score, comparison_baseline_regime_id, verdict, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectEvaluation: db.prepare(`
        SELECT id, evaluation_id AS evaluationId, regime_id AS regimeId,
               eval_window_start_ts AS evalWindowStartTs,
               eval_window_end_ts AS evalWindowEndTs,
               robustness_score AS robustnessScore,
               coherence_score AS coherenceScore,
               humility_score AS humilityScore,
               speed_score AS speedScore,
               tail_survival_score AS tailSurvivalScore,
               alpha_quality_score AS alphaQualityScore,
               composite_score AS compositeScore,
               comparison_baseline_regime_id AS comparisonBaselineRegimeId,
               verdict, ts
        FROM ml_epistemic_regime_evaluations
        WHERE evaluation_id = ?
    `),
    selectLatestEvaluation: db.prepare(`
        SELECT id, evaluation_id AS evaluationId, regime_id AS regimeId,
               eval_window_start_ts AS evalWindowStartTs,
               eval_window_end_ts AS evalWindowEndTs,
               robustness_score AS robustnessScore,
               coherence_score AS coherenceScore,
               humility_score AS humilityScore,
               speed_score AS speedScore,
               tail_survival_score AS tailSurvivalScore,
               alpha_quality_score AS alphaQualityScore,
               composite_score AS compositeScore,
               comparison_baseline_regime_id AS comparisonBaselineRegimeId,
               verdict, ts
        FROM ml_epistemic_regime_evaluations
        WHERE user_id = ? AND resolved_env = ? AND regime_id = ?
        ORDER BY ts DESC
        LIMIT 1
    `)
};

function registerRegime(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const regimeId = _required(params, 'regimeId');
    const regimeName = _required(params, 'regimeName');
    const declaredPriority = _required(params, 'declaredPriority');
    const description = _required(params, 'description');
    const ts = _required(params, 'ts');
    if (!DECLARED_PRIORITIES.includes(declaredPriority)) {
        throw new Error(`§150 invalid declaredPriority: ${declaredPriority}`);
    }
    if (_stmts.selectRegime.get(regimeId)) {
        throw new Error(`§150 duplicate regimeId: ${regimeId}`);
    }
    _stmts.insertRegime.run(
        userId, resolvedEnv, regimeId, regimeName, declaredPriority,
        description, ts, ts, 'initial registration (always quarantined)'
    );
    return { registered: true, regimeId, status: 'quarantined' };
}

function recordEvaluation(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const evaluationId = _required(params, 'evaluationId');
    const regimeId = _required(params, 'regimeId');
    const evalWindowStartTs = _required(params, 'evalWindowStartTs');
    const evalWindowEndTs = _required(params, 'evalWindowEndTs');
    const axes = _required(params, 'axes');
    const ts = _required(params, 'ts');
    const comparisonBaselineRegimeId = params.comparisonBaselineRegimeId ?? null;

    if (evalWindowStartTs > evalWindowEndTs) {
        throw new Error('§150 evalWindowStartTs > evalWindowEndTs');
    }
    if (_stmts.selectEvaluation.get(evaluationId)) {
        throw new Error(`§150 duplicate evaluationId: ${evaluationId}`);
    }

    const { composite } = computeCompositeScore({ axes });
    const { verdict } = classifyVerdict({ compositeScore: composite, axes });

    _stmts.insertEvaluation.run(
        userId, resolvedEnv, evaluationId, regimeId,
        evalWindowStartTs, evalWindowEndTs,
        axes.robustness, axes.coherence, axes.humility,
        axes.speed, axes.tail_survival, axes.alpha_quality,
        composite, comparisonBaselineRegimeId, verdict, ts
    );

    return {
        recorded: true,
        evaluationId, regimeId,
        compositeScore: composite,
        verdict,
        comparisonBaselineRegimeId
    };
}

function transitionRegimeStatus(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const regimeId = _required(params, 'regimeId');
    const newStatus = _required(params, 'newStatus');
    const ts = _required(params, 'ts');
    const note = params.note ?? null;

    const existing = _stmts.selectRegime.get(regimeId);
    if (!existing) {
        throw new Error(`§150 regime not found: ${regimeId}`);
    }
    const fromStatus = existing.status;
    const { valid } = validStatusTransition({ fromStatus, toStatus: newStatus });
    if (!valid) {
        throw new Error(`§150 invalid transition: ${fromStatus} → ${newStatus}`);
    }

    // Verdict gate for promotion (not for rejection — rejection is governance
    // escape hatch regardless of last verdict)
    if (newStatus !== 'rejected') {
        const latestEval = _stmts.selectLatestEvaluation.get(userId, resolvedEnv, regimeId);
        if (!latestEval) {
            throw new Error(`§150 no evaluation found — evaluation required before promotion of ${regimeId}`);
        }
        if (latestEval.verdict === 'fail') {
            throw new Error(`§150 latest verdict=fail — promotion blocked for ${regimeId}`);
        }
        // inconclusive allowed (operator/governance discretion) — only hard
        // fail blocks. Pass freely promotes.
    }

    _stmts.updateRegimeStatus.run(newStatus, ts, note, regimeId, userId, resolvedEnv);
    return {
        transitioned: true,
        regimeId,
        fromStatus,
        toStatus: newStatus
    };
}

function getRegimes(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const status = params.status;
    if (status !== undefined && !REGIME_STATUSES.includes(status)) {
        throw new Error(`§150 invalid status filter: ${status}`);
    }
    return status
        ? _stmts.selectRegimesByStatus.all(userId, resolvedEnv, status)
        : _stmts.selectAllRegimes.all(userId, resolvedEnv);
}

function getLatestEvaluation(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const regimeId = _required(params, 'regimeId');
    const row = _stmts.selectLatestEvaluation.get(userId, resolvedEnv, regimeId);
    return row || null;
}

module.exports = {
    // constants
    DECLARED_PRIORITIES,
    REGIME_STATUSES,
    EVAL_AXES,
    VERDICTS,
    COMPOSITE_WEIGHTS,
    PASS_THRESHOLD,
    FAIL_THRESHOLD,
    MIN_AXIS_FLOOR,
    VALID_TRANSITIONS,
    // pure
    computeCompositeScore,
    classifyVerdict,
    validStatusTransition,
    // DB
    registerRegime,
    recordEvaluation,
    transitionRegimeStatus,
    getRegimes,
    getLatestEvaluation
};

// FILE END §150 metaEpistemicSandbox.js
