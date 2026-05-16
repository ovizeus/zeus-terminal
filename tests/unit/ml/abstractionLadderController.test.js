'use strict';

/**
 * OMEGA §131 ABSTRACTION LADDER CONTROLLER / LEVEL-OF-THOUGHT SWITCHER.
 * Canonical: /root/_review/ml_brain/ml_brain_canonic.txt lines 3798-3842.
 *
 * "la ce nivel trebuie sa gandesc problema asta ca sa o inteleg corect?"
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p131-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/_meta/abstractionLadderController');

const UID = 9131;
const UID_HISTORY = 9231;
const UID_DIST = 9331;
const UID_ISO_A = 9431;
const UID_ISO_B = 9531;
const UID_ENV = 9631;
const ENV = 'DEMO';
const _now = () => Date.now();

function cleanRows() {
    const uids = [UID, UID_HISTORY, UID_DIST,
                  UID_ISO_A, UID_ISO_B, UID_ENV];
    const placeholders = uids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ml_abstraction_log WHERE user_id IN (${placeholders})`).run(...uids);
}

beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §131 ABSTRACTION LADDER CONTROLLER', () => {

    describe('Migration 251', () => {
        test('251_ml_abstraction_log migration applied', () => {
            const row = db.prepare(
                "SELECT name FROM _migrations WHERE name = ?"
            ).get('251_ml_abstraction_log');
            expect(row).toBeTruthy();
        });

        test('entry_id UNIQUE enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_abstraction_log
                (user_id, resolved_env, entry_id, decision_id,
                 abstraction_level, prev_level, switch_action,
                 cost_score, benefit_score, net_value, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            stmt.run(UID, ENV, 'p131_e_dup', 'd1', 'execution',
                null, 'initial', 0.2, 0.5, 0.3, _now());
            expect(() => stmt.run(UID, ENV, 'p131_e_dup', 'd2',
                'htf_regime', null, 'initial', 0.3, 0.6, 0.3, _now())
            ).toThrow();
        });

        test('abstraction_level CHECK enum enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_abstraction_log
                (user_id, resolved_env, entry_id, decision_id,
                 abstraction_level, prev_level, switch_action,
                 cost_score, benefit_score, net_value, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p131_bad_level', 'd1',
                'BOGUS_LEVEL', null, 'initial', 0.2, 0.5, 0.3, _now())
            ).toThrow();
        });

        test('switch_action CHECK enum enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_abstraction_log
                (user_id, resolved_env, entry_id, decision_id,
                 abstraction_level, prev_level, switch_action,
                 cost_score, benefit_score, net_value, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p131_bad_action', 'd1',
                'execution', null, 'BOGUS', 0.2, 0.5, 0.3, _now())
            ).toThrow();
        });

        test('cost_score CHECK range enforced', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_abstraction_log
                (user_id, resolved_env, entry_id, decision_id,
                 abstraction_level, prev_level, switch_action,
                 cost_score, benefit_score, net_value, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            expect(() => stmt.run(UID, ENV, 'p131_bad_cost', 'd1',
                'execution', null, 'initial', 1.5, 0.5, 0.3, _now())
            ).toThrow();
        });

        test('prev_level CHECK enum enforced (nullable allows null)', () => {
            const stmt = db.prepare(`
                INSERT INTO ml_abstraction_log
                (user_id, resolved_env, entry_id, decision_id,
                 abstraction_level, prev_level, switch_action,
                 cost_score, benefit_score, net_value, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            // null prev_level allowed (initial)
            stmt.run(UID, ENV, 'p131_null_prev', 'd1',
                'execution', null, 'initial', 0.2, 0.5, 0.3, _now());
            // BOGUS rejected
            expect(() => stmt.run(UID, ENV, 'p131_bad_prev', 'd2',
                'execution', 'BOGUS', 'stay', 0.2, 0.5, 0.3, _now())
            ).toThrow();
        });
    });

    describe('Constants', () => {
        test('ABSTRACTION_LEVELS frozen 6 canonical entries (ordered low→high)', () => {
            expect(M.ABSTRACTION_LEVELS).toEqual([
                'tick_microstructure',
                'execution',
                'intraday_structure',
                'htf_regime',
                'macro_cross_asset',
                'strategic_constitutional'
            ]);
            expect(Object.isFrozen(M.ABSTRACTION_LEVELS)).toBe(true);
        });

        test('LEVEL_ORDER maps each level to 0..5 in order', () => {
            expect(M.LEVEL_ORDER.tick_microstructure).toBe(0);
            expect(M.LEVEL_ORDER.execution).toBe(1);
            expect(M.LEVEL_ORDER.intraday_structure).toBe(2);
            expect(M.LEVEL_ORDER.htf_regime).toBe(3);
            expect(M.LEVEL_ORDER.macro_cross_asset).toBe(4);
            expect(M.LEVEL_ORDER.strategic_constitutional).toBe(5);
        });

        test('SWITCH_ACTIONS frozen 4 entries', () => {
            expect(M.SWITCH_ACTIONS).toEqual([
                'initial', 'descend', 'rise', 'stay'
            ]);
            expect(Object.isFrozen(M.SWITCH_ACTIONS)).toBe(true);
        });

        test('SWITCH_PENALTY = 0.10', () => {
            expect(M.SWITCH_PENALTY).toBe(0.10);
        });
    });

    describe('computeNetValue (pure)', () => {
        test('positive net value', () => {
            expect(M.computeNetValue({
                costScore: 0.2, benefitScore: 0.8
            }).netValue).toBeCloseTo(0.6, 6);
        });

        test('negative net value (cost > benefit)', () => {
            expect(M.computeNetValue({
                costScore: 0.8, benefitScore: 0.3
            }).netValue).toBeCloseTo(-0.5, 6);
        });

        test('zero net value', () => {
            expect(M.computeNetValue({
                costScore: 0.5, benefitScore: 0.5
            }).netValue).toBe(0);
        });
    });

    describe('classifySwitchAction (pure)', () => {
        test('no prevLevel → initial', () => {
            expect(M.classifySwitchAction({
                prevLevel: null, newLevel: 'execution'
            }).switchAction).toBe('initial');
        });

        test('prevLevel undefined → initial', () => {
            expect(M.classifySwitchAction({
                prevLevel: undefined, newLevel: 'execution'
            }).switchAction).toBe('initial');
        });

        test('newLevel index > prevLevel index → rise', () => {
            // execution(1) → htf_regime(3)
            expect(M.classifySwitchAction({
                prevLevel: 'execution', newLevel: 'htf_regime'
            }).switchAction).toBe('rise');
        });

        test('newLevel index < prevLevel index → descend', () => {
            // htf_regime(3) → tick_microstructure(0)
            expect(M.classifySwitchAction({
                prevLevel: 'htf_regime', newLevel: 'tick_microstructure'
            }).switchAction).toBe('descend');
        });

        test('same level → stay', () => {
            expect(M.classifySwitchAction({
                prevLevel: 'execution', newLevel: 'execution'
            }).switchAction).toBe('stay');
        });

        test('invalid newLevel throws', () => {
            expect(() => M.classifySwitchAction({
                prevLevel: null, newLevel: 'BOGUS'
            })).toThrow(/invalid.*level/);
        });
    });

    describe('selectOptimalLevel (pure)', () => {
        test('returns max net_value candidate', () => {
            const r = M.selectOptimalLevel({
                candidates: [
                    { level: 'execution', cost: 0.3, benefit: 0.5 },        // net=0.2
                    { level: 'htf_regime', cost: 0.2, benefit: 0.8 },        // net=0.6
                    { level: 'macro_cross_asset', cost: 0.5, benefit: 0.4 }  // net=-0.1
                ]
            });
            expect(r.optimalLevel).toBe('htf_regime');
            expect(r.netValue).toBeCloseTo(0.6, 6);
        });

        test('tiebreak by lower cost when net_value equal', () => {
            const r = M.selectOptimalLevel({
                candidates: [
                    { level: 'execution', cost: 0.4, benefit: 0.7 },       // net=0.3
                    { level: 'htf_regime', cost: 0.2, benefit: 0.5 }        // net=0.3 ← tie, lower cost
                ]
            });
            expect(r.optimalLevel).toBe('htf_regime');
        });

        test('empty candidates throws', () => {
            expect(() => M.selectOptimalLevel({ candidates: [] })).toThrow();
        });
    });

    describe('shouldSwitch (pure)', () => {
        test('candidate exceeds current by penalty → true', () => {
            const r = M.shouldSwitch({
                currentNetValue: 0.3, candidateNetValue: 0.5,
                switchPenalty: 0.10
            });
            expect(r.shouldSwitch).toBe(true);
        });

        test('candidate exceeds current but below penalty → false', () => {
            const r = M.shouldSwitch({
                currentNetValue: 0.3, candidateNetValue: 0.35,
                switchPenalty: 0.10
            });
            expect(r.shouldSwitch).toBe(false);
        });

        test('candidate equal to current → false', () => {
            const r = M.shouldSwitch({
                currentNetValue: 0.3, candidateNetValue: 0.3,
                switchPenalty: 0.10
            });
            expect(r.shouldSwitch).toBe(false);
        });

        test('candidate worse than current → false', () => {
            const r = M.shouldSwitch({
                currentNetValue: 0.5, candidateNetValue: 0.2,
                switchPenalty: 0.10
            });
            expect(r.shouldSwitch).toBe(false);
        });

        test('default penalty used if not provided', () => {
            // delta = 0.15 > default 0.10
            const r = M.shouldSwitch({
                currentNetValue: 0.3, candidateNetValue: 0.45
            });
            expect(r.shouldSwitch).toBe(true);
        });
    });

    describe('logAbstraction', () => {
        test('persists initial entry with switch_action=initial', () => {
            const r = M.logAbstraction({
                userId: UID, resolvedEnv: ENV,
                entryId: 'p131_log_1',
                decisionId: 'dec_a',
                abstractionLevel: 'execution',
                costScore: 0.2,
                benefitScore: 0.7,
                ts: _now()
            });
            expect(r.logged).toBe(true);
            expect(r.switchAction).toBe('initial');
            expect(r.netValue).toBeCloseTo(0.5, 6);
        });

        test('persists rise switch with prev_level', () => {
            const r = M.logAbstraction({
                userId: UID, resolvedEnv: ENV,
                entryId: 'p131_log_rise',
                decisionId: 'dec_a',
                abstractionLevel: 'htf_regime',
                prevLevel: 'execution',
                costScore: 0.3, benefitScore: 0.8,
                ts: _now()
            });
            expect(r.switchAction).toBe('rise');
            expect(r.netValue).toBeCloseTo(0.5, 6);
        });

        test('persists descend switch', () => {
            const r = M.logAbstraction({
                userId: UID, resolvedEnv: ENV,
                entryId: 'p131_log_descend',
                decisionId: 'dec_b',
                abstractionLevel: 'tick_microstructure',
                prevLevel: 'htf_regime',
                costScore: 0.4, benefitScore: 0.7,
                ts: _now()
            });
            expect(r.switchAction).toBe('descend');
        });

        test('persists stay (same level)', () => {
            const r = M.logAbstraction({
                userId: UID, resolvedEnv: ENV,
                entryId: 'p131_log_stay',
                decisionId: 'dec_c',
                abstractionLevel: 'execution',
                prevLevel: 'execution',
                costScore: 0.2, benefitScore: 0.5,
                ts: _now()
            });
            expect(r.switchAction).toBe('stay');
        });

        test('duplicate entryId throws', () => {
            M.logAbstraction({
                userId: UID, resolvedEnv: ENV,
                entryId: 'p131_log_dup',
                decisionId: 'dec_d',
                abstractionLevel: 'execution',
                costScore: 0.2, benefitScore: 0.5,
                ts: _now()
            });
            expect(() => M.logAbstraction({
                userId: UID, resolvedEnv: ENV,
                entryId: 'p131_log_dup',
                decisionId: 'dec_e',
                abstractionLevel: 'htf_regime',
                costScore: 0.3, benefitScore: 0.6,
                ts: _now()
            })).toThrow(/duplicate/);
        });

        test('invalid abstractionLevel throws', () => {
            expect(() => M.logAbstraction({
                userId: UID, resolvedEnv: ENV,
                entryId: 'p131_log_bad',
                decisionId: 'dec_x',
                abstractionLevel: 'BOGUS',
                costScore: 0.2, benefitScore: 0.5,
                ts: _now()
            })).toThrow(/invalid.*level/);
        });

        test('out-of-range costScore throws', () => {
            expect(() => M.logAbstraction({
                userId: UID, resolvedEnv: ENV,
                entryId: 'p131_log_bad2',
                decisionId: 'dec_x',
                abstractionLevel: 'execution',
                costScore: 1.5, benefitScore: 0.5,
                ts: _now()
            })).toThrow();
        });
    });

    describe('getDecisionHistory', () => {
        test('returns all entries for decision ASC by ts', () => {
            const u = UID_HISTORY;
            M.logAbstraction({
                userId: u, resolvedEnv: ENV,
                entryId: 'p131_h1', decisionId: 'dec_h',
                abstractionLevel: 'execution',
                costScore: 0.2, benefitScore: 0.5, ts: 1000
            });
            M.logAbstraction({
                userId: u, resolvedEnv: ENV,
                entryId: 'p131_h2', decisionId: 'dec_h',
                abstractionLevel: 'htf_regime',
                prevLevel: 'execution',
                costScore: 0.3, benefitScore: 0.7, ts: 2000
            });
            M.logAbstraction({
                userId: u, resolvedEnv: ENV,
                entryId: 'p131_h3', decisionId: 'dec_h',
                abstractionLevel: 'tick_microstructure',
                prevLevel: 'htf_regime',
                costScore: 0.4, benefitScore: 0.5, ts: 3000
            });
            const rows = M.getDecisionHistory({
                userId: u, resolvedEnv: ENV, decisionId: 'dec_h'
            });
            expect(rows.length).toBe(3);
            expect(rows[0].entryId).toBe('p131_h1');
            expect(rows[1].switchAction).toBe('rise');
            expect(rows[2].switchAction).toBe('descend');
        });
    });

    describe('getLatestForDecision', () => {
        test('returns most recent entry', () => {
            const u = UID_HISTORY;
            M.logAbstraction({
                userId: u, resolvedEnv: ENV,
                entryId: 'p131_lat_1', decisionId: 'dec_lat',
                abstractionLevel: 'execution',
                costScore: 0.2, benefitScore: 0.5, ts: 1000
            });
            M.logAbstraction({
                userId: u, resolvedEnv: ENV,
                entryId: 'p131_lat_2', decisionId: 'dec_lat',
                abstractionLevel: 'macro_cross_asset',
                prevLevel: 'execution',
                costScore: 0.3, benefitScore: 0.8, ts: 2000
            });
            const r = M.getLatestForDecision({
                userId: u, resolvedEnv: ENV, decisionId: 'dec_lat'
            });
            expect(r.entryId).toBe('p131_lat_2');
            expect(r.abstractionLevel).toBe('macro_cross_asset');
        });

        test('returns null when no entries', () => {
            const r = M.getLatestForDecision({
                userId: UID_HISTORY, resolvedEnv: ENV,
                decisionId: 'dec_NONEXISTENT'
            });
            expect(r).toBeNull();
        });
    });

    describe('getLevelDistribution', () => {
        test('counts entries per level since timestamp', () => {
            const u = UID_DIST;
            M.logAbstraction({
                userId: u, resolvedEnv: ENV,
                entryId: 'p131_d_1', decisionId: 'd1',
                abstractionLevel: 'execution',
                costScore: 0.2, benefitScore: 0.5, ts: 1000
            });
            M.logAbstraction({
                userId: u, resolvedEnv: ENV,
                entryId: 'p131_d_2', decisionId: 'd2',
                abstractionLevel: 'execution',
                costScore: 0.2, benefitScore: 0.5, ts: 2000
            });
            M.logAbstraction({
                userId: u, resolvedEnv: ENV,
                entryId: 'p131_d_3', decisionId: 'd3',
                abstractionLevel: 'htf_regime',
                costScore: 0.3, benefitScore: 0.6, ts: 3000
            });
            const dist = M.getLevelDistribution({
                userId: u, resolvedEnv: ENV, sinceTs: 500
            });
            expect(dist.execution).toBe(2);
            expect(dist.htf_regime).toBe(1);
            expect(dist.tick_microstructure || 0).toBe(0);
        });

        test('respects sinceTs filter', () => {
            const u = UID_DIST;
            M.logAbstraction({
                userId: u, resolvedEnv: ENV,
                entryId: 'p131_d_old', decisionId: 'd_old',
                abstractionLevel: 'execution',
                costScore: 0.2, benefitScore: 0.5, ts: 100
            });
            M.logAbstraction({
                userId: u, resolvedEnv: ENV,
                entryId: 'p131_d_new', decisionId: 'd_new',
                abstractionLevel: 'htf_regime',
                costScore: 0.3, benefitScore: 0.6, ts: 5000
            });
            const dist = M.getLevelDistribution({
                userId: u, resolvedEnv: ENV, sinceTs: 1000
            });
            expect(dist.execution || 0).toBe(0);
            expect(dist.htf_regime).toBe(1);
        });
    });

    describe('isolation per user × env', () => {
        test('uid A cannot see uid B entries', () => {
            M.logAbstraction({
                userId: UID_ISO_A, resolvedEnv: ENV,
                entryId: 'p131_iso_a', decisionId: 'd_iso',
                abstractionLevel: 'execution',
                costScore: 0.2, benefitScore: 0.5, ts: _now()
            });
            M.logAbstraction({
                userId: UID_ISO_B, resolvedEnv: ENV,
                entryId: 'p131_iso_b', decisionId: 'd_iso',
                abstractionLevel: 'htf_regime',
                costScore: 0.3, benefitScore: 0.6, ts: _now()
            });
            const rows = M.getDecisionHistory({
                userId: UID_ISO_A, resolvedEnv: ENV, decisionId: 'd_iso'
            });
            expect(rows.every(r => r.entryId !== 'p131_iso_b')).toBe(true);
        });

        test('DEMO env cannot see TESTNET env', () => {
            M.logAbstraction({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                entryId: 'p131_env_demo', decisionId: 'd_env',
                abstractionLevel: 'execution',
                costScore: 0.2, benefitScore: 0.5, ts: _now()
            });
            M.logAbstraction({
                userId: UID_ENV, resolvedEnv: 'TESTNET',
                entryId: 'p131_env_testnet', decisionId: 'd_env',
                abstractionLevel: 'htf_regime',
                costScore: 0.3, benefitScore: 0.6, ts: _now()
            });
            const rows = M.getDecisionHistory({
                userId: UID_ENV, resolvedEnv: 'DEMO',
                decisionId: 'd_env'
            });
            expect(rows.every(r => r.entryId !== 'p131_env_testnet')).toBe(true);
        });
    });
});
