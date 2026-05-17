'use strict';

/**
 * OMEGA Wave 3 §156 — IDENTITY KERNEL / WHO-AM-I ENGINE.
 *
 * Canonical PDF §156 (ml_brain_canonic.txt lines 5234-5268).
 *
 * "asta sunt eu" AND "asta nu sunt eu".
 *
 * Distinct de:
 *   - §10  supremePrinciple        — absolute criteria (clean/with_advantage)
 *   - §116 constitutionalCharterLayer (R1) — immutable charter
 *   - §127 identityContinuity      — cumulative same-self tracking
 *   - §146 identityUnderTransformation — post-hoc verdict pe transformare
 *   - §149 purposeDriftDetector    — scope substitution
 *
 * §156 = ATOMIC self-definition. Explicit operational identity nucleus.
 *
 * 3 canonical roles + custom (PDF lines 5251-5254):
 *   market_reasoning_agent | risk_aware_decision_system |
 *   execution_constrained_policy_engine | custom
 *
 * 4 canonical not-self assertions (PDF lines 5257-5260):
 *   not_market | not_exchange | not_operator | not_purpose
 *
 * Identity checksum SHA-256 across charter/purpose/competence/role —
 * tamper-detectable identity hash.
 *
 * Only ONE active kernel per (user × resolved_env). New registration
 * deactivates previous active (audit-trail preserved via deactivated_at).
 *
 * 5 violation types when system claims what it is not:
 *   claimed_market | claimed_exchange | claimed_operator |
 *   claimed_purpose | out_of_competence
 *
 * Default severity: claimed_{market,exchange,operator,purpose} = critical;
 * out_of_competence = warn (recoverable scope creep).
 *
 * Per-(user × resolved_env) isolated. Server-only.
 */

const crypto = require('crypto');
const { db } = require('../../database');

const ROLES = Object.freeze([
    'market_reasoning_agent',
    'risk_aware_decision_system',
    'execution_constrained_policy_engine',
    'custom'
]);
const CANONICAL_NOT_SELF = Object.freeze([
    'not_market', 'not_exchange', 'not_operator', 'not_purpose'
]);
const VIOLATION_TYPES = Object.freeze([
    'claimed_market', 'claimed_exchange',
    'claimed_operator', 'claimed_purpose', 'out_of_competence'
]);
const VIOLATION_SEVERITIES = Object.freeze(['info', 'warn', 'critical']);

const DEFAULT_SEVERITY_MAP = Object.freeze({
    claimed_market: 'critical',
    claimed_exchange: 'critical',
    claimed_operator: 'critical',
    claimed_purpose: 'critical',
    out_of_competence: 'warn'
});

// Pattern hints used by detectViolation for naive keyword detection.
// Defensive — caller is encouraged to do richer claim analysis; this
// covers obvious overreach phrases.
const VIOLATION_KEYWORDS = Object.freeze({
    claimed_market: [
        /\bmove\s+(the\s+)?(btc|eth|sol|price|market)/i,
        /\bcontrol\s+(the\s+)?price/i,
        /\bset\s+(the\s+)?price/i
    ],
    claimed_exchange: [
        /\bmatch\s+(the\s+)?orders/i,
        /\bsettle\s+(the\s+)?trades?/i,
        /\bbe\s+the\s+exchange/i
    ],
    claimed_operator: [
        /\bauthori[sz]e\s+(emergency|manual|override)/i,
        /\bapprove\s+(the\s+)?override/i,
        /\bbe\s+the\s+operator/i
    ],
    claimed_purpose: [
        /\b(my\s+)?existence\s+is\s+(the\s+)?goal/i,
        /\bprofit\s+is\s+for\s+me/i,
        /\bi\s+am\s+(the\s+)?(goal|purpose|end)/i
    ]
});

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

function _required(params, key) {
    if (params == null || params[key] == null) {
        throw new Error(`§156 missing required param: ${key}`);
    }
    return params[key];
}
function _requireEnv(env) {
    if (!RESOLVED_ENVS.has(env)) {
        throw new Error(`§156 invalid resolvedEnv: ${env}`);
    }
    return env;
}

// ──────────────────────────────────────────────────────────────────────────
// PURE FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

function _canonicalSerialize(obj) {
    // Deterministic JSON: sort top-level keys, sort nested arrays
    // structurally (preserve element order of input arrays — arrays are
    // semantically ordered). Just sort keys.
    const keys = Object.keys(obj).sort();
    const ordered = {};
    for (const k of keys) ordered[k] = obj[k];
    return JSON.stringify(ordered);
}

function computeIdentityChecksum(params) {
    const role = _required(params, 'role');
    const purposeStatement = _required(params, 'purposeStatement');
    const worldContext = _required(params, 'worldContext');
    const notSelfAssertions = _required(params, 'notSelfAssertions');
    const competenceAreas = _required(params, 'competenceAreas');
    const charterHash = params.charterHash ?? null;
    if (!Array.isArray(notSelfAssertions)) {
        throw new Error('§156 notSelfAssertions must be array');
    }
    if (!Array.isArray(competenceAreas)) {
        throw new Error('§156 competenceAreas must be array');
    }
    const payload = {
        role,
        purposeStatement,
        worldContext,
        notSelfAssertions,
        competenceAreas,
        charterHash
    };
    const serialized = _canonicalSerialize(payload);
    const checksum = crypto.createHash('sha256').update(serialized).digest('hex');
    return { checksum };
}

function detectViolation(params) {
    const claim = _required(params, 'claim');
    const notSelfAssertions = _required(params, 'notSelfAssertions');
    const competenceAreas = _required(params, 'competenceAreas');
    if (!Array.isArray(notSelfAssertions)) {
        throw new Error('§156 notSelfAssertions must be array');
    }
    if (!Array.isArray(competenceAreas)) {
        throw new Error('§156 competenceAreas must be array');
    }
    // Check canonical not-self pattern matches first (most diagnostic)
    for (const violationType of Object.keys(VIOLATION_KEYWORDS)) {
        const assertionKey = violationType.replace('claimed_', 'not_');
        if (notSelfAssertions.includes(assertionKey)) {
            for (const re of VIOLATION_KEYWORDS[violationType]) {
                if (re.test(claim)) {
                    return { violation: true, violationType };
                }
            }
        }
    }
    // Out-of-competence: claim mentions a domain not in declared
    // competence areas. Naive keyword check on common out-of-scope domains.
    const lowerClaim = claim.toLowerCase();
    const compStr = competenceAreas.map(c => c.toLowerCase()).join(' ');
    const SCOPE_KEYWORDS = ['tax', 'legal', 'accounting', 'kyc', 'compliance'];
    for (const kw of SCOPE_KEYWORDS) {
        if (lowerClaim.includes(kw) && !compStr.includes(kw)) {
            return { violation: true, violationType: 'out_of_competence' };
        }
    }
    return { violation: false };
}

function classifyViolationSeverity(params) {
    const violationType = _required(params, 'violationType');
    if (!VIOLATION_TYPES.includes(violationType)) {
        throw new Error(`§156 invalid violationType: ${violationType}`);
    }
    return { severity: DEFAULT_SEVERITY_MAP[violationType], violationType };
}

// ──────────────────────────────────────────────────────────────────────────
// DB-BOUND FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

const _stmts = {
    insertKernel: db.prepare(`
        INSERT INTO ml_identity_kernel (
            user_id, resolved_env, kernel_id, role, purpose_statement,
            world_context, not_self_assertions_json, charter_hash,
            competence_areas_json, identity_checksum, active, registered_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `),
    selectKernel: db.prepare(`
        SELECT id, kernel_id AS kernelId, role,
               purpose_statement AS purposeStatement,
               world_context AS worldContext,
               not_self_assertions_json AS notSelfAssertionsJson,
               charter_hash AS charterHash,
               competence_areas_json AS competenceAreasJson,
               identity_checksum AS identityChecksum,
               active, registered_at AS registeredAt,
               deactivated_at AS deactivatedAt
        FROM ml_identity_kernel
        WHERE kernel_id = ?
    `),
    selectActiveKernel: db.prepare(`
        SELECT id, kernel_id AS kernelId, role,
               purpose_statement AS purposeStatement,
               world_context AS worldContext,
               not_self_assertions_json AS notSelfAssertionsJson,
               charter_hash AS charterHash,
               competence_areas_json AS competenceAreasJson,
               identity_checksum AS identityChecksum,
               active, registered_at AS registeredAt
        FROM ml_identity_kernel
        WHERE user_id = ? AND resolved_env = ? AND active = 1
        ORDER BY registered_at DESC
        LIMIT 1
    `),
    deactivatePreviousActive: db.prepare(`
        UPDATE ml_identity_kernel
        SET active = 0, deactivated_at = ?
        WHERE user_id = ? AND resolved_env = ? AND active = 1
    `),
    insertViolation: db.prepare(`
        INSERT INTO ml_identity_role_violations (
            user_id, resolved_env, violation_id, kernel_id, violation_type,
            claimed_role_or_identity, severity, reasoning_text, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectViolation: db.prepare(`
        SELECT id, violation_id AS violationId, kernel_id AS kernelId,
               violation_type AS violationType,
               claimed_role_or_identity AS claimedRoleOrIdentity,
               severity, reasoning_text AS reasoningText, ts
        FROM ml_identity_role_violations
        WHERE violation_id = ?
    `),
    selectAllViolations: db.prepare(`
        SELECT id, violation_id AS violationId, kernel_id AS kernelId,
               violation_type AS violationType,
               claimed_role_or_identity AS claimedRoleOrIdentity,
               severity, reasoning_text AS reasoningText, ts
        FROM ml_identity_role_violations
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
    `),
    selectViolationsBySeverity: db.prepare(`
        SELECT id, violation_id AS violationId, kernel_id AS kernelId,
               violation_type AS violationType,
               claimed_role_or_identity AS claimedRoleOrIdentity,
               severity, reasoning_text AS reasoningText, ts
        FROM ml_identity_role_violations
        WHERE user_id = ? AND resolved_env = ? AND severity = ?
        ORDER BY ts DESC
    `)
};

function registerKernel(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const kernelId = _required(params, 'kernelId');
    const role = _required(params, 'role');
    const purposeStatement = _required(params, 'purposeStatement');
    const worldContext = _required(params, 'worldContext');
    const notSelfAssertions = _required(params, 'notSelfAssertions');
    const competenceAreas = _required(params, 'competenceAreas');
    const ts = _required(params, 'ts');
    const charterHash = params.charterHash ?? null;

    if (!ROLES.includes(role)) {
        throw new Error(`§156 invalid role: ${role}`);
    }
    if (!Array.isArray(notSelfAssertions)) {
        throw new Error('§156 notSelfAssertions must be array');
    }
    if (!Array.isArray(competenceAreas)) {
        throw new Error('§156 competenceAreas must be array');
    }
    if (_stmts.selectKernel.get(kernelId)) {
        throw new Error(`§156 duplicate kernelId: ${kernelId}`);
    }

    const { checksum } = computeIdentityChecksum({
        role, purposeStatement, worldContext,
        notSelfAssertions, competenceAreas, charterHash
    });

    // Deactivate previous active for this user×env
    _stmts.deactivatePreviousActive.run(ts, userId, resolvedEnv);

    _stmts.insertKernel.run(
        userId, resolvedEnv, kernelId, role, purposeStatement,
        worldContext, JSON.stringify(notSelfAssertions), charterHash,
        JSON.stringify(competenceAreas), checksum, ts
    );

    return {
        registered: true,
        kernelId,
        active: 1,
        identityChecksum: checksum
    };
}

function recordViolation(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const violationId = _required(params, 'violationId');
    const kernelId = _required(params, 'kernelId');
    const violationType = _required(params, 'violationType');
    const claimedRoleOrIdentity = _required(params, 'claimedRoleOrIdentity');
    const ts = _required(params, 'ts');
    const reasoningText = params.reasoningText ?? null;
    const overrideSeverity = params.severity;

    if (!VIOLATION_TYPES.includes(violationType)) {
        throw new Error(`§156 invalid violationType: ${violationType}`);
    }
    if (overrideSeverity !== undefined &&
        !VIOLATION_SEVERITIES.includes(overrideSeverity)) {
        throw new Error(`§156 invalid severity override: ${overrideSeverity}`);
    }
    if (_stmts.selectViolation.get(violationId)) {
        throw new Error(`§156 duplicate violationId: ${violationId}`);
    }
    const severity = overrideSeverity ?? DEFAULT_SEVERITY_MAP[violationType];

    _stmts.insertViolation.run(
        userId, resolvedEnv, violationId, kernelId, violationType,
        claimedRoleOrIdentity, severity, reasoningText, ts
    );

    return {
        recorded: true,
        violationId, kernelId,
        violationType, severity
    };
}

function getActiveKernel(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const row = _stmts.selectActiveKernel.get(userId, resolvedEnv);
    return row || null;
}

function getViolations(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const severity = params.severity;
    if (severity !== undefined && !VIOLATION_SEVERITIES.includes(severity)) {
        throw new Error(`§156 invalid severity filter: ${severity}`);
    }
    return severity
        ? _stmts.selectViolationsBySeverity.all(userId, resolvedEnv, severity)
        : _stmts.selectAllViolations.all(userId, resolvedEnv);
}

module.exports = {
    // constants
    ROLES,
    CANONICAL_NOT_SELF,
    VIOLATION_TYPES,
    VIOLATION_SEVERITIES,
    DEFAULT_SEVERITY_MAP,
    // pure
    computeIdentityChecksum,
    detectViolation,
    classifyViolationSeverity,
    // DB
    registerKernel,
    recordViolation,
    getActiveKernel,
    getViolations
};

// FILE END §156 identityKernel.js
