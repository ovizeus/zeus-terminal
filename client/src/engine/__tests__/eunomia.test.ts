import { describe, it, expect } from 'vitest'
import { eunomia } from '../indicatorCalc'

const lastNonNull = <T>(arr: (T | null)[]): T | null => {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i] as T
  return null
}

describe('eunomia (RSX-NRP smoothed-RSI oscillator)', () => {
  it('returns rsx, rising & strip arrays aligned 1:1 with input length', () => {
    const closes = Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i / 5) * 10)
    const r = eunomia(closes, 14, 7)
    expect(r.rsx.length).toBe(closes.length)
    expect(r.rising.length).toBe(closes.length)
    expect(r.strip.length).toBe(closes.length)
  })

  it('rsx values are within [0,100] where non-null', () => {
    const closes = Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i / 4) * 15 + (i % 3))
    const r = eunomia(closes, 14, 7)
    for (const v of r.rsx) {
      if (v != null) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(100)
      }
    }
  })

  it('warms up to null then emits values', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i)
    const r = eunomia(closes, 14, 7)
    expect(r.rsx[0]).toBeNull()
    expect(r.rising[0]).toBeNull()
    expect(r.strip[0]).toBeNull()
    expect(lastNonNull(r.rsx)).not.toBeNull()
  })

  it('a RISING uptrend → late rising true, rsx > 50, strip green (1)', () => {
    // uptrend with real pullbacks (some down-bars) so RSI stays mid-high & rsx flexes up
    const closes = Array.from({ length: 160 }, (_, i) => 100 + i * 1.0 + Math.sin(i / 2) * 3)
    const r = eunomia(closes, 14, 7)
    const i = closes.length - 1
    expect(r.rsx[i] as number).toBeGreaterThan(50)
    // late uptrend prints green strips and rising slopes
    expect(r.strip.slice(-30).some((x) => x === 1)).toBe(true)
    expect(r.rising.slice(-30).some((x) => x === true)).toBe(true)
  })

  it('a FALLING downtrend → late rising false, rsx < 50, strip red (-1)', () => {
    // downtrend with real bounces (some up-bars) so RSI stays mid-low & rsx flexes down
    const closes = Array.from({ length: 160 }, (_, i) => 400 - i * 1.0 + Math.sin(i / 2) * 3)
    const r = eunomia(closes, 14, 7)
    const i = closes.length - 1
    expect(r.rsx[i] as number).toBeLessThan(50)
    // late downtrend prints red strips and falling slopes
    expect(r.strip.slice(-30).some((x) => x === -1)).toBe(true)
    expect(r.rising.slice(-30).some((x) => x === false)).toBe(true)
  })

  it('a flat series → strip mostly yellow (0)', () => {
    const closes = Array.from({ length: 120 }, () => 100)
    const r = eunomia(closes, 14, 7)
    const states = r.strip.filter((s) => s != null) as number[]
    expect(states.length).toBeGreaterThan(0)
    const yellow = states.filter((s) => s === 0).length
    expect(yellow / states.length).toBeGreaterThan(0.5)
  })

  it('strip is numeric tri-state {1,0,-1} (never a string)', () => {
    const closes = Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i / 3) * 20)
    const r = eunomia(closes, 14, 7)
    for (const s of r.strip) {
      if (s != null) {
        expect(typeof s).toBe('number')
        expect([1, 0, -1]).toContain(s)
      }
    }
  })

  it('rsx is smoother (lower bar-to-bar variance) than raw rsi on a noisy series', () => {
    // build a noisy series
    let seed = 42
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
    const closes = Array.from({ length: 200 }, (_, i) => 100 + i * 0.1 + (rnd() - 0.5) * 8)
    const r = eunomia(closes, 14, 7)
    const rsxVals = r.rsx.filter((v) => v != null) as number[]
    // mean absolute bar-to-bar delta of rsx
    let rsxDelta = 0, rsxCount = 0
    for (let i = 1; i < rsxVals.length; i++) { rsxDelta += Math.abs(rsxVals[i] - rsxVals[i - 1]); rsxCount++ }
    const rsxAvg = rsxDelta / rsxCount

    // reference: smooth=1 (no double-EMA smoothing) approximates the raw rsi roughness
    const rough = eunomia(closes, 14, 1)
    const roughVals = rough.rsx.filter((v) => v != null) as number[]
    let roughDelta = 0, roughCount = 0
    for (let i = 1; i < roughVals.length; i++) { roughDelta += Math.abs(roughVals[i] - roughVals[i - 1]); roughCount++ }
    const roughAvg = roughDelta / roughCount

    expect(rsxAvg).toBeLessThan(roughAvg)
  })
})
