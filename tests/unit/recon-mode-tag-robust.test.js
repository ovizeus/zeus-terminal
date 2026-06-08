'use strict';
// [PHANTOM-SHORT FIX 2026-06-08 — part b] Recon's livePositions filter required
// p.mode === 'live'. The dual-DB-write transitional path (binanceOps.placeEntry,
// "Option B") and other call sites can stamp a REAL position with mode='testnet'
// (creds.mode) instead of the engine mode 'live'. Such a row has a live exchange
// leg but was EXCLUDED from reconciliation → never deduped, never phantom-closed
// → invisible drift. Fix: reconcile ANY non-demo position that has a live leg,
// regardless of the exact mode string. Demo (paper) must NEVER reconcile against
// the exchange.
const { _isReconcilablePosition } = require('../../server/services/serverAT');

describe('_isReconcilablePosition (recon robust to mode-tag)', () => {
  const live = (extra = {}) => ({ mode: 'live', live: { status: 'LIVE' }, ...extra });

  test('is a function (exported)', () => {
    expect(typeof _isReconcilablePosition).toBe('function');
  });

  test('real live position with a live leg → reconcilable', () => {
    expect(_isReconcilablePosition(live())).toBe(true);
  });

  test("mistagged mode='testnet' real position with a live leg → STILL reconcilable (the bug)", () => {
    expect(_isReconcilablePosition({ mode: 'testnet', live: { status: 'LIVE' } })).toBe(true);
  });

  test('EXTERNAL (adopted) leg → reconcilable', () => {
    expect(_isReconcilablePosition({ mode: 'live', live: { status: 'EXTERNAL' } })).toBe(true);
    expect(_isReconcilablePosition({ mode: 'testnet', live: { status: 'EXTERNAL' } })).toBe(true);
  });

  test('LIVE_NO_SL leg → reconcilable', () => {
    expect(_isReconcilablePosition({ mode: 'live', live: { status: 'LIVE_NO_SL' } })).toBe(true);
  });

  test('demo (paper) position → NEVER reconcilable, even with a live-shaped leg', () => {
    expect(_isReconcilablePosition({ mode: 'demo', live: { status: 'LIVE' } })).toBe(false);
    expect(_isReconcilablePosition({ mode: 'demo' })).toBe(false);
  });

  test('no live leg → not reconcilable (PENDING/ENTRY_FAILED/stub)', () => {
    expect(_isReconcilablePosition({ mode: 'live' })).toBe(false);
    expect(_isReconcilablePosition({ mode: 'live', live: { status: 'PENDING' } })).toBe(false);
    expect(_isReconcilablePosition({ mode: 'live', live: { status: 'ENTRY_FAILED' } })).toBe(false);
  });

  test('null / garbage input is safe', () => {
    expect(_isReconcilablePosition(null)).toBe(false);
    expect(_isReconcilablePosition({})).toBe(false);
  });
});
