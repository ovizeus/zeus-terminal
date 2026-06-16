import { describe, it, expect } from 'vitest'
import { sma, wma, hma, ema, atr, keltner, donchian, parabolicSAR, adx, williamsR, roc, cmf, awesomeOscillator, vwma, aroon, trix, ultimateOscillator, choppiness, keraunos, aether, marketStructure, nemesis, pythia, plutus, helios } from '../indicatorCalc'

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

describe('pythia', () => {
  it('marks a long entry on a fast-over-slow cross with target above and stop below entry', () => {
    // decline then rally → fast EMA crosses above slow during the rally → long
    const down = Array.from({ length: 40 }, (_, i) => 80 - i)       // 80 → 41
    const up = Array.from({ length: 40 }, (_, i) => 41 + i * 2)     // 41 → 119
    const closes = [...down, ...up]
    const highs = closes.map((c) => c + 1), lows = closes.map((c) => c - 1)
    const e = pythia(highs, lows, closes, 9, 21, 14, 2.5, 1.2)
    const long = e.find((x) => x.dir === 'long')
    expect(long).toBeTruthy()
    expect(long!.target).toBeGreaterThan(long!.entry)
    expect(long!.stop).toBeLessThan(long!.entry)
  })
  it('marks a short entry on a rally-then-decline (fast under slow)', () => {
    const up = Array.from({ length: 40 }, (_, i) => 40 + i * 2)
    const down = Array.from({ length: 40 }, (_, i) => 118 - i * 2)
    const closes = [...up, ...down]
    const highs = closes.map((c) => c + 1), lows = closes.map((c) => c - 1)
    const e = pythia(highs, lows, closes, 9, 21, 14, 2.5, 1.2)
    const short = e.find((x) => x.dir === 'short')
    expect(short).toBeTruthy()
    expect(short!.target).toBeLessThan(short!.entry)
    expect(short!.stop).toBeGreaterThan(short!.entry)
  })
})

describe('nemesis', () => {
  const flat = (v: number, n: number) => Array.from({ length: n }, () => v)
  it('fires a top exhaustion after 9 up-closes, confirmed by RSI extreme', () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 + i)
    const highs = closes.map((c) => c + 1), lows = closes.map((c) => c - 1), vol = flat(100, 40)
    const sig = nemesis(highs, lows, closes, vol, 9, 2, 5) // rsiPeriod 5 → warm by bar 12
    const top = sig.find((s) => s.dir === 'top')
    expect(top).toBeTruthy()
    expect(top!.index).toBe(12)            // TD-9 print: count 1..9 over bars 4..12
    expect(top!.strength).toBeGreaterThanOrEqual(2) // +RSI>70 confirmation on a clean uptrend
  })
  it('fires a bottom exhaustion on a clean downtrend', () => {
    const closes = Array.from({ length: 40 }, (_, i) => 140 - i)
    const highs = closes.map((c) => c + 1), lows = closes.map((c) => c - 1), vol = flat(100, 40)
    const sig = nemesis(highs, lows, closes, vol)
    expect(sig.some((s) => s.dir === 'bottom')).toBe(true)
  })
  it('stays silent in a flat market (no exhaustion)', () => {
    const c = flat(100, 40)
    expect(nemesis(c.map((x) => x + 1), c.map((x) => x - 1), c, flat(100, 40))).toEqual([])
  })
})

describe('marketStructure', () => {
  it('finds swing H/L pivots, labels a Higher-High as up-trend, and fires a BOS up', () => {
    // peak(5)@2, trough(1)@4, higher peak(8)@6 → HH structure; close 8 breaks the
    // confirmed swing high (5) → BOS up. lookback 2.
    const c = [1, 2, 5, 2, 1, 2, 8, 2, 1]
    const ms = marketStructure(c, c, c, 2)
    const h = ms.pivots.filter((p) => p.type === 'H')
    const l = ms.pivots.filter((p) => p.type === 'L')
    expect(h.map((p) => p.index)).toEqual([2, 6])
    expect(l.map((p) => p.index)).toEqual([4])
    expect(h[1].value).toBe(8)
    expect(h[1].trend).toBe('up')                 // 8 > 5 → Higher High
    expect(ms.breaks.some((b) => b.dir === 'up' && b.level === 5)).toBe(true)
  })
  it('returns no pivots when there is not enough data', () => {
    expect(marketStructure([1, 2, 3], [1, 2, 3], [1, 2, 3], 5).pivots).toEqual([])
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

describe('plutus', () => {
  it('flags ACCUMULATION on a climax-volume bar that prints a new low but closes strong', () => {
    // 24 quiet bars drifting down (vol 100), then a fresh-low bar that closes near its high on 3× volume
    const closes = Array.from({ length: 24 }, (_, i) => 100 - i * 0.2)
    const highs = closes.map((c) => c + 1), lows = closes.map((c) => c - 1)
    const vol = closes.map(() => 100)
    // climax bar
    closes.push(90); highs.push(98); lows.push(88); vol.push(300) // low=88 (new low), close 90 → closePos=(90-88)/10=0.2? need >0.6
    // fix close to land high in range: close 96 → (96-88)/10=0.8
    closes[closes.length - 1] = 96
    const sig = plutus(highs, lows, closes, vol, 20, 1.5)
    const acc = sig.find((s) => s.dir === 'accumulation')
    expect(acc).toBeTruthy()
    expect(acc!.index).toBe(24)
    expect(acc!.effort).toBeGreaterThan(1.5)
  })
  it('flags DISTRIBUTION on a climax-volume bar that prints a new high but closes weak', () => {
    const closes = Array.from({ length: 24 }, (_, i) => 100 + i * 0.2)
    const highs = closes.map((c) => c + 1), lows = closes.map((c) => c - 1)
    const vol = closes.map(() => 100)
    closes.push(116); highs.push(120); lows.push(110); vol.push(300) // high=120 new high, close 116 → (116-110)/10=0.6 not <0.4
    closes[closes.length - 1] = 111 // closePos=(111-110)/10=0.1
    const sig = plutus(highs, lows, closes, vol, 20, 1.5)
    expect(sig.some((s) => s.dir === 'distribution' && s.index === 24)).toBe(true)
  })
  it('stays silent without climax volume', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + (i % 2 ? 0.5 : -0.5))
    const highs = closes.map((c) => c + 1), lows = closes.map((c) => c - 1)
    expect(plutus(highs, lows, closes, closes.map(() => 100), 20, 1.5)).toEqual([])
  })
})

describe('helios', () => {
  it('reads a persistent (long-run) market as more trending than an alternating one', () => {
    // 10 up-steps then 10 down-steps = two long runs → persistent (H>0.5)
    const trend: number[] = [100]
    for (let i = 0; i < 10; i++) trend.push(trend[trend.length - 1] + 1)
    for (let i = 0; i < 10; i++) trend.push(trend[trend.length - 1] - 1)
    const tH = helios(trend, 20)
    const last = tH.length - 1
    expect(tH[0]).toBeNull()
    expect(tH[last] as number).toBeGreaterThan(0.5) // persistent runs → trending regime
    // perfectly alternating returns = anti-persistent (H≈0)
    const chop = Array.from({ length: 21 }, (_, i) => 100 + (i % 2 ? 1 : 0))
    const cH = helios(chop, 20)
    expect(cH[cH.length - 1] as number).toBeLessThan(0.5)
    expect(cH[cH.length - 1] as number).toBeLessThan(tH[last] as number)
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
