import { describe, it, expect } from 'vitest'
import { effectiveActiveIds } from '../indicatorUsage'

const INDS = [
  { id: 'ema', def: true },   // default-on
  { id: 'rsi', def: true },   // default-on
  { id: 'nyx', def: false },  // default-off (invented)
  { id: 'macd' },             // no def → off by default
]

describe('effectiveActiveIds', () => {
  it('includes default-on indicators even when never toggled (the bug fix)', () => {
    // user toggled nothing → activeInds empty → defaults still count
    expect(effectiveActiveIds(INDS, {}).sort()).toEqual(['ema', 'rsi'])
  })

  it('an explicit toggle overrides the default (off wins, on wins)', () => {
    // ema turned OFF explicitly, nyx turned ON explicitly
    expect(effectiveActiveIds(INDS, { ema: false, nyx: true }).sort()).toEqual(['nyx', 'rsi'])
  })

  it('explicitly-on indicator with no def is included', () => {
    expect(effectiveActiveIds(INDS, { macd: true }).sort()).toEqual(['ema', 'macd', 'rsi'])
  })

  it('safe on empty / missing inputs', () => {
    expect(effectiveActiveIds([], {})).toEqual([])
    expect(effectiveActiveIds(null as any, null as any)).toEqual([])
    expect(effectiveActiveIds([{ def: true } as any], {})).toEqual([]) // no id → skipped
  })
})
