'use strict';

/**
 * OMEGA Wave 3 §159 — SELF-KNOWLEDGE REPORT / HOW-I-THINK INTERPRETER.
 *
 * Canonical PDF §159 (ml_brain_canonic.txt lines 5337-5368).
 *
 * "cum am gandit concret, nu doar ce am decis?"
 *
 * Distinct de:
 *   - §17  attribution                    — post-trade attribution
 *   - §25  explainability (cross-cutting) — SHAP/feature importance
 *   - §43  noTradeExplainability          — why-no-trade
 *   - §147 intellectualHonestyAudit       — reason drift (rationalization)
 *   - §148 ontologicalHumility            — reality exceeds model
 *   - §158 autobiographicalContinuity     — narrative cross-events
 *
 * §159 = NARATIVUL GÂNDIRII per decizie. 6 explanation layers + 4
 * distinctions + auto-completeness + inventiveness flag (anti-"se
 * inventeaza pe sine").
 *
 * 6 explanation layers (PDF lines 5345-5350):
 *   what_i_saw | what_i_inferred | what_i_assumed |
 *   what_i_doubted | what_changed_my_mind | what_limited_my_action
 *
 * 4 distinctions (PDF lines 5351-5355):
 *   reasoning_path_used | alternative_paths_rejected |
 *   missing_information | blocked_authority
 *
 * Inventiveness flag — naive heuristic detection pentru rapoarte
 * fabricate (toate layerele identice length, generic phrasing,
 * lipsa de specific). Per PDF rule 5368: "fără să se inventeze."
 *
 * Per-(user × resolved_env) isolated. Server-only.
 */

const { db } = require('../../database');

const EXPLANATION_LAYERS = Object.freeze([
    'what_i_saw', 'what_i_inferred', 'what_i_assumed',
    'what_i_doubted', 'what_changed_my_mind', 'what_limited_my_action'
]);
const DISTINCTIONS = Object.freeze([
    'reasoning_path_used', 'alternative_paths_rejected',
    'missing_information', 'blocked_authority'
]);
const OUTPUT_TYPES = Object.freeze([
    'short_summary', 'deep_explanation',
    'self_criticism', 'self_limitation'
]);

// Patterns that signal generic / fabricated reasoning text
const INVENTIVENESS_GENERIC_PATTERNS = Object.freeze([
    /\bsomething (happened|occurred|took place)\b/i,
    /\bthe system (thought|decided|analyzed) (about it )?(carefully|wisely)?\b/i,
    /\b(various|some|several) things\b/i,
    /\bmade a decision based on analysis\b/i,
    /\banalysis (was performed|was made|was conducted)\b/i,
    /\bthe (correct|right|appropriate) (choice|decision) was made\b/i
]);

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

function _required(params, key) {
    if (params == null || params[key] == null) {
        throw new Error(`§159 missing required param: ${key}`);
    }
    return params[key];
}
function _requireEnv(env) {
    if (!RESOLVED_ENVS.has(env)) {
        throw new Error(`§159 invalid resolvedEnv: ${env}`);
    }
    return env;
}
function _requireArray(name, v) {
    if (!Array.isArray(v)) {
        throw new Error(`§159 ${name} must be array`);
    }
}

function _isPopulatedArray(v) {
    return Array.isArray(v) && v.length > 0;
}
function _isPopulatedText(v) {
    return typeof v === 'string' && v.trim().length > 0;
}

// ──────────────────────────────────────────────────────────────────────────
// PURE FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

function computeCompletenessScore(params) {
    const checks = [
        _isPopulatedArray(params.whatISaw),
        _isPopulatedArray(params.whatIInferred),
        _isPopulatedArray(params.whatIAssumed),
        _isPopulatedArray(params.whatIDoubted),
        _isPopulatedText(params.whatChangedMyMind),
        _isPopulatedArray(params.whatLimitedMyAction),
        _isPopulatedText(params.reasoningPathUsed),
        _isPopulatedArray(params.alternativePathsRejected),
        _isPopulatedArray(params.missingInformation),
        _isPopulatedText(params.blockedAuthority)
    ];
    const populatedCount = checks.filter(Boolean).length;
    const totalChecks = checks.length;
    return {
        score: populatedCount / totalChecks,
        populatedCount,
        totalChecks
    };
}

function detectInventiveness(params) {
    const layers = [
        params.whatISaw, params.whatIInferred,
        params.whatIAssumed, params.whatIDoubted
    ];
    // Skip detection when most layers empty (just incomplete, not invented)
    const populatedLayers = layers.filter(l => Array.isArray(l) && l.length > 0);
    if (populatedLayers.length < 3) {
        return { flag: 0, reason: null };
    }

    // Check 1: all layers identical content (suspect)
    const flat = populatedLayers
        .map(l => l.join(' | ').toLowerCase().trim())
        .filter(s => s.length > 0);
    if (flat.length >= 3) {
        const allSame = flat.every(s => s === flat[0]);
        if (allSame) {
            return {
                flag: 1,
                reason: 'all explanation layers contain identical content'
            };
        }
    }

    // Check 2: generic phrasing matches
    const allText = [
        ...layers.flatMap(l => Array.isArray(l) ? l : []),
        params.shortSummary || ''
    ].join(' ');
    for (const re of INVENTIVENESS_GENERIC_PATTERNS) {
        if (re.test(allText)) {
            return {
                flag: 1,
                reason: `generic phrasing detected matching pattern: ${re.source}`
            };
        }
    }

    return { flag: 0, reason: null };
}

function summarizeReport(params) {
    const report = _required(params, 'report');
    const observationsCount = Array.isArray(report.whatISaw) ? report.whatISaw.length : 0;
    const inferencesCount = Array.isArray(report.whatIInferred) ? report.whatIInferred.length : 0;
    const doubtsCount = Array.isArray(report.whatIDoubted) ? report.whatIDoubted.length : 0;
    const summary = report.shortSummary || '';
    const headlineDecisionPath = report.reasoningPathUsed || '';
    return {
        summary,
        headlineDecisionPath,
        observationsCount,
        inferencesCount,
        doubtsCount
    };
}

// ──────────────────────────────────────────────────────────────────────────
// DB-BOUND FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

const _stmts = {
    insertReport: db.prepare(`
        INSERT INTO ml_self_knowledge_reports (
            user_id, resolved_env, report_id, decision_id, what_i_saw_json,
            what_i_inferred_json, what_i_assumed_json, what_i_doubted_json,
            what_changed_my_mind_text, what_limited_my_action_json,
            reasoning_path_used, alternative_paths_rejected_json,
            missing_information_json, blocked_authority_text, short_summary,
            completeness_score, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectReport: db.prepare(`
        SELECT id, report_id AS reportId, decision_id AS decisionId,
               what_i_saw_json AS whatISawJson,
               what_i_inferred_json AS whatIInferredJson,
               what_i_assumed_json AS whatIAssumedJson,
               what_i_doubted_json AS whatIDoubtedJson,
               what_changed_my_mind_text AS whatChangedMyMindText,
               what_limited_my_action_json AS whatLimitedMyActionJson,
               reasoning_path_used AS reasoningPathUsed,
               alternative_paths_rejected_json AS alternativePathsRejectedJson,
               missing_information_json AS missingInformationJson,
               blocked_authority_text AS blockedAuthorityText,
               short_summary AS shortSummary,
               completeness_score AS completenessScore,
               ts
        FROM ml_self_knowledge_reports
        WHERE report_id = ?
    `),
    selectReportsForDecision: db.prepare(`
        SELECT id, report_id AS reportId, decision_id AS decisionId,
               what_i_saw_json AS whatISawJson,
               what_i_inferred_json AS whatIInferredJson,
               what_i_assumed_json AS whatIAssumedJson,
               what_i_doubted_json AS whatIDoubtedJson,
               what_changed_my_mind_text AS whatChangedMyMindText,
               what_limited_my_action_json AS whatLimitedMyActionJson,
               reasoning_path_used AS reasoningPathUsed,
               alternative_paths_rejected_json AS alternativePathsRejectedJson,
               missing_information_json AS missingInformationJson,
               blocked_authority_text AS blockedAuthorityText,
               short_summary AS shortSummary,
               completeness_score AS completenessScore,
               ts
        FROM ml_self_knowledge_reports
        WHERE user_id = ? AND resolved_env = ? AND decision_id = ?
        ORDER BY ts ASC
    `),
    insertCritique: db.prepare(`
        INSERT INTO ml_self_knowledge_critique (
            user_id, resolved_env, critique_id, report_id, self_criticism_text,
            self_limitation_text, inventiveness_flag, inventiveness_reason, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectCritique: db.prepare(`
        SELECT id, critique_id AS critiqueId, report_id AS reportId,
               self_criticism_text AS selfCriticismText,
               self_limitation_text AS selfLimitationText,
               inventiveness_flag AS inventivenessFlag,
               inventiveness_reason AS inventivenessReason, ts
        FROM ml_self_knowledge_critique
        WHERE critique_id = ?
    `),
    selectLatestCritique: db.prepare(`
        SELECT id, critique_id AS critiqueId, report_id AS reportId,
               self_criticism_text AS selfCriticismText,
               self_limitation_text AS selfLimitationText,
               inventiveness_flag AS inventivenessFlag,
               inventiveness_reason AS inventivenessReason, ts
        FROM ml_self_knowledge_critique
        WHERE user_id = ? AND resolved_env = ? AND report_id = ?
        ORDER BY ts DESC
        LIMIT 1
    `)
};

function recordSelfKnowledgeReport(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const reportId = _required(params, 'reportId');
    const decisionId = _required(params, 'decisionId');
    const whatISaw = _required(params, 'whatISaw');
    const whatIInferred = _required(params, 'whatIInferred');
    const whatIAssumed = _required(params, 'whatIAssumed');
    const whatIDoubted = _required(params, 'whatIDoubted');
    const whatLimitedMyAction = _required(params, 'whatLimitedMyAction');
    const reasoningPathUsed = _required(params, 'reasoningPathUsed');
    const alternativePathsRejected = _required(params, 'alternativePathsRejected');
    const missingInformation = _required(params, 'missingInformation');
    const shortSummary = _required(params, 'shortSummary');
    const ts = _required(params, 'ts');
    const whatChangedMyMind = params.whatChangedMyMind ?? null;
    const blockedAuthority = params.blockedAuthority ?? null;

    _requireArray('whatISaw', whatISaw);
    _requireArray('whatIInferred', whatIInferred);
    _requireArray('whatIAssumed', whatIAssumed);
    _requireArray('whatIDoubted', whatIDoubted);
    _requireArray('whatLimitedMyAction', whatLimitedMyAction);
    _requireArray('alternativePathsRejected', alternativePathsRejected);
    _requireArray('missingInformation', missingInformation);

    if (_stmts.selectReport.get(reportId)) {
        throw new Error(`§159 duplicate reportId: ${reportId}`);
    }

    const { score: completenessScore } = computeCompletenessScore({
        whatISaw, whatIInferred, whatIAssumed, whatIDoubted,
        whatChangedMyMind, whatLimitedMyAction,
        reasoningPathUsed, alternativePathsRejected,
        missingInformation, blockedAuthority
    });

    _stmts.insertReport.run(
        userId, resolvedEnv, reportId, decisionId,
        JSON.stringify(whatISaw), JSON.stringify(whatIInferred),
        JSON.stringify(whatIAssumed), JSON.stringify(whatIDoubted),
        whatChangedMyMind, JSON.stringify(whatLimitedMyAction),
        reasoningPathUsed, JSON.stringify(alternativePathsRejected),
        JSON.stringify(missingInformation), blockedAuthority,
        shortSummary, completenessScore, ts
    );

    return {
        recorded: true,
        reportId, decisionId,
        completenessScore
    };
}

function recordSelfKnowledgeCritique(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const critiqueId = _required(params, 'critiqueId');
    const reportId = _required(params, 'reportId');
    const selfCriticism = _required(params, 'selfCriticism');
    const selfLimitation = _required(params, 'selfLimitation');
    const ts = _required(params, 'ts');

    if (_stmts.selectCritique.get(critiqueId)) {
        throw new Error(`§159 duplicate critiqueId: ${critiqueId}`);
    }

    const reportRow = _stmts.selectReport.get(reportId);
    if (!reportRow) {
        throw new Error(`§159 report not found: ${reportId}`);
    }

    // Auto-detect inventiveness from referenced report payload
    const { flag, reason } = detectInventiveness({
        whatISaw: JSON.parse(reportRow.whatISawJson),
        whatIInferred: JSON.parse(reportRow.whatIInferredJson),
        whatIAssumed: JSON.parse(reportRow.whatIAssumedJson),
        whatIDoubted: JSON.parse(reportRow.whatIDoubtedJson),
        shortSummary: reportRow.shortSummary
    });

    _stmts.insertCritique.run(
        userId, resolvedEnv, critiqueId, reportId,
        selfCriticism, selfLimitation, flag, reason, ts
    );

    return {
        recorded: true,
        critiqueId, reportId,
        inventivenessFlag: flag,
        inventivenessReason: reason
    };
}

function getReportsForDecision(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const decisionId = _required(params, 'decisionId');
    return _stmts.selectReportsForDecision.all(userId, resolvedEnv, decisionId);
}

function getLatestCritique(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const reportId = _required(params, 'reportId');
    const row = _stmts.selectLatestCritique.get(userId, resolvedEnv, reportId);
    return row || null;
}

module.exports = {
    // constants
    EXPLANATION_LAYERS,
    DISTINCTIONS,
    OUTPUT_TYPES,
    INVENTIVENESS_GENERIC_PATTERNS,
    // pure
    computeCompletenessScore,
    detectInventiveness,
    summarizeReport,
    // DB
    recordSelfKnowledgeReport,
    recordSelfKnowledgeCritique,
    getReportsForDecision,
    getLatestCritique
};

// FILE END §159 selfKnowledgeReport.js
