import { describe, it, expect } from 'vitest'
import { dirFactorLive, confNDirectional, classifyEntryTier, lsRatioToSplit, oiWindowDeltaPct, klineTfChangePct } from '../fusionMath'

// Lever B — confluence denominator must count only LIVE directional feeds.
// Bug: a dead feed ('neut', e.g. LS from the broken sentiment endpoint) was
// counted in the denominator (always /5), dragging the score down so confluence
// could never exceed ~50 even when every live feed agreed.
describe('dirFactorLive (Lever B — exclude dead feeds from denominator)', () => {
  it('all 5 feeds bull → 1.0', () => {
    expect(dirFactorLive(['bull', 'bull', 'bull', 'bull', 'bull'])).toBe(1)
  })

  it('4 live feeds all bull + 1 neut → 1.0 (dead feed must NOT drag score down)', () => {
    // OLD broken behaviour: 4/5 = 0.8. FIXED: 4/4 = 1.0
    expect(dirFactorLive(['bull', 'bull', 'bull', 'bull', 'neut'])).toBe(1)
  })

  it('3 bull, 1 bear, 1 neut → 0.75 (3 of 4 live)', () => {
    expect(dirFactorLive(['bull', 'bull', 'bull', 'bear', 'neut'])).toBe(0.75)
  })

  it('fail-closed: fewer than 3 live feeds → 0.5 (neutral, do not trust thin data)', () => {
    expect(dirFactorLive(['bull', 'bull', 'neut', 'neut', 'neut'])).toBe(0.5)
  })

  it('all feeds dead → 0.5 (neutral)', () => {
    expect(dirFactorLive(['neut', 'neut', 'neut', 'neut', 'neut'])).toBe(0.5)
  })
})

// Lever C — confN must be direction-aware. Confluence is a bull-magnitude metric
// (high = bullish). The old formula (conf-50)/50 clamped[0,1] only ever rewarded
// LONGs; for a SHORT (low/bearish confluence) it produced 0, so shorts could
// never gain confidence from the confluence axis. That is why an 8% BTC drop
// with DirScore -100 was ignored.
describe('confNDirectional (Lever C — symmetric, direction-aware)', () => {
  it('long + strongly bullish confluence (100) → 1.0', () => {
    expect(confNDirectional(100, 'long')).toBe(1)
  })

  it('long + neutral confluence (50) → 0', () => {
    expect(confNDirectional(50, 'long')).toBe(0)
  })

  it('long + bearish confluence (0) → 0 (bullish metric low, long gets nothing)', () => {
    expect(confNDirectional(0, 'long')).toBe(0)
  })

  it('short + strongly bearish confluence (0) → 1.0 (THE bug fix: shorts gain confidence)', () => {
    // OLD broken behaviour: (0-50)/50 = -1 → clamped 0. FIXED: (50-0)/50 = 1.0
    expect(confNDirectional(0, 'short')).toBe(1)
  })

  it('short + neutral confluence (50) → 0', () => {
    expect(confNDirectional(50, 'short')).toBe(0)
  })

  it('short + bullish confluence (100) → 0 (disagreement, no confidence)', () => {
    expect(confNDirectional(100, 'short')).toBe(0)
  })

  it('neutral direction → 0', () => {
    expect(confNDirectional(80, 'neutral')).toBe(0)
  })
})

// Tier confluence bull-bias fix. The entry tier gate required the raw
// bull-magnitude confluence (`conf >= 60/68/75`). Because confluence is high
// for bullish setups and LOW for bearish ones, a SHORT — even a strong one
// (confidence ≥62, confluence ≈0) — could NEVER clear the second gate, so AT
// stopped entering shorts entirely (uid=1: no auto entry for ~5 days). The fix
// mirrors the confluence for shorts (dirConf = 100 - confluence) so a strongly
// bearish setup clears the SAME bars a strongly bullish LONG does. LONGs are
// untouched (dirConf === confluence when dir==='long').
describe('classifyEntryTier (direction-aware tier confluence)', () => {
  // ── LONG: behaviour must be IDENTICAL to the old raw `conf` gate ──
  it('long LARGE: conf≥82, confluence≥75, regimeN≥0.55', () => {
    expect(classifyEntryTier('long', 85, 80, 0.75)).toBe('LARGE')
  })
  it('long MEDIUM: conf≥72, confluence≥68', () => {
    expect(classifyEntryTier('long', 75, 70, 0.55)).toBe('MEDIUM')
  })
  it('long SMALL: conf≥62, confluence≥60', () => {
    expect(classifyEntryTier('long', 65, 62, 0.5)).toBe('SMALL')
  })
  it('long NO_TRADE: confidence high but bullish confluence too low (55<60)', () => {
    expect(classifyEntryTier('long', 65, 55, 0.5)).toBe('NO_TRADE')
  })
  it('long LARGE downgraded to MEDIUM when regime not trending (regimeN<0.55)', () => {
    expect(classifyEntryTier('long', 85, 80, 0.35)).toBe('MEDIUM')
  })

  // ── SHORT: THE FIX — a bearish setup clears the mirrored bars ──
  it('short SMALL: confidence 65, confluence 0 (strongly bearish) → SMALL (was NO_TRADE)', () => {
    // dirConf = 100 - 0 = 100 ≥ 60. Old behaviour: conf=0 < 60 → NO_TRADE.
    expect(classifyEntryTier('short', 65, 0, 0.5)).toBe('SMALL')
  })
  it('short LARGE: confidence 85, confluence 10 (strongly bearish), regimeN≥0.55', () => {
    // dirConf = 90 ≥ 75
    expect(classifyEntryTier('short', 85, 10, 0.75)).toBe('LARGE')
  })
  it('short MEDIUM: confidence 75, confluence 25 → dirConf 75 ≥ 68', () => {
    expect(classifyEntryTier('short', 75, 25, 0.5)).toBe('MEDIUM')
  })
  it('short NO_TRADE: shorting into BULLISH confluence is correctly blocked', () => {
    // confluence 66 → dirConf = 34 < 60. Don't short into bullish confluence.
    expect(classifyEntryTier('short', 65, 66, 0.5)).toBe('NO_TRADE')
  })

  // ── neutral / guard ──
  it('neutral direction → NO_TRADE', () => {
    expect(classifyEntryTier('neutral', 90, 90, 0.9)).toBe('NO_TRADE')
  })
  it('confidence below SMALL bar (62) → NO_TRADE even with perfect confluence', () => {
    expect(classifyEntryTier('long', 61, 100, 0.9)).toBe('NO_TRADE')
    expect(classifyEntryTier('short', 61, 0, 0.9)).toBe('NO_TRADE')
  })
})

// Sentiment/LS feed (Fix B, client side). The server now exposes the raw global
// long/short ACCOUNT RATIO (R = longs/shorts). The display + confluence vote
// expect long%/short% (sum 100), not the raw ratio. lsRatioToSplit converts.
describe('lsRatioToSplit (ratio → long%/short% split)', () => {
  it('balanced ratio 1.0 → 50/50', () => {
    expect(lsRatioToSplit(1)).toEqual({ l: 50, s: 50 })
  })
  it('ratio 1.5 (more longs) → 60/40', () => {
    const r = lsRatioToSplit(1.5)!
    expect(r.l).toBeCloseTo(60)
    expect(r.s).toBeCloseTo(40)
    expect(r.l + r.s).toBeCloseTo(100)
    expect(r.l).toBeGreaterThan(r.s) // vote: lsDir bull when crowd long
  })
  it('ratio 0.5 (more shorts) → 33.3/66.7, short heavy', () => {
    const r = lsRatioToSplit(0.5)!
    expect(r.l).toBeCloseTo(33.333, 2)
    expect(r.s).toBeCloseTo(66.667, 2)
    expect(r.s).toBeGreaterThan(r.l)
  })
  it('invalid/zero/negative ratio → null (caller skips, fail-safe)', () => {
    expect(lsRatioToSplit(0)).toBeNull()
    expect(lsRatioToSplit(-1)).toBeNull()
    expect(lsRatioToSplit(NaN)).toBeNull()
  })
})

// OI change % (Fix C). The naive display did (oi - oiPrev)/oiPrev where oiPrev
// was the value from the PREVIOUS 30s poll — but the server refreshes OI only
// every 60s, so consecutive polls saw near-identical values → ~0%. The fix
// computes the delta over a real time window from the OI history ring buffer.
describe('oiWindowDeltaPct (windowed OI change %)', () => {
  const now = 1_000_000_000_000
  it('returns % change vs the oldest sample within the window', () => {
    const hist = [
      { oi: 100, ts: now - 290_000 }, // ~within 5m window (oldest qualifying)
      { oi: 105, ts: now - 120_000 },
      { oi: 108, ts: now - 30_000 },
    ]
    // (110 - 100) / 100 * 100 = 10%
    expect(oiWindowDeltaPct(hist, 110, now, 300_000)).toBeCloseTo(10)
  })
  it('ignores samples older than the window', () => {
    const hist = [
      { oi: 50, ts: now - 600_000 }, // outside 5m window — must be ignored
      { oi: 100, ts: now - 200_000 }, // oldest WITHIN window
    ]
    expect(oiWindowDeltaPct(hist, 110, now, 300_000)).toBeCloseTo(10)
  })
  it('insufficient history (no sample in window) → null (display shows —, not fake 0)', () => {
    expect(oiWindowDeltaPct([], 110, now, 300_000)).toBeNull()
    expect(oiWindowDeltaPct([{ oi: 100, ts: now - 600_000 }], 110, now, 300_000)).toBeNull()
  })
  it('guards against zero/invalid base → null', () => {
    expect(oiWindowDeltaPct([{ oi: 0, ts: now - 100_000 }], 110, now, 300_000)).toBeNull()
  })
  it('negative change (deleveraging) is reported', () => {
    expect(oiWindowDeltaPct([{ oi: 200, ts: now - 100_000 }], 190, now, 300_000)).toBeCloseTo(-5)
  })
})

// [2026-06-13] klineTfChangePct — open→close % change of the latest candle for a
// given timeframe (drives the per-timeframe PRICE CHANGE in the ZEUS TRADER — AI
// METRICS table once the 1H/4H/12H/1D/1W tabs were made functional).
describe('klineTfChangePct (per-timeframe price change from klines)', () => {
  it('positive change: open 100 → close 110 = +10%', () => {
    expect(klineTfChangePct([[0, '100', '111', '99', '110', '5']])).toBeCloseTo(10, 6)
  })
  it('negative change: open 200 → close 190 = -5%', () => {
    expect(klineTfChangePct([[0, '200', '201', '188', '190', '5']])).toBeCloseTo(-5, 6)
  })
  it('uses the LAST (current) candle when several are returned', () => {
    expect(klineTfChangePct([[0, '100', '1', '1', '105', '1'], [1, '50', '1', '1', '60', '1']])).toBeCloseTo(20, 6)
  })
  it('returns null on empty / malformed / zero-open input', () => {
    expect(klineTfChangePct([])).toBeNull()
    expect(klineTfChangePct(null as any)).toBeNull()
    expect(klineTfChangePct([[0, '0', '1', '1', '5']])).toBeNull()
    expect(klineTfChangePct([[0, 'x', '1', '1', 'y']])).toBeNull()
  })
})
