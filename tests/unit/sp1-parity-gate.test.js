const { evaluateParityGate, SP1_THRESHOLDS } = require('../../server/services/parityGate');

function mkReport({ pct, pairs, unpaired }) {
  return { totals: { primaryAgreementPct: pct, primaryPairs: pairs, primaryUnpaired: unpaired } };
}

describe('SP1 evaluateParityGate', () => {
  test('PASS when agreement, pairs, and unpaired-ratio all clear thresholds', () => {
    const r = evaluateParityGate(mkReport({ pct: 99.1, pairs: 800, unpaired: 10 }));
    expect(r.pass).toBe(true);
    expect(r.failures).toEqual([]);
  });

  test('FAIL on insufficient pairs even at 100% agreement (false-high guard)', () => {
    const r = evaluateParityGate(mkReport({ pct: 100, pairs: 3, unpaired: 0 }));
    expect(r.pass).toBe(false);
    expect(r.failures).toContain('paired');
  });

  test('FAIL when unpaired ratio exceeds U', () => {
    const r = evaluateParityGate(mkReport({ pct: 99, pairs: 600, unpaired: 400 }));
    expect(r.pass).toBe(false);
    expect(r.failures).toContain('unpairedRatio');
  });

  test('FAIL when agreement below N', () => {
    const r = evaluateParityGate(mkReport({ pct: 90, pairs: 800, unpaired: 5 }));
    expect(r.pass).toBe(false);
    expect(r.failures).toContain('agreement');
  });

  test('thresholds are the locked SP1 values', () => {
    expect(SP1_THRESHOLDS).toEqual({ N: 98, P: 500, U: 0.05, M: 3 });
  });
});
