import { describe, it, expect } from 'vitest'
import { apollo, apolloHeat } from '../indicatorCalc'

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) throw new Error('bad hex: ' + hex)
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
}

describe('apollo', () => {
  // a noisy-but-trending series long enough to exceed warmup + lookback
  const closes: number[] = []
  for (let i = 0; i < 120; i++) closes.push(100 + i * 0.5 + Math.sin(i / 3) * 4)

  it('returns arrays aligned 1:1 with closes', () => {
    const r = apollo(closes, 14, 50)
    for (const key of ['rsi', 'rising', 'fib236', 'fib382', 'fib618', 'fib786', 'mid', 'signal'] as const) {
      expect(r[key].length).toBe(closes.length)
    }
  })

  it('rsi stays within [0,100]', () => {
    const r = apollo(closes, 14, 50)
    for (const v of r.rsi) {
      if (v == null) continue
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(100)
    }
  })

  it('fib fan is ordered fib786 >= fib618 >= fib382 >= fib236 and mid sits between', () => {
    const r = apollo(closes, 14, 50)
    let checked = 0
    for (let i = 0; i < closes.length; i++) {
      const a = r.fib236[i], b = r.fib382[i], c = r.fib618[i], d = r.fib786[i], m = r.mid[i]
      if (a == null || b == null || c == null || d == null || m == null) continue
      if (d - a <= 0) continue // skip flat-range slots
      expect(d).toBeGreaterThanOrEqual(c)
      expect(c).toBeGreaterThanOrEqual(b)
      expect(b).toBeGreaterThanOrEqual(a)
      expect(m).toBeGreaterThanOrEqual(a)
      expect(m).toBeLessThanOrEqual(d)
      checked++
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('rising is true on a steady uptrend tail', () => {
    const up: number[] = []
    for (let i = 0; i < 120; i++) up.push(100 + i * 1.0)
    const r = apollo(up, 14, 50)
    expect(r.rising[up.length - 1]).toBe(true)
  })

  it('signal is numeric (never a string)', () => {
    const r = apollo(closes, 14, 50)
    for (const s of r.signal) {
      if (s == null) continue
      expect(typeof s).toBe('number')
      expect([1, 0, -1]).toContain(s)
    }
  })

  it('flat tape resolves rsi to neutral 50 (no NaN/div0)', () => {
    const flat = new Array(60).fill(100)
    const r = apollo(flat, 14, 50)
    const last = r.rsi[flat.length - 1]
    expect(last).not.toBeNull()
    expect(last).toBeCloseTo(50, 5)
  })
})

describe('apolloHeat', () => {
  it('returns a valid #rrggbb hex', () => {
    expect(apolloHeat(0.5)).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('apolloHeat(1) is greenish (g > r)', () => {
    const { r, g } = hexToRgb(apolloHeat(1))
    expect(g).toBeGreaterThan(r)
  })

  it('apolloHeat(0) is reddish (r > g)', () => {
    const { r, g } = hexToRgb(apolloHeat(0))
    expect(r).toBeGreaterThan(g)
  })

  it('clamps out-of-range input', () => {
    expect(apolloHeat(2)).toBe(apolloHeat(1))
    expect(apolloHeat(-1)).toBe(apolloHeat(0))
  })
})
