'use strict';

// [AUDIT-20260619 P1-3] DSL Phase-1 activation assigned currentSL = pivotLeft
// unconditionally. _safePrice only substitutes originalSL when pivotLeft is
// non-finite — it does NOT clamp a valid-but-looser pivotLeft. With a wide preset
// (pivotLeftPct 1.30) + a tighter user stop, activation moved the stop AWAY from
// price (LONG: below originalSL; SHORT: above). The stop must never loosen.

jest.mock('../../server/services/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../server/services/audit', () => ({ record: jest.fn() }));

const dsl = require('../../server/services/serverDSL');

const WIDE = { openDslPct: 1.0, pivotLeftPct: 1.30, pivotRightPct: 0.5, impulseVPct: 0.5 };

describe('[P1-3] DSL activation never loosens the stop below originalSL', () => {
  afterEach(() => { dsl.detach(7001); dsl.detach(7002); });

  test('LONG: tight user stop is preserved (currentSL >= originalSL)', () => {
    // entry 60000, tight SL 59900. activation @ 60600; raw pivotLeft = 60600*0.987 = 59812 < 59900.
    dsl.attach({ seq: 7001, userId: 1, symbol: 'BTCUSDT', side: 'LONG', price: 60000, sl: 59900, tp: 62000 }, WIDE);
    const out = dsl.tick(7001, 60600); // hits activationPrice
    const st = dsl.getState(7001);
    expect(st.active).toBe(true);
    expect(st.currentSL).toBeGreaterThanOrEqual(59900); // floored to originalSL, not loosened to ~59812
    expect(out.currentSL).toBeGreaterThanOrEqual(59900);
  });

  test('SHORT: tight user stop is preserved (currentSL <= originalSL)', () => {
    // entry 60000, tight SL 60100. activation @ 59400; raw pivotLeft = 59400*1.013 = 60172 > 60100.
    dsl.attach({ seq: 7002, userId: 1, symbol: 'BTCUSDT', side: 'SHORT', price: 60000, sl: 60100, tp: 58000 }, WIDE);
    dsl.tick(7002, 59400);
    const st = dsl.getState(7002);
    expect(st.active).toBe(true);
    expect(st.currentSL).toBeLessThanOrEqual(60100); // floored to originalSL, not loosened to ~60172
  });

  test('wide user stop: pivotLeft (tighter) is kept as-is (no over-clamp)', () => {
    // entry 60000, WIDE user SL 58000. pivotLeft ~59812 is tighter than 58000 → keep pivotLeft.
    dsl.attach({ seq: 7001, userId: 1, symbol: 'BTCUSDT', side: 'LONG', price: 60000, sl: 58000, tp: 62000 }, WIDE);
    dsl.tick(7001, 60600);
    const st = dsl.getState(7001);
    expect(st.currentSL).toBeGreaterThan(58000);   // moved up (tightened) from the loose user stop
    expect(st.currentSL).toBeLessThan(60600);       // still below price
  });
});
