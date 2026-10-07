import { describe, it, expect, beforeEach, vi } from 'vitest'

// [FLAT PROJECTION GAPS 2026-10-07] _usApplyFlatToUserSettings un-flattens the
// server response into the nested USER_SETTINGS tree the legacy UI reads. Two
// keys were missing from it, so the server value never arrived:
//
//  • chartType — the server stores it ('candle' for uid=1) and _usApply has a
//    boot apply for USER_SETTINGS.chart.candleType, but nothing ever filled
//    that field from the response. The dropdown label reads it via a useState
//    initializer, so the label could be right while the chart drew default
//    candles. Worked only while the device-local LS cache of the nested tree
//    was warm — the same cold-cache failure as the timeframe.
//
//  • indicators — the map was only read from flat.indSettings. The June b214
//    fix keeps both keys in sync on save, which hides this, but the canonical
//    key was still being ignored here.

import { _usApplyServerResponse, USER_SETTINGS } from '../../core/config'

// config.ts exports USER_SETTINGS as a module-level object; reset the fields
// under test instead of replacing the reference every consumer holds.
function freshUserSettings(): Record<string, unknown> {
  USER_SETTINGS.chart = {}
  USER_SETTINGS.autoTrade = {}
  delete USER_SETTINGS.indicators
  return USER_SETTINGS as Record<string, unknown>
}

describe('flat server response → nested USER_SETTINGS', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    freshUserSettings()
  })

  it('carries chartType into chart.candleType so the saved candle type can be applied', () => {
    _usApplyServerResponse({ settings: { chartType: 'heikin' }, updated_at: 1 })
    const us = USER_SETTINGS as { chart: { candleType?: string } }
    expect(us.chart.candleType).toBe('heikin')
  })

  it('still carries the timeframe (regression guard on the mapping that already worked)', () => {
    _usApplyServerResponse({ settings: { chartTf: '15m' }, updated_at: 1 })
    const us = USER_SETTINGS as { chart: { tf?: string } }
    expect(us.chart.tf).toBe('15m')
  })

  it('prefers the canonical indicators map over the legacy indSettings one', () => {
    _usApplyServerResponse({
      settings: { indicators: { astrape: true }, indSettings: { astrape: false } },
      updated_at: 1,
    })
    const us = USER_SETTINGS as { indicators?: Record<string, boolean> }
    expect(us.indicators).toEqual({ astrape: true })
  })

  it('falls back to indSettings when the canonical map is absent', () => {
    _usApplyServerResponse({ settings: { indSettings: { nyx: true } }, updated_at: 1 })
    const us = USER_SETTINGS as { indicators?: Record<string, boolean> }
    expect(us.indicators).toEqual({ nyx: true })
  })

  it('leaves fields the server did not send untouched', () => {
    const us = freshUserSettings() as { chart: Record<string, unknown> }
    us.chart.candleType = 'hollow'
    _usApplyServerResponse({ settings: { chartTf: '1h' }, updated_at: 1 })
    expect(us.chart.candleType).toBe('hollow')
  })
})

describe('legacy chartType normalisation', () => {
  beforeEach(() => { freshUserSettings() })

  it("maps the legacy singular 'candle' onto the real id 'candles'", () => {
    // uid=1's row holds exactly this value, and 'candle' is not a CANDLE_TYPES id.
    _usApplyServerResponse({ settings: { chartType: 'candle' }, updated_at: 1 })
    const us = USER_SETTINGS as { chart: { candleType?: string } }
    expect(us.chart.candleType).toBe('candles')
  })

  it('passes a valid id through untouched', () => {
    _usApplyServerResponse({ settings: { chartType: 'heikin' }, updated_at: 1 })
    const us = USER_SETTINGS as { chart: { candleType?: string } }
    expect(us.chart.candleType).toBe('heikin')
  })

  it('ignores a type id it does not recognise rather than storing garbage', () => {
    _usApplyServerResponse({ settings: { chartType: 'nonsense' }, updated_at: 1 })
    const us = USER_SETTINGS as { chart: { candleType?: string } }
    expect(us.chart.candleType).toBeUndefined()
  })
})
