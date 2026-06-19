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

  // [AUDIT-20260619 P2] pivotLeft must NOT trail continuously (the old bug) — it
  // only ratchets at a discrete impulse trigger, like the real tick(). Here the
  // impulse never fires (IV% high vs the small run-up), so pivotLeft stays at its
  // activation level. A retrace to 101.4 does NOT hit it → exit END @101.4. The old
  // continuous-trail would have ratcheted pivotLeft to ~101.69 at price 102 and
  // exited DSL_PL on the retrace — a tighter, unrealistic baseline.
  test('pivotLeft does not trail continuously — no impulse → holds, exits END not a high DSL_PL', () => {
    const prices = [100, 100.7, 101.5, 102, 101.4];
    const r = serverDSL.simulate({ openDslPct: 0.6, pivotLeftPct: 0.3, pivotRightPct: 0.7, impulseVPct: 3.0 }, meta, prices);
    expect(r.exitReason).toBe('END');
    expect(r.exitPrice).toBeCloseTo(101.4, 5);
  });
});
