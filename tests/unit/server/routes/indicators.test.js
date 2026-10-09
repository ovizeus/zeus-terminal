const { _aggregateUsage } = require('../../../../server/routes/indicators');

const NOW = 1_000_000_000_000;
const DAY = 86400000;
const known = new Set(['ema', 'rsi', 'macd']);

describe('_aggregateUsage', () => {
  it('counts DISTINCT live users per indicator', () => {
    const rows = [
      { user_id: 1, indicator_id: 'ema', updated_at: NOW - DAY },
      { user_id: 2, indicator_id: 'ema', updated_at: NOW - 2 * DAY },
      { user_id: 1, indicator_id: 'rsi', updated_at: NOW - DAY },
    ];
    const r = _aggregateUsage(rows, NOW, known);
    expect(r.ema).toBe(2);
    expect(r.rsi).toBe(1);
    expect(r.macd).toBeUndefined();
  });
  // [2026-10-09] This used to assert a 30-day liveness window. b167 (4d35cc2a)
  // deliberately removed it: a row is the user's PERSISTED config, rewritten on
  // every POST /active, not an online heartbeat, so the badge should mirror
  // everyone who has the indicator configured however long ago they were seen.
  // This test was left behind describing the old behaviour, and tests/unit/
  // indicatorsRoute.test.js asserts the opposite — the contradiction is what
  // made a wrong "fix" look right for a moment. Kept, inverted, with the reason.
  it('does NOT expire old rows — a config stored long ago still counts', () => {
    const rows = [{ user_id: 1, indicator_id: 'ema', updated_at: NOW - 400 * DAY }];
    expect(_aggregateUsage(rows, NOW, known).ema).toBe(1);
  });
  it('ignores unknown indicator ids', () => {
    const rows = [{ user_id: 1, indicator_id: 'totally_fake', updated_at: NOW }];
    expect(_aggregateUsage(rows, NOW, known).totally_fake).toBeUndefined();
  });
});
