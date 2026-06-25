'use strict';
// [ML-DSL-FULL Phase 1] serverDSL.attachActive — DSL active from ENTRY with an ML loss-cap.
// Unlike attach() (profit-gated: DSL only activates after price moves openDslPct% in profit),
// attachActive() arms the stop immediately so a loser is cut at the ML cap instead of bleeding
// to the wide hard SL. The exchange hard SL is never loosened (it stays as the catastrophe net).
const dsl = require('../../../../server/services/serverDSL');

function pos(over) {
  return {
    seq: over.seq, side: over.side || 'LONG', price: over.price, sl: over.sl, tp: over.tp || over.price * 1.1,
    userId: 1, symbol: 'BTCUSDT', exchange: null,
  };
}

describe('serverDSL.attachActive (active-from-entry ML loss-cap)', () => {
  afterEach(() => { for (const id of [101, 102, 103, 104, 105]) { try { dsl.detach(id); } catch (_) { /* */ } } });

  test('attaches ACTIVE immediately — no profit gate', () => {
    const s = dsl.attachActive(pos({ seq: 101, price: 100, sl: 95 }), null, 2.0);
    expect(s.active).toBe(true);
    expect(s.currentSL).toBe(s.pivotLeft);
  });

  test('LONG: the ML cap sets the stop TIGHTER than the wide hard SL', () => {
    // entry 100, hard SL 95 (5% away), ML cap 2% → stop at 98 (tighter than 95)
    const s = dsl.attachActive(pos({ seq: 102, side: 'LONG', price: 100, sl: 95 }), null, 2.0);
    expect(s.pivotLeft).toBeCloseTo(98, 5);
  });

  test('never looser than the hard SL: a tighter hard SL is kept', () => {
    // entry 100, hard SL 99 (1% away, already tighter than the 2% cap) → keep 99
    const s = dsl.attachActive(pos({ seq: 103, side: 'LONG', price: 100, sl: 99 }), null, 2.0);
    expect(s.pivotLeft).toBeCloseTo(99, 5);
  });

  test('SHORT mirrors: stop ABOVE entry, tighter than the wide hard SL', () => {
    // entry 100, hard SL 105 (5% away), ML cap 2% → stop at 102
    const s = dsl.attachActive(pos({ seq: 104, side: 'SHORT', price: 100, sl: 105 }), null, 2.0);
    expect(s.pivotLeft).toBeCloseTo(102, 5);
  });

  test('an adverse move to the ML cap triggers a managed exit BEFORE the hard SL', () => {
    dsl.attachActive(pos({ seq: 105, side: 'LONG', price: 100, sl: 95 }), null, 2.0); // ML stop 98, hard SL 95
    const r = dsl.tick(105, 97.9); // below the 98 cap, still above the 95 hard SL
    expect(r.plExit).toBe(true);
  });
});
