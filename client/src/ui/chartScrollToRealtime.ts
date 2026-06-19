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

const w = window as any
let _installed = false

export function initScrollToRealtime(): void {
  if (_installed || !w.mainChart) return
  _installed = true
  try {
    const host = document.getElementById('csec') || document.body
    let btn = document.getElementById('chartScrollRtBtn') as HTMLElement | null
    if (!btn) {
      btn = document.createElement('button')
      btn.id = 'chartScrollRtBtn'
      btn.setAttribute('type', 'button')
      btn.title = 'Back to realtime'
      btn.setAttribute('aria-label', 'Back to realtime')
      btn.innerHTML = '&#187;' // »
      btn.style.display = 'none'
      btn.addEventListener('click', () => {
        try { w.mainChart.timeScale().scrollToRealTime() } catch (_) { }
        const e = document.getElementById('chartScrollRtBtn')
        if (e) e.style.display = 'none'
      })
      host.appendChild(btn)
    }
    w.mainChart.timeScale().subscribeVisibleLogicalRangeChange((r: any) => {
      const barCount = Array.isArray(w.S?.klines) ? w.S.klines.length : 0
      const atRt = _isAtRealtime(r ? r.to : null, barCount)
      const e = document.getElementById('chartScrollRtBtn')
      if (e) e.style.display = atRt ? 'none' : 'flex'
    })
  } catch (_) { _installed = false }
}
