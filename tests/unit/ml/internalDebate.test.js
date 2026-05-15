'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p71-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const dbt = require('../../../server/services/ml/R6_shadowMeta/internalDebate');

const TEST_USER = 9071;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_debate_sessions WHERE user_id IN (?, ?)').run(TEST_USER, 9072);
    db.prepare('DELETE FROM ml_role_performance WHERE user_id IN (?, ?)').run(TEST_USER, 9072);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§71 Migrations 133 + 134', () => {
    test('ml_debate_sessions exists', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_debate_sessions)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'debate_id', 'proposer_thesis', 'critic_concerns_json',
            'risk_prosecutor_args_json', 'judge_verdict',
            'pro_score', 'con_score', 'vetoed_by', 'explanation'
        ]));
    });

    test('debate_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_debate_sessions
             (user_id, resolved_env, debate_id, created_at)
             VALUES (?, ?, 'UNIQ-1', ?)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_debate_sessions
             (user_id, resolved_env, debate_id, created_at)
             VALUES (?, ?, 'UNIQ-1', ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('CHECK judge_verdict restricts', () => {
        const ts = Date.now();
        expect(() => db.prepare(
            `INSERT INTO ml_debate_sessions
             (user_id, resolved_env, debate_id, judge_verdict, created_at)
             VALUES (?, ?, 'BAD-1', 'BOGUS', ?)`
        ).run(TEST_USER, TEST_ENV, ts)).toThrow();
    });

    test('CHECK role restricts', () => {
        const ts = Date.now();
        expect(() => db.prepare(
            `INSERT INTO ml_role_performance
             (user_id, resolved_env, role, last_updated)
             VALUES (?, ?, 'BOGUS', ?)`
        ).run(TEST_USER, TEST_ENV, ts)).toThrow();
    });
});

describe('§71 Constants', () => {
    test('DEBATE_ROLES has 4 entries', () => {
        expect(dbt.DEBATE_ROLES).toEqual([
            'proposer', 'critic', 'risk_prosecutor', 'judge'
        ]);
    });

    test('JUDGE_VERDICTS has 5 entries', () => {
        expect(dbt.JUDGE_VERDICTS).toEqual([
            'LONG', 'SHORT', 'NO_TRADE', 'WAIT', 'REDUCE'
        ]);
    });

    test('VETO_SOURCES has 4 entries', () => {
        expect(dbt.VETO_SOURCES).toEqual([
            'none', 'critic', 'risk_prosecutor', 'both'
        ]);
    });

    test('VETO_OVERRIDE_RATIO > 1', () => {
        expect(dbt.VETO_OVERRIDE_RATIO).toBeGreaterThan(1);
    });
});

describe('§71 recordProposerThesis', () => {
    test('persists', () => {
        dbt.recordProposerThesis({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            debateId: 'D-001',
            thesis: 'breakout long', proScore: 0.7
        });
        const rows = db.prepare(
            `SELECT * FROM ml_debate_sessions WHERE debate_id = 'D-001'`
        ).all();
        expect(rows).toHaveLength(1);
    });

    test('duplicate debate_id throws', () => {
        dbt.recordProposerThesis({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            debateId: 'D-DUP', thesis: 't', proScore: 0.5
        });
        expect(() => dbt.recordProposerThesis({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            debateId: 'D-DUP', thesis: 't', proScore: 0.5
        })).toThrow(/duplicate/i);
    });
});

describe('§71 recordCriticConcerns', () => {
    test('persists concerns + veto flag', () => {
        dbt.recordProposerThesis({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            debateId: 'D-C1', thesis: 't', proScore: 0.5
        });
        const r = dbt.recordCriticConcerns({
            debateId: 'D-C1',
            concerns: ['regime conflict', 'high vol'],
            conScore: 0.4, vetoTriggered: true
        });
        expect(r.vetoedBy).toBe('critic');
    });

    test('throws when debate not found', () => {
        expect(() => dbt.recordCriticConcerns({
            debateId: 'NONEXISTENT',
            concerns: [], conScore: 0.1, vetoTriggered: false
        })).toThrow();
    });
});

describe('§71 recordRiskProsecutorArgs', () => {
    test('combines veto with critic when both', () => {
        dbt.recordProposerThesis({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            debateId: 'D-BOTH', thesis: 't', proScore: 0.5
        });
        dbt.recordCriticConcerns({
            debateId: 'D-BOTH', concerns: ['x'], conScore: 0.4, vetoTriggered: true
        });
        const r = dbt.recordRiskProsecutorArgs({
            debateId: 'D-BOTH', args: ['tail risk'], conScore: 0.6, vetoTriggered: true
        });
        expect(r.vetoedBy).toBe('both');
    });
});

describe('§71 evaluateDebate', () => {
    test('hard veto + low ratio → NO_TRADE', () => {
        const r = dbt.evaluateDebate({
            proScore: 0.5, conScore: 0.5,
            criticVeto: true, riskVeto: false
        });
        expect(r.verdict).toBe('NO_TRADE');
    });

    test('soft veto override → REDUCE', () => {
        const r = dbt.evaluateDebate({
            proScore: 0.9, conScore: 0.5,
            criticVeto: true, riskVeto: false
        });
        // ratio 1.8 >= 1.5 → REDUCE override
        expect(r.verdict).toBe('REDUCE');
    });

    test('strong positive no veto → LONG', () => {
        const r = dbt.evaluateDebate({
            proScore: 0.9, conScore: 0.3,
            criticVeto: false, riskVeto: false,
            proposerDirection: 'LONG'
        });
        expect(r.verdict).toBe('LONG');
    });

    test('strong positive proposes SHORT → SHORT', () => {
        const r = dbt.evaluateDebate({
            proScore: 0.9, conScore: 0.3,
            criticVeto: false, riskVeto: false,
            proposerDirection: 'SHORT'
        });
        expect(r.verdict).toBe('SHORT');
    });

    test('weak positive no veto → WAIT', () => {
        const r = dbt.evaluateDebate({
            proScore: 0.55, conScore: 0.50,
            criticVeto: false, riskVeto: false
        });
        expect(r.verdict).toBe('WAIT');
    });

    test('con >= pro → NO_TRADE', () => {
        const r = dbt.evaluateDebate({
            proScore: 0.3, conScore: 0.5,
            criticVeto: false, riskVeto: false
        });
        expect(r.verdict).toBe('NO_TRADE');
    });

    test('invalid direction throws', () => {
        expect(() => dbt.evaluateDebate({
            proScore: 0.5, conScore: 0.3,
            criticVeto: false, riskVeto: false,
            proposerDirection: 'BOGUS'
        })).toThrow();
    });
});

describe('§71 recordJudgeVerdict', () => {
    test('persists verdict', () => {
        dbt.recordProposerThesis({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            debateId: 'D-J1', thesis: 't', proScore: 0.7
        });
        dbt.recordJudgeVerdict({
            debateId: 'D-J1', verdict: 'LONG',
            explanation: 'strong proposer thesis with low critic concerns'
        });
        const rows = db.prepare(
            `SELECT * FROM ml_debate_sessions WHERE debate_id = 'D-J1'`
        ).all();
        expect(rows[0].judge_verdict).toBe('LONG');
    });

    test('throws on invalid verdict', () => {
        dbt.recordProposerThesis({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            debateId: 'D-J2', thesis: 't', proScore: 0.5
        });
        expect(() => dbt.recordJudgeVerdict({
            debateId: 'D-J2', verdict: 'BOGUS', explanation: 'x'
        })).toThrow();
    });
});

describe('§71 recordRoleOutcome + getRoleQuality', () => {
    test('persists outcome + computes quality score', () => {
        dbt.recordRoleOutcome({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            role: 'proposer', correct: true
        });
        dbt.recordRoleOutcome({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            role: 'proposer', falsePositive: true
        });
        const q = dbt.getRoleQuality({
            userId: TEST_USER, resolvedEnv: TEST_ENV, role: 'proposer'
        });
        expect(q.exists).toBe(true);
        expect(q.totalDecisions).toBe(2);
        expect(q.correctCalls).toBe(1);
        expect(q.falsePositives).toBe(1);
    });

    test('throws on invalid role', () => {
        expect(() => dbt.recordRoleOutcome({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            role: 'BOGUS', correct: true
        })).toThrow();
    });
});

describe('§71 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9072;
        dbt.recordProposerThesis({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            debateId: 'D-ISO', thesis: 't', proScore: 0.5
        });
        const h1 = dbt.getDebateHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const h2 = dbt.getDebateHistory({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(h1.length).toBe(1);
        expect(h2.length).toBe(0);
    });
});
