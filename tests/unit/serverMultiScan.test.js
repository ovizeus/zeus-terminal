// [SERVER-MULTISCAN 2026-06-12] FAZA 1 — pure per-symbol scan scoring,
// an UNWEIGHTED mirror of the client calcSymbolScore (client/src/data/klines.ts:139).
// PERF weighting is intentionally omitted (client-specific learned state that cannot
// transfer faithfully); weight=1.0 == the client's behavior before PERF establishes.
const brain = require('../../server/services/serverBrain');
const scan = brain.__sp1.calcSymbolScanScore;

describe('server _calcSymbolScanScore (unweighted mirror of client calcSymbolScore)', () => {
  test('strong bull: RSI OS + MACD↑ + ST↑ + ADX>30 → dir bull, high score', () => {
    // bull = 20(rsi<35) + 20(macd) + 25(st) + 10(adx>30) = 75; bear = 10(adx>30); total 85
    // score = min(98, round(50 + 75/85*50)) = 94
    const r = scan({ rsi: 30, macdDir: 'bull', stDir: 'bull', adx: 35 });
    expect(r.dir).toBe('bull');
    expect(r.score).toBe(94);
  });

  test('strong bear: RSI OB + MACD↓ + ST↓ + ADX>30 → dir bear, high score', () => {
    const r = scan({ rsi: 70, macdDir: 'bear', stDir: 'bear', adx: 35 });
    expect(r.dir).toBe('bear');
    expect(r.score).toBe(94);
  });

  test('no signals → neutral, score 50', () => {
    const r = scan({ rsi: 50, macdDir: 'neut', stDir: 'neut', adx: null });
    expect(r.dir).toBe('neut');
    expect(r.score).toBe(50);
  });

  test('score clamps at 98 (pure bull, no opposing pts)', () => {
    // bull = 20+20+25 = 65, bear = 0, total 65 → round(50+50)=100 → clamp 98
    const r = scan({ rsi: 30, macdDir: 'bull', stDir: 'bull', adx: null });
    expect(r.dir).toBe('bull');
    expect(r.score).toBe(98);
  });

  test('ADX 20-30 band adds the smaller ±5 (not ±10)', () => {
    // bull = 20(rsi<35) + 5(adx>20); bear = 5(adx>20); total 30
    // score = min(98, round(50 + 25/30*50)) = round(91.67) = 92
    const r = scan({ rsi: 30, macdDir: 'neut', stDir: 'neut', adx: 25 });
    expect(r.dir).toBe('bull');
    expect(r.score).toBe(92);
  });

  test('weak-RSI bands: 45<rsi<55 contributes nothing', () => {
    const r = scan({ rsi: 50, macdDir: 'bull', stDir: 'neut', adx: null });
    // only MACD bull = 20; total 20 → round(50+50)=100 → clamp 98
    expect(r.dir).toBe('bull');
    expect(r.score).toBe(98);
  });

  test('null/undefined inputs are safe → neutral 50', () => {
    const r = scan({});
    expect(r.dir).toBe('neut');
    expect(r.score).toBe(50);
  });
});
