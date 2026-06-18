const pt = require('../../server/services/priceTrace');
describe('priceTrace', () => {
  test('records throttled samples and returns them in order', () => {
    pt.clear(1);
    pt.record(1, 100, 1000); pt.record(1, 100.5, 1200); // 1200-1000=200ms < 250 → dropped
    pt.record(1, 101, 1300); // 1300-1000=300 ok
    const t = pt.get(1);
    expect(t.length).toBe(2);
    expect(t[0].p).toBe(100); expect(t[1].p).toBe(101);
  });
  test('caps the number of samples (no unbounded growth)', () => {
    pt.clear(2);
    for (let i = 0; i < 5000; i++) pt.record(2, 100 + i, i * 1000);
    expect(pt.get(2).length).toBeLessThanOrEqual(2000);
    expect(pt.get(2)[pt.get(2).length - 1].p).toBe(100 + 4999);
  });
  test('clear frees the trace', () => { pt.record(3, 1, 1); pt.clear(3); expect(pt.get(3)).toEqual([]); });
});
