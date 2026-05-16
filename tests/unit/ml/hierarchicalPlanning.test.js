'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p83-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const hp = require('../../../server/services/ml/R3A_safety/hierarchicalPlanning');

const TEST_USER = 9083;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_strategic_mandates WHERE user_id IN (?, ?)').run(TEST_USER, 9084);
    db.prepare('DELETE FROM ml_hierarchical_decisions WHERE user_id IN (?, ?)').run(TEST_USER, 9084);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§83 Migrations 155 + 156', () => {
    test('mandate_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_strategic_mandates
             (user_id, resolved_env, mandate_id, level, constraint_type,
              parameters_json, valid_from, valid_until, status, created_at)
             VALUES (?, ?, 'M-UNIQ', 'strategic', 'max_exposure', '{}', ?, ?, 'ACTIVE', ?)`
        ).run(TEST_USER, TEST_ENV, ts, ts + 86400000, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_strategic_mandates
             (user_id, resolved_env, mandate_id, level, constraint_type,
              parameters_json, valid_from, valid_until, status, created_at)
             VALUES (?, ?, 'M-UNIQ', 'tactical', 'asset_block', '{}', ?, ?, 'ACTIVE', ?)`
        ).run(TEST_USER, TEST_ENV, ts, ts + 86400000, ts)).toThrow();
    });

    test('CHECK level restricts', () => {
        const ts = Date.now();
        expect(() => db.prepare(
            `INSERT INTO ml_strategic_mandates
             (user_id, resolved_env, mandate_id, level, constraint_type,
              parameters_json, valid_from, valid_until, status, created_at)
             VALUES (?, ?, 'M-BAD', 'BOGUS', 'max_exposure', '{}', ?, ?, 'ACTIVE', ?)`
        ).run(TEST_USER, TEST_ENV, ts, ts + 86400000, ts)).toThrow();
    });

    test('CHECK decision restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_hierarchical_decisions
             (user_id, resolved_env, decision_id, level,
              candidate_action_json, mandates_checked_json, decision, ts)
             VALUES (?, ?, 'D-BAD', 'tactical', '{}', '[]', 'BOGUS', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§83 Constants', () => {
    test('LEVELS has 3 entries', () => {
        expect(hp.LEVELS).toEqual(['strategic', 'tactical', 'execution']);
    });

    test('LEVEL_HIERARCHY ordered', () => {
        expect(hp.LEVEL_HIERARCHY.strategic).toBeGreaterThan(hp.LEVEL_HIERARCHY.tactical);
        expect(hp.LEVEL_HIERARCHY.tactical).toBeGreaterThan(hp.LEVEL_HIERARCHY.execution);
    });

    test('CONSTRAINT_TYPES has 5 entries', () => {
        expect(hp.CONSTRAINT_TYPES).toHaveLength(5);
    });

    test('DECISIONS has 3 entries', () => {
        expect(hp.DECISIONS).toEqual([
            'APPROVED', 'REJECTED_BY_HIGHER_LEVEL', 'MODIFIED'
        ]);
    });
});

describe('§83 defineMandate', () => {
    test('persists', () => {
        const r = hp.defineMandate({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            mandateId: 'M-001', level: 'strategic',
            constraintType: 'max_exposure',
            parameters: { maxPct: 0.30 },
            validFrom: Date.now(),
            validUntil: Date.now() + 7 * 86400000
        });
        expect(r.defined).toBe(true);
    });

    test('throws on invalid level', () => {
        expect(() => hp.defineMandate({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            mandateId: 'M-BAD', level: 'BOGUS',
            constraintType: 'max_exposure', parameters: {},
            validUntil: Date.now() + 86400000
        })).toThrow();
    });

    test('throws on invalid constraint type', () => {
        expect(() => hp.defineMandate({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            mandateId: 'M-BAD2', level: 'strategic',
            constraintType: 'BOGUS', parameters: {},
            validUntil: Date.now() + 86400000
        })).toThrow();
    });

    test('throws if validUntil <= validFrom', () => {
        const t = Date.now();
        expect(() => hp.defineMandate({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            mandateId: 'M-BAD3', level: 'strategic',
            constraintType: 'max_exposure', parameters: {},
            validFrom: t, validUntil: t
        })).toThrow();
    });

    test('duplicate mandateId throws', () => {
        hp.defineMandate({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            mandateId: 'M-DUP', level: 'strategic',
            constraintType: 'max_exposure', parameters: {},
            validUntil: Date.now() + 86400000
        });
        expect(() => hp.defineMandate({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            mandateId: 'M-DUP', level: 'tactical',
            constraintType: 'asset_block', parameters: {},
            validUntil: Date.now() + 86400000
        })).toThrow();
    });
});

describe('§83 evaluateAgainstMandates', () => {
    beforeEach(() => {
        hp.defineMandate({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            mandateId: 'STRAT-NO-ALT', level: 'strategic',
            constraintType: 'asset_block',
            parameters: { assets: ['DOGE', 'SHIB'] },
            validUntil: Date.now() + 7 * 86400000
        });
        hp.defineMandate({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            mandateId: 'STRAT-MAX', level: 'strategic',
            constraintType: 'max_exposure',
            parameters: { maxPct: 0.30 },
            validUntil: Date.now() + 7 * 86400000
        });
    });

    test('tactical APPROVED when no violation', () => {
        const r = hp.evaluateAgainstMandates({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            level: 'tactical',
            candidateAction: { asset: 'BTC', proposedExposurePct: 0.20 }
        });
        expect(r.decision).toBe('APPROVED');
        expect(r.violations).toEqual([]);
    });

    test('tactical REJECTED when strategic asset_block violated', () => {
        const r = hp.evaluateAgainstMandates({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            level: 'tactical',
            candidateAction: { asset: 'DOGE', proposedExposurePct: 0.10 }
        });
        expect(r.decision).toBe('REJECTED_BY_HIGHER_LEVEL');
        expect(r.violations.length).toBeGreaterThan(0);
    });

    test('tactical REJECTED when strategic max_exposure violated', () => {
        const r = hp.evaluateAgainstMandates({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            level: 'tactical',
            candidateAction: { asset: 'BTC', proposedExposurePct: 0.40 }
        });
        expect(r.decision).toBe('REJECTED_BY_HIGHER_LEVEL');
    });

    test('strategic level not checked against itself', () => {
        const r = hp.evaluateAgainstMandates({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            level: 'strategic',
            candidateAction: { asset: 'DOGE' }
        });
        expect(r.decision).toBe('APPROVED');
    });

    test('execution checked against both strategic + tactical', () => {
        hp.defineMandate({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            mandateId: 'TAC-1', level: 'tactical',
            constraintType: 'direction_limit',
            parameters: { allowed: ['LONG'] },
            validUntil: Date.now() + 86400000
        });
        const r = hp.evaluateAgainstMandates({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            level: 'execution',
            candidateAction: { direction: 'SHORT', asset: 'BTC', proposedExposurePct: 0.20 }
        });
        expect(r.decision).toBe('REJECTED_BY_HIGHER_LEVEL');
    });
});

describe('§83 expireMandate', () => {
    test('marks EXPIRED', () => {
        hp.defineMandate({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            mandateId: 'M-EXP', level: 'strategic',
            constraintType: 'max_exposure',
            parameters: { maxPct: 0.10 },
            validUntil: Date.now() + 86400000
        });
        const r = hp.expireMandate({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            mandateId: 'M-EXP'
        });
        expect(r.expired).toBe(true);

        const active = hp.getActiveMandates({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(active.some(m => m.mandate_id === 'M-EXP')).toBe(false);
    });
});

describe('§83 recordHierarchicalDecision', () => {
    test('persists', () => {
        hp.recordHierarchicalDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'D-001', level: 'tactical',
            candidateAction: { asset: 'BTC' },
            mandatesChecked: ['STRAT-MAX'],
            decision: 'APPROVED',
            reasoning: 'no violations'
        });
        const h = hp.getDecisionHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(h).toHaveLength(1);
    });

    test('throws on invalid decision', () => {
        expect(() => hp.recordHierarchicalDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'D-BAD', level: 'tactical',
            candidateAction: {}, mandatesChecked: [],
            decision: 'BOGUS'
        })).toThrow();
    });
});

describe('§83 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9084;
        hp.defineMandate({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            mandateId: 'M-ISO', level: 'strategic',
            constraintType: 'max_exposure', parameters: {},
            validUntil: Date.now() + 86400000
        });
        const a1 = hp.getActiveMandates({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const a2 = hp.getActiveMandates({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(a1.length).toBe(1);
        expect(a2.length).toBe(0);
    });
});
