const { clamp } = require('../../server/services/dslSafety');
const L = { side: 'LONG', entry: 100, price: 103, originalSL: 98.5, maxLossPct: 1.5 };

describe('dslSafety.clamp', () => {
  test('Net A: LONG PL never wider (lower) than originalSL', () => {
    // a huge plPct would put PL far below entry → must be floored at originalSL distance
    const r = clamp({ plPct: 5, prPct: 0.7, ivPct: 0.3, action: 'LOOSEN', reason: 'x' }, L);
    const plPrice = L.price * (1 - r.plPct / 100);
    expect(plPrice).toBeGreaterThanOrEqual(L.originalSL - 1e-6);
  });
  test('Net B: unrealized loss past maxLossPct → forcedExit', () => {
    const r = clamp({ plPct: 0.8, prPct: 0.7, ivPct: 0.3, action: 'HOLD', reason: 'x' },
      { ...L, price: 98.0 }); // −2% from entry > 1.5%
    expect(r.forcedExit).toBe(true);
    expect(r.action).toBe('EXIT');
  });
  test('fail-closed: NaN proposed → safe tight default, finite, no forcedExit on a flat price', () => {
    const r = clamp({ plPct: NaN, prPct: undefined, ivPct: null, action: 'LOOSEN' }, { ...L, price: 100 });
    expect(Number.isFinite(r.plPct)).toBe(true);
    expect(r.plPct).toBeGreaterThan(0);
  });
  test('SHORT mirror: PL never wider (higher) than originalSL', () => {
    const S = { side: 'SHORT', entry: 100, price: 97, originalSL: 101.5, maxLossPct: 1.5 };
    const r = clamp({ plPct: 5, prPct: 0.7, ivPct: 0.3, action: 'LOOSEN', reason: 'x' }, S);
    const plPrice = S.price * (1 + r.plPct / 100);
    expect(plPrice).toBeLessThanOrEqual(S.originalSL + 1e-6);
  });
});
