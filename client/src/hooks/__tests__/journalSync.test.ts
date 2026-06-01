import { describe, it, expect } from 'vitest'
import { serverRowToPanelEntry } from '../useServerSync'

describe('serverRowToPanelEntry — server at_closed row -> bottom-journal entry', () => {
  it('maps a SERVER-side DSL_PL close so it appears in the bottom journal', () => {
    // at_closed rows have NO exitPrice; the exit ~ _lastPrice for server closes.
    const row = {
      seq: 108, symbol: 'BTCUSDT', side: 'SHORT', mode: 'live',
      price: 73385, _lastPrice: 71757.85, closePnl: 886.8, closeReason: 'DSL_PL',
      lev: 20, autoTrade: false, ts: 1, closeTs: 2,
    }
    const e = serverRowToPanelEntry(row)
    expect(e.id).toBe('108')
    expect(e.side).toBe('SHORT')
    expect(e.sym).toBe('BTCUSDT')
    expect(e.entry).toBe(73385)
    expect(e.exit).toBe(71757.85) // _lastPrice fallback
    expect(e.pnl).toBe(886.8)
    expect(e.reason).toBe('DSL_PL')
    expect(e.closedAt).toBe(2)
    expect(e.openTs).toBe(1)
    expect(e.mode).toBe('live')
    expect(e.autoTrade).toBe(false)
    expect(e.journalEvent).toBe('CLOSE')
  })

  it('prefers explicit exitPrice when present (client close)', () => {
    const e = serverRowToPanelEntry({
      seq: 5, symbol: 'ETHUSDT', side: 'LONG', exitPrice: 2000, price: 1950,
      closePnl: 10, closeReason: 'MANUAL_CLIENT', closeTs: 9, mode: 'demo',
    })
    expect(e.exit).toBe(2000)
    expect(e.pnl).toBe(10)
    expect(e.id).toBe('5')
  })
})
