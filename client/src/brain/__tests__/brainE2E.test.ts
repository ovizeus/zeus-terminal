import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { startBrain } from '../brainUI'
import { usePositionsStore } from '../../stores/positionsStore'
import { BM, BRAIN } from '../../core/config'
import { useATStore } from '../../stores/atStore'

// Capat la capat in jsdom: o pozitie REALA apare in store (intrare), dispare
// (iesire), iar serverul raspunde cu randul real de inchidere. Jurnalul trebuie
// sa arate motivul si PnL-ul REALE; nimic inventat.
const w = window as any

let clears = 0
function fakeCtx(): any {
  const grad = { addColorStop() {} }
  return new Proxy({}, {
    get(t: any, k) {
      if (k in t) return t[k]
      if (k === 'clearRect') return () => { clears++ }
      if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createConicGradient') return () => grad
      if (k === 'measureText') return () => ({ width: 10 })
      return () => {}
    },
    set(t: any, k, v) { t[k] = v; return true },
  })
}

let rafCbs: Array<(t: number) => void> = []
let tMs = 0
function frames(n: number, stepMs = 16) {
  for (let i = 0; i < n; i++) {
    tMs += stepMs
    vi.setSystemTime(1_800_000_000_000 + tMs)
    const cbs = rafCbs; rafCbs = []
    cbs.forEach((cb) => cb(tMs))
  }
}

describe('creierul v7 — intrare si iesire reale', () => {
  let stop: () => void
  let root: HTMLElement
  let journalRows: any[] = []
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    tMs = 0; vi.setSystemTime(1_800_000_000_000)
    rafCbs = []
    vi.stubGlobal('requestAnimationFrame', (cb: any) => { rafCbs.push(cb); return rafCbs.length })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    HTMLCanvasElement.prototype.getContext = (() => fakeCtx()) as any
    HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AAAA'
    journalRows = []
    vi.stubGlobal('fetch', vi.fn(async (u: string) => ({ ok: true, json: async () => (String(u).includes('/api/journal') ? { ok: true, trades: journalRows } : {}) })))
    w._zeusUserId = '7'
    w.S = { symbol: 'BTCUSDT', profile: 'fast' }
    ;(BM as any).confluenceScore = 70; (BM as any).confMin = 65
    ;(BRAIN as any)._safetyCache = { risk: true, spread: true, cooldown: true, news: true, session: true, noOpposite: true, regime: true }
    ;(BRAIN as any).regime = 'trend'
    w.__zeusBrainAxes = { trend: 0.7, delta: 0.4, flow: 0.6, oi: null, volume: 0.5, funding: 0.2, volatility: 0.4, imbalance: 0.5, momentum: 0.6, sentiment: 0.5, structure: 0.6, liquidity: null, bullCount: 4, bearCount: 1, __ts: Date.now() }
    usePositionsStore.setState({ demoPositions: [], livePositions: [] } as any)
    root = document.createElement('div'); document.body.appendChild(root)
    stop = startBrain(root)
  })
  afterEach(() => { stop(); root.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); useATStore.setState({ mode: 'demo' } as any) })

  const q = (k: string) => document.querySelector(`[data-k="${k}"]`) as HTMLElement

  it('afiseaza valorile reale: CONF 70 / 65, spread necunoscut, ML coming soon', () => {
    frames(5)
    expect(q('conf').textContent).toBe('CONF 70 / 65')
    expect(q('gt').textContent).toBe('GATES 6/6 · 1 unknown')
    expect(q('ml').textContent).toBe('ML coming soon')
    expect(q('mode').textContent).toBe('LONG MODE')
  })

  it('o pozitie reala deschisa si inchisa ajunge in jurnal cu motivul si PnL-ul reale', async () => {
    frames(20)
    usePositionsStore.setState({ demoPositions: [{ id: 1791754241999, sym: 'BTCUSDT', side: 'LONG', entry: 100, sl: 95, tp: 110, size: 1000, pnl: 5, openTs: Date.now(), autoTrade: true }] } as any)
    frames(40)
    expect(q('pos').textContent).toBe('POS BTC LONG')
    expect(q('pnl').textContent).toBe('+0.50%')
    usePositionsStore.setState({ demoPositions: [] } as any)
    journalRows = [{ seq: 1791754241999, symbol: 'BTCUSDT', side: 'LONG', size: 1000, pnl: 24, exitReason: 'HIT_TP', openTs: Date.now() - 1000, closeTs: Date.now(), entryPrice: 100, exitPrice: 102.4 }]
    frames(20)
    await vi.advanceTimersByTimeAsync(10)
    frames(20)
    const jr = q('jr').textContent || ''
    expect(jr).toContain('#1791754241999 BTC LONG · TP +2.40%')
    expect(jr).toContain('before entry:')
    expect(jr).toContain('conf 70')
  })

  it('⛔ inchiderea fara rand pe server NU devine TP/SL — ramane neconfirmata', async () => {
    frames(10)
    usePositionsStore.setState({ demoPositions: [{ id: 42, sym: 'BTCUSDT', side: 'SHORT', entry: 100, sl: 105, tp: 90, size: 1000, pnl: 0, openTs: Date.now(), autoTrade: true }] } as any)
    frames(10)
    usePositionsStore.setState({ demoPositions: [] } as any)
    frames(10)
    await vi.advanceTimersByTimeAsync(6000)
    frames(10)
    expect(q('jr').textContent).toBe('No DEMO trades on the radar coins yet. Each entry is captured automatically.')
  })

  it('⛔ trecerea demo → live nu e o inchidere (pozitiile demo doar ies din lista)', async () => {
    frames(10)
    usePositionsStore.setState({ demoPositions: [{ id: 77, sym: 'BTCUSDT', side: 'LONG', entry: 100, sl: 95, tp: 110, size: 1000, pnl: 0, openTs: Date.now(), autoTrade: true }] } as any)
    frames(30)
    useATStore.setState({ mode: 'live' } as any)
    frames(30)
    await vi.advanceTimersByTimeAsync(6000)
    frames(10)
    // inregistratorul nu cauta o inchidere (cererea lui e limit=60; jurnalul cere istoricul separat)
    expect((fetch as any).mock.calls.filter((c: any[]) => String(c[0]).includes('/api/journal?limit=60')).length).toBe(0)
  })

  it('[2026-11-16] nu deseneaza cand nu e pe ecran, dar inregistreaza mai departe', () => {
    stop(); root.innerHTML = ''
    let cb: any = null
    vi.stubGlobal('IntersectionObserver', class { constructor(f: any) { cb = f } observe() {} disconnect() {} })
    stop = startBrain(root)
    frames(10)
    cb([{ isIntersecting: false }])
    const before = clears
    frames(60)
    expect(clears).toBe(before)                          // niciun cadru desenat
    usePositionsStore.setState({ demoPositions: [{ id: 5, sym: 'BTCUSDT', side: 'LONG', entry: 100, sl: 95, tp: 110, size: 1000, pnl: 0, openTs: Date.now(), autoTrade: true }] } as any)
    frames(40)
    expect(clears).toBeGreaterThan(before)               // dar poza de la intrare tot se face
    cb([{ isIntersecting: true }])
    const b2 = clears; frames(5)
    expect(clears).toBeGreaterThan(b2)
  })

  it('mai mult de 4 tranzactii: View all deschide fereastra, ✕ si Escape o inchid', async () => {
    frames(5)
    for (let k = 0; k < 6; k++) {
      const id = 9000 + k
      usePositionsStore.setState({ demoPositions: [{ id, sym: 'BTCUSDT', side: 'LONG', entry: 100, sl: 95, tp: 110, size: 1000, pnl: 0, openTs: Date.now(), autoTrade: true }] } as any)
      frames(30)   // inregistratorul vede pozitiile la 4 Hz
      usePositionsStore.setState({ demoPositions: [] } as any)
      journalRows = [{ seq: id, symbol: 'BTCUSDT', side: 'LONG', size: 1000, pnl: k % 2 ? 10 : -10, exitReason: k % 2 ? 'HIT_TP' : 'HIT_SL', openTs: Date.now(), closeTs: Date.now() }]
      frames(30)
      await vi.advanceTimersByTimeAsync(10)
      frames(10)
    }
    const vall = document.querySelector('[data-vall]') as HTMLButtonElement
    expect(vall.textContent).toBe('View all trades (6)')
    vall.click()
    const modal = document.querySelector('.zb7-allm') as HTMLElement
    expect(modal.style.display).toBe('flex')
    expect(modal.getAttribute('role')).toBe('dialog')
    expect(document.body.style.overflow).toBe('hidden')
    expect(q('allt').textContent).toBe('DEMO ALL TRADES (6)')
    q('allx').click()
    expect(modal.style.display).toBe('none')
    vall.click()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(modal.style.display).toBe('none')
  })

  it('[pas B] intrare pe SOL cu BTC pe ecran: rand cu motivul, fara poza si fara replay; DOGE nu intra', async () => {
    frames(10)
    usePositionsStore.setState({ demoPositions: [
      { id: 701, sym: 'SOLUSDT', side: 'LONG', entry: 70, sl: 68, tp: 75, size: 500, pnl: 4, openTs: Date.now(), autoTrade: true },
      { id: 702, sym: 'DOGEUSDT', side: 'LONG', entry: 0.05912, sl: 0.058, tp: 0.061, size: 100, pnl: 1, openTs: Date.now(), autoTrade: true },
    ] } as any)
    frames(40)
    await vi.advanceTimersByTimeAsync(10)
    frames(140)                                   // reconstruirea jurnalului (~2 s)
    const jr = q('jr').textContent || ''
    expect(jr).toContain('DEMO #701 SOL LONG · OPEN')
    expect(jr).toContain('+0.80%')                // PnL viu: 4 / 500
    expect(jr).toContain('other symbol on screen (BTC)')
    expect(jr).not.toContain('DOGE')
  })

  it('[pas B] o pozitie deschisa dinainte (aplicatia era inchisa) apare adoptata, cu motivul', async () => {
    usePositionsStore.setState({ demoPositions: [{ id: 801, sym: 'ETHUSDT', side: 'SHORT', entry: 1800, sl: 1850, tp: 1700, size: 1000, pnl: -5, openTs: Date.now() - 3600_000, autoTrade: true }] } as any)
    frames(140)
    await vi.advanceTimersByTimeAsync(10)
    frames(10)
    const jr = q('jr').textContent || ''
    expect(jr).toContain('DEMO #801 ETH SHORT · OPEN')
    expect(jr).toContain('app closed at entry')
  })

  it('[pas B] istoricul de pe server intra pe monedele radarului, din mediul activ, marcat „added from history"', async () => {
    journalRows = [
      { seq: 901, symbol: 'ETHUSDT', side: 'LONG', mode: 'demo', env: 'DEMO', size: 1000, pnl: 12, exitReason: 'HIT_TP', openTs: 1000, closeTs: 2000 },
      { seq: 902, symbol: 'ETHUSDT', side: 'LONG', mode: 'live', env: 'TESTNET', size: 1000, pnl: 12, exitReason: 'HIT_TP', openTs: 1000, closeTs: 2000 },
      { seq: 903, symbol: 'XRPUSDT', side: 'LONG', mode: 'demo', env: 'DEMO', size: 1000, pnl: 12, exitReason: 'HIT_TP', openTs: 1000, closeTs: 2000 },
    ]
    stop(); root.innerHTML = ''
    stop = startBrain(root)
    await vi.advanceTimersByTimeAsync(10)
    frames(140)
    const jr = q('jr').textContent || ''
    expect(jr).toContain('DEMO #901 ETH LONG · TP +1.20%')
    expect(jr).toContain('added from history')
    expect(jr).not.toContain('#902')              // alt mediu
    expect(jr).not.toContain('#903')              // in afara radarului
  })

  it('[pas B] tap pe un rand deschide fereastra de detalii cu valorile reale; ✕ o inchide', async () => {
    journalRows = [{ seq: 911, symbol: 'BTCUSDT', side: 'LONG', mode: 'demo', env: 'DEMO', entryPrice: 100, exitPrice: 102.4, size: 1000, leverage: 5, sl: 95, tp: 110, pnl: 24, exitReason: 'HIT_TP', openTs: 1000, closeTs: 61000, serverScore: 77 }]
    stop(); root.innerHTML = ''
    stop = startBrain(root)
    await vi.advanceTimersByTimeAsync(10)
    frames(140)
    ;(document.querySelector('[data-det="c:911"]') as HTMLElement).click()
    await vi.advanceTimersByTimeAsync(10)
    const d = document.querySelector('.zb7-det') as HTMLElement
    expect(d.style.display).toBe('flex')
    const t = d.textContent || ''
    expect(t).toContain('#911 BTC LONG')
    expect(t).toContain('102.4 calc')
    expect(t).toContain('Server score at entry77')
    expect(t).toContain('+2.40%')
    ;(d.querySelector('[data-k="detx"]') as HTMLElement).click()
    await vi.advanceTimersByTimeAsync(10)
    expect(d.style.display).toBe('none')
  })
})

