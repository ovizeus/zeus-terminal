import { describe, it, expect, beforeEach, vi } from 'vitest'

// [2026-10-09] "timeframe-urile nu merg, se resetează". The boot apply restores
// the persisted chart timeframe by calling setTF(saved, null). It runs on a
// poll with a 10s budget, waiting for the chart and for the settings to
// arrive. If the operator changes the timeframe himself inside that window —
// which is exactly what someone does on landing — the apply lands afterwards
// and snaps the chart back to the stored value, taking the re-render (and so
// TERMINATOR's candle tint) with it.
//
// A restore must never overrule a choice the user has already made by hand.

const tfCalls: string[] = []
vi.mock('../../data/marketDataFeeds', () => ({
  setTF: (tf: string) => { tfCalls.push(tf) },
}))
vi.mock('../../engine/indicators', () => ({
  applyIndVisibility: () => {},
  _indRenderHook: () => {},
}))

const w = window as any

beforeEach(async () => {
  tfCalls.length = 0
  w.mainChart = { timeScale: () => ({}) }
  w.cSeries = { setData: () => {}, priceToCoordinate: () => 0 }
  const { _resetRenderApplyForTest, _resetUserTfChoiceForTest } = await import('../../stores/settingsStore')
  _resetRenderApplyForTest()
  _resetUserTfChoiceForTest()
})

describe('the saved timeframe never overrules a manual change', () => {
  it('restores the stored timeframe when the user has not touched it', async () => {
    const { useSettingsStore, _applyLoadedSettingsToRenderLayer } = await import('../../stores/settingsStore')
    useSettingsStore.setState({ settings: { indicators: { ema: true }, chartTf: '30m' } as any })

    _applyLoadedSettingsToRenderLayer()

    expect(tfCalls).toContain('30m')
  })

  it('leaves the chart alone once the user has picked a timeframe himself', async () => {
    const { useSettingsStore, _applyLoadedSettingsToRenderLayer, noteUserTfChoice } = await import('../../stores/settingsStore')
    useSettingsStore.setState({ settings: { indicators: { ema: true }, chartTf: '30m' } as any })

    // He taps 5m while the settings are still in flight.
    noteUserTfChoice()

    _applyLoadedSettingsToRenderLayer()

    expect(tfCalls).toEqual([])
  })
})
