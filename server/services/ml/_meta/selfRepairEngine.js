'use strict';

/**
 * OMEGA meta — selfRepairEngine (canonical §115)
 *
 * §115 SELF-REPAIR / AUTONOMOUS IMPROVEMENT PROPOSAL ENGINE.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 3036-3074.
 *
 * "Bot trebuie sa poata propune singur remedii candidate, in mod controlat...
 *  root-cause proposal engine... ipoteze de reparatie pentru threshold issues
 *  /regime misclassification / sizing / execution drift / feature redundancy /
 *  stale concepts... propuneri de retune/retrain/disable/replace/quarantine/
 *  shadow_experiment... ranking dupa expected benefit vs risk... trimitere in
 *  shadow/canary, NU direct in live... motorul de self-repair NU are voie sa
 *  se auto-modifice direct in live... toate propunerile prin shadow/canary/
 *  governance... reparatia explicabila si reversibila."
 *
 * Distinct from §113 causalDiscoveryEngine (causal-specific edge revisions),
 * §44 adversarialSelfTester (attacks decisions), §38 intelligenceChecker
 * (per-decision self-eval), §101 socraticSelfDoubt (worldview falsification),
 * §94 complexityBudget (MDL pruning), §254 autoQuarantine (post-hoc failure-
 * based). §115 = proactive repair proposals across 6 issue kinds.
 */

const { db } = require('../../database');

const ISSUE_KINDS = Object.freeze([
    'threshold', 'regime_misclassification', 'sizing',
    'execution_drift', 'feature_redundancy', 'stale_concepts'
]);
const REMEDIATION_TYPES = Object.freeze([
    'retune', 'retrain', 'disable', 'replace',
    'quarantine', 'shadow_experiment'
]);
const PROPOSAL_STATUSES = Object.freeze([
    'PROPOSED', 'SHADOW', 'CANARY', 'APPLIED', 'REJECTED'
]);
const OUTCOME_DECISIONS = Object.freeze([
    'PROMOTE', 'REJECT', 'EXTEND_SHADOW'
]);

const RISK_AVERSION_LAMBDA = 2.0;
const MIN_BENEFIT_TO_PROPOSE = 0.10;

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`selfRepairEngine: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertProposal: db.prepare(`
        INSERT INTO ml_repair_proposals
        (user_id, resolved_env, proposal_id, issue_kind,
         remediation_type, affected_component_id,
         expected_benefit, expected_risk, rank_score,
         status, justification, ts_proposed, ts_decided)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PROPOSED', ?, ?, NULL)
    `),
    getProposal: db.prepare(`
        SELECT * FROM ml_repair_proposals WHERE proposal_id = ?
    `),
    listProposals: db.prepare(`
        SELECT * FROM ml_repair_proposals
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts_proposed DESC LIMIT ?
    `),
    listProposalsByStatus: db.prepare(`
        SELECT * FROM ml_repair_proposals
        WHERE user_id = ? AND resolved_env = ? AND status = ?
        ORDER BY ts_proposed DESC LIMIT ?
    `),
    listProposalsByIssueKind: db.prepare(`
        SELECT * FROM ml_repair_proposals
        WHERE user_id = ? AND resolved_env = ? AND issue_kind = ?
        ORDER BY ts_proposed DESC LIMIT ?
    `),
    listProposalsByStatusAndKind: db.prepare(`
        SELECT * FROM ml_repair_proposals
        WHERE user_id = ? AND resolved_env = ?
          AND status = ? AND issue_kind = ?
        ORDER BY ts_proposed DESC LIMIT ?
    `),
    updateProposalStatus: db.prepare(`
        UPDATE ml_repair_proposals
        SET status = ?, ts_decided = ?
        WHERE user_id = ? AND resolved_env = ? AND proposal_id = ?
    `),
    insertOutcome: db.prepare(`
        INSERT INTO ml_repair_outcomes
        (user_id, resolved_env, outcome_id, proposal_id,
         observed_benefit, observed_risk, decision, reason, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
};

// ── computeRankScore (pure) ────────────────────────────────────────
// rank = benefit − λ × risk
function computeRankScore(params) {
    const expectedBenefit = _required(params, 'expectedBenefit');
    const expectedRisk = _required(params, 'expectedRisk');
    const lambda = (params && params.riskAversionLambda !== undefined)
        ? params.riskAversionLambda : RISK_AVERSION_LAMBDA;
    if (expectedBenefit < 0 || expectedBenefit > 1) {
        throw new Error('selfRepairEngine: expectedBenefit must be in [0,1]');
    }
    if (expectedRisk < 0 || expectedRisk > 1) {
        throw new Error('selfRepairEngine: expectedRisk must be in [0,1]');
    }
    return {
        rankScore: expectedBenefit - lambda * expectedRisk,
        lambda
    };
}

// ── proposeRepair ──────────────────────────────────────────────────
function proposeRepair(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const proposalId = _required(params, 'proposalId');
    const issueKind = _required(params, 'issueKind');
    if (!ISSUE_KINDS.includes(issueKind)) {
        throw new Error(`selfRepairEngine: invalid issueKind "${issueKind}"`);
    }
    const remediationType = _required(params, 'remediationType');
    if (!REMEDIATION_TYPES.includes(remediationType)) {
        throw new Error(`selfRepairEngine: invalid remediationType "${remediationType}"`);
    }
    const affectedComponentId = _required(params, 'affectedComponentId');
    const expectedBenefit = _required(params, 'expectedBenefit');
    const expectedRisk = _required(params, 'expectedRisk');
    if (expectedBenefit < MIN_BENEFIT_TO_PROPOSE) {
        throw new Error(
            `selfRepairEngine: expectedBenefit ${expectedBenefit} ` +
            `< MIN_BENEFIT_TO_PROPOSE ${MIN_BENEFIT_TO_PROPOSE} — ` +
            'not worth proposing'
        );
    }
    const justification = _required(params, 'justification');
    const ts = (params && params.ts) ? params.ts : Date.now();

    const { rankScore } = computeRankScore({ expectedBenefit, expectedRisk });

    try {
        _stmts.insertProposal.run(
            userId, env, proposalId, issueKind, remediationType,
            affectedComponentId, expectedBenefit, expectedRisk,
            rankScore, justification, ts
        );
        return { proposed: true, proposalId, rankScore };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`selfRepairEngine: duplicate proposalId "${proposalId}"`);
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
        throw new Error(`selfRepairEngine: proposal "${proposalId}" not found`);
    }
    if (p.user_id !== userId || p.resolved_env !== env) {
        throw new Error('selfRepairEngine: proposal not owned by user/env');
    }
    if (p.status !== 'PROPOSED') {
        throw new Error(
            `selfRepairEngine: cannot transition to SHADOW from "${p.status}"`
        );
    }
    _stmts.updateProposalStatus.run('SHADOW', ts, userId, env, proposalId);
    return { transitioned: true, proposalId, newStatus: 'SHADOW' };
}

// ── transitionToCanary ─────────────────────────────────────────────
function transitionToCanary(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const proposalId = _required(params, 'proposalId');
    const ts = (params && params.ts) ? params.ts : Date.now();

    const p = _stmts.getProposal.get(proposalId);
    if (!p) {
        throw new Error(`selfRepairEngine: proposal "${proposalId}" not found`);
    }
    if (p.user_id !== userId || p.resolved_env !== env) {
        throw new Error('selfRepairEngine: proposal not owned by user/env');
    }
    if (p.status !== 'SHADOW') {
        throw new Error(
            `selfRepairEngine: cannot transition to CANARY from "${p.status}" ` +
            '(must be SHADOW first per canonical line 3069)'
        );
    }
    _stmts.updateProposalStatus.run('CANARY', ts, userId, env, proposalId);
    return { transitioned: true, proposalId, newStatus: 'CANARY' };
}

// ── recordRepairOutcome ────────────────────────────────────────────
function recordRepairOutcome(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const outcomeId = _required(params, 'outcomeId');
    const proposalId = _required(params, 'proposalId');
    const observedBenefit = _required(params, 'observedBenefit');
    const observedRisk = _required(params, 'observedRisk');
    const decision = _required(params, 'decision');
    if (!OUTCOME_DECISIONS.includes(decision)) {
        throw new Error(`selfRepairEngine: invalid decision "${decision}"`);
    }
    const reason = (params && params.reason) ? params.reason : null;
    const ts = (params && params.ts) ? params.ts : Date.now();

    const p = _stmts.getProposal.get(proposalId);
    if (!p) {
        throw new Error(`selfRepairEngine: proposal "${proposalId}" not found`);
    }
    if (p.user_id !== userId || p.resolved_env !== env) {
        throw new Error('selfRepairEngine: proposal not owned by user/env');
    }

    const DECISION_TO_STATUS = {
        PROMOTE: 'APPLIED',
        REJECT: 'REJECTED',
        EXTEND_SHADOW: p.status   // keep current
    };
    const newStatus = DECISION_TO_STATUS[decision];

    const txn = db.transaction(() => {
        _stmts.insertOutcome.run(
            userId, env, outcomeId, proposalId,
            observedBenefit, observedRisk, decision, reason, ts
        );
        if (newStatus !== p.status) {
            _stmts.updateProposalStatus.run(
                newStatus, ts, userId, env, proposalId
            );
        }
    });

    try {
        txn();
        return {
            recorded: true, outcomeId,
            decision, newStatus
        };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`selfRepairEngine: duplicate outcomeId "${outcomeId}"`);
        }
        throw err;
    }
}

// ── getActiveProposals ─────────────────────────────────────────────
function getActiveProposals(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const statusFilter = params && params.statusFilter;
    const issueKindFilter = params && params.issueKindFilter;
    const limit = (params && params.limit) ? params.limit : 100;

    if (statusFilter && !PROPOSAL_STATUSES.includes(statusFilter)) {
        throw new Error(`selfRepairEngine: invalid statusFilter "${statusFilter}"`);
    }
    if (issueKindFilter && !ISSUE_KINDS.includes(issueKindFilter)) {
        throw new Error(`selfRepairEngine: invalid issueKindFilter "${issueKindFilter}"`);
    }

    let rows;
    if (statusFilter && issueKindFilter) {
        rows = _stmts.listProposalsByStatusAndKind.all(
            userId, env, statusFilter, issueKindFilter, limit
        );
    } else if (statusFilter) {
        rows = _stmts.listProposalsByStatus.all(userId, env, statusFilter, limit);
    } else if (issueKindFilter) {
        rows = _stmts.listProposalsByIssueKind.all(userId, env, issueKindFilter, limit);
    } else {
        rows = _stmts.listProposals.all(userId, env, limit);
    }
    return rows.map(r => ({
        proposalId: r.proposal_id,
        issueKind: r.issue_kind,
        remediationType: r.remediation_type,
        affectedComponentId: r.affected_component_id,
        expectedBenefit: r.expected_benefit,
        expectedRisk: r.expected_risk,
        rankScore: r.rank_score,
        status: r.status,
        justification: r.justification,
        tsProposed: r.ts_proposed,
        tsDecided: r.ts_decided
    }));
}

module.exports = {
    ISSUE_KINDS,
    REMEDIATION_TYPES,
    PROPOSAL_STATUSES,
    OUTCOME_DECISIONS,
    RISK_AVERSION_LAMBDA,
    MIN_BENEFIT_TO_PROPOSE,
    computeRankScore,
    proposeRepair,
    transitionToShadow,
    transitionToCanary,
    recordRepairOutcome,
    getActiveProposals
};
