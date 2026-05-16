'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p120-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const ur = require('../../../server/services/ml/_meta/unknownsRegistry');

const TEST_USER = 9120;
const OTHER_USER = 9121;
const TEST_ENV = 'DEMO';
const DAY_MS = 86400000;

function cleanRows() {
    db.prepare('DELETE FROM ml_unknowns WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
    db.prepare('DELETE FROM ml_assumption_debt_audit WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

const FULL_IMPACTS = {
    impactSizing: 0.5, impactConfidence: 0.5,
    impactRegime: 0.5, impactExecution: 0.5,
    impactPortfolioRisk: 0.5
};

describe('§120 Migrations 229 + 230', () => {
    test('unknown_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_unknowns
             (user_id, resolved_env, unknown_id, kind, description,
              impact_sizing, impact_confidence, impact_regime,
              impact_execution, impact_portfolio_risk, debt_score,
              status, ts_registered, ts_resolved)
             VALUES (?, ?, 'U-UNIQ', 'known_unknown', 'd',
                     0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 'OPEN', ?, NULL)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_unknowns
             (user_id, resolved_env, unknown_id, kind, description,
              impact_sizing, impact_confidence, impact_regime,
              impact_execution, impact_portfolio_risk, debt_score,
              status, ts_registered, ts_resolved)
             VALUES (?, ?, 'U-UNIQ', 'fragile_assumption', 'd2',
                     0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 'OPEN', ?, NULL)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('CHECK kind restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_unknowns
             (user_id, resolved_env, unknown_id, kind, description,
              impact_sizing, impact_confidence, impact_regime,
              impact_execution, impact_portfolio_risk, debt_score,
              status, ts_registered, ts_resolved)
             VALUES (?, ?, 'U-BAD', 'BOGUS', 'd',
                     0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 'OPEN', ?, NULL)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK action restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_assumption_debt_audit
             (user_id, resolved_env, audit_id, unknown_id,
              action_taken, reason, ts)
             VALUES (?, ?, 'A-BAD', 'U', 'BOGUS', 'r', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§120 Constants', () => {
    test('UNKNOWN_KINDS has 5 entries', () => {
        expect(ur.UNKNOWN_KINDS).toEqual([
            'unknown_known', 'known_unknown',
            'unresolved_ambiguity', 'fragile_assumption',
            'temporary_operational'
        ]);
    });

    test('DEBT_ACTIONS has 5 entries', () => {
        expect(ur.DEBT_ACTIONS).toEqual([
            'size_reduce', 'wait', 'active_sensing',
            'observer', 'resolve'
        ]);
    });

    test('STATUSES has 3 entries', () => {
        expect(ur.STATUSES).toEqual(['OPEN', 'RESOLVED', 'ACCEPTED']);
    });

    test('CRITICAL_DEBT_THRESHOLD in (0,1)', () => {
        expect(ur.CRITICAL_DEBT_THRESHOLD).toBeGreaterThan(0);
        expect(ur.CRITICAL_DEBT_THRESHOLD).toBeLessThan(1);
    });
});

describe('§120 computeAssumptionDebt (pure)', () => {
    test('debt = avg of 5 impacts', () => {
        const r = ur.computeAssumptionDebt({
            impactSizing: 0.8, impactConfidence: 0.6,
            impactRegime: 0.4, impactExecution: 0.2,
            impactPortfolioRisk: 0.0
        });
        // avg = (0.8+0.6+0.4+0.2+0.0)/5 = 0.4
        expect(r.debtScore).toBeCloseTo(0.4);
    });

    test('all zeros → 0', () => {
        const r = ur.computeAssumptionDebt({
            impactSizing: 0, impactConfidence: 0, impactRegime: 0,
            impactExecution: 0, impactPortfolioRisk: 0
        });
        expect(r.debtScore).toBe(0);
    });

    test('all ones → 1', () => {
        const r = ur.computeAssumptionDebt({
            impactSizing: 1, impactConfidence: 1, impactRegime: 1,
            impactExecution: 1, impactPortfolioRisk: 1
        });
        expect(r.debtScore).toBe(1);
    });
});

describe('§120 registerUnknown', () => {
    test('persists with auto debt_score', () => {
        const r = ur.registerUnknown({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            unknownId: 'RU-1', kind: 'known_unknown',
            description: 'crypto regulation Q3 impact',
            ...FULL_IMPACTS
        });
        expect(r.registered).toBe(true);
        expect(r.debtScore).toBeCloseTo(0.5);
    });

    test('duplicate throws', () => {
        ur.registerUnknown({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            unknownId: 'RU-DUP', kind: 'fragile_assumption',
            description: 'd', ...FULL_IMPACTS
        });
        expect(() => ur.registerUnknown({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            unknownId: 'RU-DUP', kind: 'known_unknown',
            description: 'd2', ...FULL_IMPACTS
        })).toThrow();
    });

    test('invalid kind throws', () => {
        expect(() => ur.registerUnknown({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            unknownId: 'RU-BAD', kind: 'BOGUS',
            description: 'd', ...FULL_IMPACTS
        })).toThrow();
    });

    test('out-of-range impact throws', () => {
        expect(() => ur.registerUnknown({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            unknownId: 'RU-OOR', kind: 'known_unknown',
            description: 'd',
            impactSizing: 1.5, impactConfidence: 0.5,
            impactRegime: 0.5, impactExecution: 0.5,
            impactPortfolioRisk: 0.5
        })).toThrow();
    });
});

describe('§120 escalateOldOrCritical', () => {
    test('returns critical unknowns (debt >= threshold)', () => {
        ur.registerUnknown({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            unknownId: 'E-CRIT', kind: 'known_unknown',
            description: 'd',
            impactSizing: 0.9, impactConfidence: 0.9,
            impactRegime: 0.9, impactExecution: 0.9,
            impactPortfolioRisk: 0.9
        });
        ur.registerUnknown({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            unknownId: 'E-LOW', kind: 'temporary_operational',
            description: 'd',
            impactSizing: 0.1, impactConfidence: 0.1,
            impactRegime: 0.1, impactExecution: 0.1,
            impactPortfolioRisk: 0.1
        });
        const r = ur.escalateOldOrCritical({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.find(u => u.unknownId === 'E-CRIT')).toBeTruthy();
        expect(r.find(u => u.unknownId === 'E-LOW')).toBeUndefined();
    });

    test('returns stale unknowns (age >= threshold)', () => {
        const oldTs = Date.now() - 30 * DAY_MS;
        ur.registerUnknown({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            unknownId: 'E-STALE', kind: 'known_unknown',
            description: 'd',
            impactSizing: 0.1, impactConfidence: 0.1,
            impactRegime: 0.1, impactExecution: 0.1,
            impactPortfolioRisk: 0.1,
            ts: oldTs
        });
        const r = ur.escalateOldOrCritical({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.find(u => u.unknownId === 'E-STALE')).toBeTruthy();
    });
});

describe('§120 recordDebtAction', () => {
    test('persists', () => {
        const r = ur.recordDebtAction({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            auditId: 'AD-1', unknownId: 'U-1',
            action: 'size_reduce', reason: 'high_assumption_debt'
        });
        expect(r.recorded).toBe(true);
    });

    test('invalid action throws', () => {
        expect(() => ur.recordDebtAction({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            auditId: 'AD-BAD', unknownId: 'U',
            action: 'BOGUS', reason: 'r'
        })).toThrow();
    });
});

describe('§120 resolveUnknown', () => {
    test('marks RESOLVED', () => {
        ur.registerUnknown({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            unknownId: 'RV-1', kind: 'temporary_operational',
            description: 'd', ...FULL_IMPACTS
        });
        const r = ur.resolveUnknown({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            unknownId: 'RV-1', resolution: 'data_now_available'
        });
        expect(r.resolved).toBe(true);
    });

    test('unknown id throws', () => {
        expect(() => ur.resolveUnknown({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            unknownId: 'NOEXIST', resolution: 'r'
        })).toThrow();
    });
});

describe('§120 getActiveUnknowns', () => {
    test('filter by kind', () => {
        ur.registerUnknown({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            unknownId: 'GA-K1', kind: 'known_unknown',
            description: 'd', ...FULL_IMPACTS
        });
        ur.registerUnknown({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            unknownId: 'GA-K2', kind: 'fragile_assumption',
            description: 'd', ...FULL_IMPACTS
        });
        const r = ur.getActiveUnknowns({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            kindFilter: 'known_unknown'
        });
        expect(r).toHaveLength(1);
        expect(r[0].unknownId).toBe('GA-K1');
    });

    test('excludes RESOLVED', () => {
        ur.registerUnknown({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            unknownId: 'GA-RES', kind: 'known_unknown',
            description: 'd', ...FULL_IMPACTS
        });
        ur.resolveUnknown({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            unknownId: 'GA-RES', resolution: 'r'
        });
        const r = ur.getActiveUnknowns({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.find(u => u.unknownId === 'GA-RES')).toBeUndefined();
    });
});

describe('§120 isolation', () => {
    test('per (user × env) isolation', () => {
        ur.registerUnknown({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            unknownId: 'ISO-1', kind: 'known_unknown',
            description: 'd', ...FULL_IMPACTS
        });
        const a = ur.getActiveUnknowns({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const b = ur.getActiveUnknowns({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(a).toHaveLength(1);
        expect(b).toHaveLength(0);
    });
});
