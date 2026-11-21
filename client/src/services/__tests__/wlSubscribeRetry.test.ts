import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// [2026-11-21] Abonarea la lista de sus se pierdea cand soclul nu era inca deschis si nu se retrimitea la reconectare.
const sent: any[] = []
let open = false
let listener: ((m: any) => void) | null = null
vi.mock('../ws', () => ({
  send: (m: any) => { if (!open) return false; sent.push(m); return true },
  subscribe: (fn: any) => { listener = fn; return () => {} },
}))
import { subscribeWatchlist, _resetWlForTest } from '../wsMarketBridge'

describe('abonarea la lista de sus (ETH, SOL, BNB, XRP)', () => {
  beforeEach(() => { vi.useFakeTimers(); sent.length = 0; open = false; listener = null; _resetWlForTest() })
  afterEach(() => { vi.useRealTimers() })

  it('soclul inchis la montare → reincearca pana se deschide, o singura data', () => {
    subscribeWatchlist(['ethusdt', 'solusdt'])
    expect(sent).toHaveLength(0)
    vi.advanceTimersByTime(3000)
    expect(sent).toHaveLength(0)
    open = true
    vi.advanceTimersByTime(1000)
    expect(sent).toEqual([{ type: 'market.subscribe.wl', symbols: ['ETHUSDT', 'SOLUSDT'] }])
    vi.advanceTimersByTime(5000)
    expect(sent).toHaveLength(1)
  })

  it('la reconectare (revenire din fundal) se retrimite', () => {
    open = true
    subscribeWatchlist(['BNBUSDT'])
    expect(sent).toHaveLength(1)
    listener!({ type: 'reconnect' })
    expect(sent).toHaveLength(2)
    expect(sent[1].symbols).toEqual(['BNBUSDT'])
  })
})
