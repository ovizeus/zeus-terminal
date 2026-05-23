'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p38-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const ic = require('../../../server/services/ml/_meta/intelligenceChecker');

const TEST_USER = 9038;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare(`DELETE FROM ml_intelligence_checks WHERE user_id = ?`).run(TEST_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§38 Migration 069_ml_intelligence_checks', () => {
    test('table ml_intelligence_checks exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_intelligence_checks'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_intelligence_checks)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'criterion',
            'satisfied', 'score', 'evidence_json', 'created_at'
        ]));
    });

    test('CHECK criterion restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_intelligence_checks
             (user_id, resolved_env, criterion, satisfied, created_at)
             VALUES (?, ?, 'BOGUS', 1, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK satisfied bool flag', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_intelligence_checks
             (user_id, resolved_env, criterion, satisfied, created_at)
             VALUES (?, ?, 'knows_regime', 2, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§38 Exported constants', () => {
    test('INTELLIGENCE_CRITERIA has 12 spec entries', () => {
        expect(ic.INTELLIGENCE_CRITERIA).toHaveLength(12);
        expect(ic.INTELLIGENCE_CRITERIA).toEqual(expect.arrayContaining([
            'knows_regime', 'knows_context', 'knows_no_edge',
            'knows_signal_conflict', 'knows_execution_compromised',
            'knows_data_degraded', 'knows_model_drift',
            'knows_portfolio_overloaded', 'knows_when_to_reduce',
            'knows_when_to_stop', 'knows_how_to_explain',
            'knows_how_to_learn_honestly'
        ]));
    });

    test('ANTI_PATTERNS has 4 spec entries', () => {
        expect(ic.ANTI_PATTERNS).toHaveLength(4);
        expect(ic.ANTI_PATTERNS).toEqual(expect.arrayContaining([
            'enters_too_much', 'pretends_brave',
            'high_scores_show', 'spectacular_guesses'
        ]));
    });

    test('CRITERION_TO_RING maps each criterion to OMEGA ring/module', () => {
        for (const c of ic.INTELLIGENCE_CRITERIA) {
            expect(ic.CRITERION_TO_RING[c]).toBeDefined();
            expect(typeof ic.CRITERION_TO_RING[c]).toBe('string');
        }
    });
});

describe('§38 recordCriterionCheck', () => {
    test('records satisfied=true row', () => {
        ic.recordCriterionCheck({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            criterion: 'knows_regime', satisfied: true, score: 0.9,
            evidence: { regime: 'trend', source: '§17' }
        });
        const rows = db.prepare(
            `SELECT * FROM ml_intelligence_checks WHERE user_id = ?`
        ).all(TEST_USER);
        expect(rows).toHaveLength(1);
        expect(rows[0].satisfied).toBe(1);
        expect(rows[0].score).toBeCloseTo(0.9);
    });

    test('records satisfied=false row', () => {
        ic.recordCriterionCheck({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            criterion: 'knows_model_drift', satisfied: false, score: 0
        });
        const row = db.prepare(
            `SELECT * FROM ml_intelligence_checks WHERE user_id = ?`
        ).get(TEST_USER);
        expect(row.satisfied).toBe(0);
    });

    test('throws on invalid criterion', () => {
        expect(() => ic.recordCriterionCheck({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            criterion: 'bogus_criterion', satisfied: true
        })).toThrow(/criterion/);
    });

    test('stores evidence as JSON', () => {
        ic.recordCriterionCheck({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            criterion: 'knows_context', satisfied: true,
            evidence: { hour: 13, session: 'london', dayOfWeek: 'monday' }
        });
        const row = db.prepare(
            `SELECT * FROM ml_intelligence_checks WHERE user_id = ?`
        ).get(TEST_USER);
        const e = JSON.parse(row.evidence_json);
        expect(e.hour).toBe(13);
        expect(e.session).toBe('london');
    });
});

describe('§38 evaluateAllCriteria', () => {
    test('runs all 12 criteria with provided signals', () => {
        const r = ic.evaluateAllCriteria({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            contextSignals: {
                regime_known: true,
                context_known: true,
                edge_assessable: true,
                signal_conflict_detected: false,
                execution_clean: true,
                data_fresh: true,
                model_drift_detected: false,
                portfolio_loaded: false,
                breaker_active: false,
                circuit_breaker_active: false,
                explainability_available: true,
                attribution_active: true
            }
        });
        expect(r.results).toHaveLength(12);
        expect(r.overallScore).toBeGreaterThan(0.8);
    });

    test('all criteria failing → overallScore 0', () => {
        const r = ic.evaluateAllCriteria({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            contextSignals: {}
        });
        expect(r.overallScore).toBe(0);
    });

    test('records each criterion to audit table', () => {
        ic.evaluateAllCriteria({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            contextSignals: { regime_known: true }
        });
        const rows = db.prepare(
            `SELECT * FROM ml_intelligence_checks WHERE user_id = ?`
        ).all(TEST_USER);
        expect(rows).toHaveLength(12);
    });
});

describe('§38 getIntelligenceScore', () => {
    test('returns 0 when no checks recorded', () => {
        const r = ic.getIntelligenceScore({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.score).toBe(0);
        expect(r.checkCount).toBe(0);
    });

    test('aggregates score from recorded checks', () => {
        for (let i = 0; i < 6; i++) {
            ic.recordCriterionCheck({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                criterion: ic.INTELLIGENCE_CRITERIA[i],
                satisfied: true, score: 1.0
            });
        }
        const r = ic.getIntelligenceScore({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.score).toBeGreaterThan(0);
        expect(r.checkCount).toBe(6);
    });

    test('uses most recent check per criterion (window)', () => {
        ic.recordCriterionCheck({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            criterion: 'knows_regime', satisfied: false, score: 0
        });
        ic.recordCriterionCheck({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            criterion: 'knows_regime', satisfied: true, score: 1.0
        });
        const r = ic.getIntelligenceScore({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        // Most recent should win
        expect(r.criteriaSummary.knows_regime.latest_satisfied).toBe(true);
    });
});

describe('§38 detectAntiPatterns (pure)', () => {
    test('no anti-patterns when trade stats healthy', () => {
        const r = ic.detectAntiPatterns({
            tradeStats: {
                tradesPerDay: 3,
                avgConfidence: 0.65,
                hitRate: 0.55,
                spectacularGuessFlag: false
            },
            decisionStats: {
                avgBraveryFlag: 0.1
            }
        });
        expect(r.detected).toEqual([]);
    });

    test('detects "enters too much" pattern', () => {
        const r = ic.detectAntiPatterns({
            tradeStats: {
                tradesPerDay: 50,  // excessive
                avgConfidence: 0.5,
                hitRate: 0.45,
                spectacularGuessFlag: false
            },
            decisionStats: { avgBraveryFlag: 0.1 }
        });
        expect(r.detected).toContain('enters_too_much');
    });

    test('detects "high_scores_show" (vanity scoring)', () => {
        const r = ic.detectAntiPatterns({
            tradeStats: {
                tradesPerDay: 3,
                avgConfidence: 0.95,    // suspiciously high
                hitRate: 0.40,          // but loses
                spectacularGuessFlag: false
            },
            decisionStats: { avgBraveryFlag: 0.1 }
        });
        expect(r.detected).toContain('high_scores_show');
    });

    test('detects "pretends_brave" pattern', () => {
        const r = ic.detectAntiPatterns({
            tradeStats: {
                tradesPerDay: 3,
                avgConfidence: 0.65,
                hitRate: 0.55,
                spectacularGuessFlag: false
            },
            decisionStats: {
                avgBraveryFlag: 0.85  // excessive bravado
            }
        });
        expect(r.detected).toContain('pretends_brave');
    });

    test('detects "spectacular_guesses" pattern', () => {
        const r = ic.detectAntiPatterns({
            tradeStats: {
                tradesPerDay: 3,
                avgConfidence: 0.65,
                hitRate: 0.55,
                spectacularGuessFlag: true
            },
            decisionStats: { avgBraveryFlag: 0.1 }
        });
        expect(r.detected).toContain('spectacular_guesses');
    });
});

describe('§38 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9039;
        ic.recordCriterionCheck({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            criterion: 'knows_regime', satisfied: true, score: 1.0
        });
        const r1 = ic.getIntelligenceScore({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const r2 = ic.getIntelligenceScore({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(r1.checkCount).toBe(1);
        expect(r2.checkCount).toBe(0);
    });
});
