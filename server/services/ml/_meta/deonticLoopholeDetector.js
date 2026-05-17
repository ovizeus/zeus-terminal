'use strict';

/**
 * OMEGA Wave 3 §168 — DEONTIC LOOPHOLE DETECTOR / SPIRIT-OF-THE-RULE GUARD.
 *
 * Canonical PDF §168 (ml_brain_canonic.txt lines 5519-5565).
 *
 * "respect regula in fond sau doar ma strecor printre cuvintele ei?"
 *
 * Distinct de:
 *   - §116 constitutionalCharterLayer (R1) — immutable charter principles
 *   - §147 intellectualHonestyAudit        — reason rationalization drift
 *   - §149 purposeDriftDetector            — scope substitution over time
 *
 * §168 = LETTER vs SPIRIT detection per concrete behavior. Pattern library
 *        + auto-enforcement based on circumvention score.
 *
 * 5 canonical loophole patterns (PDF examples 5531-5534):
 *   fragmentation              — split aggressive action into micro-actions
 *   narrow_interpretation      — find narrow read to escape rule
 *   functional_equivalent      — produce same effect via different mechanism
 *   timing_arbitrage           — act just before/after rule window
 *   venue_arbitrage            — move to venue where rule doesn't apply
 *   + custom (catch-all for new patterns)
 *
 * Circumvention score = max(0, letter_compliance - spirit_compliance).
 * Enforcement ladder:
 *   high (>0.60): always blocked (escalates regardless of rule action —
 *                 safety can't permit severe spirit violation)
 *   mid  (>0.40): rule's enforcement_action applied (warn → warned,
 *                 penalize → penalized, block → blocked)
 *   low  (>0.20): warn-level always
 *   < low:        allowed
 *
 * Per canonical PDF rules 5558-5561:
 * - orice regula importanta trebuie sa aiba definit si spiritul, nu doar textul
 * - daca litera respectata dar spiritul violat, comportamentul e blocat/penalizat
 * - loophole exploitation = defect de aliniere, NU ingeniozitate
 *
 * Per-(user × resolved_env) isolated. Server-only.
 */

const { db } = require('../../database');

const ENFORCEMENT_ACTIONS = Object.freeze(['block', 'penalize', 'warn']);
const ENFORCEMENT_TAKEN = Object.freeze([
    'allowed', 'warned', 'penalized', 'blocked'
]);
const LOOPHOLE_PATTERNS = Object.freeze([
    'fragmentation', 'narrow_interpretation',
    'functional_equivalent', 'timing_arbitrage',
    'venue_arbitrage', 'custom'
]);

const CIRCUMVENTION_THRESHOLDS = Object.freeze({
    high: 0.60, mid: 0.40, low: 0.20
});

// Loophole pattern detection regexes — naive heuristic per behavior_label.
// Caller can also pass an explicit `behaviorFeatures` enum override.
const LOOPHOLE_PATTERN_KEYWORDS = Object.freeze({
    fragmentation: [
        /\bsplit\b.*\b(micro|small|fragment)/i,
        /\bfragment(ed|ation)?\b/i,
        /\b\d+\s*(micro-?orders?|sub-?orders?)/i
    ],
    narrow_interpretation: [
        /\bnarrow\s+interpretation/i,
        /\b(edge|loophole)\s+case/i,
        /\binterpret\w*\s+(narrow|strict)/i
    ],
    functional_equivalent: [
        /\bsame\s+(price\s+impact|effect|outcome)/i,
        /\bsynthetic\s+(position|equivalent)/i,
        /\bachieve(d|s)?\s+same\b/i
    ],
    timing_arbitrage: [
        /\b(just\s+before|just\s+after)\b.*\b(window|expir|reset)/i,
        /\b\d+\s*ms\s+(before|after)\b/i,
        /\btiming\s+(arbitrage|window)/i
    ],
    venue_arbitrage: [
        /\b(different|other)\s+venue/i,
        /\bvenue\s+(arbitrage|where)\b/i,
        /\bmoved\s+execution\s+to\b/i
    ]
});

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

function _required(params, key) {
    if (params == null || params[key] == null) {
        throw new Error(`§168 missing required param: ${key}`);
    }
    return params[key];
}
function _requireEnv(env) {
    if (!RESOLVED_ENVS.has(env)) {
        throw new Error(`§168 invalid resolvedEnv: ${env}`);
    }
    return env;
}
function _requireRange01(name, v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`§168 ${name} must be number in [0,1], got ${v}`);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PURE FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

function computeCircumventionScore(params) {
    const letter = _required(params, 'letterCompliance');
    const spirit = _required(params, 'spiritCompliance');
    _requireRange01('letterCompliance', letter);
    _requireRange01('spiritCompliance', spirit);
    const gap = letter - spirit;
    return { circumventionScore: Math.max(0, Math.min(1, gap)) };
}

function classifyEnforcement(params) {
    const circumventionScore = _required(params, 'circumventionScore');
    const ruleEnforcementAction = _required(params, 'ruleEnforcementAction');
    _requireRange01('circumventionScore', circumventionScore);
    if (!ENFORCEMENT_ACTIONS.includes(ruleEnforcementAction)) {
        throw new Error(`§168 invalid ruleEnforcementAction: ${ruleEnforcementAction}`);
    }
    // Below low threshold = clean, always allowed
    if (circumventionScore <= CIRCUMVENTION_THRESHOLDS.low) {
        return { enforcementTaken: 'allowed' };
    }
    // High circumvention always escalates to blocked — safety override
    if (circumventionScore > CIRCUMVENTION_THRESHOLDS.high) {
        return { enforcementTaken: 'blocked' };
    }
    // Mid band: apply rule's enforcement action
    if (circumventionScore > CIRCUMVENTION_THRESHOLDS.mid) {
        const map = { block: 'blocked', penalize: 'penalized', warn: 'warned' };
        return { enforcementTaken: map[ruleEnforcementAction] };
    }
    // Low band: always warn (regardless of rule action)
    return { enforcementTaken: 'warned' };
}

function matchLoopholePattern(params) {
    const behaviorLabel = _required(params, 'behaviorLabel');
    for (const pattern of Object.keys(LOOPHOLE_PATTERN_KEYWORDS)) {
        for (const re of LOOPHOLE_PATTERN_KEYWORDS[pattern]) {
            if (re.test(behaviorLabel)) {
                return { pattern };
            }
        }
    }
    return { pattern: null };
}

// ──────────────────────────────────────────────────────────────────────────
// DB-BOUND FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

const _stmts = {
    insertRule: db.prepare(`
        INSERT INTO ml_deontic_rule_registry (
            user_id, resolved_env, rule_id, rule_label, letter_text,
            spirit_text, enforcement_action, active, registered_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
    `),
    selectRule: db.prepare(`
        SELECT id, rule_id AS ruleId, rule_label AS ruleLabel,
               letter_text AS letterText, spirit_text AS spiritText,
               enforcement_action AS enforcementAction,
               active, registered_at AS registeredAt
        FROM ml_deontic_rule_registry
        WHERE rule_id = ?
    `),
    selectActiveRules: db.prepare(`
        SELECT id, rule_id AS ruleId, rule_label AS ruleLabel,
               letter_text AS letterText, spirit_text AS spiritText,
               enforcement_action AS enforcementAction,
               active, registered_at AS registeredAt
        FROM ml_deontic_rule_registry
        WHERE user_id = ? AND resolved_env = ? AND active = 1
        ORDER BY registered_at ASC
    `),
    insertDetection: db.prepare(`
        INSERT INTO ml_loophole_detections (
            user_id, resolved_env, detection_id, rule_id, behavior_label,
            letter_compliance, spirit_compliance, compliance_circumvention_score,
            loophole_pattern_matched, enforcement_taken, reasoning, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectDetection: db.prepare(`
        SELECT id, detection_id AS detectionId, rule_id AS ruleId,
               behavior_label AS behaviorLabel,
               letter_compliance AS letterCompliance,
               spirit_compliance AS spiritCompliance,
               compliance_circumvention_score AS complianceCircumventionScore,
               loophole_pattern_matched AS loopholePatternMatched,
               enforcement_taken AS enforcementTaken,
               reasoning, ts
        FROM ml_loophole_detections
        WHERE detection_id = ?
    `),
    selectAllDetections: db.prepare(`
        SELECT id, detection_id AS detectionId, rule_id AS ruleId,
               behavior_label AS behaviorLabel,
               letter_compliance AS letterCompliance,
               spirit_compliance AS spiritCompliance,
               compliance_circumvention_score AS complianceCircumventionScore,
               loophole_pattern_matched AS loopholePatternMatched,
               enforcement_taken AS enforcementTaken,
               reasoning, ts
        FROM ml_loophole_detections
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
    `),
    selectDetectionsByEnforcement: db.prepare(`
        SELECT id, detection_id AS detectionId, rule_id AS ruleId,
               behavior_label AS behaviorLabel,
               letter_compliance AS letterCompliance,
               spirit_compliance AS spiritCompliance,
               compliance_circumvention_score AS complianceCircumventionScore,
               loophole_pattern_matched AS loopholePatternMatched,
               enforcement_taken AS enforcementTaken,
               reasoning, ts
        FROM ml_loophole_detections
        WHERE user_id = ? AND resolved_env = ? AND enforcement_taken = ?
        ORDER BY ts DESC
    `),
    countAllInWindow: db.prepare(`
        SELECT compliance_circumvention_score AS score
        FROM ml_loophole_detections
        WHERE user_id = ? AND resolved_env = ? AND ts >= ?
    `)
};

function registerRule(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const ruleId = _required(params, 'ruleId');
    const ruleLabel = _required(params, 'ruleLabel');
    const letterText = _required(params, 'letterText');
    const spiritText = _required(params, 'spiritText');
    const enforcementAction = _required(params, 'enforcementAction');
    const ts = _required(params, 'ts');

    if (!ENFORCEMENT_ACTIONS.includes(enforcementAction)) {
        throw new Error(`§168 invalid enforcementAction: ${enforcementAction}`);
    }
    if (_stmts.selectRule.get(ruleId)) {
        throw new Error(`§168 duplicate ruleId: ${ruleId}`);
    }
    _stmts.insertRule.run(
        userId, resolvedEnv, ruleId, ruleLabel, letterText, spiritText,
        enforcementAction, ts
    );
    return { registered: true, ruleId, active: 1 };
}

function recordLoopholeDetection(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const detectionId = _required(params, 'detectionId');
    const ruleId = _required(params, 'ruleId');
    const behaviorLabel = _required(params, 'behaviorLabel');
    const letterCompliance = _required(params, 'letterCompliance');
    const spiritCompliance = _required(params, 'spiritCompliance');
    const ts = _required(params, 'ts');
    const reasoning = params.reasoning ?? null;

    if (_stmts.selectDetection.get(detectionId)) {
        throw new Error(`§168 duplicate detectionId: ${detectionId}`);
    }
    const rule = _stmts.selectRule.get(ruleId);
    if (!rule) {
        throw new Error(`§168 rule not found: ${ruleId}`);
    }

    const { circumventionScore } = computeCircumventionScore({
        letterCompliance, spiritCompliance
    });
    const { pattern: loopholePatternMatched } = matchLoopholePattern({
        behaviorLabel
    });
    const { enforcementTaken } = classifyEnforcement({
        circumventionScore,
        ruleEnforcementAction: rule.enforcementAction
    });

    _stmts.insertDetection.run(
        userId, resolvedEnv, detectionId, ruleId, behaviorLabel,
        letterCompliance, spiritCompliance, circumventionScore,
        loopholePatternMatched, enforcementTaken, reasoning, ts
    );

    return {
        recorded: true,
        detectionId, ruleId,
        circumventionScore,
        loopholePatternMatched,
        enforcementTaken
    };
}

function getActiveRules(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    return _stmts.selectActiveRules.all(userId, resolvedEnv);
}

function getRecentDetections(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const enforcementTaken = params.enforcementTaken;
    if (enforcementTaken !== undefined && !ENFORCEMENT_TAKEN.includes(enforcementTaken)) {
        throw new Error(`§168 invalid enforcementTaken filter: ${enforcementTaken}`);
    }
    return enforcementTaken
        ? _stmts.selectDetectionsByEnforcement.all(userId, resolvedEnv, enforcementTaken)
        : _stmts.selectAllDetections.all(userId, resolvedEnv);
}

function countCircumventionBySeverity(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const sinceTs = _required(params, 'sinceTs');
    const rows = _stmts.countAllInWindow.all(userId, resolvedEnv, sinceTs);
    const stats = { high: 0, mid: 0, low: 0, below_threshold: 0, totalCount: 0 };
    for (const r of rows) {
        stats.totalCount += 1;
        if (r.score > CIRCUMVENTION_THRESHOLDS.high) stats.high += 1;
        else if (r.score > CIRCUMVENTION_THRESHOLDS.mid) stats.mid += 1;
        else if (r.score > CIRCUMVENTION_THRESHOLDS.low) stats.low += 1;
        else stats.below_threshold += 1;
    }
    return stats;
}

module.exports = {
    // constants
    ENFORCEMENT_ACTIONS,
    ENFORCEMENT_TAKEN,
    LOOPHOLE_PATTERNS,
    CIRCUMVENTION_THRESHOLDS,
    LOOPHOLE_PATTERN_KEYWORDS,
    // pure
    computeCircumventionScore,
    classifyEnforcement,
    matchLoopholePattern,
    // DB
    registerRule,
    recordLoopholeDetection,
    getActiveRules,
    getRecentDetections,
    countCircumventionBySeverity
};

// FILE END §168 deonticLoopholeDetector.js
