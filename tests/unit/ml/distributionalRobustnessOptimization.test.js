'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p81-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const dro = require('../../../server/services/ml/R5A_learning/distributionalRobustnessOptimization');

const TEST_USER = 9081;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_dro_uncertainty_sets WHERE user_id IN (?, ?)').run(TEST_USER, 9082);
    db.prepare('DELETE FROM ml_dro_optimizations WHERE user_id IN (?, ?)').run(TEST_USER, 9082);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§81 Migrations 151 + 152', () => {
    test('ml_dro_uncertainty_sets exists', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_dro_uncertainty_sets)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'set_id', 'set_name', 'distribution_configs_json',
            'num_distributions', 'last_updated'
        ]));
    });

    test('set_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_dro_uncertainty_sets
             (user_id, resolved_env, set_id, set_name,
              distribution_configs_json, num_distributions, last_updated)
             VALUES (?, ?, 'S-UNIQ', 'test', '[]', 3, ?)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_dro_uncertainty_sets
             (user_id, resolved_env, set_id, set_name,
              distribution_configs_json, num_distributions, last_updated)
             VALUES (?, ?, 'S-UNIQ', 'test2', '[]', 3, ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('optimization_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_dro_optimizations
             (user_id, resolved_env, optimization_id, set_id,
              candidate_params_json, worst_case_score, average_score,
              robustness_premium, recommended_params_json, ts)
             VALUES (?, ?, 'O-UNIQ', 'S', '[]', 0.5, 0.7, 0.2, '{}', ?)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_dro_optimizations
             (user_id, resolved_env, optimization_id, set_id,
              candidate_params_json, worst_case_score, average_score,
              robustness_premium, recommended_params_json, ts)
             VALUES (?, ?, 'O-UNIQ', 'S', '[]', 0.5, 0.7, 0.2, '{}', ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });
});

describe('§81 Constants', () => {
    test('MIN_DISTRIBUTIONS_FOR_DRO >= 3', () => {
        expect(dro.MIN_DISTRIBUTIONS_FOR_DRO).toBeGreaterThanOrEqual(3);
    });

    test('ROBUSTNESS_PREMIUM_HIGH_THRESHOLD in (0,1)', () => {
        expect(dro.ROBUSTNESS_PREMIUM_HIGH_THRESHOLD).toBeGreaterThan(0);
        expect(dro.ROBUSTNESS_PREMIUM_HIGH_THRESHOLD).toBeLessThan(1);
    });
});

describe('§81 defineUncertaintySet', () => {
    test('persists set', () => {
        const r = dro.defineUncertaintySet({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setId: 'SET-001', setName: 'Test Set',
            distributionConfigs: [
                { regime: 'bull' }, { regime: 'bear' }, { regime: 'range' }
            ]
        });
        expect(r.defined).toBe(true);
        expect(r.numDistributions).toBe(3);
    });

    test('throws on insufficient distributions', () => {
        expect(() => dro.defineUncertaintySet({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setId: 'SET-INSUF', setName: 'Tiny',
            distributionConfigs: [{ regime: 'bull' }]
        })).toThrow(/distributions/i);
    });

    test('throws on duplicate set_id', () => {
        dro.defineUncertaintySet({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setId: 'SET-DUP', setName: 'first',
            distributionConfigs: [
                { regime: 'a' }, { regime: 'b' }, { regime: 'c' }
            ]
        });
        expect(() => dro.defineUncertaintySet({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setId: 'SET-DUP', setName: 'dup',
            distributionConfigs: [
                { regime: 'a' }, { regime: 'b' }, { regime: 'c' }
            ]
        })).toThrow(/duplicate/i);
    });
});

describe('§81 evaluateCandidateAcrossSet', () => {
    beforeEach(() => {
        dro.defineUncertaintySet({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setId: 'SET-EVAL', setName: 'eval',
            distributionConfigs: [
                { multiplier: 1.0 }, { multiplier: 0.5 }, { multiplier: 2.0 }
            ]
        });
    });

    test('computes worst-case and average across set', () => {
        const r = dro.evaluateCandidateAcrossSet({
            setId: 'SET-EVAL',
            candidateParams: { baseScore: 10 },
            performanceFn: (params, dist) => params.baseScore * dist.multiplier
        });
        expect(r.worstCaseScore).toBe(5);   // 10 × 0.5
        expect(r.averageScore).toBeCloseTo((10 + 5 + 20) / 3);
        expect(r.scoresPerDistribution).toHaveLength(3);
    });

    test('throws on unknown setId', () => {
        expect(() => dro.evaluateCandidateAcrossSet({
            setId: 'NONEXISTENT',
            candidateParams: {},
            performanceFn: () => 0
        })).toThrow(/not found/i);
    });
});

describe('§81 computeRobustnessPremium (pure)', () => {
    test('zero premium when worst = average', () => {
        const r = dro.computeRobustnessPremium({
            worstCaseScore: 10, averageScore: 10
        });
        expect(r.robustnessPremium).toBe(0);
    });

    test('high premium when worst << average', () => {
        const r = dro.computeRobustnessPremium({
            worstCaseScore: 5, averageScore: 10
        });
        expect(r.robustnessPremium).toBeCloseTo(0.5);
        expect(r.classification).toBe('high');
    });

    test('na when average is 0', () => {
        const r = dro.computeRobustnessPremium({
            worstCaseScore: 0, averageScore: 0
        });
        expect(r.classification).toBe('na');
    });
});

describe('§81 runDROOptimization', () => {
    beforeEach(() => {
        dro.defineUncertaintySet({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setId: 'SET-OPT', setName: 'opt',
            distributionConfigs: [
                { mult: 1.0 }, { mult: 0.3 }, { mult: 2.0 }
            ]
        });
    });

    test('picks candidate with HIGHEST worst-case (not highest average)', () => {
        // Candidate A: linear with mult — average=high, worst=low
        // Candidate B: constant — average=mid, worst=mid (higher than A's worst)
        const candidates = [
            { name: 'A', baseScore: 10 },           // worst=3, avg=11
            { name: 'B', baseScore: 5, flat: true }  // const=5
        ];
        const perfFn = (params, dist) => {
            if (params.flat) return params.baseScore;
            return params.baseScore * dist.mult;
        };
        const r = dro.runDROOptimization({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            optimizationId: 'OPT-001',
            setId: 'SET-OPT',
            candidateParamsList: candidates,
            performanceFn: perfFn
        });
        expect(r.recommendedParams.name).toBe('B');
        expect(r.worstCaseScore).toBe(5);
    });

    test('persists optimization', () => {
        const candidates = [{ x: 1 }, { x: 2 }];
        dro.runDROOptimization({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            optimizationId: 'OPT-PERSIST',
            setId: 'SET-OPT',
            candidateParamsList: candidates,
            performanceFn: (p, d) => p.x * d.mult
        });
        const o = dro.getOptimization({ optimizationId: 'OPT-PERSIST' });
        expect(o).toBeTruthy();
    });

    test('throws on empty candidate list', () => {
        expect(() => dro.runDROOptimization({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            optimizationId: 'OPT-EMPTY',
            setId: 'SET-OPT',
            candidateParamsList: [],
            performanceFn: () => 0
        })).toThrow();
    });

    test('duplicate optimization_id throws', () => {
        dro.runDROOptimization({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            optimizationId: 'OPT-DUP',
            setId: 'SET-OPT',
            candidateParamsList: [{ x: 1 }],
            performanceFn: (p, d) => p.x * d.mult
        });
        expect(() => dro.runDROOptimization({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            optimizationId: 'OPT-DUP',
            setId: 'SET-OPT',
            candidateParamsList: [{ x: 2 }],
            performanceFn: (p, d) => p.x * d.mult
        })).toThrow(/duplicate/i);
    });
});

describe('§81 getDROHistory', () => {
    test('returns optimizations', () => {
        dro.defineUncertaintySet({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setId: 'SET-H', setName: 'h',
            distributionConfigs: [{ a: 1 }, { a: 2 }, { a: 3 }]
        });
        dro.runDROOptimization({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            optimizationId: 'OPT-H1',
            setId: 'SET-H',
            candidateParamsList: [{ p: 1 }],
            performanceFn: (p, d) => p.p * d.a
        });
        const h = dro.getDROHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(h.length).toBeGreaterThan(0);
    });
});

describe('§81 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9082;
        dro.defineUncertaintySet({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setId: 'SET-ISO', setName: 'iso',
            distributionConfigs: [{ a: 1 }, { a: 2 }, { a: 3 }]
        });
        dro.runDROOptimization({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            optimizationId: 'OPT-ISO',
            setId: 'SET-ISO',
            candidateParamsList: [{ p: 1 }],
            performanceFn: (p, d) => p.p * d.a
        });
        const h1 = dro.getDROHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const h2 = dro.getDROHistory({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(h1.length).toBe(1);
        expect(h2.length).toBe(0);
    });
});
