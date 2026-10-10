import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// [DEFAULT CLOBBER 2026-10-10] Eight keys sat in DEFAULT_SETTINGS that nothing
// ever filled and nothing ever read, so every save posted a hardcoded default
// over whatever the server held. The server merges per key and a null does
// overwrite, so the user's real value was destroyed by the act of saving
// something else.
//
// The proof was the absence of variance in the live database: all nine users
// held byte-identical values for these keys, and eight still held the candle
// type 'candle' that the code's own comment says could never be applied.
// Nobody ever chose it; the save path wrote it.
//
// Each key's real owner, established by tracing rather than assuming:
//   theme          -> localStorage 'zeus_theme' (uiStore). Device-local.
//   soundEnabled   -> localStorage 'zt:sound_muted' (ui/dom2.ts), inverted.
//   uiScale        -> NOTHING. The control was removed on 2026-06-13 because
//                     no CSS consumed var(--ui-scale). No setter, no consumer.
//   timezoneOffset -> NOTHING. A dead duplicate of chartTz, which is projected.
//   liqSettings    -> NOTHING reads it; the modal that writes it is decorative.
//   srSettings     -> NOTHING at all: no writer, no reader.
//   llvSettings    -> localStorage 'zeus_llv_settings', owned by the user-context
//                     channel (verified live: 9 of 9 users have the row).
//   zsSettings     -> w.S.zsSettings, owned by user-context 'chartExtras'
//                     (verified live in data/user_ctx/1.json).
//
// So the fix is not to invent a value for them here: it is to stop sending keys
// this store does not own, and let each real owner keep its own channel. A key
// absent from the payload leaves the stored value untouched.
//
// Deliberately NOT done in this pass: making theme and sound follow the user
// across devices. That needs an apply-on-load as well, and wiring only the
// save half is the exact mistake that made the candle type look fixed for
// three days (see candleTypePersist.test.ts).

const saveMock = vi.fn(() => Promise.resolve({ ok: true, updated_at: 5 }))
const fetchMock = vi.fn()
vi.mock('../../services/api', () => ({
  userSettingsApi: { fetch: (...a: unknown[]) => fetchMock(...a), save: (...a: unknown[]) => saveMock(...a) },
}))

import { useSettingsStore } from '../settingsStore'
import { _usApplyServerResponse, USER_SETTINGS } from '../../core/config'

const UNOWNED = [
  'theme', 'uiScale', 'soundEnabled', 'timezoneOffset',
  'liqSettings', 'srSettings', 'llvSettings', 'zsSettings',
] as const

async function saveAndCapture(): Promise<Record<string, unknown>> {
  useSettingsStore.setState({ loaded: true })
  await useSettingsStore.getState().saveToServer()
  expect(saveMock).toHaveBeenCalled()
  return saveMock.mock.calls[0][0] as Record<string, unknown>
}

describe('a save never clobbers keys this store does not own', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    saveMock.mockClear(); fetchMock.mockReset()
    const w = window as unknown as Record<string, unknown>
    w.S = { overlays: { liq: true }, activeInds: { ema: true }, indicators: {} }
    USER_SETTINGS.chart = {}
    USER_SETTINGS.autoTrade = {}
  })
  afterEach(() => { vi.useRealTimers() })

  it.each(UNOWNED)('does not send %s at all, so the stored value survives', async (key) => {
    const payload = await saveAndCapture()
    expect(Object.prototype.hasOwnProperty.call(payload, key)).toBe(false)
  })

  it('does not post the default theme back over a theme the server just sent', async () => {
    // The clobber itself, as a test. The server says dark; we save something
    // unrelated; the server must not be told the theme is 'native' again.
    _usApplyServerResponse({ settings: { theme: 'dark', chartTf: '1h' }, updated_at: 1 })
    useSettingsStore.getState().loadFromLegacy()
    const payload = await saveAndCapture()
    expect(payload.theme).toBeUndefined()
  })

  it('still sends every key it genuinely owns', async () => {
    USER_SETTINGS.chart.tf = '15m'
    USER_SETTINGS.chart.candleType = 'heikin'
    USER_SETTINGS.autoTrade.confMin = 77
    useSettingsStore.getState().loadFromLegacy()
    const payload = await saveAndCapture()
    expect(payload.chartTf).toBe('15m')
    expect(payload.chartType).toBe('heikin')
    expect(payload.confMin).toBe(77)
    expect(payload.indicators).toEqual({ ema: true })
    expect(payload.overlays).toEqual({ liq: true })
  })
})
