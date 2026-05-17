'use strict';

/**
 * OMEGA §150 META-EPISTEMIC SANDBOX / ALTERNATE LAWS OF MIND LAB.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt lines 4924-4982.
 *
 * "daca as schimba regulile dupa care decid ce inseamna a sti ceva,
 *  as deveni mai bun sau doar mai exotic?"
 *
 * Tests FIRST per TDD discipline.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p150-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/_meta/metaEpistemicSandbox');

const UID = 9150;
const UID_REG = 9250;
const UID_EVAL = 9350;
const UID_TRANS = 9450;
const UID_GET = 9550;
const UID_ISO_A = 9650;
const UID_ISO_B = 9750;
const UID_ENV = 9850;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    const uids = [UID, UID_REG, UID_EVAL, UID_TRANS, UID_GET,
                  UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_epistemic_regime_evaluations WHERE user_id IN (${placeholders})`).run(...uids);
    db.prepare(`DELETE FROM ml_epistemic_regime_candidates WHERE user_id IN (${placeholders})`).run(...uids);
}
beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §150 META-EPISTEMIC SANDBOX', () => {

    describe('Migrations 298+299', () => {
        test('298 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('298_ml_epistemic_regime_candidates')).toBeTruthy();
        });
        test('299 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('299_ml_epistemic_regime_evaluations')).toBeTruthy();
        });
        test('declared_priority CHECK enum on candidates', () => {
            expect(() => db.prepare(`INSERT INTO ml_epistemic_regime_candidates
                (user_id, resolved_env, regime_id, regime_name, declared_priority,
                 description, status, registered_at, last_transition_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'r_bk', 'name', 'BOGUS',
                    'd', 'quarantined', _now(), _now())).toThrow();
        });
        test('status CHECK enum on candidates', () => {
            expect(() => db.prepare(`INSERT INTO ml_epistemic_regime_candidates
                (user_id, resolved_env, regime_id, regime_name, declared_priority,
                 description, status, registered_at, last_transition_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'r_st', 'name', 'evidence',
                    'd', 'BOGUS', _now(), _now())).toThrow();
        });
        test('verdict CHECK enum on evaluations', () => {
            db.prepare(`INSERT INTO ml_epistemic_regime_candidates
                (user_id, resolved_env, regime_id, regime_name, declared_priority,
                 description, status, registered_at, last_transition_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'r_for_ev1', 'n', 'evidence',
                    'd', 'quarantined', _now(), _now());
            expect(() => db.prepare(`INSERT INTO ml_epistemic_regime_evaluations
                (user_id, resolved_env, evaluation_id, regime_id,
                 eval_window_start_ts, eval_window_end_ts,
                 robustness_score, coherence_score, humility_score,
                 speed_score, tail_survival_score, alpha_quality_score,
                 composite_score, comparison_baseline_regime_id, verdict, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'e_bk', 'r_for_ev1', 100, 200,
                    0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, null,
                    'BOGUS', _now())).toThrow();
        });
        test('regime_id UNIQUE', () => {
            const stmt = db.prepare(`INSERT INTO ml_epistemic_regime_candidates
                (user_id, resolved_env, regime_id, regime_name, declared_priority,
                 description, status, registered_at, last_transition_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            stmt.run(UID, ENV, 'r_dup', 'n', 'evidence',
                'd', 'quarantined', _now(), _now());
            expect(() => stmt.run(UID, ENV, 'r_dup', 'n2', 'causality',
                'd2', 'quarantined', _now(), _now())).toThrow();
        });
        test('range CHECK on score columns', () => {
            db.prepare(`INSERT INTO ml_epistemic_regime_candidates
                (user_id, resolved_env, regime_id, regime_name, declared_priority,
                 description, status, registered_at, last_transition_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'r_for_ev2', 'n', 'evidence',
                    'd', 'quarantined', _now(), _now());
            expect(() => db.prepare(`INSERT INTO ml_epistemic_regime_evaluations
                (user_id, resolved_env, evaluation_id, regime_id,
                 eval_window_start_ts, eval_window_end_ts,
                 robustness_score, coherence_score, humility_score,
                 speed_score, tail_survival_score, alpha_quality_score,
                 composite_score, comparison_baseline_regime_id, verdict, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'e_br', 'r_for_ev2', 100, 200,
                    1.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, null,
                    'pass', _now())).toThrow();
        });
        test('FK ON DELETE RESTRICT on regime_id', () => {
            db.prepare(`INSERT INTO ml_epistemic_regime_candidates
                (user_id, resolved_env, regime_id, regime_name, declared_priority,
                 description, status, registered_at, last_transition_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'r_fk', 'n', 'evidence', 'd',
                    'quarantined', _now(), _now());
            db.prepare(`INSERT INTO ml_epistemic_regime_evaluations
                (user_id, resolved_env, evaluation_id, regime_id,
                 eval_window_start_ts, eval_window_end_ts,
                 robustness_score, coherence_score, humility_score,
                 speed_score, tail_survival_score, alpha_quality_score,
                 composite_score, comparison_baseline_regime_id, verdict, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'e_fk', 'r_fk', 100, 200,
                    0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, null,
                    'pass', _now());
            expect(() => db.prepare(`DELETE FROM ml_epistemic_regime_candidates WHERE regime_id=?`).run('r_fk')).toThrow();
            db.prepare(`DELETE FROM ml_epistemic_regime_evaluations WHERE evaluation_id=?`).run('e_fk');
            db.prepare(`DELETE FROM ml_epistemic_regime_candidates WHERE regime_id=?`).run('r_fk');
        });
    });

    describe('Constants', () => {
        test('DECLARED_PRIORITIES frozen 6 (canonical PDF list)', () => {
            expect(M.DECLARED_PRIORITIES).toEqual([
                'evidence', 'causality', 'prudence',
                'simplicity', 'antifragility', 'dissent'
            ]);
            expect(Object.isFrozen(M.DECLARED_PRIORITIES)).toBe(true);
        });
        test('REGIME_STATUSES frozen 5 (admission path + rejected)', () => {
            expect(M.REGIME_STATUSES).toEqual([
                'quarantined', 'shadow', 'canary', 'live', 'rejected'
            ]);
            expect(Object.isFrozen(M.REGIME_STATUSES)).toBe(true);
        });
        test('EVAL_AXES frozen 6 (canonical PDF list)', () => {
            expect(M.EVAL_AXES).toEqual([
                'robustness', 'coherence', 'humility',
                'speed', 'tail_survival', 'alpha_quality'
            ]);
            expect(Object.isFrozen(M.EVAL_AXES)).toBe(true);
        });
        test('VERDICTS frozen 3', () => {
            expect(M.VERDICTS).toEqual(['pass', 'fail', 'inconclusive']);
            expect(Object.isFrozen(M.VERDICTS)).toBe(true);
        });
        test('COMPOSITE_WEIGHTS sum to 1.0 (tail_survival dominant)', () => {
            const sum = Object.values(M.COMPOSITE_WEIGHTS).reduce((a, b) => a + b, 0);
            expect(sum).toBeCloseTo(1.0, 6);
            // tail_survival is the highest weight per canonical "novelty fără
            // supraviețuire respinsă"
            const max = Math.max(...Object.values(M.COMPOSITE_WEIGHTS));
            expect(M.COMPOSITE_WEIGHTS.tail_survival).toBe(max);
        });
        test('PASS_THRESHOLD = 0.65', () => {
            expect(M.PASS_THRESHOLD).toBe(0.65);
        });
        test('FAIL_THRESHOLD = 0.40', () => {
            expect(M.FAIL_THRESHOLD).toBe(0.40);
        });
        test('MIN_AXIS_FLOOR = 0.40', () => {
            expect(M.MIN_AXIS_FLOOR).toBe(0.40);
        });
    });

    describe('computeCompositeScore (pure)', () => {
        test('all axes 1.0 → composite 1.0', () => {
            const r = M.computeCompositeScore({
                axes: {
                    robustness: 1, coherence: 1, humility: 1,
                    speed: 1, tail_survival: 1, alpha_quality: 1
                }
            });
            expect(r.composite).toBeCloseTo(1.0, 6);
        });
        test('all axes 0 → composite 0', () => {
            const r = M.computeCompositeScore({
                axes: {
                    robustness: 0, coherence: 0, humility: 0,
                    speed: 0, tail_survival: 0, alpha_quality: 0
                }
            });
            expect(r.composite).toBe(0);
        });
        test('tail_survival weighted heaviest', () => {
            // Compare: only tail_survival=1 vs only alpha_quality=1
            const tailOnly = M.computeCompositeScore({
                axes: {
                    robustness: 0, coherence: 0, humility: 0,
                    speed: 0, tail_survival: 1, alpha_quality: 0
                }
            });
            const alphaOnly = M.computeCompositeScore({
                axes: {
                    robustness: 0, coherence: 0, humility: 0,
                    speed: 0, tail_survival: 0, alpha_quality: 1
                }
            });
            expect(tailOnly.composite).toBeGreaterThan(alphaOnly.composite);
        });
        test('missing axis throws', () => {
            expect(() => M.computeCompositeScore({
                axes: {
                    robustness: 1, coherence: 1, humility: 1,
                    speed: 1, tail_survival: 1
                    // alpha_quality missing
                }
            })).toThrow();
        });
        test('out-of-range axis throws', () => {
            expect(() => M.computeCompositeScore({
                axes: {
                    robustness: 1.5, coherence: 1, humility: 1,
                    speed: 1, tail_survival: 1, alpha_quality: 1
                }
            })).toThrow();
        });
    });

    describe('classifyVerdict (pure)', () => {
        test('composite ≥ 0.65 AND all axes ≥ floor → pass', () => {
            const r = M.classifyVerdict({
                compositeScore: 0.80,
                axes: {
                    robustness: 0.80, coherence: 0.75, humility: 0.70,
                    speed: 0.60, tail_survival: 0.85, alpha_quality: 0.70
                }
            });
            expect(r.verdict).toBe('pass');
        });
        test('composite ≥ 0.65 BUT one axis < floor → inconclusive', () => {
            // Composite ok but humility 0.20 below 0.40 floor — can't pass
            // even with strong tail+alpha
            const r = M.classifyVerdict({
                compositeScore: 0.70,
                axes: {
                    robustness: 0.80, coherence: 0.80, humility: 0.20,
                    speed: 0.80, tail_survival: 0.90, alpha_quality: 0.80
                }
            });
            expect(r.verdict).toBe('inconclusive');
        });
        test('composite < 0.40 → fail', () => {
            const r = M.classifyVerdict({
                compositeScore: 0.30,
                axes: {
                    robustness: 0.30, coherence: 0.30, humility: 0.30,
                    speed: 0.30, tail_survival: 0.30, alpha_quality: 0.30
                }
            });
            expect(r.verdict).toBe('fail');
        });
        test('composite 0.40..0.65 → inconclusive', () => {
            const r = M.classifyVerdict({
                compositeScore: 0.55,
                axes: {
                    robustness: 0.50, coherence: 0.50, humility: 0.50,
                    speed: 0.50, tail_survival: 0.60, alpha_quality: 0.55
                }
            });
            expect(r.verdict).toBe('inconclusive');
        });
        test('boundary 0.65 with all axes ok → pass', () => {
            const r = M.classifyVerdict({
                compositeScore: 0.65,
                axes: {
                    robustness: 0.50, coherence: 0.50, humility: 0.50,
                    speed: 0.50, tail_survival: 0.90, alpha_quality: 0.50
                }
            });
            expect(r.verdict).toBe('pass');
        });
    });

    describe('validStatusTransition (pure)', () => {
        test('quarantined → shadow valid', () => {
            expect(M.validStatusTransition({
                fromStatus: 'quarantined', toStatus: 'shadow'
            }).valid).toBe(true);
        });
        test('shadow → canary valid', () => {
            expect(M.validStatusTransition({
                fromStatus: 'shadow', toStatus: 'canary'
            }).valid).toBe(true);
        });
        test('canary → live valid', () => {
            expect(M.validStatusTransition({
                fromStatus: 'canary', toStatus: 'live'
            }).valid).toBe(true);
        });
        test('any → rejected valid', () => {
            expect(M.validStatusTransition({
                fromStatus: 'quarantined', toStatus: 'rejected'
            }).valid).toBe(true);
            expect(M.validStatusTransition({
                fromStatus: 'shadow', toStatus: 'rejected'
            }).valid).toBe(true);
            expect(M.validStatusTransition({
                fromStatus: 'live', toStatus: 'rejected'
            }).valid).toBe(true);
        });
        test('quarantined → live INVALID (skip path)', () => {
            expect(M.validStatusTransition({
                fromStatus: 'quarantined', toStatus: 'live'
            }).valid).toBe(false);
        });
        test('quarantined → canary INVALID (skip path)', () => {
            expect(M.validStatusTransition({
                fromStatus: 'quarantined', toStatus: 'canary'
            }).valid).toBe(false);
        });
        test('live → shadow INVALID (no demotion)', () => {
            expect(M.validStatusTransition({
                fromStatus: 'live', toStatus: 'shadow'
            }).valid).toBe(false);
        });
        test('rejected → anything INVALID (terminal)', () => {
            expect(M.validStatusTransition({
                fromStatus: 'rejected', toStatus: 'shadow'
            }).valid).toBe(false);
        });
        test('same status INVALID', () => {
            expect(M.validStatusTransition({
                fromStatus: 'shadow', toStatus: 'shadow'
            }).valid).toBe(false);
        });
        test('invalid status throws', () => {
            expect(() => M.validStatusTransition({
                fromStatus: 'BOGUS', toStatus: 'shadow'
            })).toThrow();
        });
    });

    describe('registerRegime', () => {
        test('always starts as quarantined', () => {
            const r = M.registerRegime({
                userId: UID_REG, resolvedEnv: ENV,
                regimeId: 'rr_q',
                regimeName: 'Evidence-First Strict',
                declaredPriority: 'evidence',
                description: 'demands p-value < 0.01 with replication',
                ts: _now()
            });
            expect(r.registered).toBe(true);
            expect(r.status).toBe('quarantined');
        });
        test('invalid declaredPriority throws', () => {
            expect(() => M.registerRegime({
                userId: UID_REG, resolvedEnv: ENV,
                regimeId: 'rr_bad',
                regimeName: 'n',
                declaredPriority: 'BOGUS',
                description: 'd',
                ts: _now()
            })).toThrow();
        });
        test('duplicate regimeId throws', () => {
            M.registerRegime({
                userId: UID_REG, resolvedEnv: ENV,
                regimeId: 'rr_dup',
                regimeName: 'n', declaredPriority: 'evidence',
                description: 'd', ts: _now()
            });
            expect(() => M.registerRegime({
                userId: UID_REG, resolvedEnv: ENV,
                regimeId: 'rr_dup',
                regimeName: 'n2', declaredPriority: 'causality',
                description: 'd2', ts: _now()
            })).toThrow(/duplicate/);
        });
    });

    describe('recordEvaluation (integration)', () => {
        test('strong axes → pass verdict', () => {
            M.registerRegime({
                userId: UID_EVAL, resolvedEnv: ENV,
                regimeId: 'ev_strong', regimeName: 'n',
                declaredPriority: 'antifragility',
                description: 'd', ts: _now()
            });
            const r = M.recordEvaluation({
                userId: UID_EVAL, resolvedEnv: ENV,
                evaluationId: 'ev_pass',
                regimeId: 'ev_strong',
                evalWindowStartTs: 1000,
                evalWindowEndTs: 2000,
                axes: {
                    robustness: 0.80, coherence: 0.75, humility: 0.70,
                    speed: 0.60, tail_survival: 0.90, alpha_quality: 0.70
                },
                ts: 3000
            });
            expect(r.recorded).toBe(true);
            expect(r.verdict).toBe('pass');
            expect(r.compositeScore).toBeGreaterThanOrEqual(0.65);
        });
        test('weak axes → fail verdict', () => {
            M.registerRegime({
                userId: UID_EVAL, resolvedEnv: ENV,
                regimeId: 'ev_weak', regimeName: 'n',
                declaredPriority: 'simplicity',
                description: 'd', ts: _now()
            });
            const r = M.recordEvaluation({
                userId: UID_EVAL, resolvedEnv: ENV,
                evaluationId: 'ev_fail',
                regimeId: 'ev_weak',
                evalWindowStartTs: 1000, evalWindowEndTs: 2000,
                axes: {
                    robustness: 0.20, coherence: 0.25, humility: 0.20,
                    speed: 0.30, tail_survival: 0.20, alpha_quality: 0.25
                },
                ts: 3000
            });
            expect(r.verdict).toBe('fail');
        });
        test('with baseline regime comparison', () => {
            M.registerRegime({
                userId: UID_EVAL, resolvedEnv: ENV,
                regimeId: 'ev_baseline', regimeName: 'baseline',
                declaredPriority: 'evidence',
                description: 'd', ts: _now()
            });
            M.registerRegime({
                userId: UID_EVAL, resolvedEnv: ENV,
                regimeId: 'ev_cand', regimeName: 'candidate',
                declaredPriority: 'dissent',
                description: 'd', ts: _now()
            });
            const r = M.recordEvaluation({
                userId: UID_EVAL, resolvedEnv: ENV,
                evaluationId: 'ev_with_base',
                regimeId: 'ev_cand',
                comparisonBaselineRegimeId: 'ev_baseline',
                evalWindowStartTs: 1000, evalWindowEndTs: 2000,
                axes: {
                    robustness: 0.70, coherence: 0.70, humility: 0.70,
                    speed: 0.60, tail_survival: 0.80, alpha_quality: 0.65
                },
                ts: 3000
            });
            expect(r.recorded).toBe(true);
            expect(r.comparisonBaselineRegimeId).toBe('ev_baseline');
        });
        test('evaluation on nonexistent regime throws (FK)', () => {
            expect(() => M.recordEvaluation({
                userId: UID_EVAL, resolvedEnv: ENV,
                evaluationId: 'ev_orph',
                regimeId: 'ev_nonexistent',
                evalWindowStartTs: 1000, evalWindowEndTs: 2000,
                axes: {
                    robustness: 0.5, coherence: 0.5, humility: 0.5,
                    speed: 0.5, tail_survival: 0.5, alpha_quality: 0.5
                },
                ts: _now()
            })).toThrow();
        });
        test('duplicate evaluationId throws', () => {
            M.registerRegime({
                userId: UID_EVAL, resolvedEnv: ENV,
                regimeId: 'ev_dup_reg', regimeName: 'n',
                declaredPriority: 'evidence',
                description: 'd', ts: _now()
            });
            M.recordEvaluation({
                userId: UID_EVAL, resolvedEnv: ENV,
                evaluationId: 'ev_dup_id',
                regimeId: 'ev_dup_reg',
                evalWindowStartTs: 1000, evalWindowEndTs: 2000,
                axes: {
                    robustness: 0.5, coherence: 0.5, humility: 0.5,
                    speed: 0.5, tail_survival: 0.5, alpha_quality: 0.5
                },
                ts: 3000
            });
            expect(() => M.recordEvaluation({
                userId: UID_EVAL, resolvedEnv: ENV,
                evaluationId: 'ev_dup_id',
                regimeId: 'ev_dup_reg',
                evalWindowStartTs: 1000, evalWindowEndTs: 2000,
                axes: {
                    robustness: 0.5, coherence: 0.5, humility: 0.5,
                    speed: 0.5, tail_survival: 0.5, alpha_quality: 0.5
                },
                ts: 4000
            })).toThrow(/duplicate/);
        });
    });

    describe('transitionRegimeStatus', () => {
        function _setupRegimeWithVerdict(uid, regimeId, verdict, status) {
            M.registerRegime({
                userId: uid, resolvedEnv: ENV,
                regimeId, regimeName: 'n',
                declaredPriority: 'evidence',
                description: 'd', ts: _now()
            });
            // Direct DB update to set status (bypassing transition validation
            // for test setup)
            db.prepare(`UPDATE ml_epistemic_regime_candidates SET status=? WHERE regime_id=?`)
                .run(status, regimeId);
            // Latest evaluation with explicit verdict
            const axes = verdict === 'pass'
                ? { robustness: 0.80, coherence: 0.75, humility: 0.70,
                    speed: 0.60, tail_survival: 0.90, alpha_quality: 0.70 }
                : verdict === 'fail'
                ? { robustness: 0.20, coherence: 0.20, humility: 0.20,
                    speed: 0.20, tail_survival: 0.20, alpha_quality: 0.20 }
                : { robustness: 0.50, coherence: 0.50, humility: 0.50,
                    speed: 0.50, tail_survival: 0.55, alpha_quality: 0.50 };
            M.recordEvaluation({
                userId: uid, resolvedEnv: ENV,
                evaluationId: `setup_${regimeId}`,
                regimeId,
                evalWindowStartTs: 1000, evalWindowEndTs: 2000,
                axes, ts: 3000
            });
        }
        test('valid transition with pass verdict succeeds', () => {
            _setupRegimeWithVerdict(UID_TRANS, 'tr_pass', 'pass', 'quarantined');
            const r = M.transitionRegimeStatus({
                userId: UID_TRANS, resolvedEnv: ENV,
                regimeId: 'tr_pass',
                newStatus: 'shadow',
                ts: _now(),
                note: 'verdict passed'
            });
            expect(r.transitioned).toBe(true);
            expect(r.fromStatus).toBe('quarantined');
            expect(r.toStatus).toBe('shadow');
        });
        test('promotion with fail verdict blocked', () => {
            _setupRegimeWithVerdict(UID_TRANS, 'tr_fail', 'fail', 'quarantined');
            expect(() => M.transitionRegimeStatus({
                userId: UID_TRANS, resolvedEnv: ENV,
                regimeId: 'tr_fail',
                newStatus: 'shadow',
                ts: _now()
            })).toThrow(/verdict|fail|block/i);
        });
        test('promotion without any evaluation blocked', () => {
            M.registerRegime({
                userId: UID_TRANS, resolvedEnv: ENV,
                regimeId: 'tr_noeval', regimeName: 'n',
                declaredPriority: 'evidence',
                description: 'd', ts: _now()
            });
            expect(() => M.transitionRegimeStatus({
                userId: UID_TRANS, resolvedEnv: ENV,
                regimeId: 'tr_noeval',
                newStatus: 'shadow',
                ts: _now()
            })).toThrow(/no.*evaluation|evaluation.*required/i);
        });
        test('rejection bypasses verdict requirement (any → rejected)', () => {
            _setupRegimeWithVerdict(UID_TRANS, 'tr_rej', 'fail', 'quarantined');
            const r = M.transitionRegimeStatus({
                userId: UID_TRANS, resolvedEnv: ENV,
                regimeId: 'tr_rej',
                newStatus: 'rejected',
                ts: _now(),
                note: 'governance rejected'
            });
            expect(r.transitioned).toBe(true);
        });
        test('invalid path (skip) throws', () => {
            _setupRegimeWithVerdict(UID_TRANS, 'tr_skip', 'pass', 'quarantined');
            expect(() => M.transitionRegimeStatus({
                userId: UID_TRANS, resolvedEnv: ENV,
                regimeId: 'tr_skip',
                newStatus: 'live',
                ts: _now()
            })).toThrow(/invalid.*transition|transition.*invalid/i);
        });
        test('transition on nonexistent regime throws', () => {
            expect(() => M.transitionRegimeStatus({
                userId: UID_TRANS, resolvedEnv: ENV,
                regimeId: 'tr_nope',
                newStatus: 'shadow',
                ts: _now()
            })).toThrow(/not found/i);
        });
    });

    describe('getRegimes', () => {
        test('returns all regimes for user × env', () => {
            M.registerRegime({
                userId: UID_GET, resolvedEnv: ENV,
                regimeId: 'gr_1', regimeName: 'n',
                declaredPriority: 'evidence',
                description: 'd', ts: _now()
            });
            M.registerRegime({
                userId: UID_GET, resolvedEnv: ENV,
                regimeId: 'gr_2', regimeName: 'n',
                declaredPriority: 'causality',
                description: 'd', ts: _now()
            });
            const r = M.getRegimes({
                userId: UID_GET, resolvedEnv: ENV
            });
            expect(r.length).toBe(2);
        });
        test('filter by status', () => {
            M.registerRegime({
                userId: UID_GET, resolvedEnv: ENV,
                regimeId: 'gr_q', regimeName: 'n',
                declaredPriority: 'evidence',
                description: 'd', ts: _now()
            });
            // Direct status set for filter test
            db.prepare(`UPDATE ml_epistemic_regime_candidates SET status=? WHERE regime_id=?`).run('rejected', 'gr_q');
            const q = M.getRegimes({
                userId: UID_GET, resolvedEnv: ENV,
                status: 'quarantined'
            });
            expect(q.length).toBe(0);
            const rej = M.getRegimes({
                userId: UID_GET, resolvedEnv: ENV,
                status: 'rejected'
            });
            expect(rej.length).toBe(1);
        });
    });

    describe('getLatestEvaluation', () => {
        test('returns most recent or null', () => {
            M.registerRegime({
                userId: UID_GET, resolvedEnv: ENV,
                regimeId: 'gl_r', regimeName: 'n',
                declaredPriority: 'evidence',
                description: 'd', ts: 1000
            });
            M.recordEvaluation({
                userId: UID_GET, resolvedEnv: ENV,
                evaluationId: 'gl_e1', regimeId: 'gl_r',
                evalWindowStartTs: 1000, evalWindowEndTs: 2000,
                axes: {
                    robustness: 0.5, coherence: 0.5, humility: 0.5,
                    speed: 0.5, tail_survival: 0.5, alpha_quality: 0.5
                },
                ts: 2000
            });
            M.recordEvaluation({
                userId: UID_GET, resolvedEnv: ENV,
                evaluationId: 'gl_e2', regimeId: 'gl_r',
                evalWindowStartTs: 2000, evalWindowEndTs: 3000,
                axes: {
                    robustness: 0.6, coherence: 0.6, humility: 0.6,
                    speed: 0.6, tail_survival: 0.6, alpha_quality: 0.6
                },
                ts: 3000
            });
            const r = M.getLatestEvaluation({
                userId: UID_GET, resolvedEnv: ENV,
                regimeId: 'gl_r'
            });
            expect(r.evaluationId).toBe('gl_e2');
        });
        test('returns null when no evaluations', () => {
            M.registerRegime({
                userId: UID_GET, resolvedEnv: ENV,
                regimeId: 'gl_no', regimeName: 'n',
                declaredPriority: 'evidence',
                description: 'd', ts: _now()
            });
            expect(M.getLatestEvaluation({
                userId: UID_GET, resolvedEnv: ENV,
                regimeId: 'gl_no'
            })).toBeNull();
        });
    });

    describe('isolation per user × env', () => {
        test('uid isolation', () => {
            M.registerRegime({
                userId: UID_ISO_A, resolvedEnv: ENV,
                regimeId: 'iso_a', regimeName: 'n',
                declaredPriority: 'evidence',
                description: 'd', ts: _now()
            });
            M.registerRegime({
                userId: UID_ISO_B, resolvedEnv: ENV,
                regimeId: 'iso_b', regimeName: 'n',
                declaredPriority: 'evidence',
                description: 'd', ts: _now()
            });
            const a = M.getRegimes({
                userId: UID_ISO_A, resolvedEnv: ENV
            });
            expect(a.every(r => r.regimeId !== 'iso_b')).toBe(true);
        });
        test('env isolation', () => {
            M.registerRegime({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                regimeId: 'env_demo', regimeName: 'n',
                declaredPriority: 'evidence',
                description: 'd', ts: _now()
            });
            const testnet = M.getRegimes({
                userId: UID_ENV, resolvedEnv: 'TESTNET'
            });
            expect(testnet).toEqual([]);
        });
    });
});
