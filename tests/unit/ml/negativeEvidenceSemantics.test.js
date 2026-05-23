'use strict';

/**
 * OMEGA §152 NEGATIVE EVIDENCE SEMANTICS / ABSENCE-AS-SIGNAL ENGINE.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt lines 5034-5084.
 *
 * "ce ar fi trebuit sa vad pana acum si n-am vazut?"
 *
 * Tests FIRST per TDD discipline.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p152-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/R2_cognition/negativeEvidenceSemantics');

const UID = 9152;
const UID_REG = 9252;
const UID_TR = 9352;
const UID_OBS = 9452;
const UID_EVAL = 9552;
const UID_GET = 9652;
const UID_ISO_A = 9752;
const UID_ISO_B = 9852;
const UID_ENV = 9952;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    const uids = [UID, UID_REG, UID_TR, UID_OBS, UID_EVAL, UID_GET,
                  UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_negative_evidence_events WHERE user_id IN (${placeholders})`).run(...uids);
    db.prepare(`DELETE FROM ml_expected_signals_registry WHERE user_id IN (${placeholders})`).run(...uids);
}
beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §152 NEGATIVE EVIDENCE SEMANTICS', () => {

    describe('Migrations 302+303', () => {
        test('302 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('302_ml_expected_signals_registry')).toBeTruthy();
        });
        test('303 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('303_ml_negative_evidence_events')).toBeTruthy();
        });
        test('window ordering CHECK on registry', () => {
            // normal_window_ms > significant_window_ms violates CHECK
            expect(() => db.prepare(`INSERT INTO ml_expected_signals_registry
                (user_id, resolved_env, expected_signal_id, event_trigger,
                 expected_signal_name, normal_window_ms, significant_window_ms,
                 max_window_ms, causal_interpretation, thesis_link_label,
                 registered_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'es_bad', 'trig', 'expect',
                    5000, 2000, 10000, 'reason', null, _now())).toThrow();
        });
        test('state CHECK enum on evidence events', () => {
            db.prepare(`INSERT INTO ml_expected_signals_registry
                (user_id, resolved_env, expected_signal_id, event_trigger,
                 expected_signal_name, normal_window_ms, significant_window_ms,
                 max_window_ms, causal_interpretation, thesis_link_label,
                 registered_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'es_for_ck1', 'trig', 'expect',
                    1000, 5000, 10000, 'reason', null, _now());
            expect(() => db.prepare(`INSERT INTO ml_negative_evidence_events
                (user_id, resolved_env, evidence_id, expected_signal_id,
                 trigger_event_label, trigger_ts, observation_deadline_ts,
                 observed, observed_ts, absence_significance_score, state,
                 resolved_ts, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'ne_bk', 'es_for_ck1', 'trig_lbl',
                    1000, 11000, 0, null, 0, 'BOGUS', null, _now())).toThrow();
        });
        test('expected_signal_id UNIQUE', () => {
            const stmt = db.prepare(`INSERT INTO ml_expected_signals_registry
                (user_id, resolved_env, expected_signal_id, event_trigger,
                 expected_signal_name, normal_window_ms, significant_window_ms,
                 max_window_ms, causal_interpretation, thesis_link_label,
                 registered_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            stmt.run(UID, ENV, 'es_dup', 'trig', 'expect',
                1000, 5000, 10000, 'reason', null, _now());
            expect(() => stmt.run(UID, ENV, 'es_dup', 'trig2', 'expect2',
                1000, 5000, 10000, 'r', null, _now())).toThrow();
        });
        test('FK ON DELETE RESTRICT', () => {
            db.prepare(`INSERT INTO ml_expected_signals_registry
                (user_id, resolved_env, expected_signal_id, event_trigger,
                 expected_signal_name, normal_window_ms, significant_window_ms,
                 max_window_ms, causal_interpretation, thesis_link_label,
                 registered_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'es_fk', 'trig', 'expect',
                    1000, 5000, 10000, 'reason', null, _now());
            db.prepare(`INSERT INTO ml_negative_evidence_events
                (user_id, resolved_env, evidence_id, expected_signal_id,
                 trigger_event_label, trigger_ts, observation_deadline_ts,
                 observed, observed_ts, absence_significance_score, state,
                 resolved_ts, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'ne_fk', 'es_fk', 'trig_lbl',
                    1000, 11000, 0, null, 0, 'pending', null, _now());
            expect(() => db.prepare(`DELETE FROM ml_expected_signals_registry WHERE expected_signal_id=?`).run('es_fk')).toThrow();
            db.prepare(`DELETE FROM ml_negative_evidence_events WHERE evidence_id=?`).run('ne_fk');
            db.prepare(`DELETE FROM ml_expected_signals_registry WHERE expected_signal_id=?`).run('es_fk');
        });
    });

    describe('Constants', () => {
        test('ABSENCE_STATES frozen 5', () => {
            expect(M.ABSENCE_STATES).toEqual([
                'pending', 'normal_absence',
                'significant_absence', 'observed', 'expired'
            ]);
            expect(Object.isFrozen(M.ABSENCE_STATES)).toBe(true);
        });
        test('SIGNIFICANCE_RAMP_THRESHOLD = 0.50', () => {
            expect(M.SIGNIFICANCE_RAMP_THRESHOLD).toBe(0.50);
        });
    });

    describe('classifyAbsenceState (pure)', () => {
        const wins = { normalWindowMs: 1000, significantWindowMs: 5000, maxWindowMs: 10000 };
        test('elapsed < normal_window → pending', () => {
            const r = M.classifyAbsenceState({ elapsedMs: 500, ...wins });
            expect(r.state).toBe('pending');
        });
        test('normal_window ≤ elapsed < significant_window → normal_absence', () => {
            const r = M.classifyAbsenceState({ elapsedMs: 3000, ...wins });
            expect(r.state).toBe('normal_absence');
        });
        test('significant_window ≤ elapsed < max_window → significant_absence', () => {
            const r = M.classifyAbsenceState({ elapsedMs: 7000, ...wins });
            expect(r.state).toBe('significant_absence');
        });
        test('elapsed ≥ max_window → expired', () => {
            const r = M.classifyAbsenceState({ elapsedMs: 11000, ...wins });
            expect(r.state).toBe('expired');
        });
        test('boundary elapsed === normal_window → normal_absence', () => {
            const r = M.classifyAbsenceState({ elapsedMs: 1000, ...wins });
            expect(r.state).toBe('normal_absence');
        });
        test('boundary elapsed === significant_window → significant_absence', () => {
            const r = M.classifyAbsenceState({ elapsedMs: 5000, ...wins });
            expect(r.state).toBe('significant_absence');
        });
        test('negative elapsed throws', () => {
            expect(() => M.classifyAbsenceState({ elapsedMs: -1, ...wins })).toThrow();
        });
    });

    describe('computeAbsenceSignificance (pure)', () => {
        const wins = { normalWindowMs: 1000, significantWindowMs: 5000, maxWindowMs: 10000 };
        test('pending state → significance 0', () => {
            const r = M.computeAbsenceSignificance({ elapsedMs: 500, ...wins });
            expect(r.significance).toBe(0);
            expect(r.state).toBe('pending');
        });
        test('normal_absence ramps 0..0.50 as elapsed crosses normal..significant', () => {
            const at_normal = M.computeAbsenceSignificance({ elapsedMs: 1000, ...wins });
            const at_mid = M.computeAbsenceSignificance({ elapsedMs: 3000, ...wins });
            const at_significant = M.computeAbsenceSignificance({ elapsedMs: 5000, ...wins });
            expect(at_normal.significance).toBeCloseTo(0, 6);
            expect(at_mid.significance).toBeGreaterThan(0);
            expect(at_mid.significance).toBeLessThan(M.SIGNIFICANCE_RAMP_THRESHOLD);
            // At significant_window boundary state flips to significant_absence
            expect(at_significant.state).toBe('significant_absence');
        });
        test('significant_absence ramps SIGNIFICANCE_RAMP_THRESHOLD..1.0', () => {
            const just_in = M.computeAbsenceSignificance({ elapsedMs: 5000, ...wins });
            const deep_in = M.computeAbsenceSignificance({ elapsedMs: 9000, ...wins });
            expect(just_in.significance).toBe(M.SIGNIFICANCE_RAMP_THRESHOLD);
            expect(deep_in.significance).toBeGreaterThan(just_in.significance);
            expect(deep_in.significance).toBeLessThanOrEqual(1);
        });
        test('expired → significance 1.0', () => {
            const r = M.computeAbsenceSignificance({ elapsedMs: 11000, ...wins });
            expect(r.significance).toBe(1);
            expect(r.state).toBe('expired');
        });
    });

    describe('detectExpectationViolation (pure)', () => {
        test('observed=true → no violation', () => {
            const r = M.detectExpectationViolation({
                signalAppeared: true,
                state: 'observed',
                significance: 1.0
            });
            expect(r.violation).toBe(false);
        });
        test('pending or normal_absence → no violation yet', () => {
            expect(M.detectExpectationViolation({
                signalAppeared: false, state: 'pending', significance: 0
            }).violation).toBe(false);
            expect(M.detectExpectationViolation({
                signalAppeared: false, state: 'normal_absence', significance: 0.2
            }).violation).toBe(false);
        });
        test('significant_absence → violation', () => {
            const r = M.detectExpectationViolation({
                signalAppeared: false,
                state: 'significant_absence',
                significance: 0.7
            });
            expect(r.violation).toBe(true);
        });
        test('expired → violation', () => {
            const r = M.detectExpectationViolation({
                signalAppeared: false,
                state: 'expired',
                significance: 1.0
            });
            expect(r.violation).toBe(true);
        });
        test('invalid state throws', () => {
            expect(() => M.detectExpectationViolation({
                signalAppeared: false, state: 'BOGUS', significance: 0
            })).toThrow();
        });
    });

    describe('registerExpectedSignal', () => {
        test('register with all required fields', () => {
            const r = M.registerExpectedSignal({
                userId: UID_REG, resolvedEnv: ENV,
                expectedSignalId: 'res_sweep',
                eventTrigger: 'liquidity_sweep_authentic',
                expectedSignalName: 'follow_through',
                normalWindowMs: 2000,
                significantWindowMs: 10000,
                maxWindowMs: 30000,
                causalInterpretation: 'absence indicates sweep was likely fake',
                thesisLinkLabel: 'breakout_thesis',
                ts: _now()
            });
            expect(r.registered).toBe(true);
            expect(r.expectedSignalId).toBe('res_sweep');
        });
        test('thesis_link_label optional', () => {
            const r = M.registerExpectedSignal({
                userId: UID_REG, resolvedEnv: ENV,
                expectedSignalId: 'res_no_thesis',
                eventTrigger: 'trig',
                expectedSignalName: 'expect',
                normalWindowMs: 1000,
                significantWindowMs: 5000,
                maxWindowMs: 10000,
                causalInterpretation: 'r',
                ts: _now()
            });
            expect(r.registered).toBe(true);
        });
        test('invalid window ordering throws', () => {
            expect(() => M.registerExpectedSignal({
                userId: UID_REG, resolvedEnv: ENV,
                expectedSignalId: 'res_inv',
                eventTrigger: 'trig', expectedSignalName: 'expect',
                normalWindowMs: 10000,
                significantWindowMs: 5000,  // < normal
                maxWindowMs: 30000,
                causalInterpretation: 'r',
                ts: _now()
            })).toThrow(/window/i);
        });
        test('non-positive window throws', () => {
            expect(() => M.registerExpectedSignal({
                userId: UID_REG, resolvedEnv: ENV,
                expectedSignalId: 'res_zero',
                eventTrigger: 'trig', expectedSignalName: 'expect',
                normalWindowMs: 0,
                significantWindowMs: 5000,
                maxWindowMs: 10000,
                causalInterpretation: 'r',
                ts: _now()
            })).toThrow();
        });
        test('duplicate id throws', () => {
            M.registerExpectedSignal({
                userId: UID_REG, resolvedEnv: ENV,
                expectedSignalId: 'res_dup',
                eventTrigger: 'trig', expectedSignalName: 'expect',
                normalWindowMs: 1000, significantWindowMs: 5000,
                maxWindowMs: 10000, causalInterpretation: 'r',
                ts: _now()
            });
            expect(() => M.registerExpectedSignal({
                userId: UID_REG, resolvedEnv: ENV,
                expectedSignalId: 'res_dup',
                eventTrigger: 'trig2', expectedSignalName: 'expect2',
                normalWindowMs: 1000, significantWindowMs: 5000,
                maxWindowMs: 10000, causalInterpretation: 'r',
                ts: _now()
            })).toThrow(/duplicate/);
        });
    });

    describe('recordTriggerEvent (integration)', () => {
        function _setup(uid, signalId) {
            M.registerExpectedSignal({
                userId: uid, resolvedEnv: ENV,
                expectedSignalId: signalId,
                eventTrigger: 'sweep',
                expectedSignalName: 'follow_through',
                normalWindowMs: 1000,
                significantWindowMs: 5000,
                maxWindowMs: 10000,
                causalInterpretation: 'sweep without follow-through = fake',
                ts: _now()
            });
        }
        test('creates pending event with deadline', () => {
            _setup(UID_TR, 'rt_s1');
            const r = M.recordTriggerEvent({
                userId: UID_TR, resolvedEnv: ENV,
                evidenceId: 'rt_e1',
                expectedSignalId: 'rt_s1',
                triggerEventLabel: 'sweep_at_btc_72k',
                triggerTs: 1000,
                ts: 1000
            });
            expect(r.recorded).toBe(true);
            expect(r.state).toBe('pending');
            expect(r.observationDeadlineTs).toBe(11000);  // trigger + maxWindow
        });
        test('event on nonexistent signal throws (FK)', () => {
            expect(() => M.recordTriggerEvent({
                userId: UID_TR, resolvedEnv: ENV,
                evidenceId: 'rt_orph',
                expectedSignalId: 'rt_nonexistent',
                triggerEventLabel: 'lbl',
                triggerTs: 1000, ts: 1000
            })).toThrow();
        });
        test('duplicate evidenceId throws', () => {
            _setup(UID_TR, 'rt_s2');
            M.recordTriggerEvent({
                userId: UID_TR, resolvedEnv: ENV,
                evidenceId: 'rt_dup',
                expectedSignalId: 'rt_s2',
                triggerEventLabel: 'lbl',
                triggerTs: 1000, ts: 1000
            });
            expect(() => M.recordTriggerEvent({
                userId: UID_TR, resolvedEnv: ENV,
                evidenceId: 'rt_dup',
                expectedSignalId: 'rt_s2',
                triggerEventLabel: 'lbl', triggerTs: 2000, ts: 2000
            })).toThrow(/duplicate/);
        });
    });

    describe('markSignalObserved (integration)', () => {
        function _seed(uid, signalId, evidenceId) {
            M.registerExpectedSignal({
                userId: uid, resolvedEnv: ENV,
                expectedSignalId: signalId,
                eventTrigger: 'trig', expectedSignalName: 'follow',
                normalWindowMs: 1000, significantWindowMs: 5000,
                maxWindowMs: 10000, causalInterpretation: 'r',
                ts: _now()
            });
            M.recordTriggerEvent({
                userId: uid, resolvedEnv: ENV,
                evidenceId, expectedSignalId: signalId,
                triggerEventLabel: 'lbl', triggerTs: 1000, ts: 1000
            });
        }
        test('marks pending event as observed with timestamp', () => {
            _seed(UID_OBS, 'mo_s1', 'mo_e1');
            const r = M.markSignalObserved({
                userId: UID_OBS, resolvedEnv: ENV,
                evidenceId: 'mo_e1',
                observedTs: 2500
            });
            expect(r.marked).toBe(true);
            expect(r.state).toBe('observed');
            expect(r.observedTs).toBe(2500);
        });
        test('mark on nonexistent event throws', () => {
            expect(() => M.markSignalObserved({
                userId: UID_OBS, resolvedEnv: ENV,
                evidenceId: 'mo_nope',
                observedTs: 1000
            })).toThrow(/not found/i);
        });
        test('marking already-observed event throws', () => {
            _seed(UID_OBS, 'mo_s2', 'mo_e2');
            M.markSignalObserved({
                userId: UID_OBS, resolvedEnv: ENV,
                evidenceId: 'mo_e2', observedTs: 2000
            });
            expect(() => M.markSignalObserved({
                userId: UID_OBS, resolvedEnv: ENV,
                evidenceId: 'mo_e2', observedTs: 3000
            })).toThrow(/already.*observed|already.*resolved/i);
        });
        test('marking expired event throws', () => {
            _seed(UID_OBS, 'mo_s3', 'mo_e3');
            // First evaluate it to expired
            M.evaluatePendingEvent({
                userId: UID_OBS, resolvedEnv: ENV,
                evidenceId: 'mo_e3', currentTs: 15000  // past max window
            });
            expect(() => M.markSignalObserved({
                userId: UID_OBS, resolvedEnv: ENV,
                evidenceId: 'mo_e3', observedTs: 16000
            })).toThrow(/already.*expired|already.*resolved/i);
        });
    });

    describe('evaluatePendingEvent (integration)', () => {
        function _seed(uid, signalId, evidenceId, triggerTs) {
            M.registerExpectedSignal({
                userId: uid, resolvedEnv: ENV,
                expectedSignalId: signalId,
                eventTrigger: 'trig', expectedSignalName: 'follow',
                normalWindowMs: 1000, significantWindowMs: 5000,
                maxWindowMs: 10000, causalInterpretation: 'r',
                ts: _now()
            });
            M.recordTriggerEvent({
                userId: uid, resolvedEnv: ENV,
                evidenceId, expectedSignalId: signalId,
                triggerEventLabel: 'lbl', triggerTs, ts: triggerTs
            });
        }
        test('transitions pending → normal_absence at normal_window', () => {
            _seed(UID_EVAL, 'ev_s1', 'ev_e1', 1000);
            const r = M.evaluatePendingEvent({
                userId: UID_EVAL, resolvedEnv: ENV,
                evidenceId: 'ev_e1', currentTs: 2500
            });
            expect(r.state).toBe('normal_absence');
            expect(r.significance).toBeGreaterThan(0);
            expect(r.significance).toBeLessThan(M.SIGNIFICANCE_RAMP_THRESHOLD);
        });
        test('transitions to significant_absence past significant_window', () => {
            _seed(UID_EVAL, 'ev_s2', 'ev_e2', 1000);
            const r = M.evaluatePendingEvent({
                userId: UID_EVAL, resolvedEnv: ENV,
                evidenceId: 'ev_e2', currentTs: 7000
            });
            expect(r.state).toBe('significant_absence');
            expect(r.violation).toBe(true);
            expect(r.significance).toBeGreaterThanOrEqual(M.SIGNIFICANCE_RAMP_THRESHOLD);
        });
        test('transitions to expired past max_window', () => {
            _seed(UID_EVAL, 'ev_s3', 'ev_e3', 1000);
            const r = M.evaluatePendingEvent({
                userId: UID_EVAL, resolvedEnv: ENV,
                evidenceId: 'ev_e3', currentTs: 15000
            });
            expect(r.state).toBe('expired');
            expect(r.significance).toBe(1);
            expect(r.violation).toBe(true);
        });
        test('observed events stay observed even with evaluation', () => {
            _seed(UID_EVAL, 'ev_s4', 'ev_e4', 1000);
            M.markSignalObserved({
                userId: UID_EVAL, resolvedEnv: ENV,
                evidenceId: 'ev_e4', observedTs: 2000
            });
            const r = M.evaluatePendingEvent({
                userId: UID_EVAL, resolvedEnv: ENV,
                evidenceId: 'ev_e4', currentTs: 15000
            });
            expect(r.state).toBe('observed');
            expect(r.violation).toBe(false);
        });
    });

    describe('getExpectedSignals & getNegativeEvidenceEvents', () => {
        test('returns registered signals for user × env', () => {
            M.registerExpectedSignal({
                userId: UID_GET, resolvedEnv: ENV,
                expectedSignalId: 'gs_1', eventTrigger: 't', expectedSignalName: 'e',
                normalWindowMs: 1000, significantWindowMs: 5000,
                maxWindowMs: 10000, causalInterpretation: 'r',
                ts: _now()
            });
            const r = M.getExpectedSignals({
                userId: UID_GET, resolvedEnv: ENV
            });
            expect(r.length).toBe(1);
            expect(r[0].expectedSignalId).toBe('gs_1');
        });
        test('filter evidence events by state', () => {
            M.registerExpectedSignal({
                userId: UID_GET, resolvedEnv: ENV,
                expectedSignalId: 'gs_2', eventTrigger: 't', expectedSignalName: 'e',
                normalWindowMs: 1000, significantWindowMs: 5000,
                maxWindowMs: 10000, causalInterpretation: 'r',
                ts: _now()
            });
            M.recordTriggerEvent({
                userId: UID_GET, resolvedEnv: ENV,
                evidenceId: 'ge_1', expectedSignalId: 'gs_2',
                triggerEventLabel: 'l', triggerTs: 1000, ts: 1000
            });
            M.recordTriggerEvent({
                userId: UID_GET, resolvedEnv: ENV,
                evidenceId: 'ge_2', expectedSignalId: 'gs_2',
                triggerEventLabel: 'l', triggerTs: 2000, ts: 2000
            });
            M.markSignalObserved({
                userId: UID_GET, resolvedEnv: ENV,
                evidenceId: 'ge_1', observedTs: 1500
            });
            const observed = M.getNegativeEvidenceEvents({
                userId: UID_GET, resolvedEnv: ENV,
                state: 'observed'
            });
            const pending = M.getNegativeEvidenceEvents({
                userId: UID_GET, resolvedEnv: ENV,
                state: 'pending'
            });
            expect(observed.length).toBe(1);
            expect(pending.length).toBe(1);
        });
    });

    describe('isolation per user × env', () => {
        test('uid isolation', () => {
            M.registerExpectedSignal({
                userId: UID_ISO_A, resolvedEnv: ENV,
                expectedSignalId: 'iso_a', eventTrigger: 't',
                expectedSignalName: 'e',
                normalWindowMs: 1000, significantWindowMs: 5000,
                maxWindowMs: 10000, causalInterpretation: 'r',
                ts: _now()
            });
            M.registerExpectedSignal({
                userId: UID_ISO_B, resolvedEnv: ENV,
                expectedSignalId: 'iso_b', eventTrigger: 't',
                expectedSignalName: 'e',
                normalWindowMs: 1000, significantWindowMs: 5000,
                maxWindowMs: 10000, causalInterpretation: 'r',
                ts: _now()
            });
            const a = M.getExpectedSignals({
                userId: UID_ISO_A, resolvedEnv: ENV
            });
            expect(a.every(s => s.expectedSignalId !== 'iso_b')).toBe(true);
        });
        test('env isolation', () => {
            M.registerExpectedSignal({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                expectedSignalId: 'env_d', eventTrigger: 't',
                expectedSignalName: 'e',
                normalWindowMs: 1000, significantWindowMs: 5000,
                maxWindowMs: 10000, causalInterpretation: 'r',
                ts: _now()
            });
            const testnet = M.getExpectedSignals({
                userId: UID_ENV, resolvedEnv: 'TESTNET'
            });
            expect(testnet).toEqual([]);
        });
    });
});
