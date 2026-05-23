'use strict';

/**
 * OMEGA Wave 3 §177 — EPISTEMIC METABOLISM ENGINE / HOW-FAST-CAN-I-DIGEST-TRUTH.
 *
 * Canonical PDF §177 (ml_brain_canonic.txt lines 5730-5789).
 *
 * "cat de repede am voie sa transform ce tocmai am vazut in adevar operational?"
 *
 * 5 knowledge types (PDF lines 5759-5763):
 *   new_pattern | new_rule | new_concept |
 *   new_causal_relation | ontological_change
 *
 * 4 digestion stages (PDF lines 5765-5768) — progressive maturity ladder:
 *   observed → metabolized → stabilized → constitutionalized
 *
 * 3 indigestion patterns (PDF lines 5770-5772):
 *   premature_integration  — skip stage(s) without sufficient observations
 *   overloaded_revision    — too many concurrent revisions in flight
 *   unstable_concept_absorption — low ontology compatibility absorbed too far
 *
 * 3 modes (PDF lines 5773-5774):
 *   slow_cook         — for heavy ideas with weak support
 *   standard          — middle band
 *   fast_assimilation — only for shocks with overwhelming evidence
 *
 * Assimilation rate formula:
 *   rate = 0.30*empirical_support + 0.30*ontology_compatibility
 *        + 0.20*(1-cost_of_error) + 0.20*severity
 *   empirical_support + compatibility dominant (0.60 combined) — what
 *   the evidence says. cost_of_error inverted (high cost slows). severity
 *   moderate weight (high-severity discoveries deserve attention but only
 *   if backed by evidence).
 *
 * Per canonical rules 5782-5785:
 * - nu toate adevarurile noi merita digerate la acelasi ritm
 * - idei incompatibile cu ontologia → metabolism lent + quarantine
 * - șocuri structurale reale → metabolism rapid, dar cu audit
 *
 * Plasare R5A_learning pentru control viteza învățării. Per-(user × env)
 * isolated. Server-only.
 */

const { db } = require('../../database');

const KNOWLEDGE_TYPES = Object.freeze([
    'new_pattern', 'new_rule', 'new_concept',
    'new_causal_relation', 'ontological_change'
]);
const DIGESTION_STAGES = Object.freeze([
    'observed', 'metabolized', 'stabilized', 'constitutionalized'
]);
const INDIGESTION_TYPES = Object.freeze([
    'premature_integration', 'overloaded_revision',
    'unstable_concept_absorption'
]);
const METABOLISM_MODES = Object.freeze([
    'slow_cook', 'standard', 'fast_assimilation'
]);

const RATE_THRESHOLDS = Object.freeze({
    fast: 0.70, slow: 0.30
});

// Premature integration: skipping >1 stage with insufficient observations
const PREMATURE_INTEGRATION_MIN_OBSERVATIONS = 10;
// Overloaded revision: >5 concurrent revisions in flight
const OVERLOADED_REVISION_THRESHOLD = 5;
// Unstable concept absorption: ontology compatibility below this and
// requested stage past 'observed'
const UNSTABLE_COMPATIBILITY_THRESHOLD = 0.30;

const STAGE_INDEX = Object.freeze({
    observed: 0, metabolized: 1, stabilized: 2, constitutionalized: 3
});

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

function _required(params, key) {
    if (params == null || params[key] == null) {
        throw new Error(`§177 missing required param: ${key}`);
    }
    return params[key];
}
function _requireEnv(env) {
    if (!RESOLVED_ENVS.has(env)) {
        throw new Error(`§177 invalid resolvedEnv: ${env}`);
    }
    return env;
}
function _requireRange01(name, v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`§177 ${name} must be number in [0,1], got ${v}`);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PURE FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

function computeAssimilationRate(params) {
    const severity = _required(params, 'severity');
    const empiricalSupport = _required(params, 'empiricalSupport');
    const costOfError = _required(params, 'costOfError');
    const ontologyCompatibility = _required(params, 'ontologyCompatibility');
    _requireRange01('severity', severity);
    _requireRange01('empiricalSupport', empiricalSupport);
    _requireRange01('costOfError', costOfError);
    _requireRange01('ontologyCompatibility', ontologyCompatibility);
    const rate = 0.30 * empiricalSupport
               + 0.30 * ontologyCompatibility
               + 0.20 * (1 - costOfError)
               + 0.20 * severity;
    return { assimilationRate: Math.max(0, Math.min(1, rate)) };
}

function classifyMode(params) {
    const assimilationRate = _required(params, 'assimilationRate');
    _requireRange01('assimilationRate', assimilationRate);
    if (assimilationRate >= RATE_THRESHOLDS.fast) {
        return { mode: 'fast_assimilation' };
    }
    if (assimilationRate < RATE_THRESHOLDS.slow) {
        return { mode: 'slow_cook' };
    }
    return { mode: 'standard' };
}

function detectIndigestion(params) {
    const currentStage = _required(params, 'currentStage');
    const requestedStage = _required(params, 'requestedStage');
    const supportingObservationsCount = _required(params, 'supportingObservationsCount');
    const ontologyCompatibility = _required(params, 'ontologyCompatibility');
    const concurrentRevisionsCount = params.concurrentRevisionsCount ?? 0;

    if (STAGE_INDEX[currentStage] === undefined) {
        throw new Error(`§177 invalid currentStage: ${currentStage}`);
    }
    if (STAGE_INDEX[requestedStage] === undefined) {
        throw new Error(`§177 invalid requestedStage: ${requestedStage}`);
    }
    _requireRange01('ontologyCompatibility', ontologyCompatibility);

    const stageGap = STAGE_INDEX[requestedStage] - STAGE_INDEX[currentStage];

    // 1. Premature integration: jumping >1 stage with weak observations
    if (stageGap > 1 && supportingObservationsCount < PREMATURE_INTEGRATION_MIN_OBSERVATIONS) {
        return {
            indigestionFlag: 1,
            indigestionType: 'premature_integration'
        };
    }
    // 2. Overloaded revision: too many concurrent
    if (concurrentRevisionsCount > OVERLOADED_REVISION_THRESHOLD) {
        return {
            indigestionFlag: 1,
            indigestionType: 'overloaded_revision'
        };
    }
    // 3. Unstable concept absorption: low compatibility but trying to
    //    progress past observed
    if (stageGap > 0
        && requestedStage !== 'observed'
        && ontologyCompatibility < UNSTABLE_COMPATIBILITY_THRESHOLD) {
        return {
            indigestionFlag: 1,
            indigestionType: 'unstable_concept_absorption'
        };
    }
    return { indigestionFlag: 0, indigestionType: null };
}

function recommendNextStage(params) {
    const currentStage = _required(params, 'currentStage');
    const assimilationRate = _required(params, 'assimilationRate');
    if (STAGE_INDEX[currentStage] === undefined) {
        throw new Error(`§177 invalid currentStage: ${currentStage}`);
    }
    _requireRange01('assimilationRate', assimilationRate);
    if (currentStage === 'constitutionalized') {
        return { nextStage: 'constitutionalized' };
    }
    // Advance only when rate >= fast threshold; else stay
    if (assimilationRate >= RATE_THRESHOLDS.fast) {
        const nextIdx = STAGE_INDEX[currentStage] + 1;
        const stages = ['observed', 'metabolized', 'stabilized', 'constitutionalized'];
        return { nextStage: stages[nextIdx] };
    }
    return { nextStage: currentStage };
}

// ──────────────────────────────────────────────────────────────────────────
// DB-BOUND FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

const _stmts = {
    insertAssimilation: db.prepare(`
        INSERT INTO ml_epistemic_metabolism_assimilations (
            user_id, resolved_env, assimilation_id, knowledge_label,
            knowledge_type, current_stage, severity, empirical_support,
            cost_of_error, ontology_compatibility, assimilation_rate,
            recommended_mode, indigestion_flag, indigestion_type, reasoning, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectAssimilation: db.prepare(`
        SELECT id, assimilation_id AS assimilationId,
               knowledge_label AS knowledgeLabel,
               knowledge_type AS knowledgeType,
               current_stage AS currentStage,
               severity, empirical_support AS empiricalSupport,
               cost_of_error AS costOfError,
               ontology_compatibility AS ontologyCompatibility,
               assimilation_rate AS assimilationRate,
               recommended_mode AS recommendedMode,
               indigestion_flag AS indigestionFlag,
               indigestion_type AS indigestionType,
               reasoning, ts
        FROM ml_epistemic_metabolism_assimilations
        WHERE assimilation_id = ?
    `),
    selectAllRecent: db.prepare(`
        SELECT id, assimilation_id AS assimilationId,
               knowledge_label AS knowledgeLabel,
               knowledge_type AS knowledgeType,
               current_stage AS currentStage,
               assimilation_rate AS assimilationRate,
               recommended_mode AS recommendedMode,
               indigestion_flag AS indigestionFlag,
               indigestion_type AS indigestionType, ts
        FROM ml_epistemic_metabolism_assimilations
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
    `),
    selectByStage: db.prepare(`
        SELECT id, assimilation_id AS assimilationId,
               knowledge_label AS knowledgeLabel,
               knowledge_type AS knowledgeType,
               current_stage AS currentStage,
               assimilation_rate AS assimilationRate,
               recommended_mode AS recommendedMode,
               indigestion_flag AS indigestionFlag,
               indigestion_type AS indigestionType, ts
        FROM ml_epistemic_metabolism_assimilations
        WHERE user_id = ? AND resolved_env = ? AND current_stage = ?
        ORDER BY ts DESC
    `),
    countByStage: db.prepare(`
        SELECT current_stage AS currentStage, COUNT(*) AS count
        FROM ml_epistemic_metabolism_assimilations
        WHERE user_id = ? AND resolved_env = ? AND ts >= ?
        GROUP BY current_stage
    `),
    countByIndigestion: db.prepare(`
        SELECT indigestion_type AS indigestionType, COUNT(*) AS count
        FROM ml_epistemic_metabolism_assimilations
        WHERE user_id = ? AND resolved_env = ? AND ts >= ? AND indigestion_flag = 1
        GROUP BY indigestion_type
    `),
    countAllInWindow: db.prepare(`
        SELECT COUNT(*) AS count
        FROM ml_epistemic_metabolism_assimilations
        WHERE user_id = ? AND resolved_env = ? AND ts >= ? AND indigestion_flag = 1
    `)
};

function recordAssimilation(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const assimilationId = _required(params, 'assimilationId');
    const knowledgeLabel = _required(params, 'knowledgeLabel');
    const knowledgeType = _required(params, 'knowledgeType');
    const currentStage = _required(params, 'currentStage');
    const severity = _required(params, 'severity');
    const empiricalSupport = _required(params, 'empiricalSupport');
    const costOfError = _required(params, 'costOfError');
    const ontologyCompatibility = _required(params, 'ontologyCompatibility');
    const ts = _required(params, 'ts');
    const reasoning = params.reasoning ?? null;
    const requestedStage = params.requestedStage ?? currentStage;
    const supportingObservationsCount = params.supportingObservationsCount ?? 0;
    const concurrentRevisionsCount = params.concurrentRevisionsCount ?? 0;

    if (!KNOWLEDGE_TYPES.includes(knowledgeType)) {
        throw new Error(`§177 invalid knowledgeType: ${knowledgeType}`);
    }
    if (!DIGESTION_STAGES.includes(currentStage)) {
        throw new Error(`§177 invalid currentStage: ${currentStage}`);
    }
    if (_stmts.selectAssimilation.get(assimilationId)) {
        throw new Error(`§177 duplicate assimilationId: ${assimilationId}`);
    }

    const { assimilationRate } = computeAssimilationRate({
        severity, empiricalSupport, costOfError, ontologyCompatibility
    });
    const { mode: recommendedMode } = classifyMode({ assimilationRate });
    const { indigestionFlag, indigestionType } = detectIndigestion({
        currentStage, requestedStage,
        supportingObservationsCount,
        ontologyCompatibility,
        concurrentRevisionsCount
    });

    _stmts.insertAssimilation.run(
        userId, resolvedEnv, assimilationId, knowledgeLabel,
        knowledgeType, currentStage, severity, empiricalSupport,
        costOfError, ontologyCompatibility, assimilationRate,
        recommendedMode, indigestionFlag, indigestionType, reasoning, ts
    );

    return {
        recorded: true,
        assimilationId, knowledgeLabel,
        assimilationRate, recommendedMode,
        indigestionFlag, indigestionType
    };
}

function getRecentAssimilations(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const currentStage = params.currentStage;
    if (currentStage !== undefined && !DIGESTION_STAGES.includes(currentStage)) {
        throw new Error(`§177 invalid currentStage filter: ${currentStage}`);
    }
    return currentStage
        ? _stmts.selectByStage.all(userId, resolvedEnv, currentStage)
        : _stmts.selectAllRecent.all(userId, resolvedEnv);
}

function getStageStats(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const sinceTs = _required(params, 'sinceTs');
    const rows = _stmts.countByStage.all(userId, resolvedEnv, sinceTs);
    const stats = {
        observed: 0, metabolized: 0, stabilized: 0,
        constitutionalized: 0, totalCount: 0
    };
    for (const r of rows) {
        stats[r.currentStage] = r.count;
        stats.totalCount += r.count;
    }
    return stats;
}

function getIndigestionStats(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const sinceTs = _required(params, 'sinceTs');
    const rows = _stmts.countByIndigestion.all(userId, resolvedEnv, sinceTs);
    const totalRow = _stmts.countAllInWindow.get(userId, resolvedEnv, sinceTs);
    const stats = {
        premature_integration: 0, overloaded_revision: 0,
        unstable_concept_absorption: 0,
        totalCount: totalRow.count
    };
    for (const r of rows) {
        if (r.indigestionType) {
            stats[r.indigestionType] = r.count;
        }
    }
    return stats;
}

module.exports = {
    // constants
    KNOWLEDGE_TYPES,
    DIGESTION_STAGES,
    INDIGESTION_TYPES,
    METABOLISM_MODES,
    RATE_THRESHOLDS,
    PREMATURE_INTEGRATION_MIN_OBSERVATIONS,
    OVERLOADED_REVISION_THRESHOLD,
    UNSTABLE_COMPATIBILITY_THRESHOLD,
    // pure
    computeAssimilationRate,
    classifyMode,
    detectIndigestion,
    recommendNextStage,
    // DB
    recordAssimilation,
    getRecentAssimilations,
    getStageStats,
    getIndigestionStats
};

// FILE END §177 epistemicMetabolismEngine.js
