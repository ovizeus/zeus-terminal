'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p119-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const pmr = require('../../../server/services/ml/R3A_safety/preMortemRehearsal');

const TEST_USER = 9119;
const OTHER_USER = 9120;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_premortem_sessions WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
    db.prepare('DELETE FROM ml_premortem_failure_modes WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§119 Migrations 227 + 228', () => {
    test('session_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_premortem_sessions
             (user_id, resolved_env, session_id, decision_id,
              dominant_failure_mode, total_failure_modes,
              max_severity, aggregate_risk_score, status,
              ts_started, ts_closed)
             VALUES (?, ?, 'PMS-UNIQ', 'D', NULL, 0, 0, 0, 'OPEN', ?, NULL)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_premortem_sessions
             (user_id, resolved_env, session_id, decision_id,
              dominant_failure_mode, total_failure_modes,
              max_severity, aggregate_risk_score, status,
              ts_started, ts_closed)
             VALUES (?, ?, 'PMS-UNIQ', 'D2', NULL, 0, 0, 0, 'OPEN', ?, NULL)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('CHECK failure_kind restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_premortem_failure_modes
             (user_id, resolved_env, mode_id, session_id, failure_kind,
              severity, detectability, recoverability, action_plan, ts)
             VALUES (?, ?, 'PFM-BAD', 'S', 'BOGUS', 0.5, 0.5, 0.5, 'reduce', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK action_plan restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_premortem_failure_modes
             (user_id, resolved_env, mode_id, session_id, failure_kind,
              severity, detectability, recoverability, action_plan, ts)
             VALUES (?, ?, 'PFM-ABAD', 'S', 'fakeout', 0.5, 0.5, 0.5, 'BOGUS', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK severity range', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_premortem_failure_modes
             (user_id, resolved_env, mode_id, session_id, failure_kind,
              severity, detectability, recoverability, action_plan, ts)
             VALUES (?, ?, 'PFM-OOR', 'S', 'fakeout', 1.5, 0.5, 0.5, 'reduce', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§119 Constants', () => {
    test('FAILURE_KINDS has 8 entries', () => {
        expect(pmr.FAILURE_KINDS).toEqual([
            'thesis_invalidation_rapid', 'fakeout',
            'liquidity_vacuum', 'slippage_blowout',
            'venue_failure', 'latency_miss',
            'macro_interruption', 'cross_asset_contagion'
        ]);
    });

    test('ACTION_PLANS has 5 entries', () => {
        expect(pmr.ACTION_PLANS).toEqual([
            'reduce', 'hedge', 'exit', 'observer', 'lock'
        ]);
    });

    test('CRITICAL > HIGH thresholds', () => {
        expect(pmr.CRITICAL_RISK_THRESHOLD)
            .toBeGreaterThan(pmr.HIGH_RISK_THRESHOLD);
    });
});

describe('§119 computeRiskScore (pure)', () => {
    test('high severity + low detect + low recover → high risk', () => {
        const r = pmr.computeRiskScore({
            severity: 0.9, detectability: 0.1, recoverability: 0.1
        });
        // 0.9 × 0.9 × 0.9 = 0.729
        expect(r.riskScore).toBeCloseTo(0.729);
    });

    test('high detectability lowers risk', () => {
        const r = pmr.computeRiskScore({
            severity: 0.9, detectability: 0.9, recoverability: 0.1
        });
        // 0.9 × 0.1 × 0.9 = 0.081
        expect(r.riskScore).toBeCloseTo(0.081);
    });

    test('range violation throws', () => {
        expect(() => pmr.computeRiskScore({
            severity: 1.5, detectability: 0.5, recoverability: 0.5
        })).toThrow();
    });
});

describe('§119 selectActionPlan (pure)', () => {
    test('critical risk + low recoverability → exit or lock', () => {
        const r = pmr.selectActionPlan({
            severity: 0.95, detectability: 0.1, recoverability: 0.1
        });
        expect(['exit', 'lock']).toContain(r.actionPlan);
    });

    test('high risk → reduce or hedge', () => {
        // risk = 0.9 × (1-0.5) × (1-0.3) = 0.315 → HIGH band [0.30, 0.50)
        const r = pmr.selectActionPlan({
            severity: 0.9, detectability: 0.5, recoverability: 0.3
        });
        expect(['reduce', 'hedge']).toContain(r.actionPlan);
    });

    test('low risk → observer', () => {
        const r = pmr.selectActionPlan({
            severity: 0.3, detectability: 0.8, recoverability: 0.8
        });
        expect(r.actionPlan).toBe('observer');
    });
});

describe('§119 registerFailureMode', () => {
    test('persists', () => {
        const r = pmr.registerFailureMode({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            modeId: 'RF-1', sessionId: 'S-1',
            failureKind: 'fakeout',
            severity: 0.6, detectability: 0.4, recoverability: 0.5,
            actionPlan: 'reduce'
        });
        expect(r.registered).toBe(true);
    });

    test('duplicate throws', () => {
        pmr.registerFailureMode({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            modeId: 'RF-DUP', sessionId: 'S', failureKind: 'fakeout',
            severity: 0.5, detectability: 0.5, recoverability: 0.5,
            actionPlan: 'reduce'
        });
        expect(() => pmr.registerFailureMode({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            modeId: 'RF-DUP', sessionId: 'S2', failureKind: 'venue_failure',
            severity: 0.7, detectability: 0.3, recoverability: 0.2,
            actionPlan: 'exit'
        })).toThrow();
    });

    test('invalid failure_kind throws', () => {
        expect(() => pmr.registerFailureMode({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            modeId: 'RF-BAD', sessionId: 'S', failureKind: 'BOGUS',
            severity: 0.5, detectability: 0.5, recoverability: 0.5,
            actionPlan: 'reduce'
        })).toThrow();
    });
});

describe('§119 runPreMortemSession', () => {
    test('atomic registers session + modes + aggregate', () => {
        const r = pmr.runPreMortemSession({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            sessionId: 'RPM-1', decisionId: 'D-1',
            modes: [
                { modeId: 'M1', failureKind: 'fakeout',
                  severity: 0.7, detectability: 0.3, recoverability: 0.4,
                  actionPlan: 'reduce' },
                { modeId: 'M2', failureKind: 'venue_failure',
                  severity: 0.9, detectability: 0.2, recoverability: 0.1,
                  actionPlan: 'exit' }
            ]
        });
        expect(r.runned).toBe(true);
        expect(r.totalFailureModes).toBe(2);
        expect(r.dominantFailureMode).toBe('venue_failure');
        expect(r.maxSeverity).toBeCloseTo(0.9);
    });

    test('empty modes throws', () => {
        expect(() => pmr.runPreMortemSession({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            sessionId: 'RPM-EMPTY', decisionId: 'D',
            modes: []
        })).toThrow();
    });

    test('invalid failure_kind in modes throws', () => {
        expect(() => pmr.runPreMortemSession({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            sessionId: 'RPM-BAD', decisionId: 'D',
            modes: [
                { modeId: 'BM', failureKind: 'BOGUS',
                  severity: 0.5, detectability: 0.5, recoverability: 0.5,
                  actionPlan: 'reduce' }
            ]
        })).toThrow();
    });
});

describe('§119 closeSession', () => {
    test('marks CLOSED', () => {
        pmr.runPreMortemSession({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            sessionId: 'CS-1', decisionId: 'D',
            modes: [{ modeId: 'CSM',
                failureKind: 'fakeout',
                severity: 0.5, detectability: 0.5, recoverability: 0.5,
                actionPlan: 'reduce' }]
        });
        const r = pmr.closeSession({
            userId: TEST_USER, resolvedEnv: TEST_ENV, sessionId: 'CS-1'
        });
        expect(r.closed).toBe(true);
    });

    test('unknown session throws', () => {
        expect(() => pmr.closeSession({
            userId: TEST_USER, resolvedEnv: TEST_ENV, sessionId: 'NOEXIST'
        })).toThrow();
    });
});

describe('§119 getPreMortemHistory', () => {
    test('filter by decision_id', () => {
        pmr.runPreMortemSession({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            sessionId: 'GH-S1', decisionId: 'D-A',
            modes: [{ modeId: 'GH-M1', failureKind: 'fakeout',
                severity: 0.5, detectability: 0.5, recoverability: 0.5,
                actionPlan: 'reduce' }]
        });
        pmr.runPreMortemSession({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            sessionId: 'GH-S2', decisionId: 'D-B',
            modes: [{ modeId: 'GH-M2', failureKind: 'venue_failure',
                severity: 0.7, detectability: 0.3, recoverability: 0.2,
                actionPlan: 'exit' }]
        });
        const r = pmr.getPreMortemHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV, decisionId: 'D-A'
        });
        expect(r).toHaveLength(1);
        expect(r[0].sessionId).toBe('GH-S1');
    });
});

describe('§119 isolation', () => {
    test('per (user × env) isolation', () => {
        pmr.runPreMortemSession({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            sessionId: 'ISO-1', decisionId: 'D',
            modes: [{ modeId: 'ISO-M', failureKind: 'fakeout',
                severity: 0.5, detectability: 0.5, recoverability: 0.5,
                actionPlan: 'reduce' }]
        });
        const a = pmr.getPreMortemHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const b = pmr.getPreMortemHistory({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(a).toHaveLength(1);
        expect(b).toHaveLength(0);
    });
});
