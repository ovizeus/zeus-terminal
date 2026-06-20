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

import { dolos } from '../indicatorCalc'

const H = [10,11,12,13,12.5,12.8,14,14.5,15,14.2,13.8,13.5,14,15.8,13,12.5,12,12.3,12.8,13]
const Lo = [9,10,11,11.5,11,12,12.5,13,13.5,13,12.8,12.5,12.8,13,11,10.5,10,10.8,11.2,11.5]
const Op = [9.5,10.5,11.5,12,12.5,12.5,13,13.5,14,14.5,14,13.5,13,13.2,13.8,11.4,10.9,10.5,11,11.4]
const Cl = [10,11,12,12.5,12,13,13.5,14,14.8,14,13.5,13,13.5,14,11.5,10.8,10.2,11,11.5,12]

describe('dolos', () => {
  it('detects a bear liquidity-trap setup with all 6 elements', () => {
    const r = dolos(H, Lo, Op, Cl, 2)
    expect(r.bias).toBe('bear')
    expect(r.sweep).toEqual({ index: 13, level: 15 })
    expect(r.mss?.index).toBe(14)
    expect(r.ob?.index).toBe(13)
    expect(r.bb?.index).toBe(3)
    expect(r.bos?.index).toBe(8)
    expect(r.target?.level).toBe(10)
  })
  it('detects a bull setup on vertically-flipped data', () => {
    const f = (a: number[]) => a.map((x) => 30 - x)
    const r = dolos(f(Lo), f(H), f(Op), f(Cl), 2)
    expect(r.bias).toBe('bull')
    expect(r.sweep?.index).toBe(13)
  })
  it('returns all-null on flat/no-setup data', () => {
    const flat = new Array(20).fill(100)
    const r = dolos(flat, flat, flat, flat, 2)
    expect(r.bias).toBeNull()
    expect(r.sweep).toBeNull()
    expect(r.ob).toBeNull()
  })
})
