/**
 * Zeus Terminal — Unit Tests: serverExitManager.js
 * Tests analyzePosition() exit recommendations
 */
'use strict';

jest.mock('../../server/services/database', () => ({
    db: { prepare: jest.fn(() => ({ all: jest.fn(() => []) })) },
    journalGetClosed: jest.fn(() => []),
}));
jest.mock('../../server/services/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const { analyzePosition, getRegimeStats } = require('../../server/services/serverExitManager');

// ══════════════════════════════════════════════════════════════
// analyzePosition — basic
// ══════════════════════════════════════════════════════════════
describe('analyzePosition', () => {

  const basePos = {
    symbol: 'BTCUSDT', side: 'LONG', entryPrice: 50000,
    currentPrice: 50500, pnlPct: 1.0, openTs: Date.now() - 600000,
    regime: 'TREND', mfe: 1.5,
  };

  test('returns hold for normal position', () => {
    const result = analyzePosition(basePos, {}, 'test-user');
    expect(result.action).toBe('hold');
    expect(result.details).toBeDefined();
  });

  test('profit giving back triggers trail_tight', () => {
    const pos = { ...basePos, mfe: 2.0, pnlPct: 0.5 }; // gave back 75%
    const result = analyzePosition(pos, {}, 'test-user');
    expect(result.action).toBe('trail_tight');
    expect(result.urgency).toBe('high');
  });

  test('CHoCH against LONG in profit → trail_aggressive', () => {
    const ctx = { structure: { lastCHoCH: { dir: 'bearish' } } };
    const result = analyzePosition({ ...basePos, pnlPct: 0.5 }, ctx, 'test-user');
    expect(result.action).toBe('trail_aggressive');
  });

  test('CHoCH against LONG in loss → exit_now', () => {
    const ctx = { structure: { lastCHoCH: { dir: 'bearish' } } };
    const result = analyzePosition({ ...basePos, pnlPct: -0.3 }, ctx, 'test-user');
    expect(result.action).toBe('exit_now');
    expect(result.urgency).toBe('critical');
  });

  test('regime transition to VOLATILE with loss → exit_now', () => {
    const ctx = { regimeTransition: { transitioning: true, to: 'VOLATILE' } };
    const result = analyzePosition({ ...basePos, pnlPct: -0.2 }, ctx, 'test-user');
    expect(result.action).toBe('exit_now');
  });

  test('regime transition to VOLATILE with profit → trail_tight', () => {
    const ctx = { regimeTransition: { transitioning: true, to: 'VOLATILE' } };
    const result = analyzePosition({ ...basePos, pnlPct: 0.8 }, ctx, 'test-user');
    expect(result.action).toBe('trail_tight');
  });

  test('LONG approaching liquidity above → take_profit', () => {
    const ctx = { liquidity: { nearestAbove: { price: 50600 } } };
    const pos = { ...basePos, currentPrice: 50500, pnlPct: 0.5 };
    const result = analyzePosition(pos, ctx, 'test-user');
    expect(result.action).toBe('take_profit');
  });

  test('SHORT approaching liquidity below → take_profit', () => {
    const ctx = { liquidity: { nearestBelow: { price: 49500 } } };
    const pos = { ...basePos, side: 'SHORT', currentPrice: 49600, pnlPct: 0.5 };
    const result = analyzePosition(pos, ctx, 'test-user');
    expect(result.action).toBe('take_profit');
  });
});

// ══════════════════════════════════════════════════════════════
// getRegimeStats — per user
// ══════════════════════════════════════════════════════════════
describe('getRegimeStats', () => {

  test('returns empty object for user with no trades', () => {
    const stats = getRegimeStats('no-trades-user');
    expect(typeof stats).toBe('object');
    expect(Object.keys(stats).length).toBe(0);
  });

  test('returns empty without userId', () => {
    const stats = getRegimeStats(undefined);
    expect(typeof stats).toBe('object');
  });
});
