import { describe, it, expect } from 'vitest'
import { dirFactorLive, confNDirectional } from '../fusionMath'

// Lever B — confluence denominator must count only LIVE directional feeds.
// Bug: a dead feed ('neut', e.g. LS from the broken sentiment endpoint) was
// counted in the denominator (always /5), dragging the score down so confluence
// could never exceed ~50 even when every live feed agreed.
describe('dirFactorLive (Lever B — exclude dead feeds from denominator)', () => {
  it('all 5 feeds bull → 1.0', () => {
    expect(dirFactorLive(['bull', 'bull', 'bull', 'bull', 'bull'])).toBe(1)
  })

  it('4 live feeds all bull + 1 neut → 1.0 (dead feed must NOT drag score down)', () => {
    // OLD broken behaviour: 4/5 = 0.8. FIXED: 4/4 = 1.0
    expect(dirFactorLive(['bull', 'bull', 'bull', 'bull', 'neut'])).toBe(1)
  })

  it('3 bull, 1 bear, 1 neut → 0.75 (3 of 4 live)', () => {
    expect(dirFactorLive(['bull', 'bull', 'bull', 'bear', 'neut'])).toBe(0.75)
  })

  it('fail-closed: fewer than 3 live feeds → 0.5 (neutral, do not trust thin data)', () => {
    expect(dirFactorLive(['bull', 'bull', 'neut', 'neut', 'neut'])).toBe(0.5)
  })

  it('all feeds dead → 0.5 (neutral)', () => {
    expect(dirFactorLive(['neut', 'neut', 'neut', 'neut', 'neut'])).toBe(0.5)
  })
})

// Lever C — confN must be direction-aware. Confluence is a bull-magnitude metric
// (high = bullish). The old formula (conf-50)/50 clamped[0,1] only ever rewarded
// LONGs; for a SHORT (low/bearish confluence) it produced 0, so shorts could
// never gain confidence from the confluence axis. That is why an 8% BTC drop
// with DirScore -100 was ignored.
describe('confNDirectional (Lever C — symmetric, direction-aware)', () => {
  it('long + strongly bullish confluence (100) → 1.0', () => {
    expect(confNDirectional(100, 'long')).toBe(1)
  })

  it('long + neutral confluence (50) → 0', () => {
    expect(confNDirectional(50, 'long')).toBe(0)
  })

  it('long + bearish confluence (0) → 0 (bullish metric low, long gets nothing)', () => {
    expect(confNDirectional(0, 'long')).toBe(0)
  })

  it('short + strongly bearish confluence (0) → 1.0 (THE bug fix: shorts gain confidence)', () => {
    // OLD broken behaviour: (0-50)/50 = -1 → clamped 0. FIXED: (50-0)/50 = 1.0
    expect(confNDirectional(0, 'short')).toBe(1)
  })

  it('short + neutral confluence (50) → 0', () => {
    expect(confNDirectional(50, 'short')).toBe(0)
  })

  it('short + bullish confluence (100) → 0 (disagreement, no confidence)', () => {
    expect(confNDirectional(100, 'short')).toBe(0)
  })

  it('neutral direction → 0', () => {
    expect(confNDirectional(80, 'neutral')).toBe(0)
  })
})
