import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// [DEFAULTS-CLOBBER GUARD 2026-10-08] Companion to the save-deadlock fix.
//
// Unblocking saves when there is no localStorage cache re-opens a hazard the
// broken guard had been masking: if the server fetch ALSO fails, loadImpl's
// offline fallback projects from a legacy tree that is still all defaults, sets
// loaded = true, and the next save POSTs those defaults. The server merges
// per-key, so the user's real indicator map and chart colours would be
// overwritten — permanently, since the next boot then reads the defaults back.
// saveToServer's own comment describes exactly this failure.
//
// So the fallback may only declare the store loaded when it actually projected
// something real. With nothing cached and no server, saving stays blocked.

const saveMock = vi.fn(() => Promise.resolve({ ok: true, updated_at: 1 }))
const fetchMock = vi.fn()
vi.mock('../../services/api', () => ({
  userSettingsApi: { fetch: (...a: unknown[]) => fetchMock(...a), save: (...a: unknown[]) => saveMock(...a) },
}))

import { useSettingsStore } from '../settingsStore'
import { USER_SETTINGS, loadUserSettings } from '../../core/config'

async function load() {
  void useSettingsStore.getState().loadFromServer()
  vi.advanceTimersByTime(350)
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
}

describe('the offline fallback must not declare defaults "loaded"', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock.mockReset(); saveMock.mockClear()
    useSettingsStore.setState({ loaded: false })
    USER_SETTINGS.autoTrade = {}
    USER_SETTINGS.chart = {}
    delete (USER_SETTINGS as Record<string, unknown>).indicators
    try { localStorage.clear() } catch { /* */ }
    loadUserSettings()   // no cache → boot records "no cache"

  })
  afterEach(() => { vi.useRealTimers() })

  it('server down AND nothing cached → stays unloaded, so no save can clobber', async () => {
    fetchMock.mockRejectedValue(new Error('HTTP 500'))
    await load()
    expect(useSettingsStore.getState().loaded).toBe(false)
  })

  it('server down but a real cached tree exists → loads from it', async () => {
    localStorage.setItem('zeus_user_settings', JSON.stringify({ autoTrade: { confMin: 77 }, indicators: { astrape: true } }))
    loadUserSettings()
    USER_SETTINGS.autoTrade = { confMin: 77 }
    USER_SETTINGS.indicators = { astrape: true }
    fetchMock.mockRejectedValue(new Error('HTTP 500'))
    await load()
    // Only the loaded flag is asserted: on this branch the per-mode brain
    // namespace still overwrites flat values (logged in the Book as the
    // remaining half of the b247 clobber). What matters here is that a real
    // cache DOES unblock the store, so the user can save again.
    expect(useSettingsStore.getState().loaded).toBe(true)
  })

  it('a successful server load always marks loaded, cache or not', async () => {
    fetchMock.mockResolvedValue({ ok: true, settings: { confMin: 66 }, updated_at: 9 })
    await load()
    expect(useSettingsStore.getState().loaded).toBe(true)
    expect(useSettingsStore.getState().settings.confMin).toBe(66)
  })

  it('saveToServer refuses to write while the store is unloaded', async () => {
    fetchMock.mockRejectedValue(new Error('HTTP 500'))
    await load()
    await useSettingsStore.getState().saveToServer()
    expect(saveMock).not.toHaveBeenCalled()
  })
})
