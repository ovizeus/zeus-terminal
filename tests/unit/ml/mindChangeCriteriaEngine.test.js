'use strict';

/**
 * OMEGA §130 MIND-CHANGE CRITERIA ENGINE / WHAT-WOULD-CONVINCE-ME LAYER.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt lines 3761-3791.
 *
 * "ce anume m-ar convinge ca ma insel?"
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p130-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/_meta/mindChangeCriteriaEngine');

const UID = 9130;
const UID_BELIEF = 9230;
const UID_EVENT = 9330;
const UID_HIST = 9430;
const UID_ISO_A = 9530;
const UID_ISO_B = 9630;
const UID_ENV = 9730;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    const uids = [UID, UID_BELIEF, UID_EVENT, UID_HIST,
                  UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_mind_change_criteria WHERE user_id IN (${placeholders})`).run(...uids);
    db.prepare(`DELETE FROM ml_mind_change_events WHERE user_id IN (${placeholders})`).run(...uids);
}

beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §130 MIND-CHANGE CRITERIA ENGINE', () => {

    describe('Migrations 249+250', () => {
        test('249_ml_mind_change_criteria migration applied', () => {
            const row = db.prepare(
                "SELECT name FROM _migrations WHERE name = ?"
            ).get('249_ml_mind_change_criteria');
            expect(row).toBeTruthy();
        });

        test('250_ml_mind_change_events migration applied', () => {
            const row = db.prepare(
                "SELECT name FROM _migrations WHERE name = ?"
            ).get('250_ml_mind_change_events');
            expect(row).toBeTruthy();
        });

        test('criterion_id UNIQUE enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_mind_change_criteria
                (user_id, resolved_env, criterion_id, belief_id,
                 reversal_action, trigger_condition, evidence_threshold,
                 inertia_factor, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            stmt.run(UID, ENV, 'p130_c_dup', 'b1', 'weakening',
                     'X happens', 0.5, 0.2, _now());
            expect(() => stmt.run(UID, ENV, 'p130_c_dup', 'b2', 'flipping',
                'Y happens', 0.6, 0.3, _now())).toThrow();
        });

        test('reversal_action CHECK enum enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_mind_change_criteria
                (user_id, resolved_env, criterion_id, belief_id,
                 reversal_action, trigger_condition, evidence_threshold,
                 inertia_factor, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p130_c_bad_action', 'b1',
                'BOGUS', 'cond', 0.5, 0.2, _now())).toThrow();
        });

        test('evidence_threshold CHECK range enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_mind_change_criteria
                (user_id, resolved_env, criterion_id, belief_id,
                 reversal_action, trigger_condition, evidence_threshold,
                 inertia_factor, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p130_c_bad_th', 'b1',
                'weakening', 'cond', 1.5, 0.2, _now())).toThrow();
        });

        test('reversal_executed CHECK 0/1 enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_mind_change_events
                (user_id, resolved_env, event_id, criterion_id,
                 actual_evidence, surprise_score, reversal_executed, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p130_e_bad', 'c1',
                0.5, 0.5, 2, _now())).toThrow();
        });
    });

    describe('Constants', () => {
        test('REVERSAL_ACTIONS frozen 4 canonical', () => {
            expect(M.REVERSAL_ACTIONS).toEqual([
                'weakening', 'flipping', 'abandoning', 'escalating'
            ]);
            expect(Object.isFrozen(M.REVERSAL_ACTIONS)).toBe(true);
        });

        test('SURPRISE_THRESHOLD = 0.70', () => {
            expect(M.SURPRISE_THRESHOLD).toBe(0.70);
        });

        test('INERTIA_LEVELS frozen 3 entries', () => {
            expect(M.INERTIA_LEVELS).toEqual(['volatile', 'balanced', 'rigid']);
            expect(Object.isFrozen(M.INERTIA_LEVELS)).toBe(true);
        });

        test('INERTIA_THRESHOLDS ordered', () => {
            expect(M.INERTIA_THRESHOLDS.volatile).toBe(0.30);
            expect(M.INERTIA_THRESHOLDS.rigid).toBe(0.70);
            expect(M.INERTIA_THRESHOLDS.volatile)
                .toBeLessThan(M.INERTIA_THRESHOLDS.rigid);
        });
    });

    describe('computeSurpriseScore (pure)', () => {
        test('actual == threshold → 0', () => {
            const r = M.computeSurpriseScore({
                actualEvidence: 0.5, evidenceThreshold: 0.5
            });
            expect(r.surpriseScore).toBe(0);
        });

        test('actual >> threshold → clamped 1', () => {
            const r = M.computeSurpriseScore({
                actualEvidence: 2.0, evidenceThreshold: 0.5
            });
            expect(r.surpriseScore).toBe(1);
        });

        test('actual below threshold → 0', () => {
            const r = M.computeSurpriseScore({
                actualEvidence: 0.2, evidenceThreshold: 0.5
            });
            expect(r.surpriseScore).toBe(0);
        });

        test('actual = 2 × threshold (with threshold=0.5) → 1.0', () => {
            // (1.0 - 0.5) / 0.5 = 1.0
            const r = M.computeSurpriseScore({
                actualEvidence: 1.0, evidenceThreshold: 0.5
            });
            expect(r.surpriseScore).toBeCloseTo(1.0, 6);
        });

        test('actual = 1.5 × threshold (with threshold=0.5) → 0.5', () => {
            // (0.75 - 0.5) / 0.5 = 0.5
            const r = M.computeSurpriseScore({
                actualEvidence: 0.75, evidenceThreshold: 0.5
            });
            expect(r.surpriseScore).toBeCloseTo(0.5, 6);
        });

        test('threshold = 0 → uses epsilon (no division by zero)', () => {
            const r = M.computeSurpriseScore({
                actualEvidence: 0.5, evidenceThreshold: 0
            });
            expect(r.surpriseScore).toBe(1);
        });
    });

    describe('shouldExecuteReversal (pure)', () => {
        test('actual ≥ threshold, no inertia → true', () => {
            const r = M.shouldExecuteReversal({
                actualEvidence: 0.6, evidenceThreshold: 0.5,
                inertiaFactor: 0
            });
            expect(r.shouldReverse).toBe(true);
        });

        test('actual < threshold → false', () => {
            const r = M.shouldExecuteReversal({
                actualEvidence: 0.4, evidenceThreshold: 0.5,
                inertiaFactor: 0
            });
            expect(r.shouldReverse).toBe(false);
        });

        test('inertia raises effective threshold', () => {
            // threshold=0.5, inertia=0.5 → effective=0.75
            // actual=0.7 → false (below 0.75)
            const r1 = M.shouldExecuteReversal({
                actualEvidence: 0.7, evidenceThreshold: 0.5,
                inertiaFactor: 0.5
            });
            expect(r1.shouldReverse).toBe(false);
            // actual=0.8 → true (above 0.75)
            const r2 = M.shouldExecuteReversal({
                actualEvidence: 0.8, evidenceThreshold: 0.5,
                inertiaFactor: 0.5
            });
            expect(r2.shouldReverse).toBe(true);
        });

        test('high inertia + matching threshold → still false', () => {
            // threshold=0.5, inertia=1.0 → effective=1.0
            const r = M.shouldExecuteReversal({
                actualEvidence: 0.5, evidenceThreshold: 0.5,
                inertiaFactor: 1.0
            });
            expect(r.shouldReverse).toBe(false);
        });
    });

    describe('classifyInertia (pure)', () => {
        test('inertia < 0.30 → volatile', () => {
            expect(M.classifyInertia({ inertiaFactor: 0.20 }).inertiaLevel).toBe('volatile');
        });

        test('inertia 0.30..0.70 → balanced', () => {
            expect(M.classifyInertia({ inertiaFactor: 0.50 }).inertiaLevel).toBe('balanced');
        });

        test('inertia > 0.70 → rigid', () => {
            expect(M.classifyInertia({ inertiaFactor: 0.85 }).inertiaLevel).toBe('rigid');
        });

        test('boundary 0.30 → balanced', () => {
            expect(M.classifyInertia({ inertiaFactor: 0.30 }).inertiaLevel).toBe('balanced');
        });
    });

    describe('determineNextAction (pure)', () => {
        test('high surprise + weakening → escalates to flipping', () => {
            const r = M.determineNextAction({
                reversalAction: 'weakening', surpriseScore: 0.85
            });
            expect(r.nextAction).toBe('flipping');
            expect(r.escalated).toBe(true);
        });

        test('low surprise + weakening → stays weakening', () => {
            const r = M.determineNextAction({
                reversalAction: 'weakening', surpriseScore: 0.20
            });
            expect(r.nextAction).toBe('weakening');
            expect(r.escalated).toBe(false);
        });

        test('high surprise + flipping → escalates to abandoning', () => {
            const r = M.determineNextAction({
                reversalAction: 'flipping', surpriseScore: 0.80
            });
            expect(r.nextAction).toBe('abandoning');
            expect(r.escalated).toBe(true);
        });

        test('high surprise + abandoning → stays abandoning (no higher level)', () => {
            const r = M.determineNextAction({
                reversalAction: 'abandoning', surpriseScore: 0.95
            });
            expect(r.nextAction).toBe('abandoning');
            expect(r.escalated).toBe(false);
        });

        test('escalating action is preserved (special signal)', () => {
            const r = M.determineNextAction({
                reversalAction: 'escalating', surpriseScore: 0.50
            });
            expect(r.nextAction).toBe('escalating');
        });
    });

    describe('registerCriterion', () => {
        test('persists criterion', () => {
            const r = M.registerCriterion({
                userId: UID, resolvedEnv: ENV,
                criterionId: 'p130_reg_1',
                beliefId: 'thesis_bullish_btc',
                reversalAction: 'flipping',
                triggerCondition: 'volume drops 50%+ and RSI < 30',
                evidenceThreshold: 0.6,
                inertiaFactor: 0.3,
                ts: _now()
            });
            expect(r.registered).toBe(true);
        });

        test('duplicate criterionId throws', () => {
            M.registerCriterion({
                userId: UID, resolvedEnv: ENV,
                criterionId: 'p130_reg_dup',
                beliefId: 'b1', reversalAction: 'weakening',
                triggerCondition: 'c', evidenceThreshold: 0.5,
                inertiaFactor: 0.2, ts: _now()
            });
            expect(() => M.registerCriterion({
                userId: UID, resolvedEnv: ENV,
                criterionId: 'p130_reg_dup',
                beliefId: 'b2', reversalAction: 'flipping',
                triggerCondition: 'c2', evidenceThreshold: 0.6,
                inertiaFactor: 0.3, ts: _now()
            })).toThrow(/duplicate/);
        });

        test('invalid reversalAction throws', () => {
            expect(() => M.registerCriterion({
                userId: UID, resolvedEnv: ENV,
                criterionId: 'p130_reg_bad',
                beliefId: 'b1', reversalAction: 'BOGUS',
                triggerCondition: 'c', evidenceThreshold: 0.5,
                inertiaFactor: 0.2, ts: _now()
            })).toThrow(/invalid reversalAction/);
        });

        test('out-of-range evidenceThreshold throws', () => {
            expect(() => M.registerCriterion({
                userId: UID, resolvedEnv: ENV,
                criterionId: 'p130_reg_bad2',
                beliefId: 'b1', reversalAction: 'weakening',
                triggerCondition: 'c', evidenceThreshold: 1.5,
                inertiaFactor: 0.2, ts: _now()
            })).toThrow();
        });
    });

    describe('recordMindChangeEvent', () => {
        test('auto-computes surprise + reversal_executed (positive case)', () => {
            M.registerCriterion({
                userId: UID_EVENT, resolvedEnv: ENV,
                criterionId: 'p130_ev_crit_1',
                beliefId: 'b_e1', reversalAction: 'flipping',
                triggerCondition: 'c', evidenceThreshold: 0.5,
                inertiaFactor: 0.1, ts: 1000
            });
            // actual=0.8, threshold=0.5, inertia=0.1 → effective threshold = 0.55
            // 0.8 >= 0.55 → reversal=1; surprise = (0.8-0.5)/0.5 = 0.6
            const r = M.recordMindChangeEvent({
                userId: UID_EVENT, resolvedEnv: ENV,
                eventId: 'p130_ev_1',
                criterionId: 'p130_ev_crit_1',
                actualEvidence: 0.8,
                ts: 2000
            });
            expect(r.reversalExecuted).toBe(true);
            expect(r.surpriseScore).toBeCloseTo(0.6, 6);
        });

        test('actual below threshold → reversal=false, surprise=0', () => {
            M.registerCriterion({
                userId: UID_EVENT, resolvedEnv: ENV,
                criterionId: 'p130_ev_crit_2',
                beliefId: 'b_e2', reversalAction: 'flipping',
                triggerCondition: 'c', evidenceThreshold: 0.5,
                inertiaFactor: 0.1, ts: 1000
            });
            const r = M.recordMindChangeEvent({
                userId: UID_EVENT, resolvedEnv: ENV,
                eventId: 'p130_ev_2',
                criterionId: 'p130_ev_crit_2',
                actualEvidence: 0.3,
                ts: 2000
            });
            expect(r.reversalExecuted).toBe(false);
            expect(r.surpriseScore).toBe(0);
        });

        test('missing criterion throws', () => {
            expect(() => M.recordMindChangeEvent({
                userId: UID_EVENT, resolvedEnv: ENV,
                eventId: 'p130_ev_orphan',
                criterionId: 'p130_NONEXISTENT',
                actualEvidence: 0.5,
                ts: _now()
            })).toThrow(/criterion not found/);
        });

        test('duplicate eventId throws', () => {
            M.registerCriterion({
                userId: UID_EVENT, resolvedEnv: ENV,
                criterionId: 'p130_ev_crit_dup',
                beliefId: 'b_dup', reversalAction: 'weakening',
                triggerCondition: 'c', evidenceThreshold: 0.5,
                inertiaFactor: 0.1, ts: 1000
            });
            M.recordMindChangeEvent({
                userId: UID_EVENT, resolvedEnv: ENV,
                eventId: 'p130_ev_dup',
                criterionId: 'p130_ev_crit_dup',
                actualEvidence: 0.6,
                ts: 2000
            });
            expect(() => M.recordMindChangeEvent({
                userId: UID_EVENT, resolvedEnv: ENV,
                eventId: 'p130_ev_dup',
                criterionId: 'p130_ev_crit_dup',
                actualEvidence: 0.7,
                ts: 3000
            })).toThrow(/duplicate/);
        });
    });

    describe('getCriteriaForBelief', () => {
        test('returns criteria for specific belief', () => {
            M.registerCriterion({
                userId: UID_BELIEF, resolvedEnv: ENV,
                criterionId: 'p130_b_c1', beliefId: 'belief_target',
                reversalAction: 'weakening',
                triggerCondition: 'c', evidenceThreshold: 0.5,
                inertiaFactor: 0.2, ts: 1000
            });
            M.registerCriterion({
                userId: UID_BELIEF, resolvedEnv: ENV,
                criterionId: 'p130_b_c2', beliefId: 'belief_target',
                reversalAction: 'flipping',
                triggerCondition: 'c2', evidenceThreshold: 0.7,
                inertiaFactor: 0.4, ts: 2000
            });
            M.registerCriterion({
                userId: UID_BELIEF, resolvedEnv: ENV,
                criterionId: 'p130_b_c_other', beliefId: 'belief_OTHER',
                reversalAction: 'weakening',
                triggerCondition: 'c3', evidenceThreshold: 0.3,
                inertiaFactor: 0.1, ts: 3000
            });
            const rows = M.getCriteriaForBelief({
                userId: UID_BELIEF, resolvedEnv: ENV,
                beliefId: 'belief_target'
            });
            expect(rows.length).toBe(2);
            expect(rows.every(r => r.beliefId === 'belief_target')).toBe(true);
        });
    });

    describe('getEventHistory', () => {
        test('returns events DESC by ts', () => {
            const u = UID_HIST;
            M.registerCriterion({
                userId: u, resolvedEnv: ENV,
                criterionId: 'p130_h_crit',
                beliefId: 'b_h', reversalAction: 'flipping',
                triggerCondition: 'c', evidenceThreshold: 0.5,
                inertiaFactor: 0.1, ts: 1000
            });
            M.recordMindChangeEvent({
                userId: u, resolvedEnv: ENV,
                eventId: 'p130_h_e1', criterionId: 'p130_h_crit',
                actualEvidence: 0.6, ts: 2000
            });
            M.recordMindChangeEvent({
                userId: u, resolvedEnv: ENV,
                eventId: 'p130_h_e2', criterionId: 'p130_h_crit',
                actualEvidence: 0.7, ts: 3000
            });
            const rows = M.getEventHistory({
                userId: u, resolvedEnv: ENV, limit: 10
            });
            expect(rows.length).toBe(2);
            expect(rows[0].eventId).toBe('p130_h_e2');
        });

        test('criterion filter works', () => {
            const u = UID_HIST;
            M.registerCriterion({
                userId: u, resolvedEnv: ENV,
                criterionId: 'p130_h_filter_a',
                beliefId: 'b_h2', reversalAction: 'weakening',
                triggerCondition: 'c', evidenceThreshold: 0.5,
                inertiaFactor: 0.1, ts: 1000
            });
            M.registerCriterion({
                userId: u, resolvedEnv: ENV,
                criterionId: 'p130_h_filter_b',
                beliefId: 'b_h3', reversalAction: 'flipping',
                triggerCondition: 'c2', evidenceThreshold: 0.5,
                inertiaFactor: 0.1, ts: 1001
            });
            M.recordMindChangeEvent({
                userId: u, resolvedEnv: ENV,
                eventId: 'p130_h_filter_e1',
                criterionId: 'p130_h_filter_a',
                actualEvidence: 0.6, ts: 2000
            });
            M.recordMindChangeEvent({
                userId: u, resolvedEnv: ENV,
                eventId: 'p130_h_filter_e2',
                criterionId: 'p130_h_filter_b',
                actualEvidence: 0.6, ts: 3000
            });
            const rows = M.getEventHistory({
                userId: u, resolvedEnv: ENV,
                criterionFilter: 'p130_h_filter_a',
                limit: 10
            });
            expect(rows.length).toBe(1);
            expect(rows[0].eventId).toBe('p130_h_filter_e1');
        });
    });

    describe('isolation per user × env', () => {
        test('uid A cannot see uid B criteria', () => {
            M.registerCriterion({
                userId: UID_ISO_A, resolvedEnv: ENV,
                criterionId: 'p130_iso_a',
                beliefId: 'b_iso', reversalAction: 'weakening',
                triggerCondition: 'c', evidenceThreshold: 0.5,
                inertiaFactor: 0.1, ts: _now()
            });
            M.registerCriterion({
                userId: UID_ISO_B, resolvedEnv: ENV,
                criterionId: 'p130_iso_b',
                beliefId: 'b_iso', reversalAction: 'flipping',
                triggerCondition: 'c2', evidenceThreshold: 0.5,
                inertiaFactor: 0.1, ts: _now()
            });
            const rows = M.getCriteriaForBelief({
                userId: UID_ISO_A, resolvedEnv: ENV,
                beliefId: 'b_iso'
            });
            expect(rows.every(r => r.criterionId !== 'p130_iso_b')).toBe(true);
        });

        test('DEMO env cannot see TESTNET env', () => {
            M.registerCriterion({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                criterionId: 'p130_env_demo',
                beliefId: 'b_env', reversalAction: 'weakening',
                triggerCondition: 'c', evidenceThreshold: 0.5,
                inertiaFactor: 0.1, ts: _now()
            });
            M.registerCriterion({
                userId: UID_ENV, resolvedEnv: 'TESTNET',
                criterionId: 'p130_env_testnet',
                beliefId: 'b_env', reversalAction: 'flipping',
                triggerCondition: 'c2', evidenceThreshold: 0.5,
                inertiaFactor: 0.1, ts: _now()
            });
            const rows = M.getCriteriaForBelief({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                beliefId: 'b_env'
            });
            expect(rows.every(r => r.criterionId !== 'p130_env_testnet')).toBe(true);
        });
    });
});
