'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p103-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const wl = require('../../../server/services/ml/_meta/wisdomLayer');

const TEST_USER = 9103;
const OTHER_USER = 9104;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_wisdom_heuristics WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
    db.prepare('DELETE FROM ml_wisdom_overrides WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§103 Migrations 195 + 196', () => {
    test('heuristic_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_wisdom_heuristics
             (user_id, resolved_env, heuristic_id, rule_text,
              kind, priority, is_active, ts)
             VALUES (?, ?, 'WH-UNIQ', 'rule', 'timing', 0, 1, ?)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_wisdom_heuristics
             (user_id, resolved_env, heuristic_id, rule_text,
              kind, priority, is_active, ts)
             VALUES (?, ?, 'WH-UNIQ', 'rule2', 'regime', 0, 1, ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('CHECK kind restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_wisdom_heuristics
             (user_id, resolved_env, heuristic_id, rule_text,
              kind, priority, is_active, ts)
             VALUES (?, ?, 'WH-BAD', 'rule', 'BOGUS', 0, 1, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK override_action restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_wisdom_overrides
             (user_id, resolved_env, override_id, heuristic_id,
              decision_context, complexity_score, signal_quality,
              ratio, override_action, ts)
             VALUES (?, ?, 'WO-BAD', NULL, 'ctx', 5, 0.5, 10, 'BOGUS', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§103 Constants', () => {
    test('HEURISTIC_KINDS has 4 entries', () => {
        expect(wl.HEURISTIC_KINDS).toEqual([
            'timing', 'regime', 'cognition', 'risk'
        ]);
    });

    test('OVERRIDE_ACTIONS has 3 entries', () => {
        expect(wl.OVERRIDE_ACTIONS).toEqual([
            'SIMPLIFY', 'ABSTAIN', 'PROCEED_NORMAL'
        ]);
    });

    test('thresholds ordered correctly', () => {
        expect(wl.ABSTAIN_QUALITY_FLOOR)
            .toBeLessThan(wl.DEFAULT_QUALITY_THRESHOLD);
    });
});

describe('§103 computeWisdomRatio (pure)', () => {
    test('high complexity + low quality → high ratio', () => {
        const r = wl.computeWisdomRatio({
            complexityScore: 10, signalQuality: 0.1
        });
        expect(r.ratio).toBeCloseTo(100);
    });

    test('zero quality → very high ratio via epsilon', () => {
        const r = wl.computeWisdomRatio({
            complexityScore: 5, signalQuality: 0
        });
        expect(r.ratio).toBeGreaterThan(1e5);
    });

    test('throws on out-of-range quality', () => {
        expect(() => wl.computeWisdomRatio({
            complexityScore: 5, signalQuality: 1.5
        })).toThrow();
    });
});

describe('§103 evaluateWisdomDecision (pure)', () => {
    test('ABSTAIN when quality below floor', () => {
        const r = wl.evaluateWisdomDecision({
            complexityScore: 5, signalQuality: 0.10
        });
        expect(r.action).toBe('ABSTAIN');
    });

    test('SIMPLIFY when ratio high + quality below threshold', () => {
        const r = wl.evaluateWisdomDecision({
            complexityScore: 5, signalQuality: 0.30
        });
        // ratio = 16.67 >= 2.0 AND quality 0.30 < 0.40
        expect(r.action).toBe('SIMPLIFY');
    });

    test('PROCEED_NORMAL when quality high', () => {
        const r = wl.evaluateWisdomDecision({
            complexityScore: 5, signalQuality: 0.80
        });
        expect(r.action).toBe('PROCEED_NORMAL');
    });

    test('PROCEED_NORMAL when ratio low even with marginal quality', () => {
        const r = wl.evaluateWisdomDecision({
            complexityScore: 0.5, signalQuality: 0.35
        });
        // ratio = 1.43 < 2.0 → PROCEED
        expect(r.action).toBe('PROCEED_NORMAL');
    });
});

describe('§103 registerHeuristic', () => {
    test('persists', () => {
        const r = wl.registerHeuristic({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            heuristicId: 'RH-1', ruleText: 'no_pre_fomc',
            kind: 'timing', priority: 100
        });
        expect(r.registered).toBe(true);
    });

    test('duplicate throws', () => {
        wl.registerHeuristic({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            heuristicId: 'RH-DUP', ruleText: 'r', kind: 'risk'
        });
        expect(() => wl.registerHeuristic({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            heuristicId: 'RH-DUP', ruleText: 'r2', kind: 'cognition'
        })).toThrow();
    });

    test('invalid kind throws', () => {
        expect(() => wl.registerHeuristic({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            heuristicId: 'RH-BAD', ruleText: 'r', kind: 'BOGUS'
        })).toThrow();
    });
});

describe('§103 recordWisdomOverride', () => {
    test('persists with computed ratio', () => {
        const r = wl.recordWisdomOverride({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            overrideId: 'RO-1',
            decisionContext: 'btc entry pre-FOMC',
            complexityScore: 8, signalQuality: 0.25,
            overrideAction: 'SIMPLIFY'
        });
        expect(r.recorded).toBe(true);
        expect(r.ratio).toBeCloseTo(32);
    });

    test('invalid action throws', () => {
        expect(() => wl.recordWisdomOverride({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            overrideId: 'RO-BAD',
            decisionContext: 'ctx',
            complexityScore: 1, signalQuality: 0.5,
            overrideAction: 'BOGUS'
        })).toThrow();
    });
});

describe('§103 getActiveHeuristics', () => {
    test('default returns all kinds, DESC priority', () => {
        wl.registerHeuristic({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            heuristicId: 'GA-LO', ruleText: 'r', kind: 'risk', priority: 1
        });
        wl.registerHeuristic({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            heuristicId: 'GA-HI', ruleText: 'r2', kind: 'timing', priority: 100
        });
        const r = wl.getActiveHeuristics({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r).toHaveLength(2);
        expect(r[0].heuristicId).toBe('GA-HI');
    });

    test('filter by kind', () => {
        wl.registerHeuristic({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            heuristicId: 'GA-T', ruleText: 'r', kind: 'timing'
        });
        wl.registerHeuristic({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            heuristicId: 'GA-R', ruleText: 'r', kind: 'risk'
        });
        const r = wl.getActiveHeuristics({
            userId: TEST_USER, resolvedEnv: TEST_ENV, kind: 'timing'
        });
        expect(r).toHaveLength(1);
        expect(r[0].heuristicId).toBe('GA-T');
    });

    test('retired excluded', () => {
        wl.registerHeuristic({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            heuristicId: 'GA-RET', ruleText: 'r', kind: 'risk'
        });
        wl.retireHeuristic({
            userId: TEST_USER, resolvedEnv: TEST_ENV, heuristicId: 'GA-RET'
        });
        const r = wl.getActiveHeuristics({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.find(h => h.heuristicId === 'GA-RET')).toBeUndefined();
    });
});

describe('§103 retireHeuristic', () => {
    test('marks inactive', () => {
        wl.registerHeuristic({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            heuristicId: 'RT-1', ruleText: 'r', kind: 'risk'
        });
        const r = wl.retireHeuristic({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            heuristicId: 'RT-1'
        });
        expect(r.retired).toBe(true);
    });

    test('unknown throws', () => {
        expect(() => wl.retireHeuristic({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            heuristicId: 'NOEXIST'
        })).toThrow();
    });
});

describe('§103 isolation', () => {
    test('per (user × env) isolation', () => {
        wl.registerHeuristic({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            heuristicId: 'ISO-1', ruleText: 'r', kind: 'risk'
        });
        const a = wl.getActiveHeuristics({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const b = wl.getActiveHeuristics({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(a).toHaveLength(1);
        expect(b).toHaveLength(0);
    });
});
