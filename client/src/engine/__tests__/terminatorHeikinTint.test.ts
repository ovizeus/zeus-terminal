import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { terminatorTintBars } from '../indicatorCalc'

// [2026-10-16] The operator reported for the third time that TERMINATOR's
// colours "don't match". The first two reports were about colours vanishing
// (b260: every settings save was being rejected; b261: the boot restore fought
// a manual timeframe change). This one is different — they do not MATCH.
//
// Cause, established from his stored setting rather than guessed: he is on
// chartType=heikin. indicators.ts tinted the candles only for
// candles|hollow|bars, explicitly excluding Heikin Ashi because "data is
// Heikin-Ashi transformed, not raw klines". And _applyLatestBar branches on
// type, so the heikin branch recomputed the HA series and never reached the
// tint either.
//
// So on his chart the TERMINATOR line and markers were green/magenta while the
// candles kept their ordinary colours. On candles everything matched. That is
// exactly "the colours don't correspond".
//
// The exclusion was solving a real problem the wrong way: the objection was
// that raw klines are not what Heikin Ashi displays — true — but the trend
// array is per-bar and index-aligned, so the tint belongs on the HA bars AFTER
// the transform, not on the klines.

type Bar = { time: number; open: number; high: number; low: number; close: number }

const kl: Bar[] = [
  { time: 1, open: 10, high: 12, low: 9, close: 11 },
  { time: 2, open: 11, high: 14, low: 10, close: 13 },
  { time: 3, open: 13, high: 13.5, low: 11, close: 11.5 },
]
// what _heikinAshi produces for the above, computed by the same formula
const ha: Bar[] = [
  { time: 1, open: 10.5, high: 12, low: 9, close: 10.5 },
  { time: 2, open: 10.5, high: 14, low: 10, close: 12 },
  { time: 3, open: 11.25, high: 13.5, low: 11, close: 12.25 },
]

const UP = '#05E17F'
const DN = '#E547FC'

describe('TERMINATOR tints Heikin Ashi bars too', () => {
  it('colours HA bars by trend, exactly as it does raw candles', () => {
    const out = terminatorTintBars(ha, [1, 1, -1], UP, DN)
    expect(out[0].color).toBe(UP)
    expect(out[1].color).toBe(UP)
    expect(out[2].color).toBe(DN)
  })

  it('does NOT alter the Heikin Ashi values — only the colours', () => {
    // The whole reason heikin was excluded was fear of overwriting the
    // transform. Tinting must be additive.
    const out = terminatorTintBars(ha, [1, -1, 1], UP, DN)
    out.forEach((b, i) => {
      expect(b.open).toBe(ha[i].open)
      expect(b.high).toBe(ha[i].high)
      expect(b.low).toBe(ha[i].low)
      expect(b.close).toBe(ha[i].close)
      expect(b.time).toBe(ha[i].time)
    })
  })

  it('leaves warm-up bars untinted, so the user colours still show there', () => {
    const out = terminatorTintBars(ha, [null, null, 1], UP, DN)
    expect(out[0].color).toBeUndefined()
    expect(out[1].color).toBeUndefined()
    expect(out[2].color).toBe(UP)
  })

  it('is index-aligned: HA produces one bar per kline, same order', () => {
    expect(ha.length).toBe(kl.length)
    ha.forEach((b, i) => expect(b.time).toBe(kl[i].time))
  })
})

describe('the heikin path is actually wired to the tint', () => {
  const IND = readFileSync(join(__dirname, '..', 'indicators.ts'), 'utf8')
  const SW = readFileSync(join(__dirname, '..', '..', 'ui', 'candleTypeSwitcher.ts'), 'utf8')

  // NOTE: the first version searched for the word 'heikin' near the tint call.
  // It PASSED against the unfixed code, because the comment explaining WHY
  // heikin was excluded sits right there. Proximity to a word is not wiring —
  // ninth time this trap caught me tonight. Assert the call shape instead.
  it('the bulk tint covers heikin by tinting the HA bars', () => {
    expect(IND).toMatch(/_terminatorTint\(\s*heikinAshiBars\(/);
  })

  // The transform lives in indicatorCalc, NOT in the UI switcher. Putting it
  // there created indicators -> candleTypeSwitcher -> indicators, a cycle ES
  // modules tolerate but which would leave the colour constants undefined at
  // init. This asserts the neutral home so the cycle cannot come back.
  it('the HA transform lives in the neutral module both sides import', () => {
    const CALC = readFileSync(join(__dirname, '..', 'indicatorCalc.ts'), 'utf8')
    expect(CALC).toMatch(/export function heikinAshiBars/)
  })

  it('no import cycle: the switcher does not import from indicators', () => {
    expect(SW).not.toMatch(/from '\.\.\/engine\/indicators'/)
  })

  it('the live heikin branch tints too, so the newest bar does not drop out', () => {
    const i = SW.indexOf("_currentType === 'heikin'")
    const branch = SW.slice(i, i + 500)
    expect(branch).toMatch(/_termActive|terminatorTintBars/)
  })
})
