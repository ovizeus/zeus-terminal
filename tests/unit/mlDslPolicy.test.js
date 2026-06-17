const { decide } = require('../../server/services/mlDslPolicy');
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
