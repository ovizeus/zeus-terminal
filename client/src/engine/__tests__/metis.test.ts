import { describe, it, expect } from 'vitest'
import { metis } from '../indicatorCalc'

// Gentle drift with pullbacks so RSI rides high (~60-85) without pinning at
// 100; this is the regime where green/red/yellow separate and a steady uptrend
// reads green-family (not a degenerate all-100 saturation tie).
function makeUptrend(n: number): number[] {
  const out: number[] = []
  let p = 100
  for (let i = 0; i < n; i++) { p += 1.2 + Math.sin(i / 4) * 1.6; out.push(p) }
  return out
}
function makeDowntrend(n: number): number[] {
  const out: number[] = []
  let p = 1000
  for (let i = 0; i < n; i++) { p -= 1.2 + Math.sin(i / 4) * 1.6; out.push(p) }
  return out
}
// Oscillating tape (multiple swings) so RSI cycles through the mid-range and
// produces crossings in BOTH the lower (long) and upper (short) zones, instead
// of pinning at 0/100 like a one-shot ramp.
function makeRiseThenFall(n: number): number[] {
  const out: number[] = []
  let p = 100
  for (let i = 0; i < n; i++) {
    p += Math.sin(i / 8) * 3 + Math.sin(i / 3) * 0.6
    out.push(p)
  }
  return out
}

describe('metis (Traders Dynamic Index)', () => {
  const closes = makeRiseThenFall(120)
  const r = metis(closes, 13, 2, 7, 34)

  it('all arrays length === closes.length', () => {
    expect(r.rsi.length).toBe(closes.length)
    expect(r.green.length).toBe(closes.length)
    expect(r.red.length).toBe(closes.length)
    expect(r.yellow.length).toBe(closes.length)
    expect(r.upper.length).toBe(closes.length)
    expect(r.lower.length).toBe(closes.length)
    expect(r.candleState.length).toBe(closes.length)
    expect(r.signal.length).toBe(closes.length)
  })

  it('rsi in [0,100] where non-null', () => {
    for (const v of r.rsi) {
      if (v == null) continue
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(100)
    }
  })

  it('upper >= yellow >= lower where non-null', () => {
    for (let i = 0; i < closes.length; i++) {
      if (r.upper[i] == null || r.yellow[i] == null || r.lower[i] == null) continue
      expect(r.upper[i] as number).toBeGreaterThanOrEqual(r.yellow[i] as number - 1e-9)
      expect(r.yellow[i] as number).toBeGreaterThanOrEqual(r.lower[i] as number - 1e-9)
    }
  })

  it('flat tape yields rsi 50 (no div-by-zero)', () => {
    const flat = new Array(60).fill(42)
    const fr = metis(flat, 13, 2, 7, 34)
    for (let i = 14; i < 60; i++) {
      if (fr.rsi[i] != null) expect(fr.rsi[i]).toBe(50)
    }
  })

  it('steady uptrend → late candleState dominated by green family {1,2}', () => {
    const up = metis(makeUptrend(120), 13, 2, 7, 34)
    const late = up.candleState.slice(80).filter((s) => s != null) as number[]
    const greenFam = late.filter((s) => s === 1 || s === 2).length
    const redFam = late.filter((s) => s === -1 || s === -2).length
    expect(greenFam).toBeGreaterThan(redFam)
  })

  it('steady downtrend → late candleState dominated by red family {-1,-2}', () => {
    const dn = metis(makeDowntrend(120), 13, 2, 7, 34)
    const late = dn.candleState.slice(80).filter((s) => s != null) as number[]
    const greenFam = late.filter((s) => s === 1 || s === 2).length
    const redFam = late.filter((s) => s === -1 || s === -2).length
    expect(redFam).toBeGreaterThan(greenFam)
  })

  it('rise-then-fall produces at least one long (1) and one short (-1)', () => {
    const longs = r.signal.filter((s) => s === 1).length
    const shorts = r.signal.filter((s) => s === -1).length
    expect(longs).toBeGreaterThanOrEqual(1)
    expect(shorts).toBeGreaterThanOrEqual(1)
  })

  it('candleState/signal are numbers not strings (BOREAS guard)', () => {
    for (let i = 0; i < closes.length; i++) {
      if (r.candleState[i] != null) expect(typeof r.candleState[i]).toBe('number')
      if (r.signal[i] != null) expect(typeof r.signal[i]).toBe('number')
    }
  })
})
