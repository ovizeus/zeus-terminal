'use strict';
const { db } = require('../../../server/services/database');

afterAll(() => {
  try { db.prepare('DELETE FROM ml_black_swan_events WHERE user_id = 99').run(); } catch (_) {}
  try { db.prepare('DELETE FROM ml_loss_streak_state WHERE user_id = 99').run(); } catch (_) {}
});

describe('Wave 4: R3A safety advisors', () => {
  test('blackSwanAbstention loads and evaluates', () => {
    const bsa = require('../../../server/services/ml/R3A_safety/blackSwanAbstention');
    const result = bsa.evaluateBlackSwan({
      signals: {
        volatility_ratio: 1.0,
        liquidity_drop: 0.1,
        price_gap_pct: 1.0,
        correlation_delta: 0.3,
        funding_rate: 0.05,
      },
    });
    expect(result).toHaveProperty('severity');
    expect(result).toHaveProperty('triggered_conditions');
    expect(Array.isArray(result.triggered_conditions)).toBe(true);
  });

  test('blackSwanAbstention detects extreme conditions', () => {
    const bsa = require('../../../server/services/ml/R3A_safety/blackSwanAbstention');
    const result = bsa.evaluateBlackSwan({
      signals: {
        volatility_ratio: 6.0,
        liquidity_drop: 0.85,
        price_gap_pct: 6.0,
        correlation_delta: 0.6,
        funding_rate: 0.12,
      },
    });
    expect(result.severity).not.toBe('NONE');
    expect(result.triggered_conditions.length).toBeGreaterThan(0);
  });

  test('lossStreakDetection loads', () => {
    const mod = require('../../../server/services/ml/R3A_safety/lossStreakDetection');
    expect(mod).toBeDefined();
    const exports = Object.keys(mod);
    expect(exports.length).toBeGreaterThan(0);
  });

  test('conflictResolution loads', () => {
    const mod = require('../../../server/services/ml/R3A_safety/conflictResolution');
    expect(mod).toBeDefined();
  });

  test('realityContactRatio loads', () => {
    const mod = require('../../../server/services/ml/R3A_safety/realityContactRatio');
    expect(mod).toBeDefined();
  });

  test('ddRecoveryGraduated loads', () => {
    const mod = require('../../../server/services/ml/R3A_safety/ddRecoveryGraduated');
    expect(mod).toBeDefined();
  });
});
