'use strict';

/**
 * OMEGA §138 COUNTER-ONTOLOGY SANDBOX / ALIEN FRAME GENERATOR.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt lines 4091-4137.
 *
 * "daca limbajul meu de acum e prea sarac, prin ce alta lume conceptuala
 *  as putea intelege cazul?"
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p138-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/R5B_governance/counterOntologySandbox');

const UID = 9138;
const UID_EVAL = 9238;
const UID_COMP = 9338;
const UID_PROMOTE = 9438;
const UID_MODE = 9538;
const UID_ISO_A = 9638;
const UID_ISO_B = 9738;
const UID_ENV = 9838;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    const uids = [UID, UID_EVAL, UID_COMP, UID_PROMOTE, UID_MODE,
                  UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_alien_frames WHERE user_id IN (${placeholders})`).run(...uids);
    db.prepare(`DELETE FROM ml_alien_frame_comparisons WHERE user_id IN (${placeholders})`).run(...uids);
}

beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §138 COUNTER-ONTOLOGY SANDBOX', () => {

    describe('Migrations 261+262', () => {
        test('261_ml_alien_frames migration applied', () => {
            expect(db.prepare(
                "SELECT name FROM _migrations WHERE name = ?"
            ).get('261_ml_alien_frames')).toBeTruthy();
        });

        test('262_ml_alien_frame_comparisons migration applied', () => {
            expect(db.prepare(
                "SELECT name FROM _migrations WHERE name = ?"
            ).get('262_ml_alien_frame_comparisons')).toBeTruthy();
        });

        test('frame_id UNIQUE enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_alien_frames
                (user_id, resolved_env, frame_id, frame_name, frame_description,
                 primary_primitives_json, source_metaphor, mode,
                 explanatory_novelty, predictive_novelty, semantic_compression,
                 stability_score, overall_value_score, active, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            stmt.run(UID, ENV, 'p138_f_dup', 'name', 'desc',
                '[]', 'metaphor', 'sandbox', 0, 0, 0, 0, 0, 1, _now());
            expect(() => stmt.run(UID, ENV, 'p138_f_dup', 'name2', 'desc2',
                '[]', 'metaphor', 'shadow', 0.5, 0.5, 0.5, 0.5, 0.5, 1, _now())
            ).toThrow();
        });

        test('mode CHECK enum enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_alien_frames
                (user_id, resolved_env, frame_id, frame_name, frame_description,
                 primary_primitives_json, source_metaphor, mode,
                 explanatory_novelty, predictive_novelty, semantic_compression,
                 stability_score, overall_value_score, active, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p138_f_bad_mode', 'n', 'd',
                '[]', 'm', 'BOGUS', 0, 0, 0, 0, 0, 1, _now())
            ).toThrow();
        });

        test('active CHECK 0/1 enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_alien_frames
                (user_id, resolved_env, frame_id, frame_name, frame_description,
                 primary_primitives_json, source_metaphor, mode,
                 explanatory_novelty, predictive_novelty, semantic_compression,
                 stability_score, overall_value_score, active, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p138_f_bad_active', 'n', 'd',
                '[]', 'm', 'sandbox', 0, 0, 0, 0, 0, 2, _now())
            ).toThrow();
        });

        test('frame_advantage_score CHECK [-1,1] enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_alien_frame_comparisons
                (user_id, resolved_env, comparison_id, frame_id,
                 baseline_ontology_id, test_case_count,
                 frame_wins_count, baseline_wins_count,
                 draw_count, frame_advantage_score, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p138_c_bad_adv', 'f1',
                'baseline', 10, 5, 5, 0, 1.5, _now())
            ).toThrow();
        });

        test('comparison_id UNIQUE enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_alien_frame_comparisons
                (user_id, resolved_env, comparison_id, frame_id,
                 baseline_ontology_id, test_case_count,
                 frame_wins_count, baseline_wins_count,
                 draw_count, frame_advantage_score, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            stmt.run(UID, ENV, 'p138_c_dup', 'f1', 'b', 10, 5, 5, 0, 0, _now());
            expect(() => stmt.run(UID, ENV, 'p138_c_dup', 'f2', 'b', 10, 7, 3, 0, 0.4, _now())
            ).toThrow();
        });
    });

    describe('Constants', () => {
        test('FRAME_MODES frozen 3 entries (progression ladder)', () => {
            expect(M.FRAME_MODES).toEqual([
                'sandbox', 'shadow', 'live_candidate'
            ]);
            expect(Object.isFrozen(M.FRAME_MODES)).toBe(true);
        });

        test('EVALUATION_WEIGHTS sum to 1.0', () => {
            const sum = Object.values(M.EVALUATION_WEIGHTS)
                .reduce((a, b) => a + b, 0);
            expect(sum).toBeCloseTo(1.0, 6);
        });

        test('EVALUATION_WEIGHTS has 4 keys', () => {
            expect(Object.keys(M.EVALUATION_WEIGHTS).sort()).toEqual([
                'explanatory_novelty',
                'predictive_novelty',
                'semantic_compression',
                'stability'
            ]);
        });

        test('promotion thresholds', () => {
            expect(M.MIN_NOVELTY_FOR_PROMOTION).toBe(0.40);
            expect(M.MIN_VALUE_FOR_PROMOTION).toBe(0.50);
            expect(M.MIN_STABILITY_FOR_PROMOTION).toBe(0.30);
        });
    });

    describe('computeOverallValueScore (pure)', () => {
        test('all high → high value', () => {
            const r = M.computeOverallValueScore({
                explanatoryNovelty: 0.9,
                predictiveNovelty: 0.9,
                semanticCompression: 0.9,
                stability: 0.9
            });
            expect(r.valueScore).toBeCloseTo(0.9, 6);
        });

        test('all low → low value', () => {
            const r = M.computeOverallValueScore({
                explanatoryNovelty: 0.1,
                predictiveNovelty: 0.1,
                semanticCompression: 0.1,
                stability: 0.1
            });
            expect(r.valueScore).toBeCloseTo(0.1, 6);
        });

        test('mixed values', () => {
            // 0.5×0.25 + 0.8×0.30 + 0.4×0.20 + 0.6×0.25 = 0.125 + 0.24 + 0.08 + 0.15 = 0.595
            const r = M.computeOverallValueScore({
                explanatoryNovelty: 0.5,
                predictiveNovelty: 0.8,
                semanticCompression: 0.4,
                stability: 0.6
            });
            expect(r.valueScore).toBeCloseTo(0.595, 4);
        });

        test('out-of-range throws', () => {
            expect(() => M.computeOverallValueScore({
                explanatoryNovelty: 1.5,
                predictiveNovelty: 0.5,
                semanticCompression: 0.5,
                stability: 0.5
            })).toThrow();
        });

        test('missing input throws', () => {
            expect(() => M.computeOverallValueScore({
                explanatoryNovelty: 0.5,
                predictiveNovelty: 0.5
                // missing fields
            })).toThrow(/missing/);
        });
    });

    describe('evaluatePromotion (pure)', () => {
        test('sandbox + meets all criteria → promote_to_shadow', () => {
            const r = M.evaluatePromotion({
                currentMode: 'sandbox',
                valueScore: 0.7,
                explanatoryNovelty: 0.5,
                predictiveNovelty: 0.5,
                stability: 0.5
            });
            expect(r.verdict).toBe('promote_to_shadow');
        });

        test('sandbox + low value → stay', () => {
            const r = M.evaluatePromotion({
                currentMode: 'sandbox',
                valueScore: 0.3,
                explanatoryNovelty: 0.5,
                predictiveNovelty: 0.5,
                stability: 0.5
            });
            expect(r.verdict).toBe('stay');
        });

        test('sandbox + low novelty (both axes) → quarantine', () => {
            const r = M.evaluatePromotion({
                currentMode: 'sandbox',
                valueScore: 0.5,
                explanatoryNovelty: 0.1,
                predictiveNovelty: 0.1,
                stability: 0.4
            });
            expect(r.verdict).toBe('quarantine');
        });

        test('shadow + high value + stability → promote_to_live_candidate', () => {
            const r = M.evaluatePromotion({
                currentMode: 'shadow',
                valueScore: 0.75,
                explanatoryNovelty: 0.6,
                predictiveNovelty: 0.7,
                stability: 0.6
            });
            expect(r.verdict).toBe('promote_to_live_candidate');
        });

        test('shadow + low stability → stay', () => {
            const r = M.evaluatePromotion({
                currentMode: 'shadow',
                valueScore: 0.7,
                explanatoryNovelty: 0.6,
                predictiveNovelty: 0.6,
                stability: 0.15
            });
            expect(r.verdict).toBe('stay');
        });

        test('live_candidate → stay (terminal)', () => {
            const r = M.evaluatePromotion({
                currentMode: 'live_candidate',
                valueScore: 0.9,
                explanatoryNovelty: 0.8,
                predictiveNovelty: 0.8,
                stability: 0.8
            });
            expect(r.verdict).toBe('stay');
        });

        test('invalid mode throws', () => {
            expect(() => M.evaluatePromotion({
                currentMode: 'BOGUS',
                valueScore: 0.5,
                explanatoryNovelty: 0.5,
                predictiveNovelty: 0.5,
                stability: 0.5
            })).toThrow();
        });
    });

    describe('computeFrameAdvantage (pure)', () => {
        test('frame_wins all → 1', () => {
            const r = M.computeFrameAdvantage({
                frameWinsCount: 10,
                baselineWinsCount: 0,
                drawCount: 0
            });
            expect(r.frameAdvantageScore).toBe(1);
        });

        test('baseline_wins all → -1', () => {
            const r = M.computeFrameAdvantage({
                frameWinsCount: 0,
                baselineWinsCount: 10,
                drawCount: 0
            });
            expect(r.frameAdvantageScore).toBe(-1);
        });

        test('equal wins → 0', () => {
            const r = M.computeFrameAdvantage({
                frameWinsCount: 5,
                baselineWinsCount: 5,
                drawCount: 0
            });
            expect(r.frameAdvantageScore).toBe(0);
        });

        test('partial advantage (7-3-0)', () => {
            const r = M.computeFrameAdvantage({
                frameWinsCount: 7,
                baselineWinsCount: 3,
                drawCount: 0
            });
            // (7 - 3) / 10 = 0.4
            expect(r.frameAdvantageScore).toBeCloseTo(0.4, 6);
        });

        test('zero total → 0', () => {
            const r = M.computeFrameAdvantage({
                frameWinsCount: 0,
                baselineWinsCount: 0,
                drawCount: 0
            });
            expect(r.frameAdvantageScore).toBe(0);
        });

        test('with draws (5-3-2)', () => {
            const r = M.computeFrameAdvantage({
                frameWinsCount: 5,
                baselineWinsCount: 3,
                drawCount: 2
            });
            // (5-3) / 10 = 0.2
            expect(r.frameAdvantageScore).toBeCloseTo(0.2, 6);
        });
    });

    describe('canPromoteToShadow (pure)', () => {
        test('all criteria met → true', () => {
            const r = M.canPromoteToShadow({
                valueScore: 0.7,
                novelty: 0.5,
                stability: 0.5
            });
            expect(r.canPromote).toBe(true);
        });

        test('low value → false', () => {
            const r = M.canPromoteToShadow({
                valueScore: 0.3,
                novelty: 0.5,
                stability: 0.5
            });
            expect(r.canPromote).toBe(false);
        });
    });

    describe('canPromoteToLiveCandidate (pure)', () => {
        test('strong advantage + value + stability → true', () => {
            const r = M.canPromoteToLiveCandidate({
                frameAdvantageScore: 0.4,
                valueScore: 0.7,
                stability: 0.6
            });
            expect(r.canPromote).toBe(true);
        });

        test('negative advantage → false', () => {
            const r = M.canPromoteToLiveCandidate({
                frameAdvantageScore: -0.2,
                valueScore: 0.7,
                stability: 0.6
            });
            expect(r.canPromote).toBe(false);
        });

        test('low stability → false', () => {
            const r = M.canPromoteToLiveCandidate({
                frameAdvantageScore: 0.5,
                valueScore: 0.7,
                stability: 0.1
            });
            expect(r.canPromote).toBe(false);
        });
    });

    describe('registerAlienFrame', () => {
        test('persists with default sandbox mode + zero scores', () => {
            const r = M.registerAlienFrame({
                userId: UID, resolvedEnv: ENV,
                frameId: 'p138_reg_1',
                frameName: 'flow_as_pressure',
                frameDescription: 'Treat order flow as fluid pressure',
                primaryPrimitives: ['pressure_gradient', 'fluid_density'],
                sourceMetaphor: 'flow-as-pressure',
                ts: _now()
            });
            expect(r.registered).toBe(true);
            expect(r.mode).toBe('sandbox');
        });

        test('duplicate frameId throws', () => {
            M.registerAlienFrame({
                userId: UID, resolvedEnv: ENV,
                frameId: 'p138_reg_dup',
                frameName: 'f', frameDescription: 'd',
                primaryPrimitives: [], sourceMetaphor: 'm',
                ts: _now()
            });
            expect(() => M.registerAlienFrame({
                userId: UID, resolvedEnv: ENV,
                frameId: 'p138_reg_dup',
                frameName: 'f2', frameDescription: 'd2',
                primaryPrimitives: [], sourceMetaphor: 'm2',
                ts: _now()
            })).toThrow(/duplicate/);
        });
    });

    describe('evaluateFrame', () => {
        test('updates scores on existing frame', () => {
            M.registerAlienFrame({
                userId: UID_EVAL, resolvedEnv: ENV,
                frameId: 'p138_eval_1',
                frameName: 'f', frameDescription: 'd',
                primaryPrimitives: [], sourceMetaphor: 'm',
                ts: 1000
            });
            const r = M.evaluateFrame({
                userId: UID_EVAL, resolvedEnv: ENV,
                frameId: 'p138_eval_1',
                explanatoryNovelty: 0.7,
                predictiveNovelty: 0.6,
                semanticCompression: 0.5,
                stability: 0.4,
                ts: 2000
            });
            expect(r.evaluated).toBe(true);
            expect(r.valueScore).toBeGreaterThan(0);
            // verify persisted via getFrameById
            const f = M.getFrameById({
                userId: UID_EVAL, resolvedEnv: ENV,
                frameId: 'p138_eval_1'
            });
            expect(f.explanatoryNovelty).toBe(0.7);
        });

        test('missing frame throws', () => {
            expect(() => M.evaluateFrame({
                userId: UID_EVAL, resolvedEnv: ENV,
                frameId: 'p138_NONEXISTENT',
                explanatoryNovelty: 0.5,
                predictiveNovelty: 0.5,
                semanticCompression: 0.5,
                stability: 0.5,
                ts: _now()
            })).toThrow(/not found/);
        });

        test('out-of-range throws', () => {
            M.registerAlienFrame({
                userId: UID_EVAL, resolvedEnv: ENV,
                frameId: 'p138_eval_bad',
                frameName: 'f', frameDescription: 'd',
                primaryPrimitives: [], sourceMetaphor: 'm',
                ts: 1000
            });
            expect(() => M.evaluateFrame({
                userId: UID_EVAL, resolvedEnv: ENV,
                frameId: 'p138_eval_bad',
                explanatoryNovelty: 1.5,
                predictiveNovelty: 0.5,
                semanticCompression: 0.5,
                stability: 0.5,
                ts: 2000
            })).toThrow();
        });
    });

    describe('recordFrameComparison', () => {
        test('persists with computed advantage', () => {
            const r = M.recordFrameComparison({
                userId: UID_COMP, resolvedEnv: ENV,
                comparisonId: 'p138_comp_1',
                frameId: 'f1',
                baselineOntologyId: 'baseline_v1',
                frameWinsCount: 7,
                baselineWinsCount: 3,
                drawCount: 0,
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.frameAdvantageScore).toBeCloseTo(0.4, 6);
        });

        test('duplicate comparisonId throws', () => {
            M.recordFrameComparison({
                userId: UID_COMP, resolvedEnv: ENV,
                comparisonId: 'p138_comp_dup',
                frameId: 'f1', baselineOntologyId: 'b',
                frameWinsCount: 5, baselineWinsCount: 5,
                drawCount: 0, ts: _now()
            });
            expect(() => M.recordFrameComparison({
                userId: UID_COMP, resolvedEnv: ENV,
                comparisonId: 'p138_comp_dup',
                frameId: 'f2', baselineOntologyId: 'b',
                frameWinsCount: 6, baselineWinsCount: 4,
                drawCount: 0, ts: _now()
            })).toThrow(/duplicate/);
        });

        test('negative count throws', () => {
            expect(() => M.recordFrameComparison({
                userId: UID_COMP, resolvedEnv: ENV,
                comparisonId: 'p138_comp_bad',
                frameId: 'f1', baselineOntologyId: 'b',
                frameWinsCount: -1, baselineWinsCount: 5,
                drawCount: 0, ts: _now()
            })).toThrow();
        });
    });

    describe('promoteFrame', () => {
        test('sandbox → shadow with valid criteria', () => {
            M.registerAlienFrame({
                userId: UID_PROMOTE, resolvedEnv: ENV,
                frameId: 'p138_prom_1',
                frameName: 'f', frameDescription: 'd',
                primaryPrimitives: [], sourceMetaphor: 'm',
                ts: 1000
            });
            M.evaluateFrame({
                userId: UID_PROMOTE, resolvedEnv: ENV,
                frameId: 'p138_prom_1',
                explanatoryNovelty: 0.6,
                predictiveNovelty: 0.6,
                semanticCompression: 0.5,
                stability: 0.5,
                ts: 2000
            });
            const r = M.promoteFrame({
                userId: UID_PROMOTE, resolvedEnv: ENV,
                frameId: 'p138_prom_1',
                targetMode: 'shadow'
            });
            expect(r.promoted).toBe(true);
            expect(r.newMode).toBe('shadow');
            // verify persisted
            const f = M.getFrameById({
                userId: UID_PROMOTE, resolvedEnv: ENV,
                frameId: 'p138_prom_1'
            });
            expect(f.mode).toBe('shadow');
        });

        test('shadow → live_candidate with valid criteria', () => {
            M.registerAlienFrame({
                userId: UID_PROMOTE, resolvedEnv: ENV,
                frameId: 'p138_prom_2',
                frameName: 'f', frameDescription: 'd',
                primaryPrimitives: [], sourceMetaphor: 'm',
                ts: 1000
            });
            M.evaluateFrame({
                userId: UID_PROMOTE, resolvedEnv: ENV,
                frameId: 'p138_prom_2',
                explanatoryNovelty: 0.7,
                predictiveNovelty: 0.7,
                semanticCompression: 0.6,
                stability: 0.6,
                ts: 2000
            });
            // promote to shadow first
            M.promoteFrame({
                userId: UID_PROMOTE, resolvedEnv: ENV,
                frameId: 'p138_prom_2',
                targetMode: 'shadow'
            });
            // then promote to live_candidate
            const r = M.promoteFrame({
                userId: UID_PROMOTE, resolvedEnv: ENV,
                frameId: 'p138_prom_2',
                targetMode: 'live_candidate'
            });
            expect(r.promoted).toBe(true);
            expect(r.newMode).toBe('live_candidate');
        });

        test('direct sandbox → live_candidate blocked', () => {
            M.registerAlienFrame({
                userId: UID_PROMOTE, resolvedEnv: ENV,
                frameId: 'p138_prom_skip',
                frameName: 'f', frameDescription: 'd',
                primaryPrimitives: [], sourceMetaphor: 'm',
                ts: 1000
            });
            expect(() => M.promoteFrame({
                userId: UID_PROMOTE, resolvedEnv: ENV,
                frameId: 'p138_prom_skip',
                targetMode: 'live_candidate'
            })).toThrow(/sandbox|skip|invalid transition/i);
        });

        test('invalid target mode throws', () => {
            M.registerAlienFrame({
                userId: UID_PROMOTE, resolvedEnv: ENV,
                frameId: 'p138_prom_invalid',
                frameName: 'f', frameDescription: 'd',
                primaryPrimitives: [], sourceMetaphor: 'm',
                ts: 1000
            });
            expect(() => M.promoteFrame({
                userId: UID_PROMOTE, resolvedEnv: ENV,
                frameId: 'p138_prom_invalid',
                targetMode: 'BOGUS'
            })).toThrow(/invalid targetMode/);
        });

        test('missing frame throws', () => {
            expect(() => M.promoteFrame({
                userId: UID_PROMOTE, resolvedEnv: ENV,
                frameId: 'p138_NONEXISTENT',
                targetMode: 'shadow'
            })).toThrow(/not found/);
        });

        test('insufficient criteria for shadow promotion blocked', () => {
            M.registerAlienFrame({
                userId: UID_PROMOTE, resolvedEnv: ENV,
                frameId: 'p138_prom_insuff',
                frameName: 'f', frameDescription: 'd',
                primaryPrimitives: [], sourceMetaphor: 'm',
                ts: 1000
            });
            M.evaluateFrame({
                userId: UID_PROMOTE, resolvedEnv: ENV,
                frameId: 'p138_prom_insuff',
                explanatoryNovelty: 0.2,  // low
                predictiveNovelty: 0.2,
                semanticCompression: 0.2,
                stability: 0.2,
                ts: 2000
            });
            // valueScore will be ~0.20, below 0.50 threshold
            expect(() => M.promoteFrame({
                userId: UID_PROMOTE, resolvedEnv: ENV,
                frameId: 'p138_prom_insuff',
                targetMode: 'shadow'
            })).toThrow(/criteria|insufficient/i);
        });
    });

    describe('getFramesInMode', () => {
        test('filters by mode', () => {
            const u = UID_MODE;
            M.registerAlienFrame({
                userId: u, resolvedEnv: ENV,
                frameId: 'p138_mode_sandbox',
                frameName: 'f1', frameDescription: 'd',
                primaryPrimitives: [], sourceMetaphor: 'm',
                ts: 1000
            });
            M.registerAlienFrame({
                userId: u, resolvedEnv: ENV,
                frameId: 'p138_mode_sandbox2',
                frameName: 'f2', frameDescription: 'd',
                primaryPrimitives: [], sourceMetaphor: 'm',
                ts: 2000
            });
            // Promote one to shadow
            M.evaluateFrame({
                userId: u, resolvedEnv: ENV,
                frameId: 'p138_mode_sandbox2',
                explanatoryNovelty: 0.6,
                predictiveNovelty: 0.6,
                semanticCompression: 0.5,
                stability: 0.5,
                ts: 2500
            });
            M.promoteFrame({
                userId: u, resolvedEnv: ENV,
                frameId: 'p138_mode_sandbox2',
                targetMode: 'shadow'
            });
            const sandboxFrames = M.getFramesInMode({
                userId: u, resolvedEnv: ENV,
                mode: 'sandbox', limit: 10
            });
            expect(sandboxFrames.length).toBe(1);
            expect(sandboxFrames[0].frameId).toBe('p138_mode_sandbox');
        });

        test('invalid mode throws', () => {
            expect(() => M.getFramesInMode({
                userId: UID_MODE, resolvedEnv: ENV,
                mode: 'BOGUS', limit: 10
            })).toThrow(/invalid mode/);
        });
    });

    describe('getFrameById', () => {
        test('returns frame or null', () => {
            M.registerAlienFrame({
                userId: UID, resolvedEnv: ENV,
                frameId: 'p138_get_1',
                frameName: 'f', frameDescription: 'd',
                primaryPrimitives: ['p1', 'p2'],
                sourceMetaphor: 'm',
                ts: _now()
            });
            const r = M.getFrameById({
                userId: UID, resolvedEnv: ENV,
                frameId: 'p138_get_1'
            });
            expect(r).not.toBeNull();
            expect(r.frameId).toBe('p138_get_1');
            expect(r.primaryPrimitives).toEqual(['p1', 'p2']);

            const none = M.getFrameById({
                userId: UID, resolvedEnv: ENV,
                frameId: 'NONEXISTENT'
            });
            expect(none).toBeNull();
        });
    });

    describe('isolation per user × env', () => {
        test('uid A cannot see uid B frames', () => {
            M.registerAlienFrame({
                userId: UID_ISO_A, resolvedEnv: ENV,
                frameId: 'p138_iso_a',
                frameName: 'f', frameDescription: 'd',
                primaryPrimitives: [], sourceMetaphor: 'm',
                ts: 1000
            });
            M.registerAlienFrame({
                userId: UID_ISO_B, resolvedEnv: ENV,
                frameId: 'p138_iso_b',
                frameName: 'f', frameDescription: 'd',
                primaryPrimitives: [], sourceMetaphor: 'm',
                ts: 1000
            });
            const rows = M.getFramesInMode({
                userId: UID_ISO_A, resolvedEnv: ENV,
                mode: 'sandbox', limit: 10
            });
            expect(rows.every(r => r.frameId !== 'p138_iso_b')).toBe(true);
        });

        test('DEMO env cannot see TESTNET env', () => {
            M.registerAlienFrame({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                frameId: 'p138_env_demo',
                frameName: 'f', frameDescription: 'd',
                primaryPrimitives: [], sourceMetaphor: 'm',
                ts: 1000
            });
            M.registerAlienFrame({
                userId: UID_ENV, resolvedEnv: 'TESTNET',
                frameId: 'p138_env_testnet',
                frameName: 'f', frameDescription: 'd',
                primaryPrimitives: [], sourceMetaphor: 'm',
                ts: 1000
            });
            const rows = M.getFramesInMode({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                mode: 'sandbox', limit: 10
            });
            expect(rows.every(r => r.frameId !== 'p138_env_testnet')).toBe(true);
        });
    });
});
