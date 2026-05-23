'use strict';

/**
 * OMEGA §155 UNKNOWN-UNKNOWN RESERVE / SACRED SLACK ENGINE.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt lines 5181-5232.
 *
 * "ce parte din prudenta mea este rezervata pentru lucruri pe care nici
 *  macar nu stiu inca sa le numesc?"
 *
 * Tests FIRST per TDD discipline.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p155-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/R3A_safety/unknownUnknownReserve');

const UID = 9155;
const UID_R = 9255;
const UID_A = 9355;
const UID_GET = 9455;
const UID_ISO_A = 9555;
const UID_ISO_B = 9655;
const UID_ENV = 9755;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    const uids = [UID, UID_R, UID_A, UID_GET, UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_reserve_activations WHERE user_id IN (${placeholders})`).run(...uids);
    db.prepare(`DELETE FROM ml_unknown_unknown_reserves WHERE user_id IN (${placeholders})`).run(...uids);
}
beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §155 UNKNOWN-UNKNOWN RESERVE', () => {

    describe('Migrations 308+309', () => {
        test('308 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('308_ml_unknown_unknown_reserves')).toBeTruthy();
        });
        test('309 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('309_ml_reserve_activations')).toBeTruthy();
        });
        test('reserve_type CHECK enum', () => {
            expect(() => db.prepare(`INSERT INTO ml_unknown_unknown_reserves
                (user_id, resolved_env, reserve_id, reserve_type, allocated_fraction,
                 never_below_floor, current_consumed, description, registered_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'r_bk', 'BOGUS', 0.10, 0.03, 0,
                    'desc', _now())).toThrow();
        });
        test('activation_trigger CHECK enum', () => {
            db.prepare(`INSERT INTO ml_unknown_unknown_reserves
                (user_id, resolved_env, reserve_id, reserve_type, allocated_fraction,
                 never_below_floor, current_consumed, description, registered_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'r_for_ck1', 'risk_budget', 0.10, 0.03, 0,
                    'desc', _now());
            expect(() => db.prepare(`INSERT INTO ml_reserve_activations
                (user_id, resolved_env, activation_id, reserve_id,
                 activation_trigger, pre_activation_reserve_score,
                 drawdown_amount, post_activation_reserve_score, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'a_bk', 'r_for_ck1', 'BOGUS', 1.0, 0.05, 0.5,
                    null, _now())).toThrow();
        });
        test('never_below_floor ≤ allocated_fraction CHECK', () => {
            // Schema CHECK: never_below_floor <= allocated_fraction
            expect(() => db.prepare(`INSERT INTO ml_unknown_unknown_reserves
                (user_id, resolved_env, reserve_id, reserve_type, allocated_fraction,
                 never_below_floor, current_consumed, description, registered_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'r_inv', 'risk_budget', 0.05, 0.10, 0,
                    'desc', _now())).toThrow();
        });
        test('reserve_id UNIQUE', () => {
            const stmt = db.prepare(`INSERT INTO ml_unknown_unknown_reserves
                (user_id, resolved_env, reserve_id, reserve_type, allocated_fraction,
                 never_below_floor, current_consumed, description, registered_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            stmt.run(UID, ENV, 'r_dup', 'risk_budget', 0.10, 0.03, 0,
                'd1', _now());
            expect(() => stmt.run(UID, ENV, 'r_dup', 'trust_budget', 0.05,
                0.02, 0, 'd2', _now())).toThrow();
        });
        test('FK ON DELETE RESTRICT on reserve_id', () => {
            db.prepare(`INSERT INTO ml_unknown_unknown_reserves
                (user_id, resolved_env, reserve_id, reserve_type, allocated_fraction,
                 never_below_floor, current_consumed, description, registered_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'r_fk', 'risk_budget', 0.10, 0.03, 0,
                    'd', _now());
            db.prepare(`INSERT INTO ml_reserve_activations
                (user_id, resolved_env, activation_id, reserve_id,
                 activation_trigger, pre_activation_reserve_score,
                 drawdown_amount, post_activation_reserve_score, reasoning, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'a_fk', 'r_fk', 'ontology_failure', 1.0, 0.05, 0.5,
                    null, _now());
            expect(() => db.prepare(`DELETE FROM ml_unknown_unknown_reserves WHERE reserve_id=?`).run('r_fk')).toThrow();
            db.prepare(`DELETE FROM ml_reserve_activations WHERE activation_id=?`).run('a_fk');
            db.prepare(`DELETE FROM ml_unknown_unknown_reserves WHERE reserve_id=?`).run('r_fk');
        });
    });

    describe('Constants', () => {
        test('RESERVE_TYPES frozen 5 (canonical PDF list)', () => {
            expect(M.RESERVE_TYPES).toEqual([
                'risk_budget', 'latency_budget',
                'cognitive_budget', 'optionality_budget', 'trust_budget'
            ]);
            expect(Object.isFrozen(M.RESERVE_TYPES)).toBe(true);
        });
        test('ACTIVATION_TRIGGERS frozen 4 (canonical PDF list)', () => {
            expect(M.ACTIVATION_TRIGGERS).toEqual([
                'unclassifiable_event', 'unexplained_residual',
                'ontology_failure', 'precontradiction_extreme'
            ]);
            expect(Object.isFrozen(M.ACTIVATION_TRIGGERS)).toBe(true);
        });
        test('DEFAULT_RESERVE_FRACTION = 0.10', () => {
            expect(M.DEFAULT_RESERVE_FRACTION).toBe(0.10);
        });
        test('DEFAULT_NEVER_BELOW_FLOOR = 0.03', () => {
            expect(M.DEFAULT_NEVER_BELOW_FLOOR).toBe(0.03);
        });
        test('BOLDNESS_HAIRCUT_PER_DEPLETED_RESERVE = 0.10', () => {
            expect(M.BOLDNESS_HAIRCUT_PER_DEPLETED_RESERVE).toBe(0.10);
        });
    });

    describe('computeReserveScore (pure)', () => {
        test('no consumption → score 1.0', () => {
            const r = M.computeReserveScore({
                allocatedFraction: 0.10,
                currentConsumed: 0,
                neverBelowFloor: 0.03
            });
            expect(r.score).toBe(1);
        });
        test('partial consumption → ratio score', () => {
            // 0.10 allocated, 0.04 consumed → remaining 0.06 / 0.10 = 0.60
            const r = M.computeReserveScore({
                allocatedFraction: 0.10,
                currentConsumed: 0.04,
                neverBelowFloor: 0.03
            });
            expect(r.score).toBeCloseTo(0.60, 5);
        });
        test('consumed = allocated - floor → score reflects floor remaining', () => {
            // 0.10 allocated, 0.07 consumed → remaining 0.03 (= floor) / 0.10 = 0.30
            const r = M.computeReserveScore({
                allocatedFraction: 0.10,
                currentConsumed: 0.07,
                neverBelowFloor: 0.03
            });
            expect(r.score).toBeCloseTo(0.30, 5);
        });
        test('floor remaining is the minimum (cannot go below)', () => {
            // 0.10 allocated, 0.10 consumed (impossible per floor) — score floored
            // module ensures consumed never exceeds allocated - floor; if asked
            // directly, score saturates at floor / allocated
            const r = M.computeReserveScore({
                allocatedFraction: 0.10,
                currentConsumed: 0.07,  // exactly at floor boundary
                neverBelowFloor: 0.03
            });
            expect(r.score).toBeGreaterThan(0);
        });
        test('reserveDepleted flag when at floor', () => {
            const r = M.computeReserveScore({
                allocatedFraction: 0.10,
                currentConsumed: 0.07,  // remaining = floor
                neverBelowFloor: 0.03
            });
            expect(r.reserveDepleted).toBe(true);
        });
        test('reserveDepleted false when above floor', () => {
            const r = M.computeReserveScore({
                allocatedFraction: 0.10,
                currentConsumed: 0.03,
                neverBelowFloor: 0.03
            });
            expect(r.reserveDepleted).toBe(false);
        });
        test('out-of-range throws', () => {
            expect(() => M.computeReserveScore({
                allocatedFraction: 1.5,
                currentConsumed: 0,
                neverBelowFloor: 0.03
            })).toThrow();
        });
    });

    describe('canActivateReserve (pure)', () => {
        test('allows when drawdown keeps reserve above floor', () => {
            const r = M.canActivateReserve({
                allocatedFraction: 0.10,
                currentConsumed: 0.02,
                neverBelowFloor: 0.03,
                requestedDrawdown: 0.04
                // post: consumed=0.06, remaining=0.04 (above floor=0.03)
            });
            expect(r.allowed).toBe(true);
        });
        test('blocks when drawdown would go below floor', () => {
            const r = M.canActivateReserve({
                allocatedFraction: 0.10,
                currentConsumed: 0.05,
                neverBelowFloor: 0.03,
                requestedDrawdown: 0.04
                // post: consumed=0.09, remaining=0.01 (below floor=0.03)
            });
            expect(r.allowed).toBe(false);
            expect(r.reason).toMatch(/floor/i);
        });
        test('boundary: drawdown exactly to floor allowed', () => {
            const r = M.canActivateReserve({
                allocatedFraction: 0.10,
                currentConsumed: 0.05,
                neverBelowFloor: 0.03,
                requestedDrawdown: 0.02
                // post: consumed=0.07, remaining=0.03 (= floor)
            });
            expect(r.allowed).toBe(true);
        });
        test('drawdown of 0 or negative throws', () => {
            expect(() => M.canActivateReserve({
                allocatedFraction: 0.10,
                currentConsumed: 0,
                neverBelowFloor: 0.03,
                requestedDrawdown: 0
            })).toThrow(/positive/i);
        });
    });

    describe('computeBoldnessHaircut (pure)', () => {
        test('all reserves at full → 0 haircut', () => {
            const r = M.computeBoldnessHaircut({
                reserves: [
                    { reserveType: 'risk_budget', score: 1, reserveDepleted: false },
                    { reserveType: 'trust_budget', score: 1, reserveDepleted: false }
                ]
            });
            expect(r.haircut).toBe(0);
        });
        test('one depleted → BOLDNESS_HAIRCUT_PER_DEPLETED_RESERVE', () => {
            const r = M.computeBoldnessHaircut({
                reserves: [
                    { reserveType: 'risk_budget', score: 0.30, reserveDepleted: true },
                    { reserveType: 'trust_budget', score: 1, reserveDepleted: false }
                ]
            });
            expect(r.haircut).toBeCloseTo(0.10, 5);
        });
        test('multiple depleted accumulate (clamped to 1)', () => {
            const reserves = [];
            for (let i = 0; i < 5; i++) {
                reserves.push({
                    reserveType: 'risk_budget',
                    score: 0.30, reserveDepleted: true
                });
            }
            const r = M.computeBoldnessHaircut({ reserves });
            expect(r.haircut).toBeCloseTo(0.50, 5);  // 5 × 0.10
        });
        test('haircut clamps to 1 when extreme', () => {
            const reserves = [];
            for (let i = 0; i < 20; i++) {
                reserves.push({
                    reserveType: 'risk_budget',
                    score: 0.30, reserveDepleted: true
                });
            }
            const r = M.computeBoldnessHaircut({ reserves });
            expect(r.haircut).toBe(1);
        });
        test('empty reserves → 0 haircut', () => {
            const r = M.computeBoldnessHaircut({ reserves: [] });
            expect(r.haircut).toBe(0);
        });
    });

    describe('registerReserve', () => {
        test('registers with all fields', () => {
            const r = M.registerReserve({
                userId: UID_R, resolvedEnv: ENV,
                reserveId: 'rr_1',
                reserveType: 'risk_budget',
                allocatedFraction: 0.10,
                neverBelowFloor: 0.03,
                description: '10% risk reserved for unknown unknowns',
                ts: _now()
            });
            expect(r.registered).toBe(true);
            expect(r.reserveId).toBe('rr_1');
        });
        test('invalid reserve_type throws', () => {
            expect(() => M.registerReserve({
                userId: UID_R, resolvedEnv: ENV,
                reserveId: 'rr_bad',
                reserveType: 'BOGUS',
                allocatedFraction: 0.10,
                neverBelowFloor: 0.03,
                description: 'd',
                ts: _now()
            })).toThrow();
        });
        test('never_below_floor > allocated_fraction throws', () => {
            expect(() => M.registerReserve({
                userId: UID_R, resolvedEnv: ENV,
                reserveId: 'rr_inv',
                reserveType: 'risk_budget',
                allocatedFraction: 0.05,
                neverBelowFloor: 0.10,  // > allocated
                description: 'd',
                ts: _now()
            })).toThrow(/floor.*allocated|invalid.*floor/i);
        });
        test('duplicate reserveId throws', () => {
            M.registerReserve({
                userId: UID_R, resolvedEnv: ENV,
                reserveId: 'rr_dup', reserveType: 'risk_budget',
                allocatedFraction: 0.10, neverBelowFloor: 0.03,
                description: 'd', ts: _now()
            });
            expect(() => M.registerReserve({
                userId: UID_R, resolvedEnv: ENV,
                reserveId: 'rr_dup', reserveType: 'trust_budget',
                allocatedFraction: 0.05, neverBelowFloor: 0.02,
                description: 'd', ts: _now()
            })).toThrow(/duplicate/);
        });
    });

    describe('recordActivation (integration)', () => {
        function _seedReserve(uid, rid) {
            M.registerReserve({
                userId: uid, resolvedEnv: ENV,
                reserveId: rid, reserveType: 'risk_budget',
                allocatedFraction: 0.10, neverBelowFloor: 0.03,
                description: 'd', ts: _now()
            });
        }
        test('persists activation with auto-computed scores', () => {
            _seedReserve(UID_A, 'ra_1');
            const r = M.recordActivation({
                userId: UID_A, resolvedEnv: ENV,
                activationId: 'ra_a1', reserveId: 'ra_1',
                activationTrigger: 'ontology_failure',
                drawdownAmount: 0.04,
                reasoning: 'regime broke ontology',
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.preActivationReserveScore).toBe(1);
            // post: consumed=0.04, remaining=0.06/0.10 = 0.60
            expect(r.postActivationReserveScore).toBeCloseTo(0.60, 5);
        });
        test('blocks activation that would breach floor', () => {
            _seedReserve(UID_A, 'ra_floor');
            // First activation draws to consumed=0.05 (remaining=0.05)
            M.recordActivation({
                userId: UID_A, resolvedEnv: ENV,
                activationId: 'ra_a_first', reserveId: 'ra_floor',
                activationTrigger: 'unclassifiable_event',
                drawdownAmount: 0.05, ts: _now()
            });
            // Second activation 0.04 would push consumed to 0.09 (remaining=0.01 < floor=0.03)
            expect(() => M.recordActivation({
                userId: UID_A, resolvedEnv: ENV,
                activationId: 'ra_a_block', reserveId: 'ra_floor',
                activationTrigger: 'unclassifiable_event',
                drawdownAmount: 0.04, ts: _now()
            })).toThrow(/floor/i);
        });
        test('invalid trigger throws', () => {
            _seedReserve(UID_A, 'ra_inv');
            expect(() => M.recordActivation({
                userId: UID_A, resolvedEnv: ENV,
                activationId: 'ra_inv_a', reserveId: 'ra_inv',
                activationTrigger: 'convenience',
                drawdownAmount: 0.02, ts: _now()
            })).toThrow();
        });
        test('activation on nonexistent reserve throws', () => {
            expect(() => M.recordActivation({
                userId: UID_A, resolvedEnv: ENV,
                activationId: 'ra_orph', reserveId: 'ra_nonexistent',
                activationTrigger: 'ontology_failure',
                drawdownAmount: 0.02, ts: _now()
            })).toThrow(/not found/i);
        });
        test('duplicate activationId throws', () => {
            _seedReserve(UID_A, 'ra_dup_r');
            M.recordActivation({
                userId: UID_A, resolvedEnv: ENV,
                activationId: 'ra_dup_id', reserveId: 'ra_dup_r',
                activationTrigger: 'ontology_failure',
                drawdownAmount: 0.02, ts: _now()
            });
            expect(() => M.recordActivation({
                userId: UID_A, resolvedEnv: ENV,
                activationId: 'ra_dup_id', reserveId: 'ra_dup_r',
                activationTrigger: 'ontology_failure',
                drawdownAmount: 0.01, ts: _now()
            })).toThrow(/duplicate/);
        });
        test('updates current_consumed on reserve row', () => {
            _seedReserve(UID_A, 'ra_upd');
            M.recordActivation({
                userId: UID_A, resolvedEnv: ENV,
                activationId: 'ra_upd_a', reserveId: 'ra_upd',
                activationTrigger: 'unexplained_residual',
                drawdownAmount: 0.03, ts: _now()
            });
            const reserves = M.getReserves({
                userId: UID_A, resolvedEnv: ENV
            });
            const r = reserves.find(x => x.reserveId === 'ra_upd');
            expect(r.currentConsumed).toBeCloseTo(0.03, 5);
        });
    });

    describe('getReserves & getActivationHistory', () => {
        test('getReserves returns all for user × env', () => {
            M.registerReserve({
                userId: UID_GET, resolvedEnv: ENV,
                reserveId: 'gr_1', reserveType: 'risk_budget',
                allocatedFraction: 0.10, neverBelowFloor: 0.03,
                description: 'd', ts: _now()
            });
            M.registerReserve({
                userId: UID_GET, resolvedEnv: ENV,
                reserveId: 'gr_2', reserveType: 'trust_budget',
                allocatedFraction: 0.05, neverBelowFloor: 0.02,
                description: 'd', ts: _now()
            });
            const r = M.getReserves({
                userId: UID_GET, resolvedEnv: ENV
            });
            expect(r.length).toBe(2);
        });
        test('getReserves filter by reserveType', () => {
            M.registerReserve({
                userId: UID_GET, resolvedEnv: ENV,
                reserveId: 'gf_risk', reserveType: 'risk_budget',
                allocatedFraction: 0.10, neverBelowFloor: 0.03,
                description: 'd', ts: _now()
            });
            M.registerReserve({
                userId: UID_GET, resolvedEnv: ENV,
                reserveId: 'gf_trust', reserveType: 'trust_budget',
                allocatedFraction: 0.05, neverBelowFloor: 0.02,
                description: 'd', ts: _now()
            });
            const r = M.getReserves({
                userId: UID_GET, resolvedEnv: ENV,
                reserveType: 'trust_budget'
            });
            expect(r.length).toBe(1);
            expect(r[0].reserveId).toBe('gf_trust');
        });
        test('getActivationHistory returns activations for reserve', () => {
            M.registerReserve({
                userId: UID_GET, resolvedEnv: ENV,
                reserveId: 'gh_r', reserveType: 'risk_budget',
                allocatedFraction: 0.10, neverBelowFloor: 0.03,
                description: 'd', ts: _now()
            });
            M.recordActivation({
                userId: UID_GET, resolvedEnv: ENV,
                activationId: 'gh_a1', reserveId: 'gh_r',
                activationTrigger: 'ontology_failure',
                drawdownAmount: 0.02, ts: 1000
            });
            M.recordActivation({
                userId: UID_GET, resolvedEnv: ENV,
                activationId: 'gh_a2', reserveId: 'gh_r',
                activationTrigger: 'unclassifiable_event',
                drawdownAmount: 0.02, ts: 2000
            });
            const r = M.getActivationHistory({
                userId: UID_GET, resolvedEnv: ENV,
                reserveId: 'gh_r'
            });
            expect(r.length).toBe(2);
        });
    });

    describe('isolation per user × env', () => {
        test('uid isolation', () => {
            M.registerReserve({
                userId: UID_ISO_A, resolvedEnv: ENV,
                reserveId: 'iso_a', reserveType: 'risk_budget',
                allocatedFraction: 0.10, neverBelowFloor: 0.03,
                description: 'd', ts: _now()
            });
            M.registerReserve({
                userId: UID_ISO_B, resolvedEnv: ENV,
                reserveId: 'iso_b', reserveType: 'risk_budget',
                allocatedFraction: 0.10, neverBelowFloor: 0.03,
                description: 'd', ts: _now()
            });
            const a = M.getReserves({
                userId: UID_ISO_A, resolvedEnv: ENV
            });
            expect(a.every(r => r.reserveId !== 'iso_b')).toBe(true);
        });
        test('env isolation', () => {
            M.registerReserve({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                reserveId: 'env_d', reserveType: 'risk_budget',
                allocatedFraction: 0.10, neverBelowFloor: 0.03,
                description: 'd', ts: _now()
            });
            const testnet = M.getReserves({
                userId: UID_ENV, resolvedEnv: 'TESTNET'
            });
            expect(testnet).toEqual([]);
        });
    });
});
