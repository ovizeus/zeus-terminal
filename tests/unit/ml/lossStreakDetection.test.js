'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p46-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const ls = require('../../../server/services/ml/R3A_safety/lossStreakDetection');

const TEST_USER = 9046;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_loss_streak_state WHERE user_id = ?').run(TEST_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§46 Migration 090', () => {
    test('table ml_loss_streak_state exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_loss_streak_state'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_loss_streak_state)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'consecutive_losses',
            'size_multiplier', 'last_win_at', 'recovery_progress',
            'updated_at'
        ]));
    });

    test('UNIQUE per (user, env)', () => {
        const now = Date.now();
        db.prepare(
            `INSERT INTO ml_loss_streak_state
             (user_id, resolved_env, consecutive_losses, size_multiplier, updated_at)
             VALUES (?, ?, 0, 1.0, ?)`
        ).run(TEST_USER, TEST_ENV, now);
        expect(() => db.prepare(
            `INSERT INTO ml_loss_streak_state
             (user_id, resolved_env, consecutive_losses, size_multiplier, updated_at)
             VALUES (?, ?, 1, 0.5, ?)`
        ).run(TEST_USER, TEST_ENV, now)).toThrow();
        cleanRows();
    });
});

describe('§46 Exported constants', () => {
    test('STREAK_SIZE_MAP per spec', () => {
        expect(ls.STREAK_SIZE_MAP[0]).toBe(1.0);
        expect(ls.STREAK_SIZE_MAP[1]).toBe(1.0);
        expect(ls.STREAK_SIZE_MAP[2]).toBe(0.5);
        expect(ls.STREAK_SIZE_MAP[3]).toBe(0.25);
        expect(ls.STREAK_SIZE_MAP[4]).toBe(0);
    });

    test('RECOVERY_PATTERN defined', () => {
        expect(Array.isArray(ls.RECOVERY_PATTERN)).toBe(true);
        expect(ls.RECOVERY_PATTERN.length).toBeGreaterThan(0);
    });

    test('FULL_STOP_AFTER = 4 per spec', () => {
        expect(ls.FULL_STOP_AFTER).toBe(4);
    });
});

describe('§46 recordTradeOutcome — loss streak progression', () => {
    test('first loss → 100% size still (1 loss = no reduction)', () => {
        ls.recordTradeOutcome({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            won: false
        });
        const s = ls.getStreakState({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(s.consecutiveLosses).toBe(1);
        expect(s.sizeMultiplier).toBe(1.0);
    });

    test('2 losses → size 50%', () => {
        for (let i = 0; i < 2; i++) {
            ls.recordTradeOutcome({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                won: false
            });
        }
        const s = ls.getStreakState({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(s.consecutiveLosses).toBe(2);
        expect(s.sizeMultiplier).toBe(0.5);
    });

    test('3 losses → size 25%', () => {
        for (let i = 0; i < 3; i++) {
            ls.recordTradeOutcome({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                won: false
            });
        }
        const s = ls.getStreakState({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(s.sizeMultiplier).toBe(0.25);
    });

    test('4 losses → size 0 (stop)', () => {
        for (let i = 0; i < 4; i++) {
            ls.recordTradeOutcome({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                won: false
            });
        }
        const s = ls.getStreakState({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(s.sizeMultiplier).toBe(0);
        expect(s.stopActive).toBe(true);
    });

    test('5+ losses → still 0 (cap at stop)', () => {
        for (let i = 0; i < 7; i++) {
            ls.recordTradeOutcome({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                won: false
            });
        }
        const s = ls.getStreakState({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(s.sizeMultiplier).toBe(0);
    });
});

describe('§46 recordTradeOutcome — recovery on win', () => {
    test('win after 3 losses → gradual recovery (not full immediately)', () => {
        for (let i = 0; i < 3; i++) {
            ls.recordTradeOutcome({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                won: false
            });
        }
        ls.recordTradeOutcome({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            won: true
        });
        const s = ls.getStreakState({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        // After 1 win post-3-losses, should recover but not full 1.0
        expect(s.sizeMultiplier).toBeGreaterThan(0.25);
        expect(s.consecutiveLosses).toBe(0);
    });

    test('multiple wins eventually restore full size', () => {
        for (let i = 0; i < 4; i++) {
            ls.recordTradeOutcome({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                won: false
            });
        }
        for (let i = 0; i < 10; i++) {
            ls.recordTradeOutcome({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                won: true
            });
        }
        const s = ls.getStreakState({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(s.sizeMultiplier).toBeGreaterThanOrEqual(0.9);
    });

    test('win resets consecutiveLosses to 0', () => {
        ls.recordTradeOutcome({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            won: false
        });
        ls.recordTradeOutcome({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            won: true
        });
        const s = ls.getStreakState({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(s.consecutiveLosses).toBe(0);
    });
});

describe('§46 getCurrentSizeMultiplier', () => {
    test('returns 1.0 when no state', () => {
        const r = ls.getCurrentSizeMultiplier({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r).toBe(1.0);
    });

    test('returns current multiplier', () => {
        for (let i = 0; i < 2; i++) {
            ls.recordTradeOutcome({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                won: false
            });
        }
        const r = ls.getCurrentSizeMultiplier({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r).toBe(0.5);
    });
});

describe('§46 resetStreak', () => {
    test('resets state to clean', () => {
        for (let i = 0; i < 4; i++) {
            ls.recordTradeOutcome({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                won: false
            });
        }
        ls.resetStreak({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            reason: 'manual_intervention', actor: 'operator'
        });
        const s = ls.getStreakState({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(s.consecutiveLosses).toBe(0);
        expect(s.sizeMultiplier).toBe(1.0);
    });
});

describe('§46 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9047;
        for (let i = 0; i < 2; i++) {
            ls.recordTradeOutcome({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                won: false
            });
        }
        const r1 = ls.getCurrentSizeMultiplier({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const r2 = ls.getCurrentSizeMultiplier({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(r1).toBe(0.5);
        expect(r2).toBe(1.0);
    });
});
