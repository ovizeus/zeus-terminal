'use strict';

/**
 * OMEGA R6 ShadowMeta — scenarioTreePlanner (canonical §111)
 *
 * §111 DELIBERATIVE SCENARIO SEARCH / TREE-OF-THOUGHT PLANNER.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 2901-2933.
 *
 * "Bot trebuie sa simuleze deliberativ mai multe viitoruri plauzibile pe
 *  termen scurt si mediu... scenario tree per decizie importanta...
 *  branching pe continuation / fakeout / squeeze / mean_reversion /
 *  macro_interruption... evaluare actiuni optime pe fiecare ramura...
 *  pruning ramuri improbabile... scenario-weighted decision score...
 *  'daca intru acum, care sunt cele mai probabile 3-5 lumi care urmeaza?'...
 *  ramurile adverse trebuie sa influenteze size si management."
 *
 * Distinct from §71 internalDebate (1 decision, 3 voices), §48 ensembleVoting
 * (aggregate predictions), §96 syntheticMarketGenerator (synthetic data for
 * training NOT live), §100 narrativeCoherence (1 story), §110
 * adaptiveReasoningRouter (which modules). §111 = LIVE multi-world projection.
 */

const { db } = require('../../database');

const BRANCH_KINDS = Object.freeze([
    'continuation', 'fakeout', 'squeeze',
    'mean_reversion', 'macro_interruption'
]);
const SCENARIO_DECISIONS = Object.freeze([
    'PROCEED', 'REDUCE_SIZE', 'SKIP'
]);

const MIN_PROBABILITY_TO_KEEP = 0.05;
const MAX_BRANCHES_LIVE = 5;
const ADVERSE_INFLUENCE_THRESHOLD = 0.30;
const SKIP_NEGATIVE_SCORE = -0.1;

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`scenarioTreePlanner: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertTree: db.prepare(`
        INSERT INTO ml_scenario_trees
        (user_id, resolved_env, tree_id, decision_id,
         dominant_branch, active_branches_count,
         weighted_score, adverse_share, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getTree: db.prepare(`
        SELECT * FROM ml_scenario_trees WHERE tree_id = ?
    `),
    listTrees: db.prepare(`
        SELECT * FROM ml_scenario_trees
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC LIMIT ?
    `),
    insertBranch: db.prepare(`
        INSERT INTO ml_scenario_branches
        (user_id, resolved_env, branch_id, tree_id, branch_kind,
         probability, expected_action, expected_pnl,
         is_pruned, reason, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listBranchesByTree: db.prepare(`
        SELECT * FROM ml_scenario_branches
        WHERE user_id = ? AND resolved_env = ? AND tree_id = ?
        ORDER BY probability DESC, ts ASC
    `)
};

// ── pruneBranches (pure) ───────────────────────────────────────────
// Prune sub-threshold probabilities + cap at MAX_BRANCHES_LIVE.
function pruneBranches(params) {
    const branches = _required(params, 'branches');
    const threshold = (params && params.probabilityThreshold !== undefined)
        ? params.probabilityThreshold : MIN_PROBABILITY_TO_KEEP;
    const maxKeep = (params && params.maxKeep !== undefined)
        ? params.maxKeep : MAX_BRANCHES_LIVE;

    const sorted = [...branches].sort((a, b) => b.probability - a.probability);
    const kept = [];
    const pruned = [];
    for (const b of sorted) {
        if (b.probability < threshold) {
            pruned.push({ ...b, reason: 'below_probability_threshold' });
        } else if (kept.length >= maxKeep) {
            pruned.push({ ...b, reason: 'over_max_branches_live' });
        } else {
            kept.push(b);
        }
    }
    return { kept, pruned };
}

// ── computeWeightedScore (pure) ────────────────────────────────────
// weighted_score = Σ prob × pnl (active only)
// adverse_share  = Σ prob(active AND pnl<0) / Σ prob(active)
function computeWeightedScore(params) {
    const branches = _required(params, 'branches');
    const active = branches.filter(b => !b.isPruned);
    if (active.length === 0) {
        return { weightedScore: 0, adverseShare: 0, activeCount: 0 };
    }
    let weightedScore = 0;
    let probTotal = 0;
    let probAdverse = 0;
    for (const b of active) {
        weightedScore += b.probability * b.expectedPnl;
        probTotal += b.probability;
        if (b.expectedPnl < 0) probAdverse += b.probability;
    }
    return {
        weightedScore,
        adverseShare: probTotal > 0 ? probAdverse / probTotal : 0,
        activeCount: active.length
    };
}

// ── evaluateScenarioDecision (pure) ────────────────────────────────
function evaluateScenarioDecision(params) {
    const weightedScore = _required(params, 'weightedScore');
    const adverseShare = _required(params, 'adverseShare');
    const skipThreshold = (params && params.skipThreshold !== undefined)
        ? params.skipThreshold : SKIP_NEGATIVE_SCORE;
    const adverseThreshold = (params && params.adverseThreshold !== undefined)
        ? params.adverseThreshold : ADVERSE_INFLUENCE_THRESHOLD;

    let decision;
    let reason;
    if (weightedScore <= skipThreshold) {
        decision = 'SKIP';
        reason = 'weighted_score_negative';
    } else if (adverseShare >= adverseThreshold) {
        decision = 'REDUCE_SIZE';
        reason = 'adverse_branches_dominant';
    } else {
        decision = 'PROCEED';
        reason = 'positive_score_low_adverse';
    }
    return { decision, reason, weightedScore, adverseShare };
}

// ── registerScenarioTree ───────────────────────────────────────────
function registerScenarioTree(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const treeId = _required(params, 'treeId');
    const decisionId = _required(params, 'decisionId');
    const branches = _required(params, 'branches');
    if (!Array.isArray(branches) || branches.length === 0) {
        throw new Error('scenarioTreePlanner: branches must be non-empty array');
    }
    for (const b of branches) {
        if (!BRANCH_KINDS.includes(b.branchKind)) {
            throw new Error(
                `scenarioTreePlanner: invalid branchKind "${b.branchKind}"`
            );
        }
        if (b.probability < 0 || b.probability > 1) {
            throw new Error('scenarioTreePlanner: probability must be in [0,1]');
        }
    }
    const ts = (params && params.ts) ? params.ts : Date.now();

    // Auto-prune + auto-compute weighted score
    const { kept, pruned } = pruneBranches({ branches });
    const all = kept.map(b => ({ ...b, isPruned: 0 }))
        .concat(pruned.map(b => ({ ...b, isPruned: 1 })));
    const scoreResult = computeWeightedScore({ branches: all });
    const dominant = kept.length > 0
        ? kept.reduce((a, b) => a.probability >= b.probability ? a : b).branchKind
        : branches.reduce((a, b) => a.probability >= b.probability ? a : b).branchKind;

    const txn = db.transaction(() => {
        _stmts.insertTree.run(
            userId, env, treeId, decisionId,
            dominant, kept.length,
            scoreResult.weightedScore, scoreResult.adverseShare, ts
        );
        for (const b of all) {
            _stmts.insertBranch.run(
                userId, env, b.branchId, treeId, b.branchKind,
                b.probability, b.expectedAction, b.expectedPnl,
                b.isPruned, b.reason || null, ts
            );
        }
    });

    try {
        txn();
        return {
            registered: true, treeId,
            dominantBranch: dominant,
            activeBranchesCount: kept.length,
            weightedScore: scoreResult.weightedScore,
            adverseShare: scoreResult.adverseShare
        };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`scenarioTreePlanner: duplicate treeId/branchId in "${treeId}"`);
        }
        throw err;
    }
}

// ── getTreeAudit ───────────────────────────────────────────────────
function getTreeAudit(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const treeId = _required(params, 'treeId');

    const tree = _stmts.getTree.get(treeId);
    if (!tree) {
        throw new Error(`scenarioTreePlanner: tree "${treeId}" not found`);
    }
    if (tree.user_id !== userId || tree.resolved_env !== env) {
        throw new Error('scenarioTreePlanner: tree not owned by user/env');
    }
    const branches = _stmts.listBranchesByTree.all(userId, env, treeId);
    return {
        tree: {
            treeId: tree.tree_id,
            decisionId: tree.decision_id,
            dominantBranch: tree.dominant_branch,
            activeBranchesCount: tree.active_branches_count,
            weightedScore: tree.weighted_score,
            adverseShare: tree.adverse_share,
            ts: tree.ts
        },
        branches: branches.map(b => ({
            branchId: b.branch_id,
            branchKind: b.branch_kind,
            probability: b.probability,
            expectedAction: b.expected_action,
            expectedPnl: b.expected_pnl,
            isPruned: !!b.is_pruned,
            reason: b.reason,
            ts: b.ts
        }))
    };
}

// ── getTreeHistory ─────────────────────────────────────────────────
function getTreeHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const limit = (params && params.limit) ? params.limit : 100;

    const rows = _stmts.listTrees.all(userId, env, limit);
    return rows.map(r => ({
        treeId: r.tree_id,
        decisionId: r.decision_id,
        dominantBranch: r.dominant_branch,
        activeBranchesCount: r.active_branches_count,
        weightedScore: r.weighted_score,
        adverseShare: r.adverse_share,
        ts: r.ts
    }));
}

module.exports = {
    BRANCH_KINDS,
    SCENARIO_DECISIONS,
    MIN_PROBABILITY_TO_KEEP,
    MAX_BRANCHES_LIVE,
    ADVERSE_INFLUENCE_THRESHOLD,
    SKIP_NEGATIVE_SCORE,
    pruneBranches,
    computeWeightedScore,
    evaluateScenarioDecision,
    registerScenarioTree,
    getTreeAudit,
    getTreeHistory
};
