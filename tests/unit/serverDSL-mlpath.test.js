// Zeus Terminal — TDD for serverDSL.simulateMlPath
// The FAITHFUL counterfactual of the ML actually driving the DSL in real-time:
// replays the exact activation→pivot→impulse state machine of serverDSL.simulate(),
// but reads the ML-proposed pivot widths PER-TICK from the recorded trace and honours
// the ML action (EXIT closes now; TIGHTEN ratchets pivotLeft toward price to lock
// profit; LOOSEN/HOLD/BREATHER just use the proposed — typically wider — widths).
//
// This is the measurement the operator asked for ("vreau masuratoare reala"): we feed
// the REAL sequence of ML proposals the policy emitted live and see what PnL it would
// have produced vs the static baseline preset. The same function later drives Phase-2
// live control, so its mechanics must mirror serverDSL.simulate() exactly.
'use strict';
const serverDSL = require('../../server/services/serverDSL');

// Build a sample stream: prices[] with a single constant ml proposal on every tick.
function withMl(prices, ml) {
  return prices.map((p, i) => ({ p, ts: 1000 + i * 250, ml: ml || null }));
}

describe('serverDSL.simulateMlPath', () => {
  test('exports the function', () => {
    expect(typeof serverDSL.simulateMlPath).toBe('function');
  });

  test('PARITY: constant ML widths == a preset reproduce simulate() exactly', () => {
    // LONG, entry 100, SL 98, def activation (0.60%). ml widths == def preset.
    const def = serverDSL.getPreset('def');
    const prices = [100, 100.6, 101.2, 101.8, 101.0, 100.5, 99.9];
    const meta = { side: 'LONG', entry: 100, originalSL: 98, openDslPct: def.openDslPct, fallbackParams: def };
    const ml = { plPct: def.pivotLeftPct, prPct: def.pivotRightPct, ivPct: def.impulseVPct, action: 'HOLD' };

    const base = serverDSL.simulate(def, { side: 'LONG', entry: 100, originalSL: 98 }, prices);
    const mlRes = serverDSL.simulateMlPath(meta, withMl(prices, ml));

    expect(mlRes.exitReason).toBe(base.exitReason);
    expect(mlRes.exitPrice).toBeCloseTo(base.exitPrice, 6);
    expect(mlRes.pnlPct).toBeCloseTo(base.pnlPct, 6);
  });

  test('EXIT action closes immediately at that tick price', () => {
    const def = serverDSL.getPreset('def');
    const meta = { side: 'LONG', entry: 100, originalSL: 98, openDslPct: def.openDslPct, fallbackParams: def };
    const samples = [
      { p: 100, ts: 1000, ml: { plPct: 0.8, prPct: 0.7, ivPct: 0.3, action: 'HOLD' } },
      { p: 100.3, ts: 1250, ml: { plPct: 0.8, prPct: 0.7, ivPct: 0.3, action: 'EXIT' } },
      { p: 105, ts: 1500, ml: { plPct: 0.8, prPct: 0.7, ivPct: 0.3, action: 'HOLD' } }, // never reached
    ];
    const res = serverDSL.simulateMlPath(meta, samples);
    expect(res.exitReason).toBe('ML_EXIT');
    expect(res.exitPrice).toBeCloseTo(100.3, 6);
    expect(res.pnlPct).toBeCloseTo(0.3, 6); // (100.3-100)/100*100
  });

  test('SHORT EXIT closes now, pnl signed for short', () => {
    const def = serverDSL.getPreset('def');
    const meta = { side: 'SHORT', entry: 100, originalSL: 102, openDslPct: def.openDslPct, fallbackParams: def };
    const samples = [
      { p: 100, ts: 1000, ml: { plPct: 0.8, prPct: 0.7, ivPct: 0.3, action: 'HOLD' } },
      { p: 99.5, ts: 1250, ml: { plPct: 0.8, prPct: 0.7, ivPct: 0.3, action: 'EXIT' } },
    ];
    const res = serverDSL.simulateMlPath(meta, samples);
    expect(res.exitReason).toBe('ML_EXIT');
    expect(res.pnlPct).toBeCloseTo(0.5, 6); // (100-99.5)/100*100 for a short
  });

  test('TIGHTEN ratchets pivotLeft toward price and locks profit on a dip', () => {
    // LONG entry 100, SL 98, def activation 100.6. Rises to 101.5 where ML says TIGHTEN
    // (plPct 0.5) → PL jumps to 101.5*(1-0.005)=100.9925. A dip to 100.9 then hits PL.
    const def = serverDSL.getPreset('def');
    const meta = { side: 'LONG', entry: 100, originalSL: 98, openDslPct: def.openDslPct, fallbackParams: def };
    const tighten = { plPct: 0.5, prPct: 0.7, ivPct: 0.3, action: 'TIGHTEN' };
    const hold = { plPct: 0.8, prPct: 0.7, ivPct: 0.3, action: 'HOLD' };
    const samples = [
      { p: 100.0, ts: 1000, ml: hold },
      { p: 100.6, ts: 1250, ml: hold },     // activate (PL floored ~99.80)
      { p: 101.5, ts: 1500, ml: tighten },  // TIGHTEN → PL ~100.99
      { p: 100.9, ts: 1750, ml: hold },     // dip hits the tightened PL
      { p: 102.0, ts: 2000, ml: hold },     // never reached
    ];
    const res = serverDSL.simulateMlPath(meta, samples);
    expect(res.exitReason).toBe('DSL_PL');
    expect(res.exitPrice).toBeCloseTo(100.9925, 3);
    expect(res.pnlPct).toBeGreaterThan(0.9); // locked ~+0.99%

    // Without TIGHTEN (HOLD throughout), PL stays ~99.80 → the 100.9 dip does NOT exit;
    // path ends at 102 → bigger pnl. Proves TIGHTEN actively locked profit early.
    const holdRes = serverDSL.simulateMlPath(meta, samples.map(s => ({ ...s, ml: hold })));
    expect(holdRes.exitPrice).not.toBeCloseTo(100.9925, 3);
  });

  test('LOOSEN keeps a wide trail so a strong run is not cut short', () => {
    // Strong uptrend then a shallow pullback. A tight 'fast' preset ratchets PL up fast
    // and gets stopped on the pullback; LOOSEN (wide widths) rides further.
    const meta = { side: 'LONG', entry: 100, originalSL: 98, openDslPct: 0.35, fallbackParams: serverDSL.getPreset('fast') };
    const prices = [100, 100.4, 101, 102, 103, 104, 103.4]; // climb then shallow dip
    const loose = { plPct: 1.3, prPct: 1.1, ivPct: 0.4, action: 'LOOSEN' };

    const looseRes = serverDSL.simulateMlPath(meta, withMl(prices, loose));
    const fastRes = serverDSL.simulate(serverDSL.getPreset('fast'), { side: 'LONG', entry: 100, originalSL: 98 }, prices);

    expect(looseRes.pnlPct).toBeGreaterThanOrEqual(fastRes.pnlPct);
  });

  test('pre-activation SL hit exits at the original stop', () => {
    const def = serverDSL.getPreset('def');
    const meta = { side: 'LONG', entry: 100, originalSL: 98, openDslPct: def.openDslPct, fallbackParams: def };
    const prices = [100, 99.5, 98, 97]; // never activates; SL at 98
    const res = serverDSL.simulateMlPath(meta, withMl(prices, { plPct: 0.8, prPct: 0.7, ivPct: 0.3, action: 'HOLD' }));
    expect(res.exitReason).toBe('SL');
    expect(res.exitPrice).toBeCloseTo(98, 6);
    expect(res.pnlPct).toBeCloseTo(-2, 6);
  });

  test('samples without ml fall back to the preset params', () => {
    const def = serverDSL.getPreset('def');
    const meta = { side: 'LONG', entry: 100, originalSL: 98, openDslPct: def.openDslPct, fallbackParams: def };
    const prices = [100, 100.6, 101.2, 101.8, 101.0, 100.5, 99.9];
    const base = serverDSL.simulate(def, { side: 'LONG', entry: 100, originalSL: 98 }, prices);
    const res = serverDSL.simulateMlPath(meta, prices.map((p, i) => ({ p, ts: 1000 + i * 250, ml: null })));
    expect(res.exitReason).toBe(base.exitReason);
    expect(res.pnlPct).toBeCloseTo(base.pnlPct, 6);
  });

  test('empty / invalid trace is safe', () => {
    const def = serverDSL.getPreset('def');
    const meta = { side: 'LONG', entry: 100, originalSL: 98, openDslPct: def.openDslPct, fallbackParams: def };
    expect(serverDSL.simulateMlPath(meta, []).exitReason).toBe('NONE');
    expect(serverDSL.simulateMlPath(meta, null).exitReason).toBe('NONE');
    expect(serverDSL.simulateMlPath({ side: 'LONG', entry: 0 }, [{ p: 100, ts: 1 }]).pnlPct).toBe(0);
  });
});
