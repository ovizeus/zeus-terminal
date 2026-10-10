import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// [CANDLE TYPE PERSISTENCE 2026-10-10] The candle type could not persist, and
// the reason was that only HALF the round trip existed.
//
// candleTypeSwitcher.ts:196 writes USER_SETTINGS.chart.candleType and schedules
// a save. But _projectFromLegacy never read ch.candleType, so the store kept
// DEFAULT_SETTINGS.chartType ('candles'); saveToServer posted that default; and
// on the next boot _usApplyFlatToUserSettings dutifully wrote the default back
// into chart.candleType. The loop was closed — on the wrong value. Pick Heikin
// Ashi, refresh, you are back on candles.
//
// The 2026-10-07 fix (settingsFlatProjection.test.ts) repaired the READ half
// only, which is why this looked fixed and was not. Proof it never worked: in
// the live database no user has ever held anything but a default, and 8 of 9
// still hold the legacy 'candle' that the code's own comment says could never
// be applied. Nobody chose it; the save path wrote it.

const saveMock = vi.fn(() => Promise.resolve({ ok: true, updated_at: 5 }))
const fetchMock = vi.fn()
vi.mock('../../services/api', () => ({
  userSettingsApi: { fetch: (...a: unknown[]) => fetchMock(...a), save: (...a: unknown[]) => saveMock(...a) },
}))

import { useSettingsStore } from '../settingsStore'
import { _usApplyServerResponse, USER_SETTINGS } from '../../core/config'

describe('candle type survives a refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    saveMock.mockClear(); fetchMock.mockReset()
    const w = window as unknown as Record<string, unknown>
    w.S = { overlays: {}, activeInds: {}, indicators: {} }
    USER_SETTINGS.chart = {}
    USER_SETTINGS.autoTrade = {}
  })
  afterEach(() => { vi.useRealTimers() })

  it('projects the chosen candle type out of the legacy tree into the store', () => {
    // What the switcher leaves behind when the operator picks Heikin Ashi.
    USER_SETTINGS.chart.candleType = 'heikin'
    useSettingsStore.getState().loadFromLegacy()
    expect(useSettingsStore.getState().settings.chartType).toBe('heikin')
  })

  it('sends the chosen candle type to the server instead of the default', async () => {
    USER_SETTINGS.chart.candleType = 'heikin'
    useSettingsStore.setState({ loaded: true })
    useSettingsStore.getState().loadFromLegacy()
    await useSettingsStore.getState().saveToServer()
    const payload = saveMock.mock.calls[0][0] as Record<string, unknown>
    expect(payload.chartType).toBe('heikin')
  })

  it('completes the round trip: server value survives hydrate → project → save', async () => {
    // This is the whole bug in one test. Before the fix the save at the end
    // posted 'candles' no matter what the server had just said.
    _usApplyServerResponse({ settings: { chartType: 'hollow' }, updated_at: 1 })
    expect(USER_SETTINGS.chart.candleType).toBe('hollow')   // the half that already worked
    useSettingsStore.setState({ loaded: true })
    useSettingsStore.getState().loadFromLegacy()
    await useSettingsStore.getState().saveToServer()
    const payload = saveMock.mock.calls[0][0] as Record<string, unknown>
    expect(payload.chartType).toBe('hollow')
  })
})
