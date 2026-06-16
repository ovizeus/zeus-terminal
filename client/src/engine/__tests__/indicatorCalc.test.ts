import { describe, it, expect } from 'vitest'
import { sma, wma, hma, ema, atr, keltner, donchian, parabolicSAR, adx, williamsR, roc, cmf, awesomeOscillator, vwma, aroon, trix, ultimateOscillator, choppiness, keraunos, aether } from '../indicatorCalc'

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

describe('adx', () => {
  it('on a steady uptrend +DI dominates −DI and ADX is strong', () => {
    const highs = Array.from({ length: 40 }, (_, i) => 100 + i + 1)
    const lows = Array.from({ length: 40 }, (_, i) => 100 + i - 1)
    const closes = Array.from({ length: 40 }, (_, i) => 100 + i)
    const { adx: a, plusDI, minusDI } = adx(highs, lows, closes, 14)
    const last = a.length - 1
    expect(plusDI[last] as number).toBeGreaterThan(minusDI[last] as number)
    expect(a[last] as number).toBeGreaterThan(40) // trending → high ADX
    expect(a[0]).toBeNull()
  })
})

describe('williamsR', () => {
  it('is 0 at the period high and −100 at the period low', () => {
    const highs = [10, 11, 12, 13], lows = [9, 10, 11, 12]
    // close at the highest high of the window → 0
    expect(williamsR(highs, lows, [9, 10, 11, 13], 3)[3]).toBeCloseTo(0, 6)
    // close at the lowest low of the window (min low over bars 1..3 = 10) → −100
    expect(williamsR(highs, lows, [9, 10, 11, 10], 3)[3]).toBeCloseTo(-100, 6)
  })
})

describe('roc', () => {
  it('percent change over the lookback', () => {
    const r = roc([10, 10, 11], 2) // (11-10)/10*100
    expect(r[0]).toBeNull(); expect(r[1]).toBeNull()
    expect(r[2]).toBeCloseTo(10, 6)
  })
})

describe('cmf', () => {
  it('≈ +1 when every close prints at the high, −1 at the low', () => {
    const highs = [10, 11, 12], lows = [8, 9, 10], vol = [100, 100, 100]
    expect(cmf(highs, lows, [10, 11, 12], vol, 3)[2] as number).toBeCloseTo(1, 6)
    expect(cmf(highs, lows, [8, 9, 10], vol, 3)[2] as number).toBeCloseTo(-1, 6)
  })
})

describe('awesomeOscillator', () => {
  it('positive on a sustained uptrend, null during warm-up', () => {
    const highs = Array.from({ length: 40 }, (_, i) => 100 + i + 1)
    const lows = Array.from({ length: 40 }, (_, i) => 100 + i - 1)
    const ao = awesomeOscillator(highs, lows)
    expect(ao[10]).toBeNull() // slow SMA(34) not warmed
    expect(ao[ao.length - 1] as number).toBeGreaterThan(0)
  })
})

describe('vwma', () => {
  it('equals SMA when volumes are equal', () => {
    const closes = [1, 2, 3, 4], vol = [10, 10, 10, 10]
    expect(vwma(closes, vol, 2)).toEqual([null, 1.5, 2.5, 3.5])
  })
  it('weights toward high-volume bars', () => {
    // bars [2,4] with vol [1,9] → (2*1+4*9)/10 = 3.8 (closer to 4)
    const r = vwma([2, 4], [1, 9], 2)
    expect(r[1] as number).toBeCloseTo(3.8, 6)
  })
})

describe('aroon', () => {
  it('Aroon Up = 100 when the high is the most recent bar; Down = 100 at a fresh low', () => {
    const highs = [1, 2, 3, 4, 5], lows = [1, 2, 3, 4, 5] // strict uptrend
    const { up, down } = aroon(highs, lows, 4)
    expect(up[4]).toBe(100)   // newest bar is the highest high
    expect(down[4]).toBe(0)   // lowest low is 4 bars ago
    expect(up[0]).toBeNull()
  })
})

describe('trix', () => {
  it('positive on a sustained uptrend after warm-up', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i)
    const t = trix(closes, 9)
    expect(t[0]).toBeNull()
    expect(t[t.length - 1] as number).toBeGreaterThan(0)
  })
})

describe('ultimateOscillator', () => {
  it('stays within 0–100 and is high on a strong uptrend', () => {
    const highs = Array.from({ length: 40 }, (_, i) => 100 + i + 1)
    const lows = Array.from({ length: 40 }, (_, i) => 100 + i - 1)
    const closes = Array.from({ length: 40 }, (_, i) => 100 + i + 0.9) // closes near highs
    const uo = ultimateOscillator(highs, lows, closes)
    const last = uo[uo.length - 1] as number
    expect(uo[5]).toBeNull()
    expect(last).toBeGreaterThan(50); expect(last).toBeLessThanOrEqual(100)
  })
})

describe('choppiness', () => {
  it('is low (trending) on a clean one-way move', () => {
    const highs = Array.from({ length: 30 }, (_, i) => 100 + i + 1)
    const lows = Array.from({ length: 30 }, (_, i) => 100 + i - 1)
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i)
    const ci = choppiness(highs, lows, closes, 14)
    expect(ci[0]).toBeNull()
    expect(ci[ci.length - 1] as number).toBeLessThan(50) // trending → low CI
  })
})

describe('aether', () => {
  it('detects a squeeze in a tight low-volatility range and tightens the band', () => {
    // tiny oscillation around 100, but with wider intrabar wicks → BB(stdev) inside KC(ATR)
    const closes = Array.from({ length: 30 }, (_, i) => 100 + (i % 2 === 0 ? 0.1 : -0.1))
    const highs = closes.map((c) => c + 0.6), lows = closes.map((c) => c - 0.6)
    const r = aether(highs, lows, closes, 20)
    const last = r.squeeze.length - 1
    expect(r.squeeze[last]).toBe(true)
    expect(r.upper[last] as number).toBeGreaterThan(r.mid[last] as number)
    expect(r.lower[last] as number).toBeLessThan(r.mid[last] as number)
  })
  it('no squeeze on a wide-ranging trend, and momentum is positive going up', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i * 3)
    const highs = closes.map((c) => c + 1), lows = closes.map((c) => c - 1)
    const r = aether(highs, lows, closes, 20)
    const last = r.squeeze.length - 1
    expect(r.squeeze[last]).toBe(false)              // big directional range → BB wider than KC
    expect(r.momentum[last] as number).toBeGreaterThan(0)
    expect(r.mid[0]).toBeNull()
  })
})

describe('keraunos', () => {
  const mk = (closes: number[]) => {
    const highs = closes.map((c) => c + 1), lows = closes.map((c) => c - 1), vol = closes.map(() => 100)
    return { highs, lows, closes, vol }
  }
  it('baseline tracks price and conviction is strongly positive on a clean uptrend', () => {
    const { highs, lows, closes, vol } = mk(Array.from({ length: 40 }, (_, i) => 100 + i))
    const k = keraunos(highs, lows, closes, vol)
    const last = k.conviction.length - 1
    expect(k.baseline[last] as number).toBeGreaterThan(120)
    expect(k.conviction[last] as number).toBeGreaterThan(0.3)
    // band ordering
    expect(k.upper[last] as number).toBeGreaterThan(k.baseline[last] as number)
    expect(k.lower[last] as number).toBeLessThan(k.baseline[last] as number)
  })
  it('conviction is negative on a downtrend', () => {
    const { highs, lows, closes, vol } = mk(Array.from({ length: 40 }, (_, i) => 140 - i))
    const k = keraunos(highs, lows, closes, vol)
    expect(k.conviction[k.conviction.length - 1] as number).toBeLessThan(-0.3)
  })
  it('conviction stays near zero (no edge) in a flat chop', () => {
    const { highs, lows, closes, vol } = mk(Array.from({ length: 40 }, (_, i) => 100 + (i % 2 === 0 ? 0.3 : -0.3)))
    const k = keraunos(highs, lows, closes, vol)
    expect(Math.abs(k.conviction[k.conviction.length - 1] as number)).toBeLessThan(0.35)
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
