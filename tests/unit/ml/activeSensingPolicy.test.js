'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p99-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const asp = require('../../../server/services/ml/R4_execution/activeSensingPolicy');

const TEST_USER = 9099;
const OTHER_USER = 9100;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_observability_queries WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
    db.prepare('DELETE FROM ml_observability_outcomes WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§99 Migrations 187 + 188', () => {
    test('query_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_observability_queries
             (user_id, resolved_env, query_id, observation_type, decision,
              expected_ig, cost_estimate, utility_ratio,
              deadline_remaining_ms, reason, ts)
             VALUES (?, ?, 'Q-UNIQ', 'deep_book', 'query_now', 0.5, 0.2, 2.5, 500, NULL, ?)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_observability_queries
             (user_id, resolved_env, query_id, observation_type, decision,
              expected_ig, cost_estimate, utility_ratio,
              deadline_remaining_ms, reason, ts)
             VALUES (?, ?, 'Q-UNIQ', 'sentiment_refresh', 'skip', 0.1, 0.5, 0.2, 200, NULL, ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('CHECK observation_type restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_observability_queries
             (user_id, resolved_env, query_id, observation_type, decision,
              expected_ig, cost_estimate, utility_ratio,
              deadline_remaining_ms, reason, ts)
             VALUES (?, ?, 'Q-BAD', 'BOGUS', 'query_now', 0.5, 0.2, 2.5, 500, NULL, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK decision restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_observability_queries
             (user_id, resolved_env, query_id, observation_type, decision,
              expected_ig, cost_estimate, utility_ratio,
              deadline_remaining_ms, reason, ts)
             VALUES (?, ?, 'Q-BAD2', 'deep_book', 'BOGUS', 0.5, 0.2, 2.5, 500, NULL, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK verdict_changed in (0,1)', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_observability_outcomes
             (user_id, resolved_env, outcome_id, query_id,
              actual_ig, actual_cost, verdict_changed, ts)
             VALUES (?, ?, 'O-BAD', 'Q', 0.5, 0.2, 5, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§99 Constants', () => {
    test('OBSERVATION_TYPES has 5 entries', () => {
        expect(asp.OBSERVATION_TYPES).toHaveLength(5);
    });

    test('SENSING_DECISIONS has 3 entries', () => {
        expect(asp.SENSING_DECISIONS).toEqual(['query_now', 'wait', 'skip']);
    });
});

describe('§99 estimateInformationGain', () => {
    test('high confidence → low IG', () => {
        const r = asp.estimateInformationGain({
            observationType: 'deep_book', currentConfidence: 0.95
        });
        expect(r.expectedIG).toBeLessThan(0.05);
    });

    test('low confidence → higher IG', () => {
        const r = asp.estimateInformationGain({
            observationType: 'deep_book', currentConfidence: 0.30
        });
        expect(r.expectedIG).toBeGreaterThan(0.15);
    });

    test('invalid type throws', () => {
        expect(() => asp.estimateInformationGain({
            observationType: 'BOGUS', currentConfidence: 0.5
        })).toThrow();
    });
});

describe('§99 estimateObservationCost', () => {
    test('higher inputs → higher cost', () => {
        const low = asp.estimateObservationCost({
            latencyMs: 50, apiUnits: 1, computeUnits: 10
        });
        const high = asp.estimateObservationCost({
            latencyMs: 500, apiUnits: 8, computeUnits: 80
        });
        expect(high.cost).toBeGreaterThan(low.cost);
    });

    test('negative inputs throw', () => {
        expect(() => asp.estimateObservationCost({
            latencyMs: -1, apiUnits: 1, computeUnits: 10
        })).toThrow();
    });
});

describe('§99 evaluateActiveSensingDecision', () => {
    test('query_now when ratio high + deadline ok', () => {
        const r = asp.evaluateActiveSensingDecision({
            expectedIG: 0.5, cost: 0.1,
            deadlineRemainingMs: 1000
        });
        expect(r.decision).toBe('query_now');
    });

    test('skip when deadline insufficient', () => {
        const r = asp.evaluateActiveSensingDecision({
            expectedIG: 0.5, cost: 0.1,
            deadlineRemainingMs: 50
        });
        expect(r.decision).toBe('skip');
        expect(r.reason).toBe('deadline_insufficient');
    });

    test('wait when low utility but deadline far', () => {
        const r = asp.evaluateActiveSensingDecision({
            expectedIG: 0.05, cost: 0.5,
            deadlineRemainingMs: 5000
        });
        expect(r.decision).toBe('wait');
    });

    test('skip when low utility + deadline near', () => {
        const r = asp.evaluateActiveSensingDecision({
            expectedIG: 0.05, cost: 0.5,
            deadlineRemainingMs: 200
        });
        expect(r.decision).toBe('skip');
        expect(r.reason).toBe('low_utility');
    });

    test('respects observationLatencyMs in deadline check', () => {
        const r = asp.evaluateActiveSensingDecision({
            expectedIG: 0.5, cost: 0.1,
            deadlineRemainingMs: 400,
            observationLatencyMs: 350
        });
        // 400 < 100+350 = 450 → skip
        expect(r.decision).toBe('skip');
    });
});

describe('§99 recordSensingDecision', () => {
    test('persists with computed utility ratio', () => {
        const r = asp.recordSensingDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            queryId: 'RD-1', observationType: 'deep_book',
            decision: 'query_now',
            expectedIG: 0.5, costEstimate: 0.1,
            deadlineRemainingMs: 1000
        });
        expect(r.utilityRatio).toBeCloseTo(5);
    });

    test('duplicate throws', () => {
        asp.recordSensingDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            queryId: 'RD-DUP', observationType: 'deep_book',
            decision: 'wait', expectedIG: 0.1, costEstimate: 0.5,
            deadlineRemainingMs: 1000
        });
        expect(() => asp.recordSensingDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            queryId: 'RD-DUP', observationType: 'deep_book',
            decision: 'skip', expectedIG: 0.1, costEstimate: 0.5,
            deadlineRemainingMs: 1000
        })).toThrow();
    });

    test('invalid decision throws', () => {
        expect(() => asp.recordSensingDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            queryId: 'RD-BAD', observationType: 'deep_book',
            decision: 'BOGUS', expectedIG: 0.5, costEstimate: 0.1,
            deadlineRemainingMs: 1000
        })).toThrow();
    });
});

describe('§99 recordSensingOutcome', () => {
    test('persists', () => {
        asp.recordSensingDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            queryId: 'RO-Q1', observationType: 'deep_book',
            decision: 'query_now', expectedIG: 0.5,
            costEstimate: 0.1, deadlineRemainingMs: 1000
        });
        const r = asp.recordSensingOutcome({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            outcomeId: 'RO-O1', queryId: 'RO-Q1',
            actualIG: 0.6, actualCost: 0.12,
            verdictChanged: true
        });
        expect(r.recorded).toBe(true);
    });

    test('coerces verdictChanged truthy', () => {
        asp.recordSensingDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            queryId: 'RO-Q2', observationType: 'deep_book',
            decision: 'query_now', expectedIG: 0.5,
            costEstimate: 0.1, deadlineRemainingMs: 1000
        });
        const r = asp.recordSensingOutcome({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            outcomeId: 'RO-O2', queryId: 'RO-Q2',
            actualIG: 0.4, actualCost: 0.1,
            verdictChanged: false
        });
        expect(r.recorded).toBe(true);
    });
});

describe('§99 getSensingStatistics', () => {
    test('aggregates per observation type', () => {
        asp.recordSensingDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            queryId: 'ST-Q1', observationType: 'deep_book',
            decision: 'query_now', expectedIG: 0.5,
            costEstimate: 0.1, deadlineRemainingMs: 1000
        });
        asp.recordSensingOutcome({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            outcomeId: 'ST-O1', queryId: 'ST-Q1',
            actualIG: 0.6, actualCost: 0.11,
            verdictChanged: true
        });
        const stats = asp.getSensingStatistics({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            observationType: 'deep_book'
        });
        expect(stats).toHaveLength(1);
        expect(stats[0].verdictChanges).toBe(1);
    });
});

describe('§99 isolation', () => {
    test('per (user × env) isolation', () => {
        asp.recordSensingDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            queryId: 'ISO-Q1', observationType: 'deep_book',
            decision: 'query_now', expectedIG: 0.5,
            costEstimate: 0.1, deadlineRemainingMs: 1000
        });
        const a = asp.getSensingStatistics({ userId: TEST_USER, resolvedEnv: TEST_ENV });
        const b = asp.getSensingStatistics({ userId: OTHER_USER, resolvedEnv: TEST_ENV });
        expect(a.length).toBeGreaterThan(0);
        expect(b).toHaveLength(0);
    });
});
