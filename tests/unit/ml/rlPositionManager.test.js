'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p26-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const rl = require('../../../server/services/ml/R6_shadowMeta/rlPositionManager');

const TEST_USER = 9026;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_rl_decisions WHERE user_id = ?').run(TEST_USER);
    db.prepare('DELETE FROM ml_rl_validation_state WHERE user_id = ?').run(TEST_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§26 Migration 072 — RL decisions + validation state', () => {
    test('table ml_rl_decisions exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_rl_decisions'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('table ml_rl_validation_state exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_rl_validation_state'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('ml_rl_decisions has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_rl_decisions)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'pos_id', 'action_type',
            'proposed_at', 'allowed', 'blockers_json', 'executed', 'reward', 'created_at'
        ]));
    });

    test('ml_rl_validation_state UNIQUE per (user, env)', () => {
        db.prepare(
            `INSERT INTO ml_rl_validation_state
             (user_id, resolved_env, stage, since, reason, actor, created_at, updated_at)
             VALUES (?, ?, 'simulator', ?, 'init', 'op', ?, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now(), Date.now(), Date.now());
        expect(() => db.prepare(
            `INSERT INTO ml_rl_validation_state
             (user_id, resolved_env, stage, since, reason, actor, created_at, updated_at)
             VALUES (?, ?, 'shadow', ?, 'dup', 'op', ?, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now(), Date.now(), Date.now())).toThrow();
        cleanRows();
    });

    test('CHECK action_type restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_rl_decisions
             (user_id, resolved_env, action_type, allowed, blockers_json, executed, created_at)
             VALUES (?, ?, 'BOGUS', 0, '[]', 0, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK stage restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_rl_validation_state
             (user_id, resolved_env, stage, since, reason, actor, created_at, updated_at)
             VALUES (?, ?, 'BOGUS', ?, 'init', 'op', ?, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now(), Date.now(), Date.now())).toThrow();
    });
});

describe('§26 Exported constants', () => {
    test('RL_ACTION_TYPES has 5 spec entries', () => {
        expect(rl.RL_ACTION_TYPES).toHaveLength(5);
        expect(rl.RL_ACTION_TYPES).toEqual(expect.arrayContaining([
            'take_partial', 'activate_trailing', 'force_exit',
            'leave_runner', 'aggressive_reduce'
        ]));
    });

    test('VALIDATION_STAGES has 5 progression stages', () => {
        expect(rl.VALIDATION_STAGES).toEqual([
            'simulator', 'backtest', 'shadow', 'probation', 'live'
        ]);
    });

    test('RISK_CAGE_RULES has 5 invariant keys', () => {
        expect(rl.RISK_CAGE_RULES).toHaveLength(5);
        expect(rl.RISK_CAGE_RULES).toEqual(expect.arrayContaining([
            'no_max_risk_breach', 'no_veto_override',
            'no_size_cap_breach', 'no_degraded_data', 'requires_validation'
        ]));
    });
});

describe('§26 proposeManagementAction (heuristic policy)', () => {
    test('TP-near + impulse-strong → propose leave_runner or activate_trailing', () => {
        const r = rl.proposeManagementAction({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: 'pos-1',
            observation: {
                distanceToTpPct: 0.005,
                impulseStrength: 0.9,
                currentRR: 1.5,
                ddPct: 0.01
            }
        });
        expect(['leave_runner', 'activate_trailing']).toContain(r.action);
        expect(r.confidence).toBeGreaterThan(0);
    });

    test('DD exceeds threshold → propose aggressive_reduce or force_exit', () => {
        const r = rl.proposeManagementAction({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: 'pos-2',
            observation: {
                distanceToTpPct: 0.5,
                impulseStrength: 0.1,
                currentRR: -0.5,
                ddPct: 0.08
            }
        });
        expect(['aggressive_reduce', 'force_exit']).toContain(r.action);
    });

    test('RR > 1 + partial threshold → propose take_partial', () => {
        const r = rl.proposeManagementAction({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: 'pos-3',
            observation: {
                distanceToTpPct: 0.05,
                impulseStrength: 0.5,
                currentRR: 1.0,
                ddPct: 0.01,
                noPartialYet: true
            }
        });
        expect(r.action).toBe('take_partial');
    });
});

describe('§26 validateAgainstRiskCage — 5 INVARIANTS', () => {
    test('passes when all conditions safe', () => {
        const r = rl.validateAgainstRiskCage({
            action: 'take_partial',
            riskState: { currentRiskUsd: 100, maxRiskUsd: 1000 },
            vetoState: { activeVeto: false },
            dataFreshness: { fresh: true },
            sizeCapState: { withinCap: true },
            validationStage: 'live'
        });
        expect(r.allowed).toBe(true);
        expect(r.blockers).toEqual([]);
    });

    test('INVARIANT 1: max risk breach blocks action', () => {
        const r = rl.validateAgainstRiskCage({
            action: 'take_partial',
            riskState: { currentRiskUsd: 1500, maxRiskUsd: 1000 },
            vetoState: { activeVeto: false },
            dataFreshness: { fresh: true },
            sizeCapState: { withinCap: true },
            validationStage: 'live'
        });
        expect(r.allowed).toBe(false);
        expect(r.blockers).toContain('no_max_risk_breach');
    });

    test('INVARIANT 2: veto active blocks action', () => {
        const r = rl.validateAgainstRiskCage({
            action: 'take_partial',
            riskState: { currentRiskUsd: 100, maxRiskUsd: 1000 },
            vetoState: { activeVeto: true, vetoReason: 'macro_red_flag' },
            dataFreshness: { fresh: true },
            sizeCapState: { withinCap: true },
            validationStage: 'live'
        });
        expect(r.allowed).toBe(false);
        expect(r.blockers).toContain('no_veto_override');
    });

    test('INVARIANT 3: size cap breach blocks action', () => {
        const r = rl.validateAgainstRiskCage({
            action: 'take_partial',
            riskState: { currentRiskUsd: 100, maxRiskUsd: 1000 },
            vetoState: { activeVeto: false },
            dataFreshness: { fresh: true },
            sizeCapState: { withinCap: false },
            validationStage: 'live'
        });
        expect(r.allowed).toBe(false);
        expect(r.blockers).toContain('no_size_cap_breach');
    });

    test('INVARIANT 4: degraded data blocks action', () => {
        const r = rl.validateAgainstRiskCage({
            action: 'take_partial',
            riskState: { currentRiskUsd: 100, maxRiskUsd: 1000 },
            vetoState: { activeVeto: false },
            dataFreshness: { fresh: false },
            sizeCapState: { withinCap: true },
            validationStage: 'live'
        });
        expect(r.allowed).toBe(false);
        expect(r.blockers).toContain('no_degraded_data');
    });

    test('INVARIANT 5: skipping validation stages blocks live action', () => {
        const r = rl.validateAgainstRiskCage({
            action: 'take_partial',
            riskState: { currentRiskUsd: 100, maxRiskUsd: 1000 },
            vetoState: { activeVeto: false },
            dataFreshness: { fresh: true },
            sizeCapState: { withinCap: true },
            validationStage: 'simulator'  // not progressed to live
        });
        expect(r.allowed).toBe(false);
        expect(r.blockers).toContain('requires_validation');
    });
});

describe('§26 executeManagementAction', () => {
    test('records decision row with allowed=true', () => {
        rl.executeManagementAction({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: 'pos-exec-1',
            action: { action: 'take_partial', confidence: 0.8 },
            validation: { allowed: true, blockers: [] }
        });
        const rows = db.prepare(
            `SELECT * FROM ml_rl_decisions WHERE user_id = ?`
        ).all(TEST_USER);
        expect(rows).toHaveLength(1);
        expect(rows[0].allowed).toBe(1);
        expect(rows[0].executed).toBe(1);
    });

    test('records decision row with allowed=false (not executed)', () => {
        rl.executeManagementAction({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: 'pos-exec-2',
            action: { action: 'force_exit', confidence: 0.5 },
            validation: { allowed: false, blockers: ['no_veto_override'] }
        });
        const row = db.prepare(
            `SELECT * FROM ml_rl_decisions WHERE user_id = ? ORDER BY id DESC LIMIT 1`
        ).get(TEST_USER);
        expect(row.allowed).toBe(0);
        expect(row.executed).toBe(0);
    });
});

describe('§26 recordRewardSignal', () => {
    test('records reward for executed action', () => {
        rl.executeManagementAction({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: 'pos-reward-1',
            action: { action: 'leave_runner', confidence: 0.7 },
            validation: { allowed: true, blockers: [] }
        });
        rl.recordRewardSignal({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: 'pos-reward-1', action: 'leave_runner',
            outcome: { pnlUsd: 150, rrAchieved: 2.5 }
        });
        const row = db.prepare(
            `SELECT * FROM ml_rl_decisions
             WHERE user_id = ? AND pos_id = ?
             ORDER BY id DESC LIMIT 1`
        ).get(TEST_USER, 'pos-reward-1');
        expect(row.reward).toBeGreaterThan(0);
    });

    test('negative outcome → negative reward', () => {
        rl.executeManagementAction({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: 'pos-neg', action: { action: 'force_exit', confidence: 0.3 },
            validation: { allowed: true, blockers: [] }
        });
        rl.recordRewardSignal({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: 'pos-neg', action: 'force_exit',
            outcome: { pnlUsd: -100, rrAchieved: -1.5 }
        });
        const row = db.prepare(
            `SELECT * FROM ml_rl_decisions
             WHERE user_id = ? AND pos_id = ?
             ORDER BY id DESC LIMIT 1`
        ).get(TEST_USER, 'pos-neg');
        expect(row.reward).toBeLessThan(0);
    });
});

describe('§26 getValidationStage', () => {
    test('returns simulator as default when no state', () => {
        const r = rl.getValidationStage({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.stage).toBe('simulator');
        expect(r.exists).toBe(false);
    });

    test('returns set stage when initialized', () => {
        rl.advanceValidationStage({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            toStage: 'backtest', reason: 'sim_passed', actor: 'op'
        });
        const r = rl.getValidationStage({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.stage).toBe('backtest');
    });
});

describe('§26 advanceValidationStage', () => {
    test('progresses through stages sequentially', () => {
        for (const stage of ['simulator', 'backtest', 'shadow', 'probation', 'live']) {
            rl.advanceValidationStage({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                toStage: stage, reason: `progressed_to_${stage}`, actor: 'op'
            });
        }
        const r = rl.getValidationStage({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.stage).toBe('live');
    });

    test('rejects invalid stage', () => {
        expect(() => rl.advanceValidationStage({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            toStage: 'bogus_stage', reason: 'r', actor: 'op'
        })).toThrow(/stage/i);
    });
});

describe('§26 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9027;
        rl.advanceValidationStage({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            toStage: 'live', reason: 'r', actor: 'op'
        });
        const r1 = rl.getValidationStage({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const r2 = rl.getValidationStage({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(r1.stage).toBe('live');
        expect(r2.stage).toBe('simulator');
    });
});
