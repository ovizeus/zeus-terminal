import { describe, it, expect } from 'vitest'
import { _indMatchesQuery, _usageBadge } from '../indicatorPicker'

const ema = { id: 'ema', name: 'EMA 50/200', desc: 'Exponential Moving Average', cat: 'trend' }

describe('_indMatchesQuery', () => {
  it('empty query matches everything', () => {
    expect(_indMatchesQuery(ema, '')).toBe(true)
    expect(_indMatchesQuery(ema, '   ')).toBe(true)
  })
  it('matches on name, case-insensitive', () => {
    expect(_indMatchesQuery(ema, 'ema')).toBe(true)
    expect(_indMatchesQuery(ema, 'EMA 50')).toBe(true)
  })
  it('matches on description and category', () => {
    expect(_indMatchesQuery(ema, 'exponential')).toBe(true)
    expect(_indMatchesQuery(ema, 'trend')).toBe(true)
  })
  it('no match returns false', () => {
    expect(_indMatchesQuery(ema, 'volume')).toBe(false)
  })
})

describe('_usageBadge', () => {
  it('returns null for 0 / negative / non-finite (hidden)', () => {
    expect(_usageBadge(0)).toBeNull()
    expect(_usageBadge(-3)).toBeNull()
    expect(_usageBadge(undefined as any)).toBeNull()
  })
  it('returns the count string for >= 1', () => {
    expect(_usageBadge(1)).toBe('1')
    expect(_usageBadge(10)).toBe('10')
  })
})
