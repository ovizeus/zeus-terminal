'use strict';
const { db } = require('../../../server/services/database');

beforeEach(() => {
  db.prepare("DELETE FROM ml_charter_principles WHERE user_id = 99").run();
  db.prepare("DELETE FROM ml_charter_decisions WHERE user_id = 99").run();
});

afterAll(() => {
  db.prepare("DELETE FROM ml_charter_principles WHERE user_id = 99").run();
  db.prepare("DELETE FROM ml_charter_decisions WHERE user_id = 99").run();
});

describe('Wave 2: R1 constitutionalCharterLayer wiring', () => {
  const charter = require('../../../server/services/ml/R1_constitution/constitutionalCharterLayer');

  test('registerPrinciple stores principle in ml_charter_principles', () => {
    const result = charter.registerPrinciple({
      userId: 99, resolvedEnv: 'DEMO',
      principleId: 'test_safety_1', kind: 'safety',
      description: 'Never risk more than 2% per trade',
    });
    expect(result.registered).toBe(true);
    expect(result.priorityRank).toBe(1); // safety = rank 1
  });

  test('evaluateDecisionAgainstCharter resolves conflict correctly', () => {
    charter.registerPrinciple({
      userId: 99, resolvedEnv: 'DEMO',
      principleId: 'test_safety_2', kind: 'safety',
      description: 'No leverage above 20x',
    });
    const result = charter.evaluateDecisionAgainstCharter({
      userId: 99, resolvedEnv: 'DEMO',
      principleKinds: ['safety', 'profit'],
    });
    expect(result.charterStatus).toBe('CONSTITUTIONALLY_BLOCKED');
    expect(result.triggeringPrinciple).toBe('safety');
  });

  test('recordCharterDecision writes to ml_charter_decisions', () => {
    const result = charter.recordCharterDecision({
      userId: 99, resolvedEnv: 'DEMO',
      decisionId: 'test_dec_001',
      actionSummary: 'LONG BTCUSDT 5x',
      conflictingPrinciples: ['safety'],
      charterStatus: 'CONSTITUTIONALLY_BLOCKED',
    });
    expect(result.recorded).toBe(true);
    const row = db.prepare("SELECT * FROM ml_charter_decisions WHERE decision_id = 'test_dec_001'").get();
    expect(row).not.toBeNull();
    expect(row.charter_status).toBe('CONSTITUTIONALLY_BLOCKED');
  });

  test('resolveConflict pure function works without DB', () => {
    const result = charter.resolveConflict({
      involvedPrincipleKinds: ['profit'],
    });
    expect(result.charterStatus).toBe('CONSTITUTIONAL_COMPLIANT');
  });

  test('getActivePrinciples returns registered principles', () => {
    charter.registerPrinciple({
      userId: 99, resolvedEnv: 'DEMO',
      principleId: 'test_truth_1', kind: 'truth',
      description: 'No false signals',
    });
    const principles = charter.getActivePrinciples({ userId: 99, resolvedEnv: 'DEMO' });
    expect(principles.length).toBeGreaterThan(0);
    expect(principles[0].kind).toBe('truth');
  });
});
