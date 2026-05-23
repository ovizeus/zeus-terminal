'use strict';

/**
 * OMEGA R5B Governance — ontologyRevisionEngine (canonical §123)
 *
 * §123 ONTOLOGY REVISION / PRIMITIVE DISCOVERY ENGINE.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 3401-3442.
 *
 * "Trebuie sa descopere cand chiar limbajul intern cu care descrie piata a
 *  devenit insuficient... primitive discovery proposals... split/merge/
 *  rename/widen/narrow/remove_redundant... scoring: explanatory_gain /
 *  compression_gain / predictive_gain / complexity_cost... shadow testing
 *  + versionare ontologie... 'mai descriu realitatea cu conceptele
 *  potrivite sau doar reciclez cutii vechi?'... primitivele noi NU intra
 *  direct live fara shadow + validation... revizii rare + deliberate +
 *  auditabile."
 *
 * Distinct from §93 regimeGrammar (atomic primitives FIXED), §114
 * conceptLibrary (named compound concepts), §113 causalDiscoveryEngine
 * (causal edges), §94 complexityBudget (MDL feature pruning).
 * §123 = revises VOCABULARY/categories itself.
 */

const { db } = require('../../database');

const TARGET_KINDS = Object.freeze(['concept', 'regime_primitive']);
const OPERATIONS = Object.freeze([
    'add', 'split', 'merge', 'rename',
    'widen', 'narrow', 'remove_redundant'
]);
const PROPOSAL_STATUSES = Object.freeze([
    'PROPOSED', 'SHADOW', 'CONFIRMED', 'REJECTED'
]);

const MIN_NET_SCORE_TO_PROPOSE = 0.10;

const GAIN_WEIGHTS = Object.freeze({
    explanatory: 0.4,
    compression: 0.2,
    predictive: 0.4
});

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`ontologyRevisionEngine: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertProposal: db.prepare(`
        INSERT INTO ml_primitive_proposals
        (user_id, resolved_env, proposal_id, target_kind, operation,
         proposal_summary, explanatory_gain, compression_gain,
         predictive_gain, complexity_cost, net_score, status,
         ts_proposed, ts_decided)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PROPOSED', ?, NULL)
    `),
    getProposal: db.prepare(`
        SELECT * FROM ml_primitive_proposals WHERE proposal_id = ?
    `),
    listProposals: db.prepare(`
        SELECT * FROM ml_primitive_proposals
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts_proposed DESC LIMIT ?
    `),
    listProposalsByStatus: db.prepare(`
        SELECT * FROM ml_primitive_proposals
        WHERE user_id = ? AND resolved_env = ? AND status = ?
        ORDER BY ts_proposed DESC LIMIT ?
    `),
    listProposalsByOperation: db.prepare(`
        SELECT * FROM ml_primitive_proposals
        WHERE user_id = ? AND resolved_env = ? AND operation = ?
        ORDER BY ts_proposed DESC LIMIT ?
    `),
    listProposalsByStatusAndOp: db.prepare(`
        SELECT * FROM ml_primitive_proposals
        WHERE user_id = ? AND resolved_env = ?
          AND status = ? AND operation = ?
        ORDER BY ts_proposed DESC LIMIT ?
    `),
    updateStatus: db.prepare(`
        UPDATE ml_primitive_proposals
        SET status = ?, ts_decided = ?
        WHERE user_id = ? AND resolved_env = ? AND proposal_id = ?
    `),
    insertVersion: db.prepare(`
        INSERT INTO ml_ontology_versions
        (user_id, resolved_env, version_id, version_number,
         applied_proposals_json, revision_reason, ts_applied)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    maxVersion: db.prepare(`
        SELECT COALESCE(MAX(version_number), 0) AS max_v
        FROM ml_ontology_versions
        WHERE user_id = ? AND resolved_env = ?
    `)
};

// ── computeNetScore (pure) ─────────────────────────────────────────
// weighted gains − complexity cost
function computeNetScore(params) {
    const explanatoryGain = _required(params, 'explanatoryGain');
    const compressionGain = _required(params, 'compressionGain');
    const predictiveGain = _required(params, 'predictiveGain');
    const complexityCost = _required(params, 'complexityCost');
    for (const [k, v] of [['explanatoryGain', explanatoryGain],
                           ['compressionGain', compressionGain],
                           ['predictiveGain', predictiveGain],
                           ['complexityCost', complexityCost]]) {
        if (v < 0 || v > 1) {
            throw new Error(`ontologyRevisionEngine: ${k} must be in [0,1]`);
        }
    }
    const netScore = GAIN_WEIGHTS.explanatory * explanatoryGain
                   + GAIN_WEIGHTS.compression * compressionGain
                   + GAIN_WEIGHTS.predictive * predictiveGain
                   - complexityCost;
    return { netScore, explanatoryGain, compressionGain, predictiveGain, complexityCost };
}

// ── proposePrimitiveChange ─────────────────────────────────────────
function proposePrimitiveChange(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const proposalId = _required(params, 'proposalId');
    const targetKind = _required(params, 'targetKind');
    if (!TARGET_KINDS.includes(targetKind)) {
        throw new Error(`ontologyRevisionEngine: invalid targetKind "${targetKind}"`);
    }
    const operation = _required(params, 'operation');
    if (!OPERATIONS.includes(operation)) {
        throw new Error(`ontologyRevisionEngine: invalid operation "${operation}"`);
    }
    const proposalSummary = _required(params, 'proposalSummary');
    const { netScore } = computeNetScore(params);
    if (netScore < MIN_NET_SCORE_TO_PROPOSE) {
        throw new Error(
            `ontologyRevisionEngine: netScore ${netScore} < MIN ` +
            `${MIN_NET_SCORE_TO_PROPOSE} — proposal not worth pursuing`
        );
    }
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertProposal.run(
            userId, env, proposalId, targetKind, operation,
            proposalSummary,
            params.explanatoryGain, params.compressionGain,
            params.predictiveGain, params.complexityCost,
            netScore, ts
        );
        return { proposed: true, proposalId, netScore };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `ontologyRevisionEngine: duplicate proposalId "${proposalId}"`
            );
        }
        throw err;
    }
}

// ── transitionToShadow ─────────────────────────────────────────────
function transitionToShadow(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const proposalId = _required(params, 'proposalId');
    const ts = (params && params.ts) ? params.ts : Date.now();

    const p = _stmts.getProposal.get(proposalId);
    if (!p) {
        throw new Error(`ontologyRevisionEngine: proposal "${proposalId}" not found`);
    }
    if (p.user_id !== userId || p.resolved_env !== env) {
        throw new Error('ontologyRevisionEngine: proposal not owned by user/env');
    }
    if (p.status !== 'PROPOSED') {
        throw new Error(
            `ontologyRevisionEngine: cannot transition to SHADOW from "${p.status}"`
        );
    }
    _stmts.updateStatus.run('SHADOW', ts, userId, env, proposalId);
    return { transitioned: true, proposalId, newStatus: 'SHADOW' };
}

// ── confirmProposal ────────────────────────────────────────────────
function confirmProposal(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const proposalId = _required(params, 'proposalId');
    const validationPassed = _required(params, 'validationPassed');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!validationPassed) {
        throw new Error(
            'ontologyRevisionEngine: confirm requires validationPassed=true ' +
            '(canonical line 3436 — shadow + validation before live)'
        );
    }

    const p = _stmts.getProposal.get(proposalId);
    if (!p) {
        throw new Error(`ontologyRevisionEngine: proposal "${proposalId}" not found`);
    }
    if (p.user_id !== userId || p.resolved_env !== env) {
        throw new Error('ontologyRevisionEngine: proposal not owned by user/env');
    }
    if (p.status !== 'SHADOW') {
        throw new Error(
            `ontologyRevisionEngine: cannot confirm — current status "${p.status}" ` +
            '(must be SHADOW)'
        );
    }
    _stmts.updateStatus.run('CONFIRMED', ts, userId, env, proposalId);
    return { confirmed: true, proposalId, newStatus: 'CONFIRMED' };
}

// ── applyOntologyVersion ───────────────────────────────────────────
function applyOntologyVersion(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const versionId = _required(params, 'versionId');
    const proposalIds = _required(params, 'proposalIds');
    if (!Array.isArray(proposalIds) || proposalIds.length === 0) {
        throw new Error(
            'ontologyRevisionEngine: proposalIds must be non-empty array'
        );
    }
    const revisionReason = _required(params, 'revisionReason');
    const ts = (params && params.ts) ? params.ts : Date.now();

    // Verify all CONFIRMED
    for (const pid of proposalIds) {
        const p = _stmts.getProposal.get(pid);
        if (!p) {
            throw new Error(`ontologyRevisionEngine: proposal "${pid}" not found`);
        }
        if (p.user_id !== userId || p.resolved_env !== env) {
            throw new Error(
                `ontologyRevisionEngine: proposal "${pid}" not owned by user/env`
            );
        }
        if (p.status !== 'CONFIRMED') {
            throw new Error(
                `ontologyRevisionEngine: proposal "${pid}" status "${p.status}" ` +
                '(must be CONFIRMED to apply)'
            );
        }
    }

    const maxV = _stmts.maxVersion.get(userId, env);
    const newVersionNumber = (maxV ? maxV.max_v : 0) + 1;

    try {
        _stmts.insertVersion.run(
            userId, env, versionId, newVersionNumber,
            JSON.stringify(proposalIds), revisionReason, ts
        );
        return {
            applied: true, versionId,
            versionNumber: newVersionNumber,
            appliedProposalsCount: proposalIds.length
        };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`ontologyRevisionEngine: duplicate versionId "${versionId}"`);
        }
        throw err;
    }
}

// ── getActiveProposals ─────────────────────────────────────────────
function getActiveProposals(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const statusFilter = params && params.statusFilter;
    const operationFilter = params && params.operationFilter;
    const limit = (params && params.limit) ? params.limit : 100;

    if (statusFilter && !PROPOSAL_STATUSES.includes(statusFilter)) {
        throw new Error(`ontologyRevisionEngine: invalid statusFilter "${statusFilter}"`);
    }
    if (operationFilter && !OPERATIONS.includes(operationFilter)) {
        throw new Error(`ontologyRevisionEngine: invalid operationFilter "${operationFilter}"`);
    }

    let rows;
    if (statusFilter && operationFilter) {
        rows = _stmts.listProposalsByStatusAndOp.all(
            userId, env, statusFilter, operationFilter, limit
        );
    } else if (statusFilter) {
        rows = _stmts.listProposalsByStatus.all(userId, env, statusFilter, limit);
    } else if (operationFilter) {
        rows = _stmts.listProposalsByOperation.all(userId, env, operationFilter, limit);
    } else {
        rows = _stmts.listProposals.all(userId, env, limit);
    }
    return rows.map(r => ({
        proposalId: r.proposal_id,
        targetKind: r.target_kind,
        operation: r.operation,
        proposalSummary: r.proposal_summary,
        explanatoryGain: r.explanatory_gain,
        compressionGain: r.compression_gain,
        predictiveGain: r.predictive_gain,
        complexityCost: r.complexity_cost,
        netScore: r.net_score,
        status: r.status,
        tsProposed: r.ts_proposed,
        tsDecided: r.ts_decided
    }));
}

module.exports = {
    TARGET_KINDS,
    OPERATIONS,
    PROPOSAL_STATUSES,
    MIN_NET_SCORE_TO_PROPOSE,
    GAIN_WEIGHTS,
    computeNetScore,
    proposePrimitiveChange,
    transitionToShadow,
    confirmProposal,
    applyOntologyVersion,
    getActiveProposals
};
