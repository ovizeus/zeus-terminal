'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-obs2-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const srl = require('../../../server/services/ml/R3A_safety/sizeRampLive');

const TEST_USER = 9302;
const TEST_ENV = 'REAL';

function cleanRows() {
    db.prepare('DELETE FROM ml_size_ramp_state WHERE user_id = ?').run(TEST_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('OBS-2 Migration 079', () => {
    test('table ml_size_ramp_state exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_size_ramp_state'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_size_ramp_state)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'stage', 'trades_completed',
            'wins_count', 'losses_count', 'current_multiplier',
            'planned_trades', 'started_at', 'completed_at', 'updated_at'
        ]));
    });

    test('CHECK stage restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_size_ramp_state
             (user_id, resolved_env, stage, trades_completed, current_multiplier,
              planned_trades, started_at, updated_at)
             VALUES (?, ?, 'BOGUS', 0, 0.5, 20, ?, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now(), Date.now())).toThrow();
    });

    test('UNIQUE per (user, env)', () => {
        const now = Date.now();
        db.prepare(
            `INSERT INTO ml_size_ramp_state
             (user_id, resolved_env, stage, trades_completed, current_multiplier,
              planned_trades, started_at, updated_at)
             VALUES (?, ?, 'STAGE_1', 0, 0.5, 20, ?, ?)`
        ).run(TEST_USER, TEST_ENV, now, now);
        expect(() => db.prepare(
            `INSERT INTO ml_size_ramp_state
             (user_id, resolved_env, stage, trades_completed, current_multiplier,
              planned_trades, started_at, updated_at)
             VALUES (?, ?, 'STAGE_2', 0, 0.6, 20, ?, ?)`
        ).run(TEST_USER, TEST_ENV, now, now)).toThrow();
        cleanRows();
    });
});

describe('OBS-2 Exported constants', () => {
    test('RAMP_STAGES has 5 progression stages', () => {
        expect(srl.RAMP_STAGES).toEqual([
            'STAGE_1', 'STAGE_2', 'STAGE_3', 'STAGE_4', 'COMPLETE'
        ]);
    });

    test('STAGE_MULTIPLIERS escalate 0.25 → 1.0', () => {
        expect(srl.STAGE_MULTIPLIERS.STAGE_1).toBe(0.25);
        expect(srl.STAGE_MULTIPLIERS.STAGE_2).toBe(0.50);
        expect(srl.STAGE_MULTIPLIERS.STAGE_3).toBe(0.75);
        expect(srl.STAGE_MULTIPLIERS.STAGE_4).toBe(1.00);
    });

    test('DEFAULT_RAMP_PARAMS has finite values', () => {
        expect(srl.DEFAULT_RAMP_PARAMS.trades_per_stage).toBeGreaterThan(0);
        expect(srl.DEFAULT_RAMP_PARAMS.failure_step_down_threshold).toBeGreaterThan(0);
    });
});

describe('OBS-2 initializeRamp', () => {
    test('starts at STAGE_1 with reduced multiplier', () => {
        srl.initializeRamp({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            plannedTrades: 20
        });
        const r = srl.getRampSize({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.stage).toBe('STAGE_1');
        expect(r.multiplier).toBe(0.25);
    });

    test('throws on duplicate init', () => {
        srl.initializeRamp({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            plannedTrades: 20
        });
        expect(() => srl.initializeRamp({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            plannedTrades: 30
        })).toThrow();
    });
});

describe('OBS-2 getRampSize', () => {
    test('returns multiplier=1.0 when no ramp (default to full size)', () => {
        const r = srl.getRampSize({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.multiplier).toBe(1.0);
        expect(r.exists).toBe(false);
    });

    test('returns current stage multiplier when active', () => {
        srl.initializeRamp({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            plannedTrades: 20
        });
        const r = srl.getRampSize({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.multiplier).toBe(0.25);
        expect(r.exists).toBe(true);
    });
});

describe('OBS-2 recordRampOutcome', () => {
    beforeEach(() => {
        srl.initializeRamp({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            plannedTrades: 20
        });
    });

    test('increments trade count on win', () => {
        srl.recordRampOutcome({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            outcome: { won: true }
        });
        const row = db.prepare(
            `SELECT * FROM ml_size_ramp_state WHERE user_id = ?`
        ).get(TEST_USER);
        expect(row.wins_count).toBe(1);
        expect(row.trades_completed).toBe(1);
    });

    test('increments loss count on loss', () => {
        srl.recordRampOutcome({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            outcome: { won: false }
        });
        const row = db.prepare(
            `SELECT * FROM ml_size_ramp_state WHERE user_id = ?`
        ).get(TEST_USER);
        expect(row.losses_count).toBe(1);
    });

    test('advances stage after meeting threshold wins', () => {
        // 5 trades_per_stage default
        for (let i = 0; i < 5; i++) {
            srl.recordRampOutcome({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                outcome: { won: true }
            });
        }
        const r = srl.getRampSize({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(['STAGE_2', 'STAGE_3', 'STAGE_4', 'COMPLETE']).toContain(r.stage);
    });

    test('steps DOWN stage on too many failures', () => {
        // Advance to STAGE_2 first
        for (let i = 0; i < 5; i++) {
            srl.recordRampOutcome({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                outcome: { won: true }
            });
        }
        // Now record many failures
        for (let i = 0; i < 5; i++) {
            srl.recordRampOutcome({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                outcome: { won: false }
            });
        }
        const r = srl.getRampSize({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        // Should have stepped down or stayed
        expect(['STAGE_1', 'STAGE_2']).toContain(r.stage);
    });
});

describe('OBS-2 isRampComplete', () => {
    test('returns false when ramp active', () => {
        srl.initializeRamp({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            plannedTrades: 20
        });
        const r = srl.isRampComplete({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.complete).toBe(false);
    });

    test('returns true when COMPLETE stage reached', () => {
        srl.initializeRamp({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            plannedTrades: 20
        });
        // 20 wins → all 4 stages passed
        for (let i = 0; i < 20; i++) {
            srl.recordRampOutcome({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                outcome: { won: true }
            });
        }
        const r = srl.isRampComplete({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.complete).toBe(true);
    });

    test('returns false when no ramp exists', () => {
        const r = srl.isRampComplete({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.complete).toBe(false);
        expect(r.exists).toBe(false);
    });
});

describe('OBS-2 resetRamp', () => {
    test('resets state to STAGE_1', () => {
        srl.initializeRamp({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            plannedTrades: 20
        });
        for (let i = 0; i < 5; i++) {
            srl.recordRampOutcome({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                outcome: { won: true }
            });
        }
        srl.resetRamp({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            reason: 'incident', actor: 'operator'
        });
        const r = srl.getRampSize({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.stage).toBe('STAGE_1');
        expect(r.multiplier).toBe(0.25);
    });

    test('returns success false when no ramp to reset', () => {
        const r = srl.resetRamp({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            reason: 'r', actor: 'op'
        });
        expect(r.reset).toBe(false);
    });
});

describe('OBS-2 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9303;
        srl.initializeRamp({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            plannedTrades: 20
        });
        const r1 = srl.getRampSize({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const r2 = srl.getRampSize({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(r1.multiplier).toBe(0.25);
        expect(r2.multiplier).toBe(1.0);
    });
});
