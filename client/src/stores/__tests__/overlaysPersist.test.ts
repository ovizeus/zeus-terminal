import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// [OVERLAYS PERSISTENCE 2026-10-08] The chart overlay toggles (liq heatmap, S-R,
// supremus, LLV, order flow, OVI) never persisted: `overlays` was absent from
// the server whitelist, neither togOvr called a save, and nothing hydrated them
// on load — so every refresh reset them. It was a forgotten save rather than a
// missing feature: togInd does save, and the React wrapper's own comment talks
// about "the legacy start value was already-true (persisted)".

const saveMock = vi.fn(() => Promise.resolve({ ok: true, updated_at: 5 }))
const fetchMock = vi.fn()
vi.mock('../../services/api', () => ({
  userSettingsApi: { fetch: (...a: unknown[]) => fetchMock(...a), save: (...a: unknown[]) => saveMock(...a) },
}))

import { useSettingsStore, _applyLoadedTogglesToLiveState } from '../settingsStore'
import { useMarketStore } from '../marketStore'

const OV = { liq: true, zs: false, sr: true, llv: false, oflow: false, ovi: true }

describe('overlay toggles persist', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    saveMock.mockClear(); fetchMock.mockReset()
    const w = window as unknown as Record<string, unknown>
    w.S = { overlays: { ...OV }, activeInds: {}, indicators: {} }
  })
  afterEach(() => { vi.useRealTimers() })

  it('saveToServer sends the live overlay state', async () => {
    useSettingsStore.setState({ loaded: true })
    await useSettingsStore.getState().saveToServer()
    expect(saveMock).toHaveBeenCalled()
    const payload = saveMock.mock.calls[0][0] as Record<string, unknown>
    expect(payload.overlays).toEqual(OV)
  })

  it('never posts an empty overlay map over a saved one', async () => {
    const w = window as unknown as Record<string, unknown>
    w.S = { overlays: {}, activeInds: {}, indicators: {} }
    useSettingsStore.setState({ loaded: true })
    await useSettingsStore.getState().saveToServer()
    const payload = saveMock.mock.calls[0][0] as Record<string, unknown>
    expect(payload.overlays).toBeFalsy()   // null from defaults, never an empty map
  })

  it('a loaded overlay map is pushed into the legacy state and the React store', () => {
    const w = window as unknown as Record<string, unknown>
    w.S = { overlays: { liq: false, sr: false }, activeInds: {}, indicators: {} }
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, overlays: OV } as never,
    })
    _applyLoadedTogglesToLiveState()
    expect((w.S as { overlays: Record<string, boolean> }).overlays.liq).toBe(true)
    expect((w.S as { overlays: Record<string, boolean> }).overlays.sr).toBe(true)
    const mkt = useMarketStore.getState().market.overlays as unknown as Record<string, boolean>
    expect(mkt.liq).toBe(true)
    expect(mkt.ovi).toBe(true)
    expect(mkt.zs).toBe(false)
  })

  it('an absent overlay map leaves the live state untouched', () => {
    const w = window as unknown as Record<string, unknown>
    w.S = { overlays: { liq: true }, activeInds: {}, indicators: {} }
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, overlays: null } as never,
    })
    _applyLoadedTogglesToLiveState()
    expect((w.S as { overlays: Record<string, boolean> }).overlays.liq).toBe(true)
  })
})
