/**
 * Zeus Terminal — Unit Tests: serverReflection.js
 * Tests per-user isolation, questionEntry, reflectOnTrade, calibration
 */
'use strict';

// Mock dependencies
jest.mock('../../server/services/database', () => ({
    db: { prepare: jest.fn(() => ({ all: jest.fn(() => []), get: jest.fn(() => null), run: jest.fn() })) },
    atSetState: jest.fn(),
    atGetState: jest.fn(() => null),
    journalGetClosed: jest.fn(() => []),
}));
jest.mock('../../server/services/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const reflection = require('../../server/services/serverReflection');

// ══════════════════════════════════════════════════════════════
// Per-user isolation
// ══════════════════════════════════════════════════════════════
describe('per-user isolation', () => {

  test('getDashboard returns empty for unknown user', () => {
    const dash = reflection.getDashboard('nonexistent-user');
    expect(dash.thoughts).toEqual([]);
    expect(dash.learnedRules).toEqual([]);
    expect(dash.selfScore).toBeDefined();
  });

  test('getDashboard without userId returns empty', () => {
    const dash = reflection.getDashboard(null);
    expect(dash.thoughts).toEqual([]);
  });

  test('thoughts are isolated between users', () => {
    const trade1 = { symbol: 'BTCUSDT', side: 'LONG', closePnl: -5, entrySnapshot: { confidence: 70, regime: 'TREND' } };
    const trade2 = { symbol: 'ETHUSDT', side: 'SHORT', closePnl: 3, entrySnapshot: { confidence: 80, regime: 'RANGE' } };

    reflection.reflectOnTrade(trade1, null, 'user-A');
    reflection.reflectOnTrade(trade2, null, 'user-B');

    const thoughtsA = reflection.getThoughts(50, 'user-A');
    const thoughtsB = reflection.getThoughts(50, 'user-B');

    // User A should only see BTCUSDT loss
    expect(thoughtsA.some(t => t.symbol === 'BTCUSDT')).toBe(true);
    expect(thoughtsA.some(t => t.symbol === 'ETHUSDT')).toBe(false);

    // User B should only see ETHUSDT win
    expect(thoughtsB.some(t => t.symbol === 'ETHUSDT')).toBe(true);
    expect(thoughtsB.some(t => t.symbol === 'BTCUSDT')).toBe(false);
  });

  test('selfScore is isolated between users', () => {
    reflection.reflectOnTrade({ symbol: 'BTC', side: 'LONG', closePnl: 5, entrySnapshot: {} }, null, 'score-A');
    reflection.reflectOnTrade({ symbol: 'BTC', side: 'LONG', closePnl: -5, entrySnapshot: {} }, null, 'score-B');

    const scoreA = reflection.getSelfScore('score-A');
    const scoreB = reflection.getSelfScore('score-B');

    expect(scoreA.correctToday).toBeGreaterThan(0);
    expect(scoreB.correctToday).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════
// reflectOnTrade
// ══════════════════════════════════════════════════════════════
describe('reflectOnTrade', () => {

  test('does nothing without userId', () => {
    expect(() => reflection.reflectOnTrade({ closePnl: -5 }, null, null)).not.toThrow();
  });

  test('does nothing without closePnl', () => {
    expect(() => reflection.reflectOnTrade({ symbol: 'BTC' }, null, 'user-1')).not.toThrow();
  });

  test('win trade increments streak', () => {
    reflection.reflectOnTrade({ symbol: 'BTC', side: 'LONG', closePnl: 10, entrySnapshot: {} }, null, 'streak-user');
    reflection.reflectOnTrade({ symbol: 'BTC', side: 'LONG', closePnl: 5, entrySnapshot: {} }, null, 'streak-user');
    const score = reflection.getSelfScore('streak-user');
    expect(score.streak).toBe(2);
    expect(score.bestStreak).toBe(2);
  });

  test('loss trade resets streak', () => {
    reflection.reflectOnTrade({ symbol: 'BTC', side: 'LONG', closePnl: 10, entrySnapshot: {} }, null, 'reset-user');
    reflection.reflectOnTrade({ symbol: 'BTC', side: 'LONG', closePnl: -5, entrySnapshot: {} }, null, 'reset-user');
    const score = reflection.getSelfScore('reset-user');
    expect(score.streak).toBe(0);
    expect(score.bestStreak).toBe(1);
  });

  test('generates insights for loss with misaligned MTF', () => {
    reflection.reflectOnTrade({
      symbol: 'BTC', side: 'LONG', closePnl: -3,
      entrySnapshot: { mtfAlignment: 0.2, confidence: 60, regime: 'TREND' },
    }, null, 'mtf-user');
    const thoughts = reflection.getThoughts(10, 'mtf-user');
    const last = thoughts[thoughts.length - 1];
    expect(last.type).toBe('loss_reflection');
    expect(last.reasons.some(r => r.includes('MTF'))).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════
// questionEntry
// ══════════════════════════════════════════════════════════════
describe('questionEntry', () => {

  test('returns proceed=true with no concerns', () => {
    const result = reflection.questionEntry('BTCUSDT', 'LONG', 80, 'TREND', {}, 'clean-user');
    expect(result.proceed).toBe(true);
    expect(result.totalPenalty).toBe(0);
  });

  test('returns proceed=true without userId (safe default)', () => {
    const result = reflection.questionEntry('BTC', 'LONG', 80, 'TREND', {});
    expect(result.proceed).toBe(true);
  });

  test('dangerous regime adds concern', () => {
    const result = reflection.questionEntry('BTC', 'LONG', 80, 'CHAOS', {}, 'chaos-user');
    expect(result.concerns.some(c => c.type === 'dangerous_regime')).toBe(true);
  });

  test('CHoCH against direction penalizes confidence', () => {
    const ctx = { structure: { lastCHoCH: { dir: 'bearish' } } };
    const result = reflection.questionEntry('BTC', 'LONG', 80, 'TREND', ctx, 'choch-user');
    expect(result.concerns.some(c => c.type === 'choch_against')).toBe(true);
    expect(result.totalPenalty).toBeLessThan(0);
  });

  test('liquidity trap risk adds concern', () => {
    const ctx = { liquidity: { liquidityGrabRisk: 0.8 } };
    const result = reflection.questionEntry('BTC', 'LONG', 80, 'TREND', ctx, 'liq-user');
    expect(result.concerns.some(c => c.type === 'liquidity_trap')).toBe(true);
  });

  test('correlation risk with multiple same-dir positions', () => {
    const ctx = { openPositions: [{ side: 'LONG' }, { side: 'LONG' }, { side: 'LONG' }] };
    const result = reflection.questionEntry('BTC', 'LONG', 80, 'TREND', ctx, 'corr-user');
    expect(result.concerns.some(c => c.type === 'correlation_risk')).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════
// Calibration
// ══════════════════════════════════════════════════════════════
describe('calibration', () => {

  test('updateCalibration tracks buckets per user', () => {
    for (let i = 0; i < 15; i++) {
      reflection.updateCalibration(75, i < 8, 'cal-user'); // 8/15 wins in 70-80 bucket
    }
    const data = reflection.getDashboard('cal-user').calibration;
    expect(data['70-80']).toBeDefined();
    expect(data['70-80'].samples).toBe(15);
    expect(data['70-80'].actualWinRate).toBeCloseTo(53, 0);
  });

  test('calibration isolated between users', () => {
    reflection.updateCalibration(75, true, 'cal-A');
    reflection.updateCalibration(75, true, 'cal-A');
    reflection.updateCalibration(75, true, 'cal-A');
    const dataA = reflection.getDashboard('cal-A').calibration;
    const dataB = reflection.getDashboard('cal-B').calibration;
    expect(dataA['70-80']).toBeDefined();
    expect(dataB['70-80']).toBeUndefined();
  });

  test('getCalibrationAdjustment returns 0 without enough data', () => {
    const adj = reflection.getCalibrationAdjustment(75, 'no-data-user');
    expect(adj).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════
// Skipped trades
// ══════════════════════════════════════════════════════════════
describe('skipped trades', () => {

  test('trackSkippedTrade does nothing without userId', () => {
    expect(() => reflection.trackSkippedTrade('BTC', 'LONG', 70, 50000)).not.toThrow();
  });

  test('evaluateSkipped does nothing without userId', () => {
    expect(() => reflection.evaluateSkipped('BTC', 50000)).not.toThrow();
  });
});
