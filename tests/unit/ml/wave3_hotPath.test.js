'use strict';
const { db } = require('../../../server/services/database');

afterAll(() => {
  db.prepare('DELETE FROM ml_thinking_traces WHERE user_id = 99').run();
  db.prepare('DELETE FROM ml_temporal_observations WHERE user_id = 99').run();
  db.prepare('DELETE FROM ml_smart_money_observations WHERE user_id = 99').run();
  db.prepare('DELETE FROM ml_confidence_state WHERE user_id = 99').run();
});

describe('Wave 3: R2 HOT PATH modules', () => {
  test('thinkingPipeline.executeStep records trace row', () => {
    const tp = require('../../../server/services/ml/R2_cognition/thinkingPipeline');
    const result = tp.executeStep({
      userId: 99, resolvedEnv: 'DEMO',
      decisionId: 'test_dec_w3', step: 'OBSERVA', stepIndex: 0,
      status: 'OK', output: { detectors: 3 }, durationMs: 5,
    });
    expect(result.recorded).toBe(true);
    const row = db.prepare("SELECT * FROM ml_thinking_traces WHERE user_id = 99 AND decision_id = 'test_dec_w3'").get();
    expect(row).not.toBeNull();
    expect(row.step).toBe('OBSERVA');
  });

  test('temporalPatterns.getCurrentTemporalContext returns session info', () => {
    const tp = require('../../../server/services/ml/R2_cognition/temporalPatterns');
    const ctx = tp.getCurrentTemporalContext({ timestampMs: Date.now() });
    expect(ctx).toHaveProperty('session');
    expect(ctx).toHaveProperty('dayOfWeek');
    expect(ctx).toHaveProperty('activePatterns');
    expect(Array.isArray(ctx.activePatterns)).toBe(true);
  });

  test('temporalPatterns.evaluateScoreAdjustment respects 0.20 cap invariant', () => {
    const tp = require('../../../server/services/ml/R2_cognition/temporalPatterns');
    const result = tp.evaluateScoreAdjustment({
      patterns: ['end_of_quarter', 'end_of_month', 'friday_evening', 'sunday_morning'],
      score: 0.7, aggressiveness: 0.5,
    });
    expect(Math.abs(result.scoreDelta)).toBeLessThanOrEqual(0.201); // float tolerance
  });

  test('temporalPatterns.recordTemporalObservation persists', () => {
    const tp = require('../../../server/services/ml/R2_cognition/temporalPatterns');
    const result = tp.recordTemporalObservation({
      userId: 99, resolvedEnv: 'DEMO',
      pattern: 'london_open', outcome: 0.8, regime: 'TREND',
    });
    expect(result.tracked).toBe(true);
  });

  test('smartMoneyDetector.detectInstitutionalDivergence works', () => {
    const smd = require('../../../server/services/ml/R2_cognition/smartMoneyDetector');
    const result = smd.detectInstitutionalDivergence({
      venueData: {
        binance: { price: 67000, buyPct: 55 },
        coinbase: { price: 67200, buyPct: 70 },
      },
    });
    expect(result).toHaveProperty('divergenceDetected');
    expect(result).toHaveProperty('severity');
  });

  test('smartMoneyDetector.recordObservation persists', () => {
    const smd = require('../../../server/services/ml/R2_cognition/smartMoneyDetector');
    const result = smd.recordObservation({
      userId: 99, resolvedEnv: 'DEMO',
      signalType: 'institutional_divergence',
      payload: { severity: 0.6 }, regime: 'TREND',
    });
    expect(result.recorded).toBe(true);
  });

  test('confidenceDecay.initializeThesis creates tracking', () => {
    const cd = require('../../../server/services/ml/R2_cognition/confidenceDecay');
    const result = cd.initializeThesis({
      userId: 99, resolvedEnv: 'DEMO',
      posId: 'test_pos_w3', symbol: 'BTCUSDT',
      entryConfidence: 0.75,
    });
    expect(result.created).toBe(true);
  });

  test('confidenceDecay.updateThesisProgress returns action', () => {
    const cd = require('../../../server/services/ml/R2_cognition/confidenceDecay');
    // Ensure thesis exists first
    try {
      cd.initializeThesis({
        userId: 99, resolvedEnv: 'DEMO',
        posId: 'test_pos_w3b', symbol: 'ETHUSDT',
        entryConfidence: 0.80,
      });
    } catch (_) {} // ignore if duplicate
    const result = cd.updateThesisProgress({
      userId: 99, resolvedEnv: 'DEMO',
      posId: 'test_pos_w3b',
      signals: { no_follow_through: true },
      priceProgress: -0.05,
    });
    expect(result).toHaveProperty('currentConfidence');
    expect(result).toHaveProperty('action');
    expect(['HOLD', 'REDUCE', 'EXIT']).toContain(result.action);
  });
});
