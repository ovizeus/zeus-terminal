'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p109-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const pr = require('../../../server/services/ml/R5A_learning/policyRegret');

const TEST_USER = 9109;
const OTHER_USER = 9110;
const TEST_ENV = 'DEMO';
const DAY_MS = 86400000;

function cleanRows() {
    db.prepare('DELETE FROM ml_oracle_decisions WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
    db.prepare('DELETE FROM ml_regret_components WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§109 Migrations 207 + 208', () => {
    test('oracle_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_oracle_decisions
             (user_id, resolved_env, oracle_id, decision_id,
              actual_action_json, optimal_feasible_action_json,
              total_regret, feasibility_constraints_json, ts)
             VALUES (?, ?, 'OD-UNIQ', 'D-1', '{}', '{}', 10, '{}', ?)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_oracle_decisions
             (user_id, resolved_env, oracle_id, decision_id,
              actual_action_json, optimal_feasible_action_json,
              total_regret, feasibility_constraints_json, ts)
             VALUES (?, ?, 'OD-UNIQ', 'D-2', '{}', '{}', 5, '{}', ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('CHECK total_regret >= 0', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_oracle_decisions
             (user_id, resolved_env, oracle_id, decision_id,
              actual_action_json, optimal_feasible_action_json,
              total_regret, feasibility_constraints_json, ts)
             VALUES (?, ?, 'OD-NEG', 'D', '{}', '{}', -1, '{}', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK regret_kind restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_regret_components
             (user_id, resolved_env, component_id, oracle_id,
              regret_kind, component_value, notes, ts)
             VALUES (?, ?, 'RC-BAD', 'O', 'BOGUS', 5, NULL, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§109 Constants', () => {
    test('REGRET_KINDS has 5 entries', () => {
        expect(pr.REGRET_KINDS).toEqual([
            'signal', 'timing', 'sizing', 'execution', 'abstention'
        ]);
    });

    test('DECOMPOSITION_TOLERANCE small positive', () => {
        expect(pr.DECOMPOSITION_TOLERANCE).toBeGreaterThan(0);
        expect(pr.DECOMPOSITION_TOLERANCE).toBeLessThan(0.1);
    });

    test('DEFAULT_LOOKBACK_DAYS positive', () => {
        expect(pr.DEFAULT_LOOKBACK_DAYS).toBeGreaterThan(0);
    });
});

describe('§109 computeRegretFromPnl (pure)', () => {
    test('actual < optimal → positive regret', () => {
        const r = pr.computeRegretFromPnl({
            actualPnl: 50, optimalPnl: 200
        });
        expect(r.regret).toBe(150);
    });

    test('actual == optimal → zero regret', () => {
        const r = pr.computeRegretFromPnl({
            actualPnl: 100, optimalPnl: 100
        });
        expect(r.regret).toBe(0);
    });

    test('actual > optimal (impossible feasibility but clamps non-negative)', () => {
        const r = pr.computeRegretFromPnl({
            actualPnl: 300, optimalPnl: 200
        });
        expect(r.regret).toBe(0);
    });
});

describe('§109 validateOracleFeasibility (pure)', () => {
    test('valid oracle action passes', () => {
        const r = pr.validateOracleFeasibility({
            oracleAction: {
                used_info_keys: ['price_t', 'orderbook_t'],
                latency_ms: 50, capital_used: 100,
                api_units: 2, venue: 'binance', exec_path: 'limit'
            },
            constraints: {
                info_available_keys: ['price_t', 'orderbook_t', 'volume_t'],
                latency_budget_ms: 200,
                capital_cap: 500,
                api_budget: 10,
                venues_available: ['binance', 'bybit'],
                exec_feasible_paths: ['limit', 'market']
            }
        });
        expect(r.feasible).toBe(true);
    });

    test('throws when oracle uses forbidden info', () => {
        expect(() => pr.validateOracleFeasibility({
            oracleAction: {
                used_info_keys: ['future_price_t_plus_1'],
                latency_ms: 50, capital_used: 100,
                api_units: 1, venue: 'binance', exec_path: 'limit'
            },
            constraints: {
                info_available_keys: ['price_t'],
                latency_budget_ms: 200, capital_cap: 500,
                api_budget: 10,
                venues_available: ['binance'],
                exec_feasible_paths: ['limit']
            }
        })).toThrow();
    });

    test('throws when oracle exceeds latency budget', () => {
        expect(() => pr.validateOracleFeasibility({
            oracleAction: {
                used_info_keys: ['price_t'], latency_ms: 500,
                capital_used: 100, api_units: 1,
                venue: 'binance', exec_path: 'limit'
            },
            constraints: {
                info_available_keys: ['price_t'],
                latency_budget_ms: 200, capital_cap: 500,
                api_budget: 10,
                venues_available: ['binance'],
                exec_feasible_paths: ['limit']
            }
        })).toThrow();
    });

    test('throws when oracle exceeds capital cap', () => {
        expect(() => pr.validateOracleFeasibility({
            oracleAction: {
                used_info_keys: ['price_t'], latency_ms: 50,
                capital_used: 1000, api_units: 1,
                venue: 'binance', exec_path: 'limit'
            },
            constraints: {
                info_available_keys: ['price_t'],
                latency_budget_ms: 200, capital_cap: 500,
                api_budget: 10,
                venues_available: ['binance'],
                exec_feasible_paths: ['limit']
            }
        })).toThrow();
    });

    test('throws when oracle uses unavailable venue', () => {
        expect(() => pr.validateOracleFeasibility({
            oracleAction: {
                used_info_keys: ['price_t'], latency_ms: 50,
                capital_used: 100, api_units: 1,
                venue: 'okx', exec_path: 'limit'
            },
            constraints: {
                info_available_keys: ['price_t'],
                latency_budget_ms: 200, capital_cap: 500,
                api_budget: 10,
                venues_available: ['binance'],
                exec_feasible_paths: ['limit']
            }
        })).toThrow();
    });
});

describe('§109 recordOracleDecision', () => {
    test('persists', () => {
        const r = pr.recordOracleDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            oracleId: 'RO-1', decisionId: 'D-1',
            actualAction: { side: 'NONE' },
            optimalFeasibleAction: { side: 'LONG', size: 1.0 },
            totalRegret: 100,
            feasibilityConstraints: { capital_cap: 500 }
        });
        expect(r.recorded).toBe(true);
    });

    test('duplicate oracleId throws', () => {
        pr.recordOracleDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            oracleId: 'RO-DUP', decisionId: 'D',
            actualAction: {}, optimalFeasibleAction: {},
            totalRegret: 0, feasibilityConstraints: {}
        });
        expect(() => pr.recordOracleDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            oracleId: 'RO-DUP', decisionId: 'D2',
            actualAction: {}, optimalFeasibleAction: {},
            totalRegret: 5, feasibilityConstraints: {}
        })).toThrow();
    });

    test('negative regret throws', () => {
        expect(() => pr.recordOracleDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            oracleId: 'RO-NEG', decisionId: 'D',
            actualAction: {}, optimalFeasibleAction: {},
            totalRegret: -1, feasibilityConstraints: {}
        })).toThrow();
    });
});

describe('§109 recordRegretComponent', () => {
    test('persists', () => {
        const r = pr.recordRegretComponent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            componentId: 'RC-1', oracleId: 'O-1',
            regretKind: 'sizing', componentValue: 25,
            notes: 'underweighted'
        });
        expect(r.recorded).toBe(true);
    });

    test('invalid regretKind throws', () => {
        expect(() => pr.recordRegretComponent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            componentId: 'RC-BAD', oracleId: 'O',
            regretKind: 'BOGUS', componentValue: 5
        })).toThrow();
    });

    test('negative value throws', () => {
        expect(() => pr.recordRegretComponent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            componentId: 'RC-NEG', oracleId: 'O',
            regretKind: 'signal', componentValue: -1
        })).toThrow();
    });
});

describe('§109 aggregateRegret', () => {
    function seedComponents(prefix, values) {
        for (const [kind, value] of Object.entries(values)) {
            pr.recordRegretComponent({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                componentId: `${prefix}-${kind}`, oracleId: `${prefix}-O`,
                regretKind: kind, componentValue: value
            });
        }
    }

    test('aggregates total + per-kind', () => {
        seedComponents('AG', {
            signal: 30, timing: 10, sizing: 20,
            execution: 5, abstention: 15
        });
        const r = pr.aggregateRegret({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.total).toBe(80);
        expect(r.byKind.signal).toBe(30);
        expect(r.byKind.timing).toBe(10);
        expect(r.byKind.sizing).toBe(20);
    });

    test('regretKindFilter restricts', () => {
        seedComponents('AG2', {
            signal: 30, timing: 10
        });
        const r = pr.aggregateRegret({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            regretKindFilter: 'signal'
        });
        expect(r.total).toBe(30);
    });

    test('lookback ignores old records', () => {
        const oldTs = Date.now() - 60 * DAY_MS;
        pr.recordRegretComponent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            componentId: 'AG-OLD', oracleId: 'O',
            regretKind: 'signal', componentValue: 999,
            ts: oldTs
        });
        const r = pr.aggregateRegret({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            lookbackDays: 30
        });
        expect(r.total).toBe(0);
    });
});

describe('§109 getRegretHistory', () => {
    test('returns DESC by ts', () => {
        pr.recordOracleDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            oracleId: 'GH-1', decisionId: 'D',
            actualAction: {}, optimalFeasibleAction: {},
            totalRegret: 10, feasibilityConstraints: {},
            ts: 1000
        });
        pr.recordOracleDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            oracleId: 'GH-2', decisionId: 'D',
            actualAction: {}, optimalFeasibleAction: {},
            totalRegret: 20, feasibilityConstraints: {},
            ts: 2000
        });
        const r = pr.getRegretHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r).toHaveLength(2);
        expect(r[0].oracleId).toBe('GH-2');
    });
});

describe('§109 isolation', () => {
    test('per (user × env) isolation', () => {
        pr.recordOracleDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            oracleId: 'ISO-1', decisionId: 'D',
            actualAction: {}, optimalFeasibleAction: {},
            totalRegret: 5, feasibilityConstraints: {}
        });
        const a = pr.getRegretHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const b = pr.getRegretHistory({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(a).toHaveLength(1);
        expect(b).toHaveLength(0);
    });
});
