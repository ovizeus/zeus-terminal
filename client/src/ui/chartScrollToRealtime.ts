// Zeus — ui/chartScrollToRealtime.ts
// TradingView-style "back to realtime" button: hidden at realtime, shown when the user
// scrolls back into history, click → jump to the latest bar. The pure _isAtRealtime helper
// is unit-tested; the DOM/subscription wiring (initScrollToRealtime) is verified headless.

// Treat a null range as realtime (nothing to scroll back from). Otherwise the chart is at
// realtime when the last bar index (barCount-1) sits within the visible range's right edge,
// with a 1-bar margin to avoid flicker (the realtime rightOffset makes `to` exceed barCount-1).
export function _isAtRealtime(rangeTo: number | null, barCount: number): boolean {
  if (rangeTo == null) return true
  return rangeTo >= barCount - 2
}
