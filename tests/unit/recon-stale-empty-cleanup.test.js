'use strict';

// [AUDIT-20260619 BUG C] Phantom LIVE testnet positions in at_positions vs 0 on the
// exchange persisted forever: the empty-held SKIP guard (correctly) avoids false-closing
// live positions on a transient empty poll, but it ALSO never cleaned genuine phantoms
// when the exchange truly held nothing. The catch-22 is broken by cleaning AGED rows only
// after a SUSTAINED empty-but-successful streak (15 ≈ 15 min, far beyond any eventual-
// consistency blip which resolves in 1-2 polls).

const { _staleEmptyHooks } = require('../../server/services/serverAT');
const shouldCleanup = _staleEmptyHooks.shouldCleanup;
const AFTER = _staleEmptyHooks.cleanupAfter;     // 15
const MIN_AGE = _staleEmptyHooks.minAgeMs;       // 5 min

describe('_shouldCleanupStaleEmpty — clean aged phantoms only after a sustained empty streak', () => {
  test('high streak + old position → clean', () => {
    expect(shouldCleanup(AFTER, AFTER, MIN_AGE + 1, MIN_AGE)).toBe(true);
    expect(shouldCleanup(AFTER + 5, AFTER, MIN_AGE * 4, MIN_AGE)).toBe(true);
  });
  test('streak below threshold → do NOT clean (transient empty poll protected)', () => {
    expect(shouldCleanup(AFTER - 1, AFTER, MIN_AGE * 10, MIN_AGE)).toBe(false);
    expect(shouldCleanup(1, AFTER, MIN_AGE * 10, MIN_AGE)).toBe(false);
  });
  test('fresh position (registration race) → do NOT clean even at high streak', () => {
    expect(shouldCleanup(AFTER + 10, AFTER, MIN_AGE - 1, MIN_AGE)).toBe(false);
    expect(shouldCleanup(AFTER, AFTER, 1000, MIN_AGE)).toBe(false);
  });
  test('threshold is conservative (≥15 cycles, ≥5 min age)', () => {
    expect(AFTER).toBeGreaterThanOrEqual(15);
    expect(MIN_AGE).toBeGreaterThanOrEqual(5 * 60000);
  });
  test('non-finite inputs → safe false', () => {
    expect(shouldCleanup(NaN, AFTER, MIN_AGE * 2, MIN_AGE)).toBe(false);
    expect(shouldCleanup(AFTER, AFTER, NaN, MIN_AGE)).toBe(false);
  });
});
