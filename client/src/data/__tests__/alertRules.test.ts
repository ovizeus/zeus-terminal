/**
 * [2026-11-08] The rules behind the 16 switches that had no reader.
 *
 * Every one of these was a checkbox on screen that did nothing at all. The
 * decisions live here, pure, because a rule buried in a websocket handler is a
 * rule nobody can check — which is how they came to be wired to nothing.
 */
import { describe, it, expect } from 'vitest'
import {
  volumeSpikeRatio, shouldVolAlert, findSwings, findDivergences,
  keepDivergence, rsiExtremeKind, crossedLevels, whaleEvents, keepWhale, canFire,
  emaSeries, macdLine,
} from '../alertRules'

describe('volume spike', () => {
  const flat = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100]

  // The control says "Threshold (BTC per candle)", so the DECISION is absolute
  // volume. The ratio against the average is still measured, for the alert text.
  it('fires at or above the volume the user typed', () => {
    expect(shouldVolAlert(500, 500)).toBe(true)
    expect(shouldVolAlert(812, 500)).toBe(true)
    expect(shouldVolAlert(499, 500)).toBe(false)
  })

  it('a bar in line with the average still measures as 1x', () => {
    expect(volumeSpikeRatio([...flat, 100])).toBeCloseTo(1, 2)
  })

  it('and five times the average measures as 5x', () => {
    expect(volumeSpikeRatio([...flat, 500])).toBeCloseTo(5, 2)
  })

  it('measures the last bar against the ones BEFORE it, not including itself', () => {
    // including the spike in its own average is how a real spike reads as 1.2x
    expect(volumeSpikeRatio([100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 1000])).toBeCloseTo(10, 1)
  })

  it('refuses to guess from too little history, or from nonsense', () => {
    expect(volumeSpikeRatio([100, 200])).toBeNull()
    expect(volumeSpikeRatio([])).toBeNull()
    expect(volumeSpikeRatio([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5])).toBeNull() // no average to compare to
    expect(shouldVolAlert(null, 500)).toBe(false)
    expect(shouldVolAlert(0, 500)).toBe(false)
  })

  it('a missing or silly threshold falls back to the default, not to zero', () => {
    // a 0 threshold would alert on every single bar, so it is a missing value
    expect(shouldVolAlert(200, 0)).toBe(false)
    expect(shouldVolAlert(600, undefined)).toBe(true)
    expect(shouldVolAlert(200, undefined)).toBe(false)
  })
})

describe('swings and divergences', () => {
  // price: higher high, momentum: lower high  -> bearish regular divergence
  const highs = [10, 11, 15, 11, 10, 11, 18, 11, 10]
  const lows = [9, 8, 9, 8, 7, 8, 9, 8, 7]
  const momDown = [50, 55, 70, 55, 50, 55, 60, 55, 50]

  it('finds the swing highs and lows', () => {
    const s = findSwings(highs, lows, 2)
    expect(s.highs).toContain(2)
    expect(s.highs).toContain(6)
    expect(s.lows.length).toBeGreaterThan(0)
  })

  it('a higher price high with a lower momentum high is BEARISH', () => {
    const d = findDivergences(highs, lows, momDown, 2)
    const bear = d.find((x) => x.dir === 'bear')
    expect(bear).toBeTruthy()
    expect(bear?.hidden).toBe(false)
  })

  it('a lower price low with a higher momentum low is BULLISH', () => {
    const h = [10, 11, 12, 11, 10, 11, 12, 11, 10]
    const l = [9, 8, 5, 8, 9, 8, 3, 8, 9]
    const mom = [50, 45, 30, 45, 50, 45, 40, 45, 50]
    const d = findDivergences(h, l, mom, 2)
    expect(d.some((x) => x.dir === 'bull' && !x.hidden)).toBe(true)
  })

  it('a HIDDEN divergence is the mirror image and is marked as such', () => {
    // price lower high, momentum HIGHER high -> hidden bearish
    const h = [10, 11, 18, 11, 10, 11, 15, 11, 10]
    const mom = [50, 55, 60, 55, 50, 55, 70, 55, 50]
    const d = findDivergences(h, lows, mom, 2)
    expect(d.some((x) => x.hidden === true)).toBe(true)
  })

  it('says nothing when price and momentum agree', () => {
    const h = [10, 11, 12, 11, 10, 11, 15, 11, 10]
    const mom = [50, 55, 60, 55, 50, 55, 70, 55, 50]
    expect(findDivergences(h, lows, mom, 2).filter((x) => !x.hidden && x.dir === 'bear')).toEqual([])
  })

  it('survives short or ragged input instead of throwing', () => {
    expect(findDivergences([], [], [], 2)).toEqual([])
    expect(findDivergences([1, 2], [1, 2], [1], 2)).toEqual([])
    expect(findDivergences(highs, lows, [NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN], 2)).toEqual([])
  })
})

describe('which divergences the user actually asked for', () => {
  const bear = { index: 6, prevIndex: 2, dir: 'bear' as const, hidden: false }
  const bull = { index: 6, prevIndex: 2, dir: 'bull' as const, hidden: false }
  const hid = { index: 6, prevIndex: 2, dir: 'bear' as const, hidden: true }

  it('an unset flag means ON, because that is what the panel always showed', () => {
    expect(keepDivergence(bear, {})).toBe(true)
    expect(keepDivergence(bull, {})).toBe(true)
  })

  it('direction filters work and are independent', () => {
    expect(keepDivergence(bear, { divBear: false })).toBe(false)
    expect(keepDivergence(bull, { divBear: false })).toBe(true)
    expect(keepDivergence(bull, { divBull: false })).toBe(false)
  })

  it('hidden ones are OFF unless asked for — that checkbox started unticked', () => {
    expect(keepDivergence(hid, {})).toBe(false)
    expect(keepDivergence(hid, { divHidden: true })).toBe(true)
  })
})

describe('RSI extremes, each end on its own switch', () => {
  it('names the end that was reached', () => {
    expect(rsiExtremeKind(75, {})).toBe('ob')
    expect(rsiExtremeKind(25, {})).toBe('os')
    expect(rsiExtremeKind(50, {})).toBeNull()
  })

  it('respects each side separately', () => {
    expect(rsiExtremeKind(75, { rsiOB: false })).toBeNull()
    expect(rsiExtremeKind(25, { rsiOB: false })).toBe('os')
    expect(rsiExtremeKind(25, { rsiOS: false })).toBeNull()
  })

  it('exactly 70 or 30 is not yet an extreme', () => {
    expect(rsiExtremeKind(70, {})).toBeNull()
    expect(rsiExtremeKind(30, {})).toBeNull()
  })

  it('ignores a missing reading', () => {
    expect(rsiExtremeKind(null, {})).toBeNull()
    expect(rsiExtremeKind(NaN, {})).toBeNull()
  })
})

describe('pivot crossings', () => {
  const levels = [100, 110, 120]

  it('reports the level that was crossed, and the direction', () => {
    expect(crossedLevels(99, 101, levels)).toEqual([{ level: 100, dir: 'up' }])
    expect(crossedLevels(121, 119, levels)).toEqual([{ level: 120, dir: 'down' }])
  })

  it('reports every level jumped in one move', () => {
    expect(crossedLevels(99, 121, levels).map((x) => x.level)).toEqual([100, 110, 120])
  })

  it('touching a level is not crossing it', () => {
    expect(crossedLevels(99, 100, levels)).toEqual([])
    expect(crossedLevels(100, 100, levels)).toEqual([])
  })

  it('says nothing without two real prices', () => {
    expect(crossedLevels(null, 101, levels)).toEqual([])
    expect(crossedLevels(99, null, levels)).toEqual([])
    expect(crossedLevels(99, 101, [])).toEqual([])
  })
})

describe('whale orders in the book', () => {
  const prev = [{ p: 100, q: 5 }, { p: 99, q: 400 }]
  const cur = [{ p: 100, q: 5 }, { p: 99, q: 400 }]

  it('a big new bid is a bullish ADD', () => {
    const ev = whaleEvents(prev, [{ p: 100, q: 5 }, { p: 99, q: 400 }, { p: 98, q: 300 }], [], [], 100)
    expect(ev).toEqual([{ side: 'bid', kind: 'added', price: 98, qty: 300 }])
  })

  it('a big bid that disappears is a REMOVE', () => {
    const ev = whaleEvents(prev, [{ p: 100, q: 5 }], [], [], 100)
    expect(ev).toEqual([{ side: 'bid', kind: 'removed', price: 99, qty: 400 }])
  })

  it('a big new ask is a bearish add', () => {
    const ev = whaleEvents([], [], [{ p: 101, q: 10 }], [{ p: 101, q: 10 }, { p: 102, q: 250 }], 100)
    expect(ev).toEqual([{ side: 'ask', kind: 'added', price: 102, qty: 250 }])
  })

  it('ignores anything under the minimum size', () => {
    expect(whaleEvents(prev, [...cur, { p: 98, q: 99 }], [], [], 100)).toEqual([])
  })

  it('ignores a level that merely changed a little', () => {
    expect(whaleEvents([{ p: 99, q: 400 }], [{ p: 99, q: 420 }], [], [], 100)).toEqual([])
  })

  it('a level growing INTO whale size counts as an add', () => {
    expect(whaleEvents([{ p: 99, q: 10 }], [{ p: 99, q: 500 }], [], [], 100))
      .toEqual([{ side: 'bid', kind: 'added', price: 99, qty: 500 }])
  })

  it('survives a missing or malformed book', () => {
    expect(whaleEvents(null, null, null, null, 100)).toEqual([])
    expect(whaleEvents([{} as never], [{ p: NaN, q: NaN }], [], [], 100)).toEqual([])
  })

  it('an unusable minimum falls back to the default instead of alerting on dust', () => {
    const tiny = whaleEvents([], [{ p: 1, q: 5 }], [], [], 0)
    expect(tiny).toEqual([])
  })
})

describe('which whale events the user asked for', () => {
  const bidAdd = { side: 'bid' as const, kind: 'added' as const, price: 1, qty: 500 }
  const askAdd = { side: 'ask' as const, kind: 'added' as const, price: 1, qty: 500 }
  const bidRem = { side: 'bid' as const, kind: 'removed' as const, price: 1, qty: 500 }

  it('unset flags mean ON for adds, as the panel always showed', () => {
    expect(keepWhale(bidAdd, {})).toBe(true)
    expect(keepWhale(askAdd, {})).toBe(true)
  })

  it('each side can be switched off on its own', () => {
    expect(keepWhale(bidAdd, { whaleBid: false })).toBe(false)
    expect(keepWhale(askAdd, { whaleBid: false })).toBe(true)
    expect(keepWhale(askAdd, { whaleAsk: false })).toBe(false)
  })

  it('removals are OFF unless asked for — that checkbox started unticked', () => {
    expect(keepWhale(bidRem, {})).toBe(false)
    expect(keepWhale(bidRem, { whaleRem: true })).toBe(true)
  })

  it('a removal still respects the side switch', () => {
    expect(keepWhale(bidRem, { whaleRem: true, whaleBid: false })).toBe(false)
  })
})

describe('the cooldown that keeps an alert from becoming noise', () => {
  it('fires once, then holds', () => {
    const last: Record<string, number> = {}
    expect(canFire(last, 'k', 1000, 5000)).toBe(true)
    expect(canFire(last, 'k', 2000, 5000)).toBe(false)
    expect(canFire(last, 'k', 6500, 5000)).toBe(true)
  })

  it('keys are independent', () => {
    const last: Record<string, number> = {}
    expect(canFire(last, 'a', 1000, 5000)).toBe(true)
    expect(canFire(last, 'b', 1000, 5000)).toBe(true)
  })

  it('a clock that goes backwards does not lock an alert out forever', () => {
    const last: Record<string, number> = {}
    canFire(last, 'k', 10_000, 5000)
    expect(canFire(last, 'k', 1000, 5000)).toBe(true)
  })
})

describe('momentum series used for divergences', () => {
  it('an EMA of a flat series is that value', () => {
    const e = emaSeries(new Array(30).fill(10), 12)
    expect(e[29]).toBeCloseTo(10, 6)
  })

  it('is NaN until there are enough bars to mean anything', () => {
    const e = emaSeries([1, 2, 3], 12)
    expect(e.every((v) => Number.isNaN(v))).toBe(true)
    const e2 = emaSeries(new Array(30).fill(5), 12)
    expect(Number.isNaN(e2[10])).toBe(true)
    expect(Number.isFinite(e2[11])).toBe(true)
  })

  it('follows a rise without overshooting it', () => {
    const vals = Array.from({ length: 60 }, (_, i) => 100 + i)
    const e = emaSeries(vals, 12)
    expect(e[59]).toBeLessThan(159)
    expect(e[59]).toBeGreaterThan(145)
  })

  it('MACD is zero on a flat market and positive on a rising one', () => {
    expect(macdLine(new Array(60).fill(10))[59]).toBeCloseTo(0, 6)
    const rising = Array.from({ length: 60 }, (_, i) => 100 + i * 2)
    expect(macdLine(rising)[59]).toBeGreaterThan(0)
  })

  it('does not throw on ragged input', () => {
    expect(() => macdLine([])).not.toThrow()
    expect(() => macdLine([1, null, 3, undefined] as never)).not.toThrow()
  })
})
