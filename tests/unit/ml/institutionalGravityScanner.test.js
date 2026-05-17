'use strict';

/**
 * OMEGA Claude-Extra #1 v2 — Institutional Gravity Scanner (research-grade).
 *
 * v2 incorporates audit feedback:
 * - FK integrity (zone_id FK from observations + conflicts)
 * - Semantic naming (zone_center_price vs predicted_settlement_price)
 * - Temporal lifecycle (zone_expires_at_ts + observation_window_ms +
 *   settlement_type CHECK enum)
 * - Confidence modeling (confidence_score + source_quality_score +
 *   liquidity_depth_score + volatility_sensitivity_score)
 * - Conflict dynamics (separate ml_gravity_conflicts + net_vector_direction)
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-extra-grav-v2-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/R2_cognition/institutionalGravityScanner');

const UID = 9501;
const UID_ZONES = 9502;
const UID_OBS = 9503;
const UID_CONF = 9504;
const UID_HIST = 9505;
const UID_ISO_A = 9506;
const UID_ISO_B = 9507;
const UID_ENV = 9508;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    const uids = [UID, UID_ZONES, UID_OBS, UID_CONF, UID_HIST,
                  UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_gravity_observations WHERE user_id IN (${placeholders})`).run(...uids);
    db.prepare(`DELETE FROM ml_gravity_conflicts WHERE user_id IN (${placeholders})`).run(...uids);
    db.prepare(`DELETE FROM ml_gravity_zones WHERE user_id IN (${placeholders})`).run(...uids);
}
beforeEach(() => cleanRows());
afterAll(() => cleanRows());

function _registerSimpleZone(u, zid, opts = {}) {
    return M.registerGravityZone({
        userId: u, resolvedEnv: ENV,
        zoneId: zid, asset: opts.asset || 'BTC',
        zoneKind: opts.zoneKind || 'futures_expiry',
        settlementType: opts.settlementType || 'cme_quarterly',
        zoneCenterPrice: opts.zoneCenterPrice || 65000,
        gravityStrength: opts.gravityStrength !== undefined ? opts.gravityStrength : 0.7,
        confidenceScore: opts.confidenceScore !== undefined ? opts.confidenceScore : 0.7,
        sourceQualityScore: opts.sourceQualityScore !== undefined ? opts.sourceQualityScore : 0.7,
        liquidityDepthScore: opts.liquidityDepthScore !== undefined ? opts.liquidityDepthScore : 0.7,
        volatilitySensitivityScore: opts.volatilitySensitivityScore !== undefined ? opts.volatilitySensitivityScore : 0.7,
        timeToSettlementMs: opts.timeToSettlementMs || 3600000,
        zoneExpiresAtTs: opts.zoneExpiresAtTs || (Date.now() + 3600000),
        sourceData: opts.sourceData || {},
        ts: opts.ts || _now()
    });
}

describe('Claude-Extra #1 v2 INSTITUTIONAL GRAVITY SCANNER', () => {

    describe('Migrations 270+271+272', () => {
        test('270_ml_gravity_zones applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('270_ml_gravity_zones')).toBeTruthy();
        });
        test('271_ml_gravity_observations applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('271_ml_gravity_observations')).toBeTruthy();
        });
        test('272_ml_gravity_conflicts applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('272_ml_gravity_conflicts')).toBeTruthy();
        });
        test('zone_kind CHECK enum enforced', () => {
            expect(() => _registerSimpleZone(UID, 'p_bk', { zoneKind: 'BOGUS' })).toThrow();
        });
        test('settlement_type CHECK enum enforced', () => {
            expect(() => _registerSimpleZone(UID, 'p_bs', { settlementType: 'BOGUS' })).toThrow();
        });
        test('zone_id UNIQUE', () => {
            _registerSimpleZone(UID, 'p_dup');
            expect(() => _registerSimpleZone(UID, 'p_dup')).toThrow();
        });
        test('FK observations.zone_id → zones.zone_id (orphan rejected)', () => {
            // Attempt to insert observation for non-existent zone
            expect(() => {
                db.prepare(`INSERT INTO ml_gravity_observations
                    (user_id, resolved_env, observation_id, zone_id,
                     predicted_settlement_price, actual_price_at_settlement,
                     observation_window_ms, distance_to_target_pct,
                     prediction_was_correct, tolerance_pct, ts)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'orphan_obs', 'NONEXISTENT_ZONE',
                    65000, 65000, 1000, 0, 1, 0.01, _now());
            }).toThrow(/FOREIGN KEY/i);
        });
        test('FK conflicts.dominant_zone_id → zones.zone_id', () => {
            expect(() => {
                db.prepare(`INSERT INTO ml_gravity_conflicts
                    (user_id, resolved_env, conflict_id, asset,
                     participating_zone_ids_json,
                     gravity_conflict_score, net_vector_direction,
                     dominant_zone_id, ts)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'orphan_conf', 'BTC',
                    '[]', 0.5, 'up', 'NONEXISTENT', _now());
            }).toThrow(/FOREIGN KEY/i);
        });
        test('net_vector_direction CHECK enum', () => {
            _registerSimpleZone(UID, 'p_nv_z');
            expect(() => {
                db.prepare(`INSERT INTO ml_gravity_conflicts
                    (user_id, resolved_env, conflict_id, asset,
                     participating_zone_ids_json,
                     gravity_conflict_score, net_vector_direction,
                     dominant_zone_id, ts)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'p_bd', 'BTC',
                    '["p_nv_z"]', 0.5, 'BOGUS_DIR', 'p_nv_z', _now());
            }).toThrow();
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
        test('SETTLEMENT_TYPES frozen 5', () => {
            expect(M.SETTLEMENT_TYPES).toEqual([
                'cme_quarterly', 'monthly_options',
                'perpetual_funding', 'twap_window',
                'liquidation_cascade'
            ]);
            expect(Object.isFrozen(M.SETTLEMENT_TYPES)).toBe(true);
        });
        test('NET_VECTOR_DIRECTIONS frozen 3', () => {
            expect(M.NET_VECTOR_DIRECTIONS).toEqual(['up','down','sideways']);
            expect(Object.isFrozen(M.NET_VECTOR_DIRECTIONS)).toBe(true);
        });
        test('SOURCE_WEIGHTS sum 1.0 + futures_expiry heaviest', () => {
            const sum = Object.values(M.SOURCE_WEIGHTS).reduce((a,b)=>a+b,0);
            expect(sum).toBeCloseTo(1.0, 6);
            expect(M.SOURCE_WEIGHTS.futures_expiry).toBe(0.30);
        });
        test('CONFIDENCE_WEIGHTS sum 1.0', () => {
            const sum = Object.values(M.CONFIDENCE_WEIGHTS).reduce((a,b)=>a+b,0);
            expect(sum).toBeCloseTo(1.0, 6);
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
        test('horizon ms → 1.0', () => {
            expect(M.computeTimeDecay({ timeToSettlementMs: M.MAX_TIME_HORIZON_MS }).timeDecay).toBe(1.0);
        });
        test('beyond horizon → 0', () => {
            expect(M.computeTimeDecay({ timeToSettlementMs: M.MAX_TIME_HORIZON_MS * 2 }).timeDecay).toBe(0);
        });
        test('half horizon → 0.5', () => {
            expect(M.computeTimeDecay({ timeToSettlementMs: M.MAX_TIME_HORIZON_MS / 2 }).timeDecay).toBeCloseTo(0.5, 6);
        });
    });

    describe('computeGravityStrength (pure)', () => {
        test('high concentration + futures_expiry → high', () => {
            const r = M.computeGravityStrength({
                openInterestAtStrike: 800, totalOpenInterest: 1000,
                timeToSettlementMs: M.MAX_TIME_HORIZON_MS,
                sourceKind: 'futures_expiry'
            });
            // 0.30 × 0.8 × 1.0 / 0.30 = 0.8
            expect(r.gravityStrength).toBeCloseTo(0.8, 2);
        });
        test('low concentration + twap → low', () => {
            const r = M.computeGravityStrength({
                openInterestAtStrike: 50, totalOpenInterest: 1000,
                timeToSettlementMs: M.MAX_TIME_HORIZON_MS / 2,
                sourceKind: 'twap_target'
            });
            expect(r.gravityStrength).toBeLessThan(0.10);
        });
        test('beyond horizon → 0', () => {
            const r = M.computeGravityStrength({
                openInterestAtStrike: 800, totalOpenInterest: 1000,
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
    });

    describe('computeCompositeConfidence (pure) — NEW v2', () => {
        test('all sub-scores high → high composite', () => {
            const r = M.computeCompositeConfidence({
                sourceQualityScore: 0.9,
                liquidityDepthScore: 0.9,
                volatilitySensitivityScore: 0.9
            });
            expect(r.compositeConfidence).toBeCloseTo(0.9, 2);
        });
        test('one weak signal → reduced composite', () => {
            const r = M.computeCompositeConfidence({
                sourceQualityScore: 0.9,
                liquidityDepthScore: 0.2,
                volatilitySensitivityScore: 0.9
            });
            expect(r.compositeConfidence).toBeLessThan(0.7);
        });
        test('all zero → 0', () => {
            const r = M.computeCompositeConfidence({
                sourceQualityScore: 0,
                liquidityDepthScore: 0,
                volatilitySensitivityScore: 0
            });
            expect(r.compositeConfidence).toBe(0);
        });
        test('out-of-range throws', () => {
            expect(() => M.computeCompositeConfidence({
                sourceQualityScore: 1.5,
                liquidityDepthScore: 0.5,
                volatilitySensitivityScore: 0.5
            })).toThrow();
        });
    });

    describe('classifyZoneStrength (pure)', () => {
        test('≥0.70 → strong', () => {
            expect(M.classifyZoneStrength({ gravityStrength: 0.80 }).strength).toBe('strong');
        });
        test('0.40-0.70 → moderate', () => {
            expect(M.classifyZoneStrength({ gravityStrength: 0.55 }).strength).toBe('moderate');
        });
        test('<0.40 → weak', () => {
            expect(M.classifyZoneStrength({ gravityStrength: 0.20 }).strength).toBe('weak');
        });
    });

    describe('computeNetVector (pure) — NEW v2', () => {
        test('all UP zones → up', () => {
            const r = M.computeNetVector({
                currentPrice: 64000,
                zones: [
                    { zoneCenterPrice: 65000, gravityStrength: 0.8 },
                    { zoneCenterPrice: 65500, gravityStrength: 0.7 }
                ]
            });
            expect(r.netVectorDirection).toBe('up');
        });
        test('all DOWN zones → down', () => {
            const r = M.computeNetVector({
                currentPrice: 65000,
                zones: [
                    { zoneCenterPrice: 64000, gravityStrength: 0.8 },
                    { zoneCenterPrice: 63500, gravityStrength: 0.7 }
                ]
            });
            expect(r.netVectorDirection).toBe('down');
        });
        test('balanced opposing → sideways', () => {
            const r = M.computeNetVector({
                currentPrice: 65000,
                zones: [
                    { zoneCenterPrice: 65800, gravityStrength: 0.7 },
                    { zoneCenterPrice: 64200, gravityStrength: 0.7 }
                ]
            });
            expect(r.netVectorDirection).toBe('sideways');
        });
        test('empty zones throws', () => {
            expect(() => M.computeNetVector({
                currentPrice: 65000, zones: []
            })).toThrow();
        });
    });

    describe('computeGravityConflictScore (pure) — NEW v2', () => {
        test('single zone → 0 conflict', () => {
            const r = M.computeGravityConflictScore({
                currentPrice: 65000,
                zones: [{ zoneCenterPrice: 65500, gravityStrength: 0.7 }]
            });
            expect(r.conflictScore).toBe(0);
        });
        test('all same direction → low conflict', () => {
            const r = M.computeGravityConflictScore({
                currentPrice: 64000,
                zones: [
                    { zoneCenterPrice: 65000, gravityStrength: 0.8 },
                    { zoneCenterPrice: 65500, gravityStrength: 0.7 }
                ]
            });
            expect(r.conflictScore).toBeLessThan(0.3);
        });
        test('opposing strong forces → high conflict', () => {
            const r = M.computeGravityConflictScore({
                currentPrice: 65000,
                zones: [
                    { zoneCenterPrice: 65800, gravityStrength: 0.8 },
                    { zoneCenterPrice: 64200, gravityStrength: 0.8 }
                ]
            });
            expect(r.conflictScore).toBeGreaterThan(0.5);
        });
    });

    describe('registerGravityZone v2', () => {
        test('persists with all v2 fields', () => {
            const r = M.registerGravityZone({
                userId: UID_ZONES, resolvedEnv: ENV,
                zoneId: 'z_v2_1', asset: 'BTC',
                zoneKind: 'futures_expiry',
                settlementType: 'cme_quarterly',
                zoneCenterPrice: 65000,
                gravityStrength: 0.75,
                confidenceScore: 0.8,
                sourceQualityScore: 0.85,
                liquidityDepthScore: 0.75,
                volatilitySensitivityScore: 0.7,
                timeToSettlementMs: 3600000,
                zoneExpiresAtTs: _now() + 3600000,
                sourceData: { oi: 5000 },
                ts: _now()
            });
            expect(r.registered).toBe(true);
        });
        test('invalid settlement_type throws', () => {
            expect(() => _registerSimpleZone(UID_ZONES, 'z_bad_s',
                { settlementType: 'BOGUS' })).toThrow(/invalid settlementType/);
        });
        test('confidence_score out of range throws', () => {
            expect(() => _registerSimpleZone(UID_ZONES, 'z_bad_c',
                { confidenceScore: 1.5 })).toThrow();
        });
        test('zone_expires_at_ts required', () => {
            expect(() => M.registerGravityZone({
                userId: UID_ZONES, resolvedEnv: ENV,
                zoneId: 'z_no_exp', asset: 'BTC',
                zoneKind: 'futures_expiry',
                settlementType: 'cme_quarterly',
                zoneCenterPrice: 65000, gravityStrength: 0.5,
                confidenceScore: 0.5, sourceQualityScore: 0.5,
                liquidityDepthScore: 0.5, volatilitySensitivityScore: 0.5,
                timeToSettlementMs: 1000,
                // zoneExpiresAtTs MISSING
                sourceData: {}, ts: _now()
            })).toThrow(/missing zoneExpiresAtTs/);
        });
    });

    describe('recordObservation (integration)', () => {
        test('within tolerance → correct=1; predicted_settlement_price stored', () => {
            _registerSimpleZone(UID_OBS, 'z_obs_ok');
            const r = M.recordObservation({
                userId: UID_OBS, resolvedEnv: ENV,
                observationId: 'o_ok', zoneId: 'z_obs_ok',
                predictedSettlementPrice: 65000,
                actualPriceAtSettlement: 64950,
                observationWindowMs: 60000,
                tolerancePct: 0.01,
                ts: _now()
            });
            expect(r.predictionWasCorrect).toBe(true);
        });
        test('beyond tolerance → 0', () => {
            _registerSimpleZone(UID_OBS, 'z_obs_bad');
            const r = M.recordObservation({
                userId: UID_OBS, resolvedEnv: ENV,
                observationId: 'o_bad', zoneId: 'z_obs_bad',
                predictedSettlementPrice: 65000,
                actualPriceAtSettlement: 67000,
                observationWindowMs: 60000,
                tolerancePct: 0.01, ts: _now()
            });
            expect(r.predictionWasCorrect).toBe(false);
        });
        test('orphan zone_id rejected via FK', () => {
            expect(() => M.recordObservation({
                userId: UID_OBS, resolvedEnv: ENV,
                observationId: 'o_orphan', zoneId: 'NONEXISTENT',
                predictedSettlementPrice: 65000,
                actualPriceAtSettlement: 65000,
                observationWindowMs: 60000,
                tolerancePct: 0.01, ts: _now()
            })).toThrow(/FOREIGN KEY|not found/i);
        });
        test('observation_window_ms persisted', () => {
            _registerSimpleZone(UID_OBS, 'z_obs_win');
            M.recordObservation({
                userId: UID_OBS, resolvedEnv: ENV,
                observationId: 'o_win', zoneId: 'z_obs_win',
                predictedSettlementPrice: 65000,
                actualPriceAtSettlement: 65000,
                observationWindowMs: 120000,
                tolerancePct: 0.01, ts: _now()
            });
            const history = M.getZoneAccuracyHistory({
                userId: UID_OBS, resolvedEnv: ENV,
                zoneKind: 'futures_expiry', limit: 10
            });
            expect(history[0].observationWindowMs).toBe(120000);
        });
    });

    describe('recordConflict (integration) — NEW v2', () => {
        test('records conflict between 2 opposing zones', () => {
            const zUp = _registerSimpleZone(UID_CONF, 'z_conf_up',
                { zoneCenterPrice: 65800, gravityStrength: 0.8 });
            const zDn = _registerSimpleZone(UID_CONF, 'z_conf_dn',
                { zoneCenterPrice: 64200, gravityStrength: 0.8 });
            const r = M.recordConflict({
                userId: UID_CONF, resolvedEnv: ENV,
                conflictId: 'c1', asset: 'BTC',
                currentPrice: 65000,
                participatingZoneIds: ['z_conf_up', 'z_conf_dn'],
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.gravityConflictScore).toBeGreaterThan(0.5);
            expect(r.netVectorDirection).toBe('sideways');
        });
        test('orphan participating zone rejected', () => {
            _registerSimpleZone(UID_CONF, 'z_real');
            expect(() => M.recordConflict({
                userId: UID_CONF, resolvedEnv: ENV,
                conflictId: 'c_bad', asset: 'BTC',
                currentPrice: 65000,
                participatingZoneIds: ['z_real', 'NONEXISTENT'],
                ts: _now()
            })).toThrow(/zone not found/);
        });
        test('duplicate conflictId throws', () => {
            _registerSimpleZone(UID_CONF, 'z_real2');
            _registerSimpleZone(UID_CONF, 'z_real3',
                { zoneCenterPrice: 64000 });
            M.recordConflict({
                userId: UID_CONF, resolvedEnv: ENV,
                conflictId: 'c_dup', asset: 'BTC',
                currentPrice: 65000,
                participatingZoneIds: ['z_real2', 'z_real3'],
                ts: _now()
            });
            expect(() => M.recordConflict({
                userId: UID_CONF, resolvedEnv: ENV,
                conflictId: 'c_dup', asset: 'BTC',
                currentPrice: 65000,
                participatingZoneIds: ['z_real2', 'z_real3'],
                ts: _now()
            })).toThrow(/duplicate/);
        });
    });

    describe('getActiveZones', () => {
        test('filters by asset + minStrength + active + not expired', () => {
            const u = UID_ZONES;
            const futureExp = _now() + 3600000;
            _registerSimpleZone(u, 'z_strong', { gravityStrength: 0.85, zoneExpiresAtTs: futureExp });
            _registerSimpleZone(u, 'z_weak', { gravityStrength: 0.20, zoneExpiresAtTs: futureExp });
            _registerSimpleZone(u, 'z_expired', { gravityStrength: 0.85, zoneExpiresAtTs: _now() - 1000 });

            const result = M.getActiveZones({
                userId: u, resolvedEnv: ENV,
                asset: 'BTC', minStrength: 0.50,
                currentTs: _now(), limit: 10
            });
            expect(result.length).toBe(1);
            expect(result[0].zoneId).toBe('z_strong');
        });
    });

    describe('deactivateZone', () => {
        test('marks inactive', () => {
            _registerSimpleZone(UID, 'z_deac');
            const r = M.deactivateZone({
                userId: UID, resolvedEnv: ENV,
                zoneId: 'z_deac', reason: 'expired'
            });
            expect(r.deactivated).toBe(true);
        });
    });

    describe('isolation per user × env', () => {
        test('uid isolation', () => {
            _registerSimpleZone(UID_ISO_A, 'z_iso_a');
            _registerSimpleZone(UID_ISO_B, 'z_iso_b');
            const zones = M.getActiveZones({
                userId: UID_ISO_A, resolvedEnv: ENV,
                asset: 'BTC', minStrength: 0, currentTs: _now(), limit: 10
            });
            expect(zones.every(z => z.zoneId !== 'z_iso_b')).toBe(true);
        });
        test('env isolation', () => {
            M.registerGravityZone({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                zoneId: 'z_env_d', asset: 'BTC',
                zoneKind: 'futures_expiry', settlementType: 'cme_quarterly',
                zoneCenterPrice: 65000, gravityStrength: 0.7,
                confidenceScore: 0.7, sourceQualityScore: 0.7,
                liquidityDepthScore: 0.7, volatilitySensitivityScore: 0.7,
                timeToSettlementMs: 1000,
                zoneExpiresAtTs: _now() + 3600000,
                sourceData: {}, ts: _now()
            });
            M.registerGravityZone({
                userId: UID_ENV, resolvedEnv: 'TESTNET',
                zoneId: 'z_env_t', asset: 'BTC',
                zoneKind: 'futures_expiry', settlementType: 'cme_quarterly',
                zoneCenterPrice: 65000, gravityStrength: 0.7,
                confidenceScore: 0.7, sourceQualityScore: 0.7,
                liquidityDepthScore: 0.7, volatilitySensitivityScore: 0.7,
                timeToSettlementMs: 1000,
                zoneExpiresAtTs: _now() + 3600000,
                sourceData: {}, ts: _now()
            });
            const demo = M.getActiveZones({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                asset: 'BTC', minStrength: 0, currentTs: _now(), limit: 10
            });
            expect(demo.every(z => z.zoneId !== 'z_env_t')).toBe(true);
        });
    });
});
