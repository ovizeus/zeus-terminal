'use strict';

/**
 * OMEGA _meta — identityContinuity (canonical §127)
 *
 * §127 IDENTITY CONTINUITY / SELF-REVISION PRESERVATION ENGINE.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 3608-3662.
 *
 * "Un sistem care invata si se modifica continuu risca sa devina,
 *  treptat, alt sistem, fara sa observe... continuity map intre charter/
 *  ontology/concepts/utility_priorities/regime_grammar/policy_style/
 *  risk_philosophy... thresholds: evolution_normal/identity_drift/
 *  major_self_rewrite/forced_governance_review... 'sunt tot eu, doar mai
 *  bun, sau am devenit alt agent?'... continuity score TREBUIE sa
 *  influenteze canary_duration, size_limits, governance_strictness,
 *  shadow_duration."
 *
 * Distinct from §116 constitutionalCharterLayer (R1 — immutable charter),
 * §123 ontologyRevisionEngine (R5B — vocabulary evolution), §247
 * preRegistration (hash-locked pre-test), §115 selfRepairEngine (repair
 * proposals). §127 = cumulative identity tracking across time.
 */

const { db } = require('../../database');

const IDENTITY_AXES = Object.freeze([
    'charter', 'ontology', 'concepts',
    'utility_priorities', 'regime_grammar',
    'policy_style', 'risk_philosophy'
]);
const DRIFT_KINDS = Object.freeze([
    'evolution_normal', 'identity_drift',
    'major_self_rewrite', 'forced_governance_review'
]);

const CONTINUITY_THRESHOLDS = Object.freeze({
    evolution: 0.85,
    drift: 0.65,
    rewrite: 0.40
});

const DEFAULT_AXIS_WEIGHTS = Object.freeze({
    charter: 0.30,
    ontology: 0.20,
    concepts: 0.15,
    utility_priorities: 0.15,
    regime_grammar: 0.10,
    policy_style: 0.05,
    risk_philosophy: 0.05
});

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`identityContinuity: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertSnapshot: db.prepare(`
        INSERT INTO ml_identity_snapshots
        (user_id, resolved_env, snapshot_id, version_label,
         charter_hash, ontology_hash, concepts_hash,
         utility_priorities_hash, regime_grammar_hash,
         policy_style_hash, risk_philosophy_hash, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertAudit: db.prepare(`
        INSERT INTO ml_identity_drift_audits
        (user_id, resolved_env, audit_id, from_snapshot_id,
         to_snapshot_id, axis_drifts_json,
         continuity_score, drift_kind, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listAudits: db.prepare(`
        SELECT * FROM ml_identity_drift_audits
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC LIMIT ?
    `),
    listAuditsByDrift: db.prepare(`
        SELECT * FROM ml_identity_drift_audits
        WHERE user_id = ? AND resolved_env = ? AND drift_kind = ?
        ORDER BY ts DESC LIMIT ?
    `)
};

// ── computeAxisDrift (pure) ────────────────────────────────────────
function computeAxisDrift(params) {
    const oldHash = _required(params, 'oldHash');
    const newHash = _required(params, 'newHash');
    return { drift: oldHash === newHash ? 0 : 1, oldHash, newHash };
}

// ── computeContinuityScore (pure) ──────────────────────────────────
function computeContinuityScore(params) {
    const axisDrifts = _required(params, 'axisDrifts');
    const weights = (params && params.weights) ? params.weights : DEFAULT_AXIS_WEIGHTS;

    let score = 0;
    let weightSum = 0;
    for (const axis of IDENTITY_AXES) {
        const drift = axisDrifts[axis];
        if (drift === undefined || drift === null) continue;
        if (drift < 0 || drift > 1) {
            throw new Error(`identityContinuity: ${axis} drift must be in [0,1]`);
        }
        const w = weights[axis] !== undefined ? weights[axis] : 0;
        score += w * (1 - drift);
        weightSum += w;
    }
    // Normalize if weights don't sum to 1
    const normalized = weightSum > 0 ? score / weightSum : 0;
    return {
        continuityScore: Math.max(0, Math.min(1, normalized)),
        weightSum
    };
}

// ── classifyDriftKind (pure) ───────────────────────────────────────
function classifyDriftKind(params) {
    const continuityScore = _required(params, 'continuityScore');
    if (continuityScore < 0 || continuityScore > 1) {
        throw new Error('identityContinuity: continuityScore must be in [0,1]');
    }
    let driftKind;
    if (continuityScore >= CONTINUITY_THRESHOLDS.evolution) {
        driftKind = 'evolution_normal';
    } else if (continuityScore >= CONTINUITY_THRESHOLDS.drift) {
        driftKind = 'identity_drift';
    } else if (continuityScore >= CONTINUITY_THRESHOLDS.rewrite) {
        driftKind = 'major_self_rewrite';
    } else {
        driftKind = 'forced_governance_review';
    }
    return { driftKind, continuityScore };
}

// ── captureIdentitySnapshot ────────────────────────────────────────
function captureIdentitySnapshot(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const snapshotId = _required(params, 'snapshotId');
    const versionLabel = _required(params, 'versionLabel');
    const charterHash = _required(params, 'charterHash');
    const ontologyHash = _required(params, 'ontologyHash');
    const conceptsHash = _required(params, 'conceptsHash');
    const utilityPrioritiesHash = _required(params, 'utilityPrioritiesHash');
    const regimeGrammarHash = _required(params, 'regimeGrammarHash');
    const policyStyleHash = _required(params, 'policyStyleHash');
    const riskPhilosophyHash = _required(params, 'riskPhilosophyHash');
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertSnapshot.run(
            userId, env, snapshotId, versionLabel,
            charterHash, ontologyHash, conceptsHash,
            utilityPrioritiesHash, regimeGrammarHash,
            policyStyleHash, riskPhilosophyHash, ts
        );
        return { captured: true, snapshotId, versionLabel };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`identityContinuity: duplicate snapshotId "${snapshotId}"`);
        }
        throw err;
    }
}

// ── auditIdentityDrift ─────────────────────────────────────────────
function auditIdentityDrift(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const auditId = _required(params, 'auditId');
    const fromSnapshotId = _required(params, 'fromSnapshotId');
    const toSnapshotId = _required(params, 'toSnapshotId');
    const axisDrifts = _required(params, 'axisDrifts');
    const ts = (params && params.ts) ? params.ts : Date.now();

    const { continuityScore } = computeContinuityScore({ axisDrifts });
    const { driftKind } = classifyDriftKind({ continuityScore });

    try {
        _stmts.insertAudit.run(
            userId, env, auditId, fromSnapshotId, toSnapshotId,
            JSON.stringify(axisDrifts),
            continuityScore, driftKind, ts
        );
        return {
            audited: true, auditId,
            continuityScore, driftKind
        };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`identityContinuity: duplicate auditId "${auditId}"`);
        }
        throw err;
    }
}

// ── getIdentityHistory ─────────────────────────────────────────────
function getIdentityHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const driftKindFilter = params && params.driftKindFilter;
    const limit = (params && params.limit) ? params.limit : 100;

    if (driftKindFilter && !DRIFT_KINDS.includes(driftKindFilter)) {
        throw new Error(
            `identityContinuity: invalid driftKindFilter "${driftKindFilter}"`
        );
    }
    const rows = driftKindFilter
        ? _stmts.listAuditsByDrift.all(userId, env, driftKindFilter, limit)
        : _stmts.listAudits.all(userId, env, limit);
    return rows.map(r => ({
        auditId: r.audit_id,
        fromSnapshotId: r.from_snapshot_id,
        toSnapshotId: r.to_snapshot_id,
        axisDrifts: JSON.parse(r.axis_drifts_json),
        continuityScore: r.continuity_score,
        driftKind: r.drift_kind,
        ts: r.ts
    }));
}

module.exports = {
    IDENTITY_AXES,
    DRIFT_KINDS,
    CONTINUITY_THRESHOLDS,
    DEFAULT_AXIS_WEIGHTS,
    computeAxisDrift,
    computeContinuityScore,
    classifyDriftKind,
    captureIdentitySnapshot,
    auditIdentityDrift,
    getIdentityHistory
};
