import { describe, it, expect } from 'vitest'
import { boreas } from '../indicatorCalc'

// Build a synthetic series that rises steadily then falls steadily.
function buildHighsLowsCloses(prices: number[]): { highs: number[]; lows: number[]; closes: number[] } {
  const highs = prices.map((p) => p + 0.5)
  const lows = prices.map((p) => p - 0.5)
  const closes = prices.slice()
  return { highs, lows, closes }
}

describe('boreas (SuperTrend overlay)', () => {
  const up = Array.from({ length: 30 }, (_, i) => 100 + i * 2)       // steady rise
  const down = Array.from({ length: 30 }, (_, i) => 158 - i * 2)     // steady fall
  const prices = [...up, ...down]
  const { highs, lows, closes } = buildHighsLowsCloses(prices)
  const r = boreas(highs, lows, closes, 10, 3)

  it('aligns all arrays to closes.length', () => {
    expect(r.trend.length).toBe(closes.length)
    expect(r.dir.length).toBe(closes.length)
  })

  it('produces at least one flip with an up->down transition', () => {
    expect(r.flips.length).toBeGreaterThanOrEqual(1)
    // Somewhere dir goes from up to down across the rise->fall pivot.
    let sawUp = false
    let sawUpThenDown = false
    for (let i = 1; i < r.dir.length; i++) {
      if (r.dir[i] === 'up') sawUp = true
      if (sawUp && r.dir[i - 1] === 'up' && r.dir[i] === 'down') sawUpThenDown = true
    }
    expect(sawUpThenDown).toBe(true)
  })

  it('trend values are finite where non-null', () => {
    for (let i = 0; i < r.trend.length; i++) {
      if (r.trend[i] != null) expect(Number.isFinite(r.trend[i] as number)).toBe(true)
    }
  })

  it('trend sits below close in a clear uptrend and above in a clear downtrend', () => {
    // Late in the rise (index ~25): direction up, line below close.
    const iUp = 25
    expect(r.dir[iUp]).toBe('up')
    expect((r.trend[iUp] as number) <= closes[iUp]).toBe(true)
    // Late in the fall (index ~55): direction down, line above close.
    const iDn = 55
    expect(r.dir[iDn]).toBe('down')
    expect((r.trend[iDn] as number) >= closes[iDn]).toBe(true)
  })

  it('marks the warmup region as null', () => {
    expect(r.trend[0]).toBeNull()
    expect(r.dir[0]).toBeNull()
  })
})
