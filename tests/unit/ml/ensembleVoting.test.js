'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p48-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const ev = require('../../../server/services/ml/R6_shadowMeta/ensembleVoting');

const TEST_USER = 9048;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_ensemble_votes WHERE user_id = ?').run(TEST_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§48 Migration 095', () => {
    test('table ml_ensemble_votes exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_ensemble_votes'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_ensemble_votes)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'decision_id',
            'model_type', 'vote_action', 'vote_confidence', 'created_at'
        ]));
    });

    test('CHECK vote_action restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_ensemble_votes
             (user_id, resolved_env, decision_id, model_type, vote_action,
              vote_confidence, created_at)
             VALUES (?, ?, 'dec-1', 'LSTM', 'BOGUS', 0.8, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§48 Exported constants', () => {
    test('VOTE_ACTIONS has 3 entries', () => {
        expect(ev.VOTE_ACTIONS).toEqual(['BUY', 'SELL', 'NO_TRADE']);
    });

    test('AGREEMENT_SIZE_MAP per spec', () => {
        expect(ev.AGREEMENT_SIZE_MAP[3]).toBe(1.0);
        expect(ev.AGREEMENT_SIZE_MAP[2]).toBe(0.5);
        expect(ev.AGREEMENT_SIZE_MAP[1]).toBe(0);
        expect(ev.AGREEMENT_SIZE_MAP[0]).toBe(0);
    });

    test('MIN_VOTERS = 3 per spec', () => {
        expect(ev.MIN_VOTERS).toBe(3);
    });
});

describe('§48 recordModelVote', () => {
    test('records vote row', () => {
        ev.recordModelVote({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'dec-vote-1',
            modelType: 'LSTM',
            voteAction: 'BUY',
            voteConfidence: 0.85
        });
        const rows = db.prepare(
            `SELECT * FROM ml_ensemble_votes WHERE user_id = ?`
        ).all(TEST_USER);
        expect(rows).toHaveLength(1);
    });

    test('throws on invalid voteAction', () => {
        expect(() => ev.recordModelVote({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'd', modelType: 'X',
            voteAction: 'bogus', voteConfidence: 0.5
        })).toThrow(/vote/i);
    });
});

describe('§48 aggregateVotes', () => {
    test('3 BUY votes → size 100%', () => {
        for (const m of ['LSTM', 'XGBOOST', 'TRANSFORMER']) {
            ev.recordModelVote({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                decisionId: 'dec-3-agree',
                modelType: m,
                voteAction: 'BUY',
                voteConfidence: 0.8
            });
        }
        const r = ev.aggregateVotes({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'dec-3-agree'
        });
        expect(r.sizeMultiplier).toBe(1.0);
        expect(r.agreementCount).toBe(3);
        expect(r.dominantAction).toBe('BUY');
    });

    test('2/3 BUY → size 50%', () => {
        ev.recordModelVote({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'dec-2-agree',
            modelType: 'LSTM', voteAction: 'BUY', voteConfidence: 0.8
        });
        ev.recordModelVote({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'dec-2-agree',
            modelType: 'XGBOOST', voteAction: 'BUY', voteConfidence: 0.7
        });
        ev.recordModelVote({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'dec-2-agree',
            modelType: 'TRANSFORMER', voteAction: 'SELL', voteConfidence: 0.6
        });
        const r = ev.aggregateVotes({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'dec-2-agree'
        });
        expect(r.sizeMultiplier).toBe(0.5);
        expect(r.agreementCount).toBe(2);
    });

    test('1/3 each different → NO_TRADE', () => {
        ev.recordModelVote({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'dec-1-split',
            modelType: 'LSTM', voteAction: 'BUY', voteConfidence: 0.7
        });
        ev.recordModelVote({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'dec-1-split',
            modelType: 'XGBOOST', voteAction: 'SELL', voteConfidence: 0.6
        });
        ev.recordModelVote({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'dec-1-split',
            modelType: 'TRANSFORMER', voteAction: 'NO_TRADE', voteConfidence: 0.5
        });
        const r = ev.aggregateVotes({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'dec-1-split'
        });
        expect(r.sizeMultiplier).toBe(0);
        expect(r.finalDecision).toBe('NO_TRADE');
    });

    test('insufficient voters → NO_TRADE', () => {
        ev.recordModelVote({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'dec-1-only',
            modelType: 'LSTM', voteAction: 'BUY', voteConfidence: 0.9
        });
        const r = ev.aggregateVotes({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'dec-1-only'
        });
        expect(r.sizeMultiplier).toBe(0);
        expect(r.finalDecision).toBe('NO_TRADE');
        expect(r.reason).toMatch(/insufficient/i);
    });

    test('returns dominant action', () => {
        for (const m of ['LSTM', 'XGBOOST', 'TRANSFORMER']) {
            ev.recordModelVote({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                decisionId: 'dec-sell-3',
                modelType: m,
                voteAction: 'SELL',
                voteConfidence: 0.8
            });
        }
        const r = ev.aggregateVotes({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'dec-sell-3'
        });
        expect(r.dominantAction).toBe('SELL');
    });
});

describe('§48 getVotingHistory', () => {
    beforeEach(() => {
        for (let i = 0; i < 3; i++) {
            ev.recordModelVote({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                decisionId: `dec-${i}`,
                modelType: 'LSTM', voteAction: 'BUY', voteConfidence: 0.7
            });
        }
    });

    test('returns history', () => {
        const r = ev.getVotingHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r).toHaveLength(3);
    });

    test('respects limit', () => {
        const r = ev.getVotingHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV, limit: 2
        });
        expect(r).toHaveLength(2);
    });
});

describe('§48 getModelAgreementRate', () => {
    test('returns null when insufficient data', () => {
        const r = ev.getModelAgreementRate({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            modelA: 'LSTM', modelB: 'XGBOOST'
        });
        expect(r.agreementRate).toBeNull();
    });

    test('computes agreement rate for pair', () => {
        // 3 decisions where LSTM and XGBOOST agree, 1 disagree
        for (let i = 0; i < 4; i++) {
            const lstmVote = 'BUY';
            const xgbVote = i < 3 ? 'BUY' : 'SELL';
            ev.recordModelVote({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                decisionId: `dec-pair-${i}`,
                modelType: 'LSTM', voteAction: lstmVote, voteConfidence: 0.8
            });
            ev.recordModelVote({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                decisionId: `dec-pair-${i}`,
                modelType: 'XGBOOST', voteAction: xgbVote, voteConfidence: 0.8
            });
        }
        const r = ev.getModelAgreementRate({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            modelA: 'LSTM', modelB: 'XGBOOST'
        });
        expect(r.totalDecisions).toBe(4);
        expect(r.agreedCount).toBe(3);
        expect(r.agreementRate).toBeCloseTo(0.75);
    });
});

describe('§48 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9049;
        ev.recordModelVote({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'iso', modelType: 'LSTM',
            voteAction: 'BUY', voteConfidence: 0.8
        });
        const r1 = ev.getVotingHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const r2 = ev.getVotingHistory({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(r1).toHaveLength(1);
        expect(r2).toHaveLength(0);
    });
});
