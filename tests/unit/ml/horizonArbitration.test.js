'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p77-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const ha = require('../../../server/services/ml/R3A_safety/horizonArbitration');

const TEST_USER = 9077;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_horizon_ownership WHERE user_id IN (?, ?)').run(TEST_USER, 9078);
    db.prepare('DELETE FROM ml_horizon_conflicts WHERE user_id IN (?, ?)').run(TEST_USER, 9078);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§77 Migrations 144 + 145', () => {
    test('ml_horizon_ownership UNIQUE per (user, env, position)', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_horizon_ownership
             (user_id, resolved_env, position_id, thesis_horizon,
              owner_timeframe, assigned_at)
             VALUES (?, ?, 'P-UNIQ', 'swing', 'HTF', ?)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_horizon_ownership
             (user_id, resolved_env, position_id, thesis_horizon,
              owner_timeframe, assigned_at)
             VALUES (?, ?, 'P-UNIQ', 'swing', 'HTF', ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('CHECK thesis_horizon restricts', () => {
        const ts = Date.now();
        expect(() => db.prepare(
            `INSERT INTO ml_horizon_ownership
             (user_id, resolved_env, position_id, thesis_horizon,
              owner_timeframe, assigned_at)
             VALUES (?, ?, 'P-BAD', 'BOGUS', 'HTF', ?)`
        ).run(TEST_USER, TEST_ENV, ts)).toThrow();
    });

    test('CHECK action_recommended restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_horizon_conflicts
             (user_id, resolved_env, position_id, signal_timeframe,
              signal_strength, conflict_score, action_recommended, ts)
             VALUES (?, ?, 'P', 'HTF', 0.5, 0.5, 'BOGUS', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§77 Constants', () => {
    test('THESIS_HORIZONS has 4 entries', () => {
        expect(ha.THESIS_HORIZONS).toEqual([
            'scalp', 'intraday', 'swing', 'macro_defensive'
        ]);
    });

    test('OWNER_TIMEFRAMES has 4 entries', () => {
        expect(ha.OWNER_TIMEFRAMES).toEqual(['HTF', 'MTF', 'LTF', 'micro']);
    });

    test('SIGNAL_IMPACTS has 3 entries', () => {
        expect(ha.SIGNAL_IMPACTS).toEqual(['invalidates', 'noise', 'hedge_or_reduce']);
    });

    test('RECOMMENDED_ACTIONS has 4 entries', () => {
        expect(ha.RECOMMENDED_ACTIONS).toEqual(['ignore', 'hedge', 'reduce', 'exit']);
    });

    test('HORIZON_HIERARCHY ordered', () => {
        expect(ha.HORIZON_HIERARCHY.macro_defensive).toBeGreaterThan(
            ha.HORIZON_HIERARCHY.swing
        );
        expect(ha.HORIZON_HIERARCHY.swing).toBeGreaterThan(
            ha.HORIZON_HIERARCHY.intraday
        );
        expect(ha.HORIZON_HIERARCHY.intraday).toBeGreaterThan(
            ha.HORIZON_HIERARCHY.scalp
        );
    });
});

describe('§77 assignHorizonOwner', () => {
    test('persists ownership', () => {
        ha.assignHorizonOwner({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            positionId: 'P-001',
            thesisHorizon: 'swing', ownerTimeframe: 'HTF'
        });
        const o = ha.getOwnership({
            userId: TEST_USER, resolvedEnv: TEST_ENV, positionId: 'P-001'
        });
        expect(o.exists).toBe(true);
        expect(o.thesisHorizon).toBe('swing');
    });

    test('duplicate position throws', () => {
        ha.assignHorizonOwner({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            positionId: 'P-DUP',
            thesisHorizon: 'scalp', ownerTimeframe: 'LTF'
        });
        expect(() => ha.assignHorizonOwner({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            positionId: 'P-DUP',
            thesisHorizon: 'scalp', ownerTimeframe: 'LTF'
        })).toThrow();
    });

    test('invalid horizon throws', () => {
        expect(() => ha.assignHorizonOwner({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            positionId: 'P-BAD',
            thesisHorizon: 'BOGUS', ownerTimeframe: 'HTF'
        })).toThrow();
    });
});

describe('§77 classifySignalImpact (pure)', () => {
    test('HTF signal vs HTF position + strong = invalidates', () => {
        const r = ha.classifySignalImpact({
            signalStrength: 0.85,
            ownerTimeframe: 'HTF', signalTimeframe: 'HTF'
        });
        expect(r).toBe('invalidates');
    });

    test('HTF signal vs LTF position + moderate = invalidates (HTF veto)', () => {
        const r = ha.classifySignalImpact({
            signalStrength: 0.70,
            ownerTimeframe: 'LTF', signalTimeframe: 'HTF'
        });
        expect(r).toBe('invalidates');
    });

    test('LTF signal vs HTF position = noise (weak LTF)', () => {
        const r = ha.classifySignalImpact({
            signalStrength: 0.50,
            ownerTimeframe: 'HTF', signalTimeframe: 'LTF'
        });
        expect(r).toBe('noise');
    });

    test('strong LTF signal vs HTF position = hedge_or_reduce', () => {
        const r = ha.classifySignalImpact({
            signalStrength: 0.90,
            ownerTimeframe: 'HTF', signalTimeframe: 'LTF'
        });
        expect(r).toBe('hedge_or_reduce');
    });

    test('microstructure NEVER invalidates', () => {
        const r = ha.classifySignalImpact({
            signalStrength: 1.0,
            ownerTimeframe: 'HTF', signalTimeframe: 'micro'
        });
        expect(r).not.toBe('invalidates');
        expect(['noise', 'hedge_or_reduce']).toContain(r);
    });

    test('throws on invalid timeframe', () => {
        expect(() => ha.classifySignalImpact({
            signalStrength: 0.5,
            ownerTimeframe: 'BOGUS', signalTimeframe: 'HTF'
        })).toThrow();
    });
});

describe('§77 evaluateSignalConflict', () => {
    test('HTF invalidates LTF position → exit recommended', () => {
        ha.assignHorizonOwner({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            positionId: 'P-LTF',
            thesisHorizon: 'scalp', ownerTimeframe: 'LTF'
        });
        const r = ha.evaluateSignalConflict({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            positionId: 'P-LTF',
            signalTimeframe: 'HTF', signalStrength: 0.80
        });
        expect(r.actionRecommended).toBe('exit');
        expect(r.allowed).toBe(false);
    });

    test('LTF noise on HTF position → ignore', () => {
        ha.assignHorizonOwner({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            positionId: 'P-HTF',
            thesisHorizon: 'swing', ownerTimeframe: 'HTF'
        });
        const r = ha.evaluateSignalConflict({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            positionId: 'P-HTF',
            signalTimeframe: 'LTF', signalStrength: 0.40
        });
        expect(r.actionRecommended).toBe('ignore');
    });

    test('strong LTF on HTF position → hedge', () => {
        ha.assignHorizonOwner({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            positionId: 'P-STRONG',
            thesisHorizon: 'swing', ownerTimeframe: 'HTF'
        });
        const r = ha.evaluateSignalConflict({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            positionId: 'P-STRONG',
            signalTimeframe: 'LTF', signalStrength: 0.90
        });
        expect(['hedge', 'reduce']).toContain(r.actionRecommended);
    });

    test('no ownership → ignore', () => {
        const r = ha.evaluateSignalConflict({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            positionId: 'NONEXISTENT',
            signalTimeframe: 'HTF', signalStrength: 0.9
        });
        expect(r.actionRecommended).toBe('ignore');
    });
});

describe('§77 recordConflict', () => {
    test('persists', () => {
        ha.recordConflict({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            positionId: 'P-RC',
            signalTimeframe: 'HTF', signalStrength: 0.8,
            conflictScore: 0.75,
            actionRecommended: 'exit',
            resolutionReasoning: 'HTF veto'
        });
        const h = ha.getConflictHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(h).toHaveLength(1);
    });

    test('throws on invalid action', () => {
        expect(() => ha.recordConflict({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            positionId: 'P-BAD',
            signalTimeframe: 'HTF', signalStrength: 0.5,
            conflictScore: 0.5,
            actionRecommended: 'BOGUS'
        })).toThrow();
    });
});

describe('§77 retireOwnership', () => {
    test('marks RETIRED', () => {
        ha.assignHorizonOwner({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            positionId: 'P-RET',
            thesisHorizon: 'intraday', ownerTimeframe: 'MTF'
        });
        const r = ha.retireOwnership({
            userId: TEST_USER, resolvedEnv: TEST_ENV, positionId: 'P-RET'
        });
        expect(r.retired).toBe(true);
        const o = ha.getOwnership({
            userId: TEST_USER, resolvedEnv: TEST_ENV, positionId: 'P-RET'
        });
        expect(o.status).toBe('RETIRED');
    });
});

describe('§77 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9078;
        ha.assignHorizonOwner({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            positionId: 'P-ISO',
            thesisHorizon: 'swing', ownerTimeframe: 'HTF'
        });
        const o1 = ha.getOwnership({
            userId: TEST_USER, resolvedEnv: TEST_ENV, positionId: 'P-ISO'
        });
        const o2 = ha.getOwnership({
            userId: OTHER_USER, resolvedEnv: TEST_ENV, positionId: 'P-ISO'
        });
        expect(o1.exists).toBe(true);
        expect(o2.exists).toBe(false);
    });
});
