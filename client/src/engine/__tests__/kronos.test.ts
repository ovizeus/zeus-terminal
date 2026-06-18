import { describe, it, expect } from 'vitest'
import { kronos } from '../indicatorCalc'

describe('kronos (MACD-style dual-line crossover oscillator)', () => {
  it('outputs macd + signal arrays aligned 1:1 to closes.length', () => {
    const closes = Array.from({ length: 100 }, (_, i) => 100 + i)
    const r = kronos(closes, 12, 26, 9)
    expect(r.macd.length).toBe(closes.length)
    expect(r.signal.length).toBe(closes.length)
  })

  it('steadily RISING series → macd trends > 0 after warmup', () => {
    const closes = Array.from({ length: 120 }, (_, i) => 100 + i * 2)
    const r = kronos(closes, 12, 26, 9)
    const tail = r.macd.slice(-10).filter((v): v is number => v != null)
    expect(tail.length).toBeGreaterThan(0)
    expect(tail.every((v) => v > 0)).toBe(true)
  })

  it('steadily FALLING series → macd trends < 0 after warmup', () => {
    const closes = Array.from({ length: 120 }, (_, i) => 400 - i * 2)
    const r = kronos(closes, 12, 26, 9)
    const tail = r.macd.slice(-10).filter((v): v is number => v != null)
    expect(tail.length).toBeGreaterThan(0)
    expect(tail.every((v) => v < 0)).toBe(true)
  })

  it('macd and signal are finite (no NaN) where non-null', () => {
    const closes = Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i / 5) * 20)
    const r = kronos(closes, 12, 26, 9)
    for (const v of r.macd) if (v != null) expect(Number.isFinite(v)).toBe(true)
    for (const v of r.signal) if (v != null) expect(Number.isFinite(v)).toBe(true)
  })

  it('signal is null wherever macd is null (warmup alignment)', () => {
    const closes = Array.from({ length: 120 }, (_, i) => 100 + i)
    const r = kronos(closes, 12, 26, 9)
    for (let i = 0; i < closes.length; i++) {
      if (r.macd[i] == null) expect(r.signal[i]).toBeNull()
    }
  })

  it('a rise-then-fall series produces at least one macd-vs-signal sign change (crossover)', () => {
    const up = Array.from({ length: 80 }, (_, i) => 100 + i * 2)
    const down = Array.from({ length: 80 }, (_, i) => 260 - i * 2)
    const closes = [...up, ...down]
    const r = kronos(closes, 12, 26, 9)
    let prevSign = 0
    let crossings = 0
    for (let i = 0; i < closes.length; i++) {
      const m = r.macd[i], sg = r.signal[i]
      if (m == null || sg == null) continue
      const diff = m - sg
      const sign = diff > 0 ? 1 : diff < 0 ? -1 : 0
      if (sign !== 0 && prevSign !== 0 && sign !== prevSign) crossings++
      if (sign !== 0) prevSign = sign
    }
    expect(crossings).toBeGreaterThanOrEqual(1)
  })
})
