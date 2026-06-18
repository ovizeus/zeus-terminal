// TDD for MENTOR (FX Market Code / MarCo): 50MA trend + 4-state candle recolour
// + OsMA momentum (MACD - signal). Pure math, arrays aligned 1:1 with input.
import { describe, it, expect } from 'vitest'
import { mentor } from '../indicatorCalc'

describe('mentor', () => {
  it('returns arrays aligned 1:1 with input length', () => {
    const closes = Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i / 5) * 3)
    const r = mentor(closes)
    expect(r.ma.length).toBe(closes.length)
    expect(r.candleState.length).toBe(closes.length)
    expect(r.osma.length).toBe(closes.length)
    expect(r.osmaState.length).toBe(closes.length)
  })

  it('steadily rising series above its MA → candleState mostly bright green (2), ma < close', () => {
    const closes = Array.from({ length: 120 }, (_, i) => 100 + i * 2)
    const r = mentor(closes)
    let bright = 0, valid = 0
    for (let i = 0; i < closes.length; i++) {
      if (r.candleState[i] != null) {
        valid++
        if (r.candleState[i] === 2) bright++
        // MA lags a rising series → ma below close
        expect(r.ma[i] as number).toBeLessThan(closes[i])
      }
    }
    expect(valid).toBeGreaterThan(0)
    expect(bright / valid).toBeGreaterThan(0.8)
  })

  it('steadily falling series → candleState mostly bright red (-2)', () => {
    const closes = Array.from({ length: 120 }, (_, i) => 400 - i * 2)
    const r = mentor(closes)
    let bright = 0, valid = 0
    for (let i = 0; i < closes.length; i++) {
      if (r.candleState[i] != null) { valid++; if (r.candleState[i] === -2) bright++ }
    }
    expect(valid).toBeGreaterThan(0)
    expect(bright / valid).toBeGreaterThan(0.8)
  })

  it('osma finite where non-null; osmaState ∈ {2,1,-2,-1,null}', () => {
    const closes = Array.from({ length: 160 }, (_, i) => 100 + Math.sin(i / 7) * 10)
    const r = mentor(closes)
    for (let i = 0; i < closes.length; i++) {
      if (r.osma[i] != null) expect(Number.isFinite(r.osma[i] as number)).toBe(true)
      expect([2, 1, -2, -1, null]).toContain(r.osmaState[i])
    }
  })

  it('rise-then-fall produces both green (osma>0) and red (osma<0) osmaState', () => {
    const up = Array.from({ length: 80 }, (_, i) => 100 + i * 2)
    const down = Array.from({ length: 80 }, (_, i) => 260 - i * 2)
    const closes = up.concat(down)
    const r = mentor(closes)
    let green = 0, red = 0
    for (let i = 0; i < closes.length; i++) {
      if (r.osmaState[i] === 2 || r.osmaState[i] === 1) green++
      if (r.osmaState[i] === -2 || r.osmaState[i] === -1) red++
    }
    expect(green).toBeGreaterThan(0)
    expect(red).toBeGreaterThan(0)
  })

  it('candleState values are numbers, never strings', () => {
    const closes = Array.from({ length: 80 }, (_, i) => 100 + i)
    const r = mentor(closes)
    for (const v of r.candleState) {
      if (v != null) expect(typeof v).toBe('number')
    }
    for (const v of r.osmaState) {
      if (v != null) expect(typeof v).toBe('number')
    }
  })
})
