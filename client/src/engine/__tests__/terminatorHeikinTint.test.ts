import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { terminatorTintBars, heikinAshiBars } from '../indicatorCalc'

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
// Derived from the REAL transform, not hand-copied. I did hand-compute these
// first and they happened to be right — but a fixture written by the same
// person who writes the assertion proves only that the two agree with each
// other. Deriving it means the test cannot drift from the implementation.
const ha: Bar[] = heikinAshiBars(kl) as Bar[]

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

  // Slices a window to the END of the branch, not a fixed 500 characters. The
  // fixed window broke the moment I added an explanatory comment — the code it
  // was checking got pushed past the cut. A test that fails when you document
  // the thing it tests is a test that punishes the right behaviour.
  it('the live heikin branch tints too, so the newest bar does not drop out', () => {
    const i = SW.indexOf("_currentType === 'heikin'")
    const end = SW.indexOf("} else if", i)
    const branch = SW.slice(i, end > i ? end : i + 1500)
    expect(branch).toMatch(/terminatorTintBars\(/)
    expect(branch).toMatch(/_termActive/)
  })
})

// [2026-10-16] A flaw I introduced in my own fix, caught before he saw it.
//
// The live-tick branch first required w._termTrend.length === haBars.length.
// But a new candle makes klines grow by one while the trend vector is still
// the one from the last full render, so the lengths differ for exactly the
// moment a bar forms — and the whole series would fall back to untinted.
// Every new bar would have flickered the colours off.
//
// terminatorTintBars already handles a short trend array: trend[i] is
// undefined, which is neither 1 nor -1, so that bar simply gets no colour.
// That is the right behaviour — the new bar stays uncoloured until the next
// full render, and every bar before it keeps its tint.
describe('a newly forming bar must not flicker the whole series', () => {
  it('a trend vector SHORTER than the bars tints what it covers', () => {
    const bars = heikinAshiBars([
      { time: 1, open: 10, high: 12, low: 9, close: 11 },
      { time: 2, open: 11, high: 14, low: 10, close: 13 },
      { time: 3, open: 13, high: 13.5, low: 11, close: 11.5 },
    ]) as Bar[]
    const shortTrend = [1, -1] as (1 | -1 | null)[]   // one bar behind
    const out = terminatorTintBars(bars, shortTrend, UP, DN)
    expect(out[0].color).toBe(UP)
    expect(out[1].color).toBe(DN)
    expect(out[2].color).toBeUndefined()   // the new bar, not the whole series
  })

  // Same fixed-window trap as its sibling, and I walked into it twice: the
  // branch is ~1150 characters and the condition sits near the end, so a
  // 700-character slice stopped short of the very line being asserted. It
  // passed against the mutated code. Slice to the branch end instead.
  it('the live branch does not demand an exact length match', () => {
    const SW = readFileSync(join(__dirname, '..', '..', 'ui', 'candleTypeSwitcher.ts'), 'utf8')
    const i = SW.indexOf("_currentType === 'heikin'")
    const end = SW.indexOf("} else if", i)
    const branch = SW.slice(i, end > i ? end : i + 2000)
    expect(branch).toMatch(/_termTrend\.length > 0/)                      // the safe form IS there
    expect(branch).not.toMatch(/_termTrend\.length === _ha\.length/)      // the flickering one is not
  })
})

// [2026-10-16] The other half of the pair, which I missed first time round.
//
// Tinting Heikin Ashi is only half the job: removeTerminatorSeries() hands the
// candles back by re-setting them WITHOUT colour fields, and it did that only
// for candles|hollow|bars — the very same exclusion that caused the original
// complaint. So after my fix, switching TERMINATOR off on Heikin Ashi would
// have left the tinted bars on screen until some later full render.
//
// Fixing one side of a pair and not its twin is the exact pattern this Book
// has been full of for two days, and I walked straight into it.
describe('turning TERMINATOR off clears the tint on Heikin Ashi too', () => {
  const IND = readFileSync(join(__dirname, '..', 'indicators.ts'), 'utf8')
  const body = (() => {
    const i = IND.indexOf('export function removeTerminatorSeries')
    return IND.slice(i, IND.indexOf('\n}', i))
  })()

  it('the cleanup covers heikin, not just the raw candle types', () => {
    expect(body).toMatch(/heikin/)
  })

  it('it restores HA bars through the shared transform, not a second copy', () => {
    expect(body).toMatch(/heikinAshiBars\(/)
  })

  it('it still clears the live-tick flags', () => {
    expect(body).toMatch(/_termActive = false/)
    expect(body).toMatch(/_termTrend/)
  })
})
