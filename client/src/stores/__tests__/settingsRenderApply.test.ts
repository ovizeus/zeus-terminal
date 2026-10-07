import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// [PERSIST-RENDER-GAP 2026-10-07]
// Operator: "nu persista timeframurile pe chart ... si indicatorii activi la fel
// ... ei cand ma uit sunt on si daca le dau off on se activeaza iar".
//
// The settings DO persist — uid=1's row holds chartTf='15m' and exactly the 7
// active indicators. What was missing is APPLYING them to the render layer when
// they arrive from the server:
//   • initActBar() applies indicator visibility exactly once, early in boot,
//     from whatever S.activeInds holds at that moment, and its _actBarBuilt
//     guard blocks any second pass. The server GET lands later, so when the
//     local LS cache is gone (APK reinstall / cleared data / new device) the
//     defaults win: the panel reads S.activeInds and shows ON, while the chart
//     was painted from the defaults. Toggling off→on calls applyIndVisibility
//     directly, which is why that "fixes" it.
//   • the chart timeframe was restored ONLY from the device-local
//     `zeus_chart_tf` localStorage key; the persisted settings.chartTf was never
//     applied, despite setTF's own comment calling USER_SETTINGS "the
//     cross-device source of truth".
//   • _applyLoadedTogglesToLiveState copied the indicator map with
//     `for (const k of Object.keys(cur))`, and marketStore's default map has
//     only 4 keys (ema/wma/st/vp) — so all 86 other indicators, which is every
//     one the operator actually runs, were silently dropped from the React
//     surface.

const applyIndVisibilityMock = vi.fn()
const renderActBarMock = vi.fn()
const setTFMock = vi.fn()

vi.mock('../../engine/indicators', () => ({
  applyIndVisibility: (...a: unknown[]) => applyIndVisibilityMock(...a),
  renderActBar: (...a: unknown[]) => renderActBarMock(...a),
}))
vi.mock('../../data/marketDataFeeds', () => ({
  setTF: (...a: unknown[]) => setTFMock(...a),
}))

import { _applyLoadedSettingsToRenderLayer, _resetRenderApplyForTest, _applyLoadedTogglesToLiveState } from '../settingsStore'
import { useSettingsStore } from '../settingsStore'
import { useMarketStore } from '../marketStore'

// The 7 the operator actually runs — all of them custom indicators absent from
// marketStore's 4-key default map.
const ACTIVE = ['charon', 'nyx', 'morpheus', 'hyperion', 'mentor', 'eunomia', 'astrape']
const INACTIVE = ['ema', 'wma', 'st', 'vp', 'macd', 'bb', 'phoebe', 'mfi']

function indicatorMap(): Record<string, boolean> {
  const m: Record<string, boolean> = {}
  for (const k of INACTIVE) m[k] = false
  for (const k of ACTIVE) m[k] = true
  return m
}

function chartReady(): void {
  const w = window as unknown as Record<string, unknown>
  w.mainChart = {}
  w.cSeries = { priceToCoordinate: () => 0 }
}

describe('applying loaded settings to the render layer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    _resetRenderApplyForTest()
    applyIndVisibilityMock.mockReset()
    renderActBarMock.mockReset()
    setTFMock.mockReset()
    const w = window as unknown as Record<string, unknown>
    w.S = { activeInds: {}, indicators: {}, chartTf: '5m' }
    w.renderChart = vi.fn()
    delete w.mainChart
    delete w.cSeries
    useMarketStore.setState({ market: { ...useMarketStore.getState().market, chartTf: '5m' } })
  })
  afterEach(() => { vi.useRealTimers() })

  it('turns every active indicator visible, not just the four marketStore knows', () => {
    chartReady()
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, indicators: indicatorMap() } as never,
    })
    _applyLoadedSettingsToRenderLayer()
    vi.advanceTimersByTime(1000)
    const onCalls = applyIndVisibilityMock.mock.calls.filter((c) => c[1] === true).map((c) => c[0])
    for (const id of ACTIVE) expect(onCalls).toContain(id)
  })

  it('hides the indicators that are off', () => {
    chartReady()
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, indicators: indicatorMap() } as never,
    })
    _applyLoadedSettingsToRenderLayer()
    vi.advanceTimersByTime(1000)
    const offCalls = applyIndVisibilityMock.mock.calls.filter((c) => c[1] === false).map((c) => c[0])
    for (const id of INACTIVE) expect(offCalls).toContain(id)
  })

  it('carries all indicators into marketStore, not only its 4 default keys', () => {
    chartReady()
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, indicators: indicatorMap() } as never,
    })
    _applyLoadedTogglesToLiveState()
    const got = useMarketStore.getState().market.indicators as unknown as Record<string, boolean>
    for (const id of ACTIVE) expect(got[id]).toBe(true)
  })

  it('applies the persisted timeframe to the chart and to marketStore', () => {
    chartReady()
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, chartTf: '15m' } as never,
    })
    _applyLoadedSettingsToRenderLayer()
    vi.advanceTimersByTime(1000)
    expect(setTFMock).toHaveBeenCalledWith('15m', null)
    expect(useMarketStore.getState().market.chartTf).toBe('15m')
  })

  it('restores a persisted 5m too — the old guard treated 5m as "nothing saved"', () => {
    chartReady()
    useMarketStore.setState({ market: { ...useMarketStore.getState().market, chartTf: '1h' } })
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, chartTf: '5m' } as never,
    })
    _applyLoadedSettingsToRenderLayer()
    vi.advanceTimersByTime(1000)
    expect(useMarketStore.getState().market.chartTf).toBe('5m')
  })

  it('waits for the chart before painting, then applies once it is ready', () => {
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, chartTf: '15m', indicators: indicatorMap() } as never,
    })
    _applyLoadedSettingsToRenderLayer()
    vi.advanceTimersByTime(500)
    expect(setTFMock).not.toHaveBeenCalled() // chart absent — nothing painted yet
    chartReady()
    vi.advanceTimersByTime(500)
    expect(setTFMock).toHaveBeenCalledWith('15m', null)
  })

  it('gives up instead of polling forever when the chart never arrives', () => {
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, chartTf: '15m' } as never,
    })
    _applyLoadedSettingsToRenderLayer()
    vi.advanceTimersByTime(60000)
    expect(setTFMock).not.toHaveBeenCalled()
  })

  it('does not fight the user: a later call does not undo a manual timeframe change', () => {
    chartReady()
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, chartTf: '15m' } as never,
    })
    _applyLoadedSettingsToRenderLayer()
    vi.advanceTimersByTime(1000)
    setTFMock.mockReset()
    // user switches to 1h by hand → store reflects it
    useMarketStore.setState({ market: { ...useMarketStore.getState().market, chartTf: '1h' } })
    _applyLoadedSettingsToRenderLayer()
    vi.advanceTimersByTime(1000)
    expect(setTFMock).not.toHaveBeenCalled()
  })

  it('never throws when the legacy globals are missing', () => {
    const w = window as unknown as Record<string, unknown>
    delete w.S
    delete w.renderChart
    chartReady()
    expect(() => {
      _applyLoadedSettingsToRenderLayer()
      vi.advanceTimersByTime(1000)
    }).not.toThrow()
  })
})

describe('wiring: the load path must reach the render layer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    _resetRenderApplyForTest()
    applyIndVisibilityMock.mockReset()
    setTFMock.mockReset()
    const w = window as unknown as Record<string, unknown>
    w.S = { activeInds: {}, indicators: {}, chartTf: '5m' }
    w.renderChart = vi.fn()
    w.mainChart = {}
    w.cSeries = { priceToCoordinate: () => 0 }
    useMarketStore.setState({ market: { ...useMarketStore.getState().market, chartTf: '5m' } })
  })
  afterEach(() => { vi.useRealTimers() })

  it('_applyLoadedTogglesToLiveState also paints the chart', () => {
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        chartTf: '15m',
        indicators: indicatorMap(),
      } as never,
    })
    _applyLoadedTogglesToLiveState()
    vi.advanceTimersByTime(1000)
    // the render half ran, not just the state half
    expect(setTFMock).toHaveBeenCalledWith('15m', null)
    const onCalls = applyIndVisibilityMock.mock.calls.filter((c) => c[1] === true).map((c) => c[0])
    expect(onCalls).toContain('astrape')
  })
})
