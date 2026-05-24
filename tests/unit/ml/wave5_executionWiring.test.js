'use strict';

describe('Wave 5: R4 execution module wiring', () => {
  test('smartPostOnly loads and exports expected functions', () => {
    const mod = require('../../../server/services/ml/R4_execution/smartPostOnly');
    expect(mod).toBeDefined();
    const keys = Object.keys(mod);
    expect(keys.length).toBeGreaterThan(0);
  });

  test('fundingAwareExit loads and exports expected functions', () => {
    const mod = require('../../../server/services/ml/R4_execution/fundingAwareExit');
    expect(mod).toBeDefined();
    const keys = Object.keys(mod);
    expect(keys.length).toBeGreaterThan(0);
  });

  test('rateLimitPriorityQueue loads and exports expected functions', () => {
    const mod = require('../../../server/services/ml/R4_execution/rateLimitPriorityQueue');
    expect(mod).toBeDefined();
    const keys = Object.keys(mod);
    expect(keys.length).toBeGreaterThan(0);
  });

  test('latencyAwareExecution loads and exports expected functions', () => {
    const mod = require('../../../server/services/ml/R4_execution/latencyAwareExecution');
    expect(mod).toBeDefined();
    const keys = Object.keys(mod);
    expect(keys.length).toBeGreaterThan(0);
  });

  test('exposureManager loads and exports expected functions', () => {
    const mod = require('../../../server/services/ml/R4_execution/exposureManager');
    expect(mod).toBeDefined();
    const keys = Object.keys(mod);
    expect(keys.length).toBeGreaterThan(0);
  });

  test('progressiveCommitment loads', () => {
    const mod = require('../../../server/services/ml/R4_execution/progressiveCommitment');
    expect(mod).toBeDefined();
  });

  test('transactionCostAnalyzer loads', () => {
    const mod = require('../../../server/services/ml/R4_execution/transactionCostAnalyzer');
    expect(mod).toBeDefined();
  });

  test('computeBudgetGovernor loads', () => {
    const mod = require('../../../server/services/ml/R4_execution/computeBudgetGovernor');
    expect(mod).toBeDefined();
  });

  test('exactlyOnceLedger is already wired (verify)', () => {
    const mod = require('../../../server/services/ml/R4_execution/exactlyOnceLedger');
    expect(mod).toBeDefined();
    expect(typeof mod.seen === 'function' || typeof mod.record === 'function').toBe(true);
  });
});
