'use strict';
// [P1 dual-write dedup 2026-06-08] The transitional binanceOps.placeEntry row
// ("Option B", crash-safety breadcrumb) is linked to serverAT's canonical row
// via pos.live.opsSeq. On a NORMAL close serverAT calls binanceOps.closePosition
// (which DELETEs the ops row). But close paths that skip binanceOps —
// EXTERNAL_CLOSE / RECON_PHANTOM / RECON_EXCHANGE_CLOSED — left the ops row
// orphaned (boot recovery later marked it ORPHANED; it never got removed).
// _persistClose now cleans the linked ops stub for ALL exit types. This predicate
// decides whether there is a distinct linked ops row to clean.
const { _linkedOpsSeqToCleanup } = require('../../server/services/serverAT');

describe('_linkedOpsSeqToCleanup (dual-write ops-row dedup decision)', () => {
  test('is a function (exported)', () => {
    expect(typeof _linkedOpsSeqToCleanup).toBe('function');
  });

  test('returns the opsSeq when present and DISTINCT from the canonical seq', () => {
    expect(_linkedOpsSeqToCleanup({ seq: 1776859653286, live: { opsSeq: 1776859653287 } }))
      .toBe(1776859653287);
  });

  test('returns null when opsSeq equals the canonical seq (never delete our own row)', () => {
    expect(_linkedOpsSeqToCleanup({ seq: 42, live: { opsSeq: 42 } })).toBeNull();
  });

  test('returns null when there is no live block', () => {
    expect(_linkedOpsSeqToCleanup({ seq: 42 })).toBeNull();
  });

  test('returns null when opsSeq is absent / null / 0 (no dual-write row)', () => {
    expect(_linkedOpsSeqToCleanup({ seq: 42, live: {} })).toBeNull();
    expect(_linkedOpsSeqToCleanup({ seq: 42, live: { opsSeq: null } })).toBeNull();
    expect(_linkedOpsSeqToCleanup({ seq: 42, live: { opsSeq: 0 } })).toBeNull();
  });

  test('null / garbage input is safe', () => {
    expect(_linkedOpsSeqToCleanup(null)).toBeNull();
    expect(_linkedOpsSeqToCleanup({})).toBeNull();
    expect(_linkedOpsSeqToCleanup({ live: { opsSeq: 'x' } })).toBeNull();
  });
});
