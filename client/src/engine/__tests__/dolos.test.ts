import { describe, it, expect } from 'vitest'
import { _dolosSwings } from '../indicatorCalc'

describe('_dolosSwings', () => {
  it('finds fractal swing highs and lows (L=2)', () => {
    //            0   1   2   3   4   5
    const highs = [10, 11, 15, 12, 11, 10]
    const lows  = [ 9,  8,  5,  7,  8,  9] // index 2 is both peak high & trough low
    const sw = _dolosSwings(highs, lows, 2)
    expect(sw.find(s => s.index === 2 && s.type === 'H')?.value).toBe(15)
    expect(sw.find(s => s.index === 2 && s.type === 'L')?.value).toBe(5)
    expect(sw.some(s => s.index === 0 || s.index === 5)).toBe(false)
  })
})
