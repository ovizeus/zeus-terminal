import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock the api module before importing the store so userSettingsApi is
// replaced in every consumer of services/api.
const saveMock = vi.fn()
const fetchMock = vi.fn()
vi.mock('../../services/api', () => ({
  userSettingsApi: {
    fetch: (...args: unknown[]) => fetchMock(...args),
    save: (...args: unknown[]) => saveMock(...args),
  },
}))

// config.ts side-effects run for real — _usApplyServerResponse hydrates
// window.USER_SETTINGS from the flat payload, and _usSettingsRemoteTs
// advances with each GET/POST. No mocks needed for the versioning path.

import { useSettingsStore } from '../settingsStore'
import { useMarketStore } from '../marketStore'

/**
 * Helper: call loadFromServer (which schedules a 300ms debounce), advance
 * fake timers past the window, then drain the microtask queue so the
 * async loadImpl body fully resolves before assertions run.
 */
async function triggerLoad(): Promise<void> {
  void useSettingsStore.getState().loadFromServer()
  // Advance past the 300ms trailing-edge delay.
  vi.advanceTimersByTime(350)
  // Drain microtasks so the async fetch + set() calls settle.
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('settingsStore multi-tab versioning [Phase 8D2]', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    saveMock.mockReset()
    fetchMock.mockReset()
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getInitialState().settings, confMin: 70 },
      loaded: true,
      saving: false,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('passes ifUpdatedAt from config remote ts into userSettingsApi.save', async () => {
    // Seed remote ts via the mocked loadFromServer path.
    fetchMock.mockResolvedValueOnce({ ok: true, settings: { confMin: 70 }, updated_at: 1111 })
    await triggerLoad()

    saveMock.mockResolvedValueOnce({ ok: true, updated_at: 2222 })
    await useSettingsStore.getState().saveToServer()

    expect(saveMock).toHaveBeenCalledTimes(1)
    const callArgs = saveMock.mock.calls[0]
    const opts = callArgs[1] as { ifUpdatedAt?: number }
    expect(opts?.ifUpdatedAt).toBe(1111)
  })

  it('on 409 stale response refreshes from server and does not retry the stale write', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, settings: { confMin: 70 }, updated_at: 1111 })
    await triggerLoad()

    // Stale response: saveMock should resolve (not throw) with stale:true.
    saveMock.mockResolvedValueOnce({
      ok: false,
      stale: true,
      error: 'stale',
      current_updated_at: 2222,
      current_settings: { confMin: 99 },
    })
    // Refresh path triggered by stale: a second fetch call seeds the newer state.
    // saveToServer calls loadFromServer internally on stale — that also goes
    // through the debouncer, so advance timers again to flush it.
    fetchMock.mockResolvedValueOnce({ ok: true, settings: { confMin: 99 }, updated_at: 2222 })

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // saveToServer uses _settingsLoadImpl directly for the stale-refresh path
    // (bypasses debounce), so no timer advancing needed here.
    await useSettingsStore.getState().saveToServer()

    // saveMock called exactly once (no auto-retry of the stale write)
    expect(saveMock).toHaveBeenCalledTimes(1)
    // fetchMock called twice: initial load + refresh after stale
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // Store now reflects the server's newer confMin (via the refresh).
    expect(useSettingsStore.getState().settings.confMin).toBe(99)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('happy path advances remote ts via _usApplyPostResponse (no stale, no refresh)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, settings: { confMin: 70 }, updated_at: 1111 })
    await triggerLoad()

    saveMock.mockResolvedValueOnce({ ok: true, updated_at: 3333 })
    await useSettingsStore.getState().saveToServer()

    // Only the initial load triggered fetch; no refresh on success.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(saveMock).toHaveBeenCalledTimes(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// [PERSIST-ROOT-CAUSE 2026-06-12] Boot-window clobber guard.
//
// Root cause of "chart colors + indicators reset after a full exit/reentry":
// during the boot window (loaded=false), the store still holds DEFAULT_SETTINGS
// (candleColors=null, default indicators). If saveToServer() runs in that window
// — e.g. a direct caller like AutoTradePanel firing before the server GET lands —
// it POSTs those defaults. The server merges per-key, so candleColors/indSettings
// are overwritten with defaults, making the reset PERMANENT (next boot's GET
// restores defaults). _usSave already guards on `_usApplyDone` + `loaded`;
// saveToServer must mirror that and refuse to write before the load completes.
// ─────────────────────────────────────────────────────────────────────────────
describe('settingsStore boot-window clobber guard [persistence root cause]', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    saveMock.mockReset()
    fetchMock.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('does NOT POST to the server while loaded=false (boot window)', async () => {
    // Simulate the boot window: store not yet hydrated from server, holding
    // only DEFAULT_SETTINGS (candleColors null, default indicators).
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getInitialState().settings },
      loaded: false,
      saving: false,
    })
    saveMock.mockResolvedValueOnce({ ok: true, updated_at: 9999 })

    await useSettingsStore.getState().saveToServer()

    // A save during the boot window must be suppressed so the user's
    // server-persisted custom colors/indicators are never overwritten by
    // boot-time defaults.
    expect(saveMock).not.toHaveBeenCalled()
  })

  it('still POSTs normally once loaded=true', async () => {
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getInitialState().settings },
      loaded: true,
      saving: false,
    })
    saveMock.mockResolvedValueOnce({ ok: true, updated_at: 9999 })

    await useSettingsStore.getState().saveToServer()

    expect(saveMock).toHaveBeenCalledTimes(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// [PERSIST-ROOT-CAUSE 2026-06-12] Fix D — React marketStore indicator hydration.
//
// marketStore ships a hard default { ema,wma,st,vp: true } that nothing hydrated
// from the loaded settings, so the React indicator panel always showed defaults
// after a restart. loadImpl now calls _applyLoadedTogglesToLiveState() which
// patches marketStore from the server-loaded USER_SETTINGS.indicators.
// ─────────────────────────────────────────────────────────────────────────────
describe('settingsStore hydrates React marketStore indicators on load [persistence root cause]', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    saveMock.mockReset()
    fetchMock.mockReset()
    // Reset marketStore indicators to the shipped default so the assertion
    // proves the load actively changed them (not leftover state).
    useMarketStore.getState().patch({ indicators: { ema: true, wma: true, st: true, vp: true } })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('applies server indSettings toggles into useMarketStore.market.indicators', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      settings: { indSettings: { ema: false, wma: true, st: false, vp: true } },
      updated_at: 4242,
    })

    await triggerLoad()

    const inds = useMarketStore.getState().market.indicators
    expect(inds.ema).toBe(false)
    expect(inds.st).toBe(false)
    expect(inds.wma).toBe(true)
    expect(inds.vp).toBe(true)
  })
})
