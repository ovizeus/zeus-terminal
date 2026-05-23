'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p37-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const fp = require('../../../server/services/ml/_meta/frequencyPhilosophy');

const TEST_USER = 9037;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare(`DELETE FROM ml_frequency_mode_state WHERE user_id = ?`).run(TEST_USER);
    db.prepare(`DELETE FROM ml_frequency_mode_transitions WHERE user_id = ?`).run(TEST_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§37 Migration 068 — frequency mode state + transitions', () => {
    test('table ml_frequency_mode_state exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_frequency_mode_state'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('table ml_frequency_mode_transitions exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_frequency_mode_transitions'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('ml_frequency_mode_state UNIQUE per (user, env)', () => {
        db.prepare(
            `INSERT INTO ml_frequency_mode_state
             (user_id, resolved_env, mode, since, reason, actor, created_at, updated_at)
             VALUES (?, ?, 'SNIPER', ?, 'init', 'op', ?, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now(), Date.now(), Date.now());
        expect(() => db.prepare(
            `INSERT INTO ml_frequency_mode_state
             (user_id, resolved_env, mode, since, reason, actor, created_at, updated_at)
             VALUES (?, ?, 'SCALP', ?, 'init', 'op', ?, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now(), Date.now(), Date.now())).toThrow();
        cleanRows();
    });

    test('CHECK mode restricts to 4 values', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_frequency_mode_state
             (user_id, resolved_env, mode, since, reason, actor, created_at, updated_at)
             VALUES (?, ?, 'BOGUS', ?, 'init', 'op', ?, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now(), Date.now(), Date.now())).toThrow();
    });
});

describe('§37 Exported constants', () => {
    test('FREQUENCY_MODES has 4 spec entries', () => {
        expect(fp.FREQUENCY_MODES).toEqual([
            'SNIPER', 'SCALP', 'OBSERVER', 'ADAPTIVE'
        ]);
    });

    test('MODE_CONFIGS has all 4 modes', () => {
        for (const m of fp.FREQUENCY_MODES) {
            expect(fp.MODE_CONFIGS[m]).toBeDefined();
            expect(typeof fp.MODE_CONFIGS[m].rrMin).toBe('number');
            expect(typeof fp.MODE_CONFIGS[m].runnerAllowed).toBe('boolean');
            expect(typeof fp.MODE_CONFIGS[m].pyramidingAllowed).toBe('boolean');
            expect(typeof fp.MODE_CONFIGS[m].sizingMultiplier).toBe('number');
        }
    });

    test('SNIPER has highest RR + runner + pyramiding per spec', () => {
        expect(fp.MODE_CONFIGS.SNIPER.rrMin).toBeGreaterThanOrEqual(2.0);
        expect(fp.MODE_CONFIGS.SNIPER.runnerAllowed).toBe(true);
        expect(fp.MODE_CONFIGS.SNIPER.pyramidingAllowed).toBe(true);
    });

    test('SCALP has lower RR + no runner per spec', () => {
        expect(fp.MODE_CONFIGS.SCALP.rrMin).toBeLessThan(fp.MODE_CONFIGS.SNIPER.rrMin);
        expect(fp.MODE_CONFIGS.SCALP.runnerAllowed).toBe(false);
    });

    test('OBSERVER has zero entries allowed (sizingMultiplier=0)', () => {
        expect(fp.MODE_CONFIGS.OBSERVER.sizingMultiplier).toBe(0);
        expect(fp.MODE_CONFIGS.OBSERVER.entriesAllowed).toBe(false);
    });

    test('ADAPTIVE has reduced sizing + harder confirmation', () => {
        expect(fp.MODE_CONFIGS.ADAPTIVE.sizingMultiplier).toBeLessThan(1.0);
        expect(fp.MODE_CONFIGS.ADAPTIVE.rrMin).toBeGreaterThan(fp.MODE_CONFIGS.SCALP.rrMin);
    });
});

describe('§37 getCurrentMode', () => {
    test('returns OBSERVER as default when no state', () => {
        const r = fp.getCurrentMode({ userId: TEST_USER, resolvedEnv: TEST_ENV });
        expect(r.mode).toBe('OBSERVER');
        expect(r.exists).toBe(false);
    });

    test('returns set mode when state exists', () => {
        fp.setMode({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            mode: 'SNIPER', reason: 'high_conviction', actor: 'op'
        });
        const r = fp.getCurrentMode({ userId: TEST_USER, resolvedEnv: TEST_ENV });
        expect(r.mode).toBe('SNIPER');
        expect(r.exists).toBe(true);
    });
});

describe('§37 setMode', () => {
    test('valid mode transition records state + history', () => {
        fp.setMode({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            mode: 'SCALP', reason: 'range_regime', actor: 'system'
        });
        const r = fp.getCurrentMode({ userId: TEST_USER, resolvedEnv: TEST_ENV });
        expect(r.mode).toBe('SCALP');
        const history = db.prepare(
            `SELECT * FROM ml_frequency_mode_transitions WHERE user_id = ?`
        ).all(TEST_USER);
        expect(history).toHaveLength(1);
    });

    test('transition to new mode updates state + adds history', () => {
        fp.setMode({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            mode: 'SCALP', reason: 'r1', actor: 'op'
        });
        fp.setMode({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            mode: 'SNIPER', reason: 'r2', actor: 'op'
        });
        const r = fp.getCurrentMode({ userId: TEST_USER, resolvedEnv: TEST_ENV });
        expect(r.mode).toBe('SNIPER');
        const history = db.prepare(
            `SELECT * FROM ml_frequency_mode_transitions WHERE user_id = ?`
        ).all(TEST_USER);
        expect(history).toHaveLength(2);
    });

    test('throws on invalid mode', () => {
        expect(() => fp.setMode({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            mode: 'BOGUS', reason: 'r', actor: 'op'
        })).toThrow(/mode/i);
    });

    test('throws on missing reason', () => {
        expect(() => fp.setMode({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            mode: 'SCALP', actor: 'op'
        })).toThrow(/reason/i);
    });
});

describe('§37 getRegimeRecommendation (pure)', () => {
    test('trend regime → SNIPER mode', () => {
        const r = fp.getRegimeRecommendation({ regime: 'trend' });
        expect(r.recommendedMode).toBe('SNIPER');
    });

    test('range regime → SCALP mode', () => {
        const r = fp.getRegimeRecommendation({ regime: 'range' });
        expect(r.recommendedMode).toBe('SCALP');
    });

    test('chop / squeeze → ADAPTIVE or OBSERVER', () => {
        const chop = fp.getRegimeRecommendation({ regime: 'chop' });
        expect(['ADAPTIVE', 'OBSERVER']).toContain(chop.recommendedMode);
    });

    test('news / high_vol → OBSERVER (safest)', () => {
        const news = fp.getRegimeRecommendation({ regime: 'news' });
        expect(news.recommendedMode).toBe('OBSERVER');
    });

    test('reason included for explainability', () => {
        const r = fp.getRegimeRecommendation({ regime: 'trend' });
        expect(typeof r.reason).toBe('string');
        expect(r.reason.length).toBeGreaterThan(0);
    });

    test('unknown regime → ADAPTIVE conservative default', () => {
        const r = fp.getRegimeRecommendation({ regime: 'unknown_xyz' });
        expect(r.recommendedMode).toBe('ADAPTIVE');
    });
});

describe('§37 getModeConfig (pure)', () => {
    test('returns full config for valid mode', () => {
        const c = fp.getModeConfig({ mode: 'SNIPER' });
        expect(c).toBeDefined();
        expect(c.rrMin).toBeDefined();
        expect(c.runnerAllowed).toBeDefined();
    });

    test('throws on invalid mode', () => {
        expect(() => fp.getModeConfig({ mode: 'BOGUS' })).toThrow(/mode/i);
    });
});

describe('§37 getModeHistory', () => {
    test('returns empty when no transitions', () => {
        const h = fp.getModeHistory({ userId: TEST_USER, resolvedEnv: TEST_ENV });
        expect(h).toEqual([]);
    });

    test('returns transitions ordered chronologically', () => {
        fp.setMode({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            mode: 'SCALP', reason: 'r1', actor: 'op'
        });
        fp.setMode({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            mode: 'SNIPER', reason: 'r2', actor: 'op'
        });
        const h = fp.getModeHistory({ userId: TEST_USER, resolvedEnv: TEST_ENV });
        expect(h.length).toBe(2);
        expect(h[0].toMode).toBe('SCALP');
        expect(h[1].toMode).toBe('SNIPER');
    });

    test('respects limit', () => {
        for (const m of ['SCALP', 'SNIPER', 'ADAPTIVE', 'SCALP']) {
            fp.setMode({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                mode: m, reason: 'r', actor: 'op'
            });
        }
        const h = fp.getModeHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV, limit: 2
        });
        expect(h).toHaveLength(2);
    });
});

describe('§37 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9038;
        fp.setMode({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            mode: 'SNIPER', reason: 'r', actor: 'op'
        });
        const r1 = fp.getCurrentMode({ userId: TEST_USER, resolvedEnv: TEST_ENV });
        const r2 = fp.getCurrentMode({ userId: OTHER_USER, resolvedEnv: TEST_ENV });
        expect(r1.mode).toBe('SNIPER');
        expect(r2.mode).toBe('OBSERVER');
    });
});
