import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// [BRAIN-NAMESPACE CLOBBER 2026-10-08]
// loadImpl applies the server response, then calls _reapplyBrainCfgForCurrentMode(),
// which runs applyBrainCfgForMode(mode). That does:
//     Object.assign(USER_SETTINGS.autoTrade, cfg.autoTrade)   // cfg = USER_SETTINGS.brain[mode]
//     __zeusSettingsStore.getState().loadFromLegacy()
// so the per-mode namespace is pushed over the flat values the server just sent.
// When the response did NOT carry `brain`, that namespace is whatever was already
// in memory — stale — and it reverts the fresh values. Traced on the 409 path:
//     set confMin=70 → set confMin=99 (refresh lands) → set confMin=70 (clobber)
// The rule is narrow: do not re-apply a namespace the server did not send.

const saveMock = vi.fn()
const fetchMock = vi.fn()
vi.mock('../../services/api', () => ({
  userSettingsApi: { fetch: (...a: unknown[]) => fetchMock(...a), save: (...a: unknown[]) => saveMock(...a) },
}))

import { useSettingsStore } from '../settingsStore'

async function load() {
  void useSettingsStore.getState().loadFromServer()
  vi.advanceTimersByTime(350)
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
}

describe('a stale per-mode brain namespace must not clobber a fresh load', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock.mockReset(); saveMock.mockReset()
    const w = window as unknown as Record<string, unknown>
    // the legacy re-apply, standing in for config.ts: pushes the per-mode
    // namespace over the flat values, exactly as applyBrainCfgForMode does
    w.applyBrainCfgForMode = () => {
      const us = (w.USER_SETTINGS || {}) as { autoTrade?: Record<string, unknown>; brain?: Record<string, { autoTrade?: Record<string, unknown> }> }
      const cfg = (us.brain && us.brain.demo) || {}
      if (cfg.autoTrade) {
        us.autoTrade = us.autoTrade || {}
        Object.assign(us.autoTrade, cfg.autoTrade)
        const st = (w as { __zeusSettingsStore?: { getState: () => { loadFromLegacy: () => void } } }).__zeusSettingsStore
        try { st?.getState().loadFromLegacy() } catch { /* */ }
      }
    }
  })
  afterEach(() => { vi.useRealTimers() })

  it('keeps the value the server just sent when the response carries no brain namespace', async () => {
    // first load seeds both the flat value and a per-mode namespace at 70
    fetchMock.mockResolvedValueOnce({
      ok: true, updated_at: 1111,
      settings: { confMin: 70, brain: { demo: { autoTrade: { confMin: 70 } } } },
    })
    await load()
    expect(useSettingsStore.getState().settings.confMin).toBe(70)

    // second load sends ONLY the flat value — the namespace in memory is now stale
    fetchMock.mockResolvedValueOnce({ ok: true, updated_at: 2222, settings: { confMin: 99 } })
    await load()
    expect(useSettingsStore.getState().settings.confMin).toBe(99)
  })

  it('still applies the namespace when the server DOES send it', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, updated_at: 3333,
      settings: { confMin: 80, brain: { demo: { autoTrade: { confMin: 80 } } } },
    })
    await load()
    expect(useSettingsStore.getState().settings.confMin).toBe(80)
  })
})
