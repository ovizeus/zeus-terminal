'use strict';

/**
 * OMEGA §140 COGNITIVE CONTAINMENT ZONES / IDEA QUARANTINE ENGINE.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt lines 4181-4234.
 *
 * "e o descoperire reala sau doar o tentatie intelectuala prematura?"
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p140-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/R5B_governance/cognitiveContainmentZones');

const UID = 9140;
const UID_QUAR = 9240;
const UID_TEST = 9340;
const UID_PROM = 9440;
const UID_RET = 9540;
const UID_STAGE = 9640;
const UID_ISO_A = 9740;
const UID_ISO_B = 9840;
const UID_ENV = 9940;
const ENV = 'DEMO';
const _now = () => Date.now();

const DAY_MS = 86400000;

function cleanRows() {
    const uids = [UID, UID_QUAR, UID_TEST, UID_PROM, UID_RET, UID_STAGE,
                  UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_quarantined_ideas WHERE user_id IN (${placeholders})`).run(...uids);
    db.prepare(`DELETE FROM ml_idea_promotions WHERE user_id IN (${placeholders})`).run(...uids);
}

beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §140 COGNITIVE CONTAINMENT ZONES', () => {

    describe('Migrations 265+266', () => {
        test('265_ml_quarantined_ideas migration applied', () => {
            expect(db.prepare(
                "SELECT name FROM _migrations WHERE name = ?"
            ).get('265_ml_quarantined_ideas')).toBeTruthy();
        });

        test('266_ml_idea_promotions migration applied', () => {
            expect(db.prepare(
                "SELECT name FROM _migrations WHERE name = ?"
            ).get('266_ml_idea_promotions')).toBeTruthy();
        });

        test('idea_id UNIQUE enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_quarantined_ideas
                (user_id, resolved_env, idea_id, idea_kind, title, description,
                 stage, contamination_risk, incubation_started_ts,
                 replay_test_passed, shadow_test_passed, canary_test_passed,
                 decision_count, active, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            stmt.run(UID, ENV, 'p140_i_dup', 'concept', 't', 'd',
                'idea_detected', 0.3, null, 0, 0, 0, 0, 1, _now());
            expect(() => stmt.run(UID, ENV, 'p140_i_dup', 'rule', 't2', 'd2',
                'quarantined', 0.4, 1000, 0, 0, 0, 0, 1, _now())).toThrow();
        });

        test('idea_kind CHECK enum enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_quarantined_ideas
                (user_id, resolved_env, idea_id, idea_kind, title, description,
                 stage, contamination_risk, incubation_started_ts,
                 replay_test_passed, shadow_test_passed, canary_test_passed,
                 decision_count, active, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p140_bad_kind', 'BOGUS', 't', 'd',
                'idea_detected', 0.3, null, 0, 0, 0, 0, 1, _now())).toThrow();
        });

        test('stage CHECK enum enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_quarantined_ideas
                (user_id, resolved_env, idea_id, idea_kind, title, description,
                 stage, contamination_risk, incubation_started_ts,
                 replay_test_passed, shadow_test_passed, canary_test_passed,
                 decision_count, active, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p140_bad_stage', 'concept', 't', 'd',
                'BOGUS', 0.3, null, 0, 0, 0, 0, 1, _now())).toThrow();
        });

        test('test_passed CHECK 0/1 enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_quarantined_ideas
                (user_id, resolved_env, idea_id, idea_kind, title, description,
                 stage, contamination_risk, incubation_started_ts,
                 replay_test_passed, shadow_test_passed, canary_test_passed,
                 decision_count, active, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p140_bad_test', 'concept', 't', 'd',
                'idea_detected', 0.3, null, 2, 0, 0, 0, 1, _now())).toThrow();
        });

        test('decision_count CHECK ≥ 0 enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_quarantined_ideas
                (user_id, resolved_env, idea_id, idea_kind, title, description,
                 stage, contamination_risk, incubation_started_ts,
                 replay_test_passed, shadow_test_passed, canary_test_passed,
                 decision_count, active, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p140_bad_dc', 'concept', 't', 'd',
                'idea_detected', 0.3, null, 0, 0, 0, -1, 1, _now())).toThrow();
        });

        test('promotion_id UNIQUE enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_idea_promotions
                (user_id, resolved_env, promotion_id, idea_id,
                 from_stage, to_stage, reason, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);
            stmt.run(UID, ENV, 'p140_p_dup', 'i1',
                'idea_detected', 'quarantined', 'test', _now());
            expect(() => stmt.run(UID, ENV, 'p140_p_dup', 'i2',
                'quarantined', 'replay_tested', 'test', _now())).toThrow();
        });
    });

    describe('Constants', () => {
        test('IDEA_KINDS frozen 6 canonical entries', () => {
            expect(M.IDEA_KINDS).toEqual([
                'concept', 'rule', 'causality',
                'heuristic', 'signal', 'ontology'
            ]);
            expect(Object.isFrozen(M.IDEA_KINDS)).toBe(true);
        });

        test('STAGES frozen 7 entries', () => {
            expect(M.STAGES).toEqual([
                'idea_detected', 'quarantined', 'replay_tested',
                'shadow_tested', 'canary_influence', 'core_admitted',
                'retired'
            ]);
            expect(Object.isFrozen(M.STAGES)).toBe(true);
        });

        test('VALID_TRANSITIONS map complete', () => {
            expect(M.VALID_TRANSITIONS.idea_detected).toContain('quarantined');
            expect(M.VALID_TRANSITIONS.idea_detected).toContain('retired');
            expect(M.VALID_TRANSITIONS.quarantined).toContain('replay_tested');
            expect(M.VALID_TRANSITIONS.replay_tested).toContain('shadow_tested');
            expect(M.VALID_TRANSITIONS.shadow_tested).toContain('canary_influence');
            expect(M.VALID_TRANSITIONS.canary_influence).toContain('core_admitted');
            expect(M.VALID_TRANSITIONS.core_admitted).toEqual([]);
            expect(M.VALID_TRANSITIONS.retired).toEqual([]);
        });

        test('CONTAMINATION_RISK_THRESHOLDS ordered', () => {
            expect(M.CONTAMINATION_RISK_THRESHOLDS.high).toBe(0.70);
            expect(M.CONTAMINATION_RISK_THRESHOLDS.medium).toBe(0.40);
            expect(M.CONTAMINATION_RISK_THRESHOLDS.medium)
                .toBeLessThan(M.CONTAMINATION_RISK_THRESHOLDS.high);
        });

        test('decision count thresholds ascending', () => {
            expect(M.MIN_DECISIONS_FOR_SHADOW).toBe(10);
            expect(M.MIN_DECISIONS_FOR_CANARY).toBe(50);
            expect(M.MIN_DECISIONS_FOR_CORE).toBe(200);
            expect(M.MIN_DECISIONS_FOR_SHADOW)
                .toBeLessThan(M.MIN_DECISIONS_FOR_CANARY);
            expect(M.MIN_DECISIONS_FOR_CANARY)
                .toBeLessThan(M.MIN_DECISIONS_FOR_CORE);
        });

        test('MIN_INCUBATION_MS = 24h', () => {
            expect(M.MIN_INCUBATION_MS).toBe(DAY_MS);
        });
    });

    describe('classifyContaminationRisk (pure)', () => {
        test('score ≥ 0.70 → high', () => {
            expect(M.classifyContaminationRisk({ riskScore: 0.85 })
                .riskLevel).toBe('high');
        });

        test('score 0.40..0.70 → medium', () => {
            expect(M.classifyContaminationRisk({ riskScore: 0.55 })
                .riskLevel).toBe('medium');
        });

        test('score < 0.40 → low', () => {
            expect(M.classifyContaminationRisk({ riskScore: 0.20 })
                .riskLevel).toBe('low');
        });

        test('boundary 0.40 → medium', () => {
            expect(M.classifyContaminationRisk({ riskScore: 0.40 })
                .riskLevel).toBe('medium');
        });

        test('boundary 0.70 → high', () => {
            expect(M.classifyContaminationRisk({ riskScore: 0.70 })
                .riskLevel).toBe('high');
        });
    });

    describe('isValidTransition (pure)', () => {
        test('idea_detected → quarantined OK', () => {
            expect(M.isValidTransition({
                fromStage: 'idea_detected',
                toStage: 'quarantined'
            }).valid).toBe(true);
        });

        test('quarantined → replay_tested OK', () => {
            expect(M.isValidTransition({
                fromStage: 'quarantined',
                toStage: 'replay_tested'
            }).valid).toBe(true);
        });

        test('any stage → retired OK', () => {
            expect(M.isValidTransition({
                fromStage: 'quarantined',
                toStage: 'retired'
            }).valid).toBe(true);
            expect(M.isValidTransition({
                fromStage: 'shadow_tested',
                toStage: 'retired'
            }).valid).toBe(true);
        });

        test('skipping stages blocked', () => {
            expect(M.isValidTransition({
                fromStage: 'idea_detected',
                toStage: 'shadow_tested'
            }).valid).toBe(false);
        });

        test('backward transition blocked', () => {
            expect(M.isValidTransition({
                fromStage: 'shadow_tested',
                toStage: 'quarantined'
            }).valid).toBe(false);
        });

        test('core_admitted terminal', () => {
            expect(M.isValidTransition({
                fromStage: 'core_admitted',
                toStage: 'retired'
            }).valid).toBe(false);
        });

        test('retired terminal', () => {
            expect(M.isValidTransition({
                fromStage: 'retired',
                toStage: 'idea_detected'
            }).valid).toBe(false);
        });

        test('invalid stage throws', () => {
            expect(() => M.isValidTransition({
                fromStage: 'BOGUS',
                toStage: 'quarantined'
            })).toThrow();
        });
    });

    describe('evaluatePromotionEligibility (pure)', () => {
        test('quarantined → replay_tested: insufficient incubation', () => {
            const r = M.evaluatePromotionEligibility({
                currentStage: 'quarantined',
                targetStage: 'replay_tested',
                ideaState: {
                    incubation_started_ts: 1000,
                    replay_test_passed: 1,
                    shadow_test_passed: 0,
                    canary_test_passed: 0,
                    decision_count: 0
                },
                currentTs: 1000 + DAY_MS / 2  // only 12h
            });
            expect(r.eligible).toBe(false);
            expect(r.reasons).toContain('incubation_period_too_short');
        });

        test('quarantined → replay_tested: missing test pass', () => {
            const r = M.evaluatePromotionEligibility({
                currentStage: 'quarantined',
                targetStage: 'replay_tested',
                ideaState: {
                    incubation_started_ts: 1000,
                    replay_test_passed: 0,
                    shadow_test_passed: 0,
                    canary_test_passed: 0,
                    decision_count: 5
                },
                currentTs: 1000 + DAY_MS + 1000  // 24h+
            });
            expect(r.eligible).toBe(false);
            expect(r.reasons).toContain('replay_test_not_passed');
        });

        test('quarantined → replay_tested: eligible', () => {
            const r = M.evaluatePromotionEligibility({
                currentStage: 'quarantined',
                targetStage: 'replay_tested',
                ideaState: {
                    incubation_started_ts: 1000,
                    replay_test_passed: 1,
                    shadow_test_passed: 0,
                    canary_test_passed: 0,
                    decision_count: 5
                },
                currentTs: 1000 + DAY_MS + 1000
            });
            expect(r.eligible).toBe(true);
        });

        test('replay_tested → shadow_tested: insufficient decisions', () => {
            const r = M.evaluatePromotionEligibility({
                currentStage: 'replay_tested',
                targetStage: 'shadow_tested',
                ideaState: {
                    incubation_started_ts: 1000,
                    replay_test_passed: 1,
                    shadow_test_passed: 1,
                    canary_test_passed: 0,
                    decision_count: 5  // < MIN_DECISIONS_FOR_SHADOW (10)
                },
                currentTs: 1000 + DAY_MS * 5
            });
            expect(r.eligible).toBe(false);
            expect(r.reasons).toContain('insufficient_decisions');
        });

        test('shadow_tested → canary_influence: needs 50 decisions', () => {
            const r = M.evaluatePromotionEligibility({
                currentStage: 'shadow_tested',
                targetStage: 'canary_influence',
                ideaState: {
                    incubation_started_ts: 1000,
                    replay_test_passed: 1,
                    shadow_test_passed: 1,
                    canary_test_passed: 1,
                    decision_count: 50
                },
                currentTs: 1000 + DAY_MS * 10
            });
            expect(r.eligible).toBe(true);
        });

        test('canary_influence → core_admitted: needs 200 decisions', () => {
            const r1 = M.evaluatePromotionEligibility({
                currentStage: 'canary_influence',
                targetStage: 'core_admitted',
                ideaState: {
                    incubation_started_ts: 1000,
                    replay_test_passed: 1,
                    shadow_test_passed: 1,
                    canary_test_passed: 1,
                    decision_count: 100
                },
                currentTs: 1000 + DAY_MS * 30
            });
            expect(r1.eligible).toBe(false);

            const r2 = M.evaluatePromotionEligibility({
                currentStage: 'canary_influence',
                targetStage: 'core_admitted',
                ideaState: {
                    incubation_started_ts: 1000,
                    replay_test_passed: 1,
                    shadow_test_passed: 1,
                    canary_test_passed: 1,
                    decision_count: 250
                },
                currentTs: 1000 + DAY_MS * 30
            });
            expect(r2.eligible).toBe(true);
        });

        test('retirement always eligible (no gates)', () => {
            const r = M.evaluatePromotionEligibility({
                currentStage: 'quarantined',
                targetStage: 'retired',
                ideaState: {
                    incubation_started_ts: 1000,
                    replay_test_passed: 0,
                    shadow_test_passed: 0,
                    canary_test_passed: 0,
                    decision_count: 0
                },
                currentTs: 1100
            });
            expect(r.eligible).toBe(true);
        });
    });

    describe('registerIdea', () => {
        test('persists with idea_detected stage', () => {
            const r = M.registerIdea({
                userId: UID, resolvedEnv: ENV,
                ideaId: 'p140_reg_1',
                ideaKind: 'concept',
                title: 'Liquidity vacuum concept',
                description: 'New concept: market liquidity vacuum patterns',
                contaminationRisk: 0.30,
                ts: _now()
            });
            expect(r.registered).toBe(true);
            expect(r.stage).toBe('idea_detected');
        });

        test('duplicate ideaId throws', () => {
            M.registerIdea({
                userId: UID, resolvedEnv: ENV,
                ideaId: 'p140_reg_dup',
                ideaKind: 'concept', title: 't', description: 'd',
                contaminationRisk: 0.30, ts: _now()
            });
            expect(() => M.registerIdea({
                userId: UID, resolvedEnv: ENV,
                ideaId: 'p140_reg_dup',
                ideaKind: 'rule', title: 't2', description: 'd2',
                contaminationRisk: 0.30, ts: _now()
            })).toThrow(/duplicate/);
        });

        test('invalid ideaKind throws', () => {
            expect(() => M.registerIdea({
                userId: UID, resolvedEnv: ENV,
                ideaId: 'p140_reg_bad',
                ideaKind: 'BOGUS', title: 't', description: 'd',
                contaminationRisk: 0.30, ts: _now()
            })).toThrow(/invalid ideaKind/);
        });

        test('out-of-range contaminationRisk throws', () => {
            expect(() => M.registerIdea({
                userId: UID, resolvedEnv: ENV,
                ideaId: 'p140_reg_bad2',
                ideaKind: 'concept', title: 't', description: 'd',
                contaminationRisk: 1.5, ts: _now()
            })).toThrow();
        });
    });

    describe('quarantineIdea', () => {
        test('idea_detected → quarantined sets incubation_started_ts', () => {
            M.registerIdea({
                userId: UID_QUAR, resolvedEnv: ENV,
                ideaId: 'p140_quar_1',
                ideaKind: 'signal', title: 't', description: 'd',
                contaminationRisk: 0.4, ts: 1000
            });
            const r = M.quarantineIdea({
                userId: UID_QUAR, resolvedEnv: ENV,
                ideaId: 'p140_quar_1', ts: 2000
            });
            expect(r.quarantined).toBe(true);
            const idea = M.getIdeaById({
                userId: UID_QUAR, resolvedEnv: ENV,
                ideaId: 'p140_quar_1'
            });
            expect(idea.stage).toBe('quarantined');
            expect(idea.incubationStartedTs).toBe(2000);
        });

        test('wrong stage blocked', () => {
            M.registerIdea({
                userId: UID_QUAR, resolvedEnv: ENV,
                ideaId: 'p140_quar_wrong',
                ideaKind: 'concept', title: 't', description: 'd',
                contaminationRisk: 0.3, ts: 1000
            });
            M.quarantineIdea({
                userId: UID_QUAR, resolvedEnv: ENV,
                ideaId: 'p140_quar_wrong', ts: 2000
            });
            // already quarantined, can't quarantine again
            expect(() => M.quarantineIdea({
                userId: UID_QUAR, resolvedEnv: ENV,
                ideaId: 'p140_quar_wrong', ts: 3000
            })).toThrow(/not in idea_detected|wrong stage/i);
        });

        test('missing idea throws', () => {
            expect(() => M.quarantineIdea({
                userId: UID_QUAR, resolvedEnv: ENV,
                ideaId: 'p140_NONEXISTENT', ts: _now()
            })).toThrow(/not found/);
        });
    });

    describe('recordTestPass', () => {
        test('replay test pass', () => {
            M.registerIdea({
                userId: UID_TEST, resolvedEnv: ENV,
                ideaId: 'p140_test_replay',
                ideaKind: 'concept', title: 't', description: 'd',
                contaminationRisk: 0.3, ts: 1000
            });
            M.recordTestPass({
                userId: UID_TEST, resolvedEnv: ENV,
                ideaId: 'p140_test_replay',
                testKind: 'replay'
            });
            const idea = M.getIdeaById({
                userId: UID_TEST, resolvedEnv: ENV,
                ideaId: 'p140_test_replay'
            });
            expect(idea.replayTestPassed).toBe(true);
            expect(idea.shadowTestPassed).toBe(false);
        });

        test('shadow test pass', () => {
            M.registerIdea({
                userId: UID_TEST, resolvedEnv: ENV,
                ideaId: 'p140_test_shadow',
                ideaKind: 'concept', title: 't', description: 'd',
                contaminationRisk: 0.3, ts: 1000
            });
            M.recordTestPass({
                userId: UID_TEST, resolvedEnv: ENV,
                ideaId: 'p140_test_shadow',
                testKind: 'shadow'
            });
            const idea = M.getIdeaById({
                userId: UID_TEST, resolvedEnv: ENV,
                ideaId: 'p140_test_shadow'
            });
            expect(idea.shadowTestPassed).toBe(true);
        });

        test('canary test pass', () => {
            M.registerIdea({
                userId: UID_TEST, resolvedEnv: ENV,
                ideaId: 'p140_test_canary',
                ideaKind: 'concept', title: 't', description: 'd',
                contaminationRisk: 0.3, ts: 1000
            });
            M.recordTestPass({
                userId: UID_TEST, resolvedEnv: ENV,
                ideaId: 'p140_test_canary',
                testKind: 'canary'
            });
            const idea = M.getIdeaById({
                userId: UID_TEST, resolvedEnv: ENV,
                ideaId: 'p140_test_canary'
            });
            expect(idea.canaryTestPassed).toBe(true);
        });

        test('invalid testKind throws', () => {
            M.registerIdea({
                userId: UID_TEST, resolvedEnv: ENV,
                ideaId: 'p140_test_bad',
                ideaKind: 'concept', title: 't', description: 'd',
                contaminationRisk: 0.3, ts: 1000
            });
            expect(() => M.recordTestPass({
                userId: UID_TEST, resolvedEnv: ENV,
                ideaId: 'p140_test_bad',
                testKind: 'BOGUS'
            })).toThrow(/invalid testKind/);
        });
    });

    describe('incrementDecisionCount', () => {
        test('adds to existing count', () => {
            M.registerIdea({
                userId: UID_TEST, resolvedEnv: ENV,
                ideaId: 'p140_inc_1',
                ideaKind: 'rule', title: 't', description: 'd',
                contaminationRisk: 0.3, ts: 1000
            });
            M.incrementDecisionCount({
                userId: UID_TEST, resolvedEnv: ENV,
                ideaId: 'p140_inc_1', count: 5
            });
            M.incrementDecisionCount({
                userId: UID_TEST, resolvedEnv: ENV,
                ideaId: 'p140_inc_1', count: 3
            });
            const idea = M.getIdeaById({
                userId: UID_TEST, resolvedEnv: ENV,
                ideaId: 'p140_inc_1'
            });
            expect(idea.decisionCount).toBe(8);
        });
    });

    describe('promoteIdea (integration)', () => {
        test('quarantined → replay_tested with valid eligibility', () => {
            const u = UID_PROM;
            M.registerIdea({
                userId: u, resolvedEnv: ENV,
                ideaId: 'p140_prom_replay',
                ideaKind: 'signal', title: 't', description: 'd',
                contaminationRisk: 0.3, ts: 1000
            });
            M.quarantineIdea({
                userId: u, resolvedEnv: ENV,
                ideaId: 'p140_prom_replay', ts: 2000
            });
            M.recordTestPass({
                userId: u, resolvedEnv: ENV,
                ideaId: 'p140_prom_replay', testKind: 'replay'
            });
            const r = M.promoteIdea({
                userId: u, resolvedEnv: ENV,
                ideaId: 'p140_prom_replay',
                targetStage: 'replay_tested',
                reason: 'replay tests passed',
                ts: 2000 + DAY_MS + 1000  // 24h+
            });
            expect(r.promoted).toBe(true);
            expect(r.newStage).toBe('replay_tested');
        });

        test('replay_tested → shadow_tested with 10 decisions + shadow pass', () => {
            const u = UID_PROM;
            M.registerIdea({
                userId: u, resolvedEnv: ENV,
                ideaId: 'p140_prom_shadow',
                ideaKind: 'concept', title: 't', description: 'd',
                contaminationRisk: 0.3, ts: 1000
            });
            M.quarantineIdea({
                userId: u, resolvedEnv: ENV,
                ideaId: 'p140_prom_shadow', ts: 2000
            });
            M.recordTestPass({
                userId: u, resolvedEnv: ENV,
                ideaId: 'p140_prom_shadow', testKind: 'replay'
            });
            M.promoteIdea({
                userId: u, resolvedEnv: ENV,
                ideaId: 'p140_prom_shadow',
                targetStage: 'replay_tested',
                reason: 'r',
                ts: 2000 + DAY_MS + 1000
            });
            M.recordTestPass({
                userId: u, resolvedEnv: ENV,
                ideaId: 'p140_prom_shadow', testKind: 'shadow'
            });
            M.incrementDecisionCount({
                userId: u, resolvedEnv: ENV,
                ideaId: 'p140_prom_shadow', count: 12
            });
            const r = M.promoteIdea({
                userId: u, resolvedEnv: ENV,
                ideaId: 'p140_prom_shadow',
                targetStage: 'shadow_tested',
                reason: 'shadow ok',
                ts: 2000 + DAY_MS * 3
            });
            expect(r.promoted).toBe(true);
        });

        test('canary_influence → core_admitted requires 200 decisions', () => {
            const u = UID_PROM;
            M.registerIdea({
                userId: u, resolvedEnv: ENV,
                ideaId: 'p140_prom_core',
                ideaKind: 'concept', title: 't', description: 'd',
                contaminationRisk: 0.3, ts: 1000
            });
            // Walk through stages
            M.quarantineIdea({ userId: u, resolvedEnv: ENV, ideaId: 'p140_prom_core', ts: 2000 });
            M.recordTestPass({ userId: u, resolvedEnv: ENV, ideaId: 'p140_prom_core', testKind: 'replay' });
            M.promoteIdea({ userId: u, resolvedEnv: ENV, ideaId: 'p140_prom_core', targetStage: 'replay_tested', reason: 'r', ts: 2000 + DAY_MS + 1000 });
            M.recordTestPass({ userId: u, resolvedEnv: ENV, ideaId: 'p140_prom_core', testKind: 'shadow' });
            M.incrementDecisionCount({ userId: u, resolvedEnv: ENV, ideaId: 'p140_prom_core', count: 15 });
            M.promoteIdea({ userId: u, resolvedEnv: ENV, ideaId: 'p140_prom_core', targetStage: 'shadow_tested', reason: 'r', ts: 2000 + DAY_MS * 3 });
            M.recordTestPass({ userId: u, resolvedEnv: ENV, ideaId: 'p140_prom_core', testKind: 'canary' });
            M.incrementDecisionCount({ userId: u, resolvedEnv: ENV, ideaId: 'p140_prom_core', count: 40 });
            M.promoteIdea({ userId: u, resolvedEnv: ENV, ideaId: 'p140_prom_core', targetStage: 'canary_influence', reason: 'r', ts: 2000 + DAY_MS * 5 });
            // Try to promote to core with insufficient decisions (55 < 200)
            expect(() => M.promoteIdea({
                userId: u, resolvedEnv: ENV,
                ideaId: 'p140_prom_core',
                targetStage: 'core_admitted',
                reason: 'r',
                ts: 2000 + DAY_MS * 10
            })).toThrow(/insufficient/);
            // Add more decisions
            M.incrementDecisionCount({ userId: u, resolvedEnv: ENV, ideaId: 'p140_prom_core', count: 150 });
            // Now 205 decisions
            const r = M.promoteIdea({
                userId: u, resolvedEnv: ENV,
                ideaId: 'p140_prom_core',
                targetStage: 'core_admitted',
                reason: 'all tests passed',
                ts: 2000 + DAY_MS * 30
            });
            expect(r.promoted).toBe(true);
            expect(r.newStage).toBe('core_admitted');
        });

        test('direct idea_detected → replay_tested blocked (skip)', () => {
            M.registerIdea({
                userId: UID_PROM, resolvedEnv: ENV,
                ideaId: 'p140_prom_skip',
                ideaKind: 'rule', title: 't', description: 'd',
                contaminationRisk: 0.3, ts: 1000
            });
            expect(() => M.promoteIdea({
                userId: UID_PROM, resolvedEnv: ENV,
                ideaId: 'p140_prom_skip',
                targetStage: 'replay_tested',
                reason: 'skip',
                ts: 2000 + DAY_MS + 1000
            })).toThrow(/invalid transition|skip/i);
        });

        test('insufficient incubation blocks promotion', () => {
            M.registerIdea({
                userId: UID_PROM, resolvedEnv: ENV,
                ideaId: 'p140_prom_no_incub',
                ideaKind: 'concept', title: 't', description: 'd',
                contaminationRisk: 0.3, ts: 1000
            });
            M.quarantineIdea({
                userId: UID_PROM, resolvedEnv: ENV,
                ideaId: 'p140_prom_no_incub', ts: 2000
            });
            M.recordTestPass({
                userId: UID_PROM, resolvedEnv: ENV,
                ideaId: 'p140_prom_no_incub', testKind: 'replay'
            });
            expect(() => M.promoteIdea({
                userId: UID_PROM, resolvedEnv: ENV,
                ideaId: 'p140_prom_no_incub',
                targetStage: 'replay_tested',
                reason: 'too soon',
                ts: 2000 + 1000  // only 1 sec
            })).toThrow(/incubation/);
        });

        test('missing idea throws', () => {
            expect(() => M.promoteIdea({
                userId: UID_PROM, resolvedEnv: ENV,
                ideaId: 'p140_NONEXISTENT',
                targetStage: 'quarantined',
                reason: 'r', ts: _now()
            })).toThrow(/not found/);
        });
    });

    describe('retireIdea', () => {
        test('from quarantined → retired', () => {
            M.registerIdea({
                userId: UID_RET, resolvedEnv: ENV,
                ideaId: 'p140_ret_1',
                ideaKind: 'concept', title: 't', description: 'd',
                contaminationRisk: 0.3, ts: 1000
            });
            M.quarantineIdea({
                userId: UID_RET, resolvedEnv: ENV,
                ideaId: 'p140_ret_1', ts: 2000
            });
            const r = M.retireIdea({
                userId: UID_RET, resolvedEnv: ENV,
                ideaId: 'p140_ret_1',
                reason: 'failed replay tests',
                ts: 3000
            });
            expect(r.retired).toBe(true);
        });

        test('cannot retire already-retired idea', () => {
            M.registerIdea({
                userId: UID_RET, resolvedEnv: ENV,
                ideaId: 'p140_ret_double',
                ideaKind: 'concept', title: 't', description: 'd',
                contaminationRisk: 0.3, ts: 1000
            });
            M.retireIdea({
                userId: UID_RET, resolvedEnv: ENV,
                ideaId: 'p140_ret_double',
                reason: 'r', ts: 2000
            });
            expect(() => M.retireIdea({
                userId: UID_RET, resolvedEnv: ENV,
                ideaId: 'p140_ret_double',
                reason: 'r2', ts: 3000
            })).toThrow(/already.*retired|terminal/i);
        });
    });

    describe('getIdeasInStage', () => {
        test('filters by stage', () => {
            const u = UID_STAGE;
            for (let i = 0; i < 3; i++) {
                M.registerIdea({
                    userId: u, resolvedEnv: ENV,
                    ideaId: `p140_stage_${i}`,
                    ideaKind: 'concept', title: 't', description: 'd',
                    contaminationRisk: 0.3, ts: 1000 + i
                });
            }
            // Quarantine 2
            M.quarantineIdea({
                userId: u, resolvedEnv: ENV,
                ideaId: 'p140_stage_0', ts: 2000
            });
            M.quarantineIdea({
                userId: u, resolvedEnv: ENV,
                ideaId: 'p140_stage_1', ts: 2001
            });
            const detected = M.getIdeasInStage({
                userId: u, resolvedEnv: ENV,
                stage: 'idea_detected', limit: 10
            });
            expect(detected.length).toBe(1);
            expect(detected[0].ideaId).toBe('p140_stage_2');
            const quarantined = M.getIdeasInStage({
                userId: u, resolvedEnv: ENV,
                stage: 'quarantined', limit: 10
            });
            expect(quarantined.length).toBe(2);
        });

        test('invalid stage throws', () => {
            expect(() => M.getIdeasInStage({
                userId: UID_STAGE, resolvedEnv: ENV,
                stage: 'BOGUS', limit: 10
            })).toThrow(/invalid stage/);
        });
    });

    describe('getIdeaById', () => {
        test('returns idea or null', () => {
            M.registerIdea({
                userId: UID, resolvedEnv: ENV,
                ideaId: 'p140_get_1',
                ideaKind: 'causality', title: 't', description: 'd',
                contaminationRisk: 0.55, ts: _now()
            });
            const r = M.getIdeaById({
                userId: UID, resolvedEnv: ENV,
                ideaId: 'p140_get_1'
            });
            expect(r).not.toBeNull();
            expect(r.ideaKind).toBe('causality');
            expect(r.contaminationRisk).toBe(0.55);

            const none = M.getIdeaById({
                userId: UID, resolvedEnv: ENV,
                ideaId: 'NONEXISTENT'
            });
            expect(none).toBeNull();
        });
    });

    describe('isolation per user × env', () => {
        test('uid A cannot see uid B ideas', () => {
            M.registerIdea({
                userId: UID_ISO_A, resolvedEnv: ENV,
                ideaId: 'p140_iso_a',
                ideaKind: 'concept', title: 't', description: 'd',
                contaminationRisk: 0.3, ts: 1000
            });
            M.registerIdea({
                userId: UID_ISO_B, resolvedEnv: ENV,
                ideaId: 'p140_iso_b',
                ideaKind: 'concept', title: 't', description: 'd',
                contaminationRisk: 0.3, ts: 1000
            });
            const rows = M.getIdeasInStage({
                userId: UID_ISO_A, resolvedEnv: ENV,
                stage: 'idea_detected', limit: 10
            });
            expect(rows.every(i => i.ideaId !== 'p140_iso_b')).toBe(true);
        });

        test('DEMO env cannot see TESTNET env', () => {
            M.registerIdea({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                ideaId: 'p140_env_demo',
                ideaKind: 'concept', title: 't', description: 'd',
                contaminationRisk: 0.3, ts: 1000
            });
            M.registerIdea({
                userId: UID_ENV, resolvedEnv: 'TESTNET',
                ideaId: 'p140_env_testnet',
                ideaKind: 'concept', title: 't', description: 'd',
                contaminationRisk: 0.3, ts: 1000
            });
            const rows = M.getIdeasInStage({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                stage: 'idea_detected', limit: 10
            });
            expect(rows.every(i => i.ideaId !== 'p140_env_testnet')).toBe(true);
        });
    });
});
