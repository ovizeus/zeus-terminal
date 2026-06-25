const { decide, initialCap } = require('../../server/services/mlDslPolicy');
const base = { side: 'LONG', entry: 100, price: 102, mfePct: 2, maePct: 0.3, momentum: 0, atrPct: 1.0, regime: 'TREND', secsInTrade: 120, progress: 50 };

describe('mlDslPolicy.decide', () => {
  test('strong favorable momentum → LOOSEN, wider trail than default', () => {
    const r = decide({ ...base, momentum: 0.8 });
    expect(r.action).toBe('LOOSEN');
    expect(r.prPct).toBeGreaterThan(0.6);   // wider than fast(0.4)/def(0.7)
    expect(r.ivPct).toBeGreaterThan(0.3);
    expect(typeof r.reason).toBe('string');
  });
  test('fading momentum near peak → TIGHTEN, lock profit (PL nearer price)', () => {
    const r = decide({ ...base, momentum: -0.2, mfePct: 3 });
    expect(r.action).toBe('TIGHTEN');
    expect(r.plPct).toBeLessThan(0.8);       // tighter stop = smaller plPct
  });
  test('price tapping but momentum still up = BREATHER (slight PR room, PL held)', () => {
    const r = decide({ ...base, momentum: 0.3, price: 101, mfePct: 1.2 });
    expect(['BREATHER', 'LOOSEN', 'HOLD']).toContain(r.action);
  });
  test('strong adverse momentum → EXIT', () => {
    const r = decide({ ...base, momentum: -0.85 });
    expect(r.action).toBe('EXIT');
  });
  test('all outputs finite and clamped to sane ranges', () => {
    const r = decide({ ...base, momentum: 0.5 });
    for (const k of ['plPct', 'prPct', 'ivPct']) {
      expect(Number.isFinite(r[k])).toBe(true);
      expect(r[k]).toBeGreaterThan(0); expect(r[k]).toBeLessThanOrEqual(5);
    }
  });
});

describe('mlDslPolicy.initialCap (entry loss-cap as a fraction of the hard SL)', () => {
  const c = { hardSlPct: 1.5, regime: 'TREND', withTrend: true, side: 'LONG' };
  test('the cap is ALWAYS tighter than the hard SL (never looser)', () => {
    for (const regime of ['TREND', 'RANGE', 'VOLATILE', 'BREAKOUT']) {
      for (const withTrend of [true, false]) {
        const r = initialCap({ ...c, regime, withTrend });
        expect(r.capPct).toBeLessThan(c.hardSlPct);
      }
    }
  });
  test('counter-trend gets a TIGHTER cap than with-trend (same hard SL/regime)', () => {
    const withT = initialCap({ ...c, withTrend: true });
    const against = initialCap({ ...c, withTrend: false });
    expect(against.capPct).toBeLessThan(withT.capPct);
  });
  test('a wider hard SL yields a wider cap (cap scales with the SL distance)', () => {
    const tight = initialCap({ ...c, hardSlPct: 1.0 });
    const wide = initialCap({ ...c, hardSlPct: 3.0 });
    expect(wide.capPct).toBeGreaterThan(tight.capPct);
  });
  test('a ranging regime caps tighter than a trending regime (same hard SL)', () => {
    const trend = initialCap({ ...c, regime: 'TREND' });
    const range = initialCap({ ...c, regime: 'RANGE' });
    expect(range.capPct).toBeLessThan(trend.capPct);
  });
  test('fail-safe on bad/missing input → a finite cap below a sane default hard SL', () => {
    const r = initialCap({});
    expect(Number.isFinite(r.capPct)).toBe(true);
    expect(r.capPct).toBeGreaterThan(0);
    expect(['TIGHT', 'NORMAL', 'WIDE']).toContain(r.posture);
  });
});
