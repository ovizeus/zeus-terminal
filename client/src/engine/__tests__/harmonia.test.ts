import { describe, it, expect } from 'vitest'
import { harmonia } from '../indicatorCalc'

describe('harmonia', () => {
  it('produces one #rrggbb colour per bar', () => {
    const highs = [1, 2, 3, 4, 5]
    const lows = [0, 1, 2, 3, 4]
    const closes = [0.5, 1.5, 2.5, 3.5, 4.5]
    const r = harmonia(highs, lows, closes, 2, 2, 13)
    expect(r.colors.length).toBe(highs.length)
    for (const c of r.colors) {
      expect(c).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('cycles hue across bars (consecutive colours differ)', () => {
    const n = 10
    const highs = Array.from({ length: n }, () => 1)
    const lows = Array.from({ length: n }, () => 0)
    const closes = Array.from({ length: n }, () => 0.5)
    const r = harmonia(highs, lows, closes, 2, 5, 13)
    expect(r.colors[0]).not.toBe(r.colors[1])
    expect(r.colors[1]).not.toBe(r.colors[2])
  })

  it('detects an obvious peak and trough at the right index for both lookbacks', () => {
    // index 5 is a clear peak, index 11 a clear trough
    const highs = [1, 1, 1, 1, 1, 9, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
    const lows = [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 0, 5, 5, 5, 5, 5]
    const closes = highs.map((h, i) => (h + lows[i]) / 2)
    const shortLB = 2, intLB = 5
    const r = harmonia(highs, lows, closes, shortLB, intLB, 13)
    // short lookback
    expect(r.shortHighs.some((p) => p.index === 5 && p.price === 9)).toBe(true)
    expect(r.shortLows.some((p) => p.index === 11 && p.price === 0)).toBe(true)
    // intermediate lookback
    expect(r.intHighs.some((p) => p.index === 5 && p.price === 9)).toBe(true)
    expect(r.intLows.some((p) => p.index === 11 && p.price === 0)).toBe(true)
  })

  it('does not flag edge bars that lack L bars on a side', () => {
    const highs = [9, 1, 1, 1, 1]
    const lows = [1, 5, 5, 5, 5]
    const closes = highs.map((h, i) => (h + lows[i]) / 2)
    const r = harmonia(highs, lows, closes, 2, 2, 13)
    // index 0 cannot be a pivot (no left bars)
    expect(r.shortHighs.some((p) => p.index === 0)).toBe(false)
  })

  it('centerline equals the mean of finite closes', () => {
    const closes = [2, 4, 6, 8]
    const highs = closes.map((c) => c + 1)
    const lows = closes.map((c) => c - 1)
    const r = harmonia(highs, lows, closes, 2, 2, 13)
    expect(r.centerline).toBeCloseTo(5, 9)
  })
})
