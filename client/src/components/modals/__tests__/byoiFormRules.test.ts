import { describe, it, expect } from 'vitest'
import { visibleFields, isVisible, requiredTier, gatingOptions, tierTooLow, tierRank } from '../byoiFormRules'

const FIELDS = [
  { key: 'placement', type: 'select', def: 'overlay', options: [{ v: 'overlay', l: 'On price' }, { v: 'pane', l: 'Own pane' }] },
  { key: 'scale', type: 'select', def: 'own', showIf: { key: 'placement', in: ['pane', 'both'] }, options: [{ v: 'own', l: 'Fits' }] },
  { key: 'signals', type: 'multi', options: [{ v: 'entry', l: 'Entry markers' }, { v: 'alert', l: 'Alerts' }] },
  { key: 'alertText', type: 'text', showIf: { key: 'signals', has: 'alert' } },
  { key: 'sources', type: 'multi', options: [{ v: 'price', l: 'Price' }, { v: 'book', l: 'Order book' }] },
  { key: 'visibility', type: 'select', def: 'private', options: [{ v: 'private', l: 'Only me' }, { v: 'public_request', l: 'Everyone' }] },
]
const OPTION_TIER = {
  'sources:book': 'custom',
  'signals:alert': 'custom',
  'visibility:public_request': 'custom',
}

describe('the form only asks questions that apply', () => {
  it('hides the pane scale while nothing draws in a pane', () => {
    const keys = visibleFields(FIELDS, { placement: 'overlay' }).map((f) => f.key)
    expect(keys).not.toContain('scale')
  })

  it('falls back to the field default, not to "hidden", when nothing is chosen yet', () => {
    // placement defaults to overlay, so the scale question is genuinely not applicable
    expect(visibleFields(FIELDS, {}).map((f) => f.key)).not.toContain('scale')
  })

  it('shows it the moment something does', () => {
    expect(visibleFields(FIELDS, { placement: 'pane' }).map((f) => f.key)).toContain('scale')
  })

  it('shows the alert text only once alerts are ticked', () => {
    expect(isVisible(FIELDS[3], { signals: ['entry'] }, {})).toBe(false)
    expect(isVisible(FIELDS[3], { signals: ['entry', 'alert'] }, {})).toBe(true)
  })

  it('a field with no condition is always there', () => {
    expect(isVisible(FIELDS[0], {}, {})).toBe(true)
  })
})

describe('the screen knows what the order costs before he pays', () => {
  it('a plain order stays at the cheapest tier', () => {
    expect(requiredTier(OPTION_TIER, FIELDS, { sources: ['price'] })).toBe('signature')
  })

  it('an expensive option raises it', () => {
    expect(requiredTier(OPTION_TIER, FIELDS, { sources: ['price', 'book'] })).toBe('custom')
    expect(requiredTier(OPTION_TIER, FIELDS, { visibility: 'public_request' })).toBe('custom')
  })

  it('a malformed value is not read as an order for paid work', () => {
    expect(requiredTier(OPTION_TIER, FIELDS, { sources: 'book' })).toBe('signature')
  })

  it('a hidden answer cannot raise the price', () => {
    // alerts untick -> the alert fields are off screen and must not be charged
    expect(requiredTier(OPTION_TIER, FIELDS, { signals: [], alertText: 'x' })).toBe('signature')
  })

  it('names the option that forced the upgrade, so the message can be specific', () => {
    expect(gatingOptions(OPTION_TIER, FIELDS, { sources: ['price', 'book'] }, 'signature')).toEqual(['Order book'])
    expect(gatingOptions(OPTION_TIER, FIELDS, { sources: ['price', 'book'] }, 'custom')).toEqual([])
  })

  it('flags the mismatch, and clears it at the right tier', () => {
    expect(tierTooLow(OPTION_TIER, FIELDS, { sources: ['book'] }, 'signature')).toBe(true)
    expect(tierTooLow(OPTION_TIER, FIELDS, { sources: ['book'] }, 'custom')).toBe(false)
    expect(tierTooLow(OPTION_TIER, FIELDS, { sources: ['book'] }, 'bespoke')).toBe(false)
  })

  it('never flags paying MORE than needed', () => {
    expect(tierTooLow(OPTION_TIER, FIELDS, { sources: ['price'] }, 'custom')).toBe(false)
  })

  it('treats an unknown tier as the cheapest, so it cannot wave work through', () => {
    expect(tierRank('nonsense')).toBe(0)
    expect(tierTooLow(OPTION_TIER, FIELDS, { sources: ['book'] }, 'nonsense')).toBe(true)
  })
})
