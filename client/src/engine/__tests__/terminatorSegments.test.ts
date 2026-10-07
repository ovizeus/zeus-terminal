import { describe, it, expect } from 'vitest'
import { _terminatorSegments } from '../indicators'

// [2026-10-07] Regression guard for the diagonal bug.
// Two long-lived series (one bull, one bear) could not work: a lightweight-charts
// line series joins every point it holds, and neither dropping the inactive bars
// nor pushing them as `{ time }` whitespace broke that — both were tried against
// real klines and both drew long diagonals clear across the chart between
// segments. Splitting the stop line into contiguous same-trend runs, one series
// each, is the only shape that cannot connect across a flip. No unit test would
// have caught the original defect; this one locks in the shape that fixed it.

const bars = (n: number) => Array.from({ length: n }, (_, i) => ({ time: 100 + i }))

describe('_terminatorSegments', () => {
  it('returns nothing while the line is still warming up', () => {
    expect(_terminatorSegments(bars(3), [null, null, null], [null, null, null])).toEqual([])
  })

  it('keeps one unbroken run as a single segment', () => {
    const segs = _terminatorSegments(bars(4), [1, 2, 3, 4], [1, 1, 1, 1])
    expect(segs).toHaveLength(1)
    expect(segs[0].trend).toBe(1)
    expect(segs[0].points).toHaveLength(4)
  })

  it('starts a NEW segment at every flip — never one series spanning both', () => {
    const segs = _terminatorSegments(bars(6), [1, 2, 9, 8, 3, 4], [1, 1, -1, -1, 1, 1])
    expect(segs.map(s => s.trend)).toEqual([1, -1, 1])
    expect(segs.map(s => s.points.length)).toEqual([2, 2, 2])
  })

  it('no two consecutive segments share a trend — that would be a missed break', () => {
    const segs = _terminatorSegments(bars(6), [1, 2, 9, 8, 3, 4], [1, 1, -1, -1, 1, 1])
    for (let i = 1; i < segs.length; i++) expect(segs[i].trend).not.toBe(segs[i - 1].trend)
  })

  it('a flip bar belongs to the NEW segment, so its marker anchors there', () => {
    const segs = _terminatorSegments(bars(4), [1, 9, 8, 7], [1, -1, -1, -1])
    expect(segs[1].points[0].time).toBe(101)
  })

  it('a null in the middle breaks the run rather than bridging it', () => {
    const segs = _terminatorSegments(bars(5), [1, null, 3, 4, 5], [1, 1, 1, 1, 1])
    expect(segs).toHaveLength(2)
    expect(segs[0].points).toHaveLength(1)
    expect(segs[1].points).toHaveLength(3)
  })

  it('every emitted point carries a finite value', () => {
    const segs = _terminatorSegments(bars(6), [1, 2, 9, 8, 3, 4], [1, 1, -1, -1, 1, 1])
    for (const s of segs) for (const p of s.points) expect(Number.isFinite(p.value)).toBe(true)
  })
})
