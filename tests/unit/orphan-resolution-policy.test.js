'use strict';
// [ORPHAN-ADOPT FIX 2026-06-08] Recon orphan resolution policy. A confirmed
// orphan (position on the exchange the server doesn't track) was only ALERTED
// when it had no open SAT_ orders — so it stayed an untracked orphan forever,
// re-flagged every recon cycle. ≥5 orphan events / 5min → srvPos.js suspended
// AT (kill switch) in a loop (operator: "reset kill reapare"; root cause was a
// 24h zombie process that left 3 such orphans). Fix: an orphan that is NOT
// auto-closed must be ADOPTED (tracked + protective SL) so it stops being an
// orphan. Pure policy fn keeps the decision unit-testable.
const { _classifyOrphanResolution } = require('../../server/services/serverAT');

describe('_classifyOrphanResolution (recon orphan resolution policy)', () => {
  test('is a function (exported)', () => {
    expect(typeof _classifyOrphanResolution).toBe('function');
  });

  test('Zeus-created (live SAT_ orders present) → CLOSE', () => {
    expect(_classifyOrphanResolution({ isZeusCreated: true })).toBe('CLOSE');
  });

  test('NOT auto-closeable (no open SAT_ orders) → ADOPT (no longer alert-only dead-end)', () => {
    expect(_classifyOrphanResolution({ isZeusCreated: false })).toBe('ADOPT');
  });

  test('never returns the old ALERT-only dead-end (the bug)', () => {
    const a = _classifyOrphanResolution({ isZeusCreated: true });
    const b = _classifyOrphanResolution({ isZeusCreated: false });
    expect(['CLOSE', 'ADOPT']).toContain(a);
    expect(['CLOSE', 'ADOPT']).toContain(b);
    expect(a).not.toBe('ALERT');
    expect(b).not.toBe('ALERT');
  });

  test('missing/garbage ctx defaults to ADOPT (safe: track+protect, never leave a perpetual orphan)', () => {
    expect(_classifyOrphanResolution({})).toBe('ADOPT');
    expect(_classifyOrphanResolution(null)).toBe('ADOPT');
  });
});
