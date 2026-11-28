import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// [2026-11-28] Cartea de ordine pe calea WS_PROXY: serverul nu primeste cadre de la fstream (Hetzner),
// deci `market.depth` nu vine. Cat timp tace, clientul citeste /api/market/orderbook la 3 s.

const feed: Array<(m: any) => void> = []
vi.mock('../../services/ws', () => ({
  subscribe: (fn: any) => { feed.push(fn); return () => {} },
  send: () => true,
}))
const push = (m: any) => feed.forEach(fn => fn(m))
const w = window as any
const BOOK = { symbol: 'BTCUSDT', bids: [{ p: 100, q: 2 }], asks: [{ p: 101, q: 3 }], ts: 1 }
let calls: string[] = []

beforeEach(async () => {
  calls = []
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] })
  w.S = { symbol: 'BTCUSDT', bids: [], asks: [], alerts: {}, liqMetrics: { byb: {} } }
  w.__MF = { WS_PROXY_ENABLED: true }
  w.ingestPrice = () => true
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(String(url))
    if (String(url).includes('/api/market/orderbook')) return { ok: true, status: 200, json: async () => BOOK }
    return { ok: false, status: 404, json: async () => ({}) }
  }))
  ;(await import('../../services/wsMarketBridge')).install()
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

const obCalls = () => calls.filter(u => u.includes('/api/market/orderbook'))

describe('cartea de ordine fara flux market.depth', () => {
  it('se citeste prin REST si ajunge in S.bids / S.asks', async () => {
    const { connectBNB } = await import('../marketDataWS')
    connectBNB()
    await vi.advanceTimersByTimeAsync(3100)
    expect(obCalls()[0]).toContain('symbol=BTCUSDT')
    expect(w.S.bids).toEqual(BOOK.bids)
    expect(w.S.asks).toEqual(BOOK.asks)
  })
  it('cand vine fluxul real, citirea REST tace', async () => {
    const { connectBNB } = await import('../marketDataWS')
    connectBNB()
    for (let i = 0; i < 4; i++) {
      push({ type: 'market.depth', symbol: 'BTCUSDT', bids: [{ p: 1, q: 1 }], asks: [{ p: 2, q: 1 }] })
      await vi.advanceTimersByTimeAsync(3000)
    }
    expect(obCalls()).toHaveLength(0)
  })
  it('raspunsul pentru ALTA moneda (schimbata intre timp) e aruncat', async () => {
    const { connectBNB } = await import('../marketDataWS')
    connectBNB()
    w.S.symbol = 'ETHUSDT'
    await vi.advanceTimersByTimeAsync(3100)
    expect(w.S.bids).toEqual([])
  })
  it('o reconectare nu dubleaza citirea (un singur ceas)', async () => {
    const { connectBNB } = await import('../marketDataWS')
    connectBNB(); connectBNB(); connectBNB()
    await vi.advanceTimersByTimeAsync(3100)
    expect(obCalls()).toHaveLength(1)
  })
})
