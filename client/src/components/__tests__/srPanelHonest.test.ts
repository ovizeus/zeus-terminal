import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

// [R10 2026-10-10] The ZEUS S/R SETTINGS panel had 21 controls and exactly ONE
// of them was connected: applySR (marketDataWS.ts:582) reads the srEn checkbox
// and nothing else.
//
// The deeper problem was not unwired inputs, it was that most of them described
// a feature nobody built. renderSROverlay (marketDataOverlays.ts:408) is
// seventeen lines: top three highs and bottom three lows of the last fifty
// candles, with colour, width and opacity hardcoded. No pivots, no zones, no
// labels, no strength, no volume filter. So Pivot Length, Min Strength, Zone
// Width, Show Labels, Hide Weak and the rest were not disconnected controls —
// they advertised a product that does not exist. Two tells: the panel offered
// "Max Levels: 8" while the engine always draws 6, and the two colour pickers
// defaulted to the exact hardcoded colours, so they looked connected.
//
// The operator's decision: keep Enable and SAVE, remove the other 20.
//
// His question was whether this takes the chart's timeframes with it. It does
// not, and the last test here pins that: the panel's Timeframe row was a
// private useState read only for a CSS class, while the chart's timeframes live
// in marketDataFeeds.setTF and the .tfb buttons. Nothing is shared.

const SRC = path.join(__dirname, '..', '..')
const MODAL = path.join(SRC, 'components', 'modals', 'SRSettingsModal.tsx')

function modal(): string { return fs.readFileSync(MODAL, 'utf8') }
function count(re: RegExp): number { return (modal().match(re) || []).length }

/** The file WITHOUT comments. The timeframe guard below must judge code, not
 *  prose: the header comment legitimately names setTF and .tfb to explain why
 *  they are unrelated, and a text search cannot tell that from a real call. */
function modalCode(): string {
  return modal()
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
}

describe('the S/R panel only offers what it can deliver', () => {
  it('keeps exactly one control: the Enable checkbox', () => {
    expect(count(/type="checkbox"/g)).toBe(1)
    expect(modal()).toContain('id="srEn"')
  })

  it('offers no number, colour or range input any more', () => {
    expect(count(/type="number"/g)).toBe(0)
    expect(count(/type="color"/g)).toBe(0)
    expect(count(/type="range"/g)).toBe(0)
  })

  it('offers no button group describing a setting the engine ignores', () => {
    // The Timeframe and Display Period rows.
    expect(modal()).not.toContain("'AUTO'")
    expect(modal()).not.toContain("'Session'")
  })

  it('still applies the one thing it can: SAVE calls applySR', () => {
    expect(modal()).toContain('applySR')
    expect(modal()).toContain('SAVE')
  })

  it('leaves the chart timeframes completely alone', () => {
    // The operator asked this directly. The panel must not reference any of
    // the chart's timeframe machinery, and that machinery must still exist.
    const m = modalCode()
    for (const token of ['tfb', 'setTF', 'chartTf']) expect(m).not.toContain(token)
    const feeds = fs.readFileSync(path.join(SRC, 'data', 'marketDataFeeds.ts'), 'utf8')
    expect(feeds).toContain('export function setTF')
  })
})
