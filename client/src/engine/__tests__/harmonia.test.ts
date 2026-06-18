import { describe, it, expect } from 'vitest'
import { harmonia } from '../indicatorCalc'

// parse #rrggbb → {r,g,b}
const rgb = (hex: string) => ({ r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) })

describe('harmonia', () => {
  it('produces one #rrggbb colour per bar (same vivid palette)', () => {
    const highs = [1, 2, 3, 4, 5]
    const lows = [0, 1, 2, 3, 4]
    const closes = [0.5, 1.5, 2.5, 3.5, 4.5]
    const r = harmonia(highs, lows, closes, 2, 2, 5)
    expect(r.colors.length).toBe(highs.length)
    for (const c of r.colors) expect(c).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('COLOUR LOGIC: a strong UPTREND (long) paints bluish bars (b > r)', () => {
    const n = 40
    const closes = Array.from({ length: n }, (_, i) => 100 + i * 2) // steadily rising
    const highs = closes.map(c => c + 1), lows = closes.map(c => c - 1)
    const r = harmonia(highs, lows, closes, 2, 5, 10)
    const c = rgb(r.colors[n - 1]) // last bar: well above its EMA → bullish/long
    expect(c.b).toBeGreaterThan(c.r) // blue dominates red ⇒ long-coloured
  })

  it('COLOUR LOGIC: a strong DOWNTREND (short) paints reddish bars (r > b)', () => {
    const n = 40
    const closes = Array.from({ length: n }, (_, i) => 100 - i * 2) // steadily falling
    const highs = closes.map(c => c + 1), lows = closes.map(c => c - 1)
    const r = harmonia(highs, lows, closes, 2, 5, 10)
    const c = rgb(r.colors[n - 1]) // last bar: well below its EMA → bearish/short
    expect(c.r).toBeGreaterThan(c.b) // red dominates blue ⇒ short-coloured
  })

  it('COLOUR LOGIC: a flat / neutral market paints greenish bars (g dominant)', () => {
    const n = 40
    const closes = Array.from({ length: n }, () => 100)
    const highs = closes.map(c => c + 1), lows = closes.map(c => c - 1)
    const r = harmonia(highs, lows, closes, 2, 5, 10)
    const c = rgb(r.colors[n - 1]) // at the EMA → neutral → green
    expect(c.g).toBeGreaterThanOrEqual(c.r)
    expect(c.g).toBeGreaterThanOrEqual(c.b)
  })

  it('detects an obvious peak and trough at the right index for both lookbacks', () => {
    const highs = [1, 1, 1, 1, 1, 9, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
    const lows = [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 0, 5, 5, 5, 5, 5]
    const closes = highs.map((h, i) => (h + lows[i]) / 2)
    const r = harmonia(highs, lows, closes, 2, 5, 20)
    expect(r.shortHighs.some((p) => p.index === 5 && p.price === 9)).toBe(true)
    expect(r.shortLows.some((p) => p.index === 11 && p.price === 0)).toBe(true)
    expect(r.intHighs.some((p) => p.index === 5 && p.price === 9)).toBe(true)
    expect(r.intLows.some((p) => p.index === 11 && p.price === 0)).toBe(true)
  })
})
