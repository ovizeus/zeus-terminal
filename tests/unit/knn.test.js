/**
 * Zeus Terminal — Unit Tests: serverKNN.js
 * Tests feature extraction, cosine similarity, prediction, KNN modifier
 */
'use strict';

// Mock database — KNN uses db for rebuild
jest.mock('../../server/services/database', () => ({
    db: { prepare: jest.fn(() => ({ all: jest.fn(() => []) })) },
    journalGetClosed: jest.fn(() => []),
}));
jest.mock('../../server/services/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const { predict, getKNNModifier, extractFromSnapshot } = require('../../server/services/serverKNN');

// ══════════════════════════════════════════════════════════════
// extractFromSnapshot
// ══════════════════════════════════════════════════════════════
describe('extractFromSnapshot', () => {

  test('returns Float64Array of correct length', () => {
    const snap = { rsi: { '5m': 50 } };
    const confluence = { score: 60, isBull: true, bullDirs: 3, bearDirs: 1 };
    const ind = { adx: 25, regime: 'TREND', stDir: 'bull', macdDir: 'bull' };
    const v = extractFromSnapshot(snap, confluence, ind);
    expect(v).toBeInstanceOf(Float64Array);
    expect(v.length).toBe(10);
  });

  test('all values are between 0 and 1', () => {
    const snap = { rsi: { '5m': 85 } };
    const confluence = { score: 90, isBull: false, bullDirs: 1, bearDirs: 4 };
    const ind = { adx: 45, regime: 'VOLATILE', stDir: 'bear', macdDir: 'bear' };
    const v = extractFromSnapshot(snap, confluence, ind);
    for (let i = 0; i < v.length; i++) {
      expect(v[i]).toBeGreaterThanOrEqual(0);
      expect(v[i]).toBeLessThanOrEqual(1);
    }
  });

  test('RSI normalized correctly', () => {
    const v = extractFromSnapshot(
      { rsi: { '5m': 70 } },
      { score: 50, isBull: true, bullDirs: 2, bearDirs: 1 },
      { adx: 20, regime: 'RANGE', stDir: 'neut', macdDir: 'neut' }
    );
    expect(v[0]).toBeCloseTo(0.7); // 70/100
  });

  test('side encoding: bull=1, bear=0', () => {
    const bull = extractFromSnapshot(
      { rsi: { '5m': 50 } },
      { score: 50, isBull: true, bullDirs: 2, bearDirs: 1 },
      { adx: 20, regime: 'RANGE', stDir: 'neut', macdDir: 'neut' }
    );
    expect(bull[5]).toBe(1);

    const bear = extractFromSnapshot(
      { rsi: { '5m': 50 } },
      { score: 50, isBull: false, bullDirs: 1, bearDirs: 2 },
      { adx: 20, regime: 'RANGE', stDir: 'neut', macdDir: 'neut' }
    );
    expect(bear[5]).toBe(0);
  });

  test('regime encoding: TREND=1, CHAOS=0', () => {
    const trend = extractFromSnapshot(
      { rsi: { '5m': 50 } },
      { score: 50, isBull: true, bullDirs: 2, bearDirs: 1 },
      { adx: 20, regime: 'TREND', stDir: 'neut', macdDir: 'neut' }
    );
    expect(trend[4]).toBe(1);

    const chaos = extractFromSnapshot(
      { rsi: { '5m': 50 } },
      { score: 50, isBull: true, bullDirs: 2, bearDirs: 1 },
      { adx: 20, regime: 'CHAOS', stDir: 'neut', macdDir: 'neut' }
    );
    expect(chaos[4]).toBe(0);
  });

  test('handles missing/null values gracefully', () => {
    const v = extractFromSnapshot({ rsi: {} }, { score: null, bullDirs: 0, bearDirs: 0 }, { adx: null, stDir: null, macdDir: null });
    expect(v.length).toBe(10);
    // Should not throw, should use defaults
    for (let i = 0; i < v.length; i++) {
      expect(isNaN(v[i])).toBe(false);
    }
  });
});

// ══════════════════════════════════════════════════════════════
// predict — returns null when no patterns
// ══════════════════════════════════════════════════════════════
describe('predict', () => {

  test('returns null when no patterns exist', () => {
    const result = predict(
      { rsi: { '5m': 50 } },
      { score: 60, isBull: true, bullDirs: 3, bearDirs: 1 },
      { adx: 25, regime: 'TREND', stDir: 'bull', macdDir: 'bull' },
      'test-user'
    );
    expect(result).toBeNull();
  });

  test('returns null without userId', () => {
    const result = predict(
      { rsi: { '5m': 50 } },
      { score: 60, isBull: true, bullDirs: 3, bearDirs: 1 },
      { adx: 25, regime: 'TREND', stDir: 'bull', macdDir: 'bull' }
    );
    expect(result).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════
// getKNNModifier
// ══════════════════════════════════════════════════════════════
describe('getKNNModifier', () => {

  test('null prediction returns 1.0 (neutral)', () => {
    expect(getKNNModifier('LONG', null)).toBe(1.0);
  });

  test('strong agreement returns boost (1.10)', () => {
    const pred = { dir: 'LONG', confidence: 75 };
    expect(getKNNModifier('LONG', pred)).toBe(1.10);
  });

  test('mild agreement returns small boost (1.05)', () => {
    const pred = { dir: 'LONG', confidence: 50 };
    expect(getKNNModifier('LONG', pred)).toBe(1.05);
  });

  test('strong disagreement returns penalty (0.85)', () => {
    const pred = { dir: 'SHORT', confidence: 70 };
    expect(getKNNModifier('LONG', pred)).toBe(0.85);
  });

  test('mild disagreement returns small penalty (0.92)', () => {
    const pred = { dir: 'SHORT', confidence: 45 };
    expect(getKNNModifier('LONG', pred)).toBe(0.92);
  });
});
