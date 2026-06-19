const { _cappedPnl } = require('../../../../server/services/dslRrSim');

// notional = margin*lev = 100*10 = 1000. A 1% adverse cut loses 1% * 1000 = 10.
const longTrade = { side: 'LONG', entry: 100, minPrice: 97, maxPrice: 105, closePnl: 40, margin: 100, lev: 10 };
const longLoser = { side: 'LONG', entry: 100, minPrice: 95, maxPrice: 101, closePnl: -46, margin: 100, lev: 10 };
const shortTrade = { side: 'SHORT', entry: 100, minPrice: 96, maxPrice: 102, closePnl: 30, margin: 100, lev: 10 };

describe('_cappedPnl', () => {
  it('caps a loser that breached the cut at -cutPct*notional', () => {
    expect(_cappedPnl(longLoser, 0.02)).toBe(-20);
  });
  it('cuts a WINNER that dipped past the cut (give-back) into a capped loss', () => {
    expect(_cappedPnl(longTrade, 0.02)).toBe(-20);
  });
  it('leaves a trade UNCHANGED if it never reached the cut level', () => {
    expect(_cappedPnl(longTrade, 0.05)).toBe(40);
    expect(_cappedPnl(longLoser, 0.08)).toBe(-46);
  });
  it('handles SHORT adverse excursion (maxPrice side)', () => {
    expect(_cappedPnl(shortTrade, 0.02)).toBe(-20);
    expect(_cappedPnl(shortTrade, 0.03)).toBe(30);
  });
  it('returns null when required fields are missing (skip in aggregation)', () => {
    expect(_cappedPnl({ side: 'LONG', entry: 100, closePnl: -10 }, 0.02)).toBeNull();
  });
});

const { _rrStats } = require('../../../../server/services/dslRrSim');

describe('_rrStats', () => {
  it('computes WR, avgWin, avgLoss, RR, expectancy', () => {
    const s = _rrStats([10, 20, -30, -10]);
    expect(s.n).toBe(4);
    expect(s.wr).toBeCloseTo(0.5, 5);
    expect(s.avgWin).toBeCloseTo(15, 5);
    expect(s.avgLoss).toBeCloseTo(-20, 5);
    expect(s.rr).toBeCloseTo(0.75, 5);
    expect(s.expectancy).toBeCloseTo(-2.5, 5);
  });
  it('handles empty / all-win / all-loss safely', () => {
    expect(_rrStats([]).n).toBe(0);
    expect(_rrStats([5, 5]).avgLoss).toBe(0);
    expect(_rrStats([-5]).avgWin).toBe(0);
    expect(_rrStats([-5]).rr).toBe(0);
  });
});

const { _recovering, _shouldEarlyExit } = require('../../../../server/services/dslRrSim');

describe('_recovering', () => {
  it('LONG recovers when price bounces off the low beyond eps', () => {
    expect(_recovering(100.6, 100, 'LONG', 0.005)).toBe(true);
    expect(_recovering(100.4, 100, 'LONG', 0.005)).toBe(false);
  });
  it('SHORT recovers when price drops off the high beyond eps', () => {
    expect(_recovering(99.4, 100, 'SHORT', 0.005)).toBe(true);
    expect(_recovering(99.6, 100, 'SHORT', 0.005)).toBe(false);
  });
});

describe('_shouldEarlyExit', () => {
  it('cuts when adverse past threshold AND not recovering', () => {
    expect(_shouldEarlyExit({ adversePct: 0.012, recovering: false, threshold: 0.01 })).toBe(true);
  });
  it('holds when adverse but recovering (spare the dip-then-recover winner)', () => {
    expect(_shouldEarlyExit({ adversePct: 0.012, recovering: true, threshold: 0.01 })).toBe(false);
  });
  it('holds when not yet adverse', () => {
    expect(_shouldEarlyExit({ adversePct: 0.005, recovering: false, threshold: 0.01 })).toBe(false);
  });
});
