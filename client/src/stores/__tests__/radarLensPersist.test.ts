import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// [RADAR LENS PERSISTENCE 2026-10-10] The server half of this was built and the
// client half was never wired. routes/trading.js whitelists 'radarLens' with the
// comment "Radar Lens (D4 persistence)" and the validator accepts it, but
// RadarLensBar held the lens and its timeframe in plain useState('hybrid') /
// useState('5m') — no localStorage, no save, no load. Nothing in the whole
// client ever sent the key, and the live database confirms it: radarLens is
// ABSENT for all nine users. So the lens reset to hybrid/5m on every refresh.
//
// Wired here as a FULL loop on purpose — project, save, hydrate AND apply —
// because wiring only the save half is what made the candle type look repaired
// for three days (candleTypePersist.test.ts).
//
// Note on the shape: radarLens is deliberately NOT seeded into DEFAULT_SETTINGS.
// A fabricated default would recreate the clobber just removed in b266 — a boot
// that saved before the component mounted would post the default over the real
// choice. Absent until something real sets it is the only safe shape.

const saveMock = vi.fn(() => Promise.resolve({ ok: true, updated_at: 5 }))
const fetchMock = vi.fn()
vi.mock('../../services/api', () => ({
  userSettingsApi: { fetch: (...a: unknown[]) => fetchMock(...a), save: (...a: unknown[]) => saveMock(...a) },
}))

import { useSettingsStore } from '../settingsStore'
import { _usApplyServerResponse, USER_SETTINGS } from '../../core/config'

const LENS = { lens: 'slow', tf: '4h' }

async function saveAndCapture(): Promise<Record<string, unknown>> {
  useSettingsStore.setState({ loaded: true })
  await useSettingsStore.getState().saveToServer()
  expect(saveMock).toHaveBeenCalled()
  return saveMock.mock.calls[0][0] as Record<string, unknown>
}

describe('radar lens survives a refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    saveMock.mockClear(); fetchMock.mockReset()
    const w = window as unknown as Record<string, unknown>
    w.S = { overlays: {}, activeInds: {}, indicators: {} }
    USER_SETTINGS.chart = {}
    USER_SETTINGS.autoTrade = {}
    delete (USER_SETTINGS as Record<string, unknown>).radarLens
  })
  afterEach(() => { vi.useRealTimers() })

  it('projects the chosen lens out of the legacy tree into the store', () => {
    ;(USER_SETTINGS as Record<string, unknown>).radarLens = { ...LENS }
    useSettingsStore.getState().loadFromLegacy()
    expect(useSettingsStore.getState().settings.radarLens).toEqual(LENS)
  })

  it('sends the chosen lens to the server', async () => {
    ;(USER_SETTINGS as Record<string, unknown>).radarLens = { ...LENS }
    useSettingsStore.getState().loadFromLegacy()
    const payload = await saveAndCapture()
    expect(payload.radarLens).toEqual(LENS)
  })

  it('hydrates the legacy tree from the server response', () => {
    _usApplyServerResponse({ settings: { radarLens: { ...LENS } }, updated_at: 1 })
    expect((USER_SETTINGS as Record<string, unknown>).radarLens).toEqual(LENS)
  })

  it('completes the round trip: server value survives hydrate → project → save', async () => {
    _usApplyServerResponse({ settings: { radarLens: { ...LENS } }, updated_at: 1 })
    useSettingsStore.getState().loadFromLegacy()
    const payload = await saveAndCapture()
    expect(payload.radarLens).toEqual(LENS)
  })

  it('puts nothing on the wire while nothing has chosen a lens', async () => {
    // The b266 lesson: never post a fabricated default over a stored choice.
    // Asserted on the WIRE, not on the object: a spread keeps a key whose value
    // is undefined, and it is JSON.stringify that drops it. The object shape is
    // an implementation detail; what reaches the server is the contract.
    const s = { ...useSettingsStore.getState().settings } as Record<string, unknown>
    delete s.radarLens
    useSettingsStore.setState({ settings: s as never })
    const payload = await saveAndCapture()
    const onTheWire = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>
    expect(Object.prototype.hasOwnProperty.call(onTheWire, 'radarLens')).toBe(false)
  })
})
