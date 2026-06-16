import { describe, it, expect } from 'vitest'
import { sma, wma, hma, ema, atr, keltner, donchian, parabolicSAR } from '../indicatorCalc'

describe('sma', () => {
  it('rolling mean with null warm-up', () => {
    expect(sma([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5])
  })
  it('period 1 is identity', () => {
    expect(sma([5, 6, 7], 1)).toEqual([5, 6, 7])
  })
})

describe('wma', () => {
  it('weights recent values more (period 3)', () => {
    // (1*1 + 2*2 + 3*3)/(1+2+3) = 14/6
    const r = wma([1, 2, 3], 3)
    expect(r[0]).toBeNull(); expect(r[1]).toBeNull()
    expect(r[2]).toBeCloseTo(14 / 6, 6)
  })
})

describe('hma', () => {
  it('produces finite values once warmed up and tracks the trend', () => {
    const vals = Array.from({ length: 30 }, (_, i) => i + 1) // steady uptrend
    const h = hma(vals, 9)
    const last = h[h.length - 1]
    expect(typeof last).toBe('number')
    expect(Number.isFinite(last as number)).toBe(true)
    // On a pure uptrend the low-lag HMA should sit near the latest value (30), well above SMA(9)≈26.
    expect(last as number).toBeGreaterThan(28)
  })
})

describe('ema', () => {
  it('last value finite and between min/max of inputs', () => {
    const e = ema([10, 11, 12, 13, 14], 3)
    const last = e[e.length - 1] as number
    expect(last).toBeGreaterThan(10); expect(last).toBeLessThanOrEqual(14)
  })
})

describe('atr', () => {
  it('is positive once warmed up for a ranging series', () => {
    const highs = [10, 11, 12, 11, 12, 13], lows = [9, 10, 11, 10, 11, 12], closes = [9.5, 10.5, 11.5, 10.5, 11.5, 12.5]
    const a = atr(highs, lows, closes, 3)
    expect(a[0]).toBeNull()
    expect(a[a.length - 1] as number).toBeGreaterThan(0)
  })
})

describe('keltner', () => {
  it('upper > middle > lower once warmed up', () => {
    const highs = Array.from({ length: 25 }, (_, i) => 100 + i + 1)
    const lows = Array.from({ length: 25 }, (_, i) => 100 + i - 1)
    const closes = Array.from({ length: 25 }, (_, i) => 100 + i)
    const k = keltner(highs, lows, closes, 10, 2)
    const i = 24
    expect(k.upper[i] as number).toBeGreaterThan(k.middle[i] as number)
    expect(k.middle[i] as number).toBeGreaterThan(k.lower[i] as number)
  })
})

describe('donchian', () => {
  it('upper = rolling max high, lower = rolling min low, mid = avg', () => {
    const highs = [5, 7, 6, 9, 8], lows = [1, 2, 3, 2, 4]
    const d = donchian(highs, lows, 3)
    expect(d.upper[2]).toBe(7); expect(d.lower[2]).toBe(1); expect(d.middle[2]).toBe(4)
    expect(d.upper[3]).toBe(9); expect(d.lower[3]).toBe(2)
    expect(d.upper[4]).toBe(9); expect(d.lower[4]).toBe(2)
    expect(d.upper[0]).toBeNull()
  })
})

describe('parabolicSAR', () => {
  it('flips trend down when price reverses after an uptrend', () => {
    // rising then sharply falling
    const highs = [10, 11, 12, 13, 14, 13, 11, 9, 7]
    const lows = [9, 10, 11, 12, 13, 12, 10, 8, 6]
    const { sar, isUp } = parabolicSAR(highs, lows)
    expect(isUp[4]).toBe(true)          // still up near the peak
    expect(isUp[isUp.length - 1]).toBe(false) // flipped down by the end
    expect(Number.isFinite(sar[sar.length - 1] as number)).toBe(true)
  })
})
