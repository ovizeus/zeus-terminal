/**
 * Zeus Terminal — Unit Tests: Brain V3 Modules
 * Tests: CorrelationGuard, AdaptiveSizing, SessionProfile, DrawdownGuard, MultiEntry, VolatilityEngine
 */
'use strict';

// ── Mocks ──
jest.mock('../../server/services/database', () => ({
    db: { prepare: jest.fn(() => ({ all: jest.fn(() => []), run: jest.fn() })) },
    atSetState: jest.fn(),
    journalGetClosed: jest.fn(() => []),
}));
jest.mock('../../server/services/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));
jest.mock('../../server/services/serverCalibration', () => ({
    getCorrelation: jest.fn((s1, s2) => {
        const pairs = { 'BTCUSDT:ETHUSDT': 0.92, 'BTCUSDT:SOLUSDT': 0.85, 'ETHUSDT:SOLUSDT': 0.88 };
        const key = [s1, s2].sort().join(':');
        return pairs[key] || 0.3;
    }),
    analyzeCorrelationRisk: jest.fn(() => ({ totalRisk: 0, warning: null, details: [] })),
    forecastVolatility: jest.fn(() => ({ score: 20, level: 'normal', signals: [] })),
}));

// ══════════════════════════════════════════════════════════════════
// CorrelationGuard
// ══════════════════════════════════════════════════════════════════
const corrGuard = require('../../server/services/serverCorrelationGuard');

describe('CorrelationGuard', () => {
    test('allows entry with no open positions', () => {
        const result = corrGuard.checkEntry('BTCUSDT', 'LONG', []);
        expect(result.allowed).toBe(true);
    });

    test('allows entry when no correlated positions', () => {
        const result = corrGuard.checkEntry('BTCUSDT', 'LONG', [
            { symbol: 'DOGEUSDT', side: 'LONG', size: 100 },
        ]);
        expect(result.allowed).toBe(true);
    });

    test('blocks when correlated exposure exceeds limit', () => {
        const result = corrGuard.checkEntry('SOLUSDT', 'LONG', [
            { symbol: 'BTCUSDT', side: 'LONG', size: 100 },
            { symbol: 'ETHUSDT', side: 'LONG', size: 100 },
        ]);
        expect(result.allowed).toBe(false);
        expect(result.correlatedWith.length).toBeGreaterThan(0);
    });

    test('allows opposite direction on correlated asset', () => {
        const result = corrGuard.checkEntry('ETHUSDT', 'SHORT', [
            { symbol: 'BTCUSDT', side: 'LONG', size: 100 },
        ]);
        expect(result.allowed).toBe(true);
    });

    test('getCorrelationModifier penalizes correlated same-dir', () => {
        const mod = corrGuard.getCorrelationModifier('ETHUSDT', 'LONG', [
            { symbol: 'BTCUSDT', side: 'LONG', size: 100 },
        ]);
        expect(mod).toBeLessThan(1.0);
    });

    test('getCorrelationModifier returns 1.0 with no positions', () => {
        expect(corrGuard.getCorrelationModifier('BTCUSDT', 'LONG', [])).toBe(1.0);
    });
});

// ══════════════════════════════════════════════════════════════════
// AdaptiveSizing
// ══════════════════════════════════════════════════════════════════
const sizing = require('../../server/services/serverAdaptiveSizing');

describe('AdaptiveSizing', () => {
    test('returns standard tier with insufficient history', () => {
        const result = sizing.calcSizeMultiplier(1, 'MEDIUM', 75, 'TREND', 0, 200);
        expect(result.multiplier).toBe(1.35);
        expect(result.reason).toBe('insufficient_history');
    });

    test('getEdgeStats returns null without user', () => {
        expect(sizing.getEdgeStats(null)).toBeNull();
    });

    test('getEdgeStats returns insufficient for new user', () => {
        const stats = sizing.getEdgeStats(999);
        expect(stats).not.toBeNull();
        expect(stats.sufficient).toBe(false);
    });
});

// ══════════════════════════════════════════════════════════════════
// SessionProfile
// ══════════════════════════════════════════════════════════════════
const session = require('../../server/services/serverSessionProfile');

describe('SessionProfile', () => {
    test('getCurrentSession returns valid session', () => {
        const s = session.getCurrentSession();
        expect(s).toHaveProperty('id');
        expect(s).toHaveProperty('name');
        expect(s).toHaveProperty('volatility');
    });

    test('getSessionForHour maps correctly', () => {
        expect(session.getSessionForHour(3)).toBe('ASIA');
        expect(session.getSessionForHour(14)).toBe('LONDON_NY'); // overlap
        expect(session.getSessionForHour(21)).toBe('NY');
    });

    test('getSessionModifier returns number', () => {
        const mod = session.getSessionModifier(1);
        expect(typeof mod).toBe('number');
        expect(mod).toBeGreaterThan(0);
        expect(mod).toBeLessThanOrEqual(1.15);
    });

    test('checkSessionBlock returns not blocked for new user', () => {
        const result = session.checkSessionBlock(1);
        expect(result.blocked).toBe(false);
    });

    test('getSessionData returns structured data', () => {
        const data = session.getSessionData(1);
        expect(data).toHaveProperty('current');
        expect(data).toHaveProperty('modifier');
        expect(data).toHaveProperty('performance');
    });
});

// ══════════════════════════════════════════════════════════════════
// DrawdownGuard
// ══════════════════════════════════════════════════════════════════
const drawdown = require('../../server/services/serverDrawdownGuard');

describe('DrawdownGuard', () => {
    test('no drawdown = full size', () => {
        const dd = drawdown.assessDrawdown(0, 10000);
        expect(dd.sizeScale).toBe(1.0);
        expect(dd.locked).toBe(false);
    });

    test('small drawdown = slight reduction', () => {
        const dd = drawdown.assessDrawdown(-150, 10000); // 1.5%
        expect(dd.tier.label).toBe('NORMAL');
        expect(dd.sizeScale).toBe(0.90);
    });

    test('moderate drawdown = significant reduction', () => {
        const dd = drawdown.assessDrawdown(-350, 10000); // 3.5%
        expect(dd.tier.label).toBe('WARNING');
        expect(dd.sizeScale).toBe(0.55);
    });

    test('severe drawdown = lockout', () => {
        const dd = drawdown.assessDrawdown(-900, 10000); // 9%
        expect(dd.tier.label).toBe('LOCKOUT');
        expect(dd.locked).toBe(true);
        expect(dd.sizeScale).toBe(0);
    });

    test('positive PnL = no drawdown', () => {
        const dd = drawdown.assessDrawdown(500, 10000);
        expect(dd.drawdownPct).toBe(0);
        expect(dd.sizeScale).toBe(1.0);
    });

    test('getTiltModifier scales with consecutive losses', () => {
        expect(drawdown.getTiltModifier('no-losses')).toBe(1.0);
    });

    test('trackEquity and getMaxDrawdown work', () => {
        drawdown.trackEquity('test-eq', 10000);
        drawdown.trackEquity('test-eq', 10500);
        drawdown.trackEquity('test-eq', 10200);
        const maxDD = drawdown.getMaxDrawdown('test-eq');
        expect(maxDD).toBeGreaterThan(0); // gave back from peak
    });

    test('getDrawdownData returns structured response', () => {
        const data = drawdown.getDrawdownData('test-user', -200, 10000);
        expect(data).toHaveProperty('tier');
        expect(data).toHaveProperty('drawdownPct');
        expect(data).toHaveProperty('sizeScale');
    });
});

// ══════════════════════════════════════════════════════════════════
// MultiEntry
// ══════════════════════════════════════════════════════════════════
const multi = require('../../server/services/serverMultiEntry');

describe('MultiEntry', () => {
    test('no scale-in without position', () => {
        const r = multi.checkScaleIn(null, 80, 'TREND');
        expect(r.shouldScale).toBe(false);
    });

    test('no scale-in if profit too low', () => {
        const r = multi.checkScaleIn(
            { symbol: 'BTCUSDT', side: 'LONG', pnlPct: 0.1, userId: 1 },
            80, 'TREND'
        );
        expect(r.shouldScale).toBe(false);
        expect(r.reason).toBe('insufficient_profit');
    });

    test('allows scale-in on profitable position with high confidence', () => {
        const r = multi.checkScaleIn(
            { symbol: 'BTCUSDT', side: 'LONG', pnlPct: 0.6, userId: 'scale-user-1' },
            80, 'TREND'
        );
        expect(r.shouldScale).toBe(true);
        expect(r.sizeMultiplier).toBeLessThan(1.0);
    });

    test('blocks scale-in in volatile regime', () => {
        const r = multi.checkScaleIn(
            { symbol: 'BTCUSDT', side: 'LONG', pnlPct: 1.0, userId: 2 },
            85, 'VOLATILE'
        );
        expect(r.shouldScale).toBe(false);
        expect(r.reason).toBe('regime_unsafe');
    });

    test('blocks after max scale-ins', () => {
        multi.recordScaleIn('max-user', 'BTCUSDT', 50000, 100);
        multi.recordScaleIn('max-user', 'BTCUSDT', 50100, 60);
        const r = multi.checkScaleIn(
            { symbol: 'BTCUSDT', side: 'LONG', pnlPct: 1.5, userId: 'max-user' },
            90, 'TREND'
        );
        expect(r.shouldScale).toBe(false);
        expect(r.reason).toBe('max_scale_reached');
    });

    test('resetOnClose clears state', () => {
        multi.recordScaleIn('reset-user', 'ETHUSDT', 3000, 50);
        multi.resetOnClose('reset-user', 'ETHUSDT');
        const info = multi.getScaleInfo('reset-user', 'ETHUSDT');
        expect(info.scaleCount).toBe(0);
    });

    test('getAllScaleData returns active scales', () => {
        multi.recordScaleIn('data-user', 'SOLUSDT', 150, 30);
        const data = multi.getAllScaleData('data-user');
        expect(data).toHaveProperty('SOLUSDT');
        expect(data.SOLUSDT.scaleCount).toBe(1);
    });
});

// ══════════════════════════════════════════════════════════════════
// VolatilityEngine
// ══════════════════════════════════════════════════════════════════
const volEngine = require('../../server/services/serverVolatilityEngine');

describe('VolatilityEngine', () => {
    const makeBars = (count, basePrice) => {
        const bars = [];
        for (let i = 0; i < count; i++) {
            const p = basePrice + Math.sin(i * 0.1) * basePrice * 0.01;
            bars.push({ time: i, open: p, high: p * 1.005, low: p * 0.995, close: p, volume: 100 });
        }
        return bars;
    };

    test('returns default profile without bars', () => {
        const r = volEngine.assessVolatility(null, []);
        expect(r.level).toBe('NORMAL');
        expect(r.slMultiplier).toBe(1.0);
    });

    test('assesses volatility from bars', () => {
        const bars = makeBars(100, 50000);
        const snap = { indicators: { bbWidth: 0.03 }, symbol: 'BTCUSDT' };
        const r = volEngine.assessVolatility(snap, bars);
        expect(r).toHaveProperty('level');
        expect(r).toHaveProperty('score');
        expect(r).toHaveProperty('slMultiplier');
        expect(typeof r.atrPercentile).toBe('number');
    });

    test('squeeze detection boosts score', () => {
        const bars = makeBars(100, 50000);
        const snap = { indicators: { bbWidth: 0.01 }, symbol: 'BTCUSDT' };
        const r = volEngine.assessVolatility(snap, bars);
        expect(r.score).toBeGreaterThan(15); // squeeze adds to score
    });

    test('adjustParams widens SL in high vol', () => {
        const stc = { slPct: 1.0, rr: 2, size: 200 };
        const volHigh = { level: 'HIGH', score: 55, slMultiplier: 1.35, tpMultiplier: 1.5 };
        const adjusted = volEngine.adjustParams(stc, volHigh);
        expect(adjusted.slPct).toBeGreaterThan(1.0);
    });

    test('adjustParams reduces size in extreme vol', () => {
        const stc = { slPct: 1.0, rr: 2, size: 200 };
        const volExtreme = { level: 'EXTREME', score: 80, slMultiplier: 1.6, tpMultiplier: 1.8 };
        const adjusted = volEngine.adjustParams(stc, volExtreme);
        expect(adjusted.size).toBeLessThan(200);
    });

    test('getVolatilityModifier penalizes extreme', () => {
        expect(volEngine.getVolatilityModifier({ level: 'EXTREME' })).toBe(0.85);
        expect(volEngine.getVolatilityModifier({ level: 'NORMAL' })).toBe(1.0);
    });
});
