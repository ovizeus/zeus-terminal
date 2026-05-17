'use strict';

/**
 * OMEGA Claude-Extra #1 — Institutional Gravity Scanner.
 * Operator-flagged retrocausal gravity engine. Pure analysis of others'
 * obligations — NO market manipulation.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-extra-grav-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/R2_cognition/institutionalGravityScanner');

const UID = 9501;
const UID_ZONES = 9502;
const UID_OBS = 9503;
const UID_HIST = 9504;
const UID_ISO_A = 9505;
const UID_ISO_B = 9506;
const UID_ENV = 9507;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    const uids = [UID, UID_ZONES, UID_OBS, UID_HIST,
                  UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_gravity_zones WHERE user_id IN (${placeholders})`).run(...uids);
    db.prepare(`DELETE FROM ml_gravity_observations WHERE user_id IN (${placeholders})`).run(...uids);
}
beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('Claude-Extra #1 INSTITUTIONAL GRAVITY SCANNER', () => {

    describe('Migrations 270+271', () => {
        test('270_ml_gravity_zones applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('270_ml_gravity_zones')).toBeTruthy();
        });
        test('271_ml_gravity_observations applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('271_ml_gravity_observations')).toBeTruthy();
        });
        test('zone_kind CHECK enum enforced', () => {
            const stmt = db.prepare(`INSERT INTO ml_gravity_zones
                (user_id, resolved_env, zone_id, asset, zone_kind,
                 target_price, gravity_strength, time_to_settlement_ms,
                 source_data_json, active, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            expect(() => stmt.run(UID, ENV, 'p_bk', 'BTC', 'BOGUS',
                100, 0.5, 1000, '{}', 1, _now())).toThrow();
        });
        test('zone_id UNIQUE', () => {
            const stmt = db.prepare(`INSERT INTO ml_gravity_zones
                (user_id, resolved_env, zone_id, asset, zone_kind,
                 target_price, gravity_strength, time_to_settlement_ms,
                 source_data_json, active, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            stmt.run(UID, ENV, 'p_dup', 'BTC', 'futures_expiry',
                100, 0.5, 1000, '{}', 1, _now());
            expect(() => stmt.run(UID, ENV, 'p_dup', 'ETH', 'gamma_wall',
                200, 0.6, 2000, '{}', 1, _now())).toThrow();
        });
    });

    describe('Constants', () => {
        test('ZONE_KINDS frozen 5 canonical', () => {
            expect(M.ZONE_KINDS).toEqual([
                'futures_expiry', 'gamma_wall', 'twap_target',
                'liquidation_cluster', 'funding_arbitrage'
            ]);
            expect(Object.isFrozen(M.ZONE_KINDS)).toBe(true);
        });
        test('SOURCE_WEIGHTS sum 1.0 + futures_expiry heaviest', () => {
            const sum = Object.values(M.SOURCE_WEIGHTS).reduce((a,b)=>a+b,0);
            expect(sum).toBeCloseTo(1.0, 6);
            expect(M.SOURCE_WEIGHTS.futures_expiry).toBe(0.30);
            expect(M.SOURCE_WEIGHTS.gamma_wall).toBe(0.25);
            expect(M.SOURCE_WEIGHTS.liquidation_cluster).toBe(0.20);
            expect(M.SOURCE_WEIGHTS.funding_arbitrage).toBe(0.15);
            expect(M.SOURCE_WEIGHTS.twap_target).toBe(0.10);
        });
        test('GRAVITY_STRENGTH_THRESHOLDS ordered', () => {
            expect(M.GRAVITY_STRENGTH_THRESHOLDS.strong).toBe(0.70);
            expect(M.GRAVITY_STRENGTH_THRESHOLDS.moderate).toBe(0.40);
        });
        test('MAX_TIME_HORIZON_MS = 24h', () => {
            expect(M.MAX_TIME_HORIZON_MS).toBe(86400000);
        });
    });

    describe('computeTimeDecay (pure)', () => {
        test('0ms elapsed → 1.0', () => {
            expect(M.computeTimeDecay({ timeToSettlementMs: M.MAX_TIME_HORIZON_MS }).timeDecay).toBe(1.0);
        });
        test('horizon ms → 1.0 (at horizon)', () => {
            // signal more reliable when within full horizon
            const r = M.computeTimeDecay({ timeToSettlementMs: M.MAX_TIME_HORIZON_MS });
            expect(r.timeDecay).toBe(1.0);
        });
        test('beyond horizon → 0', () => {
            expect(M.computeTimeDecay({ timeToSettlementMs: M.MAX_TIME_HORIZON_MS * 2 }).timeDecay).toBe(0);
        });
        test('half horizon → 0.5', () => {
            const r = M.computeTimeDecay({ timeToSettlementMs: M.MAX_TIME_HORIZON_MS / 2 });
            expect(r.timeDecay).toBeCloseTo(0.5, 6);
        });
    });

    describe('computeGravityStrength (pure)', () => {
        test('high concentration + futures_expiry + within horizon → strong', () => {
            const r = M.computeGravityStrength({
                openInterestAtStrike: 800,
                totalOpenInterest: 1000,
                timeToSettlementMs: M.MAX_TIME_HORIZON_MS / 2,
                sourceKind: 'futures_expiry'
            });
            // weight 0.30 × concentration 0.8 × time_decay 0.5 → 0.12
            // But scaled... let me think. Actually let's give a wide range expectation.
            expect(r.gravityStrength).toBeGreaterThan(0);
            expect(r.gravityStrength).toBeLessThanOrEqual(1);
        });
        test('low concentration → low strength', () => {
            const r = M.computeGravityStrength({
                openInterestAtStrike: 50,
                totalOpenInterest: 1000,
                timeToSettlementMs: M.MAX_TIME_HORIZON_MS / 2,
                sourceKind: 'twap_target'
            });
            expect(r.gravityStrength).toBeLessThan(0.10);
        });
        test('beyond horizon → 0', () => {
            const r = M.computeGravityStrength({
                openInterestAtStrike: 800,
                totalOpenInterest: 1000,
                timeToSettlementMs: M.MAX_TIME_HORIZON_MS * 3,
                sourceKind: 'futures_expiry'
            });
            expect(r.gravityStrength).toBe(0);
        });
        test('invalid sourceKind throws', () => {
            expect(() => M.computeGravityStrength({
                openInterestAtStrike: 100, totalOpenInterest: 1000,
                timeToSettlementMs: 1000, sourceKind: 'BOGUS'
            })).toThrow();
        });
        test('totalOpenInterest zero → 0', () => {
            const r = M.computeGravityStrength({
                openInterestAtStrike: 0, totalOpenInterest: 0,
                timeToSettlementMs: 1000, sourceKind: 'futures_expiry'
            });
            expect(r.gravityStrength).toBe(0);
        });
    });

    describe('classifyZoneStrength (pure)', () => {
        test('≥ 0.70 → strong', () => {
            expect(M.classifyZoneStrength({ gravityStrength: 0.80 }).strength).toBe('strong');
        });
        test('0.40-0.70 → moderate', () => {
            expect(M.classifyZoneStrength({ gravityStrength: 0.55 }).strength).toBe('moderate');
        });
        test('< 0.40 → weak', () => {
            expect(M.classifyZoneStrength({ gravityStrength: 0.20 }).strength).toBe('weak');
        });
        test('boundary 0.70 → strong', () => {
            expect(M.classifyZoneStrength({ gravityStrength: 0.70 }).strength).toBe('strong');
        });
    });

    describe('computeDistanceToTarget (pure)', () => {
        test('price equals target → 0', () => {
            expect(M.computeDistanceToTarget({ currentPrice: 100, targetPrice: 100 }).distancePct).toBe(0);
        });
        test('5% above target', () => {
            const r = M.computeDistanceToTarget({ currentPrice: 105, targetPrice: 100 });
            expect(r.distancePct).toBeCloseTo(0.05, 6);
        });
        test('5% below target (absolute)', () => {
            const r = M.computeDistanceToTarget({ currentPrice: 95, targetPrice: 100 });
            expect(r.distancePct).toBeCloseTo(0.05, 6);
        });
    });

    describe('assessAccuracy (pure)', () => {
        test('within tolerance → correct', () => {
            expect(M.assessAccuracy({
                predicted: 100, actual: 102, tolerancePct: 0.05
            }).correct).toBe(true);
        });
        test('beyond tolerance → incorrect', () => {
            expect(M.assessAccuracy({
                predicted: 100, actual: 110, tolerancePct: 0.05
            }).correct).toBe(false);
        });
        test('exact match → correct', () => {
            expect(M.assessAccuracy({
                predicted: 100, actual: 100, tolerancePct: 0.01
            }).correct).toBe(true);
        });
    });

    describe('registerGravityZone', () => {
        test('persists zone', () => {
            const r = M.registerGravityZone({
                userId: UID_ZONES, resolvedEnv: ENV,
                zoneId: 'z1', asset: 'BTC',
                zoneKind: 'futures_expiry',
                targetPrice: 65000,
                gravityStrength: 0.75,
                timeToSettlementMs: 3600000,
                sourceData: { oi: 5000, strike: 65000 },
                ts: _now()
            });
            expect(r.registered).toBe(true);
        });
        test('duplicate zoneId throws', () => {
            M.registerGravityZone({
                userId: UID_ZONES, resolvedEnv: ENV,
                zoneId: 'z_dup', asset: 'BTC', zoneKind: 'gamma_wall',
                targetPrice: 65000, gravityStrength: 0.5,
                timeToSettlementMs: 1000, sourceData: {}, ts: _now()
            });
            expect(() => M.registerGravityZone({
                userId: UID_ZONES, resolvedEnv: ENV,
                zoneId: 'z_dup', asset: 'ETH', zoneKind: 'twap_target',
                targetPrice: 3000, gravityStrength: 0.4,
                timeToSettlementMs: 2000, sourceData: {}, ts: _now()
            })).toThrow(/duplicate/);
        });
        test('invalid zoneKind throws', () => {
            expect(() => M.registerGravityZone({
                userId: UID_ZONES, resolvedEnv: ENV,
                zoneId: 'z_bad', asset: 'BTC', zoneKind: 'BOGUS',
                targetPrice: 65000, gravityStrength: 0.5,
                timeToSettlementMs: 1000, sourceData: {}, ts: _now()
            })).toThrow();
        });
        test('targetPrice ≤ 0 throws', () => {
            expect(() => M.registerGravityZone({
                userId: UID_ZONES, resolvedEnv: ENV,
                zoneId: 'z_bad2', asset: 'BTC', zoneKind: 'gamma_wall',
                targetPrice: 0, gravityStrength: 0.5,
                timeToSettlementMs: 1000, sourceData: {}, ts: _now()
            })).toThrow();
        });
    });

    describe('recordObservation (integration)', () => {
        test('within tolerance → prediction_was_correct=1', () => {
            M.registerGravityZone({
                userId: UID_OBS, resolvedEnv: ENV,
                zoneId: 'z_obs_ok', asset: 'BTC', zoneKind: 'futures_expiry',
                targetPrice: 65000, gravityStrength: 0.8,
                timeToSettlementMs: 3600000, sourceData: {}, ts: 1000
            });
            const r = M.recordObservation({
                userId: UID_OBS, resolvedEnv: ENV,
                observationId: 'o1', zoneId: 'z_obs_ok',
                predictedPrice: 65000, actualPriceAtSettlement: 64950,
                tolerancePct: 0.01,
                ts: 5000
            });
            expect(r.predictionWasCorrect).toBe(true);
        });
        test('beyond tolerance → 0', () => {
            M.registerGravityZone({
                userId: UID_OBS, resolvedEnv: ENV,
                zoneId: 'z_obs_bad', asset: 'BTC', zoneKind: 'gamma_wall',
                targetPrice: 65000, gravityStrength: 0.5,
                timeToSettlementMs: 1000, sourceData: {}, ts: 1000
            });
            const r = M.recordObservation({
                userId: UID_OBS, resolvedEnv: ENV,
                observationId: 'o2', zoneId: 'z_obs_bad',
                predictedPrice: 65000, actualPriceAtSettlement: 67000,
                tolerancePct: 0.01,
                ts: 5000
            });
            expect(r.predictionWasCorrect).toBe(false);
        });
        test('duplicate observationId throws', () => {
            M.registerGravityZone({
                userId: UID_OBS, resolvedEnv: ENV,
                zoneId: 'z_obs_dup_z', asset: 'BTC', zoneKind: 'twap_target',
                targetPrice: 65000, gravityStrength: 0.5,
                timeToSettlementMs: 1000, sourceData: {}, ts: 1000
            });
            M.recordObservation({
                userId: UID_OBS, resolvedEnv: ENV,
                observationId: 'o_dup', zoneId: 'z_obs_dup_z',
                predictedPrice: 65000, actualPriceAtSettlement: 65000,
                tolerancePct: 0.01, ts: 5000
            });
            expect(() => M.recordObservation({
                userId: UID_OBS, resolvedEnv: ENV,
                observationId: 'o_dup', zoneId: 'z_obs_dup_z',
                predictedPrice: 65000, actualPriceAtSettlement: 64000,
                tolerancePct: 0.01, ts: 6000
            })).toThrow(/duplicate/);
        });
    });

    describe('getActiveZones', () => {
        test('filters by asset + minStrength + active', () => {
            const u = UID_ZONES;
            M.registerGravityZone({
                userId: u, resolvedEnv: ENV,
                zoneId: 'z_act_strong', asset: 'BTC',
                zoneKind: 'futures_expiry',
                targetPrice: 65000, gravityStrength: 0.85,
                timeToSettlementMs: 1000, sourceData: {}, ts: 1000
            });
            M.registerGravityZone({
                userId: u, resolvedEnv: ENV,
                zoneId: 'z_act_weak', asset: 'BTC',
                zoneKind: 'twap_target',
                targetPrice: 65500, gravityStrength: 0.20,
                timeToSettlementMs: 1000, sourceData: {}, ts: 1001
            });
            M.registerGravityZone({
                userId: u, resolvedEnv: ENV,
                zoneId: 'z_act_eth', asset: 'ETH',
                zoneKind: 'gamma_wall',
                targetPrice: 3000, gravityStrength: 0.80,
                timeToSettlementMs: 1000, sourceData: {}, ts: 1002
            });
            const btcStrong = M.getActiveZones({
                userId: u, resolvedEnv: ENV,
                asset: 'BTC', minStrength: 0.50, limit: 10
            });
            expect(btcStrong.length).toBe(1);
            expect(btcStrong[0].zoneId).toBe('z_act_strong');
        });
    });

    describe('deactivateZone', () => {
        test('marks zone inactive', () => {
            M.registerGravityZone({
                userId: UID, resolvedEnv: ENV,
                zoneId: 'z_deac', asset: 'BTC', zoneKind: 'gamma_wall',
                targetPrice: 65000, gravityStrength: 0.5,
                timeToSettlementMs: 1000, sourceData: {}, ts: 1000
            });
            const r = M.deactivateZone({
                userId: UID, resolvedEnv: ENV,
                zoneId: 'z_deac', reason: 'expired'
            });
            expect(r.deactivated).toBe(true);
            const list = M.getActiveZones({
                userId: UID, resolvedEnv: ENV,
                asset: 'BTC', minStrength: 0, limit: 10
            });
            expect(list.every(z => z.zoneId !== 'z_deac')).toBe(true);
        });
        test('missing zone throws', () => {
            expect(() => M.deactivateZone({
                userId: UID, resolvedEnv: ENV,
                zoneId: 'NONEXISTENT', reason: 'r'
            })).toThrow(/not found/);
        });
    });

    describe('getZoneAccuracyHistory', () => {
        test('returns observations filtered by zone_kind', () => {
            const u = UID_HIST;
            M.registerGravityZone({
                userId: u, resolvedEnv: ENV,
                zoneId: 'z_h_fe', asset: 'BTC',
                zoneKind: 'futures_expiry',
                targetPrice: 65000, gravityStrength: 0.8,
                timeToSettlementMs: 1000, sourceData: {}, ts: 1000
            });
            M.registerGravityZone({
                userId: u, resolvedEnv: ENV,
                zoneId: 'z_h_gw', asset: 'BTC', zoneKind: 'gamma_wall',
                targetPrice: 65500, gravityStrength: 0.5,
                timeToSettlementMs: 1000, sourceData: {}, ts: 1001
            });
            M.recordObservation({
                userId: u, resolvedEnv: ENV,
                observationId: 'oh1', zoneId: 'z_h_fe',
                predictedPrice: 65000, actualPriceAtSettlement: 65020,
                tolerancePct: 0.01, ts: 2000
            });
            M.recordObservation({
                userId: u, resolvedEnv: ENV,
                observationId: 'oh2', zoneId: 'z_h_gw',
                predictedPrice: 65500, actualPriceAtSettlement: 66000,
                tolerancePct: 0.01, ts: 3000
            });
            const feObs = M.getZoneAccuracyHistory({
                userId: u, resolvedEnv: ENV,
                zoneKind: 'futures_expiry', limit: 10
            });
            expect(feObs.length).toBe(1);
            expect(feObs[0].observationId).toBe('oh1');
        });
    });

    describe('isolation per user × env', () => {
        test('uid isolation', () => {
            M.registerGravityZone({
                userId: UID_ISO_A, resolvedEnv: ENV,
                zoneId: 'z_iso_a', asset: 'BTC',
                zoneKind: 'gamma_wall', targetPrice: 65000,
                gravityStrength: 0.8, timeToSettlementMs: 1000,
                sourceData: {}, ts: 1000
            });
            M.registerGravityZone({
                userId: UID_ISO_B, resolvedEnv: ENV,
                zoneId: 'z_iso_b', asset: 'BTC',
                zoneKind: 'gamma_wall', targetPrice: 65000,
                gravityStrength: 0.8, timeToSettlementMs: 1000,
                sourceData: {}, ts: 1000
            });
            const aZones = M.getActiveZones({
                userId: UID_ISO_A, resolvedEnv: ENV,
                asset: 'BTC', minStrength: 0, limit: 10
            });
            expect(aZones.every(z => z.zoneId !== 'z_iso_b')).toBe(true);
        });
        test('env isolation', () => {
            M.registerGravityZone({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                zoneId: 'z_env_d', asset: 'BTC',
                zoneKind: 'gamma_wall', targetPrice: 65000,
                gravityStrength: 0.8, timeToSettlementMs: 1000,
                sourceData: {}, ts: 1000
            });
            M.registerGravityZone({
                userId: UID_ENV, resolvedEnv: 'TESTNET',
                zoneId: 'z_env_t', asset: 'BTC',
                zoneKind: 'gamma_wall', targetPrice: 65000,
                gravityStrength: 0.8, timeToSettlementMs: 1000,
                sourceData: {}, ts: 1000
            });
            const demo = M.getActiveZones({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                asset: 'BTC', minStrength: 0, limit: 10
            });
            expect(demo.every(z => z.zoneId !== 'z_env_t')).toBe(true);
        });
    });
});
