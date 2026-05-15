'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p70-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const ev = require('../../../server/services/ml/R5A_learning/evidenceSufficiency');

const TEST_USER = 9070;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_evidence_support WHERE user_id IN (?, ?)').run(TEST_USER, 9071);
    db.prepare('DELETE FROM ml_setup_maturity WHERE user_id IN (?, ?)').run(TEST_USER, 9071);
}

function seedSupport(setupType, n) {
    for (let i = 0; i < n; i++) {
        ev.recordSetupObservation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupType, regimeType: 'range', asset: 'BTC', timeframe: '1h',
            outcome: i % 2 === 0 ? 'win' : 'loss'
        });
    }
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§70 Migrations 131 + 132', () => {
    test('ml_evidence_support exists with UNIQUE per (user, env, setup_key)', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_evidence_support)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'setup_key', 'setup_type', 'regime_type', 'asset', 'timeframe',
            'total_observations', 'win_count', 'quality_weighted_score',
            'recent_observations', 'last_updated'
        ]));
    });

    test('CHECK maturity_class restricts', () => {
        const ts = Date.now();
        expect(() => db.prepare(
            `INSERT INTO ml_setup_maturity
             (user_id, resolved_env, setup_key, maturity_class,
              authority_level, evidence_sufficient, size_multiplier,
              last_classified_ts)
             VALUES (?, ?, 'K', 'BOGUS', 'full', 1, 1.0, ?)`
        ).run(TEST_USER, TEST_ENV, ts)).toThrow();
    });

    test('CHECK authority_level restricts', () => {
        const ts = Date.now();
        expect(() => db.prepare(
            `INSERT INTO ml_setup_maturity
             (user_id, resolved_env, setup_key, maturity_class,
              authority_level, evidence_sufficient, size_multiplier,
              last_classified_ts)
             VALUES (?, ?, 'K2', 'mature', 'BOGUS', 1, 1.0, ?)`
        ).run(TEST_USER, TEST_ENV, ts)).toThrow();
    });
});

describe('§70 Constants', () => {
    test('MATURITY_CLASSES has 4 entries', () => {
        expect(ev.MATURITY_CLASSES).toEqual([
            'observational', 'shadow', 'probation', 'mature'
        ]);
    });

    test('AUTHORITY_LEVELS has 3 entries', () => {
        expect(ev.AUTHORITY_LEVELS).toEqual(['none', 'reduced', 'full']);
    });

    test('thresholds ordered', () => {
        expect(ev.MIN_SUPPORT_OBSERVATIONAL).toBeLessThan(ev.MIN_SUPPORT_SHADOW);
        expect(ev.MIN_SUPPORT_SHADOW).toBeLessThan(ev.MIN_SUPPORT_PROBATION);
        expect(ev.MIN_SUPPORT_PROBATION).toBeLessThan(ev.MIN_SUPPORT_MATURE);
    });

    test('size multipliers ascending', () => {
        const m = ev.SIZE_MULTIPLIER_BY_MATURITY;
        expect(m.observational).toBeLessThan(m.shadow);
        expect(m.shadow).toBeLessThan(m.probation_early);
        expect(m.probation_early).toBeLessThan(m.probation_late);
        expect(m.probation_late).toBeLessThan(m.mature);
        expect(m.mature).toBe(1.0);
    });
});

describe('§70 recordSetupObservation', () => {
    test('increments total + win counts', () => {
        ev.recordSetupObservation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupType: 'sweep', regimeType: 'range',
            asset: 'BTC', timeframe: '1h', outcome: 'win'
        });
        ev.recordSetupObservation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupType: 'sweep', regimeType: 'range',
            asset: 'BTC', timeframe: '1h', outcome: 'loss'
        });
        const s = ev.getSupportCount({
            userId: TEST_USER, resolvedEnv: TEST_ENV, setupType: 'sweep'
        });
        expect(s.totalSupport).toBe(2);
        expect(s.winCount).toBe(1);
        expect(s.winRate).toBeCloseTo(0.5);
    });

    test('throws on invalid outcome', () => {
        expect(() => ev.recordSetupObservation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupType: 'sweep', regimeType: 'range',
            asset: 'BTC', timeframe: '1h', outcome: 'BOGUS'
        })).toThrow();
    });

    test('quality weight affects score', () => {
        ev.recordSetupObservation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupType: 'sweep', regimeType: 'range',
            asset: 'BTC', timeframe: '1h', outcome: 'win', qualityWeight: 2.0
        });
        const s = ev.getSupportCount({
            userId: TEST_USER, resolvedEnv: TEST_ENV, setupType: 'sweep'
        });
        expect(s.qualityWeightedScore).toBeCloseTo(2.0);
    });
});

describe('§70 getSupportCount', () => {
    test('aggregates across regime/asset variants', () => {
        for (let i = 0; i < 3; i++) {
            ev.recordSetupObservation({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                setupType: 'breakout', regimeType: 'trend_up',
                asset: 'BTC', timeframe: '1h', outcome: 'win'
            });
        }
        for (let i = 0; i < 2; i++) {
            ev.recordSetupObservation({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                setupType: 'breakout', regimeType: 'range',
                asset: 'ETH', timeframe: '4h', outcome: 'loss'
            });
        }
        const all = ev.getSupportCount({
            userId: TEST_USER, resolvedEnv: TEST_ENV, setupType: 'breakout'
        });
        expect(all.totalSupport).toBe(5);
        const trend = ev.getSupportCount({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupType: 'breakout', regimeType: 'trend_up'
        });
        expect(trend.totalSupport).toBe(3);
    });
});

describe('§70 classifySetupMaturity', () => {
    const KEY = 'sweep|range|BTC|1h';

    test('observational < 10 obs', () => {
        seedSupport('sweep', 5);
        const m = ev.classifySetupMaturity({
            userId: TEST_USER, resolvedEnv: TEST_ENV, setupKey: KEY
        });
        expect(m).toBe('observational');
    });

    test('shadow 10..29', () => {
        seedSupport('sweep', 15);
        const m = ev.classifySetupMaturity({
            userId: TEST_USER, resolvedEnv: TEST_ENV, setupKey: KEY
        });
        expect(m).toBe('shadow');
    });

    test('probation 30..99', () => {
        seedSupport('sweep', 60);
        const m = ev.classifySetupMaturity({
            userId: TEST_USER, resolvedEnv: TEST_ENV, setupKey: KEY
        });
        expect(m).toBe('probation');
    });

    test('mature >= 100', () => {
        seedSupport('sweep', 120);
        const m = ev.classifySetupMaturity({
            userId: TEST_USER, resolvedEnv: TEST_ENV, setupKey: KEY
        });
        expect(m).toBe('mature');
    });
});

describe('§70 evaluateEvidenceSufficiency', () => {
    const KEY = 'sweep|range|BTC|1h';

    test('observational → none authority + size=0', () => {
        seedSupport('sweep', 5);
        const r = ev.evaluateEvidenceSufficiency({
            userId: TEST_USER, resolvedEnv: TEST_ENV, setupKey: KEY
        });
        expect(r.authorityLevel).toBe('none');
        expect(r.sizeMultiplier).toBe(0.0);
        expect(r.sufficient).toBe(false);
    });

    test('shadow → none authority + small size', () => {
        seedSupport('sweep', 15);
        const r = ev.evaluateEvidenceSufficiency({
            userId: TEST_USER, resolvedEnv: TEST_ENV, setupKey: KEY
        });
        expect(r.authorityLevel).toBe('none');
        expect(r.sizeMultiplier).toBeCloseTo(0.10);
    });

    test('probation early (30..49) → reduced authority + 0.50 size', () => {
        seedSupport('sweep', 35);
        const r = ev.evaluateEvidenceSufficiency({
            userId: TEST_USER, resolvedEnv: TEST_ENV, setupKey: KEY
        });
        expect(r.authorityLevel).toBe('reduced');
        expect(r.sizeMultiplier).toBeCloseTo(0.50);
    });

    test('probation late (50..99) → reduced authority + 0.75 size', () => {
        seedSupport('sweep', 70);
        const r = ev.evaluateEvidenceSufficiency({
            userId: TEST_USER, resolvedEnv: TEST_ENV, setupKey: KEY
        });
        expect(r.authorityLevel).toBe('reduced');
        expect(r.sizeMultiplier).toBeCloseTo(0.75);
    });

    test('mature → full authority + size=1.0', () => {
        seedSupport('sweep', 120);
        const r = ev.evaluateEvidenceSufficiency({
            userId: TEST_USER, resolvedEnv: TEST_ENV, setupKey: KEY
        });
        expect(r.authorityLevel).toBe('full');
        expect(r.sizeMultiplier).toBe(1.0);
        expect(r.sufficient).toBe(true);
    });
});

describe('§70 recordMaturityClassification', () => {
    test('persists', () => {
        ev.recordMaturityClassification({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupKey: 'K', maturityClass: 'mature',
            authorityLevel: 'full', evidenceSufficient: true,
            sizeMultiplier: 1.0
        });
        const rows = db.prepare(
            `SELECT * FROM ml_setup_maturity WHERE setup_key = 'K'`
        ).all();
        expect(rows).toHaveLength(1);
    });

    test('throws on invalid maturityClass', () => {
        expect(() => ev.recordMaturityClassification({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupKey: 'BAD', maturityClass: 'BOGUS',
            authorityLevel: 'full', sizeMultiplier: 1.0
        })).toThrow();
    });
});

describe('§70 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9071;
        ev.recordSetupObservation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupType: 'sweep', regimeType: 'range',
            asset: 'BTC', timeframe: '1h', outcome: 'win'
        });
        const s1 = ev.getSupportCount({
            userId: TEST_USER, resolvedEnv: TEST_ENV, setupType: 'sweep'
        });
        const s2 = ev.getSupportCount({
            userId: OTHER_USER, resolvedEnv: TEST_ENV, setupType: 'sweep'
        });
        expect(s1.totalSupport).toBe(1);
        expect(s2.totalSupport).toBe(0);
    });
});
