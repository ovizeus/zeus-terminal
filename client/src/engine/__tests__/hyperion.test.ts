import { describe, it, expect } from 'vitest'
import { hyperion } from '../indicatorCalc'

describe('hyperion (TSI-style dual-line momentum oscillator)', () => {
  it('returns fast & signal arrays aligned 1:1 with input length', () => {
    const closes = Array.from({ length: 80 }, (_, i) => 100 + i)
    const r = hyperion(closes, 25, 13, 9)
    expect(r.fast.length).toBe(closes.length)
    expect(r.signal.length).toBe(closes.length)
  })

  it('on a steadily RISING series fast trends positive (>0) after warmup', () => {
    const closes = Array.from({ length: 120 }, (_, i) => 100 + i * 1.5)
    const r = hyperion(closes, 25, 13, 9)
    const last = r.fast[r.fast.length - 1] as number
    expect(last).not.toBeNull()
    expect(last).toBeGreaterThan(0)
  })

  it('on a steadily FALLING series fast trends negative (<0) after warmup', () => {
    const closes = Array.from({ length: 120 }, (_, i) => 300 - i * 1.5)
    const r = hyperion(closes, 25, 13, 9)
    const last = r.fast[r.fast.length - 1] as number
    expect(last).not.toBeNull()
    expect(last).toBeLessThan(0)
  })

  it('signal is smoother (less variance) than fast on a noisy series', () => {
    const closes: number[] = []
    let v = 100
    for (let i = 0; i < 200; i++) {
      v += Math.sin(i * 0.7) * 3 + Math.cos(i * 1.9) * 2
      closes.push(v)
    }
    const r = hyperion(closes, 25, 13, 9)
    const fastVals = r.fast.filter((x): x is number => x != null)
    const sigVals = r.signal.filter((x): x is number => x != null)
    const variance = (a: number[]) => {
      const m = a.reduce((s, x) => s + x, 0) / a.length
      return a.reduce((s, x) => s + (x - m) * (x - m), 0) / a.length
    }
    expect(variance(sigVals)).toBeLessThan(variance(fastVals))
  })

  it('flat series (divide-by-zero) → fast 0, no NaN', () => {
    const closes = Array.from({ length: 80 }, () => 100)
    const r = hyperion(closes, 25, 13, 9)
    for (const x of r.fast) {
      if (x != null) {
        expect(Number.isNaN(x)).toBe(false)
        expect(x).toBe(0)
      }
    }
    for (const x of r.signal) {
      if (x != null) expect(Number.isNaN(x)).toBe(false)
    }
  })
})
