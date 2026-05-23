'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p85-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const cbg = require('../../../server/services/ml/R4_execution/computeBudgetGovernor');

const TEST_USER = 9085;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_compute_budgets WHERE user_id IN (?, ?)').run(TEST_USER, 9086);
    db.prepare('DELETE FROM ml_inference_decisions WHERE user_id IN (?, ?)').run(TEST_USER, 9086);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§85 Migrations 159 + 160', () => {
    test('ml_compute_budgets UNIQUE per (user, env, type)', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_compute_budgets
             (user_id, resolved_env, decision_type, deadline_ms,
              compute_budget_ms, safety_priority, last_updated)
             VALUES (?, ?, 'scalp', 500, 400, 'normal', ?)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_compute_budgets
             (user_id, resolved_env, decision_type, deadline_ms,
              compute_budget_ms, safety_priority, last_updated)
             VALUES (?, ?, 'scalp', 600, 500, 'high', ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('CHECK decision_type restricts', () => {
        const ts = Date.now();
        expect(() => db.prepare(
            `INSERT INTO ml_compute_budgets
             (user_id, resolved_env, decision_type, deadline_ms,
              compute_budget_ms, safety_priority, last_updated)
             VALUES (?, ?, 'BOGUS', 500, 400, 'normal', ?)`
        ).run(TEST_USER, TEST_ENV, ts)).toThrow();
    });

    test('CHECK chosen_mode restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_inference_decisions
             (user_id, resolved_env, inference_id, decision_type,
              time_remaining_ms, estimated_cost_ms, chosen_mode, ts)
             VALUES (?, ?, 'I-BAD', 'scalp', 100, 50, 'BOGUS', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§85 Constants', () => {
    test('DECISION_TYPES has 4 entries', () => {
        expect(cbg.DECISION_TYPES).toEqual([
            'scalp', 'intraday', 'swing', 'emergency_exit'
        ]);
    });

    test('INFERENCE_MODES has 3 entries', () => {
        expect(cbg.INFERENCE_MODES).toEqual([
            'full_stack', 'reduced_stack', 'emergency_safety'
        ]);
    });

    test('DEFAULT_DEADLINES_MS ordered: emergency < scalp < intraday < swing', () => {
        expect(cbg.DEFAULT_DEADLINES_MS.emergency_exit).toBeLessThan(cbg.DEFAULT_DEADLINES_MS.scalp);
        expect(cbg.DEFAULT_DEADLINES_MS.scalp).toBeLessThan(cbg.DEFAULT_DEADLINES_MS.intraday);
        expect(cbg.DEFAULT_DEADLINES_MS.intraday).toBeLessThan(cbg.DEFAULT_DEADLINES_MS.swing);
    });
});

describe('§85 configureBudget', () => {
    test('persists', () => {
        const r = cbg.configureBudget({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionType: 'scalp',
            deadlineMs: 500, computeBudgetMs: 400,
            safetyPriority: 'high'
        });
        expect(r.configured).toBe(true);
    });

    test('throws on invalid decisionType', () => {
        expect(() => cbg.configureBudget({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionType: 'BOGUS',
            deadlineMs: 500, computeBudgetMs: 400
        })).toThrow();
    });

    test('throws if computeBudget > deadline', () => {
        expect(() => cbg.configureBudget({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionType: 'scalp',
            deadlineMs: 100, computeBudgetMs: 500
        })).toThrow();
    });

    test('upserts on duplicate', () => {
        cbg.configureBudget({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionType: 'scalp',
            deadlineMs: 500, computeBudgetMs: 400
        });
        cbg.configureBudget({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionType: 'scalp',
            deadlineMs: 600, computeBudgetMs: 500
        });
        const b = cbg.getBudget({
            userId: TEST_USER, resolvedEnv: TEST_ENV, decisionType: 'scalp'
        });
        expect(b.deadlineMs).toBe(600);
    });
});

describe('§85 chooseInferenceMode', () => {
    test('full_stack when time abundant', () => {
        const r = cbg.chooseInferenceMode({
            decisionType: 'scalp',
            timeRemainingMs: 400,
            estimatedFullCostMs: 200,
            estimatedReducedCostMs: 100
        });
        expect(r.mode).toBe('full_stack');
        expect(r.earlyExit).toBe(false);
    });

    test('reduced_stack when time tight', () => {
        const r = cbg.chooseInferenceMode({
            decisionType: 'scalp',
            timeRemainingMs: 180,
            estimatedFullCostMs: 200,
            estimatedReducedCostMs: 100
        });
        expect(r.mode).toBe('reduced_stack');
    });

    test('emergency_safety when below reduced cost', () => {
        const r = cbg.chooseInferenceMode({
            decisionType: 'scalp',
            timeRemainingMs: 30,
            estimatedFullCostMs: 200,
            estimatedReducedCostMs: 100
        });
        expect(r.mode).toBe('emergency_safety');
        expect(r.earlyExit).toBe(true);
    });

    test('emergency_exit ALWAYS full_stack regardless of budget', () => {
        const r = cbg.chooseInferenceMode({
            decisionType: 'emergency_exit',
            timeRemainingMs: 10,
            estimatedFullCostMs: 500,  // way over budget
            estimatedReducedCostMs: 100
        });
        expect(r.mode).toBe('full_stack');
        expect(r.reasoning).toMatch(/safety overrides/i);
    });

    test('throws on invalid decisionType', () => {
        expect(() => cbg.chooseInferenceMode({
            decisionType: 'BOGUS',
            timeRemainingMs: 100,
            estimatedFullCostMs: 50,
            estimatedReducedCostMs: 20
        })).toThrow();
    });
});

describe('§85 recordInferenceDecision', () => {
    test('persists', () => {
        cbg.recordInferenceDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            inferenceId: 'I-001', decisionType: 'scalp',
            timeRemainingMs: 400, estimatedCostMs: 200,
            chosenMode: 'full_stack',
            reasoning: 'abundant time'
        });
        const rows = db.prepare(
            `SELECT * FROM ml_inference_decisions WHERE inference_id = 'I-001'`
        ).all();
        expect(rows).toHaveLength(1);
    });

    test('duplicate inference_id throws', () => {
        cbg.recordInferenceDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            inferenceId: 'I-DUP', decisionType: 'scalp',
            timeRemainingMs: 100, estimatedCostMs: 50,
            chosenMode: 'reduced_stack'
        });
        expect(() => cbg.recordInferenceDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            inferenceId: 'I-DUP', decisionType: 'scalp',
            timeRemainingMs: 100, estimatedCostMs: 50,
            chosenMode: 'reduced_stack'
        })).toThrow();
    });

    test('throws on invalid chosenMode', () => {
        expect(() => cbg.recordInferenceDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            inferenceId: 'I-BAD', decisionType: 'scalp',
            timeRemainingMs: 100, estimatedCostMs: 50,
            chosenMode: 'BOGUS'
        })).toThrow();
    });
});

describe('§85 getInferenceStats + evaluateDeadlineHealth', () => {
    test('stats aggregates by mode+type', () => {
        cbg.recordInferenceDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            inferenceId: 'IS-1', decisionType: 'scalp',
            timeRemainingMs: 100, estimatedCostMs: 50,
            chosenMode: 'full_stack'
        });
        cbg.recordInferenceDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            inferenceId: 'IS-2', decisionType: 'scalp',
            timeRemainingMs: 80, estimatedCostMs: 70,
            chosenMode: 'reduced_stack'
        });
        const s = cbg.getInferenceStats({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(s.total).toBe(2);
        expect(s.byModeAndDecision.length).toBe(2);
    });

    test('deadline health: under budget = healthy', () => {
        cbg.configureBudget({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionType: 'scalp',
            deadlineMs: 500, computeBudgetMs: 400
        });
        const r = cbg.evaluateDeadlineHealth({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionType: 'scalp',
            recentObservations: [
                { actualMs: 300 }, { actualMs: 350 },
                { actualMs: 380 }, { actualMs: 200 }
            ]
        });
        expect(r.healthy).toBe(true);
    });

    test('deadline health: > 20% over budget = unhealthy', () => {
        cbg.configureBudget({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionType: 'scalp',
            deadlineMs: 500, computeBudgetMs: 400
        });
        const r = cbg.evaluateDeadlineHealth({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionType: 'scalp',
            recentObservations: [
                { actualMs: 500 }, { actualMs: 450 },
                { actualMs: 480 }, { actualMs: 200 }
            ]
        });
        expect(r.healthy).toBe(false);
        expect(r.overBudgetRate).toBeGreaterThan(0.20);
    });
});

describe('§85 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9086;
        cbg.configureBudget({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionType: 'scalp',
            deadlineMs: 500, computeBudgetMs: 400
        });
        const b1 = cbg.getBudget({
            userId: TEST_USER, resolvedEnv: TEST_ENV, decisionType: 'scalp'
        });
        const b2 = cbg.getBudget({
            userId: OTHER_USER, resolvedEnv: TEST_ENV, decisionType: 'scalp'
        });
        expect(b1).toBeTruthy();
        expect(b2).toBe(null);
    });
});
