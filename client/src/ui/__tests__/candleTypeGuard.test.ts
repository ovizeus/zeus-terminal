import { describe, it, expect, beforeEach, vi } from 'vitest'

// [CHART BLANKING GUARD 2026-10-07] applyCandleType removed the existing series
// BEFORE building the replacement, and bailed out when _buildSeries returned
// null. So an unknown type id wiped the candles off the chart and left nothing.
//
// That was one step away from happening for real: the persisted chartType for
// uid=1 is 'candle' (singular), which is NOT one of the CANDLE_TYPES ids —
// those are 'candles', 'hollow', 'heikin', … The bad value comes straight from
// the client's own DEFAULT_SETTINGS. It had stayed harmless only because
// nothing ever fed chartType back into the apply path; wiring that up (so the
// saved candle type is honoured) would have started blanking the chart.

import { applyCandleType } from '../candleTypeSwitcher'

type W = Record<string, unknown>

function setupChart(): { removeSeries: ReturnType<typeof vi.fn>; sentinel: object } {
  const w = window as unknown as W
  const removeSeries = vi.fn()
  const sentinel = { __sentinel: true }
  w.mainChart = {
    removeSeries,
    addCandlestickSeries: () => ({ setData: () => {}, applyOptions: () => {} }),
    addBarSeries: () => ({ setData: () => {}, applyOptions: () => {} }),
    addLineSeries: () => ({ setData: () => {}, applyOptions: () => {} }),
    addAreaSeries: () => ({ setData: () => {}, applyOptions: () => {} }),
    addHistogramSeries: () => ({ setData: () => {}, applyOptions: () => {} }),
  }
  w.cSeries = sentinel
  w.S = { klines: [] }
  return { removeSeries, sentinel }
}

describe('applyCandleType must never blank the chart', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('leaves the existing series alone for an unknown type id', () => {
    const { removeSeries, sentinel } = setupChart()
    applyCandleType('definitely-not-a-type' as never, { persist: false })
    expect(removeSeries).not.toHaveBeenCalled()
    expect((window as unknown as W).cSeries).toBe(sentinel)
  })

  it("rejects the legacy singular 'candle', which is not a valid id", () => {
    const { removeSeries, sentinel } = setupChart()
    applyCandleType('candle' as never, { persist: false })
    expect(removeSeries).not.toHaveBeenCalled()
    expect((window as unknown as W).cSeries).toBe(sentinel)
  })

  it('still swaps the series for a valid type', () => {
    const { removeSeries, sentinel } = setupChart()
    applyCandleType('heikin', { persist: false })
    expect(removeSeries).toHaveBeenCalled()
    expect((window as unknown as W).cSeries).not.toBe(sentinel)
  })

  it('does nothing at all when there is no chart yet', () => {
    const w = window as unknown as W
    delete w.mainChart
    w.cSeries = { keep: true }
    expect(() => applyCandleType('heikin', { persist: false })).not.toThrow()
    expect((w.cSeries as { keep?: boolean }).keep).toBe(true)
  })
})

// [2026-10-07] The live bar arrives through _applyLatestBar, which updated the
// candle series with no colour fields — so while TERMINATOR was on, the newest
// candle showed in the user's default colours until the next full render. The
// tick path now carries the active trend colour.
describe('_applyLatestBar carries the TERMINATOR tint', () => {
  function setupLive() {
    const w = window as unknown as Record<string, unknown>
    const updates: Record<string, unknown>[] = []
    w.mainChart = {
      removeSeries: () => {},
      addCandlestickSeries: () => ({
        setData: () => {}, applyOptions: () => {},
        update: (b: Record<string, unknown>) => { updates.push(b) },
      }),
    }
    w.cSeries = null
    w.S = { klines: [] }
    applyCandleType('candles', { persist: false })
    return updates
  }
  const bar = { time: 1, open: 10, high: 11, low: 9, close: 10.5 }

  it('leaves the live bar uncoloured when TERMINATOR is off', () => {
    const updates = setupLive()
    const w = window as unknown as Record<string, unknown>
    w._termActive = false
    w._termLastTrendColor = null
    ;(w._applyLatestBar as (b: unknown) => void)(bar)
    expect(updates).toHaveLength(1)
    expect(updates[0].color).toBeUndefined()
  })

  it('paints the live bar with the active trend colour when TERMINATOR is on', () => {
    const updates = setupLive()
    const w = window as unknown as Record<string, unknown>
    w._termActive = true
    w._termLastTrendColor = '#E547FC'
    ;(w._applyLatestBar as (b: unknown) => void)(bar)
    expect(updates[0].color).toBe('#E547FC')
    expect(updates[0].borderColor).toBe('#E547FC')
    expect(updates[0].wickColor).toBe('#E547FC')
  })

  it('still passes the real OHLC through untouched', () => {
    const updates = setupLive()
    const w = window as unknown as Record<string, unknown>
    w._termActive = true
    w._termLastTrendColor = '#05E17F'
    ;(w._applyLatestBar as (b: unknown) => void)(bar)
    expect(updates[0].open).toBe(10)
    expect(updates[0].high).toBe(11)
    expect(updates[0].low).toBe(9)
    expect(updates[0].close).toBe(10.5)
  })
})
