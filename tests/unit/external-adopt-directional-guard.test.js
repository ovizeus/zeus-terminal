'use strict';
// [PHANTOM-SHORT FIX 2026-06-08] The userDataStream fast-path "POSITION_OPENED
// externally" adoption (_syncExternalPosition) bypassed the directional-bias
// guard. On a ONE-WAY account (the only kind serverAT trades) an "external"
// position whose side is OPPOSITE to an existing same-mode position is
// physically impossible — it is always a misread of a BUY/SELL reduce-fill.
// Adopting it injected a phantom opposite-side row into _positions that lived
// for ~80 min (operator-observed) before recon cleaned it, showing a fake
// SHORT next to real LONGs ("short + long interzis").
//
// Fix: a pure predicate, shared by the entry guard AND the adoption gate, that
// finds a same-mode opposite-side position. The fast-path adoption skips when
// it would create an opposite-side book, deferring to the 60s exchange-truth
// recon (which only adopts positions genuinely present on the exchange).
const { _findSameModeOpposite } = require('../../server/services/serverAT');

describe('_findSameModeOpposite (shared directional-conflict predicate)', () => {
  const longLive = { userId: 1, symbol: 'ETHUSDT', side: 'LONG', mode: 'live' };
  const longLiveBtc = { userId: 1, symbol: 'BTCUSDT', side: 'LONG', mode: 'live' };
  const shortLive = { userId: 1, symbol: 'SOLUSDT', side: 'SHORT', mode: 'live' };
  const longDemo = { userId: 1, symbol: 'ETHUSDT', side: 'LONG', mode: 'demo' };
  const longLiveU2 = { userId: 2, symbol: 'ETHUSDT', side: 'LONG', mode: 'live' };

  test('is a function (exported)', () => {
    expect(typeof _findSameModeOpposite).toBe('function');
  });

  test('finds an existing LONG when a SHORT is proposed, same mode/user (any symbol)', () => {
    const hit = _findSameModeOpposite([longLive], { userId: 1, side: 'SHORT', mode: 'live' });
    expect(hit).toBe(longLive);
  });

  test('finds an existing SHORT when a LONG is proposed, same mode/user', () => {
    const hit = _findSameModeOpposite([shortLive], { userId: 1, side: 'LONG', mode: 'live' });
    expect(hit).toBe(shortLive);
  });

  test('returns null when the existing position is the SAME side', () => {
    const hit = _findSameModeOpposite([longLive, longLiveBtc], { userId: 1, side: 'LONG', mode: 'live' });
    expect(hit == null).toBe(true);
  });

  test('does NOT match across modes (live vs demo are independent sandboxes)', () => {
    const hit = _findSameModeOpposite([longDemo], { userId: 1, side: 'SHORT', mode: 'live' });
    expect(hit == null).toBe(true);
  });

  test('does NOT match across users', () => {
    const hit = _findSameModeOpposite([longLiveU2], { userId: 1, side: 'SHORT', mode: 'live' });
    expect(hit == null).toBe(true);
  });

  test('missing mode defaults to demo on BOTH sides (legacy rows)', () => {
    const legacyLong = { userId: 1, symbol: 'ETHUSDT', side: 'LONG' }; // no mode
    const hit = _findSameModeOpposite([legacyLong], { userId: 1, side: 'SHORT' });
    expect(hit).toBe(legacyLong);
  });

  test('empty / non-array input is safe', () => {
    expect(_findSameModeOpposite([], { userId: 1, side: 'LONG', mode: 'live' }) == null).toBe(true);
    expect(_findSameModeOpposite(null, { userId: 1, side: 'LONG', mode: 'live' }) == null).toBe(true);
  });
});
