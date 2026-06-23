// Zeus Terminal — TDD for real fill-commission capture (admin leaderboard, Task 7).
// Pure pieces only: parseOrderUpdate must surface the Binance commission field (o.n),
// and serverAT._fillCommission must turn a parsed fill into a safe absolute number.
// The accumulation/persist wiring is additive + fail-safe in the live handler (verified
// by syntax-check + serverAT regression, not unit-tested here).
'use strict';

describe('parseOrderUpdate commission extraction', () => {
  const uds = require('../../server/services/userDataStream');
  test('extracts commission from o.n', () => {
    const ev = { e: 'ORDER_TRADE_UPDATE', E: 1, o: { s: 'BTCUSDT', S: 'BUY', o: 'MARKET', x: 'TRADE', X: 'FILLED', i: 1, c: 'x', p: '0', ap: '100', q: '1', z: '1', rp: '0', R: false, T: 1, n: '0.04', N: 'USDT' } };
    const p = uds.parseOrderUpdate(ev);
    expect(p.commission).toBeCloseTo(0.04, 8);
  });
  test('commission defaults to 0 when absent', () => {
    const ev = { e: 'ORDER_TRADE_UPDATE', E: 1, o: { s: 'BTCUSDT', S: 'BUY', x: 'TRADE', X: 'FILLED', i: 1, ap: '100', z: '1' } };
    expect(uds.parseOrderUpdate(ev).commission).toBe(0);
  });
});

describe('serverAT._fillCommission', () => {
  const serverAT = require('../../server/services/serverAT');
  test('returns absolute commission from a parsed fill', () => {
    expect(serverAT._fillCommission({ commission: 0.04 })).toBeCloseTo(0.04, 8);
    expect(serverAT._fillCommission({ commission: -0.04 })).toBeCloseTo(0.04, 8);
  });
  test('safe on junk / missing', () => {
    expect(serverAT._fillCommission({})).toBe(0);
    expect(serverAT._fillCommission(null)).toBe(0);
    expect(serverAT._fillCommission({ commission: 'x' })).toBe(0);
  });
});
