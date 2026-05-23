'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p101-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const ss = require('../../../server/services/ml/_meta/socraticSelfDoubt');

const TEST_USER = 9101;
const OTHER_USER = 9102;
const TEST_ENV = 'DEMO';
const DAY_MS = 86400000;

function cleanRows() {
    db.prepare('DELETE FROM ml_socratic_sessions WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
    db.prepare('DELETE FROM ml_socratic_challenges WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§101 Migrations 191 + 192', () => {
    test('session_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_socratic_sessions
             (user_id, resolved_env, session_id, trigger,
              beliefs_examined, beliefs_falsified, status, ts_started, ts_closed)
             VALUES (?, ?, 'SS-UNIQ', 'manual', 0, 0, 'OPEN', ?, NULL)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_socratic_sessions
             (user_id, resolved_env, session_id, trigger,
              beliefs_examined, beliefs_falsified, status, ts_started, ts_closed)
             VALUES (?, ?, 'SS-UNIQ', 'periodic_interval', 0, 0, 'OPEN', ?, NULL)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('CHECK trigger restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_socratic_sessions
             (user_id, resolved_env, session_id, trigger,
              beliefs_examined, beliefs_falsified, status, ts_started, ts_closed)
             VALUES (?, ?, 'SS-BAD', 'BOGUS', 0, 0, 'OPEN', ?, NULL)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK falsification_result restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_socratic_challenges
             (user_id, resolved_env, challenge_id, session_id, belief_id,
              premise, counterfactual, falsification_result,
              evidence_score, ts)
             VALUES (?, ?, 'C-BAD', 'S', 'B', 'p', 'cf', 'BOGUS', 0.5, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§101 Constants', () => {
    test('SOCRATIC_TRIGGERS has 3 entries', () => {
        expect(ss.SOCRATIC_TRIGGERS).toEqual([
            'periodic_interval', 'post_good_performance', 'manual'
        ]);
    });

    test('FALSIFICATION_RESULTS has 4 entries', () => {
        expect(ss.FALSIFICATION_RESULTS).toEqual([
            'CONFIRMED', 'QUESTIONED', 'REFUTED', 'INCONCLUSIVE'
        ]);
    });

    test('DOGMATISM threshold > periodic interval', () => {
        expect(ss.DOGMATISM_RISK_THRESHOLD_DAYS)
            .toBeGreaterThan(ss.DEFAULT_PERIODIC_INTERVAL_DAYS);
    });
});

describe('§101 evaluateBeliefRobustness (pure)', () => {
    test('strong evidence for → CONFIRMED', () => {
        const r = ss.evaluateBeliefRobustness({
            evidenceFor: 8, evidenceAgainst: 1
        });
        expect(r.result).toBe('CONFIRMED');
    });

    test('strong evidence against → REFUTED', () => {
        const r = ss.evaluateBeliefRobustness({
            evidenceFor: 1, evidenceAgainst: 9
        });
        expect(r.result).toBe('REFUTED');
    });

    test('mixed evidence → QUESTIONED', () => {
        const r = ss.evaluateBeliefRobustness({
            evidenceFor: 5, evidenceAgainst: 5
        });
        expect(r.result).toBe('QUESTIONED');
    });

    test('insufficient evidence → INCONCLUSIVE', () => {
        const r = ss.evaluateBeliefRobustness({
            evidenceFor: 1, evidenceAgainst: 0
        });
        expect(r.result).toBe('INCONCLUSIVE');
    });
});

describe('§101 triggerSocraticSession', () => {
    test('persists OPEN', () => {
        const r = ss.triggerSocraticSession({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            sessionId: 'TS-1', trigger: 'manual'
        });
        expect(r.triggered).toBe(true);
        expect(r.status).toBe('OPEN');
    });

    test('duplicate throws', () => {
        ss.triggerSocraticSession({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            sessionId: 'TS-DUP', trigger: 'manual'
        });
        expect(() => ss.triggerSocraticSession({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            sessionId: 'TS-DUP', trigger: 'periodic_interval'
        })).toThrow();
    });

    test('invalid trigger throws', () => {
        expect(() => ss.triggerSocraticSession({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            sessionId: 'TS-BAD', trigger: 'BOGUS'
        })).toThrow();
    });
});

describe('§101 recordBeliefChallenge', () => {
    test('persists into OPEN session', () => {
        ss.triggerSocraticSession({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            sessionId: 'RC-S', trigger: 'manual'
        });
        const r = ss.recordBeliefChallenge({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            challengeId: 'RC-C1', sessionId: 'RC-S',
            beliefId: 'cross_venue_works',
            premise: 'cross-venue divergence wins',
            counterfactual: 'venues might converge after sync',
            falsificationResult: 'QUESTIONED',
            evidenceScore: 0.4
        });
        expect(r.recorded).toBe(true);
    });

    test('CLOSED session rejects new challenge', () => {
        ss.triggerSocraticSession({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            sessionId: 'RC-CS', trigger: 'manual'
        });
        ss.closeSession({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            sessionId: 'RC-CS'
        });
        expect(() => ss.recordBeliefChallenge({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            challengeId: 'RC-CS-1', sessionId: 'RC-CS',
            beliefId: 'b', premise: 'p', counterfactual: 'c',
            falsificationResult: 'CONFIRMED'
        })).toThrow();
    });

    test('invalid result throws', () => {
        ss.triggerSocraticSession({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            sessionId: 'RC-IR', trigger: 'manual'
        });
        expect(() => ss.recordBeliefChallenge({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            challengeId: 'RC-IR-1', sessionId: 'RC-IR',
            beliefId: 'b', premise: 'p', counterfactual: 'c',
            falsificationResult: 'BOGUS'
        })).toThrow();
    });
});

describe('§101 closeSession', () => {
    test('aggregates examined + falsified counts', () => {
        ss.triggerSocraticSession({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            sessionId: 'CL-1', trigger: 'manual'
        });
        ss.recordBeliefChallenge({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            challengeId: 'CL-C1', sessionId: 'CL-1',
            beliefId: 'b1', premise: 'p', counterfactual: 'c',
            falsificationResult: 'CONFIRMED'
        });
        ss.recordBeliefChallenge({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            challengeId: 'CL-C2', sessionId: 'CL-1',
            beliefId: 'b2', premise: 'p', counterfactual: 'c',
            falsificationResult: 'REFUTED'
        });
        ss.recordBeliefChallenge({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            challengeId: 'CL-C3', sessionId: 'CL-1',
            beliefId: 'b3', premise: 'p', counterfactual: 'c',
            falsificationResult: 'QUESTIONED'
        });
        const r = ss.closeSession({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            sessionId: 'CL-1'
        });
        expect(r.closed).toBe(true);
        expect(r.beliefsExamined).toBe(3);
        // REFUTED + QUESTIONED = 2 falsified
        expect(r.beliefsFalsified).toBe(2);
    });

    test('re-close is no-op', () => {
        ss.triggerSocraticSession({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            sessionId: 'CL-2', trigger: 'manual'
        });
        ss.closeSession({
            userId: TEST_USER, resolvedEnv: TEST_ENV, sessionId: 'CL-2'
        });
        const r = ss.closeSession({
            userId: TEST_USER, resolvedEnv: TEST_ENV, sessionId: 'CL-2'
        });
        expect(r.closed).toBe(false);
    });
});

describe('§101 getDogmatismRisk', () => {
    test('no sessions → at risk', () => {
        const r = ss.getDogmatismRisk({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.atRisk).toBe(true);
        expect(r.reason).toBe('no_sessions_ever');
    });

    test('recent session → not at risk', () => {
        ss.triggerSocraticSession({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            sessionId: 'DR-1', trigger: 'manual',
            ts: Date.now()
        });
        const r = ss.getDogmatismRisk({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.atRisk).toBe(false);
    });

    test('ancient session → at risk', () => {
        const ancient = Date.now() - 60 * DAY_MS;
        ss.triggerSocraticSession({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            sessionId: 'DR-OLD', trigger: 'manual',
            ts: ancient
        });
        const r = ss.getDogmatismRisk({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.atRisk).toBe(true);
    });
});

describe('§101 isolation', () => {
    test('per (user × env) isolation', () => {
        ss.triggerSocraticSession({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            sessionId: 'ISO-1', trigger: 'manual'
        });
        const a = ss.getSocraticHistory({ userId: TEST_USER, resolvedEnv: TEST_ENV });
        const b = ss.getSocraticHistory({ userId: OTHER_USER, resolvedEnv: TEST_ENV });
        expect(a).toHaveLength(1);
        expect(b).toHaveLength(0);
    });
});
