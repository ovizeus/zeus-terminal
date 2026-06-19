'use strict';

// [AUDIT-20260619 P2] After a confidence cut (Ring5 influence / reflection penalty /
// correlation modifier) the post-fusion re-tier only checked <smallBar (→NO_TRADE) and
// <72 (→SMALL) — a LARGE penalized to 72..81 stayed LARGE and was sized 1.75x instead
// of MEDIUM's 1.35x (~30% over-size). The correlation site lacked even the SMALL demote.
// _demoteTierForConfidence is the shared demote-only ladder matching _classifyTier's
// thresholds (LARGE>=82, MEDIUM>=72, SMALL>=smallBar). It never promotes; it needs no
// confScore because the bars are monotonic (a LARGE's confScore>=75 already satisfies
// MEDIUM>=68 and SMALL>=60).

const sb = require('../../server/services/serverBrain');
const demote = sb._demoteTierForConfidence;

describe('_demoteTierForConfidence — demote-only re-tier after a confidence cut', () => {
  test('LARGE penalized to 72..81 → MEDIUM (the bug: it stayed LARGE)', () => {
    expect(demote('LARGE', 80, null)).toBe('MEDIUM');
    expect(demote('LARGE', 72, null)).toBe('MEDIUM');
  });
  test('LARGE penalized below 72 (but >=62) → SMALL', () => {
    expect(demote('LARGE', 70, null)).toBe('SMALL');
  });
  test('MEDIUM penalized below 72 → SMALL', () => {
    expect(demote('MEDIUM', 65, null)).toBe('SMALL');
  });
  test('any tier below the SMALL bar (62) → NO_TRADE', () => {
    expect(demote('LARGE', 61, null)).toBe('NO_TRADE');
    expect(demote('SMALL', 50, null)).toBe('NO_TRADE');
  });
  test('never promotes: SMALL stays SMALL at high confidence', () => {
    expect(demote('SMALL', 90, null)).toBe('SMALL');
    expect(demote('MEDIUM', 90, null)).toBe('MEDIUM');
  });
  test('LARGE with confidence still >=82 stays LARGE', () => {
    expect(demote('LARGE', 85, null)).toBe('LARGE');
  });
  test('NO_TRADE stays NO_TRADE', () => {
    expect(demote('NO_TRADE', 90, null)).toBe('NO_TRADE');
  });
  test('soak floor below 62 lowers the NO_TRADE bar', () => {
    expect(demote('SMALL', 58, 55)).toBe('SMALL');   // 58 >= 55 floor → still SMALL
    expect(demote('SMALL', 54, 55)).toBe('NO_TRADE'); // 54 < 55 floor → NO_TRADE
  });
});
