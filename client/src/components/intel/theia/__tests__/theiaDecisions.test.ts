import { describe, it, expect } from 'vitest'
import { _relTime, _decisionColor } from '../theiaDecisions'

describe('_relTime', () => {
  const now = 1_000_000_000_000
  it('shows "now" under 10s', () => {
    expect(_relTime(now - 3_000, now)).toBe('now')
  })
  it('shows seconds, minutes, hours, days', () => {
    expect(_relTime(now - 45_000, now)).toBe('45s ago')
    expect(_relTime(now - 5 * 60_000, now)).toBe('5m ago')
    expect(_relTime(now - 3 * 3_600_000, now)).toBe('3h ago')
    expect(_relTime(now - 2 * 86_400_000, now)).toBe('2d ago')
  })
  it('handles missing/invalid ts', () => {
    expect(_relTime(null as any, now)).toBe('—')
    expect(_relTime(0, now)).toBe('—')
  })
})

describe('_decisionColor', () => {
  it('greens LONG, reds SHORT, dims HOLD/blocked/other', () => {
    expect(_decisionColor('LONG')).toBe('#00d97a')
    expect(_decisionColor('short')).toBe('#ff6680')
    expect(_decisionColor('HOLD')).toBe('#7a9ab8')
    expect(_decisionColor('blocked')).toBe('#7a9ab8')
    expect(_decisionColor(undefined as any)).toBe('#7a9ab8')
  })
})
