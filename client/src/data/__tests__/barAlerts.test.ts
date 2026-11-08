/**
 * [2026-11-08] Each of these switches used to do NOTHING. These tests say what
 * each one now commands, and — just as important — that turning it off is
 * obeyed. A switch that fires regardless is no better than one wired to air.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { checkBarAlerts } from '../barAlerts'

/** Builds klines: [openTime, open, high, low, close, volume]. */
function bars(spec: Array<{ h: number; l: number; c: number; v?: number }>) {
  return spec.map((b, i) => [i * 60000, b.c, b.h, b.l, b.c, b.v ?? 100])
}

/** A long calm market, then the caller tweaks the tail. */
function calm(n = 40, price = 100, vol = 100) {
  return Array.from({ length: n }, (_, i) => ({
    h: price + (i % 2), l: price - (i % 2), c: price, v: vol,
  }))
}

let sent: Array<{ title: string; body: string; tag?: string }>
let last: Record<string, number>
const send = (title: string, body: string, tag?: string) => { sent.push({ title, body, tag }) }

beforeEach(() => { sent = []; last = {} })

const run = (klines: unknown[], alerts: Record<string, unknown>, now = 1_000_000) =>
  checkBarAlerts({ klines, tf: '5m', symbol: 'BTCUSDT', alerts, send, last, now })

describe('the master switch still rules everything', () => {
  it('fires nothing at all when alerts are off', () => {
    const k = bars([...calm(), { h: 101, l: 99, c: 100, v: 99999 }, { h: 101, l: 99, c: 100 }])
    expect(run(k, { enabled: false, volSpike: true })).toEqual([])
    expect(sent).toEqual([])
  })

  it('and nothing on too little data', () => {
    expect(run(bars(calm(4)), { enabled: true })).toEqual([])
  })
})

describe('volume', () => {
  const spike = () => bars([...calm(), { h: 101, l: 99, c: 100, v: 9000 }, { h: 101, l: 99, c: 100, v: 1 }])

  it('fires when a closed bar reaches the threshold, and says how unusual it was', () => {
    const fired = run(spike(), { enabled: true, volSpike: true, volThreshold: 500 })
    expect(fired).toContain('vol')
    expect(sent[0].title).toBe('VOLUME SPIKE')
    expect(sent[0].body).toMatch(/BTCUSDT 5m/)
    expect(sent[0].body).toMatch(/× the usual/)
  })

  it('obeys the switch being turned off', () => {
    expect(run(spike(), { enabled: true, volSpike: false, volThreshold: 500 })).not.toContain('vol')
  })

  it('does not fire on an ordinary bar', () => {
    expect(run(bars(calm()), { enabled: true, volSpike: true, volThreshold: 500 })).not.toContain('vol')
  })

  it('ignores the bar still forming — it is not closed yet', () => {
    // the huge volume is in the LAST row, which is the live candle
    const k = bars([...calm(), { h: 101, l: 99, c: 100, v: 9000 }])
    expect(run(k, { enabled: true, volSpike: true, volThreshold: 500 })).not.toContain('vol')
  })

  it('holds its tongue for the cooldown, then speaks again', () => {
    expect(run(spike(), { enabled: true, volSpike: true, volThreshold: 500 }, 1_000_000)).toContain('vol')
    expect(run(spike(), { enabled: true, volSpike: true, volThreshold: 500 }, 1_060_000)).not.toContain('vol')
    expect(run(spike(), { enabled: true, volSpike: true, volThreshold: 500 }, 1_400_000)).toContain('vol')
  })
})

describe('RSI extremes', () => {
  /** A steady climb drives RSI to the top. */
  const climbing = () => bars(Array.from({ length: 40 }, (_, i) => ({ h: 100 + i * 2 + 1, l: 100 + i * 2 - 1, c: 100 + i * 2 })))
  const falling = () => bars(Array.from({ length: 40 }, (_, i) => ({ h: 200 - i * 2 + 1, l: 200 - i * 2 - 1, c: 200 - i * 2 })))

  it('calls an overbought market overbought', () => {
    const fired = run(climbing(), { enabled: true, rsiAlerts: true })
    expect(fired).toContain('rsi')
    expect(sent.find((s) => s.tag === 'rsi')?.title).toBe('RSI OVERBOUGHT')
  })

  it('and an oversold one oversold', () => {
    run(falling(), { enabled: true, rsiAlerts: true })
    expect(sent.find((s) => s.tag === 'rsi')?.title).toBe('RSI OVERSOLD')
  })

  it('obeys each end on its own switch', () => {
    expect(run(climbing(), { enabled: true, rsiAlerts: true, rsiOB: false })).not.toContain('rsi')
    sent = []; last = {}
    expect(run(falling(), { enabled: true, rsiAlerts: true, rsiOB: false })).toContain('rsi')
    sent = []; last = {}
    expect(run(falling(), { enabled: true, rsiAlerts: true, rsiOS: false })).not.toContain('rsi')
  })

  it('obeys the group switch', () => {
    expect(run(climbing(), { enabled: true, rsiAlerts: false })).not.toContain('rsi')
  })
})

describe('divergences', () => {
  /**
   * Price makes a higher high while momentum fades: a bearish divergence.
   * Built as two rallies, the second one higher but weaker.
   */
  // rollOverBars matters more than it looks: the live bar is dropped before
  // anything is judged, so a swing high needs SWING_WIDTH bars after it INSIDE
  // the closed set before it exists at all. With too few, the high is not yet
  // a pivot; with too many, the divergence is stale. 6 puts it in the window.
  function bearishShape(rollOverBars = 6) {
    const out: Array<{ h: number; l: number; c: number }> = []
    const push = (c: number) => out.push({ h: c + 1, l: c - 1, c })
    // Lead-in: RSI needs 14 bars before it means anything, and the first swing
    // high has to land AFTER that or there is no momentum to compare against.
    // Without this the shape produced no divergence at all.
    for (let i = 0; i < 16; i++) push(100)
    for (let i = 0; i < 12; i++) push(100 + i * 3)        // strong first rally
    for (let i = 0; i < 8; i++) push(136 - i * 3)         // pull back
    for (let i = 0; i < 10; i++) push(112 + i * 3.2)      // higher high, weaker
    for (let i = 0; i < rollOverBars; i++) push(144 - i)  // roll over, then a live bar
    return bars(out)
  }

  it('reports a bearish divergence against RSI', () => {
    const fired = run(bearishShape(), { enabled: true, divergence: true, divMACD: false })
    if (fired.includes('div')) {
      const msg = sent.find((s) => s.tag === 'div')!
      expect(msg.title).toMatch(/DIVERGENCE/)
      expect(msg.body).toMatch(/RSI/)
    } else {
      // The shape must at least be capable of producing one; if not, the test
      // data is wrong rather than the code, and saying so beats passing quietly.
      throw new Error('test shape produced no divergence: ' + JSON.stringify(fired))
    }
  })

  it('does NOT announce a divergence that confirmed long ago', () => {
    // A swing needs SWING_WIDTH bars after it before it can be seen at all, so
    // the window allows for that - but history announced on every poll is the
    // warning flood again. This is the line between the two.
    expect(run(bearishShape(14), { enabled: true, divergence: true, divMACD: false }))
      .not.toContain('div')
  })

  it('obeys the group switch', () => {
    expect(run(bearishShape(), { enabled: true, divergence: false })).not.toContain('div')
  })

  it('obeys the direction switch', () => {
    expect(run(bearishShape(), { enabled: true, divergence: true, divBear: false, divMACD: false }))
      .not.toContain('div')
  })

  it('does not report hidden ones unless asked', () => {
    // every firing here must be a regular one, never a hidden one
    run(bearishShape(), { enabled: true, divergence: true, divMACD: false })
    for (const m of sent.filter((s) => s.tag === 'div')) expect(m.title).not.toMatch(/HIDDEN/)
  })

  it('says nothing on a market where price and momentum agree', () => {
    const agreeing = bars(Array.from({ length: 40 }, (_, i) => ({ h: 100 + i + 1, l: 100 + i - 1, c: 100 + i })))
    expect(run(agreeing, { enabled: true, divergence: true })).not.toContain('div')
  })
})

describe('pivot crossings', () => {
  /** Calm market with a clear swing high at 120, then a close above it. */
  function crossShape() {
    const out: Array<{ h: number; l: number; c: number }> = []
    const push = (c: number, h = c + 1, l = c - 1) => out.push({ h, l, c })
    for (let i = 0; i < 10; i++) push(100)
    push(110, 120, 109)          // swing high at 120
    for (let i = 0; i < 10; i++) push(105)
    push(119)                     // just under
    push(125)                     // closes above the pivot
    push(125)                     // live bar
    return bars(out)
  }

  it('is OFF unless asked for — that checkbox started unticked', () => {
    expect(run(crossShape(), { enabled: true })).not.toContain('pivot')
  })

  it('reports the level and the direction once switched on', () => {
    const fired = run(crossShape(), { enabled: true, pivotAlerts: true })
    expect(fired).toContain('pivot')
    const msg = sent.find((s) => s.tag === 'pivot')!
    expect(msg.title).toBe('PIVOT CROSSED')
    expect(msg.body).toMatch(/above/)
  })

  it('does not fire while price stays between the levels', () => {
    const flat = bars([...calm(30, 105), { h: 106, l: 104, c: 105 }])
    expect(run(flat, { enabled: true, pivotAlerts: true })).not.toContain('pivot')
  })
})

describe('it never takes the feed down with it', () => {
  it('survives garbage rows', () => {
    const junk = [[], [1], null, 'x', { a: 1 }, ...bars(calm(12))] as unknown[]
    expect(() => run(junk, { enabled: true, volSpike: true, divergence: true, pivotAlerts: true })).not.toThrow()
  })

  it('survives a missing settings object', () => {
    expect(() => checkBarAlerts({ klines: bars(calm()), tf: '5m', alerts: null as never, send, last })).not.toThrow()
  })
})
