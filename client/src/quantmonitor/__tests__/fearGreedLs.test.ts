import { describe, test, expect, beforeEach } from 'vitest'
import { calcFearGreed } from '../engines/intel'

// [2026-11-21] S.ls = {l, s} (procente). Formula il scadea ca pe un numar → NaN → afisaj „50 NEUTRAL" mereu.
const w = window as any
describe('FEAR & GREED composite (Quant Monitor)', () => {
  beforeEach(() => { w.S = { price: 100, atr: 0.05, rsi: 50, fr: 0, ls: { l: 50, s: 50 } } })
  test('e un numar finit cu ls ca obiect', () => {
    calcFearGreed()
    expect(Number.isFinite(w.S._qmFearGreed)).toBe(true)
    expect(w.S._qmFearGreed).toBeCloseTo(50, 6)
  })
  test('se misca dupa piata: RSI 80 + 75% long → peste 60 (GREED)', () => {
    w.S.rsi = 80; w.S.ls = { l: 75, s: 25 }
    calcFearGreed()
    expect(w.S._qmFearGreed).toBeGreaterThan(60)
  })
  test('RSI 15 → sub 45 (FEAR), nu 50', () => {
    w.S.rsi = 15; w.S.ls = { l: 30, s: 70 }
    calcFearGreed()
    expect(w.S._qmFearGreed).toBeLessThan(45)
  })
})
