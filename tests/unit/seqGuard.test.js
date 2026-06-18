const { rewindSafeSeq } = require('../../server/services/seqGuard');

describe('seqGuard.rewindSafeSeq', () => {
  test('healthy case: saved counter already above all open seqs → unchanged (no behaviour change)', () => {
    // saved.seq=420 is the live counter, open positions are 412/413/414 → keep 420
    expect(rewindSafeSeq(420, [412, 413, 414])).toBe(420);
  });
  test('stale snapshot: saved counter BELOW an open position seq → clamp UP to the max open seq', () => {
    // the bug: saved.seq rewound to 411 but a position with seq 414 is still open → must clamp to 414
    expect(rewindSafeSeq(411, [412, 413, 414])).toBe(414);
  });
  test('no positions → returns saved counter', () => {
    expect(rewindSafeSeq(409, [])).toBe(409);
  });
  test('missing/NaN saved → falls back to max open seq (or 0)', () => {
    expect(rewindSafeSeq(undefined, [100, 200])).toBe(200);
    expect(rewindSafeSeq(NaN, [])).toBe(0);
    expect(rewindSafeSeq(null, [])).toBe(0);
  });
  test('ignores non-finite seqs in the list', () => {
    expect(rewindSafeSeq(50, [undefined, NaN, 70, null])).toBe(70);
  });
  test('never decreases below saved even if list maxes are lower', () => {
    expect(rewindSafeSeq(500, [10, 20])).toBe(500);
  });
});
