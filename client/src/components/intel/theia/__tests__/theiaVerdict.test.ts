import { describe, it, expect } from 'vitest'
import { computeTheiaVerdict, type TheiaVerdictInput } from '../theiaVerdict'

const healthy: TheiaVerdictInput = {
  circuitOpen: false, halted: false, dataStalled: false, killTriggered: false,
  parityPct: 0.95, regimeStable: true, testnetPnlTrend: 'up',
}

describe('computeTheiaVerdict', () => {
  it('is GREEN when every input is healthy', () => {
    const v = computeTheiaVerdict(healthy)
    expect(v.level).toBe('green')
  })
  it('is RED when a hard safety input fails, and names it', () => {
    expect(computeTheiaVerdict({ ...healthy, circuitOpen: true }).level).toBe('red')
    expect(computeTheiaVerdict({ ...healthy, halted: true }).level).toBe('red')
    expect(computeTheiaVerdict({ ...healthy, dataStalled: true }).level).toBe('red')
    expect(computeTheiaVerdict({ ...healthy, killTriggered: true }).level).toBe('red')
    expect(computeTheiaVerdict({ ...healthy, circuitOpen: true }).reason.toLowerCase()).toContain('circuit')
  })
  it('is AMBER on soft concerns (low parity / unstable regime / declining pnl)', () => {
    expect(computeTheiaVerdict({ ...healthy, parityPct: 0.7 }).level).toBe('amber')
    expect(computeTheiaVerdict({ ...healthy, regimeStable: false }).level).toBe('amber')
    expect(computeTheiaVerdict({ ...healthy, testnetPnlTrend: 'down' }).level).toBe('amber')
  })
  it('RED outranks AMBER (worst input wins)', () => {
    expect(computeTheiaVerdict({ ...healthy, parityPct: 0.7, halted: true }).level).toBe('red')
  })
  it('handles missing/unknown inputs without throwing (null parity, unknown trend)', () => {
    const v = computeTheiaVerdict({ ...healthy, parityPct: null, testnetPnlTrend: 'unknown' })
    expect(['green', 'amber', 'red']).toContain(v.level)
    expect(typeof v.reason).toBe('string')
  })
})
