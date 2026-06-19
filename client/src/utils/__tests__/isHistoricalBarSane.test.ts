import { describe, it, expect } from 'vitest'
import { _isHistoricalBarSane, _isPriceSane } from '../guards'

// [2026-06-19] Bug: switching symbol (e.g. BTC→ETH/SOL) blanked the whole chart
// — candles AND bottom indicator panes. Root cause (reproduced headless): fetchKlines
// validated each fresh-symbol historical bar with _isPriceSane, which compares the
// bar's close against the LIVE cross-symbol price baseline (window.S.price). After a
// switch a stale price from the old symbol's feed (e.g. BTC ~63096) repoisons the
// baseline before the bulk filter runs, so EVERY new bar (ETH ~1703) is rejected as a
// "97% spike" → klines = [] → renderChart never runs → blank chart. The spike check is
// only valid for live ticks WITHIN one symbol, never for loading a new symbol's history.
// Fix: a pure per-bar integrity predicate with NO cross-symbol baseline dependency.
describe('_isHistoricalBarSane', () => {
  it('accepts a structurally valid bar regardless of price magnitude', () => {
    expect(_isHistoricalBarSane({ open: 1700, high: 1710, low: 1695, close: 1703 })).toBe(true)
    expect(_isHistoricalBarSane({ open: 0.42, high: 0.45, low: 0.41, close: 0.44 })).toBe(true)
    expect(_isHistoricalBarSane({ open: 63000, high: 63200, low: 62900, close: 63096 })).toBe(true)
  })

  it('is the regression guard: a valid ETH bar passes even when the live baseline is still BTC', () => {
    // This is the exact failure mode. _isPriceSane rejects (cross-symbol spike);
    // _isHistoricalBarSane must accept — the new symbol history must never be
    // measured against the old symbol's price.
    ;(window as any).S = { price: 63096.8, atr: 0 }
    expect(_isPriceSane(1703.275)).toBe(false)              // documents the buggy behavior
    expect(_isHistoricalBarSane({ open: 1700, high: 1710, low: 1695, close: 1703.275 })).toBe(true)
  })

  it('rejects bars with broken OHLC integrity', () => {
    expect(_isHistoricalBarSane({ open: 100, high: 90, low: 95, close: 92 })).toBe(false)   // high < low
    expect(_isHistoricalBarSane({ open: 100, high: 110, low: 95, close: 120 })).toBe(false) // close > high
    expect(_isHistoricalBarSane({ open: 100, high: 110, low: 95, close: 80 })).toBe(false)  // close < low
  })

  it('rejects zero / falsy / non-finite values', () => {
    expect(_isHistoricalBarSane({ open: 0, high: 110, low: 95, close: 100 })).toBe(false)
    expect(_isHistoricalBarSane({ open: 100, high: 110, low: 95, close: 0 })).toBe(false)
    expect(_isHistoricalBarSane({ open: NaN, high: 110, low: 95, close: 100 })).toBe(false)
    expect(_isHistoricalBarSane({ open: 100, high: Infinity, low: 95, close: 100 })).toBe(false)
  })
})
