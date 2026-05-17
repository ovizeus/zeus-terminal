'use strict';

/**
 * OMEGA §161 ALIVENESS SIMULATION LAYER / OPERATIONAL VITALITY INDEX.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt lines 5403-5455.
 *
 * "nu constiinta, nu persoana, ci vitalitate de agent."
 *
 * Tests FIRST per TDD discipline.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p161-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/_meta/alivenessSimulationLayer');

const UID = 9161;
const UID_S = 9261;
const UID_T = 9361;
const UID_GET = 9461;
const UID_ISO_A = 9561;
const UID_ISO_B = 9661;
const UID_ENV = 9761;
const ENV = 'DEMO';
const _now = () => Date.now();

const HEALTHY = {
    selfModelHealth: 0.85, coherence: 0.80, tensionField: 0.15,
    capabilityTrust: 0.80, learningFreshness: 0.70,
    identityContinuity: 0.90, unknownsPressure: 0.20,
    decisionIntegrity: 0.85
};
const DEGRADED = {
    selfModelHealth: 0.45, coherence: 0.40, tensionField: 0.65,
    capabilityTrust: 0.50, learningFreshness: 0.30,
    identityContinuity: 0.50, unknownsPressure: 0.70,
    decisionIntegrity: 0.40
};

function cleanRows() {
    const uids = [UID, UID_S, UID_T, UID_GET, UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_vitality_state_transitions WHERE user_id IN (${placeholders})`).run(...uids);
    db.prepare(`DELETE FROM ml_vitality_index_snapshots WHERE user_id IN (${placeholders})`).run(...uids);
}
beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §161 ALIVENESS SIMULATION LAYER', () => {

    describe('Migrations 320+321', () => {
        test('320 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('320_ml_vitality_index_snapshots')).toBeTruthy();
        });
        test('321 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('321_ml_vitality_state_transitions')).toBeTruthy();
        });
        test('state CHECK enum (6 canonical)', () => {
            expect(() => db.prepare(`INSERT INTO ml_vitality_index_snapshots
                (user_id, resolved_env, snapshot_id, self_model_health, coherence,
                 tension_field, capability_trust, learning_freshness,
                 identity_continuity, unknowns_pressure, decision_integrity,
                 composite_vitality_score, state, self_report_text, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 's_bk', 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
                    0.5, 'BOGUS', 'r', _now())).toThrow();
        });
        test('all 8 vitality components range CHECK', () => {
            expect(() => db.prepare(`INSERT INTO ml_vitality_index_snapshots
                (user_id, resolved_env, snapshot_id, self_model_health, coherence,
                 tension_field, capability_trust, learning_freshness,
                 identity_continuity, unknowns_pressure, decision_integrity,
                 composite_vitality_score, state, self_report_text, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 's_br', 1.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
                    0.5, 'lucid', 'r', _now())).toThrow();
        });
        test('FK on snapshot_id transitions', () => {
            db.prepare(`INSERT INTO ml_vitality_index_snapshots
                (user_id, resolved_env, snapshot_id, self_model_health, coherence,
                 tension_field, capability_trust, learning_freshness,
                 identity_continuity, unknowns_pressure, decision_integrity,
                 composite_vitality_score, state, self_report_text, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 's_fk', 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
                    0.5, 'lucid', 'r', _now());
            db.prepare(`INSERT INTO ml_vitality_state_transitions
                (user_id, resolved_env, transition_id, from_state, to_state,
                 trigger_reason, snapshot_id, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 't_fk', 'lucid', 'strained', 'r', 's_fk', _now());
            expect(() => db.prepare(`DELETE FROM ml_vitality_index_snapshots WHERE snapshot_id=?`).run('s_fk')).toThrow();
            db.prepare(`DELETE FROM ml_vitality_state_transitions WHERE transition_id=?`).run('t_fk');
            db.prepare(`DELETE FROM ml_vitality_index_snapshots WHERE snapshot_id=?`).run('s_fk');
        });
    });

    describe('Constants', () => {
        test('VITALITY_COMPONENTS frozen 8', () => {
            expect(M.VITALITY_COMPONENTS).toEqual([
                'selfModelHealth', 'coherence', 'tensionField',
                'capabilityTrust', 'learningFreshness',
                'identityContinuity', 'unknownsPressure', 'decisionIntegrity'
            ]);
            expect(Object.isFrozen(M.VITALITY_COMPONENTS)).toBe(true);
        });
        test('VITALITY_STATES frozen 6', () => {
            expect(M.VITALITY_STATES).toEqual([
                'lucid', 'strained', 'degraded',
                'guarded', 'observer', 'shutdown_worthy'
            ]);
            expect(Object.isFrozen(M.VITALITY_STATES)).toBe(true);
        });
        test('INVERTED_COMPONENTS frozen', () => {
            expect(M.INVERTED_COMPONENTS).toEqual([
                'tensionField', 'unknownsPressure'
            ]);
            expect(Object.isFrozen(M.INVERTED_COMPONENTS)).toBe(true);
        });
        test('STATE_THRESHOLDS ordered descending', () => {
            expect(M.STATE_THRESHOLDS.lucid).toBe(0.80);
            expect(M.STATE_THRESHOLDS.strained).toBe(0.65);
            expect(M.STATE_THRESHOLDS.degraded).toBe(0.50);
            expect(M.STATE_THRESHOLDS.guarded).toBe(0.35);
            expect(M.STATE_THRESHOLDS.observer).toBe(0.20);
            expect(M.STATE_THRESHOLDS.shutdown_worthy).toBe(0);
        });
    });

    describe('computeCompositeVitality (pure)', () => {
        test('all positive components high, inverted low → high vitality', () => {
            const r = M.computeCompositeVitality({ components: HEALTHY });
            expect(r.composite).toBeGreaterThan(0.80);
        });
        test('all positive components low, inverted high → low vitality', () => {
            const r = M.computeCompositeVitality({ components: DEGRADED });
            expect(r.composite).toBeLessThan(0.50);
        });
        test('tension and unknowns are inverted (high values reduce score)', () => {
            const high_tension = {
                ...HEALTHY, tensionField: 0.90, unknownsPressure: 0.90
            };
            const low_tension = {
                ...HEALTHY, tensionField: 0.05, unknownsPressure: 0.05
            };
            const hr = M.computeCompositeVitality({ components: high_tension });
            const lr = M.computeCompositeVitality({ components: low_tension });
            expect(lr.composite).toBeGreaterThan(hr.composite);
        });
        test('missing component throws', () => {
            const partial = { ...HEALTHY };
            delete partial.coherence;
            expect(() => M.computeCompositeVitality({ components: partial })).toThrow();
        });
        test('out-of-range throws', () => {
            const bad = { ...HEALTHY, coherence: 1.5 };
            expect(() => M.computeCompositeVitality({ components: bad })).toThrow();
        });
    });

    describe('classifyVitalityState (pure)', () => {
        test('composite ≥ 0.80 → lucid', () => {
            expect(M.classifyVitalityState({ compositeScore: 0.90 }).state).toBe('lucid');
        });
        test('0.65 ≤ composite < 0.80 → strained', () => {
            expect(M.classifyVitalityState({ compositeScore: 0.70 }).state).toBe('strained');
        });
        test('0.50 ≤ composite < 0.65 → degraded', () => {
            expect(M.classifyVitalityState({ compositeScore: 0.55 }).state).toBe('degraded');
        });
        test('0.35 ≤ composite < 0.50 → guarded', () => {
            expect(M.classifyVitalityState({ compositeScore: 0.40 }).state).toBe('guarded');
        });
        test('0.20 ≤ composite < 0.35 → observer', () => {
            expect(M.classifyVitalityState({ compositeScore: 0.25 }).state).toBe('observer');
        });
        test('composite < 0.20 → shutdown_worthy', () => {
            expect(M.classifyVitalityState({ compositeScore: 0.10 }).state).toBe('shutdown_worthy');
        });
        test('boundary 0.80 → lucid', () => {
            expect(M.classifyVitalityState({ compositeScore: 0.80 }).state).toBe('lucid');
        });
        test('boundary 0.20 → observer', () => {
            expect(M.classifyVitalityState({ compositeScore: 0.20 }).state).toBe('observer');
        });
    });

    describe('generateSelfReport (pure)', () => {
        test('lucid state → "sunt lucid operational"-style report', () => {
            const r = M.generateSelfReport({
                state: 'lucid', components: HEALTHY
            });
            expect(r.report).toMatch(/lucid|operational/i);
        });
        test('strained state → tension-acknowledging report', () => {
            const r = M.generateSelfReport({
                state: 'strained', components: { ...HEALTHY, tensionField: 0.50 }
            });
            expect(r.report).toMatch(/tensiona|strained|functional/i);
        });
        test('shutdown_worthy → restraint declaration', () => {
            const r = M.generateSelfReport({
                state: 'shutdown_worthy', components: DEGRADED
            });
            expect(r.report).toMatch(/nu am dreptul|shutdown|halt/i);
        });
        test('all 6 states produce non-empty report', () => {
            for (const state of ['lucid', 'strained', 'degraded',
                                  'guarded', 'observer', 'shutdown_worthy']) {
                const r = M.generateSelfReport({
                    state, components: HEALTHY
                });
                expect(r.report).toBeTruthy();
                expect(r.report.length).toBeGreaterThan(5);
            }
        });
        test('invalid state throws', () => {
            expect(() => M.generateSelfReport({
                state: 'BOGUS', components: HEALTHY
            })).toThrow();
        });
    });

    describe('validateTransition (pure)', () => {
        test('any state can transition to any state (no rigid path)', () => {
            // Unlike §150 admission path, vitality state can fluctuate
            expect(M.validateTransition({
                fromState: 'lucid', toState: 'strained'
            }).valid).toBe(true);
            expect(M.validateTransition({
                fromState: 'shutdown_worthy', toState: 'observer'
            }).valid).toBe(true);
            expect(M.validateTransition({
                fromState: 'degraded', toState: 'lucid'
            }).valid).toBe(true);
        });
        test('same-state transition invalid', () => {
            expect(M.validateTransition({
                fromState: 'lucid', toState: 'lucid'
            }).valid).toBe(false);
        });
        test('invalid state throws', () => {
            expect(() => M.validateTransition({
                fromState: 'BOGUS', toState: 'lucid'
            })).toThrow();
        });
    });

    describe('recordVitalitySnapshot', () => {
        test('healthy components → lucid state + appropriate report', () => {
            const r = M.recordVitalitySnapshot({
                userId: UID_S, resolvedEnv: ENV,
                snapshotId: 'rs_healthy',
                components: HEALTHY,
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.state).toBe('lucid');
            expect(r.compositeVitalityScore).toBeGreaterThan(0.80);
            expect(r.selfReportText).toBeTruthy();
        });
        test('degraded components → guarded or worse state', () => {
            const r = M.recordVitalitySnapshot({
                userId: UID_S, resolvedEnv: ENV,
                snapshotId: 'rs_degraded',
                components: DEGRADED,
                ts: _now()
            });
            // DEGRADED has composite ~0.36 → guarded
            expect(['guarded', 'observer', 'degraded']).toContain(r.state);
        });
        test('shutdown_worthy when extreme', () => {
            const extreme = {
                selfModelHealth: 0.10, coherence: 0.10,
                tensionField: 0.95, capabilityTrust: 0.10,
                learningFreshness: 0.10, identityContinuity: 0.10,
                unknownsPressure: 0.95, decisionIntegrity: 0.10
            };
            const r = M.recordVitalitySnapshot({
                userId: UID_S, resolvedEnv: ENV,
                snapshotId: 'rs_shutdown',
                components: extreme,
                ts: _now()
            });
            expect(r.state).toBe('shutdown_worthy');
        });
        test('duplicate snapshotId throws', () => {
            M.recordVitalitySnapshot({
                userId: UID_S, resolvedEnv: ENV,
                snapshotId: 'rs_dup', components: HEALTHY, ts: _now()
            });
            expect(() => M.recordVitalitySnapshot({
                userId: UID_S, resolvedEnv: ENV,
                snapshotId: 'rs_dup', components: HEALTHY, ts: _now()
            })).toThrow(/duplicate/);
        });
        test('missing component throws', () => {
            const partial = { ...HEALTHY };
            delete partial.tensionField;
            expect(() => M.recordVitalitySnapshot({
                userId: UID_S, resolvedEnv: ENV,
                snapshotId: 'rs_part', components: partial, ts: _now()
            })).toThrow();
        });
    });

    describe('recordStateTransition (integration)', () => {
        test('persists transition with snapshot link', () => {
            const snap = M.recordVitalitySnapshot({
                userId: UID_T, resolvedEnv: ENV,
                snapshotId: 'rt_s1', components: HEALTHY, ts: _now()
            });
            const r = M.recordStateTransition({
                userId: UID_T, resolvedEnv: ENV,
                transitionId: 'rt_t1',
                fromState: 'strained', toState: 'lucid',
                triggerReason: 'tension field resolved',
                snapshotId: 'rt_s1',
                ts: _now()
            });
            expect(r.recorded).toBe(true);
        });
        test('snapshot_id optional', () => {
            const r = M.recordStateTransition({
                userId: UID_T, resolvedEnv: ENV,
                transitionId: 'rt_no_snap',
                fromState: 'lucid', toState: 'strained',
                triggerReason: 'minor tension uptick',
                ts: _now()
            });
            expect(r.recorded).toBe(true);
        });
        test('same-state transition throws', () => {
            expect(() => M.recordStateTransition({
                userId: UID_T, resolvedEnv: ENV,
                transitionId: 'rt_same',
                fromState: 'lucid', toState: 'lucid',
                triggerReason: 'r', ts: _now()
            })).toThrow(/transition/i);
        });
        test('duplicate transitionId throws', () => {
            M.recordStateTransition({
                userId: UID_T, resolvedEnv: ENV,
                transitionId: 'rt_dup', fromState: 'lucid',
                toState: 'strained', triggerReason: 'r', ts: _now()
            });
            expect(() => M.recordStateTransition({
                userId: UID_T, resolvedEnv: ENV,
                transitionId: 'rt_dup', fromState: 'lucid',
                toState: 'strained', triggerReason: 'r', ts: _now()
            })).toThrow(/duplicate/);
        });
    });

    describe('getLatestSnapshot & getRecentSnapshots', () => {
        test('getLatestSnapshot returns most recent or null', () => {
            M.recordVitalitySnapshot({
                userId: UID_GET, resolvedEnv: ENV,
                snapshotId: 'gl_1', components: HEALTHY, ts: 1000
            });
            M.recordVitalitySnapshot({
                userId: UID_GET, resolvedEnv: ENV,
                snapshotId: 'gl_2', components: HEALTHY, ts: 2000
            });
            const r = M.getLatestSnapshot({
                userId: UID_GET, resolvedEnv: ENV
            });
            expect(r.snapshotId).toBe('gl_2');
        });
        test('getLatestSnapshot returns null when none', () => {
            expect(M.getLatestSnapshot({
                userId: UID_GET, resolvedEnv: 'REAL'
            })).toBeNull();
        });
        test('getRecentSnapshots filters by state', () => {
            M.recordVitalitySnapshot({
                userId: UID_GET, resolvedEnv: ENV,
                snapshotId: 'gr_h', components: HEALTHY, ts: _now()
            });
            M.recordVitalitySnapshot({
                userId: UID_GET, resolvedEnv: ENV,
                snapshotId: 'gr_d', components: DEGRADED, ts: _now()
            });
            const lucidOnly = M.getRecentSnapshots({
                userId: UID_GET, resolvedEnv: ENV,
                state: 'lucid'
            });
            expect(lucidOnly.length).toBe(1);
            expect(lucidOnly[0].snapshotId).toBe('gr_h');
        });
    });

    describe('isolation per user × env', () => {
        test('uid isolation', () => {
            M.recordVitalitySnapshot({
                userId: UID_ISO_A, resolvedEnv: ENV,
                snapshotId: 'iso_a', components: HEALTHY, ts: _now()
            });
            M.recordVitalitySnapshot({
                userId: UID_ISO_B, resolvedEnv: ENV,
                snapshotId: 'iso_b', components: HEALTHY, ts: _now()
            });
            const a = M.getLatestSnapshot({
                userId: UID_ISO_A, resolvedEnv: ENV
            });
            expect(a.snapshotId).toBe('iso_a');
        });
        test('env isolation', () => {
            M.recordVitalitySnapshot({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                snapshotId: 'env_d', components: HEALTHY, ts: _now()
            });
            const testnet = M.getLatestSnapshot({
                userId: UID_ENV, resolvedEnv: 'TESTNET'
            });
            expect(testnet).toBeNull();
        });
    });
});
