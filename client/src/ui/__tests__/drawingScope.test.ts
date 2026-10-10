import { describe, it, expect } from 'vitest'

// [R11 2026-10-10] Chart drawings were one GLOBAL set. drawingTools._save wrote
// no symbol, the restore ran once at init, setSymbol never touched drawings and
// clearAll was only the manual button — so a trendline drawn on BTC stayed drawn
// on ETH, at BTC's price levels.
//
// Found while preparing P15 (syncing drawings across devices). Syncing them as
// they were would have carried the mixture to every device instead of fixing it,
// so the operator agreed to scope per symbol FIRST, then sync.
//
// His chosen migration is variant 1: drawings that already exist have no symbol
// recorded and there is no way to know which chart they were drawn on, so they
// stay visible everywhere. Nothing disappears, and only new drawings are scoped.
// That makes one rule load-bearing: a save must never stamp the CURRENT symbol
// onto a legacy drawing, or the first save on ETH would silently claim all of
// his old lines for ETH and they would vanish from every other chart. That is
// what the serialisation tests below are really protecting.
//
// This module is the pure half, extracted so the decision is testable at all:
// drawingTools.ts is an IIFE that needs a live chart.

import { belongsToSymbol, forSymbol, serializeLine, serializeLines, mergeForSave, capForSync } from '../drawingScope'

const legacy = { id: 1, type: 'hline', color: '#f0c040', width: 2, style: 0, price: 61234.5 }
const onBtc = { ...legacy, id: 2, sym: 'BTCUSDT' }
const onEth = { ...legacy, id: 3, sym: 'ETHUSDT' }

describe('which drawings belong on the chart in front of you', () => {
  it('keeps a drawing that has no symbol visible on every symbol', () => {
    // The migration guarantee. Nothing he already drew may disappear.
    expect(belongsToSymbol(legacy, 'BTCUSDT')).toBe(true)
    expect(belongsToSymbol(legacy, 'ETHUSDT')).toBe(true)
    expect(belongsToSymbol(legacy, 'SOLUSDT')).toBe(true)
  })

  it('shows a scoped drawing on its own symbol', () => {
    expect(belongsToSymbol(onBtc, 'BTCUSDT')).toBe(true)
  })

  it('hides a scoped drawing on any other symbol — the bug itself', () => {
    expect(belongsToSymbol(onBtc, 'ETHUSDT')).toBe(false)
    expect(belongsToSymbol(onEth, 'BTCUSDT')).toBe(false)
  })

  it('treats a blank symbol as legacy rather than as a symbol named ""', () => {
    expect(belongsToSymbol({ sym: '' }, 'BTCUSDT')).toBe(true)
    expect(belongsToSymbol({ sym: '   ' }, 'BTCUSDT')).toBe(true)
  })

  it('filters a mixed set down to legacy plus the current symbol, in order', () => {
    const kept = forSymbol([onBtc, legacy, onEth], 'BTCUSDT')
    expect(kept.map((l) => l.id)).toEqual([2, 1])
  })
})

describe('saving never re-labels a drawing', () => {
  it('does NOT stamp the current symbol onto a legacy drawing', () => {
    // The load-bearing rule of variant 1. Saving while on ETH must leave a
    // symbol-less drawing symbol-less, or it is claimed for ETH and vanishes
    // from every other chart.
    const out = serializeLine(legacy, 'ETHUSDT')
    expect(out.sym).toBeUndefined()
    expect(Object.prototype.hasOwnProperty.call(out, 'sym')).toBe(false)
  })

  it('keeps a drawing on the symbol it was actually drawn on', () => {
    const out = serializeLine(onBtc, 'ETHUSDT')
    expect(out.sym).toBe('BTCUSDT')
  })

  it('keeps the geometry of both drawing types', () => {
    const h = serializeLine({ id: 1, type: 'hline', color: '#fff', width: 3, style: 1, price: 100 }, 'BTCUSDT')
    expect(h).toMatchObject({ type: 'hline', price: 100, width: 3, style: 1 })
    expect(h.p1).toBeUndefined()

    const t = serializeLine({
      id: 2, type: 'tline', color: '#0f0', width: 1, style: 2,
      p1: { time: 10, price: 1 }, p2: { time: 20, price: 2 },
    }, 'BTCUSDT')
    expect(t).toMatchObject({ type: 'tline', p1: { time: 10, price: 1 }, p2: { time: 20, price: 2 } })
    expect(t.price).toBeUndefined()
  })

  it('falls back to the widths and styles the old format used', () => {
    const out = serializeLine({ id: 1, type: 'hline', color: '#fff', price: 1 }, 'BTCUSDT')
    expect(out.width).toBe(2)
    expect(out.style).toBe(0)
  })

  it('carries nextId through untouched so ids never collide after a reload', () => {
    expect(serializeLines([legacy], 'BTCUSDT', 42)).toEqual({
      lines: [{ id: 1, type: 'hline', color: '#f0c040', width: 2, style: 0, price: 61234.5 }],
      nextId: 42,
    })
  })

  it('drops the live chart objects instead of trying to serialise them', () => {
    const withRefs = { ...onBtc, lwcRef: { fake: true }, handles: [{}], delBtn: {}, cfgBtn: {} }
    const out = serializeLine(withRefs, 'BTCUSDT') as Record<string, unknown>
    for (const k of ['lwcRef', 'lwcSeries', 'handles', 'delBtn', 'cfgBtn']) {
      expect(Object.prototype.hasOwnProperty.call(out, k)).toBe(false)
    }
  })
})

describe('saving while scoped never wipes another chart', () => {
  // The trap this scoping creates. Once only the current symbol's drawings are
  // rendered, the in-memory list is a VIEW, not the whole set. A save that
  // serialised just that view would delete every drawing belonging to every
  // other symbol — so drawing one line on ETH would silently destroy all the
  // BTC work. The merge keeps what is not on screen.

  it('drawing on ETH leaves the BTC drawings alone', () => {
    const stored = [onBtc, onEth]
    const liveOnEth = [onEth, { ...legacy, id: 9, sym: 'ETHUSDT', price: 3000 }]
    const out = mergeForSave(stored, liveOnEth, 'ETHUSDT', 10)
    expect(out.lines.find((l) => l.id === 2)).toMatchObject({ sym: 'BTCUSDT' })
    expect(out.lines.map((l) => l.id).sort()).toEqual([2, 3, 9])
  })

  it('keeps legacy drawings, which are on screen for every symbol', () => {
    const stored = [legacy, onBtc]
    const liveOnBtc = [legacy, onBtc]   // both rendered on BTC
    const out = mergeForSave(stored, liveOnBtc, 'BTCUSDT', 3)
    expect(out.lines.map((l) => l.id).sort()).toEqual([1, 2])
    expect(out.lines.find((l) => l.id === 1)!.sym).toBeUndefined()
  })

  it('a drawing deleted on the current symbol really goes away', () => {
    const stored = [onBtc, onEth]
    const out = mergeForSave(stored, [], 'BTCUSDT', 4)   // BTC line deleted
    expect(out.lines.map((l) => l.id)).toEqual([3])
  })

  it('does not duplicate a drawing that is both stored and live', () => {
    const out = mergeForSave([onBtc], [onBtc], 'BTCUSDT', 3)
    expect(out.lines).toHaveLength(1)
  })

  it('survives a missing or malformed stored set', () => {
    expect(mergeForSave(null as never, [onBtc], 'BTCUSDT', 3).lines).toHaveLength(1)
  })
})

describe('capping what goes over the wire (P15)', () => {
  // Drawings are small: 77 bytes for a horizontal line, 144 for a trendline,
  // measured. 200 drawings is 21.6 KB against a 64 KB section ceiling. So the
  // cap is not about size today, it is about never letting an unbounded list
  // grow into a rejected push later.
  const many = (n: number) => Array.from({ length: n }, (_, i) => ({ ...legacy, id: i + 1 }))

  it('sends everything when under the cap', () => {
    const out = capForSync(many(10), 300)
    expect(out.lines).toHaveLength(10)
    expect(out.trimmed).toBe(0)
  })

  it('keeps the NEWEST drawings when over the cap, not the first ones found', () => {
    const out = capForSync(many(305), 300)
    expect(out.lines).toHaveLength(300)
    expect(out.trimmed).toBe(5)
    // ids 6..305 survive; the five oldest are dropped.
    expect(out.lines[0].id).toBe(6)
    expect(out.lines[299].id).toBe(305)
  })

  it('reports how many were left behind so it is never silent', () => {
    expect(capForSync(many(350), 300).trimmed).toBe(50)
  })

  it('survives a missing or malformed set', () => {
    expect(capForSync(null as never, 300)).toEqual({ lines: [], trimmed: 0 })
  })
})
