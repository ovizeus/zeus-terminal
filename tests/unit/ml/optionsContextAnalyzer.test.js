'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p32-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const oca = require('../../../server/services/ml/R2_cognition/optionsContextAnalyzer');

const TEST_USER = 9032;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_options_observations WHERE user_id = ?').run(TEST_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§32 Migration 071_ml_options_observations', () => {
    test('table ml_options_observations exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_options_observations'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_options_observations)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'observation_type',
            'payload_json', 'symbol', 'created_at'
        ]));
    });

    test('CHECK observation_type restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_options_observations
             (user_id, resolved_env, observation_type, payload_json, created_at)
             VALUES (?, ?, 'BOGUS', '{}', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§32 Exported constants', () => {
    test('OPTIONS_SIGNAL_TYPES has spec entries', () => {
        expect(oca.OPTIONS_SIGNAL_TYPES).toEqual(expect.arrayContaining([
            'gex_profile', 'gamma_pin', 'gamma_squeeze',
            'max_pain', 'expiration_proximity'
        ]));
    });

    test('EXPIRY_PERIODS has weekly + monthly', () => {
        expect(oca.EXPIRY_PERIODS).toEqual(expect.arrayContaining([
            'weekly', 'monthly'
        ]));
    });

    test('INVARIANT_MAX_BIAS_MODIFIER capped low (line 1321)', () => {
        expect(oca.INVARIANT_MAX_BIAS_MODIFIER).toBeGreaterThan(0);
        expect(oca.INVARIANT_MAX_BIAS_MODIFIER).toBeLessThanOrEqual(0.2);
    });
});

describe('§32 analyzeGex (pure)', () => {
    test('positive GEX → MM hedge stabilizes (negative gamma regime)', () => {
        const r = oca.analyzeGex({
            optionsData: {
                strikes: [50000, 51000, 52000],
                gammaExposureByStrike: {
                    50000: 1000000,
                    51000: 2000000,
                    52000: -500000
                }
            }
        });
        expect(r.netGex).toBeCloseTo(2500000);
        expect(r.regime).toBe('LONG_GAMMA');
    });

    test('negative GEX → volatility amplified (short gamma)', () => {
        const r = oca.analyzeGex({
            optionsData: {
                strikes: [49000, 50000],
                gammaExposureByStrike: {
                    49000: -3000000,
                    50000: -2000000
                }
            }
        });
        expect(r.netGex).toBeLessThan(0);
        expect(r.regime).toBe('SHORT_GAMMA');
    });

    test('empty options data returns neutral', () => {
        const r = oca.analyzeGex({ optionsData: {} });
        expect(r.netGex).toBe(0);
        expect(r.regime).toBe('NEUTRAL');
    });
});

describe('§32 findGammaPin (pure)', () => {
    test('finds nearest high-gamma strike as pin level', () => {
        const r = oca.findGammaPin({
            optionsData: {
                gammaExposureByStrike: {
                    49000: 1000000,
                    50000: 5000000,   // largest, pin
                    51000: 800000
                }
            },
            currentPrice: 49800
        });
        expect(r.pinLevel).toBe(50000);
        expect(r.pinStrength).toBeGreaterThan(0);
    });

    test('returns null when no significant gamma', () => {
        const r = oca.findGammaPin({
            optionsData: { gammaExposureByStrike: {} },
            currentPrice: 50000
        });
        expect(r.pinLevel).toBeNull();
    });

    test('attraction reflects distance from price', () => {
        const r1 = oca.findGammaPin({
            optionsData: { gammaExposureByStrike: { 50000: 5000000 } },
            currentPrice: 49900  // near pin
        });
        const r2 = oca.findGammaPin({
            optionsData: { gammaExposureByStrike: { 50000: 5000000 } },
            currentPrice: 47000  // far from pin
        });
        expect(r1.attraction).toBeGreaterThan(r2.attraction);
    });
});

describe('§32 assessGammaSqueezeRisk (pure)', () => {
    test('short gamma + high volatility + concentrated OI → high squeeze risk', () => {
        const r = oca.assessGammaSqueezeRisk({
            optionsData: {
                gammaExposureByStrike: {
                    50000: -5000000,
                    51000: -4000000
                }
            },
            openInterest: 10000000,
            volatility: 0.08
        });
        expect(r.squeezeRisk).toBeGreaterThan(0.4);
    });

    test('long gamma → no squeeze risk', () => {
        const r = oca.assessGammaSqueezeRisk({
            optionsData: {
                gammaExposureByStrike: { 50000: 5000000 }
            },
            openInterest: 10000000,
            volatility: 0.08
        });
        expect(r.squeezeRisk).toBeLessThan(0.3);
    });

    test('returns predicted direction when risk present', () => {
        const r = oca.assessGammaSqueezeRisk({
            optionsData: {
                gammaExposureByStrike: { 50000: -5000000 }
            },
            openInterest: 10000000,
            volatility: 0.08
        });
        expect(['UP', 'DOWN', 'NEUTRAL']).toContain(r.direction);
    });
});

describe('§32 calculateMaxPain (pure)', () => {
    test('finds strike with minimum total option value', () => {
        const r = oca.calculateMaxPain({
            strikes: [49000, 50000, 51000],
            optionsData: {
                openInterestCalls: { 49000: 100, 50000: 100, 51000: 500 },
                openInterestPuts:  { 49000: 500, 50000: 100, 51000: 100 }
            }
        });
        expect(r.maxPainPrice).toBe(50000);
    });

    test('handles empty options data', () => {
        const r = oca.calculateMaxPain({
            strikes: [50000],
            optionsData: { openInterestCalls: {}, openInterestPuts: {} }
        });
        expect(r.maxPainPrice).toBeDefined();
    });

    test('returns distance from current price', () => {
        const r = oca.calculateMaxPain({
            strikes: [49000, 50000, 51000],
            optionsData: {
                openInterestCalls: { 50000: 100 },
                openInterestPuts: { 50000: 100 }
            },
            currentPrice: 51500
        });
        expect(Math.abs(r.distance)).toBeGreaterThanOrEqual(0);
    });
});

describe('§32 getExpirationContext (pure)', () => {
    test('returns days-to-expiration for weekly + monthly', () => {
        const baseDate = new Date('2026-05-15');
        const r = oca.getExpirationContext({
            optionsData: {
                expirations: {
                    weekly: '2026-05-22',
                    monthly: '2026-05-29'
                }
            },
            currentDate: baseDate.getTime()
        });
        expect(r.dteWeekly).toBeGreaterThan(0);
        expect(r.dteMonthly).toBeGreaterThan(r.dteWeekly);
    });

    test('handles missing expirations', () => {
        const r = oca.getExpirationContext({
            optionsData: {},
            currentDate: Date.now()
        });
        expect(r.dteWeekly).toBeNull();
    });
});

describe('§32 evaluateBiasModifier — INVARIANT line 1321', () => {
    test('options bias is CAPPED — cannot exceed INVARIANT_MAX_BIAS_MODIFIER', () => {
        const r = oca.evaluateBiasModifier({
            optionsContext: {
                gexRegime: 'SHORT_GAMMA',
                gammaPinLevel: 50000,
                gammaPinAttraction: 1.0,
                maxPainPrice: 49000,
                squeezeRisk: 1.0
            },
            primarySignal: 0.7
        });
        expect(Math.abs(r.biasAdjustment)).toBeLessThanOrEqual(oca.INVARIANT_MAX_BIAS_MODIFIER);
    });

    test('INVARIANT: options alone cannot create entry signal (no primary)', () => {
        const r = oca.evaluateBiasModifier({
            optionsContext: {
                gexRegime: 'SHORT_GAMMA',
                gammaPinAttraction: 1.0,
                squeezeRisk: 1.0
            },
            primarySignal: 0  // no primary
        });
        // Modified signal capped at MAX_BIAS_MODIFIER, well below entry threshold
        expect(r.modifiedSignal).toBeLessThan(0.5);
    });

    test('returns capped=true when cumulative exceeds invariant', () => {
        const r = oca.evaluateBiasModifier({
            optionsContext: {
                gexRegime: 'SHORT_GAMMA',
                gammaPinAttraction: 1.0,
                squeezeRisk: 1.0
            },
            primarySignal: 0.5
        });
        expect(r.capped).toBeDefined();
    });

    test('no options context → no bias adjustment', () => {
        const r = oca.evaluateBiasModifier({
            optionsContext: {},
            primarySignal: 0.7
        });
        expect(r.biasAdjustment).toBe(0);
        expect(r.modifiedSignal).toBeCloseTo(0.7);
    });
});

describe('§32 recordObservation', () => {
    test('records GEX observation', () => {
        oca.recordObservation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            observationType: 'gex_profile',
            payload: { netGex: 2500000, regime: 'LONG_GAMMA' },
            symbol: 'BTCUSDT'
        });
        const rows = db.prepare(
            `SELECT * FROM ml_options_observations WHERE user_id = ?`
        ).all(TEST_USER);
        expect(rows).toHaveLength(1);
        expect(rows[0].observation_type).toBe('gex_profile');
    });

    test('records gamma_pin observation', () => {
        oca.recordObservation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            observationType: 'gamma_pin',
            payload: { pinLevel: 50000, strength: 0.8 },
            symbol: 'BTCUSDT'
        });
        const row = db.prepare(
            `SELECT * FROM ml_options_observations WHERE user_id = ? AND observation_type = ?`
        ).get(TEST_USER, 'gamma_pin');
        expect(row).toBeDefined();
    });

    test('throws on invalid observation_type', () => {
        expect(() => oca.recordObservation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            observationType: 'bogus_type',
            payload: {}
        })).toThrow(/observation/i);
    });
});

describe('§32 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9033;
        oca.recordObservation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            observationType: 'max_pain',
            payload: { price: 50000 }, symbol: 'BTCUSDT'
        });
        oca.recordObservation({
            userId: OTHER_USER, resolvedEnv: TEST_ENV,
            observationType: 'max_pain',
            payload: { price: 51000 }, symbol: 'BTCUSDT'
        });
        const r1 = db.prepare(
            `SELECT COUNT(*) AS count FROM ml_options_observations WHERE user_id = ?`
        ).get(TEST_USER);
        const r2 = db.prepare(
            `SELECT COUNT(*) AS count FROM ml_options_observations WHERE user_id = ?`
        ).get(OTHER_USER);
        expect(r1.count).toBe(1);
        expect(r2.count).toBe(1);
        db.prepare(`DELETE FROM ml_options_observations WHERE user_id = ?`).run(OTHER_USER);
    });
});
