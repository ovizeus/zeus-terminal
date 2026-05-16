'use strict';

/**
 * OMEGA §141 ERGODICITY AWARENESS.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt lines 4707-4708.
 *
 * "diferenta dintre medie si traiectorie te poate distruge"
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p141-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/R3A_safety/ergodicityAwareness');

const UID = 9141;
const UID_TRANS = 9241;
const UID_LATEST = 9341;
const UID_HIST = 9441;
const UID_ISO_A = 9541;
const UID_ISO_B = 9641;
const UID_ENV = 9741;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    const uids = [UID, UID_TRANS, UID_LATEST, UID_HIST,
                  UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_ergodicity_assessments WHERE user_id IN (${placeholders})`).run(...uids);
    db.prepare(`DELETE FROM ml_ergodicity_regime_transitions WHERE user_id IN (${placeholders})`).run(...uids);
}

beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §141 ERGODICITY AWARENESS', () => {

    describe('Migrations 267+268', () => {
        test('267_ml_ergodicity_assessments migration applied', () => {
            expect(db.prepare(
                "SELECT name FROM _migrations WHERE name = ?"
            ).get('267_ml_ergodicity_assessments')).toBeTruthy();
        });

        test('268_ml_ergodicity_regime_transitions migration applied', () => {
            expect(db.prepare(
                "SELECT name FROM _migrations WHERE name = ?"
            ).get('268_ml_ergodicity_regime_transitions')).toBeTruthy();
        });

        test('assessment_id UNIQUE enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_ergodicity_assessments
                (user_id, resolved_env, assessment_id,
                 vol_expansion_rate, sequential_drawdown,
                 relative_leverage_increase, non_ergodicity_score,
                 regime, framework_mode, triggered_signals_json, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            stmt.run(UID, ENV, 'p141_a_dup', 0.3, 0.1, 0.1, 0.3,
                'ergodic_normal', 'expected_value', '[]', _now());
            expect(() => stmt.run(UID, ENV, 'p141_a_dup', 0.5, 0.2, 0.2, 0.5,
                'non_ergodic_survival', 'minimax_survival', '[]', _now())
            ).toThrow();
        });

        test('regime CHECK enum enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_ergodicity_assessments
                (user_id, resolved_env, assessment_id,
                 vol_expansion_rate, sequential_drawdown,
                 relative_leverage_increase, non_ergodicity_score,
                 regime, framework_mode, triggered_signals_json, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p141_bad_regime', 0.3, 0.1, 0.1, 0.3,
                'BOGUS', 'expected_value', '[]', _now())).toThrow();
        });

        test('framework_mode CHECK enum enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_ergodicity_assessments
                (user_id, resolved_env, assessment_id,
                 vol_expansion_rate, sequential_drawdown,
                 relative_leverage_increase, non_ergodicity_score,
                 regime, framework_mode, triggered_signals_json, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p141_bad_fm', 0.3, 0.1, 0.1, 0.3,
                'ergodic_normal', 'BOGUS', '[]', _now())).toThrow();
        });

        test('non_ergodicity_score CHECK range enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_ergodicity_assessments
                (user_id, resolved_env, assessment_id,
                 vol_expansion_rate, sequential_drawdown,
                 relative_leverage_increase, non_ergodicity_score,
                 regime, framework_mode, triggered_signals_json, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p141_bad_score',
                0.3, 0.1, 0.1, 1.5,
                'ergodic_normal', 'expected_value', '[]', _now())).toThrow();
        });

        test('sequential_drawdown CHECK ≥ 0 enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_ergodicity_assessments
                (user_id, resolved_env, assessment_id,
                 vol_expansion_rate, sequential_drawdown,
                 relative_leverage_increase, non_ergodicity_score,
                 regime, framework_mode, triggered_signals_json, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p141_bad_dd',
                0.3, -0.1, 0.1, 0.3,
                'ergodic_normal', 'expected_value', '[]', _now())).toThrow();
        });

        test('transition_id UNIQUE enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_ergodicity_regime_transitions
                (user_id, resolved_env, transition_id,
                 from_regime, to_regime, trigger_signals_json, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            stmt.run(UID, ENV, 'p141_t_dup',
                'ergodic_normal', 'non_ergodic_survival', '[]', _now());
            expect(() => stmt.run(UID, ENV, 'p141_t_dup',
                'non_ergodic_survival', 'ergodic_normal', '[]', _now())
            ).toThrow();
        });
    });

    describe('Constants', () => {
        test('REGIMES frozen 2 entries', () => {
            expect(M.REGIMES).toEqual([
                'ergodic_normal', 'non_ergodic_survival'
            ]);
            expect(Object.isFrozen(M.REGIMES)).toBe(true);
        });

        test('FRAMEWORK_MODES frozen 2 entries', () => {
            expect(M.FRAMEWORK_MODES).toEqual([
                'expected_value', 'minimax_survival'
            ]);
            expect(Object.isFrozen(M.FRAMEWORK_MODES)).toBe(true);
        });

        test('NON_ERGODICITY_THRESHOLD = 0.60', () => {
            expect(M.NON_ERGODICITY_THRESHOLD).toBe(0.60);
        });

        test('signal thresholds defined', () => {
            expect(M.VOL_EXPANSION_THRESHOLD).toBe(0.50);
            expect(M.SEQUENTIAL_DD_THRESHOLD).toBe(0.15);
            expect(M.LEVERAGE_INCREASE_THRESHOLD).toBe(0.30);
        });

        test('SIGNAL_WEIGHTS sum to 1.0', () => {
            const sum = Object.values(M.SIGNAL_WEIGHTS)
                .reduce((a, b) => a + b, 0);
            expect(sum).toBeCloseTo(1.0, 6);
        });

        test('SIGNAL_WEIGHTS: sequential_drawdown highest', () => {
            expect(M.SIGNAL_WEIGHTS.sequential_drawdown).toBe(0.45);
            expect(M.SIGNAL_WEIGHTS.vol_expansion).toBe(0.30);
            expect(M.SIGNAL_WEIGHTS.leverage_increase).toBe(0.25);
        });
    });

    describe('computeRecoveryRequired (pure)', () => {
        test('10% loss → ~11.1% recovery', () => {
            const r = M.computeRecoveryRequired({ lossPercent: 0.10 });
            expect(r.recoveryRequired).toBeCloseTo(0.1111, 3);
        });

        test('30% loss → ~42.86% recovery (PDF example)', () => {
            const r = M.computeRecoveryRequired({ lossPercent: 0.30 });
            expect(r.recoveryRequired).toBeCloseTo(0.4286, 3);
        });

        test('50% loss → 100% recovery', () => {
            const r = M.computeRecoveryRequired({ lossPercent: 0.50 });
            expect(r.recoveryRequired).toBeCloseTo(1.0, 6);
        });

        test('0% loss → 0% recovery', () => {
            const r = M.computeRecoveryRequired({ lossPercent: 0 });
            expect(r.recoveryRequired).toBe(0);
        });

        test('100% loss → throws (cannot recover from total loss)', () => {
            expect(() => M.computeRecoveryRequired({
                lossPercent: 1.0
            })).toThrow(/total loss|cannot recover/);
        });

        test('out-of-range throws', () => {
            expect(() => M.computeRecoveryRequired({
                lossPercent: 1.5
            })).toThrow();
            expect(() => M.computeRecoveryRequired({
                lossPercent: -0.1
            })).toThrow();
        });
    });

    describe('computeNonErgodicityScore (pure)', () => {
        test('all-zero signals → 0', () => {
            const r = M.computeNonErgodicityScore({
                volExpansionRate: 0,
                sequentialDrawdown: 0,
                relativeLeverageIncrease: 0
            });
            expect(r.nonErgodicityScore).toBe(0);
        });

        test('all-max signals → 1.0', () => {
            const r = M.computeNonErgodicityScore({
                volExpansionRate: 2.0,    // 4x threshold
                sequentialDrawdown: 0.50, // 3.3x threshold
                relativeLeverageIncrease: 1.0  // 3.3x threshold
            });
            expect(r.nonErgodicityScore).toBe(1.0);
        });

        test('single max sequential_drawdown gives 0.45 (its weight)', () => {
            const r = M.computeNonErgodicityScore({
                volExpansionRate: 0,
                sequentialDrawdown: 0.30,  // 2x threshold → clamped to 1
                relativeLeverageIncrease: 0
            });
            expect(r.nonErgodicityScore).toBeCloseTo(0.45, 6);
        });

        test('signal at exactly threshold normalized to 1.0', () => {
            // sequential_dd at threshold (0.15) → 1.0 normalized × 0.45 weight = 0.45
            const r = M.computeNonErgodicityScore({
                volExpansionRate: 0,
                sequentialDrawdown: 0.15,
                relativeLeverageIncrease: 0
            });
            expect(r.nonErgodicityScore).toBeCloseTo(0.45, 6);
        });

        test('signal at half threshold normalized to 0.5', () => {
            // sequential_dd at 0.075 = 0.5 of threshold → 0.5 × 0.45 weight = 0.225
            const r = M.computeNonErgodicityScore({
                volExpansionRate: 0,
                sequentialDrawdown: 0.075,
                relativeLeverageIncrease: 0
            });
            expect(r.nonErgodicityScore).toBeCloseTo(0.225, 6);
        });

        test('combined moderate signals', () => {
            // vol_expansion at threshold = 1.0 × 0.30 = 0.30
            // sequential_dd at threshold = 1.0 × 0.45 = 0.45
            // leverage at half threshold = 0.5 × 0.25 = 0.125
            // total = 0.875 (clamped)
            const r = M.computeNonErgodicityScore({
                volExpansionRate: 0.50,
                sequentialDrawdown: 0.15,
                relativeLeverageIncrease: 0.15
            });
            expect(r.nonErgodicityScore).toBeCloseTo(0.875, 4);
        });
    });

    describe('classifyRegime (pure)', () => {
        test('score < 0.60 → ergodic_normal', () => {
            expect(M.classifyRegime({ nonErgodicityScore: 0.40 })
                .regime).toBe('ergodic_normal');
        });

        test('score ≥ 0.60 → non_ergodic_survival', () => {
            expect(M.classifyRegime({ nonErgodicityScore: 0.75 })
                .regime).toBe('non_ergodic_survival');
        });

        test('boundary 0.60 → non_ergodic_survival', () => {
            expect(M.classifyRegime({ nonErgodicityScore: 0.60 })
                .regime).toBe('non_ergodic_survival');
        });

        test('out-of-range throws', () => {
            expect(() => M.classifyRegime({
                nonErgodicityScore: 1.5
            })).toThrow();
        });
    });

    describe('selectFrameworkMode (pure)', () => {
        test('ergodic_normal → expected_value', () => {
            expect(M.selectFrameworkMode({
                regime: 'ergodic_normal'
            }).frameworkMode).toBe('expected_value');
        });

        test('non_ergodic_survival → minimax_survival', () => {
            expect(M.selectFrameworkMode({
                regime: 'non_ergodic_survival'
            }).frameworkMode).toBe('minimax_survival');
        });

        test('invalid regime throws', () => {
            expect(() => M.selectFrameworkMode({
                regime: 'BOGUS'
            })).toThrow(/invalid regime/);
        });
    });

    describe('computeTriggeredSignals (pure)', () => {
        test('no signals exceed threshold', () => {
            const r = M.computeTriggeredSignals({
                volExpansionRate: 0.30,
                sequentialDrawdown: 0.10,
                relativeLeverageIncrease: 0.20
            });
            expect(r.triggeredSignals).toEqual([]);
        });

        test('only vol_expansion triggered', () => {
            const r = M.computeTriggeredSignals({
                volExpansionRate: 0.70,
                sequentialDrawdown: 0.10,
                relativeLeverageIncrease: 0.20
            });
            expect(r.triggeredSignals).toEqual(['vol_expansion']);
        });

        test('all three triggered', () => {
            const r = M.computeTriggeredSignals({
                volExpansionRate: 0.70,
                sequentialDrawdown: 0.20,
                relativeLeverageIncrease: 0.40
            });
            expect(r.triggeredSignals.sort()).toEqual([
                'leverage_increase',
                'sequential_drawdown',
                'vol_expansion'
            ]);
        });

        test('two triggered', () => {
            const r = M.computeTriggeredSignals({
                volExpansionRate: 0.30,
                sequentialDrawdown: 0.20,
                relativeLeverageIncrease: 0.40
            });
            expect(r.triggeredSignals.sort()).toEqual([
                'leverage_increase', 'sequential_drawdown'
            ]);
        });
    });

    describe('recordErgodicityAssessment (integration)', () => {
        test('benign signals → ergodic_normal + expected_value', () => {
            const r = M.recordErgodicityAssessment({
                userId: UID, resolvedEnv: ENV,
                assessmentId: 'p141_rec_ergodic',
                volExpansionRate: 0.10,
                sequentialDrawdown: 0.02,
                relativeLeverageIncrease: 0.05,
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.regime).toBe('ergodic_normal');
            expect(r.frameworkMode).toBe('expected_value');
            expect(r.triggeredSignals).toEqual([]);
        });

        test('all-3 signals strong → non_ergodic_survival + minimax_survival', () => {
            const r = M.recordErgodicityAssessment({
                userId: UID, resolvedEnv: ENV,
                assessmentId: 'p141_rec_nonergodic',
                volExpansionRate: 1.0,        // 2x threshold
                sequentialDrawdown: 0.30,      // 2x threshold
                relativeLeverageIncrease: 0.6, // 2x threshold
                ts: _now()
            });
            expect(r.regime).toBe('non_ergodic_survival');
            expect(r.frameworkMode).toBe('minimax_survival');
            expect(r.triggeredSignals.length).toBe(3);
        });

        test('boundary case 0.60 → non_ergodic', () => {
            // sequential_dd at threshold → 0.45 weight contribution
            // vol_expansion at threshold → 0.30 weight contribution
            // total = 0.75 ≥ 0.60
            const r = M.recordErgodicityAssessment({
                userId: UID, resolvedEnv: ENV,
                assessmentId: 'p141_rec_boundary',
                volExpansionRate: 0.50,
                sequentialDrawdown: 0.15,
                relativeLeverageIncrease: 0,
                ts: _now()
            });
            expect(r.regime).toBe('non_ergodic_survival');
        });

        test('duplicate assessmentId throws', () => {
            M.recordErgodicityAssessment({
                userId: UID, resolvedEnv: ENV,
                assessmentId: 'p141_rec_dup',
                volExpansionRate: 0.1,
                sequentialDrawdown: 0.02,
                relativeLeverageIncrease: 0.05,
                ts: _now()
            });
            expect(() => M.recordErgodicityAssessment({
                userId: UID, resolvedEnv: ENV,
                assessmentId: 'p141_rec_dup',
                volExpansionRate: 0.2,
                sequentialDrawdown: 0.04,
                relativeLeverageIncrease: 0.1,
                ts: _now()
            })).toThrow(/duplicate/);
        });

        test('negative sequential_drawdown throws', () => {
            expect(() => M.recordErgodicityAssessment({
                userId: UID, resolvedEnv: ENV,
                assessmentId: 'p141_rec_bad',
                volExpansionRate: 0.1,
                sequentialDrawdown: -0.05,
                relativeLeverageIncrease: 0.05,
                ts: _now()
            })).toThrow();
        });
    });

    describe('recordRegimeTransition', () => {
        test('persists transition', () => {
            const r = M.recordRegimeTransition({
                userId: UID_TRANS, resolvedEnv: ENV,
                transitionId: 'p141_trans_1',
                fromRegime: 'ergodic_normal',
                toRegime: 'non_ergodic_survival',
                triggerSignals: ['vol_expansion', 'sequential_drawdown'],
                ts: _now()
            });
            expect(r.recorded).toBe(true);
        });

        test('duplicate transitionId throws', () => {
            M.recordRegimeTransition({
                userId: UID_TRANS, resolvedEnv: ENV,
                transitionId: 'p141_trans_dup',
                fromRegime: 'ergodic_normal',
                toRegime: 'non_ergodic_survival',
                triggerSignals: [],
                ts: _now()
            });
            expect(() => M.recordRegimeTransition({
                userId: UID_TRANS, resolvedEnv: ENV,
                transitionId: 'p141_trans_dup',
                fromRegime: 'non_ergodic_survival',
                toRegime: 'ergodic_normal',
                triggerSignals: [],
                ts: _now()
            })).toThrow(/duplicate/);
        });

        test('invalid regime throws', () => {
            expect(() => M.recordRegimeTransition({
                userId: UID_TRANS, resolvedEnv: ENV,
                transitionId: 'p141_trans_bad',
                fromRegime: 'BOGUS',
                toRegime: 'non_ergodic_survival',
                triggerSignals: [],
                ts: _now()
            })).toThrow();
        });
    });

    describe('getLatestAssessment', () => {
        test('returns most recent or null', () => {
            const u = UID_LATEST;
            M.recordErgodicityAssessment({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'p141_lat_old',
                volExpansionRate: 0.1, sequentialDrawdown: 0.02,
                relativeLeverageIncrease: 0.05, ts: 1000
            });
            M.recordErgodicityAssessment({
                userId: u, resolvedEnv: ENV,
                assessmentId: 'p141_lat_new',
                volExpansionRate: 1.0, sequentialDrawdown: 0.30,
                relativeLeverageIncrease: 0.6, ts: 2000
            });
            const r = M.getLatestAssessment({
                userId: u, resolvedEnv: ENV
            });
            expect(r).not.toBeNull();
            expect(r.assessmentId).toBe('p141_lat_new');
            expect(r.regime).toBe('non_ergodic_survival');
        });

        test('returns null when no assessments', () => {
            const r = M.getLatestAssessment({
                userId: UID_LATEST, resolvedEnv: 'REAL'
            });
            expect(r).toBeNull();
        });
    });

    describe('getRegimeHistory', () => {
        test('returns history DESC by ts', () => {
            const u = UID_HIST;
            for (let i = 0; i < 4; i++) {
                M.recordErgodicityAssessment({
                    userId: u, resolvedEnv: ENV,
                    assessmentId: `p141_h_${i}`,
                    volExpansionRate: 0.1,
                    sequentialDrawdown: 0.02,
                    relativeLeverageIncrease: 0.05,
                    ts: 1000 + i * 100
                });
            }
            const rows = M.getRegimeHistory({
                userId: u, resolvedEnv: ENV, limit: 10
            });
            expect(rows.length).toBe(4);
            expect(rows[0].assessmentId).toBe('p141_h_3');
            expect(rows[3].assessmentId).toBe('p141_h_0');
        });
    });

    describe('isolation per user × env', () => {
        test('uid A cannot see uid B assessments', () => {
            M.recordErgodicityAssessment({
                userId: UID_ISO_A, resolvedEnv: ENV,
                assessmentId: 'p141_iso_a',
                volExpansionRate: 0.1, sequentialDrawdown: 0.02,
                relativeLeverageIncrease: 0.05, ts: 1000
            });
            M.recordErgodicityAssessment({
                userId: UID_ISO_B, resolvedEnv: ENV,
                assessmentId: 'p141_iso_b',
                volExpansionRate: 0.1, sequentialDrawdown: 0.02,
                relativeLeverageIncrease: 0.05, ts: 1000
            });
            const rows = M.getRegimeHistory({
                userId: UID_ISO_A, resolvedEnv: ENV, limit: 10
            });
            expect(rows.every(r => r.assessmentId !== 'p141_iso_b')).toBe(true);
        });

        test('DEMO env cannot see TESTNET env', () => {
            M.recordErgodicityAssessment({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                assessmentId: 'p141_env_demo',
                volExpansionRate: 0.1, sequentialDrawdown: 0.02,
                relativeLeverageIncrease: 0.05, ts: 1000
            });
            M.recordErgodicityAssessment({
                userId: UID_ENV, resolvedEnv: 'TESTNET',
                assessmentId: 'p141_env_testnet',
                volExpansionRate: 0.1, sequentialDrawdown: 0.02,
                relativeLeverageIncrease: 0.05, ts: 1000
            });
            const rows = M.getRegimeHistory({
                userId: UID_ENV, resolvedEnv: 'DEMO', limit: 10
            });
            expect(rows.every(r => r.assessmentId !== 'p141_env_testnet')).toBe(true);
        });
    });
});
