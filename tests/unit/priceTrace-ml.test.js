// Zeus Terminal — TDD for priceTrace ML-proposal stamping.
// The ML policy emits a proposal (plPct/prPct/ivPct/action) live per cycle; priceTrace
// stamps the LATEST proposal onto each subsequent price sample so the close-time learner
// can replay simulateMlPath() over the real (price, ml) path. Backward compatible:
// samples without a prior recordMl() carry ml:null.
'use strict';
const priceTrace = require('../../server/services/priceTrace');

describe('priceTrace ML stamping', () => {
  afterEach(() => { priceTrace.clear('T1'); priceTrace.clear('T2'); });

  test('record without recordMl → ml is null (backward compatible)', () => {
    priceTrace.record('T1', 100, 1000);
    const s = priceTrace.get('T1');
    expect(s.length).toBe(1);
    expect(s[0].p).toBe(100);
    expect(s[0].ml).toBeNull();
  });

  test('recordMl stamps the latest proposal onto subsequent samples', () => {
    priceTrace.recordMl('T1', { plPct: 0.8, prPct: 0.7, ivPct: 0.3, action: 'LOOSEN' });
    priceTrace.record('T1', 100, 1000);
    priceTrace.record('T1', 101, 1300);
    const s = priceTrace.get('T1');
    expect(s[0].ml).toEqual({ plPct: 0.8, prPct: 0.7, ivPct: 0.3, action: 'LOOSEN' });
    expect(s[1].ml).toEqual({ plPct: 0.8, prPct: 0.7, ivPct: 0.3, action: 'LOOSEN' });
  });

  test('a later recordMl changes only subsequent samples (step function)', () => {
    priceTrace.recordMl('T1', { plPct: 0.8, prPct: 0.7, ivPct: 0.3, action: 'HOLD' });
    priceTrace.record('T1', 100, 1000);
    priceTrace.recordMl('T1', { plPct: 0.5, prPct: 0.4, ivPct: 0.2, action: 'TIGHTEN' });
    priceTrace.record('T1', 101, 1300);
    const s = priceTrace.get('T1');
    expect(s[0].ml.action).toBe('HOLD');
    expect(s[1].ml.action).toBe('TIGHTEN');
    expect(s[1].ml.plPct).toBe(0.5);
  });

  test('recordMl before any price sample is safe and applies to the first sample', () => {
    priceTrace.recordMl('T2', { plPct: 1.3, prPct: 1.1, ivPct: 0.4, action: 'LOOSEN' });
    priceTrace.record('T2', 50, 2000);
    const s = priceTrace.get('T2');
    expect(s.length).toBe(1);
    expect(s[0].ml.action).toBe('LOOSEN');
  });

  test('clear wipes samples and the current ml', () => {
    priceTrace.recordMl('T1', { plPct: 0.8, prPct: 0.7, ivPct: 0.3, action: 'HOLD' });
    priceTrace.record('T1', 100, 1000);
    priceTrace.clear('T1');
    expect(priceTrace.get('T1')).toEqual([]);
    // after clear, a fresh record carries no stale ml
    priceTrace.record('T1', 100, 9000);
    expect(priceTrace.get('T1')[0].ml).toBeNull();
  });

  test('invalid ml is ignored (telemetry-safe)', () => {
    priceTrace.recordMl('T1', null);
    priceTrace.recordMl('T1', { plPct: 'x' });
    priceTrace.record('T1', 100, 1000);
    expect(priceTrace.get('T1')[0].ml).toBeNull();
  });
});
