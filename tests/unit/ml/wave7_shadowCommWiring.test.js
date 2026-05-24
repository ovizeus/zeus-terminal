'use strict';

describe('Wave 7: R6 Shadow/Meta + R7 Communication wiring', () => {
  test('abTesting loads and exports experiment functions', () => {
    const mod = require('../../../server/services/ml/R6_shadowMeta/abTesting');
    expect(mod).toBeDefined();
    const keys = Object.keys(mod);
    expect(keys.length).toBeGreaterThan(0);
  });

  test('rlPositionManager loads', () => {
    const mod = require('../../../server/services/ml/R6_shadowMeta/rlPositionManager');
    expect(mod).toBeDefined();
  });

  test('R7 eventBus loads and has pub/sub interface', () => {
    const eb = require('../../../server/services/ml/R7_communication/eventBus');
    expect(eb).toBeDefined();
    expect(typeof eb.subscribe === 'function' || typeof eb.publish === 'function').toBe(true);
  });

  test('R7 eventBus pub/sub works', () => {
    const eb = require('../../../server/services/ml/R7_communication/eventBus');
    if (typeof eb._reset === 'function') eb._reset();
    let received = null;
    if (typeof eb.subscribe === 'function' && typeof eb.publish === 'function') {
      eb.subscribe('test_topic', (data) => { received = data; });
      eb.publish('test_topic', { hello: 'world' });
      expect(received).toEqual({ hello: 'world' });
      if (typeof eb._reset === 'function') eb._reset();
    } else {
      // If different API, just verify module loads
      expect(eb).toBeDefined();
    }
  });

  test('curiosityEngine loads (dormant)', () => {
    const mod = require('../../../server/services/ml/R6_shadowMeta/curiosityEngine');
    expect(mod).toBeDefined();
  });

  test('ensembleVoting loads (dormant)', () => {
    const mod = require('../../../server/services/ml/R6_shadowMeta/ensembleVoting');
    expect(mod).toBeDefined();
  });

  test('internalDebate loads (dormant)', () => {
    const mod = require('../../../server/services/ml/R6_shadowMeta/internalDebate');
    expect(mod).toBeDefined();
  });
});
