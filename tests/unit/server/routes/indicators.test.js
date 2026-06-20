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
  it('excludes rows older than 30 days (not live)', () => {
    const rows = [{ user_id: 1, indicator_id: 'ema', updated_at: NOW - 31 * DAY }];
    expect(_aggregateUsage(rows, NOW, known).ema).toBeUndefined();
  });
  it('ignores unknown indicator ids', () => {
    const rows = [{ user_id: 1, indicator_id: 'totally_fake', updated_at: NOW }];
    expect(_aggregateUsage(rows, NOW, known).totally_fake).toBeUndefined();
  });
});
