const shadow = require('../../server/services/mlDslShadow');
const pos = { seq: 1, side: 'LONG', price: 100, _maxPrice: 103, _minPrice: 99, sl: 98.5, ts: Date.now() - 60000, regime: 'TREND' };

describe('mlDslShadow', () => {
  test('buildFeatures derives mfePct/maePct/secsInTrade from the position', () => {
    const f = shadow.buildFeatures(pos, 102, { atrPct: 1.0 });
    expect(f.side).toBe('LONG');
    expect(f.mfePct).toBeCloseTo((103 - 100) / 100 * 100, 1);  // 3%
    expect(f.maePct).toBeCloseTo((100 - 99) / 100 * 100, 1);   // 1%
    expect(f.secsInTrade).toBeGreaterThanOrEqual(59);
  });
  test('record + snapshot round-trips latest proposal per posId', () => {
    shadow.record(1, { action: 'LOOSEN', plPct: 0.9, ts: 123 });
    shadow.record(1, { action: 'TIGHTEN', plPct: 0.5, ts: 456 });
    const snap = shadow.snapshot();
    expect(snap['1'].action).toBe('TIGHTEN'); // latest wins
  });
});
