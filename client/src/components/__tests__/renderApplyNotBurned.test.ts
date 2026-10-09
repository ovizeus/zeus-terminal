import { describe, it, expect, beforeEach, vi } from 'vitest'

// [2026-10-09] The operator reported that indicators he switches OFF are back
// ON when he re-enters Zeus — specifically the four the code ships defaults
// for (ema/wma/st/vp). His saved map is correct: all four false, terminator
// true. So the save is fine and the APPLY is not reaching the chart.
//
// _applyLoadedSettingsToRenderLayer is deliberately one-shot ("at most once per
// page load", so a later settings refresh cannot yank the chart out from under
// the user). But it marks itself done as soon as the chart is ready, even when
// the store held NO settings yet — _doRenderApply then paints nothing and the
// one shot is burnt. When the real settings land moments later, the function
// returns at its guard and the saved state never reaches the chart, leaving
// whatever boot defaults initActBar painted: ema/wma/st/vp ON.
//
// The run must only count as done once it actually had settings to apply.

const applied: Array<{ id: string; on: boolean }> = []
vi.mock('../../engine/indicators', () => ({
  applyIndVisibility: (id: string, on: boolean) => { applied.push({ id, on }) },
  _indRenderHook: () => {},
}))
vi.mock('../../data/marketDataFeeds', () => ({ setTF: () => {} }))

const w = window as any

beforeEach(async () => {
  applied.length = 0
  w.mainChart = { timeScale: () => ({}) }
  w.cSeries = { setData: () => {}, priceToCoordinate: () => 0 }
  const { useSettingsStore, _resetRenderApplyForTest } = await import('../../stores/settingsStore')
  _resetRenderApplyForTest()
  useSettingsStore.setState({ settings: {} as any })
})

describe('the one-shot apply is not burnt by an empty settings store', () => {
  it('applies the saved map that arrives AFTER an early empty call', async () => {
    vi.useFakeTimers()
    const { useSettingsStore, _applyLoadedSettingsToRenderLayer } = await import('../../stores/settingsStore')

    // Boot: chart is up, settings have not arrived yet. Nothing to paint, and
    // the one shot must NOT be considered spent — the poller keeps watching.
    _applyLoadedSettingsToRenderLayer()
    expect(applied).toEqual([])

    // The server response lands moments later: four off, terminator on.
    useSettingsStore.setState({
      settings: { indicators: { ema: false, wma: false, st: false, vp: false, terminator: true } } as any,
    })
    vi.advanceTimersByTime(600) // a couple of poll ticks

    const byId = Object.fromEntries(applied.map((a) => [a.id, a.on]))
    expect(byId.ema).toBe(false)
    expect(byId.wma).toBe(false)
    expect(byId.terminator).toBe(true)
    vi.useRealTimers()
  })

  it('still refuses to re-apply once a real map HAS been painted', async () => {
    const { useSettingsStore, _applyLoadedSettingsToRenderLayer } = await import('../../stores/settingsStore')
    useSettingsStore.setState({ settings: { indicators: { ema: true } } as any })
    _applyLoadedSettingsToRenderLayer()
    const first = applied.length
    expect(first).toBeGreaterThan(0)

    // A later refresh must not yank the chart around again.
    useSettingsStore.setState({ settings: { indicators: { ema: false } } as any })
    _applyLoadedSettingsToRenderLayer()
    expect(applied.length).toBe(first)
  })
})
