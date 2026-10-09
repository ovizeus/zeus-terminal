import { describe, it, expect, beforeEach, vi } from 'vitest'
import { initBackfill, resetBackfill } from '../../data/chartBackfill'

// [2026-10-09] The operator reported the chart stopped loading older history
// when scrolling back, the way TradingView does. The server side is fine —
// /api/market/klines answers 200 with real candles.
//
// The cause is on the client: initBackfill() subscribes to
// w.mainChart.timeScale() once and guards itself with a module-level
// `_installed` flag. TradingChart.tsx creates its chart inside a useEffect and
// calls chart.remove() on cleanup, so every remount produces a NEW chart
// object. The old subscription dies with the old chart, but `_installed` is
// still true, so initBackfill returns early and never subscribes to the new
// one. Backfill therefore works until the first chart remount and is dead
// after it, silently, until a full page reload. resetBackfill() cleared
// _inFlight and _exhausted but not _installed.

const w = window as any

function fakeChart() {
  const handlers: Array<(r: any) => void> = []
  return {
    handlers,
    timeScale: () => ({
      subscribeVisibleLogicalRangeChange: (fn: (r: any) => void) => handlers.push(fn),
      getVisibleLogicalRange: () => ({ from: 0, to: 100 }),
      setVisibleLogicalRange: () => {},
    }),
  }
}

beforeEach(() => {
  w.__MF = { CHART_BACKFILL_ENABLED: true }
  w.S = { klines: [{ time: 1, open: 1, high: 1, low: 1, close: 1 }], symbol: 'BTCUSDT', chartTf: '15m' }
  w.cSeries = { setData: vi.fn() }
  resetBackfill()
})

describe('backfill follows the chart it is supposed to watch', () => {
  it('subscribes to the first chart', () => {
    const c1 = fakeChart()
    w.mainChart = c1
    initBackfill()
    expect(c1.handlers.length).toBe(1)
  })

  it('subscribes again when the chart is replaced by a remount', () => {
    const c1 = fakeChart()
    w.mainChart = c1
    initBackfill()

    // TradingChart unmounts (chart.remove()) and mounts a fresh one.
    const c2 = fakeChart()
    w.mainChart = c2
    initBackfill()

    expect(c2.handlers.length).toBe(1)
  })

  it('does not double-subscribe to the same chart', () => {
    const c1 = fakeChart()
    w.mainChart = c1
    initBackfill()
    initBackfill()
    expect(c1.handlers.length).toBe(1)
  })
})
