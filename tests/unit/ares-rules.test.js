'use strict';
// [SERVER-ARES 2026-06-07] Pure decision/sizing rules — ported 1:1 in spirit
// from client engine/aresDecision.ts + aresExecute.ts, with SERVER inputs
// (regime taxonomy TREND/TREND_UP/TREND_DOWN/BREAKOUT/RANGE/SQUEEZE/VOLATILE,
// entryScore = server confluence score, side from trendBias).
const { evaluateAres, aresSizing, computeAresConfidence, computeAresEngineState } = require('../../server/services/aresRules');

// A context where EVERY gate passes — each test flips ONE thing.
const NOW = 1780850000000;
const GO = {
  now: NOW,
  balance: 655, available: 655,
  openAresCount: 0,
  killActive: false,
  lastTradeTs: 0,
  regime: 'TREND', regimeConf: 70,
  sessionHourUtc: 14,            // NEW YORK window
  stateId: 'DETERMINED',
  consecutiveLoss: 0, lastLossTs: 0, winRate10: 60,
  entryScore: 62,
  confidence: 72,
  trendBias: 'bullish',
  atrPct: 1.2,
};
const ctx = (o) => Object.assign({}, GO, o);

describe('evaluateAres — gate matrix (each gate blocks alone)', () => {
  test('all green → shouldTrade LONG', () => {
    const d = evaluateAres(ctx({}));
    expect(d.shouldTrade).toBe(true);
    expect(d.side).toBe('LONG');
  });
  test('bearish bias → SHORT', () => {
    const d = evaluateAres(ctx({ trendBias: 'bearish' }));
    expect(d.shouldTrade).toBe(true);
    expect(d.side).toBe('SHORT');
  });
  test('TREND_DOWN regime forces SHORT even with neutral bias', () => {
    const d = evaluateAres(ctx({ regime: 'TREND_DOWN', trendBias: 'neutral' }));
    expect(d.shouldTrade).toBe(true);
    expect(d.side).toBe('SHORT');
  });
  test('TREND_UP regime forces LONG even with neutral bias', () => {
    const d = evaluateAres(ctx({ regime: 'TREND_UP', trendBias: 'neutral' }));
    expect(d.side).toBe('LONG');
  });
  test('wallet under $5 → blocked', () => {
    expect(evaluateAres(ctx({ balance: 4.5 })).shouldTrade).toBe(false);
  });
  test('no available funds → blocked', () => {
    expect(evaluateAres(ctx({ available: 0 })).shouldTrade).toBe(false);
  });
  test('already 1 open ARES position → blocked (MAX_OPEN=1)', () => {
    expect(evaluateAres(ctx({ openAresCount: 1 })).shouldTrade).toBe(false);
  });
  test('kill switch active → blocked', () => {
    expect(evaluateAres(ctx({ killActive: true })).shouldTrade).toBe(false);
  });
  test('cooldown 5min after last trade → blocked, expires after', () => {
    expect(evaluateAres(ctx({ lastTradeTs: NOW - 4 * 60000 })).shouldTrade).toBe(false);
    expect(evaluateAres(ctx({ lastTradeTs: NOW - 6 * 60000 })).shouldTrade).toBe(true);
  });
  test('RANGE / VOLATILE / SQUEEZE regimes → blocked', () => {
    for (const r of ['RANGE', 'VOLATILE', 'SQUEEZE', 'UNKNOWN']) {
      expect(evaluateAres(ctx({ regime: r })).shouldTrade).toBe(false);
    }
  });
  test('BREAKOUT regime tradeable', () => {
    expect(evaluateAres(ctx({ regime: 'BREAKOUT' })).shouldTrade).toBe(true);
  });
  test('session outside LONDON/NY → blocked (ASIA 03h, OFF 23h)', () => {
    expect(evaluateAres(ctx({ sessionHourUtc: 3 })).shouldTrade).toBe(false);
    expect(evaluateAres(ctx({ sessionHourUtc: 23 })).shouldTrade).toBe(false);
    expect(evaluateAres(ctx({ sessionHourUtc: 9 })).shouldTrade).toBe(true);  // LONDON
  });
  test('DEFENSIVE / REVENGE_GUARD state → blocked', () => {
    expect(evaluateAres(ctx({ stateId: 'DEFENSIVE' })).shouldTrade).toBe(false);
    expect(evaluateAres(ctx({ stateId: 'REVENGE_GUARD' })).shouldTrade).toBe(false);
  });
  test('3 losses + within 10min revenge window → blocked, after window → allowed', () => {
    expect(evaluateAres(ctx({ consecutiveLoss: 3, lastLossTs: NOW - 5 * 60000 })).shouldTrade).toBe(false);
    expect(evaluateAres(ctx({ consecutiveLoss: 3, lastLossTs: NOW - 11 * 60000 })).shouldTrade).toBe(true);
  });
  test('entryScore < 55 → blocked', () => {
    expect(evaluateAres(ctx({ entryScore: 54 })).shouldTrade).toBe(false);
  });
  test('confidence < 68 → blocked', () => {
    expect(evaluateAres(ctx({ confidence: 67 })).shouldTrade).toBe(false);
  });
  test('neutral bias in plain TREND → blocked (no direction)', () => {
    expect(evaluateAres(ctx({ trendBias: 'neutral' })).shouldTrade).toBe(false);
  });
  test('extreme volatility ATR > 3% → blocked', () => {
    expect(evaluateAres(ctx({ atrPct: 3.5 })).shouldTrade).toBe(false);
  });
  test('blocked decisions carry reasons', () => {
    const d = evaluateAres(ctx({ balance: 1 }));
    expect(Array.isArray(d.reasons)).toBe(true);
    expect(d.reasons.length).toBeGreaterThan(0);
  });
});

describe('aresSizing — stake/leverage port', () => {
  test('mid wallet ($655): stake 12% of balance, capped by available', () => {
    const s = aresSizing({ balance: 655, available: 655, confidence: 72, atrPct: 1.2 });
    expect(s.stake).toBeCloseTo(78.6, 1);    // 655 * 0.12
    expect(s.leverage).toBeGreaterThanOrEqual(5);
    expect(s.leverage).toBeLessThanOrEqual(20);
  });
  test('high confidence adds +3% stake', () => {
    const s = aresSizing({ balance: 1000, available: 1000, confidence: 85, atrPct: 1.2 });
    expect(s.stake).toBeCloseTo(1000 * 0.18, 1); // 0.15 tier + 0.03
  });
  test('extreme vol (volScore≥80 ⇔ atrPct≥2.4) subtracts 5%', () => {
    const s = aresSizing({ balance: 1000, available: 1000, confidence: 72, atrPct: 2.5 });
    expect(s.stake).toBeCloseTo(1000 * 0.10, 1); // 0.15 - 0.05
  });
  test('stake never exceeds available or 25% balance, floor $5', () => {
    const s = aresSizing({ balance: 1000, available: 30, confidence: 72, atrPct: 1.2 });
    expect(s.stake).toBe(30);
    const s2 = aresSizing({ balance: 40, available: 40, confidence: 72, atrPct: 1.2 });
    expect(s2.stake).toBeGreaterThanOrEqual(5);
  });
  test('leverage formula: 10 + 0.5*conf − 2*atrPct, clamped [5,20]', () => {
    expect(aresSizing({ balance: 1000, available: 1000, confidence: 72, atrPct: 1.5 }).leverage).toBe(Math.min(20, Math.max(5, Math.round(10 + 36 - 3))));
    expect(aresSizing({ balance: 1000, available: 1000, confidence: 10, atrPct: 3 }).leverage).toBe(9); // 10+5-6=9
    expect(aresSizing({ balance: 1000, available: 1000, confidence: 99, atrPct: 0.5 }).leverage).toBe(20); // clamp top
  });
  test('slPct = 1.5×ATR, rr = 4/3 (TP 2×ATR vs SL 1.5×ATR)', () => {
    const s = aresSizing({ balance: 1000, available: 1000, confidence: 72, atrPct: 1.2 });
    expect(s.slPct).toBeCloseTo(1.8, 5);
    expect(s.rr).toBeCloseTo(4 / 3, 5);
  });
  test('atrPct missing → default 1.5', () => {
    const s = aresSizing({ balance: 1000, available: 1000, confidence: 72 });
    expect(s.slPct).toBeCloseTo(2.25, 5);
  });
});

describe('computeAresConfidence / computeAresEngineState — ports', () => {
  test('strong trending regime + high score + positive trajectory boosts confidence', () => {
    const hi = computeAresConfidence({ regime: 'TREND', regimeConf: 80, entryScore: 85, trajectoryDelta: 6, winRate10: 70 });
    const lo = computeAresConfidence({ regime: 'RANGE', regimeConf: 30, entryScore: 30, trajectoryDelta: -12, winRate10: 30 });
    expect(hi).toBeGreaterThan(lo);
    expect(hi).toBeLessThanOrEqual(99);
    expect(lo).toBeGreaterThanOrEqual(1);
  });
  test('REVENGE_GUARD on 3 losses within 5min', () => {
    expect(computeAresEngineState({ consecutiveLoss: 3, lastLossTs: NOW - 2 * 60000, now: NOW, trajectoryDelta: 0, consecutiveWin: 0, winRate10: 50, killActive: false }).id).toBe('REVENGE_GUARD');
  });
  test('DEFENSIVE on 4 losses or delta < −15 or kill', () => {
    expect(computeAresEngineState({ consecutiveLoss: 4, lastLossTs: 0, now: NOW, trajectoryDelta: 0, consecutiveWin: 0, winRate10: 50, killActive: false }).id).toBe('DEFENSIVE');
    expect(computeAresEngineState({ consecutiveLoss: 0, lastLossTs: 0, now: NOW, trajectoryDelta: -16, consecutiveWin: 0, winRate10: 50, killActive: false }).id).toBe('DEFENSIVE');
    expect(computeAresEngineState({ consecutiveLoss: 0, lastLossTs: 0, now: NOW, trajectoryDelta: 0, consecutiveWin: 0, winRate10: 50, killActive: true }).id).toBe('DEFENSIVE');
  });
  test('MOMENTUM on 3 wins + wr≥65; DETERMINED default', () => {
    expect(computeAresEngineState({ consecutiveLoss: 0, lastLossTs: 0, now: NOW, trajectoryDelta: 0, consecutiveWin: 3, winRate10: 70, killActive: false }).id).toBe('MOMENTUM');
    expect(computeAresEngineState({ consecutiveLoss: 0, lastLossTs: 0, now: NOW, trajectoryDelta: 0.5, consecutiveWin: 0, winRate10: 55, killActive: false }).id).toBe('DETERMINED');
  });
});

describe('computeAresConfidence — fresh-engine deadlock guard', () => {
  test('winRate10 null (no history) → neutral 50, NOT −15', () => {
    const fresh = computeAresConfidence({ regime: 'TREND_UP', entryScore: 80, trajectoryDelta: 0, winRate10: null });
    const zeroed = computeAresConfidence({ regime: 'TREND_UP', entryScore: 80, trajectoryDelta: 0, winRate10: 0 });
    expect(fresh).toBe(zeroed + 15);
    expect(fresh).toBeGreaterThanOrEqual(68); // a strong setup must be reachable from scratch
  });
});
