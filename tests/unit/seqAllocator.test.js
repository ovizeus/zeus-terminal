const alloc = require('../../server/services/seqAllocator');
describe('seqAllocator', () => {
  beforeEach(() => alloc._resetForTest(0));
  test('next() is strictly increasing and globally unique', () => {
    const a = alloc.next(), b = alloc.next(), c = alloc.next();
    expect(b).toBe(a + 1); expect(c).toBe(b + 1);
  });
  test('init raises the floor, never lowers; next() exceeds the floor', () => {
    alloc.init(1780224661514);
    expect(alloc.current()).toBe(1780224661514);
    expect(alloc.next()).toBe(1780224661515);
    alloc.init(5); // lower floor ignored
    expect(alloc.current()).toBe(1780224661515);
  });
  test('init ignores non-finite', () => { alloc._resetForTest(100); alloc.init(undefined); alloc.init(NaN); expect(alloc.current()).toBe(100); });
  test('issued seqs never repeat across many calls', () => {
    alloc._resetForTest(0); const seen = new Set(); for (let i = 0; i < 5000; i++) { const s = alloc.next(); expect(seen.has(s)).toBe(false); seen.add(s); }
  });
});
