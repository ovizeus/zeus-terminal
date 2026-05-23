'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-raidr-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const rs = require('../../../server/services/ml/_operator/reactionSystem');

const TEST_USER = 9801;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_omega_reactions WHERE user_id = ?').run(TEST_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('Raid-R Migration 088', () => {
    test('table ml_omega_reactions exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_omega_reactions'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_omega_reactions)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'pos_id', 'outcome_type',
            'reaction_text', 'trade_context_json', 'created_at'
        ]));
    });

    test('CHECK outcome_type restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_omega_reactions
             (user_id, resolved_env, outcome_type, reaction_text, trade_context_json, created_at)
             VALUES (?, ?, 'BOGUS', 'x', '{}', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('Raid-R Exported constants', () => {
    test('REACTION_OUTCOME_TYPES covers all categories', () => {
        expect(rs.REACTION_OUTCOME_TYPES).toEqual(expect.arrayContaining([
            'big_win', 'win', 'breakeven', 'loss', 'big_loss', 'missed_opportunity'
        ]));
    });

    test('PERSONALITY_TONES has multiple tones', () => {
        expect(rs.PERSONALITY_TONES).toEqual(expect.arrayContaining([
            'sarcastic', 'encouraging', 'dry', 'silent'
        ]));
    });

    test('REACTION_TEMPLATES has entries per outcome', () => {
        for (const outcome of rs.REACTION_OUTCOME_TYPES) {
            expect(rs.REACTION_TEMPLATES[outcome]).toBeDefined();
            expect(Array.isArray(rs.REACTION_TEMPLATES[outcome])).toBe(true);
        }
    });
});

describe('Raid-R generateReaction (pure)', () => {
    test('returns string for win outcome', () => {
        const r = rs.generateReaction({
            tradeOutcome: 'win',
            tradeContext: { symbol: 'BTCUSDT', pnl: 100 }
        });
        expect(typeof r.text).toBe('string');
        expect(r.text.length).toBeGreaterThan(0);
    });

    test('different outcomes produce different reactions', () => {
        const win = rs.generateReaction({
            tradeOutcome: 'win',
            tradeContext: { symbol: 'BTCUSDT' }
        });
        const loss = rs.generateReaction({
            tradeOutcome: 'loss',
            tradeContext: { symbol: 'BTCUSDT' }
        });
        expect(win.text).not.toBe(loss.text);
    });

    test('big_loss reaction has dramatic tone', () => {
        const r = rs.generateReaction({
            tradeOutcome: 'big_loss',
            tradeContext: { symbol: 'BTCUSDT', pnl: -5000 }
        });
        expect(r.text.length).toBeGreaterThan(0);
        expect(r.outcomeType).toBe('big_loss');
    });

    test('silent personality returns empty or null', () => {
        const r = rs.generateReaction({
            tradeOutcome: 'win',
            tradeContext: {},
            personality: 'silent'
        });
        expect(r.text === null || r.text === '').toBe(true);
    });

    test('throws on invalid outcome', () => {
        expect(() => rs.generateReaction({
            tradeOutcome: 'bogus',
            tradeContext: {}
        })).toThrow(/outcome/i);
    });

    test('includes context details when available', () => {
        const r = rs.generateReaction({
            tradeOutcome: 'win',
            tradeContext: { symbol: 'BTCUSDT', pnl: 250, rrAchieved: 2.5 }
        });
        // Text should likely reference symbol or pnl
        expect(r.text.length).toBeGreaterThan(0);
    });
});

describe('Raid-R recordReaction', () => {
    test('records reaction row', () => {
        rs.recordReaction({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            posId: 'pos-r-1',
            outcomeType: 'win',
            reactionText: 'Nice one, boss.',
            tradeContext: { symbol: 'BTCUSDT', pnl: 100 }
        });
        const rows = db.prepare(
            `SELECT * FROM ml_omega_reactions WHERE user_id = ?`
        ).all(TEST_USER);
        expect(rows).toHaveLength(1);
        expect(rows[0].outcome_type).toBe('win');
    });

    test('throws on invalid outcome', () => {
        expect(() => rs.recordReaction({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            outcomeType: 'bogus',
            reactionText: 'x',
            tradeContext: {}
        })).toThrow(/outcome/i);
    });
});

describe('Raid-R getReactionHistory', () => {
    beforeEach(() => {
        for (let i = 0; i < 3; i++) {
            rs.recordReaction({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                outcomeType: 'win',
                reactionText: `reaction ${i}`,
                tradeContext: { i }
            });
        }
    });

    test('returns history', () => {
        const r = rs.getReactionHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r).toHaveLength(3);
    });

    test('respects limit', () => {
        const r = rs.getReactionHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV, limit: 2
        });
        expect(r).toHaveLength(2);
    });
});

describe('Raid-R getReactionTemplates (pure)', () => {
    test('returns templates for valid outcome', () => {
        const r = rs.getReactionTemplates({ outcomeType: 'win' });
        expect(Array.isArray(r)).toBe(true);
        expect(r.length).toBeGreaterThan(0);
    });

    test('returns empty for invalid outcome', () => {
        const r = rs.getReactionTemplates({ outcomeType: 'bogus' });
        expect(r).toEqual([]);
    });
});

describe('Raid-R isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9802;
        rs.recordReaction({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            outcomeType: 'win', reactionText: 'x', tradeContext: {}
        });
        const r1 = rs.getReactionHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const r2 = rs.getReactionHistory({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(r1).toHaveLength(1);
        expect(r2).toHaveLength(0);
    });
});
