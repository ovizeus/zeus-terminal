'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p49-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const opt = require('../../../server/services/ml/_operator/overridePerformanceTracker');

const TEST_USER = 9049;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_override_performance WHERE user_id = ?').run(TEST_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§49 Migration 093', () => {
    test('table ml_override_performance exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_override_performance'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_override_performance)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'pos_id', 'symbol',
            'direction', 'override_type', 'original_decision_json',
            'final_decision_json', 'actor', 'actual_pnl',
            'hypothetical_bot_pnl', 'delta', 'created_at'
        ]));
    });

    test('CHECK override_type restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_override_performance
             (user_id, resolved_env, override_type,
              original_decision_json, final_decision_json, actor, created_at)
             VALUES (?, ?, 'BOGUS', '{}', '{}', 'op', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§49 Exported constants', () => {
    test('OVERRIDE_TYPES has 7 entries', () => {
        expect(opt.OVERRIDE_TYPES).toEqual(expect.arrayContaining([
            'entry', 'exit', 'size', 'sl', 'tp', 'cancel', 'skip'
        ]));
    });

    test('DELTA_CLASSIFICATION has positive/negative/neutral', () => {
        expect(opt.DELTA_CLASSIFICATION).toEqual(['POSITIVE', 'NEGATIVE', 'NEUTRAL']);
    });
});

describe('§49 recordOverride', () => {
    test('records override row', () => {
        opt.recordOverride({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: 'pos-1', symbol: 'BTCUSDT',
            direction: 'LONG',
            overrideType: 'entry',
            originalDecision: { action: 'skip', reason: 'low_score' },
            finalDecision: { action: 'enter', size: 0.5 },
            actor: 'operator'
        });
        const rows = db.prepare(
            `SELECT * FROM ml_override_performance WHERE user_id = ?`
        ).all(TEST_USER);
        expect(rows).toHaveLength(1);
        expect(rows[0].override_type).toBe('entry');
    });

    test('throws on invalid override_type', () => {
        expect(() => opt.recordOverride({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            symbol: 'BTCUSDT', direction: 'LONG',
            overrideType: 'bogus',
            originalDecision: {}, finalDecision: {},
            actor: 'op'
        })).toThrow(/override/i);
    });
});

describe('§49 recordOverrideOutcome', () => {
    test('updates with positive delta', () => {
        opt.recordOverride({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            symbol: 'BTCUSDT', direction: 'LONG',
            overrideType: 'entry',
            originalDecision: { action: 'skip' },
            finalDecision: { action: 'enter' },
            actor: 'op'
        });
        const row = db.prepare(
            `SELECT id FROM ml_override_performance WHERE user_id = ?`
        ).get(TEST_USER);
        opt.recordOverrideOutcome({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            overrideId: row.id,
            actualPnl: 100,
            hypotheticalBotPnl: 0
        });
        const updated = db.prepare(
            `SELECT * FROM ml_override_performance WHERE id = ?`
        ).get(row.id);
        expect(updated.actual_pnl).toBe(100);
        expect(updated.delta).toBe(100);
    });

    test('records negative delta when override worse', () => {
        opt.recordOverride({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            symbol: 'BTCUSDT', direction: 'LONG',
            overrideType: 'exit',
            originalDecision: { action: 'hold' },
            finalDecision: { action: 'exit_early' },
            actor: 'op'
        });
        const row = db.prepare(
            `SELECT id FROM ml_override_performance WHERE user_id = ?`
        ).get(TEST_USER);
        opt.recordOverrideOutcome({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            overrideId: row.id,
            actualPnl: -50,
            hypotheticalBotPnl: 200
        });
        const updated = db.prepare(
            `SELECT * FROM ml_override_performance WHERE id = ?`
        ).get(row.id);
        expect(updated.delta).toBe(-250);
    });
});

describe('§49 getOverrideStats', () => {
    beforeEach(() => {
        // 3 overrides, mixed outcomes
        const overrides = [
            { actual: 100, hypo: 0 },    // +100
            { actual: -50, hypo: 200 },  // -250
            { actual: 50, hypo: 30 }     // +20
        ];
        for (const o of overrides) {
            opt.recordOverride({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                symbol: 'BTCUSDT', direction: 'LONG',
                overrideType: 'entry',
                originalDecision: {}, finalDecision: {},
                actor: 'op'
            });
            const row = db.prepare(
                `SELECT id FROM ml_override_performance WHERE user_id = ? ORDER BY id DESC LIMIT 1`
            ).get(TEST_USER);
            opt.recordOverrideOutcome({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                overrideId: row.id,
                actualPnl: o.actual,
                hypotheticalBotPnl: o.hypo
            });
        }
    });

    test('returns aggregated stats', () => {
        const r = opt.getOverrideStats({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.totalOverrides).toBe(3);
        expect(r.netDelta).toBe(-130);  // +100 -250 +20
        expect(r.positiveCount).toBe(2);
        expect(r.negativeCount).toBe(1);
    });

    test('classifies override impact', () => {
        const r = opt.getOverrideStats({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.classification).toBe('NEGATIVE');
    });
});

describe('§49 generateWeeklyReport', () => {
    test('returns report structure', () => {
        opt.recordOverride({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            symbol: 'BTCUSDT', direction: 'LONG',
            overrideType: 'entry',
            originalDecision: {}, finalDecision: {},
            actor: 'op'
        });
        const row = db.prepare(
            `SELECT id FROM ml_override_performance WHERE user_id = ?`
        ).get(TEST_USER);
        opt.recordOverrideOutcome({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            overrideId: row.id,
            actualPnl: 100,
            hypotheticalBotPnl: 50
        });

        const r = opt.generateWeeklyReport({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            weekStart: Date.now() - 7 * 86400000
        });
        expect(r.totalOverrides).toBe(1);
        expect(r.netDelta).toBe(50);
        expect(r.narrative).toMatch(/override|added|delta/i);
    });

    test('empty week produces empty narrative', () => {
        const r = opt.generateWeeklyReport({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            weekStart: Date.now() - 7 * 86400000
        });
        expect(r.totalOverrides).toBe(0);
    });
});

describe('§49 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9050;
        opt.recordOverride({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            symbol: 'BTCUSDT', direction: 'LONG',
            overrideType: 'entry',
            originalDecision: {}, finalDecision: {},
            actor: 'op'
        });
        const r1 = opt.getOverrideStats({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const r2 = opt.getOverrideStats({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(r1.totalOverrides).toBe(1);
        expect(r2.totalOverrides).toBe(0);
    });
});
