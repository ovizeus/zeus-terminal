'use strict';

/**
 * OMEGA §139 TEMPORAL COMMITMENT LEDGER / PROMISE-TO-SELF CONSISTENCY.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt lines 4138-4180.
 *
 * "mi-am incalcat propria promisiune strategica pentru un impuls tactic?"
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p139-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/_meta/temporalCommitmentLedger');

const UID = 9139;
const UID_VIO = 9239;
const UID_FULFILL = 9339;
const UID_EXP = 9439;
const UID_ACT = 9539;
const UID_CONS = 9639;
const UID_ISO_A = 9739;
const UID_ISO_B = 9839;
const UID_ENV = 9939;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    const uids = [UID, UID_VIO, UID_FULFILL, UID_EXP, UID_ACT, UID_CONS,
                  UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_temporal_commitments WHERE user_id IN (${placeholders})`).run(...uids);
    db.prepare(`DELETE FROM ml_commitment_violations WHERE user_id IN (${placeholders})`).run(...uids);
}

beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §139 TEMPORAL COMMITMENT LEDGER', () => {

    describe('Migrations 263+264', () => {
        test('263_ml_temporal_commitments migration applied', () => {
            expect(db.prepare(
                "SELECT name FROM _migrations WHERE name = ?"
            ).get('263_ml_temporal_commitments')).toBeTruthy();
        });

        test('264_ml_commitment_violations migration applied', () => {
            expect(db.prepare(
                "SELECT name FROM _migrations WHERE name = ?"
            ).get('264_ml_commitment_violations')).toBeTruthy();
        });

        test('commitment_id UNIQUE enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_temporal_commitments
                (user_id, resolved_env, commitment_id, commitment_kind,
                 title, description, parameters_json, strength_level,
                 start_ts, expires_ts, status, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            stmt.run(UID, ENV, 'p139_c_dup', 'no_altcoins_until',
                't', 'd', '{}', 'soft', 1000, 2000, 'active', _now());
            expect(() => stmt.run(UID, ENV, 'p139_c_dup',
                'no_trade_before_event', 't2', 'd2', '{}',
                'medium', 1000, 2000, 'active', _now())).toThrow();
        });

        test('commitment_kind CHECK enum enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_temporal_commitments
                (user_id, resolved_env, commitment_id, commitment_kind,
                 title, description, parameters_json, strength_level,
                 start_ts, expires_ts, status, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p139_bad_kind',
                'BOGUS_KIND', 't', 'd', '{}', 'soft',
                1000, null, 'active', _now())).toThrow();
        });

        test('strength_level CHECK enum enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_temporal_commitments
                (user_id, resolved_env, commitment_id, commitment_kind,
                 title, description, parameters_json, strength_level,
                 start_ts, expires_ts, status, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p139_bad_strength',
                'custom', 't', 'd', '{}', 'BOGUS',
                1000, null, 'active', _now())).toThrow();
        });

        test('status CHECK enum enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_temporal_commitments
                (user_id, resolved_env, commitment_id, commitment_kind,
                 title, description, parameters_json, strength_level,
                 start_ts, expires_ts, status, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p139_bad_status',
                'custom', 't', 'd', '{}', 'soft',
                1000, null, 'BOGUS', _now())).toThrow();
        });

        test('violation_kind CHECK enum enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_commitment_violations
                (user_id, resolved_env, violation_id, commitment_id,
                 violation_kind, override_justification,
                 epistemic_cost, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p139_bad_vk',
                'c1', 'BOGUS', '', 0.5, _now())).toThrow();
        });

        test('epistemic_cost CHECK range enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_commitment_violations
                (user_id, resolved_env, violation_id, commitment_id,
                 violation_kind, override_justification,
                 epistemic_cost, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p139_bad_ec',
                'c1', 'unjustified', '', 1.5, _now())).toThrow();
        });
    });

    describe('Constants', () => {
        test('COMMITMENT_KINDS frozen 6 canonical', () => {
            expect(M.COMMITMENT_KINDS).toEqual([
                'no_altcoins_until', 'no_trade_before_event',
                'max_long_exposure', 'observer_until_regime_clarified',
                'reduced_size_until_reconciliation', 'custom'
            ]);
            expect(Object.isFrozen(M.COMMITMENT_KINDS)).toBe(true);
        });

        test('STRENGTH_LEVELS frozen 3 entries', () => {
            expect(M.STRENGTH_LEVELS).toEqual(['soft', 'medium', 'hard']);
            expect(Object.isFrozen(M.STRENGTH_LEVELS)).toBe(true);
        });

        test('STATUSES frozen 4 entries', () => {
            expect(M.STATUSES).toEqual([
                'active', 'fulfilled', 'violated', 'expired'
            ]);
            expect(Object.isFrozen(M.STATUSES)).toBe(true);
        });

        test('VIOLATION_KINDS frozen 3 entries', () => {
            expect(M.VIOLATION_KINDS).toEqual([
                'unjustified', 'justified_override', 'partial'
            ]);
            expect(Object.isFrozen(M.VIOLATION_KINDS)).toBe(true);
        });

        test('EPISTEMIC_COST_MAP 3x3 matrix', () => {
            expect(M.EPISTEMIC_COST_MAP.unjustified.soft).toBe(0.20);
            expect(M.EPISTEMIC_COST_MAP.unjustified.medium).toBe(0.40);
            expect(M.EPISTEMIC_COST_MAP.unjustified.hard).toBe(0.70);
            expect(M.EPISTEMIC_COST_MAP.justified_override.soft).toBe(0.05);
            expect(M.EPISTEMIC_COST_MAP.justified_override.medium).toBe(0.15);
            expect(M.EPISTEMIC_COST_MAP.justified_override.hard).toBe(0.30);
            expect(M.EPISTEMIC_COST_MAP.partial.soft).toBe(0.10);
            expect(M.EPISTEMIC_COST_MAP.partial.medium).toBe(0.20);
            expect(M.EPISTEMIC_COST_MAP.partial.hard).toBe(0.40);
        });

        test('MIN_JUSTIFICATION_LENGTH ascending by strength', () => {
            expect(M.MIN_JUSTIFICATION_LENGTH.soft).toBe(10);
            expect(M.MIN_JUSTIFICATION_LENGTH.medium).toBe(30);
            expect(M.MIN_JUSTIFICATION_LENGTH.hard).toBe(80);
        });
    });

    describe('computeEpistemicCost (pure)', () => {
        test('unjustified × hard → 0.70 (max penalty)', () => {
            expect(M.computeEpistemicCost({
                violationKind: 'unjustified',
                strengthLevel: 'hard'
            }).epistemicCost).toBe(0.70);
        });

        test('justified_override × soft → 0.05 (min penalty)', () => {
            expect(M.computeEpistemicCost({
                violationKind: 'justified_override',
                strengthLevel: 'soft'
            }).epistemicCost).toBe(0.05);
        });

        test('partial × medium → 0.20', () => {
            expect(M.computeEpistemicCost({
                violationKind: 'partial',
                strengthLevel: 'medium'
            }).epistemicCost).toBe(0.20);
        });

        test('invalid violationKind throws', () => {
            expect(() => M.computeEpistemicCost({
                violationKind: 'BOGUS',
                strengthLevel: 'soft'
            })).toThrow(/invalid violationKind/);
        });

        test('invalid strengthLevel throws', () => {
            expect(() => M.computeEpistemicCost({
                violationKind: 'unjustified',
                strengthLevel: 'BOGUS'
            })).toThrow(/invalid strengthLevel/);
        });
    });

    describe('assessOverrideJustification (pure)', () => {
        test('empty justification → insufficient', () => {
            const r = M.assessOverrideJustification({
                justificationText: '',
                strengthLevel: 'soft'
            });
            expect(r.sufficient).toBe(false);
        });

        test('soft requires ≥ 10 chars', () => {
            expect(M.assessOverrideJustification({
                justificationText: 'short',
                strengthLevel: 'soft'
            }).sufficient).toBe(false);
            expect(M.assessOverrideJustification({
                justificationText: 'long enough text',
                strengthLevel: 'soft'
            }).sufficient).toBe(true);
        });

        test('medium requires ≥ 30 chars', () => {
            expect(M.assessOverrideJustification({
                justificationText: 'short text under thirty',
                strengthLevel: 'medium'
            }).sufficient).toBe(false);
            expect(M.assessOverrideJustification({
                justificationText: 'this justification text is sufficiently long for medium strength override',
                strengthLevel: 'medium'
            }).sufficient).toBe(true);
        });

        test('hard requires ≥ 80 chars', () => {
            expect(M.assessOverrideJustification({
                justificationText: 'a'.repeat(50),
                strengthLevel: 'hard'
            }).sufficient).toBe(false);
            expect(M.assessOverrideJustification({
                justificationText: 'a'.repeat(100),
                strengthLevel: 'hard'
            }).sufficient).toBe(true);
        });

        test('invalid strengthLevel throws', () => {
            expect(() => M.assessOverrideJustification({
                justificationText: 'test',
                strengthLevel: 'BOGUS'
            })).toThrow();
        });
    });

    describe('isExpired (pure)', () => {
        test('expiresTs ≤ currentTs → true', () => {
            expect(M.isExpired({
                expiresTs: 1000, currentTs: 2000
            }).expired).toBe(true);
        });

        test('expiresTs > currentTs → false', () => {
            expect(M.isExpired({
                expiresTs: 2000, currentTs: 1000
            }).expired).toBe(false);
        });

        test('null expiresTs → never expires', () => {
            expect(M.isExpired({
                expiresTs: null, currentTs: 99999
            }).expired).toBe(false);
        });
    });

    describe('computeConsistencyScore (pure)', () => {
        test('all fulfilled → 1.0', () => {
            const r = M.computeConsistencyScore({
                fulfilledCount: 5,
                violatedCount: 0
            });
            expect(r.consistencyScore).toBe(1.0);
        });

        test('all violated → 0.0', () => {
            const r = M.computeConsistencyScore({
                fulfilledCount: 0,
                violatedCount: 5
            });
            expect(r.consistencyScore).toBe(0);
        });

        test('mixed 3 fulfilled 1 violated → 0.75', () => {
            const r = M.computeConsistencyScore({
                fulfilledCount: 3,
                violatedCount: 1
            });
            expect(r.consistencyScore).toBe(0.75);
        });

        test('zero total → 1.0 (no commitments = no inconsistency)', () => {
            const r = M.computeConsistencyScore({
                fulfilledCount: 0,
                violatedCount: 0
            });
            expect(r.consistencyScore).toBe(1.0);
        });
    });

    describe('registerCommitment', () => {
        test('persists commitment with active status', () => {
            const r = M.registerCommitment({
                userId: UID, resolvedEnv: ENV,
                commitmentId: 'p139_reg_1',
                commitmentKind: 'no_altcoins_until',
                title: 'No alts until BTC > $100k',
                description: 'Risk discipline',
                parameters: { until_price: 100000 },
                strengthLevel: 'hard',
                startTs: 1000,
                expiresTs: 5000,
                ts: 1000
            });
            expect(r.registered).toBe(true);
            expect(r.status).toBe('active');
        });

        test('duplicate commitmentId throws', () => {
            M.registerCommitment({
                userId: UID, resolvedEnv: ENV,
                commitmentId: 'p139_reg_dup',
                commitmentKind: 'custom',
                title: 't', description: 'd',
                parameters: {}, strengthLevel: 'soft',
                startTs: 1000, ts: 1000
            });
            expect(() => M.registerCommitment({
                userId: UID, resolvedEnv: ENV,
                commitmentId: 'p139_reg_dup',
                commitmentKind: 'custom',
                title: 't2', description: 'd2',
                parameters: {}, strengthLevel: 'medium',
                startTs: 1000, ts: 1000
            })).toThrow(/duplicate/);
        });

        test('invalid commitmentKind throws', () => {
            expect(() => M.registerCommitment({
                userId: UID, resolvedEnv: ENV,
                commitmentId: 'p139_reg_bad_kind',
                commitmentKind: 'BOGUS',
                title: 't', description: 'd',
                parameters: {}, strengthLevel: 'soft',
                startTs: 1000, ts: 1000
            })).toThrow(/invalid commitmentKind/);
        });

        test('invalid strengthLevel throws', () => {
            expect(() => M.registerCommitment({
                userId: UID, resolvedEnv: ENV,
                commitmentId: 'p139_reg_bad_strength',
                commitmentKind: 'custom',
                title: 't', description: 'd',
                parameters: {}, strengthLevel: 'BOGUS',
                startTs: 1000, ts: 1000
            })).toThrow(/invalid strengthLevel/);
        });
    });

    describe('recordViolation', () => {
        test('unjustified violation persists + updates status', () => {
            M.registerCommitment({
                userId: UID_VIO, resolvedEnv: ENV,
                commitmentId: 'p139_vio_unjust',
                commitmentKind: 'observer_until_regime_clarified',
                title: 'Observer mode',
                description: 'No trades',
                parameters: {}, strengthLevel: 'medium',
                startTs: 1000, ts: 1000
            });
            const r = M.recordViolation({
                userId: UID_VIO, resolvedEnv: ENV,
                violationId: 'p139_v_unjust',
                commitmentId: 'p139_vio_unjust',
                violationKind: 'unjustified',
                overrideJustification: '',
                ts: 2000
            });
            expect(r.recorded).toBe(true);
            expect(r.epistemicCost).toBe(0.40);  // medium × unjustified

            const c = M.getCommitmentById({
                userId: UID_VIO, resolvedEnv: ENV,
                commitmentId: 'p139_vio_unjust'
            });
            expect(c.status).toBe('violated');
        });

        test('justified_override requires sufficient justification', () => {
            M.registerCommitment({
                userId: UID_VIO, resolvedEnv: ENV,
                commitmentId: 'p139_vio_just_short',
                commitmentKind: 'custom',
                title: 't', description: 'd',
                parameters: {}, strengthLevel: 'hard',
                startTs: 1000, ts: 1000
            });
            // hard requires 80+ chars
            expect(() => M.recordViolation({
                userId: UID_VIO, resolvedEnv: ENV,
                violationId: 'p139_v_short',
                commitmentId: 'p139_vio_just_short',
                violationKind: 'justified_override',
                overrideJustification: 'short',
                ts: 2000
            })).toThrow(/insufficient justification/);
        });

        test('justified_override with sufficient text persists', () => {
            M.registerCommitment({
                userId: UID_VIO, resolvedEnv: ENV,
                commitmentId: 'p139_vio_just_ok',
                commitmentKind: 'custom',
                title: 't', description: 'd',
                parameters: {}, strengthLevel: 'soft',
                startTs: 1000, ts: 1000
            });
            const r = M.recordViolation({
                userId: UID_VIO, resolvedEnv: ENV,
                violationId: 'p139_v_just_ok',
                commitmentId: 'p139_vio_just_ok',
                violationKind: 'justified_override',
                overrideJustification: 'macro shock major reversal needed',
                ts: 2000
            });
            expect(r.recorded).toBe(true);
            expect(r.epistemicCost).toBe(0.05);  // soft × justified_override
        });

        test('partial violation persists', () => {
            M.registerCommitment({
                userId: UID_VIO, resolvedEnv: ENV,
                commitmentId: 'p139_vio_partial',
                commitmentKind: 'max_long_exposure',
                title: 't', description: 'd',
                parameters: { max_pct: 50 }, strengthLevel: 'medium',
                startTs: 1000, ts: 1000
            });
            const r = M.recordViolation({
                userId: UID_VIO, resolvedEnv: ENV,
                violationId: 'p139_v_partial',
                commitmentId: 'p139_vio_partial',
                violationKind: 'partial',
                overrideJustification: 'exceeded by 5%',
                ts: 2000
            });
            expect(r.epistemicCost).toBe(0.20);  // medium × partial
        });

        test('missing commitment throws', () => {
            expect(() => M.recordViolation({
                userId: UID_VIO, resolvedEnv: ENV,
                violationId: 'p139_v_orphan',
                commitmentId: 'p139_NONEXISTENT',
                violationKind: 'unjustified',
                overrideJustification: '',
                ts: _now()
            })).toThrow(/not found/);
        });

        test('duplicate violationId throws', () => {
            M.registerCommitment({
                userId: UID_VIO, resolvedEnv: ENV,
                commitmentId: 'p139_vio_dup_c',
                commitmentKind: 'custom',
                title: 't', description: 'd',
                parameters: {}, strengthLevel: 'soft',
                startTs: 1000, ts: 1000
            });
            M.recordViolation({
                userId: UID_VIO, resolvedEnv: ENV,
                violationId: 'p139_v_dup',
                commitmentId: 'p139_vio_dup_c',
                violationKind: 'unjustified',
                overrideJustification: '', ts: 2000
            });
            // Register another commitment to test duplicate violationId
            M.registerCommitment({
                userId: UID_VIO, resolvedEnv: ENV,
                commitmentId: 'p139_vio_dup_c2',
                commitmentKind: 'custom',
                title: 't', description: 'd',
                parameters: {}, strengthLevel: 'soft',
                startTs: 1000, ts: 1000
            });
            expect(() => M.recordViolation({
                userId: UID_VIO, resolvedEnv: ENV,
                violationId: 'p139_v_dup',
                commitmentId: 'p139_vio_dup_c2',
                violationKind: 'unjustified',
                overrideJustification: '', ts: 3000
            })).toThrow(/duplicate/);
        });
    });

    describe('fulfillCommitment', () => {
        test('marks active commitment as fulfilled', () => {
            M.registerCommitment({
                userId: UID_FULFILL, resolvedEnv: ENV,
                commitmentId: 'p139_ff_1',
                commitmentKind: 'custom',
                title: 't', description: 'd',
                parameters: {}, strengthLevel: 'medium',
                startTs: 1000, ts: 1000
            });
            const r = M.fulfillCommitment({
                userId: UID_FULFILL, resolvedEnv: ENV,
                commitmentId: 'p139_ff_1',
                ts: 5000
            });
            expect(r.fulfilled).toBe(true);
            const c = M.getCommitmentById({
                userId: UID_FULFILL, resolvedEnv: ENV,
                commitmentId: 'p139_ff_1'
            });
            expect(c.status).toBe('fulfilled');
        });

        test('non-active commitment cannot be fulfilled', () => {
            M.registerCommitment({
                userId: UID_FULFILL, resolvedEnv: ENV,
                commitmentId: 'p139_ff_violated',
                commitmentKind: 'custom',
                title: 't', description: 'd',
                parameters: {}, strengthLevel: 'soft',
                startTs: 1000, ts: 1000
            });
            M.recordViolation({
                userId: UID_FULFILL, resolvedEnv: ENV,
                violationId: 'p139_ff_v',
                commitmentId: 'p139_ff_violated',
                violationKind: 'unjustified',
                overrideJustification: '', ts: 2000
            });
            expect(() => M.fulfillCommitment({
                userId: UID_FULFILL, resolvedEnv: ENV,
                commitmentId: 'p139_ff_violated',
                ts: 3000
            })).toThrow(/not active|already/);
        });

        test('missing commitment throws', () => {
            expect(() => M.fulfillCommitment({
                userId: UID_FULFILL, resolvedEnv: ENV,
                commitmentId: 'p139_NONEXISTENT',
                ts: _now()
            })).toThrow(/not found/);
        });
    });

    describe('expireCommitment', () => {
        test('marks active commitment as expired when ts ≥ expires_ts', () => {
            M.registerCommitment({
                userId: UID_EXP, resolvedEnv: ENV,
                commitmentId: 'p139_exp_1',
                commitmentKind: 'custom',
                title: 't', description: 'd',
                parameters: {}, strengthLevel: 'soft',
                startTs: 1000, expiresTs: 2000, ts: 1000
            });
            const r = M.expireCommitment({
                userId: UID_EXP, resolvedEnv: ENV,
                commitmentId: 'p139_exp_1',
                ts: 3000
            });
            expect(r.expired).toBe(true);
        });

        test('before expires_ts → blocked', () => {
            M.registerCommitment({
                userId: UID_EXP, resolvedEnv: ENV,
                commitmentId: 'p139_exp_early',
                commitmentKind: 'custom',
                title: 't', description: 'd',
                parameters: {}, strengthLevel: 'soft',
                startTs: 1000, expiresTs: 5000, ts: 1000
            });
            expect(() => M.expireCommitment({
                userId: UID_EXP, resolvedEnv: ENV,
                commitmentId: 'p139_exp_early',
                ts: 2000
            })).toThrow(/not yet|before/i);
        });

        test('no expires_ts (permanent) → cannot expire', () => {
            M.registerCommitment({
                userId: UID_EXP, resolvedEnv: ENV,
                commitmentId: 'p139_exp_permanent',
                commitmentKind: 'custom',
                title: 't', description: 'd',
                parameters: {}, strengthLevel: 'soft',
                startTs: 1000, ts: 1000
            });
            expect(() => M.expireCommitment({
                userId: UID_EXP, resolvedEnv: ENV,
                commitmentId: 'p139_exp_permanent',
                ts: 99999
            })).toThrow(/no expir|permanent/i);
        });
    });

    describe('getActiveCommitments', () => {
        test('returns only active commitments', () => {
            const u = UID_ACT;
            for (let i = 0; i < 3; i++) {
                M.registerCommitment({
                    userId: u, resolvedEnv: ENV,
                    commitmentId: `p139_act_${i}`,
                    commitmentKind: 'custom',
                    title: 't', description: 'd',
                    parameters: {}, strengthLevel: 'soft',
                    startTs: 1000, ts: 1000 + i
                });
            }
            M.fulfillCommitment({
                userId: u, resolvedEnv: ENV,
                commitmentId: 'p139_act_1', ts: 5000
            });
            const rows = M.getActiveCommitments({
                userId: u, resolvedEnv: ENV, limit: 10
            });
            expect(rows.length).toBe(2);
            expect(rows.every(c => c.status === 'active')).toBe(true);
        });
    });

    describe('getCommitmentById', () => {
        test('returns commitment or null', () => {
            M.registerCommitment({
                userId: UID, resolvedEnv: ENV,
                commitmentId: 'p139_get_1',
                commitmentKind: 'reduced_size_until_reconciliation',
                title: 't', description: 'd',
                parameters: { mult: 0.5 },
                strengthLevel: 'medium',
                startTs: 1000, ts: 1000
            });
            const r = M.getCommitmentById({
                userId: UID, resolvedEnv: ENV,
                commitmentId: 'p139_get_1'
            });
            expect(r).not.toBeNull();
            expect(r.commitmentKind).toBe('reduced_size_until_reconciliation');
            expect(r.parameters).toEqual({ mult: 0.5 });

            const none = M.getCommitmentById({
                userId: UID, resolvedEnv: ENV,
                commitmentId: 'NONEXISTENT'
            });
            expect(none).toBeNull();
        });
    });

    describe('getConsistencyScore (integration)', () => {
        test('3 fulfilled 1 violated → 0.75', () => {
            const u = UID_CONS;
            for (let i = 0; i < 3; i++) {
                M.registerCommitment({
                    userId: u, resolvedEnv: ENV,
                    commitmentId: `p139_cons_f_${i}`,
                    commitmentKind: 'custom',
                    title: 't', description: 'd',
                    parameters: {}, strengthLevel: 'soft',
                    startTs: 1000, ts: 1000 + i
                });
                M.fulfillCommitment({
                    userId: u, resolvedEnv: ENV,
                    commitmentId: `p139_cons_f_${i}`,
                    ts: 2000 + i
                });
            }
            M.registerCommitment({
                userId: u, resolvedEnv: ENV,
                commitmentId: 'p139_cons_v',
                commitmentKind: 'custom',
                title: 't', description: 'd',
                parameters: {}, strengthLevel: 'soft',
                startTs: 1000, ts: 1500
            });
            M.recordViolation({
                userId: u, resolvedEnv: ENV,
                violationId: 'p139_cons_v_v',
                commitmentId: 'p139_cons_v',
                violationKind: 'unjustified',
                overrideJustification: '',
                ts: 2500
            });
            const r = M.getConsistencyScore({
                userId: u, resolvedEnv: ENV, sinceTs: 500
            });
            expect(r.consistencyScore).toBe(0.75);
            expect(r.fulfilledCount).toBe(3);
            expect(r.violatedCount).toBe(1);
        });

        test('no commitments → 1.0 (no inconsistency)', () => {
            const r = M.getConsistencyScore({
                userId: UID_CONS, resolvedEnv: ENV, sinceTs: 999999999
            });
            expect(r.consistencyScore).toBe(1.0);
        });
    });

    describe('isolation per user × env', () => {
        test('uid A cannot see uid B commitments', () => {
            M.registerCommitment({
                userId: UID_ISO_A, resolvedEnv: ENV,
                commitmentId: 'p139_iso_a',
                commitmentKind: 'custom',
                title: 't', description: 'd',
                parameters: {}, strengthLevel: 'soft',
                startTs: 1000, ts: 1000
            });
            M.registerCommitment({
                userId: UID_ISO_B, resolvedEnv: ENV,
                commitmentId: 'p139_iso_b',
                commitmentKind: 'custom',
                title: 't', description: 'd',
                parameters: {}, strengthLevel: 'soft',
                startTs: 1000, ts: 1000
            });
            const rows = M.getActiveCommitments({
                userId: UID_ISO_A, resolvedEnv: ENV, limit: 10
            });
            expect(rows.every(c => c.commitmentId !== 'p139_iso_b')).toBe(true);
        });

        test('DEMO env cannot see TESTNET env', () => {
            M.registerCommitment({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                commitmentId: 'p139_env_demo',
                commitmentKind: 'custom',
                title: 't', description: 'd',
                parameters: {}, strengthLevel: 'soft',
                startTs: 1000, ts: 1000
            });
            M.registerCommitment({
                userId: UID_ENV, resolvedEnv: 'TESTNET',
                commitmentId: 'p139_env_testnet',
                commitmentKind: 'custom',
                title: 't', description: 'd',
                parameters: {}, strengthLevel: 'soft',
                startTs: 1000, ts: 1000
            });
            const rows = M.getActiveCommitments({
                userId: UID_ENV, resolvedEnv: 'DEMO', limit: 10
            });
            expect(rows.every(c => c.commitmentId !== 'p139_env_testnet')).toBe(true);
        });
    });
});
