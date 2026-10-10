import { describe, it, expect } from 'vitest'
import { useATStore } from '../atStore'

// [VISUAL CHECK 2026-10-10] Rendering the real Auto Trade panel in a browser
// showed "CONFIGUREAZA MAI JOS" in the state line — a Romanian string in a UI
// that is English everywhere else (R-C-11), and after this redesign also simply
// wrong: the settings are no longer below the panel, they are in the drawer
// behind the gear.
//
// It is a pre-existing default in the store, not something the rebuild added,
// but the rebuild moved it somewhere prominent and made its advice false. No
// test could have caught it: nothing asserts on this string, and the panel
// tests check structure. Only looking at it did.

describe('the Auto Trade default status', () => {
  const status = () => useATStore.getInitialState().ui.status.text

  it('is in English, like the rest of the UI', () => {
    // Romanian diacritics, and the specific words that were there.
    expect(status()).not.toMatch(/[ăâîșşțţĂÂÎȘŞȚŢ]/)
    expect(status().toLowerCase()).not.toContain('configureaza')
    expect(status().toLowerCase()).not.toContain('mai jos')
  })

  it('does not tell the user to look below, now that settings live in the drawer', () => {
    expect(status().toLowerCase()).not.toContain('below')
  })

  it('still says something, rather than being blanked', () => {
    expect(status().trim().length).toBeGreaterThan(0)
  })
})
