const serverDSL = require('../../server/services/serverDSL');
describe('serverDSL.simulate (pure counterfactual)', () => {
  const meta = { side: 'LONG', entry: 100, originalSL: 98 };
  test('a winner that runs then retraces exits on the trailed PL, capturing most of the move', () => {
    const prices = [100, 101, 102, 103, 104, 105, 106, 105, 104, 103];
    const r = serverDSL.simulate({ openDslPct: 0.6, pivotLeftPct: 0.8, pivotRightPct: 0.7, impulseVPct: 0.3 }, meta, prices);
    expect(['DSL_PL', 'END']).toContain(r.exitReason);
    expect(r.pnlPct).toBeGreaterThan(2);
    expect(Number.isFinite(r.exitPrice)).toBe(true);
  });
  test('a loser hits originalSL', () => {
    const prices = [100, 99.5, 99, 98.5, 98, 97];
    const r = serverDSL.simulate({ openDslPct: 0.6, pivotLeftPct: 0.8, pivotRightPct: 0.7, impulseVPct: 0.3 }, meta, prices);
    expect(r.exitReason).toBe('SL');
    expect(r.pnlPct).toBeLessThan(0);
  });
  test('no path / empty prices → flat, no throw', () => {
    const r = serverDSL.simulate({ openDslPct: 0.6, pivotLeftPct: 0.8, pivotRightPct: 0.7, impulseVPct: 0.3 }, meta, []);
    expect(r.pnlPct).toBe(0);
  });
});
