import { describe, it, expect } from 'vitest'
import { terminatorTintBars } from '../indicatorCalc'

// The operator asked for the candles themselves to carry the trend colour, as
// in the screenshots. The tint is a pure transform so it can be tested without
// a chart: bars in, bars out, same OHLC, plus per-bar colour fields that
// lightweight-charts applies over the series defaults.

const UP = '#05E17F'
const DN = '#E547FC'

function bars(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    time: 1000 + i, open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i,
  }))
}

describe('terminatorTintBars', () => {
  it('keeps the bar count', () => {
    expect(terminatorTintBars(bars(5), [1, 1, -1, -1, 1], UP, DN)).toHaveLength(5)
  })

  it('returns an empty array for empty input', () => {
    expect(terminatorTintBars([], [], UP, DN)).toEqual([])
  })

  it('paints a bullish bar with the up colour on body, border and wick', () => {
    const out = terminatorTintBars(bars(1), [1], UP, DN)
    expect(out[0].color).toBe(UP)
    expect(out[0].borderColor).toBe(UP)
    expect(out[0].wickColor).toBe(UP)
  })

  it('paints a bearish bar with the down colour', () => {
    const out = terminatorTintBars(bars(1), [-1], UP, DN)
    expect(out[0].color).toBe(DN)
    expect(out[0].borderColor).toBe(DN)
    expect(out[0].wickColor).toBe(DN)
  })

  it('leaves warm-up bars uncoloured so the series defaults still apply', () => {
    const out = terminatorTintBars(bars(2), [null, 1], UP, DN)
    expect(out[0].color).toBeUndefined()
    expect(out[0].borderColor).toBeUndefined()
    expect(out[0].wickColor).toBeUndefined()
    expect(out[1].color).toBe(UP)
  })

  it('never alters the OHLC or the timestamps — colour only', () => {
    const src = bars(4)
    const out = terminatorTintBars(src, [1, -1, null, 1], UP, DN)
    for (let i = 0; i < src.length; i++) {
      expect(out[i].time).toBe(src[i].time)
      expect(out[i].open).toBe(src[i].open)
      expect(out[i].high).toBe(src[i].high)
      expect(out[i].low).toBe(src[i].low)
      expect(out[i].close).toBe(src[i].close)
    }
  })

  it('does not mutate the bars it was given', () => {
    const src = bars(2)
    terminatorTintBars(src, [1, -1], UP, DN)
    expect((src[0] as Record<string, unknown>).color).toBeUndefined()
  })

  it('tolerates a trend array shorter than the bars', () => {
    const out = terminatorTintBars(bars(3), [1], UP, DN)
    expect(out).toHaveLength(3)
    expect(out[0].color).toBe(UP)
    expect(out[2].color).toBeUndefined()
  })
})
