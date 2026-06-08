'use strict';
// [PHANTOM-SHORT FIX 2026-06-08 — part a] binanceOps.placeEntry's transitional
// dual-write PENDING row ("Option B") stamped mode=creds.mode → a real position
// opened by the LIVE engine got mode='testnet'. That mistag is the landmine that
// excluded the row from recon (part b) and confused the directional guard. The
// engine mode (passed through params.mode) must win; creds.mode is only a
// backward-compat fallback for callers that don't pass one.
const { _buildPendingPositionData } = require('../../server/services/binanceOps');

describe('_buildPendingPositionData (mode-tag uses engine mode, not creds.mode)', () => {
  const params = {
    symbol: 'BTCUSDT', side: 'LONG', qty: 0.062, entryType: 'MARKET',
    sl: { price: '62000' }, tp: { price: '67000' }, leverage: 5,
    decisionKey: 'SAT_1_abc', source: 'serverAT', mode: 'live',
  };
  const creds = { mode: 'testnet' };

  test('is a function (exported)', () => {
    expect(typeof _buildPendingPositionData).toBe('function');
  });

  test("engine mode='live' from params WINS over creds.mode='testnet'", () => {
    expect(_buildPendingPositionData(params, creds).mode).toBe('live');
  });

  test('falls back to creds.mode when params.mode is absent (backward-compat)', () => {
    const { mode: _omit, ...noMode } = params;
    expect(_buildPendingPositionData(noMode, creds).mode).toBe('testnet');
  });

  test('preserves the order fields (symbol/side/qty/sl/tp/leverage/decisionKey/source)', () => {
    const d = _buildPendingPositionData(params, creds);
    expect(d.symbol).toBe('BTCUSDT');
    expect(d.side).toBe('LONG');
    expect(d.qty).toBe(0.062);
    expect(d.entryType).toBe('MARKET');
    expect(d.sl).toBe('62000');
    expect(d.tp).toBe('67000');
    expect(d.leverage).toBe(5);
    expect(d.decisionKey).toBe('SAT_1_abc');
    expect(d.source).toBe('serverAT');
  });

  test('null sl/tp objects → falsy price (no throw, matches legacy behavior)', () => {
    const d = _buildPendingPositionData({ ...params, sl: null, tp: null }, creds);
    expect(d.sl).toBeFalsy();
    expect(d.tp).toBeFalsy();
  });
});
