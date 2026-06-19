import { describe, it, expect } from 'vitest'
import { _isAtRealtime } from '../chartScrollToRealtime'

// [2026-06-19] TradingView-style "back to realtime" button. Visible only when scrolled
// back into history. _isAtRealtime decides "at realtime → hide button". The chart is at
// realtime when the last bar index (barCount-1) sits within the visible range's right edge,
// with a 1-bar margin to avoid flicker (the realtime rightOffset makes `to` exceed barCount-1).
describe('_isAtRealtime', () => {
  it('treats a null range as realtime (button hidden)', () => {
    expect(_isAtRealtime(null, 1000)).toBe(true)
  })
  it('is realtime when the last bar is within the visible right edge (with 1-bar margin)', () => {
    expect(_isAtRealtime(1010, 1000)).toBe(true) // realtime rightOffset pushes `to` past last bar
    expect(_isAtRealtime(999, 1000)).toBe(true)  // last bar index 999 visible
    expect(_isAtRealtime(998, 1000)).toBe(true)  // boundary barCount-2
  })
  it('is NOT realtime when scrolled back', () => {
    expect(_isAtRealtime(997, 1000)).toBe(false) // just past the margin
    expect(_isAtRealtime(500, 1000)).toBe(false)
  })
})
