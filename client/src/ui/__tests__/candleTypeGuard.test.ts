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
