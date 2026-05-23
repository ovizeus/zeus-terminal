'use strict';

/**
 * OMEGA Wave 3 §180 — ANTI-IDOLATRY ENGINE / NO-MODEL-DESERVES-WORSHIP.
 *
 * Canonical PDF §180 (ml_brain_canonic.txt lines 5887-5926).
 *
 * "mai cred in componenta asta pentru ca functioneaza acum sau pentru ca
 *  am ajuns sa o veneram?"
 *
 * 4 component types tracked:
 *   model | concept | source | detector
 *
 * 3 canonical classifications (PDF lines 5907-5910):
 *   proven_high_value_component     — earned + still performing
 *   prestigious_but_accountable     — high reputation, ongoing accountability
 *   untouchable_idol (FORBIDDEN)    — what this engine PREVENTS
 *
 * Idol detection: prestige-to-contribution ratio ≥ IDOL_DETECTION_RATIO
 * (2.0). Per PDF rule 5920: "niciun model nu castiga imunitate." Per
 * rule 5921: "reputatia istorica poate CRESTE scrutiny-ul, nu doar
 * protectia."
 *
 * Challenge requirement triggers:
 *   - untouchable_idol → always
 *   - prestigious_but_accountable → if last audit > 14 days
 *   - proven_high_value_component → if last audit > 30 days
 *
 * Plasament _audit (alongside epistemicProvenance, sourceAblationRobustness,
 * outcomeBlindPolicyJudge) — audit/governance function.
 *
 * Per-(user × resolved_env) isolated. Server-only.
 */

const { db } = require('../../database');

const COMPONENT_TYPES = Object.freeze([
    'model', 'concept', 'source', 'detector'
]);
const CLASSIFICATIONS = Object.freeze([
    'proven_high_value_component',
    'prestigious_but_accountable',
    'untouchable_idol'
]);

const IDOL_DETECTION_RATIO = 2.0;
const ACCOUNTABLE_THRESHOLD_RATIO = 1.2;  // ratio gap above 1.2 triggers "still accountable"
const ACCOUNTABLE_THRESHOLD_PRESTIGE = 0.60;  // and prestige must be high
const PRESTIGE_DECAY_RATE = 0.10;

const CHALLENGE_AGE_THRESHOLDS = Object.freeze({
    untouchable_idol: 0,                                   // always challenge
    prestigious_but_accountable: 14 * 24 * 3600 * 1000,    // 14 days
    proven_high_value_component: 30 * 24 * 3600 * 1000     // 30 days
});

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

function _required(params, key) {
    if (params == null || params[key] == null) {
        throw new Error(`§180 missing required param: ${key}`);
    }
    return params[key];
}
function _requireEnv(env) {
    if (!RESOLVED_ENVS.has(env)) {
        throw new Error(`§180 invalid resolvedEnv: ${env}`);
    }
    return env;
}
function _requireRange01(name, v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`§180 ${name} must be number in [0,1], got ${v}`);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PURE FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

function computePrestigeToContributionRatio(params) {
    const prestige = _required(params, 'prestige');
    const contribution = _required(params, 'contribution');
    _requireRange01('prestige', prestige);
    _requireRange01('contribution', contribution);
    if (contribution === 0) {
        return { ratio: prestige > 0 ? Infinity : 0 };
    }
    return { ratio: prestige / contribution };
}

function classifyComponent(params) {
    const prestige = _required(params, 'prestige');
    const contribution = _required(params, 'contribution');
    const ratio = _required(params, 'ratio');
    _requireRange01('prestige', prestige);
    _requireRange01('contribution', contribution);
    if (typeof ratio !== 'number' && ratio !== Infinity) {
        throw new Error(`§180 ratio must be number or Infinity`);
    }
    // Idol detection takes priority — high prestige with weak/no contribution
    if (ratio >= IDOL_DETECTION_RATIO) {
        return { classification: 'untouchable_idol' };
    }
    // Prestigious but accountable — high prestige AND ratio gap above 1.2.
    // A balanced ratio near 1.0 means contribution matches prestige; that's
    // "proven", not "prestigious but accountable".
    if (prestige >= ACCOUNTABLE_THRESHOLD_PRESTIGE
        && ratio >= ACCOUNTABLE_THRESHOLD_RATIO) {
        return { classification: 'prestigious_but_accountable' };
    }
    // Default: still proven (balanced or low-prestige — low risk of idolatry)
    return { classification: 'proven_high_value_component' };
}

function requiresChallenge(params) {
    const classification = _required(params, 'classification');
    const lastAuditAgeMs = _required(params, 'lastAuditAgeMs');
    if (!CLASSIFICATIONS.includes(classification)) {
        throw new Error(`§180 invalid classification: ${classification}`);
    }
    if (typeof lastAuditAgeMs !== 'number' || lastAuditAgeMs < 0) {
        throw new Error('§180 lastAuditAgeMs must be non-negative');
    }
    const threshold = CHALLENGE_AGE_THRESHOLDS[classification];
    // untouchable_idol always (threshold = 0 → any age >= 0 returns 1)
    if (classification === 'untouchable_idol') {
        return { challengeRequired: 1 };
    }
    return { challengeRequired: lastAuditAgeMs > threshold ? 1 : 0 };
}

function applyPrestigeDecay(params) {
    const currentPrestige = _required(params, 'currentPrestige');
    const periodsSinceContribution = _required(params, 'periodsSinceContribution');
    _requireRange01('currentPrestige', currentPrestige);
    if (periodsSinceContribution < 0) {
        throw new Error('§180 periodsSinceContribution must be non-negative');
    }
    const decayed = currentPrestige * Math.pow(1 - PRESTIGE_DECAY_RATE, periodsSinceContribution);
    return { decayedPrestige: Math.max(0, Math.min(1, decayed)) };
}

// ──────────────────────────────────────────────────────────────────────────
// DB-BOUND FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

const _stmts = {
    insertAudit: db.prepare(`
        INSERT INTO ml_anti_idolatry_audits (
            user_id, resolved_env, audit_id, component_id, component_type,
            historical_prestige_score, recent_contribution_score,
            prestige_to_contribution_ratio, classification,
            challenge_required, reasoning, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectAudit: db.prepare(`
        SELECT id, audit_id AS auditId, component_id AS componentId,
               component_type AS componentType,
               historical_prestige_score AS historicalPrestigeScore,
               recent_contribution_score AS recentContributionScore,
               prestige_to_contribution_ratio AS prestigeToContributionRatio,
               classification,
               challenge_required AS challengeRequired,
               reasoning, ts
        FROM ml_anti_idolatry_audits
        WHERE audit_id = ?
    `),
    selectAllRecent: db.prepare(`
        SELECT id, audit_id AS auditId, component_id AS componentId,
               component_type AS componentType,
               historical_prestige_score AS historicalPrestigeScore,
               recent_contribution_score AS recentContributionScore,
               prestige_to_contribution_ratio AS prestigeToContributionRatio,
               classification,
               challenge_required AS challengeRequired,
               reasoning, ts
        FROM ml_anti_idolatry_audits
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
    `),
    selectByClassification: db.prepare(`
        SELECT id, audit_id AS auditId, component_id AS componentId,
               component_type AS componentType,
               historical_prestige_score AS historicalPrestigeScore,
               recent_contribution_score AS recentContributionScore,
               prestige_to_contribution_ratio AS prestigeToContributionRatio,
               classification,
               challenge_required AS challengeRequired,
               reasoning, ts
        FROM ml_anti_idolatry_audits
        WHERE user_id = ? AND resolved_env = ? AND classification = ?
        ORDER BY ts DESC
    `),
    countByClassification: db.prepare(`
        SELECT classification, COUNT(*) AS count
        FROM ml_anti_idolatry_audits
        WHERE user_id = ? AND resolved_env = ? AND ts >= ?
        GROUP BY classification
    `)
};

function recordAntiIdolatryAudit(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const auditId = _required(params, 'auditId');
    const componentId = _required(params, 'componentId');
    const componentType = _required(params, 'componentType');
    const historicalPrestige = _required(params, 'historicalPrestige');
    const recentContribution = _required(params, 'recentContribution');
    const lastAuditAgeMs = _required(params, 'lastAuditAgeMs');
    const ts = _required(params, 'ts');
    const reasoning = params.reasoning ?? null;

    if (!COMPONENT_TYPES.includes(componentType)) {
        throw new Error(`§180 invalid componentType: ${componentType}`);
    }
    if (_stmts.selectAudit.get(auditId)) {
        throw new Error(`§180 duplicate auditId: ${auditId}`);
    }

    const { ratio } = computePrestigeToContributionRatio({
        prestige: historicalPrestige, contribution: recentContribution
    });
    const { classification } = classifyComponent({
        prestige: historicalPrestige, contribution: recentContribution, ratio
    });
    const { challengeRequired } = requiresChallenge({
        classification, lastAuditAgeMs
    });

    // Convert Infinity to a large finite value for DB storage (SQLite REAL
    // doesn't accept Infinity)
    const storedRatio = (ratio === Infinity) ? 999999 : ratio;

    _stmts.insertAudit.run(
        userId, resolvedEnv, auditId, componentId, componentType,
        historicalPrestige, recentContribution, storedRatio,
        classification, challengeRequired, reasoning, ts
    );

    return {
        recorded: true,
        auditId, componentId, componentType,
        prestigeToContributionRatio: ratio,
        classification, challengeRequired
    };
}

function getRecentAudits(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const classification = params.classification;
    if (classification !== undefined && !CLASSIFICATIONS.includes(classification)) {
        throw new Error(`§180 invalid classification filter: ${classification}`);
    }
    return classification
        ? _stmts.selectByClassification.all(userId, resolvedEnv, classification)
        : _stmts.selectAllRecent.all(userId, resolvedEnv);
}

function getStatsByClassification(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const sinceTs = _required(params, 'sinceTs');
    const rows = _stmts.countByClassification.all(userId, resolvedEnv, sinceTs);
    const stats = {
        proven_high_value_component: 0,
        prestigious_but_accountable: 0,
        untouchable_idol: 0,
        totalCount: 0
    };
    for (const r of rows) {
        stats[r.classification] = r.count;
        stats.totalCount += r.count;
    }
    return stats;
}

module.exports = {
    // constants
    COMPONENT_TYPES,
    CLASSIFICATIONS,
    IDOL_DETECTION_RATIO,
    ACCOUNTABLE_THRESHOLD_PRESTIGE,
    PRESTIGE_DECAY_RATE,
    CHALLENGE_AGE_THRESHOLDS,
    // pure
    computePrestigeToContributionRatio,
    classifyComponent,
    requiresChallenge,
    applyPrestigeDecay,
    // DB
    recordAntiIdolatryAudit,
    getRecentAudits,
    getStatsByClassification
};

// FILE END §180 antiIdolatryEngine.js
