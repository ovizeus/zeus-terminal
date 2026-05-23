'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p10-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

require('../../../server/services/database'); // init DB
const sp = require('../../../server/services/ml/_meta/supremePrinciple');

afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§10 Exported constants', () => {
    test('SUPREME_CRITERIA has 4 spec entries', () => {
        expect(sp.SUPREME_CRITERIA).toEqual([
            'clean', 'with_advantage', 'confirmed', 'coherent_story'
        ]);
    });

    test('FREQUENCY_GUIDE has 4 modes (matches §37 modes)', () => {
        expect(sp.FREQUENCY_GUIDE.SNIPER).toBeDefined();
        expect(sp.FREQUENCY_GUIDE.SCALP).toBeDefined();
        expect(sp.FREQUENCY_GUIDE.OBSERVER).toBeDefined();
        expect(sp.FREQUENCY_GUIDE.ADAPTIVE).toBeDefined();
    });

    test('SNIPER guide is 2-4 per spec', () => {
        expect(sp.FREQUENCY_GUIDE.SNIPER.weeklyMin).toBe(2);
        expect(sp.FREQUENCY_GUIDE.SNIPER.weeklyMax).toBe(4);
    });

    test('SCALP guide is 8-15 per spec', () => {
        expect(sp.FREQUENCY_GUIDE.SCALP.weeklyMin).toBe(8);
        expect(sp.FREQUENCY_GUIDE.SCALP.weeklyMax).toBe(15);
    });

    test('OBSERVER guide is 0', () => {
        expect(sp.FREQUENCY_GUIDE.OBSERVER.weeklyMin).toBe(0);
        expect(sp.FREQUENCY_GUIDE.OBSERVER.weeklyMax).toBe(0);
    });
});

describe('§10 evaluateTradeQuality (pure)', () => {
    test('all 4 criteria satisfied → high score', () => {
        const r = sp.evaluateTradeQuality({
            tradeCandidate: { expectedEdgeBps: 30, costBps: 8 },
            contextSignals: {
                slippageEstimateClean: true,
                signalConflictResolved: true,
                contextMatches: true,
                liquidityMatches: true,
                participationMatches: true
            }
        });
        expect(r.overallScore).toBeGreaterThanOrEqual(0.75);
        expect(r.criteria.clean).toBe(true);
        expect(r.criteria.with_advantage).toBe(true);
        expect(r.criteria.confirmed).toBe(true);
        expect(r.criteria.coherent_story).toBe(true);
    });

    test('low edge → with_advantage false', () => {
        const r = sp.evaluateTradeQuality({
            tradeCandidate: { expectedEdgeBps: 10, costBps: 8 },
            contextSignals: {
                slippageEstimateClean: true,
                signalConflictResolved: true,
                contextMatches: true,
                liquidityMatches: true,
                participationMatches: true
            }
        });
        expect(r.criteria.with_advantage).toBe(false);
    });

    test('story not coherent → coherent_story false', () => {
        const r = sp.evaluateTradeQuality({
            tradeCandidate: { expectedEdgeBps: 30, costBps: 8 },
            contextSignals: {
                slippageEstimateClean: true,
                signalConflictResolved: true,
                contextMatches: true,
                liquidityMatches: false,  // mismatched
                participationMatches: true
            }
        });
        expect(r.criteria.coherent_story).toBe(false);
    });

    test('execution dirty → clean false', () => {
        const r = sp.evaluateTradeQuality({
            tradeCandidate: { expectedEdgeBps: 30, costBps: 8 },
            contextSignals: {
                slippageEstimateClean: false,  // dirty exec
                signalConflictResolved: true,
                contextMatches: true,
                liquidityMatches: true,
                participationMatches: true
            }
        });
        expect(r.criteria.clean).toBe(false);
    });

    test('no signals → all criteria false', () => {
        const r = sp.evaluateTradeQuality({
            tradeCandidate: {},
            contextSignals: {}
        });
        expect(r.overallScore).toBe(0);
    });
});

describe('§10 getFrequencyGuide (pure)', () => {
    test('SNIPER returns 2-4', () => {
        const r = sp.getFrequencyGuide({ mode: 'SNIPER' });
        expect(r.weeklyMin).toBe(2);
        expect(r.weeklyMax).toBe(4);
    });

    test('returns full description per mode', () => {
        const r = sp.getFrequencyGuide({ mode: 'OBSERVER' });
        expect(r.description.length).toBeGreaterThan(0);
    });

    test('throws on invalid mode', () => {
        expect(() => sp.getFrequencyGuide({ mode: 'BOGUS' })).toThrow(/mode/i);
    });
});

describe('§10 checkEgoVsRegime (pure)', () => {
    test('Sniper mode 3 trades/week → within guide (no ego)', () => {
        const r = sp.checkEgoVsRegime({
            tradesThisWeek: 3,
            currentMode: 'SNIPER'
        });
        expect(r.egoDetected).toBe(false);
        expect(r.withinGuide).toBe(true);
    });

    test('Sniper mode 10 trades/week → ego detected (over-trading)', () => {
        const r = sp.checkEgoVsRegime({
            tradesThisWeek: 10,
            currentMode: 'SNIPER'
        });
        expect(r.egoDetected).toBe(true);
        expect(r.severity).toBeGreaterThan(0.5);
    });

    test('Observer mode 1 trade → ego detected (any trade is over)', () => {
        const r = sp.checkEgoVsRegime({
            tradesThisWeek: 1,
            currentMode: 'OBSERVER'
        });
        expect(r.egoDetected).toBe(true);
    });

    test('Scalp mode 12 trades → within range', () => {
        const r = sp.checkEgoVsRegime({
            tradesThisWeek: 12,
            currentMode: 'SCALP'
        });
        expect(r.egoDetected).toBe(false);
    });

    test('returns recommendation when ego detected', () => {
        const r = sp.checkEgoVsRegime({
            tradesThisWeek: 20,
            currentMode: 'SNIPER'
        });
        expect(r.recommendation).toMatch(/reduce|stop/i);
    });
});

describe('§10 validateAgainstSupremePrinciple (composite)', () => {
    test('all conditions satisfied → valid', () => {
        const r = sp.validateAgainstSupremePrinciple({
            tradeCandidate: { expectedEdgeBps: 30, costBps: 8 },
            mode: 'SNIPER',
            tradesThisWeek: 2,
            contextSignals: {
                slippageEstimateClean: true,
                signalConflictResolved: true,
                contextMatches: true,
                liquidityMatches: true,
                participationMatches: true
            }
        });
        expect(r.valid).toBe(true);
    });

    test('over-trading + low quality → invalid', () => {
        const r = sp.validateAgainstSupremePrinciple({
            tradeCandidate: { expectedEdgeBps: 5, costBps: 8 },
            mode: 'SNIPER',
            tradesThisWeek: 12,  // sniper over-trading
            contextSignals: {}
        });
        expect(r.valid).toBe(false);
        expect(r.reasons.length).toBeGreaterThan(0);
    });

    test('returns reasons array for failures', () => {
        const r = sp.validateAgainstSupremePrinciple({
            tradeCandidate: { expectedEdgeBps: 5 },
            mode: 'OBSERVER',
            tradesThisWeek: 0,
            contextSignals: {}
        });
        expect(Array.isArray(r.reasons)).toBe(true);
    });

    test('Observer mode rejects ANY trade', () => {
        const r = sp.validateAgainstSupremePrinciple({
            tradeCandidate: { expectedEdgeBps: 50, costBps: 5 },
            mode: 'OBSERVER',
            tradesThisWeek: 0,
            contextSignals: {
                slippageEstimateClean: true,
                signalConflictResolved: true,
                contextMatches: true,
                liquidityMatches: true,
                participationMatches: true
            }
        });
        expect(r.valid).toBe(false);
        expect(r.reasons.some(r => /observer/i.test(r))).toBe(true);
    });
});

describe('§10 integration', () => {
    test('high quality trade in scalp mode within budget → valid', () => {
        const r = sp.validateAgainstSupremePrinciple({
            tradeCandidate: { expectedEdgeBps: 20, costBps: 6 },
            mode: 'SCALP',
            tradesThisWeek: 10,
            contextSignals: {
                slippageEstimateClean: true,
                signalConflictResolved: true,
                contextMatches: true,
                liquidityMatches: true,
                participationMatches: true
            }
        });
        expect(r.valid).toBe(true);
    });

    test('adaptive mode reduces criteria for ego detection', () => {
        const r = sp.checkEgoVsRegime({
            tradesThisWeek: 5,
            currentMode: 'ADAPTIVE'
        });
        expect(r.withinGuide).toBeDefined();
    });
});
