import { describe, it, expect } from 'vitest'
import { serverCore, serverDecisionLine, serverThoughts, serverStats, serverCognitive } from '../aresStoreSync'

// [SERVER-ARES P3 2026-06-07] Pure derivations that drive the ARES panel from
// the server engine's lastDecision/engine/trajectory snapshot.

describe('serverCore — stateId → badge', () => {
  it('maps known states to label/color/glow (FOCUSED)', () => {
    const c = serverCore('FOCUSED', 0)
    expect(c.id).toBe('FOCUSED')
    expect(c.label).toBe('FOCUSED')
    expect(c.color).toBe('#f0c040')
    expect(c.glow).toBe('#f0c040')
    expect(c.consecutiveLoss).toBe(0)
  })
  it('REVENGE_GUARD label has a space, red color', () => {
    const c = serverCore('REVENGE_GUARD', 3)
    expect(c.label).toBe('REVENGE GUARD')
    expect(c.color).toBe('#ff0044')
    expect(c.consecutiveLoss).toBe(3)
  })
  it('unknown / missing stateId → DETERMINED fallback', () => {
    expect(serverCore(undefined, 0).id).toBe('DETERMINED')
    expect(serverCore('NONSENSE', 0).label).toBe('DETERMINED')
  })
})

describe('serverDecisionLine', () => {
  it('GO decision → green, side, up to 3 reasons', () => {
    const d = serverDecisionLine({ shouldTrade: true, side: 'LONG', reasons: ['a', 'b', 'c', 'd'] })
    expect(d.visible).toBe(true)
    expect(d.shouldTrade).toBe(true)
    expect(d.side).toBe('LONG')
    expect(d.color).toBe('#00ff88')
    expect(d.reasons).toEqual(['a', 'b', 'c'])
  })
  it('HOLD decision → orange, no side, up to 2 reasons', () => {
    const d = serverDecisionLine({ shouldTrade: false, reasons: ['Entry score too low: 40 < 55', 'Confidence too low: 46 < 68', 'x'] })
    expect(d.shouldTrade).toBe(false)
    expect(d.side).toBeNull()
    expect(d.color).toBe('#ff8800')
    expect(d.reasons).toHaveLength(2)
  })
  it('null lastDecision → not visible', () => {
    expect(serverDecisionLine(null).visible).toBe(false)
  })
})

describe('serverThoughts — live stream', () => {
  const srv = {
    lastDecision: { shouldTrade: false, side: null, confidence: 46, stateId: 'FOCUSED', reasons: ['Entry score too low: 40 < 55', 'Confidence too low: 46 < 68'] },
    engine: { winRate10: 60, consecutiveLoss: 0, consecutiveWin: 2, totalTrades: 12 },
    trajectory: { delta: -1.99, daysPassed: 1 },
  }
  it('HOLD: leads with reason, shows state/form/trajectory/server tag', () => {
    const t = serverThoughts(srv)
    expect(t[0]).toContain('HOLD')
    expect(t.some((l) => l.includes('Entry score too low'))).toBe(true)
    expect(t.some((l) => l.includes('STATE: FOCUSED') && l.includes('46%'))).toBe(true)
    expect(t.some((l) => l.includes('WR10 60%') && l.includes('2W streak'))).toBe(true)
    expect(t.some((l) => l.includes('TRAJECTORY: -1.99%') && l.includes('day 1/365'))).toBe(true)
    expect(t.some((l) => l.includes('SERVER-SIDE ENGINE'))).toBe(true)
  })
  it('GO: leads with GO + side + confidence', () => {
    const t = serverThoughts({ ...srv, lastDecision: { shouldTrade: true, side: 'SHORT', confidence: 71, stateId: 'STRATEGIC', reasons: ['Regime: TREND_DOWN', 'Session: NEW YORK'] } })
    expect(t[0]).toContain('GO SHORT')
    expect(t[0]).toContain('71%')
  })
  it('loss streak shown when consecutiveLoss > 0', () => {
    const t = serverThoughts({ ...srv, engine: { winRate10: 30, consecutiveLoss: 2, consecutiveWin: 0, totalTrades: 5 } })
    expect(t.some((l) => l.includes('2L streak'))).toBe(true)
  })
  it('no snapshot → awaiting message', () => {
    expect(serverThoughts(null)[0]).toContain('awaiting')
  })
})

describe('serverStats', () => {
  it('formats day / delta / winRate from snapshot', () => {
    const s = serverStats({ engine: { winRate10: 55 }, trajectory: { delta: 3.2, daysPassed: 4.7 } })
    expect(s.day).toBe('4 / 365')
    expect(s.delta).toBe('+3.2%')
    expect(s.winRate).toBe('55%')
    expect(s.prediction).toBe('—')
  })
  it('negative delta keeps sign', () => {
    expect(serverStats({ engine: {}, trajectory: { delta: -2 } }).delta).toBe('-2%')
  })
})

describe('serverCognitive', () => {
  it('reflects GO/HOLD + confidence vs 68 bar', () => {
    const goLines = serverCognitive({ lastDecision: { shouldTrade: true, side: 'LONG', confidence: 72, stateId: 'MOMENTUM' } }).cogLines
    expect(goLines[0]).toContain('GO LONG')
    expect(goLines[1]).toContain('ABOVE entry bar')
    const holdLines = serverCognitive({ lastDecision: { shouldTrade: false, confidence: 46, stateId: 'FOCUSED' } }).cogLines
    expect(holdLines[0]).toContain('HOLD')
    expect(holdLines[1]).toContain('below 68% bar')
  })
  it('clarity tracks confidence', () => {
    expect(serverCognitive({ lastDecision: { confidence: 72 } }).clarity).toBe(72)
  })
})
