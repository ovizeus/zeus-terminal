'use strict';

jest.mock('../../../server/services/serverReflection', () => ({
    questionEntry: jest.fn()
}));

const reflection = require('../../../server/services/serverReflection');
const rg = require('../../../server/services/ml/_ring5/reflectionGate');

const _phase2 = (over = {}) => ({ dir: 'LONG', confidence: 70, score: 5, reasons: ['t1'], ts: 100, ...over });
const _proposed = (over = {}) => ({ dir: 'LONG', confidence: 80, score: 5, reasons: ['t1', 'ring5_boost'], ts: 100, ...over });

describe('reflectionGate.evaluate', () => {
    beforeEach(() => reflection.questionEntry.mockReset());

    test('accepts when reflection proceeds with zero penalty', () => {
        reflection.questionEntry.mockReturnValue({ proceed: true, concerns: [], adjustments: {}, totalPenalty: 0 });
        const r = rg.evaluate({
            userId: 1, symbol: 'BTCUSDT', regime: 'trending', marketContext: {},
            phase2Decision: _phase2(), proposedDecision: _proposed()
        });
        expect(r.accepted).toBe(true);
        expect(r.finalDecision.confidence).toBe(80);
        expect(r.concerns).toEqual([]);
    });

    test('rejects when reflection blocks (proceed=false)', () => {
        reflection.questionEntry.mockReturnValue({
            proceed: false,
            concerns: [{ type: 'learned_rule', rule: 'no-counter-trend', severity: 'high' }],
            adjustments: {}, totalPenalty: 0
        });
        const r = rg.evaluate({
            userId: 1, symbol: 'BTCUSDT', regime: 'ranging', marketContext: {},
            phase2Decision: _phase2(), proposedDecision: _proposed()
        });
        expect(r.accepted).toBe(false);
        expect(r.finalDecision).toEqual(_phase2());
        expect(r.concerns.length).toBeGreaterThan(0);
        expect(r.concerns[0].type).toBe('learned_rule');
    });

    test('applies reflection penalty to proposed confidence when accepted', () => {
        reflection.questionEntry.mockReturnValue({ proceed: true, concerns: [], adjustments: {}, totalPenalty: -8 });
        const r = rg.evaluate({
            userId: 1, symbol: 'BTCUSDT', regime: 'trending', marketContext: {},
            phase2Decision: _phase2({ confidence: 70 }), proposedDecision: _proposed({ confidence: 85 })
        });
        expect(r.accepted).toBe(true);
        expect(r.finalDecision.confidence).toBe(77);
    });

    test('clamps confidence after penalty to [0, 100]', () => {
        reflection.questionEntry.mockReturnValue({ proceed: true, concerns: [], adjustments: {}, totalPenalty: -120 });
        const r = rg.evaluate({
            userId: 1, symbol: 'BTCUSDT', regime: 'trending', marketContext: {},
            phase2Decision: _phase2(), proposedDecision: _proposed({ confidence: 50 })
        });
        expect(r.accepted).toBe(true);
        expect(r.finalDecision.confidence).toBe(0);
    });

    test('passes correct args to reflection.questionEntry', () => {
        reflection.questionEntry.mockReturnValue({ proceed: true, concerns: [], adjustments: {}, totalPenalty: 0 });
        rg.evaluate({
            userId: 42, symbol: 'ETHUSDT', regime: 'choppy', marketContext: { foo: 'bar' },
            phase2Decision: _phase2(), proposedDecision: _proposed({ dir: 'LONG', confidence: 85 })
        });
        expect(reflection.questionEntry).toHaveBeenCalledWith(
            'ETHUSDT', 'LONG', 85, 'choppy', { foo: 'bar' }, 42
        );
    });

    test('returns reflectionResult for upstream audit logging', () => {
        const mock = { proceed: true, concerns: [], adjustments: {}, totalPenalty: -3 };
        reflection.questionEntry.mockReturnValue(mock);
        const r = rg.evaluate({
            userId: 1, symbol: 'BTCUSDT', regime: 'trending', marketContext: {},
            phase2Decision: _phase2(), proposedDecision: _proposed()
        });
        expect(r.reflectionResult).toEqual(mock);
    });
});
