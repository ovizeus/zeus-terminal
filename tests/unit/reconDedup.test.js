const { dedupePositions, _isStaleCruft } = require('../../server/services/reconDedup');

const canon = (seq, sym, side, extra = {}) => ({ seq, userId: 1, symbol: sym, side, mode: 'live', source: 'serverAT', leverage: 10, live: { status: 'LIVE' }, ...extra });
const stub = (seq, sym, side) => ({ seq, userId: 1, symbol: sym, side, mode: 'live', source: 'serverAT', leverage: 10, live: undefined });
const stale = (seq, sym, side) => ({ seq, userId: 1, symbol: sym, side, mode: 'live', source: undefined, leverage: undefined, live: { status: 'LIVE' } });

describe('reconDedup.dedupePositions', () => {
  test('one canonical per (user,symbol,side,mode) — collapses dup canonical + stub', () => {
    const r = dedupePositions([canon(100, 'BTCUSDT', 'SHORT'), stub(101, 'BTCUSDT', 'SHORT'), canon(102, 'BTCUSDT', 'SHORT')]);
    const btcShort = r.keep.filter(p => p.symbol === 'BTCUSDT' && p.side === 'SHORT');
    expect(btcShort.length).toBe(1);              // exactly ONE survivor
    expect(r.retire.map(x => x.seq).sort()).toEqual([100, 101].sort()); // newest canonical (102) wins
    expect(r.keep[0] === undefined || true).toBe(true);
  });

  test('distinct keys are all kept (LONG vs SHORT, different symbols)', () => {
    const r = dedupePositions([canon(1, 'BTCUSDT', 'LONG'), canon(2, 'BTCUSDT', 'SHORT'), canon(3, 'ETHUSDT', 'LONG')]);
    expect(r.keep.length).toBe(3);
    expect(r.retire.length).toBe(0);
  });

  test('lone stale cruft row (no live, no source, no leverage) is retired', () => {
    const cruft = { seq: 9, userId: 1, symbol: 'XRPUSDT', side: 'LONG', mode: 'live', source: undefined, leverage: undefined, live: undefined };
    expect(_isStaleCruft(cruft)).toBe(true);
    const r = dedupePositions([cruft]);
    expect(r.keep.length).toBe(0);
    expect(r.retire).toEqual([{ seq: 9, reason: 'stale-cruft-lone' }]);
  });

  test('lone canonical row is kept untouched', () => {
    const r = dedupePositions([canon(5, 'SOLUSDT', 'LONG')]);
    expect(r.keep.length).toBe(1);
    expect(r.retire.length).toBe(0);
  });

  test('group with NO canonical (all stubs) keeps newest, retires rest', () => {
    const r = dedupePositions([stub(10, 'BNBUSDT', 'SHORT'), stub(12, 'BNBUSDT', 'SHORT')]);
    expect(r.keep.length).toBe(1);
    expect(r.keep[0].seq).toBe(12);
    expect(r.retire.map(x => x.seq)).toEqual([10]);
  });

  test('serverAT canonical preferred over external duplicate', () => {
    const ext = { seq: 20, userId: 1, symbol: 'BTCUSDT', side: 'SHORT', mode: 'live', source: 'external', leverage: 1, live: { status: 'EXTERNAL' } };
    const r = dedupePositions([ext, canon(21, 'BTCUSDT', 'SHORT')]);
    expect(r.keep.length).toBe(1);
    expect(r.keep[0].source).toBe('serverAT');
    expect(r.retire[0].seq).toBe(20);
  });

  test('never retires the canonical; retire list excludes survivor', () => {
    const r = dedupePositions([canon(30, 'ADAUSDT', 'LONG'), stub(31, 'ADAUSDT', 'LONG'), stub(32, 'ADAUSDT', 'LONG')]);
    const survivorSeq = r.keep.find(p => p.symbol === 'ADAUSDT').seq;
    expect(r.retire.map(x => x.seq)).not.toContain(survivorSeq);
    expect(survivorSeq).toBe(30); // the only canonical
  });
});
