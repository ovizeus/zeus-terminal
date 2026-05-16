'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p111-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const stp = require('../../../server/services/ml/R6_shadowMeta/scenarioTreePlanner');

const TEST_USER = 9111;
const OTHER_USER = 9112;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_scenario_trees WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
    db.prepare('DELETE FROM ml_scenario_branches WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§111 Migrations 211 + 212', () => {
    test('tree_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_scenario_trees
             (user_id, resolved_env, tree_id, decision_id,
              dominant_branch, active_branches_count,
              weighted_score, adverse_share, ts)
             VALUES (?, ?, 'ST-UNIQ', 'D', 'continuation', 3, 0.5, 0.1, ?)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_scenario_trees
             (user_id, resolved_env, tree_id, decision_id,
              dominant_branch, active_branches_count,
              weighted_score, adverse_share, ts)
             VALUES (?, ?, 'ST-UNIQ', 'D2', 'fakeout', 2, -0.1, 0.4, ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('CHECK dominant_branch restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_scenario_trees
             (user_id, resolved_env, tree_id, decision_id,
              dominant_branch, active_branches_count,
              weighted_score, adverse_share, ts)
             VALUES (?, ?, 'ST-BAD', 'D', 'BOGUS', 1, 0, 0, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK adverse_share range', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_scenario_trees
             (user_id, resolved_env, tree_id, decision_id,
              dominant_branch, active_branches_count,
              weighted_score, adverse_share, ts)
             VALUES (?, ?, 'ST-AS', 'D', 'continuation', 1, 0, 1.5, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK branch_kind + probability range', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_scenario_branches
             (user_id, resolved_env, branch_id, tree_id, branch_kind,
              probability, expected_action, expected_pnl,
              is_pruned, reason, ts)
             VALUES (?, ?, 'SB-BAD', 'T', 'continuation', 1.5, 'a', 0, 0, NULL, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§111 Constants', () => {
    test('BRANCH_KINDS has 5 entries', () => {
        expect(stp.BRANCH_KINDS).toEqual([
            'continuation', 'fakeout', 'squeeze',
            'mean_reversion', 'macro_interruption'
        ]);
    });

    test('SCENARIO_DECISIONS has 3 entries', () => {
        expect(stp.SCENARIO_DECISIONS).toEqual([
            'PROCEED', 'REDUCE_SIZE', 'SKIP'
        ]);
    });

    test('MAX_BRANCHES_LIVE matches canonical 3-5 range', () => {
        expect(stp.MAX_BRANCHES_LIVE).toBe(5);
    });
});

describe('§111 pruneBranches (pure)', () => {
    test('removes below probability threshold', () => {
        const r = stp.pruneBranches({
            branches: [
                { branchKind: 'continuation', probability: 0.5, expectedPnl: 10 },
                { branchKind: 'fakeout', probability: 0.02, expectedPnl: -5 }
            ]
        });
        expect(r.kept).toHaveLength(1);
        expect(r.pruned).toHaveLength(1);
        expect(r.pruned[0].branchKind).toBe('fakeout');
    });

    test('caps at MAX_BRANCHES_LIVE', () => {
        const branches = stp.BRANCH_KINDS.map((k, i) => ({
            branchKind: k, probability: 0.18 - i * 0.01, expectedPnl: 5
        }));
        // add one extra > MAX
        branches.push({ branchKind: 'continuation', probability: 0.5, expectedPnl: 10 });
        const r = stp.pruneBranches({ branches });
        expect(r.kept.length).toBeLessThanOrEqual(stp.MAX_BRANCHES_LIVE);
    });
});

describe('§111 computeWeightedScore (pure)', () => {
    test('weighted sum + adverse share', () => {
        const r = stp.computeWeightedScore({
            branches: [
                { probability: 0.5, expectedPnl: 10, isPruned: 0 },
                { probability: 0.3, expectedPnl: -5, isPruned: 0 },
                { probability: 0.2, expectedPnl: 0, isPruned: 0 }
            ]
        });
        // 0.5*10 + 0.3*(-5) + 0.2*0 = 5 - 1.5 = 3.5
        expect(r.weightedScore).toBeCloseTo(3.5);
        // adverse = prob where pnl < 0 / sum = 0.3 / 1.0 = 0.3
        expect(r.adverseShare).toBeCloseTo(0.3);
    });

    test('pruned branches excluded', () => {
        const r = stp.computeWeightedScore({
            branches: [
                { probability: 0.5, expectedPnl: 10, isPruned: 0 },
                { probability: 0.5, expectedPnl: -100, isPruned: 1 }
            ]
        });
        expect(r.weightedScore).toBe(5);   // pruned excluded
        expect(r.adverseShare).toBe(0);
    });

    test('zero active branches → 0', () => {
        const r = stp.computeWeightedScore({ branches: [] });
        expect(r.weightedScore).toBe(0);
        expect(r.adverseShare).toBe(0);
    });
});

describe('§111 evaluateScenarioDecision (pure)', () => {
    test('negative score → SKIP', () => {
        const r = stp.evaluateScenarioDecision({
            weightedScore: -0.5, adverseShare: 0.2
        });
        expect(r.decision).toBe('SKIP');
    });

    test('high adverse share → REDUCE_SIZE', () => {
        const r = stp.evaluateScenarioDecision({
            weightedScore: 5, adverseShare: 0.4
        });
        expect(r.decision).toBe('REDUCE_SIZE');
    });

    test('positive + low adverse → PROCEED', () => {
        const r = stp.evaluateScenarioDecision({
            weightedScore: 5, adverseShare: 0.10
        });
        expect(r.decision).toBe('PROCEED');
    });
});

describe('§111 registerScenarioTree', () => {
    test('persists tree + branches atomically', () => {
        const r = stp.registerScenarioTree({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            treeId: 'RST-1', decisionId: 'D-1',
            branches: [
                { branchId: 'B1', branchKind: 'continuation',
                  probability: 0.5, expectedAction: 'LONG',
                  expectedPnl: 10 },
                { branchId: 'B2', branchKind: 'fakeout',
                  probability: 0.3, expectedAction: 'CLOSE',
                  expectedPnl: -3 }
            ]
        });
        expect(r.registered).toBe(true);
        expect(r.dominantBranch).toBe('continuation');
    });

    test('invalid branch_kind throws', () => {
        expect(() => stp.registerScenarioTree({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            treeId: 'RST-BAD', decisionId: 'D',
            branches: [
                { branchId: 'B', branchKind: 'BOGUS',
                  probability: 0.5, expectedAction: 'a',
                  expectedPnl: 0 }
            ]
        })).toThrow();
    });

    test('duplicate treeId throws', () => {
        stp.registerScenarioTree({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            treeId: 'RST-DUP', decisionId: 'D',
            branches: [{ branchId: 'B-DUP-1',
                branchKind: 'continuation', probability: 0.5,
                expectedAction: 'L', expectedPnl: 5 }]
        });
        expect(() => stp.registerScenarioTree({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            treeId: 'RST-DUP', decisionId: 'D2',
            branches: [{ branchId: 'B-DUP-2',
                branchKind: 'fakeout', probability: 0.5,
                expectedAction: 'C', expectedPnl: -2 }]
        })).toThrow();
    });

    test('empty branches throws', () => {
        expect(() => stp.registerScenarioTree({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            treeId: 'RST-EMPTY', decisionId: 'D',
            branches: []
        })).toThrow();
    });
});

describe('§111 getTreeAudit', () => {
    test('returns tree + all branches', () => {
        stp.registerScenarioTree({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            treeId: 'GTA-1', decisionId: 'D',
            branches: [
                { branchId: 'GTA-B1', branchKind: 'continuation',
                  probability: 0.6, expectedAction: 'L',
                  expectedPnl: 8 },
                { branchId: 'GTA-B2', branchKind: 'squeeze',
                  probability: 0.4, expectedAction: 'L',
                  expectedPnl: 12 }
            ]
        });
        const r = stp.getTreeAudit({
            userId: TEST_USER, resolvedEnv: TEST_ENV, treeId: 'GTA-1'
        });
        expect(r.tree.treeId).toBe('GTA-1');
        expect(r.branches).toHaveLength(2);
    });

    test('unknown tree throws', () => {
        expect(() => stp.getTreeAudit({
            userId: TEST_USER, resolvedEnv: TEST_ENV, treeId: 'NOEXIST'
        })).toThrow();
    });
});

describe('§111 isolation', () => {
    test('per (user × env) isolation', () => {
        stp.registerScenarioTree({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            treeId: 'ISO-1', decisionId: 'D',
            branches: [{ branchId: 'ISO-B', branchKind: 'continuation',
                probability: 0.5, expectedAction: 'L', expectedPnl: 5 }]
        });
        const a = stp.getTreeHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const b = stp.getTreeHistory({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(a).toHaveLength(1);
        expect(b).toHaveLength(0);
    });
});
