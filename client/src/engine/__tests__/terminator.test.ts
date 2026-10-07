import { describe, it, expect } from 'vitest'
import { terminator } from '../indicatorCalc'

// TERMINATOR — ATR trailing-stop band, built to match the two screenshots the
// operator uploaded: a stepped staircase that only ever moves WITH the trend
// (below price while bullish, above while bearish), candles coloured by trend,
// and a marker on the bar where it flips.

function rising(n: number, start = 100, step = 1): number[][] {
  const out: number[][] = []
  let p = start
  for (let i = 0; i < n; i++) { out.push([p + 0.5, p - 0.5, p]); p += step }
  return out
}
function falling(n: number, start = 200, step = 1): number[][] {
  const out: number[][] = []
  let p = start
  for (let i = 0; i < n; i++) { out.push([p + 0.5, p - 0.5, p]); p -= step }
  return out
}
function split(rows: number[][]) {
  return { highs: rows.map(r => r[0]), lows: rows.map(r => r[1]), closes: rows.map(r => r[2]) }
}

describe('terminator (ATR trailing stop)', () => {
  it('returns arrays aligned with the input', () => {
    const s = split(rising(60))
    const t = terminator(s.highs, s.lows, s.closes)
    expect(t.line.length).toBe(60)
    expect(t.trend.length).toBe(60)
    expect(t.flip.length).toBe(60)
    expect(t.flipLevel.length).toBe(60)
  })

  it('handles empty and single-bar input without throwing', () => {
    expect(() => terminator([], [], [])).not.toThrow()
    expect(terminator([], [], []).line).toEqual([])
    expect(() => terminator([1], [1], [1])).not.toThrow()
  })

  it('in a sustained uptrend the trend is up and the stop sits BELOW price', () => {
    const s = split(rising(80))
    const t = terminator(s.highs, s.lows, s.closes)
    const i = 70
    expect(t.trend[i]).toBe(1)
    expect(t.line[i]).not.toBeNull()
    expect(t.line[i] as number).toBeLessThan(s.closes[i])
  })

  it('in a sustained downtrend the trend is down and the stop sits ABOVE price', () => {
    const s = split(falling(80))
    const t = terminator(s.highs, s.lows, s.closes)
    const i = 70
    expect(t.trend[i]).toBe(-1)
    expect(t.line[i] as number).toBeGreaterThan(s.closes[i])
  })

  it('the staircase never steps DOWN while the trend is up', () => {
    const s = split(rising(80))
    const t = terminator(s.highs, s.lows, s.closes)
    for (let i = 41; i < 80; i++) {
      if (t.trend[i] === 1 && t.trend[i - 1] === 1 && t.line[i] != null && t.line[i - 1] != null) {
        expect(t.line[i] as number).toBeGreaterThanOrEqual((t.line[i - 1] as number) - 1e-9)
      }
    }
  })

  it('the staircase never steps UP while the trend is down', () => {
    const s = split(falling(80))
    const t = terminator(s.highs, s.lows, s.closes)
    for (let i = 41; i < 80; i++) {
      if (t.trend[i] === -1 && t.trend[i - 1] === -1 && t.line[i] != null && t.line[i - 1] != null) {
        expect(t.line[i] as number).toBeLessThanOrEqual((t.line[i - 1] as number) + 1e-9)
      }
    }
  })

  it('a genuine reversal flips the trend, and flip marks exactly that bar', () => {
    const rows = [...rising(60, 100, 1), ...falling(60, 160, 2)]
    const s = split(rows)
    const t = terminator(s.highs, s.lows, s.closes)
    expect(t.trend[55]).toBe(1)
    expect(t.trend[115]).toBe(-1)
    const flips = t.flip.map((f, i) => (f ? i : -1)).filter(i => i >= 0)
    expect(flips.length).toBeGreaterThanOrEqual(1)
    for (const i of flips) expect(t.trend[i]).not.toBe(t.trend[i - 1])
  })

  it('flipLevel carries the stop level from the most recent flip', () => {
    const rows = [...rising(60, 100, 1), ...falling(60, 160, 2)]
    const s = split(rows)
    const t = terminator(s.highs, s.lows, s.closes)
    const flips = t.flip.map((f, i) => (f ? i : -1)).filter(i => i >= 0)
    const last = flips[flips.length - 1]
    expect(t.flipLevel[last]).toBe(t.line[last])
    if (last + 1 < t.flipLevel.length) expect(t.flipLevel[last + 1]).toBe(t.line[last])
  })

  it('a wider multiplier gives a looser stop and no more flips than a tight one', () => {
    const rows = [...rising(40, 100, 1), ...falling(30, 140, 1), ...rising(40, 110, 1)]
    const s = split(rows)
    const tight = terminator(s.highs, s.lows, s.closes, 10, 1)
    const wide = terminator(s.highs, s.lows, s.closes, 10, 6)
    const count = (f: boolean[]) => f.filter(Boolean).length
    expect(count(wide.flip)).toBeLessThanOrEqual(count(tight.flip))
  })

  it('never emits NaN', () => {
    const rows = [...rising(50), ...falling(50), ...rising(50)]
    const s = split(rows)
    const t = terminator(s.highs, s.lows, s.closes)
    for (const v of t.line) if (v != null) expect(Number.isFinite(v)).toBe(true)
    for (const v of t.flipLevel) if (v != null) expect(Number.isFinite(v)).toBe(true)
  })

  it('a flat market does not thrash the trend every bar', () => {
    const rows: number[][] = []
    for (let i = 0; i < 100; i++) rows.push([100.1, 99.9, 100])
    const s = split(rows)
    const t = terminator(s.highs, s.lows, s.closes)
    expect(t.flip.filter(Boolean).length).toBeLessThan(5)
  })
})
