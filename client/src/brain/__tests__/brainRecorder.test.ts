import { describe, it, expect } from 'vitest'
import { matchCloseRow, closeFieldsFrom } from '../brainRecorder'

describe('legarea de randul REAL de inchidere', () => {
  const rows = [
    { seq: 111, symbol: 'BTCUSDT', side: 'LONG', size: 1000, pnl: 24, exitReason: 'HIT_TP', openTs: 5000, closeTs: 9000, entryPrice: 100, exitPrice: 102.4 },
    { seq: 222, symbol: 'ETHUSDT', side: 'SHORT', size: 500, pnl: -6, exitReason: 'DSL_PL', openTs: 7000, closeTs: 9500, entryPrice: 50, exitPrice: null },
  ]
  it('dupa seq', () => {
    expect(matchCloseRow(rows as any, { id: '222', symbol: 'ETH', side: 'SHORT', entryTime: 0 })!.seq).toBe(222)
  })
  it('dupa moneda + parte + ora intrarii, cand id-ul local difera', () => {
    expect(matchCloseRow(rows as any, { id: 'local-9', symbol: 'BTC', side: 'LONG', entryTime: 6000 })!.seq).toBe(111)
    expect(matchCloseRow(rows as any, { id: 'local-9', symbol: 'BTC', side: 'LONG', entryTime: 60_000 })).toBeNull()
  })
  it('PnL % ca in restul Zeus (pnl / size × 100), motivul real', () => {
    expect(closeFieldsFrom(rows[0] as any)).toEqual({ result: 'TP', pnlAbs: 24, pnlPct: 2.4, exitPrice: 102.4, exitTime: 9000, entryPrice: 100 })
    expect(closeFieldsFrom(rows[1] as any)).toMatchObject({ result: 'DSL', pnlPct: -1.2, exitPrice: null })
  })
})

import { capFrames } from '../brainRecorder'
describe('replay pentru tranzactii lungi', () => {
  it('pastreaza totul sub prag', () => {
    const fr = Array.from({ length: 100 }, (_, i) => ({ i, evt: null }))
    expect(capFrames(fr, 1200)).toHaveLength(100)
  })
  it('peste prag: capetele intregi, mijlocul rarit, evenimentele pastrate, ordinea pastrata', () => {
    const fr = Array.from({ length: 4800 }, (_, i) => ({ i, evt: i === 2500 ? 'TP' : null }))
    const out = capFrames(fr, 1200)
    expect(out.length).toBeLessThanOrEqual(1201)
    expect(out[0].i).toBe(0); expect(out[out.length - 1].i).toBe(4799)
    expect(out.some((f) => f.evt === 'TP')).toBe(true)
    expect(out.every((f, k) => k === 0 || f.i > out[k - 1].i)).toBe(true)
  })
})
