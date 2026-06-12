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

// FAZA 2 — global sigDir aggregation + staleness. Mirrors the client:
//   arianova.ts:1425-1442 (best scoring symbol, threshold score>=65)
//   autotrade.ts:603-608 (±0.25 bonus, 120s staleness window).
const pickSigDir = brain.__sp1.computeServerSigDir;
const sigBonus = brain.__sp1.sigDirBonus;

describe('server _computeServerSigDir (best directional symbol, threshold 65)', () => {
  test('picks the highest-scoring directional symbol', () => {
    expect(pickSigDir([{ dir: 'bull', score: 80 }, { dir: 'bear', score: 70 }])).toBe('bull');
    expect(pickSigDir([{ dir: 'bull', score: 66 }, { dir: 'bear', score: 90 }])).toBe('bear');
  });

  test('returns null when no symbol reaches score>=65', () => {
    expect(pickSigDir([{ dir: 'bull', score: 60 }, { dir: 'bear', score: 64 }])).toBe(null);
  });

  test('ignores neut entries even if higher score', () => {
    expect(pickSigDir([{ dir: 'neut', score: 98 }, { dir: 'bull', score: 70 }])).toBe('bull');
  });

  test('empty / nullish list → null', () => {
    expect(pickSigDir([])).toBe(null);
    expect(pickSigDir(null)).toBe(null);
  });
});

describe('server _sigDirBonus (±0.25, 120s staleness)', () => {
  test('fresh bull → +0.25, fresh bear → -0.25', () => {
    expect(sigBonus({ dir: 'bull', ts: 1000 }, 1000)).toBe(0.25);
    expect(sigBonus({ dir: 'bear', ts: 1000 }, 1000)).toBe(-0.25);
  });

  test('stale (>120s old) → 0', () => {
    expect(sigBonus({ dir: 'bull', ts: 1000 }, 1000 + 120001)).toBe(0);
  });

  test('within 120s window still applies', () => {
    expect(sigBonus({ dir: 'bull', ts: 1000 }, 1000 + 119000)).toBe(0.25);
  });

  test('null state → 0', () => {
    expect(sigBonus(null, 5000)).toBe(0);
  });
});
