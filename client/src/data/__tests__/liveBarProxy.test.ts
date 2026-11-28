import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// [2026-11-28] Calea WS_PROXY: fara `market.kline` de la server (fstream blocat pe Hetzner),
// lumanarea de pe ecran trebuie sa se miste din `market.price` si din citirea REST de 10 s.

const feed: Array<(m: any) => void> = []
vi.mock('../../services/ws', () => ({
  subscribe: (fn: any) => { feed.push(fn); return () => {} },
  send: () => true,
}))

const w = window as any
const T0 = Math.floor(Date.now() / 1000 / 300) * 300   // granita curenta de 5m
function payload() {
  return Array.from({ length: 20 }, (_, i) => [(T0 - (19 - i) * 300) * 1000, '100', '101', '99', '100.5', '10'])
}
const push = (m: any) => feed.forEach(fn => fn(m))
let updates: any[] = []

beforeEach(async () => {
  // ceas FIX la un minut dupa granita: altfel o rulare care trece peste granita de 5m schimba lumanarea curenta
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime((T0 + 60) * 1000)
  updates = []
  w.S = { symbol: 'BTCUSDT', chartTf: '5m', klines: [] }
  w.__wsGen = 1
  w.FetchLock = { try: () => true, release: () => {} }
  w.__MF = { WS_PROXY_ENABLED: true, ALT_WS_FEEDS: true, CHART_BACKFILL_ENABLED: false }
  w._applyLatestBar = (b: any) => updates.push(b)
  w.cSeries = { setData: () => {}, update: () => {}, priceToCoordinate: () => 0 }
  w.mainChart = { timeScale: () => ({ fitContent: () => {}, scrollToRealTime: () => {} }), applyOptions: () => {} }
  w.renderChart = () => {}
  ;(await import('../../services/wsMarketBridge')).install()
})
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); try { clearInterval(w.S._proxyKlinePollTimer) } catch (_) {} })

async function boot() {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => payload() })))
  const { fetchKlines } = await import('../marketDataChart')
  await fetchKlines('5m')
  expect(w.S.klines.length).toBe(20)
}

describe('lumanarea live fara flux de lumanari', () => {
  it('PRETUL misca ultima lumanare (close + high)', async () => {
    await boot()
    push({ type: 'market.price', symbol: 'BTCUSDT', price: 105 })
    const last = w.S.klines[w.S.klines.length - 1]
    expect(last.close).toBe(105)
    expect(last.high).toBe(105)
    expect(updates.at(-1)).toMatchObject({ time: T0, close: 105 })
  })
  it('pretul ALTEI monede nu atinge chartul', async () => {
    await boot()
    push({ type: 'market.price', symbol: 'ETHUSDT', price: 3000 })
    expect(updates).toHaveLength(0)
  })
  it('cand vine fluxul real de lumanari, pretul nu-l mai suprascrie', async () => {
    await boot()
    push({ type: 'market.kline', symbol: 'BTCUSDT', tf: '5m', bar: { time: T0, open: 100, high: 102, low: 99, close: 101, volume: 50 } })
    push({ type: 'market.price', symbol: 'BTCUSDT', price: 130 })
    expect(w.S.klines.at(-1).close).toBe(101)
  })
  it('citirea REST de 10 s aduce lumanarea reala (cu volum)', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] }); vi.setSystemTime((T0 + 60) * 1000)
    await boot()
    const real = [[(T0 - 300) * 1000, '100', '101', '99', '100.7', '33'], [T0 * 1000, '100.7', '108', '100', '107', '44']]
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => real })))
    vi.advanceTimersByTime(10000)
    await vi.waitFor(() => expect(w.S.klines.at(-1)).toMatchObject({ time: T0, close: 107, volume: 44 }))
    expect(w.S.klines.at(-2)).toMatchObject({ time: T0 - 300, close: 100.7, volume: 33 })
    expect(w.S.klines.length).toBe(20)
  })
  it('SINCRON cu pretul de sus: citirea REST (din cache, mai veche) nu suprascrie pretul live pe lumanarea curenta', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] }); vi.setSystemTime((T0 + 60) * 1000)
    await boot()
    push({ type: 'market.price', symbol: 'BTCUSDT', price: 105 })
    const real = [[T0 * 1000, '100.7', '108', '99.5', '107', '44']]
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => real })))
    vi.advanceTimersByTime(10000)
    await vi.waitFor(() => expect(w.S.klines.at(-1).volume).toBe(44))
    expect(w.S.klines.at(-1)).toMatchObject({ time: T0, close: 105, high: 108, low: 99.5 })
    expect(updates.at(-1).close).toBe(105)
  })
})
