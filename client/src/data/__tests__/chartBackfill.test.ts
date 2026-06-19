import { describe, it, expect } from 'vitest'
import {
  _shouldTriggerBackfill, _mergeOlderKlines, _computeRestoredRange, _nextEndTime,
  MAX_BARS, EDGE_THRESHOLD, FETCH_LIMIT,
} from '../chartBackfill'

const bar = (t: number) => ({ time: t, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 })

describe('_shouldTriggerBackfill', () => {
  const base = { from: 2, klinesLen: 1000, inFlight: false, exhausted: false, enabled: true, maxBars: MAX_BARS, edgeThreshold: EDGE_THRESHOLD }
  it('triggers when near the left edge and all clear', () => {
    expect(_shouldTriggerBackfill(base)).toBe(true)
  })
  it('does not trigger when disabled', () => {
    expect(_shouldTriggerBackfill({ ...base, enabled: false })).toBe(false)
  })
  it('does not trigger when a fetch is already in flight', () => {
    expect(_shouldTriggerBackfill({ ...base, inFlight: true })).toBe(false)
  })
  it('does not trigger when exhausted', () => {
    expect(_shouldTriggerBackfill({ ...base, exhausted: true })).toBe(false)
  })
  it('does not trigger at or above the bar cap', () => {
    expect(_shouldTriggerBackfill({ ...base, klinesLen: MAX_BARS })).toBe(false)
  })
  it('does not trigger when not near the edge', () => {
    expect(_shouldTriggerBackfill({ ...base, from: EDGE_THRESHOLD + 5 })).toBe(false)
  })
  it('does not trigger with empty klines or null range', () => {
    expect(_shouldTriggerBackfill({ ...base, klinesLen: 0 })).toBe(false)
    expect(_shouldTriggerBackfill({ ...base, from: null as any })).toBe(false)
  })
})

describe('_mergeOlderKlines', () => {
  it('prepends older bars and keeps strictly ascending unique times', () => {
    const older = [bar(100), bar(200), bar(300)]
    const current = [bar(300), bar(400)] // 300 overlaps boundary
    const merged = _mergeOlderKlines(older, current)
    expect(merged.map(b => b.time)).toEqual([100, 200, 300, 400])
  })
  it('returns current unchanged when older is empty', () => {
    const current = [bar(300), bar(400)]
    expect(_mergeOlderKlines([], current)).toEqual(current)
  })
  it('drops any older bar at or beyond the current boundary', () => {
    const older = [bar(100), bar(300), bar(500)] // 300 and 500 >= current[0]=300
    const current = [bar(300), bar(400)]
    expect(_mergeOlderKlines(older, current).map(b => b.time)).toEqual([100, 300, 400])
  })
})

describe('_computeRestoredRange', () => {
  it('shifts both bounds by the prepended count', () => {
    expect(_computeRestoredRange({ from: 2, to: 50 }, 1000)).toEqual({ from: 1002, to: 1050 })
  })
  it('is null-safe', () => {
    expect(_computeRestoredRange(null, 1000)).toBeNull()
  })
})

describe('_nextEndTime', () => {
  it('returns the oldest bar time in ms minus 1', () => {
    expect(_nextEndTime(1700)).toBe(1700 * 1000 - 1)
  })
})

describe('constants', () => {
  it('are set to the agreed values', () => {
    expect(MAX_BARS).toBe(5000)
    expect(EDGE_THRESHOLD).toBe(12)
    expect(FETCH_LIMIT).toBe(1000)
  })
})
