'use strict';

/**
 * OMEGA §151 FUTURE-SELF TREATY / POSSIBLE-SELVES NEGOTIATION CHAMBER.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt lines 4984-5031.
 *
 * "daca versiunea mea mai inteleapta de peste 6 luni ar privi decizia asta,
 *  ar multumi sau ar protesta?"
 *
 * Tests FIRST per TDD discipline.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p151-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/_meta/futureSelfTreaty');

const UID = 9151;
const UID_REG = 9251;
const UID_TR = 9351;
const UID_GET = 9451;
const UID_CON = 9551;
const UID_ISO_A = 9651;
const UID_ISO_B = 9751;
const UID_ENV = 9851;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    const uids = [UID, UID_REG, UID_TR, UID_GET, UID_CON,
                  UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_future_self_treaties WHERE user_id IN (${placeholders})`).run(...uids);
    db.prepare(`DELETE FROM ml_possible_self_archetypes WHERE user_id IN (${placeholders})`).run(...uids);
}
beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §151 FUTURE-SELF TREATY', () => {

    describe('Migrations 300+301', () => {
        test('300 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('300_ml_possible_self_archetypes')).toBeTruthy();
        });
        test('301 applied', () => {
            expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('301_ml_future_self_treaties')).toBeTruthy();
        });
        test('archetype_name CHECK enum', () => {
            expect(() => db.prepare(`INSERT INTO ml_possible_self_archetypes
                (user_id, resolved_env, archetype_id, archetype_name,
                 traits_json, priority_weights_json, description, registered_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'a_bk', 'BOGUS', '{}', '{}', 'd', _now())).toThrow();
        });
        test('horizon CHECK enum on treaties', () => {
            db.prepare(`INSERT INTO ml_possible_self_archetypes
                (user_id, resolved_env, archetype_id, archetype_name,
                 traits_json, priority_weights_json, description, registered_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'a_for_ck1', 'conservative', '{}', '{}', 'd', _now());
            expect(() => db.prepare(`INSERT INTO ml_future_self_treaties
                (user_id, resolved_env, treaty_id, change_label, archetype_id,
                 horizon, approval_score, regret_score, treaty_score, verdict,
                 reasoning_text, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 't_bk', 'ch', 'a_for_ck1', 'BOGUS',
                    0.5, 0.5, 0.5, 'approve', null, _now())).toThrow();
        });
        test('verdict CHECK enum on treaties', () => {
            db.prepare(`INSERT INTO ml_possible_self_archetypes
                (user_id, resolved_env, archetype_id, archetype_name,
                 traits_json, priority_weights_json, description, registered_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'a_for_ck2', 'aggressive', '{}', '{}', 'd', _now());
            expect(() => db.prepare(`INSERT INTO ml_future_self_treaties
                (user_id, resolved_env, treaty_id, change_label, archetype_id,
                 horizon, approval_score, regret_score, treaty_score, verdict,
                 reasoning_text, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 't_v', 'ch', 'a_for_ck2', 'near_term',
                    0.5, 0.5, 0.5, 'BOGUS', null, _now())).toThrow();
        });
        test('archetype_id UNIQUE', () => {
            const stmt = db.prepare(`INSERT INTO ml_possible_self_archetypes
                (user_id, resolved_env, archetype_id, archetype_name,
                 traits_json, priority_weights_json, description, registered_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
            stmt.run(UID, ENV, 'a_dup', 'conservative', '{}', '{}', 'd', _now());
            expect(() => stmt.run(UID, ENV, 'a_dup', 'aggressive',
                '{}', '{}', 'd2', _now())).toThrow();
        });
        test('range CHECK on score columns', () => {
            db.prepare(`INSERT INTO ml_possible_self_archetypes
                (user_id, resolved_env, archetype_id, archetype_name,
                 traits_json, priority_weights_json, description, registered_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'a_for_ck3', 'integrity_max', '{}', '{}', 'd', _now());
            expect(() => db.prepare(`INSERT INTO ml_future_self_treaties
                (user_id, resolved_env, treaty_id, change_label, archetype_id,
                 horizon, approval_score, regret_score, treaty_score, verdict,
                 reasoning_text, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 't_br', 'ch', 'a_for_ck3', 'near_term',
                    1.5, 0.5, 0.5, 'approve', null, _now())).toThrow();
        });
        test('FK ON DELETE RESTRICT on archetype_id', () => {
            db.prepare(`INSERT INTO ml_possible_self_archetypes
                (user_id, resolved_env, archetype_id, archetype_name,
                 traits_json, priority_weights_json, description, registered_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 'a_fk', 'survival_first', '{}', '{}', 'd', _now());
            db.prepare(`INSERT INTO ml_future_self_treaties
                (user_id, resolved_env, treaty_id, change_label, archetype_id,
                 horizon, approval_score, regret_score, treaty_score, verdict,
                 reasoning_text, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(UID, ENV, 't_fk', 'ch', 'a_fk', 'near_term',
                    0.5, 0.5, 0.5, 'approve', null, _now());
            expect(() => db.prepare(`DELETE FROM ml_possible_self_archetypes WHERE archetype_id=?`).run('a_fk')).toThrow();
            db.prepare(`DELETE FROM ml_future_self_treaties WHERE treaty_id=?`).run('t_fk');
            db.prepare(`DELETE FROM ml_possible_self_archetypes WHERE archetype_id=?`).run('a_fk');
        });
    });

    describe('Constants', () => {
        test('ARCHETYPE_NAMES frozen 5 canonical + custom', () => {
            expect(M.ARCHETYPE_NAMES).toEqual([
                'conservative', 'aggressive', 'research_heavy',
                'survival_first', 'integrity_max', 'custom'
            ]);
            expect(Object.isFrozen(M.ARCHETYPE_NAMES)).toBe(true);
        });
        test('HORIZONS frozen 2', () => {
            expect(M.HORIZONS).toEqual(['near_term', 'long_horizon']);
            expect(Object.isFrozen(M.HORIZONS)).toBe(true);
        });
        test('TREATY_VERDICTS frozen 4', () => {
            expect(M.TREATY_VERDICTS).toEqual([
                'approve', 'quarantine', 'governance_review', 'reject'
            ]);
            expect(Object.isFrozen(M.TREATY_VERDICTS)).toBe(true);
        });
        test('APPROVE_MIN_TREATY_SCORE = 0.65', () => {
            expect(M.APPROVE_MIN_TREATY_SCORE).toBe(0.65);
        });
        test('APPROVE_MAX_REGRET = 0.30', () => {
            expect(M.APPROVE_MAX_REGRET).toBe(0.30);
        });
        test('REJECT_MAX_TREATY_SCORE = 0.35', () => {
            expect(M.REJECT_MAX_TREATY_SCORE).toBe(0.35);
        });
        test('REJECT_MIN_REGRET = 0.65', () => {
            expect(M.REJECT_MIN_REGRET).toBe(0.65);
        });
        test('CONFLICT_SCORE_RANGE = 0.40', () => {
            // Spread between max and min treaty_score across archetypes
            // indicating conflict between possible selves
            expect(M.CONFLICT_SCORE_RANGE).toBe(0.40);
        });
    });

    describe('computeTreatyScore (pure)', () => {
        test('high approval + low regret → high score', () => {
            const r = M.computeTreatyScore({
                approvalScore: 0.90, regretScore: 0.10
            });
            expect(r.treatyScore).toBeGreaterThan(0.80);
        });
        test('low approval + high regret → low score', () => {
            const r = M.computeTreatyScore({
                approvalScore: 0.10, regretScore: 0.90
            });
            expect(r.treatyScore).toBeLessThan(0.20);
        });
        test('mixed signals → middle score', () => {
            const r = M.computeTreatyScore({
                approvalScore: 0.50, regretScore: 0.50
            });
            expect(r.treatyScore).toBeGreaterThan(0.30);
            expect(r.treatyScore).toBeLessThan(0.70);
        });
        test('clamps to [0,1]', () => {
            const r = M.computeTreatyScore({
                approvalScore: 1, regretScore: 0
            });
            expect(r.treatyScore).toBeLessThanOrEqual(1);
            expect(r.treatyScore).toBeGreaterThanOrEqual(0);
        });
        test('out-of-range throws', () => {
            expect(() => M.computeTreatyScore({
                approvalScore: 1.5, regretScore: 0
            })).toThrow();
        });
    });

    describe('classifyTreatyVerdict (pure)', () => {
        test('high treaty + low regret → approve', () => {
            const r = M.classifyTreatyVerdict({
                treatyScore: 0.85, approvalScore: 0.90, regretScore: 0.10
            });
            expect(r.verdict).toBe('approve');
        });
        test('high regret → reject regardless of treaty score', () => {
            const r = M.classifyTreatyVerdict({
                treatyScore: 0.60, approvalScore: 0.80, regretScore: 0.80
            });
            expect(r.verdict).toBe('reject');
        });
        test('very low treaty → reject', () => {
            const r = M.classifyTreatyVerdict({
                treatyScore: 0.20, approvalScore: 0.30, regretScore: 0.50
            });
            expect(r.verdict).toBe('reject');
        });
        test('borderline approval but regret above approve cap → quarantine', () => {
            const r = M.classifyTreatyVerdict({
                treatyScore: 0.70, approvalScore: 0.80, regretScore: 0.45
            });
            expect(r.verdict).toBe('quarantine');
        });
        test('middle treaty no other signal → quarantine', () => {
            const r = M.classifyTreatyVerdict({
                treatyScore: 0.50, approvalScore: 0.55, regretScore: 0.40
            });
            expect(r.verdict).toBe('quarantine');
        });
        test('boundary approve treaty 0.65 + regret 0.29 → approve', () => {
            const r = M.classifyTreatyVerdict({
                treatyScore: 0.65, approvalScore: 0.70, regretScore: 0.29
            });
            expect(r.verdict).toBe('approve');
        });
    });

    describe('detectTreatyConflict (pure)', () => {
        test('all treaties agree (small range) → no conflict', () => {
            const r = M.detectTreatyConflict({
                treaties: [
                    { archetypeId: 'a1', treatyScore: 0.80 },
                    { archetypeId: 'a2', treatyScore: 0.85 },
                    { archetypeId: 'a3', treatyScore: 0.78 }
                ]
            });
            expect(r.conflictDetected).toBe(false);
            expect(r.scoreRange).toBeCloseTo(0.07, 5);
        });
        test('treaties disagree (range > 0.40) → conflict', () => {
            // conservative says 0.90, aggressive says 0.30 — serious split
            const r = M.detectTreatyConflict({
                treaties: [
                    { archetypeId: 'cons', treatyScore: 0.90 },
                    { archetypeId: 'agg', treatyScore: 0.30 },
                    { archetypeId: 'integ', treatyScore: 0.70 }
                ]
            });
            expect(r.conflictDetected).toBe(true);
            expect(r.scoreRange).toBeCloseTo(0.60, 5);
        });
        test('empty array → no conflict', () => {
            const r = M.detectTreatyConflict({ treaties: [] });
            expect(r.conflictDetected).toBe(false);
        });
        test('single treaty → no conflict (no comparison)', () => {
            const r = M.detectTreatyConflict({
                treaties: [{ archetypeId: 'a1', treatyScore: 0.50 }]
            });
            expect(r.conflictDetected).toBe(false);
        });
        test('boundary range exactly 0.40 → no conflict (strict >)', () => {
            const r = M.detectTreatyConflict({
                treaties: [
                    { archetypeId: 'a1', treatyScore: 0.30 },
                    { archetypeId: 'a2', treatyScore: 0.70 }
                ]
            });
            // 0.40 is NOT above 0.40 threshold (strict greater)
            expect(r.conflictDetected).toBe(false);
        });
    });

    describe('registerArchetype', () => {
        test('register conservative archetype', () => {
            const r = M.registerArchetype({
                userId: UID_REG, resolvedEnv: ENV,
                archetypeId: 'ra_cons',
                archetypeName: 'conservative',
                traits: { risk_tolerance: 0.2, time_horizon: 'long' },
                priorityWeights: { drawdown: 0.5, consistency: 0.3, alpha: 0.2 },
                description: 'risk-averse self with 6mo horizon',
                ts: _now()
            });
            expect(r.registered).toBe(true);
            expect(r.archetypeId).toBe('ra_cons');
        });
        test('invalid archetypeName throws', () => {
            expect(() => M.registerArchetype({
                userId: UID_REG, resolvedEnv: ENV,
                archetypeId: 'ra_bad',
                archetypeName: 'BOGUS',
                traits: {}, priorityWeights: {},
                description: 'd', ts: _now()
            })).toThrow();
        });
        test('duplicate archetypeId throws', () => {
            M.registerArchetype({
                userId: UID_REG, resolvedEnv: ENV,
                archetypeId: 'ra_dup',
                archetypeName: 'aggressive',
                traits: {}, priorityWeights: {},
                description: 'd', ts: _now()
            });
            expect(() => M.registerArchetype({
                userId: UID_REG, resolvedEnv: ENV,
                archetypeId: 'ra_dup',
                archetypeName: 'aggressive',
                traits: {}, priorityWeights: {},
                description: 'd', ts: _now()
            })).toThrow(/duplicate/);
        });
        test('traits and priorityWeights must be plain objects', () => {
            expect(() => M.registerArchetype({
                userId: UID_REG, resolvedEnv: ENV,
                archetypeId: 'ra_arr',
                archetypeName: 'research_heavy',
                traits: ['not an object'],
                priorityWeights: {},
                description: 'd', ts: _now()
            })).toThrow(/object/i);
        });
    });

    describe('recordTreaty (integration)', () => {
        test('strong approval + low regret → approve verdict', () => {
            M.registerArchetype({
                userId: UID_TR, resolvedEnv: ENV,
                archetypeId: 'rt_cons', archetypeName: 'conservative',
                traits: {}, priorityWeights: {}, description: 'd', ts: _now()
            });
            const r = M.recordTreaty({
                userId: UID_TR, resolvedEnv: ENV,
                treatyId: 'rt_app',
                changeLabel: 'add_canary_phase',
                archetypeId: 'rt_cons',
                horizon: 'long_horizon',
                approvalScore: 0.90, regretScore: 0.10,
                reasoning: 'long-term safety improvement',
                ts: _now()
            });
            expect(r.recorded).toBe(true);
            expect(r.verdict).toBe('approve');
            expect(r.treatyScore).toBeGreaterThan(0.80);
        });
        test('high regret → reject verdict', () => {
            M.registerArchetype({
                userId: UID_TR, resolvedEnv: ENV,
                archetypeId: 'rt_integ', archetypeName: 'integrity_max',
                traits: {}, priorityWeights: {}, description: 'd', ts: _now()
            });
            const r = M.recordTreaty({
                userId: UID_TR, resolvedEnv: ENV,
                treatyId: 'rt_rej',
                changeLabel: 'remove_audit_trail',
                archetypeId: 'rt_integ',
                horizon: 'long_horizon',
                approvalScore: 0.40, regretScore: 0.85,
                ts: _now()
            });
            expect(r.verdict).toBe('reject');
        });
        test('treaty on nonexistent archetype throws (FK)', () => {
            expect(() => M.recordTreaty({
                userId: UID_TR, resolvedEnv: ENV,
                treatyId: 'rt_orph',
                changeLabel: 'ch',
                archetypeId: 'rt_nonexistent',
                horizon: 'near_term',
                approvalScore: 0.5, regretScore: 0.5,
                ts: _now()
            })).toThrow();
        });
        test('duplicate treatyId throws', () => {
            M.registerArchetype({
                userId: UID_TR, resolvedEnv: ENV,
                archetypeId: 'rt_dup_a', archetypeName: 'aggressive',
                traits: {}, priorityWeights: {}, description: 'd', ts: _now()
            });
            M.recordTreaty({
                userId: UID_TR, resolvedEnv: ENV,
                treatyId: 'rt_dup_id',
                changeLabel: 'ch', archetypeId: 'rt_dup_a',
                horizon: 'near_term',
                approvalScore: 0.5, regretScore: 0.5, ts: _now()
            });
            expect(() => M.recordTreaty({
                userId: UID_TR, resolvedEnv: ENV,
                treatyId: 'rt_dup_id',
                changeLabel: 'ch', archetypeId: 'rt_dup_a',
                horizon: 'near_term',
                approvalScore: 0.5, regretScore: 0.5, ts: _now()
            })).toThrow(/duplicate/);
        });
        test('out-of-range score throws', () => {
            M.registerArchetype({
                userId: UID_TR, resolvedEnv: ENV,
                archetypeId: 'rt_br_a', archetypeName: 'aggressive',
                traits: {}, priorityWeights: {}, description: 'd', ts: _now()
            });
            expect(() => M.recordTreaty({
                userId: UID_TR, resolvedEnv: ENV,
                treatyId: 'rt_br',
                changeLabel: 'ch', archetypeId: 'rt_br_a',
                horizon: 'near_term',
                approvalScore: 1.5, regretScore: 0.5, ts: _now()
            })).toThrow();
        });
    });

    describe('getArchetypes', () => {
        test('returns all archetypes for user × env', () => {
            M.registerArchetype({
                userId: UID_GET, resolvedEnv: ENV,
                archetypeId: 'ga_1', archetypeName: 'conservative',
                traits: {}, priorityWeights: {}, description: 'd', ts: _now()
            });
            M.registerArchetype({
                userId: UID_GET, resolvedEnv: ENV,
                archetypeId: 'ga_2', archetypeName: 'aggressive',
                traits: {}, priorityWeights: {}, description: 'd', ts: _now()
            });
            const r = M.getArchetypes({
                userId: UID_GET, resolvedEnv: ENV
            });
            expect(r.length).toBe(2);
        });
    });

    describe('getTreatiesForChange', () => {
        test('returns all treaties for a change_label', () => {
            M.registerArchetype({
                userId: UID_GET, resolvedEnv: ENV,
                archetypeId: 'gt_cons', archetypeName: 'conservative',
                traits: {}, priorityWeights: {}, description: 'd', ts: _now()
            });
            M.registerArchetype({
                userId: UID_GET, resolvedEnv: ENV,
                archetypeId: 'gt_agg', archetypeName: 'aggressive',
                traits: {}, priorityWeights: {}, description: 'd', ts: _now()
            });
            M.recordTreaty({
                userId: UID_GET, resolvedEnv: ENV,
                treatyId: 'gt_t1', changeLabel: 'test_change',
                archetypeId: 'gt_cons', horizon: 'near_term',
                approvalScore: 0.8, regretScore: 0.2, ts: _now()
            });
            M.recordTreaty({
                userId: UID_GET, resolvedEnv: ENV,
                treatyId: 'gt_t2', changeLabel: 'test_change',
                archetypeId: 'gt_agg', horizon: 'near_term',
                approvalScore: 0.3, regretScore: 0.6, ts: _now()
            });
            const r = M.getTreatiesForChange({
                userId: UID_GET, resolvedEnv: ENV,
                changeLabel: 'test_change'
            });
            expect(r.length).toBe(2);
        });
        test('returns [] when no treaties', () => {
            expect(M.getTreatiesForChange({
                userId: UID_GET, resolvedEnv: ENV,
                changeLabel: 'no_such_change'
            })).toEqual([]);
        });
    });

    describe('detectChangeConflict (integration)', () => {
        test('returns conflict + treaties when archetypes disagree', () => {
            M.registerArchetype({
                userId: UID_CON, resolvedEnv: ENV,
                archetypeId: 'dc_cons', archetypeName: 'conservative',
                traits: {}, priorityWeights: {}, description: 'd', ts: _now()
            });
            M.registerArchetype({
                userId: UID_CON, resolvedEnv: ENV,
                archetypeId: 'dc_agg', archetypeName: 'aggressive',
                traits: {}, priorityWeights: {}, description: 'd', ts: _now()
            });
            M.recordTreaty({
                userId: UID_CON, resolvedEnv: ENV,
                treatyId: 'dc_t1', changeLabel: 'controversial',
                archetypeId: 'dc_cons', horizon: 'long_horizon',
                approvalScore: 0.90, regretScore: 0.05, ts: _now()
            });
            M.recordTreaty({
                userId: UID_CON, resolvedEnv: ENV,
                treatyId: 'dc_t2', changeLabel: 'controversial',
                archetypeId: 'dc_agg', horizon: 'long_horizon',
                approvalScore: 0.20, regretScore: 0.70, ts: _now()
            });
            const r = M.detectChangeConflict({
                userId: UID_CON, resolvedEnv: ENV,
                changeLabel: 'controversial'
            });
            expect(r.conflictDetected).toBe(true);
            expect(r.treatyCount).toBe(2);
        });
        test('returns no-conflict when archetypes agree', () => {
            M.registerArchetype({
                userId: UID_CON, resolvedEnv: ENV,
                archetypeId: 'dc_a_consent', archetypeName: 'conservative',
                traits: {}, priorityWeights: {}, description: 'd', ts: _now()
            });
            M.recordTreaty({
                userId: UID_CON, resolvedEnv: ENV,
                treatyId: 'dc_consent', changeLabel: 'consensus',
                archetypeId: 'dc_a_consent', horizon: 'near_term',
                approvalScore: 0.80, regretScore: 0.10, ts: _now()
            });
            const r = M.detectChangeConflict({
                userId: UID_CON, resolvedEnv: ENV,
                changeLabel: 'consensus'
            });
            expect(r.conflictDetected).toBe(false);
        });
    });

    describe('isolation per user × env', () => {
        test('uid isolation', () => {
            M.registerArchetype({
                userId: UID_ISO_A, resolvedEnv: ENV,
                archetypeId: 'iso_a', archetypeName: 'conservative',
                traits: {}, priorityWeights: {}, description: 'd', ts: _now()
            });
            M.registerArchetype({
                userId: UID_ISO_B, resolvedEnv: ENV,
                archetypeId: 'iso_b', archetypeName: 'conservative',
                traits: {}, priorityWeights: {}, description: 'd', ts: _now()
            });
            const a = M.getArchetypes({
                userId: UID_ISO_A, resolvedEnv: ENV
            });
            expect(a.every(r => r.archetypeId !== 'iso_b')).toBe(true);
        });
        test('env isolation', () => {
            M.registerArchetype({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                archetypeId: 'env_demo', archetypeName: 'conservative',
                traits: {}, priorityWeights: {}, description: 'd', ts: _now()
            });
            const testnet = M.getArchetypes({
                userId: UID_ENV, resolvedEnv: 'TESTNET'
            });
            expect(testnet).toEqual([]);
        });
    });
});
