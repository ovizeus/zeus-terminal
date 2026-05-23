'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p43-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const nt = require('../../../server/services/ml/_crosscutting/noTradeExplainability');

const TEST_USER = 9043;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_no_trade_decisions WHERE user_id = ?').run(TEST_USER);
    db.prepare('DELETE FROM ml_no_trade_outcomes WHERE user_id = ?').run(TEST_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§43 Migration 089', () => {
    test('table ml_no_trade_decisions exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_no_trade_decisions'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('table ml_no_trade_outcomes exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_no_trade_outcomes'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('decisions has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_no_trade_decisions)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'symbol',
            'signal_candidate_json', 'veto_reason', 'score',
            'threshold', 'regime', 'expected_direction', 'created_at'
        ]));
    });

    test('outcomes has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_no_trade_outcomes)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'no_trade_id', 'user_id', 'resolved_env',
            'market_move_r', 'direction_matched', 'outcome_type',
            'validated_at'
        ]));
    });

    test('CHECK outcome_type restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_no_trade_outcomes
             (no_trade_id, user_id, resolved_env, market_move_r,
              direction_matched, outcome_type, validated_at)
             VALUES (1, ?, ?, 1.0, 1, 'BOGUS', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§43 Exported constants', () => {
    test('NO_TRADE_REASONS has expected entries', () => {
        expect(nt.NO_TRADE_REASONS).toEqual(expect.arrayContaining([
            'signal_below_threshold', 'veto_active',
            'regime_mismatch', 'data_stale',
            'portfolio_full', 'observer_mode',
            'circuit_breaker', 'low_confidence'
        ]));
    });

    test('OUTCOME_TYPES has 4 spec entries', () => {
        expect(nt.OUTCOME_TYPES).toEqual([
            'MISSED_OPPORTUNITY', 'GOOD_SKIP', 'NEUTRAL', 'PENDING'
        ]);
    });

    test('MISSED_OPPORTUNITY_R_THRESHOLD = 3.0 per spec', () => {
        expect(nt.MISSED_OPPORTUNITY_R_THRESHOLD).toBeCloseTo(3.0);
    });
});

describe('§43 recordNoTrade', () => {
    test('records refusal row', () => {
        nt.recordNoTrade({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            symbol: 'BTCUSDT',
            signalCandidate: { score: 0.55, type: 'long_setup' },
            vetoReason: 'signal_below_threshold',
            score: 0.55, threshold: 0.65,
            regime: 'chop',
            expectedDirection: 'LONG'
        });
        const rows = db.prepare(
            `SELECT * FROM ml_no_trade_decisions WHERE user_id = ?`
        ).all(TEST_USER);
        expect(rows).toHaveLength(1);
        expect(rows[0].veto_reason).toBe('signal_below_threshold');
    });

    test('throws on invalid veto_reason', () => {
        expect(() => nt.recordNoTrade({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            symbol: 'BTCUSDT',
            signalCandidate: {},
            vetoReason: 'bogus_reason',
            score: 0.5, threshold: 0.6
        })).toThrow(/veto|reason/i);
    });
});

describe('§43 recordRetrospectiveOutcome', () => {
    test('records retrospective outcome', () => {
        nt.recordNoTrade({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            symbol: 'BTCUSDT',
            signalCandidate: { score: 0.55 },
            vetoReason: 'signal_below_threshold',
            score: 0.55, threshold: 0.65,
            expectedDirection: 'LONG'
        });
        const noTradeRow = db.prepare(
            `SELECT id FROM ml_no_trade_decisions WHERE user_id = ?`
        ).get(TEST_USER);
        nt.recordRetrospectiveOutcome({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            noTradeId: noTradeRow.id,
            marketMoveR: 3.5,
            directionMatched: true
        });
        const outcome = db.prepare(
            `SELECT * FROM ml_no_trade_outcomes WHERE user_id = ?`
        ).get(TEST_USER);
        expect(outcome.outcome_type).toBe('MISSED_OPPORTUNITY');
    });

    test('classifies as GOOD_SKIP when direction not matched', () => {
        nt.recordNoTrade({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            symbol: 'BTCUSDT',
            signalCandidate: {},
            vetoReason: 'veto_active',
            score: 0.5, threshold: 0.6,
            expectedDirection: 'LONG'
        });
        const noTradeRow = db.prepare(
            `SELECT id FROM ml_no_trade_decisions WHERE user_id = ?`
        ).get(TEST_USER);
        nt.recordRetrospectiveOutcome({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            noTradeId: noTradeRow.id,
            marketMoveR: 2.0,
            directionMatched: false
        });
        const outcome = db.prepare(
            `SELECT * FROM ml_no_trade_outcomes WHERE user_id = ?`
        ).get(TEST_USER);
        expect(outcome.outcome_type).toBe('GOOD_SKIP');
    });

    test('classifies small moves as NEUTRAL', () => {
        nt.recordNoTrade({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            symbol: 'BTCUSDT',
            signalCandidate: {},
            vetoReason: 'data_stale',
            score: 0.5, threshold: 0.6
        });
        const noTradeRow = db.prepare(
            `SELECT id FROM ml_no_trade_decisions WHERE user_id = ?`
        ).get(TEST_USER);
        nt.recordRetrospectiveOutcome({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            noTradeId: noTradeRow.id,
            marketMoveR: 0.5,
            directionMatched: true
        });
        const outcome = db.prepare(
            `SELECT * FROM ml_no_trade_outcomes WHERE user_id = ?`
        ).get(TEST_USER);
        expect(outcome.outcome_type).toBe('NEUTRAL');
    });
});

describe('§43 getNoTradeStats', () => {
    beforeEach(() => {
        for (const reason of ['signal_below_threshold', 'veto_active', 'signal_below_threshold']) {
            nt.recordNoTrade({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                symbol: 'BTCUSDT',
                signalCandidate: {},
                vetoReason: reason,
                score: 0.5, threshold: 0.6,
                regime: 'trend'
            });
        }
    });

    test('returns aggregated stats', () => {
        const r = nt.getNoTradeStats({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.totalNoTrades).toBe(3);
        expect(r.byReason.signal_below_threshold).toBe(2);
        expect(r.byReason.veto_active).toBe(1);
    });

    test('filters by regime', () => {
        nt.recordNoTrade({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            symbol: 'BTCUSDT',
            signalCandidate: {},
            vetoReason: 'veto_active',
            score: 0.5, threshold: 0.6,
            regime: 'range'
        });
        const r = nt.getNoTradeStats({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            regime: 'trend'
        });
        expect(r.totalNoTrades).toBe(3);
    });
});

describe('§43 getMissedOpportunities', () => {
    test('returns 3R+ missed opportunities', () => {
        nt.recordNoTrade({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            symbol: 'BTCUSDT',
            signalCandidate: {},
            vetoReason: 'signal_below_threshold',
            score: 0.5, threshold: 0.6
        });
        const noTradeRow = db.prepare(
            `SELECT id FROM ml_no_trade_decisions WHERE user_id = ?`
        ).get(TEST_USER);
        nt.recordRetrospectiveOutcome({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            noTradeId: noTradeRow.id,
            marketMoveR: 3.5,
            directionMatched: true
        });
        const r = nt.getMissedOpportunities({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r).toHaveLength(1);
    });

    test('respects minMissedR filter', () => {
        // Setup multiple misses with varying sizes
        for (const r of [1.5, 3.5, 5.0]) {
            nt.recordNoTrade({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                symbol: 'BTCUSDT',
                signalCandidate: {},
                vetoReason: 'veto_active',
                score: 0.5, threshold: 0.6
            });
            const row = db.prepare(
                `SELECT id FROM ml_no_trade_decisions WHERE user_id = ? ORDER BY id DESC LIMIT 1`
            ).get(TEST_USER);
            nt.recordRetrospectiveOutcome({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                noTradeId: row.id,
                marketMoveR: r,
                directionMatched: true
            });
        }
        const r = nt.getMissedOpportunities({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            minMissedR: 4.0
        });
        expect(r).toHaveLength(1);
    });
});

describe('§43 getSelectivityScore', () => {
    test('returns null when insufficient data', () => {
        const r = nt.getSelectivityScore({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.score).toBeNull();
    });

    test('high MISSED_OPPORTUNITY rate → too selective', () => {
        for (let i = 0; i < 10; i++) {
            nt.recordNoTrade({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                symbol: 'BTCUSDT',
                signalCandidate: {},
                vetoReason: 'signal_below_threshold',
                score: 0.5, threshold: 0.6
            });
            const row = db.prepare(
                `SELECT id FROM ml_no_trade_decisions WHERE user_id = ? ORDER BY id DESC LIMIT 1`
            ).get(TEST_USER);
            nt.recordRetrospectiveOutcome({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                noTradeId: row.id,
                marketMoveR: 3.5,
                directionMatched: true
            });
        }
        const r = nt.getSelectivityScore({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.classification).toBe('TOO_SELECTIVE');
        expect(r.missRate).toBeGreaterThan(0.7);
    });

    test('high GOOD_SKIP rate → appropriate selectivity', () => {
        for (let i = 0; i < 10; i++) {
            nt.recordNoTrade({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                symbol: 'BTCUSDT',
                signalCandidate: {},
                vetoReason: 'veto_active',
                score: 0.5, threshold: 0.6
            });
            const row = db.prepare(
                `SELECT id FROM ml_no_trade_decisions WHERE user_id = ? ORDER BY id DESC LIMIT 1`
            ).get(TEST_USER);
            nt.recordRetrospectiveOutcome({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                noTradeId: row.id,
                marketMoveR: 2.0,
                directionMatched: false
            });
        }
        const r = nt.getSelectivityScore({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(['APPROPRIATE', 'GOOD']).toContain(r.classification);
    });
});

describe('§43 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9044;
        nt.recordNoTrade({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            symbol: 'BTCUSDT',
            signalCandidate: {},
            vetoReason: 'veto_active',
            score: 0.5, threshold: 0.6
        });
        const r1 = nt.getNoTradeStats({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const r2 = nt.getNoTradeStats({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(r1.totalNoTrades).toBe(1);
        expect(r2.totalNoTrades).toBe(0);
    });
});
