'use strict';
// TDD for the indicator-usage aggregation (admin/picker badge "how many users use this").
// Robust server-persist: counts ALL users who reported a config (no liveness expiry) and
// every indicator id the client can send (the server id set must mirror the full client list).
const indRoute = require('../../server/routes/indicators');
const { INDICATOR_IDS } = require('../../server/services/indicatorIds');
const { _aggregateUsage } = indRoute;

describe('indicator usage aggregation (robust, server-persist)', () => {
  const now = 2_000_000_000_000;

  test('counts distinct users per indicator', () => {
    const rows = [
      { user_id: 1, indicator_id: 'rsi14', updated_at: now },
      { user_id: 2, indicator_id: 'rsi14', updated_at: now },
      { user_id: 2, indicator_id: 'macd', updated_at: now },
    ];
    const u = _aggregateUsage(rows, now, INDICATOR_IDS);
    expect(u.rsi14).toBe(2);
    expect(u.macd).toBe(1);
  });

  test('NO liveness expiry — a config reported long ago still counts', () => {
    const rows = [{ user_id: 5, indicator_id: 'ema', updated_at: now - 400 * 86400000 }]; // >1 year old
    const u = _aggregateUsage(rows, now, INDICATOR_IDS);
    expect(u.ema).toBe(1);
  });

  test('the server id set mirrors the full client list (88), incl. previously-dropped ids', () => {
    // ids that used to be missing from the 41-id server set must now be known + countable
    for (const id of ['phoenix', 'rsi14', 'cvd', 'ichimoku', 'aurora', 'daimon', 'vwap']) {
      expect(INDICATOR_IDS.has(id)).toBe(true);
    }
    expect(INDICATOR_IDS.size).toBeGreaterThanOrEqual(88);
    const rows = [{ user_id: 1, indicator_id: 'phoenix', updated_at: now }];
    expect(_aggregateUsage(rows, now, INDICATOR_IDS).phoenix).toBe(1);
  });

  test('unknown ids are still ignored (validation preserved)', () => {
    const rows = [{ user_id: 1, indicator_id: 'definitely_not_an_indicator', updated_at: now }];
    expect(_aggregateUsage(rows, now, INDICATOR_IDS)).toEqual({});
  });
});
