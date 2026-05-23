'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p39-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

require('../../../server/services/database'); // initialize db connection
const es = require('../../../server/services/ml/_meta/executiveSummary');

afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§39 Exported constants', () => {
    test('BRAIN_ROLES has 7 spec entries', () => {
        expect(es.BRAIN_ROLES).toEqual([
            'ANALIST',
            'STATISTICIAN',
            'RISK_MANAGER',
            'EXECUTION_ENGINE',
            'OPERATOR_ROBUST',
            'CERCETATOR',
            'SISTEM_DISCIPLINAT'
        ]);
    });

    test('FINAL_PRINCIPLES has 4 entries per spec', () => {
        expect(es.FINAL_PRINCIPLES).toEqual([
            'vede_clar',
            'executa_curat',
            'se_opreste_la_timp',
            'nu_se_minte_singur'
        ]);
    });

    test('ROLE_TO_MODULES covers all 7 roles', () => {
        for (const role of es.BRAIN_ROLES) {
            expect(Array.isArray(es.ROLE_TO_MODULES[role])).toBe(true);
            expect(es.ROLE_TO_MODULES[role].length).toBeGreaterThan(0);
        }
    });

    test('ANALIST role maps to relevant modules', () => {
        const modules = es.ROLE_TO_MODULES.ANALIST;
        expect(modules.length).toBeGreaterThan(0);
    });

    test('SISTEM_DISCIPLINAT includes state machine + veto + governance', () => {
        const modules = es.ROLE_TO_MODULES.SISTEM_DISCIPLINAT;
        const joined = modules.join(' ');
        expect(joined).toMatch(/state machine|FSM|stateMachine/i);
        expect(joined).toMatch(/veto|conflict/i);
        expect(joined).toMatch(/governance|version/i);
    });
});

describe('§39 getRoleCoverage (pure)', () => {
    test('returns coverage for all roles when no filter', () => {
        const r = es.getRoleCoverage({});
        expect(Object.keys(r.coverage)).toEqual(expect.arrayContaining(es.BRAIN_ROLES));
    });

    test('returns single role when filtered', () => {
        const r = es.getRoleCoverage({ role: 'RISK_MANAGER' });
        expect(r.coverage.RISK_MANAGER).toBeDefined();
        expect(r.coverage.STATISTICIAN).toBeUndefined();
    });

    test('throws on invalid role', () => {
        expect(() => es.getRoleCoverage({ role: 'BOGUS_ROLE' })).toThrow(/role/i);
    });
});

describe('§39 validateAllRolesCovered (INVARIANT)', () => {
    test('returns covered=true with all 7 roles', () => {
        const r = es.validateAllRolesCovered();
        expect(r.covered).toBe(true);
        expect(r.uncoveredRoles).toEqual([]);
        expect(r.totalRoles).toBe(7);
        expect(r.coveredRoles).toBe(7);
    });
});

describe('§39 getFinalPrinciples (pure)', () => {
    test('returns 4 principles in spec order', () => {
        const p = es.getFinalPrinciples();
        expect(p).toEqual([
            'vede_clar',
            'executa_curat',
            'se_opreste_la_timp',
            'nu_se_minte_singur'
        ]);
    });

    test('returns immutable array', () => {
        const p = es.getFinalPrinciples();
        expect(Object.isFrozen(p)).toBe(true);
    });
});

describe('§39 evaluateClarityScore (vede_clar)', () => {
    test('high clarity indicators → high score', () => {
        const r = es.evaluateClarityScore({
            regimeKnown: true,
            contextKnown: true,
            signalConflictResolved: true,
            dataFresh: true
        });
        expect(r.score).toBeGreaterThanOrEqual(0.75);
    });

    test('missing indicators → low score', () => {
        const r = es.evaluateClarityScore({});
        expect(r.score).toBe(0);
    });

    test('partial clarity → mid score', () => {
        const r = es.evaluateClarityScore({
            regimeKnown: true,
            contextKnown: false,
            signalConflictResolved: true,
            dataFresh: false
        });
        expect(r.score).toBeGreaterThan(0);
        expect(r.score).toBeLessThan(1.0);
    });
});

describe('§39 evaluateExecutionCleanScore (executa_curat)', () => {
    test('low slippage divergence → high score', () => {
        const r = es.evaluateExecutionCleanScore({
            avgSlippageVsEstimate: 1.5,  // 1.5 bps drift
            fillRate: 0.98,
            avgLatencyMs: 80
        });
        expect(r.score).toBeGreaterThanOrEqual(0.75);
    });

    test('high slippage divergence → low score', () => {
        const r = es.evaluateExecutionCleanScore({
            avgSlippageVsEstimate: 50,  // 50 bps drift — bad
            fillRate: 0.6,
            avgLatencyMs: 2000
        });
        expect(r.score).toBeLessThan(0.5);
    });

    test('missing data → 0 score', () => {
        const r = es.evaluateExecutionCleanScore({});
        expect(r.score).toBe(0);
    });
});

describe('§39 evaluateStopOnTimeScore (se_opreste_la_timp)', () => {
    test('breaker active appropriately → high score', () => {
        const r = es.evaluateStopOnTimeScore({
            breakerLevel: 'L1',
            currentDD: 0.04,
            maxDDThreshold: 0.05
        });
        expect(r.score).toBeGreaterThan(0.7);
    });

    test('breaker NOT activated when DD high → low score', () => {
        const r = es.evaluateStopOnTimeScore({
            breakerLevel: 'L0',
            currentDD: 0.09,
            maxDDThreshold: 0.05
        });
        expect(r.score).toBeLessThan(0.5);
    });

    test('breaker L5 at high DD → max score (already flattened)', () => {
        const r = es.evaluateStopOnTimeScore({
            breakerLevel: 'L5',
            currentDD: 0.10,
            maxDDThreshold: 0.05
        });
        expect(r.score).toBeGreaterThanOrEqual(0.8);
    });
});

describe('§39 evaluateNoSelfDeceptionScore (nu_se_minte_singur)', () => {
    test('honest attribution + drift detection → high score', () => {
        const r = es.evaluateNoSelfDeceptionScore({
            attributionActive: true,
            intelligenceScore: 0.85,
            badFeaturesDetected: 0,
            calibrationGood: true
        });
        expect(r.score).toBeGreaterThanOrEqual(0.75);
    });

    test('vanity scoring detected → low score', () => {
        const r = es.evaluateNoSelfDeceptionScore({
            attributionActive: false,
            intelligenceScore: 0.30,
            badFeaturesDetected: 5,
            calibrationGood: false
        });
        expect(r.score).toBeLessThan(0.5);
    });
});

describe('§39 getOmegaSummaryReport (composite)', () => {
    test('combines all 4 principles + role coverage', () => {
        const r = es.getOmegaSummaryReport({
            clarityIndicators: { regimeKnown: true, contextKnown: true,
                                 signalConflictResolved: true, dataFresh: true },
            executionData: { avgSlippageVsEstimate: 1.5, fillRate: 0.98,
                            avgLatencyMs: 80 },
            stopOnTimeIndicators: { breakerLevel: 'L0', currentDD: 0.01,
                                     maxDDThreshold: 0.05 },
            noSelfDeceptionIndicators: { attributionActive: true,
                                          intelligenceScore: 0.85,
                                          badFeaturesDetected: 0,
                                          calibrationGood: true }
        });
        expect(r.principles).toHaveLength(4);
        expect(r.overallScore).toBeGreaterThan(0);
        expect(r.roleCoverage.covered).toBe(true);
    });

    test('returns score per principle', () => {
        const r = es.getOmegaSummaryReport({});
        expect(r.principles).toEqual(expect.arrayContaining([
            expect.objectContaining({ principle: 'vede_clar' }),
            expect.objectContaining({ principle: 'executa_curat' }),
            expect.objectContaining({ principle: 'se_opreste_la_timp' }),
            expect.objectContaining({ principle: 'nu_se_minte_singur' })
        ]));
    });
});
