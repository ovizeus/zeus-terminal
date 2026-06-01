import { describe, it, expect } from 'vitest'
import { computeManualClosedStats } from '../manualStats'

const J = [
  { id: 1, autoTrade: false, mode: 'live', journalEvent: 'CLOSE', pnl: 886.8, closedAt: 100 }, // manual live win
  { id: 2, autoTrade: false, mode: 'live', journalEvent: 'CLOSE', pnl: -5, closedAt: 200 },     // manual live loss
  { id: 3, autoTrade: true, mode: 'live', journalEvent: 'CLOSE', pnl: 100, closedAt: 300 },     // AUTO → excluded
  { id: 4, autoTrade: false, mode: 'demo', journalEvent: 'CLOSE', pnl: 50, closedAt: 400 },     // demo → excluded in live
  { id: 5, autoTrade: false, mode: 'live', journalEvent: 'OPEN', pnl: 0, openTs: 500 },         // open → excluded
]

describe('computeManualClosedStats — stats coincide with the displayed journal', () => {
  it('live mode: only manual + live + closed trades', () => {
    const s = computeManualClosedStats(J, 'live')
    expect(s.trades).toBe(2)
    expect(s.pnl).toBeCloseTo(881.8)
    expect(s.wr).toBe('50%')
    expect(s.pnlClass).toBe('pos')
    expect(s.entries.length).toBe(2)
    expect(s.entries.map((e) => e.id)).toEqual([2, 1]) // newest (closedAt 200) first
  })

  it('demo mode: only manual + demo + closed trades', () => {
    const s = computeManualClosedStats(J, 'demo')
    expect(s.trades).toBe(1)
    expect(s.pnl).toBe(50)
    expect(s.wr).toBe('100%')
  })

  it('trades count == displayed entries length (coincidence invariant)', () => {
    const s = computeManualClosedStats(J, 'live')
    expect(s.trades).toBe(s.entries.length)
  })

  it('empty / non-array journal → zeros', () => {
    expect(computeManualClosedStats([], 'live')).toMatchObject({ trades: 0, pnl: 0, wr: '0%', pnlClass: 'neut' })
    expect(computeManualClosedStats(undefined as any, 'demo').trades).toBe(0)
  })
})
