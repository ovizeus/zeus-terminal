import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { startBrain } from '../brainUI'
import { usePositionsStore } from '../../stores/positionsStore'
import { BM, BRAIN } from '../../core/config'
import { useATStore } from '../../stores/atStore'

// Capat la capat in jsdom: o pozitie REALA apare in store (intrare), dispare
// (iesire), iar serverul raspunde cu randul real de inchidere. Jurnalul trebuie
// sa arate motivul si PnL-ul REALE; nimic inventat.
const w = window as any

function fakeCtx(): any {
  const grad = { addColorStop() {} }
  return new Proxy({}, {
    get(t: any, k) {
      if (k in t) return t[k]
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
  afterEach(() => { stop(); root.remove(); vi.useRealTimers(); vi.unstubAllGlobals() })

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
    expect(q('jr').textContent).toBe('No trades yet. Each entry is captured automatically.')
  })

  it('⛔ trecerea demo → live nu e o inchidere (pozitiile demo doar ies din lista)', async () => {
    frames(10)
    usePositionsStore.setState({ demoPositions: [{ id: 77, sym: 'BTCUSDT', side: 'LONG', entry: 100, sl: 95, tp: 110, size: 1000, pnl: 0, openTs: Date.now(), autoTrade: true }] } as any)
    frames(30)
    useATStore.setState({ mode: 'live' } as any)
    frames(30)
    await vi.advanceTimersByTimeAsync(6000)
    frames(10)
    expect((fetch as any).mock.calls.filter((c: any[]) => String(c[0]).includes('/api/journal')).length).toBe(0)
    useATStore.setState({ mode: 'demo' } as any)
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
    expect(q('allt').textContent).toBe('ALL TRADES (6)')
    q('allx').click()
    expect(modal.style.display).toBe('none')
    vall.click()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(modal.style.display).toBe('none')
  })
})
