'use strict';

/**
 * OMEGA R2 Cognition — causalDiscoveryEngine (canonical §113)
 *
 * §113 CAUSAL DISCOVERY / GRAPH REVISION ENGINE.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 2971-2998.
 *
 * "SCM-ul defineste lanturi cauzale. Dar sistemul trebuie sa poata si
 *  descoperi sau revizui partial legaturi cauzale din date... edge revision
 *  PROPOSALS... strength score pentru relatii candidate... detectarea
 *  legaturilor care slabesc, se inverseaza sau devin context-dependent...
 *  human review / shadow validation pentru actualizari majore...
 *  descoperirea cauzala NU modifica direct live graph fara validare...
 *  relatiile candidate trebuie tratate ca propuneri pana la confirmare...
 *  orice revizie de graf trebuie versionata si auditata."
 *
 * Distinct from §40 structuralCausalModel (STATIC chains definition),
 * §42 interventionalReasoning (do-calculus on STATIC), §68 thesisGraphEngine
 * (per-trade evidence DAG), §112 competingHypothesesEngine (rival market
 * explanations). §113 = DYNAMIC graph revision lifecycle.
 */

const { db } = require('../../database');

const PROPOSED_CHANGES = Object.freeze([
    'ADD', 'STRENGTHEN', 'WEAKEN', 'INVERT', 'REMOVE', 'CONTEXTUALIZE'
]);
const PROPOSAL_STATUSES = Object.freeze([
    'PROPOSED', 'SHADOW_VALIDATING', 'CONFIRMED', 'REJECTED'
]);
const READINESS_OUTCOMES = Object.freeze([
    'READY', 'INSUFFICIENT_EVIDENCE', 'WEAK_STRENGTH'
]);

const MIN_CANDIDATE_STRENGTH = 0.30;
const MIN_EVIDENCE_COUNT_FOR_CONFIRM = 30;

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`causalDiscoveryEngine: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertProposal: db.prepare(`
        INSERT INTO ml_causal_edge_proposals
        (user_id, resolved_env, proposal_id, from_node, to_node,
         proposed_change, candidate_strength, evidence_summary,
         evidence_count, status, human_approved,
         ts_proposed, ts_decided)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PROPOSED', 0, ?, NULL)
    `),
    getProposal: db.prepare(`
        SELECT * FROM ml_causal_edge_proposals WHERE proposal_id = ?
    `),
    listProposals: db.prepare(`
        SELECT * FROM ml_causal_edge_proposals
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts_proposed DESC LIMIT ?
    `),
    listProposalsByStatus: db.prepare(`
        SELECT * FROM ml_causal_edge_proposals
        WHERE user_id = ? AND resolved_env = ? AND status = ?
        ORDER BY ts_proposed DESC LIMIT ?
    `),
    updateProposalStatus: db.prepare(`
        UPDATE ml_causal_edge_proposals
        SET status = ?, ts_decided = ?
        WHERE user_id = ? AND resolved_env = ? AND proposal_id = ?
    `),
    updateProposalConfirm: db.prepare(`
        UPDATE ml_causal_edge_proposals
        SET status = 'CONFIRMED', human_approved = 1, ts_decided = ?
        WHERE user_id = ? AND resolved_env = ? AND proposal_id = ?
    `),
    insertRevision: db.prepare(`
        INSERT INTO ml_graph_revisions
        (user_id, resolved_env, revision_id, version,
         applied_proposals_json, revision_reason, ts_applied)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    maxVersion: db.prepare(`
        SELECT COALESCE(MAX(version), 0) AS max_version
        FROM ml_graph_revisions
        WHERE user_id = ? AND resolved_env = ?
    `)
};

// ── evaluateProposalReadiness (pure) ───────────────────────────────
function evaluateProposalReadiness(params) {
    const candidateStrength = _required(params, 'candidateStrength');
    const evidenceCount = _required(params, 'evidenceCount');
    const minStrength = (params && params.minStrength !== undefined)
        ? params.minStrength : MIN_CANDIDATE_STRENGTH;
    const minEvidence = (params && params.minEvidence !== undefined)
        ? params.minEvidence : MIN_EVIDENCE_COUNT_FOR_CONFIRM;

    if (candidateStrength < minStrength) {
        return {
            outcome: 'WEAK_STRENGTH',
            candidateStrength, evidenceCount,
            reason: `strength ${candidateStrength} < min ${minStrength}`
        };
    }
    if (evidenceCount < minEvidence) {
        return {
            outcome: 'INSUFFICIENT_EVIDENCE',
            candidateStrength, evidenceCount,
            reason: `evidence ${evidenceCount} < min ${minEvidence}`
        };
    }
    return { outcome: 'READY', candidateStrength, evidenceCount };
}

// ── proposeEdgeRevision ────────────────────────────────────────────
function proposeEdgeRevision(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const proposalId = _required(params, 'proposalId');
    const fromNode = _required(params, 'fromNode');
    const toNode = _required(params, 'toNode');
    const proposedChange = _required(params, 'proposedChange');
    if (!PROPOSED_CHANGES.includes(proposedChange)) {
        throw new Error(`causalDiscoveryEngine: invalid proposedChange "${proposedChange}"`);
    }
    const candidateStrength = _required(params, 'candidateStrength');
    if (candidateStrength < 0 || candidateStrength > 1) {
        throw new Error('causalDiscoveryEngine: candidateStrength must be in [0,1]');
    }
    if (candidateStrength < MIN_CANDIDATE_STRENGTH) {
        throw new Error(
            `causalDiscoveryEngine: candidateStrength ${candidateStrength} ` +
            `< MIN ${MIN_CANDIDATE_STRENGTH} — not strong enough to propose`
        );
    }
    const evidenceSummary = _required(params, 'evidenceSummary');
    const evidenceCount = _required(params, 'evidenceCount');
    if (evidenceCount < 0) {
        throw new Error('causalDiscoveryEngine: evidenceCount must be >= 0');
    }
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertProposal.run(
            userId, env, proposalId, fromNode, toNode,
            proposedChange, candidateStrength, evidenceSummary,
            evidenceCount, ts
        );
        return { proposed: true, proposalId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`causalDiscoveryEngine: duplicate proposalId "${proposalId}"`);
        }
        throw err;
    }
}

// ── validateInShadow ───────────────────────────────────────────────
function validateInShadow(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const proposalId = _required(params, 'proposalId');
    const ts = (params && params.ts) ? params.ts : Date.now();

    const p = _stmts.getProposal.get(proposalId);
    if (!p) {
        throw new Error(`causalDiscoveryEngine: proposal "${proposalId}" not found`);
    }
    if (p.user_id !== userId || p.resolved_env !== env) {
        throw new Error('causalDiscoveryEngine: proposal not owned by user/env');
    }
    if (p.status !== 'PROPOSED') {
        throw new Error(
            `causalDiscoveryEngine: cannot transition to SHADOW_VALIDATING ` +
            `from status "${p.status}"`
        );
    }
    _stmts.updateProposalStatus.run(
        'SHADOW_VALIDATING', ts, userId, env, proposalId
    );
    return {
        transitioned: true, proposalId,
        newStatus: 'SHADOW_VALIDATING'
    };
}

// ── confirmProposal ────────────────────────────────────────────────
function confirmProposal(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const proposalId = _required(params, 'proposalId');
    const humanApproved = _required(params, 'humanApproved');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!humanApproved) {
        throw new Error(
            'causalDiscoveryEngine: confirm requires humanApproved=true ' +
            '(canonical line 2983 — human review for major causal updates)'
        );
    }

    const p = _stmts.getProposal.get(proposalId);
    if (!p) {
        throw new Error(`causalDiscoveryEngine: proposal "${proposalId}" not found`);
    }
    if (p.user_id !== userId || p.resolved_env !== env) {
        throw new Error('causalDiscoveryEngine: proposal not owned by user/env');
    }
    if (p.evidence_count < MIN_EVIDENCE_COUNT_FOR_CONFIRM) {
        throw new Error(
            `causalDiscoveryEngine: cannot confirm — evidence_count ` +
            `${p.evidence_count} < MIN ${MIN_EVIDENCE_COUNT_FOR_CONFIRM}`
        );
    }
    _stmts.updateProposalConfirm.run(ts, userId, env, proposalId);
    return { confirmed: true, proposalId, newStatus: 'CONFIRMED' };
}

// ── applyGraphRevision ─────────────────────────────────────────────
function applyGraphRevision(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const revisionId = _required(params, 'revisionId');
    const proposalIds = _required(params, 'proposalIds');
    if (!Array.isArray(proposalIds) || proposalIds.length === 0) {
        throw new Error('causalDiscoveryEngine: proposalIds must be non-empty array');
    }
    const revisionReason = _required(params, 'revisionReason');
    const ts = (params && params.ts) ? params.ts : Date.now();

    // Validate ALL proposals are CONFIRMED before applying
    for (const pid of proposalIds) {
        const p = _stmts.getProposal.get(pid);
        if (!p) {
            throw new Error(`causalDiscoveryEngine: proposal "${pid}" not found`);
        }
        if (p.user_id !== userId || p.resolved_env !== env) {
            throw new Error(`causalDiscoveryEngine: proposal "${pid}" not owned by user/env`);
        }
        if (p.status !== 'CONFIRMED') {
            throw new Error(
                `causalDiscoveryEngine: cannot apply revision — proposal "${pid}" ` +
                `status "${p.status}" (must be CONFIRMED) — canonical line 2992`
            );
        }
    }

    const maxVer = _stmts.maxVersion.get(userId, env);
    const newVersion = (maxVer ? maxVer.max_version : 0) + 1;

    try {
        _stmts.insertRevision.run(
            userId, env, revisionId, newVersion,
            JSON.stringify(proposalIds),
            revisionReason, ts
        );
        return {
            applied: true, revisionId,
            version: newVersion,
            appliedProposalsCount: proposalIds.length
        };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`causalDiscoveryEngine: duplicate revisionId "${revisionId}"`);
        }
        throw err;
    }
}

// ── getActiveProposals ─────────────────────────────────────────────
function getActiveProposals(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const statusFilter = params && params.statusFilter;
    const limit = (params && params.limit) ? params.limit : 100;

    if (statusFilter && !PROPOSAL_STATUSES.includes(statusFilter)) {
        throw new Error(`causalDiscoveryEngine: invalid statusFilter "${statusFilter}"`);
    }
    const rows = statusFilter
        ? _stmts.listProposalsByStatus.all(userId, env, statusFilter, limit)
        : _stmts.listProposals.all(userId, env, limit);
    return rows.map(r => ({
        proposalId: r.proposal_id,
        fromNode: r.from_node,
        toNode: r.to_node,
        proposedChange: r.proposed_change,
        candidateStrength: r.candidate_strength,
        evidenceSummary: r.evidence_summary,
        evidenceCount: r.evidence_count,
        status: r.status,
        humanApproved: !!r.human_approved,
        tsProposed: r.ts_proposed,
        tsDecided: r.ts_decided
    }));
}

module.exports = {
    PROPOSED_CHANGES,
    PROPOSAL_STATUSES,
    READINESS_OUTCOMES,
    MIN_CANDIDATE_STRENGTH,
    MIN_EVIDENCE_COUNT_FOR_CONFIRM,
    evaluateProposalReadiness,
    proposeEdgeRevision,
    validateInShadow,
    confirmProposal,
    applyGraphRevision,
    getActiveProposals
};
