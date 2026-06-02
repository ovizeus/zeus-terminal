'use strict';
const { _buildExternalEntry } = require('../../server/services/serverAT');
describe('_buildExternalEntry (Task 7b — finite PnL inputs + closable)', () => {
  const d = { userId: 5, symbol: 'BTCUSDT', side: 'LONG', entryPrice: '67000', qty: '0.01', exchange: 'binance' };
  const e = _buildExternalEntry(d, 42, 65660);
  test('has price (for PnL math), not just entry', () => { expect(e.price).toBeCloseTo(67000, 6); });
  test('lev and size set → PnL math finite', () => {
    const pnl = (68000 - e.price) / e.price * e.size * e.lev;
    expect(Number.isFinite(pnl)).toBe(true);
    expect(pnl).toBeCloseTo((68000 - 67000) * 0.01, 4); // = (exit-entry)*qty = 10
  });
  test('live.executedQty set (so _handleLiveExit can size the close)', () => { expect(e.live.executedQty).toBeCloseTo(0.01, 8); });
  test('protective sl + originalSL set', () => { expect(e.sl).toBe(65660); expect(e.originalSL).toBe(65660); });
  test('status EXTERNAL', () => { expect(e.live.status).toBe('EXTERNAL'); });
});
