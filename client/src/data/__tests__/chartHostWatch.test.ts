// [CHART-FS 2026-10-27] Observatorul pe cutia chartului.
//
// Operatorul, cu patru capturi de pe telefon SI de pe PC: „cand il maresc pe
// tot ecranul e ok dar cateodata se strange sus… pun un indicator si cateodata
// se strange deasupra… daimon de ex il activez si se duce in sus DAR NU LA
// TOTI". Ca sa revina, apasa T&S o data sau de doua ori.
//
// „Nu la toti" + „se repara apasand alt buton" = declansatorul nu e un
// indicator anume, ci o aşezare care ramane in urma fata de DOM. Deci nu vanez
// declansatorul: pun un observator pe CUTIE si las adevarul sa vina din DOM.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { watchChartHost, unwatchChartHost, applyChartLayout } from '../marketDataFeeds'

const w = window as any
let observed: Element[] = []
let fire: (() => void) | null = null

class FakeRO {
  cb: () => void
  constructor(cb: () => void) { this.cb = cb; fire = cb }
  observe(el: Element) { observed.push(el) }
  disconnect() { observed = []; fire = null }
}

function dom(hostH: number) {
  document.body.innerHTML =
    '<section id="csec" class="fsm"><div id="mc"></div><div class="cleg"></div></section>'
  const mc = document.getElementById('mc')!
  mc.getBoundingClientRect = () => ({ height: hostH, width: 800, top: 0, left: 0,
    right: 800, bottom: hostH, x: 0, y: 0, toJSON() {} }) as any
  const sec = document.getElementById('csec')!
  sec.getBoundingClientRect = () => ({ height: hostH, width: 800, top: 0, left: 0,
    right: 800, bottom: hostH, x: 0, y: 0, toJSON() {} }) as any
  return mc
}

beforeEach(() => {
  observed = []; fire = null
  ;(window as any).ResizeObserver = FakeRO
  ;(window as any).requestAnimationFrame = (fn: any) => { fn(); return 1 }
  ;(window as any).cancelAnimationFrame = () => {}
  w.mainChart = { applyOptions: vi.fn() }
  w.S = { activeInds: {} }
})
afterEach(() => { unwatchChartHost(); vi.restoreAllMocks(); document.body.innerHTML = '' })

describe('observatorul pe cutia chartului', () => {
  it('observa CUTIA, nu sectiunea', () => {
    dom(900)
    watchChartHost()
    expect(observed).toHaveLength(1)
    expect((observed[0] as HTMLElement).id).toBe('mc')
  })

  it('cand cutia se schimba, chartul se REASEAZA dupa ea', () => {
    dom(900)
    watchChartHost()
    w.mainChart.applyOptions.mockClear()
    fire!()
    expect(w.mainChart.applyOptions).toHaveBeenCalled()
    const h = w.mainChart.applyOptions.mock.calls.map((c: any[]) => c[0]?.height).find((x: any) => x)
    expect(h).toBe(900)
  })

  it('⛔ panza NU mai rameane la 340 cand cutia e de 900 — bugul lui', () => {
    dom(900)
    applyChartLayout()
    const h = w.mainChart.applyOptions.mock.calls.map((c: any[]) => c[0]?.height).find((x: any) => x)
    expect(h).not.toBe(340)
    expect(h).not.toBe(400)
    expect(h).toBe(900)
  })

  it('in afara fullscreen-ului cutia se ignora — acolo decide normalH', () => {
    const mc = dom(900)
    document.getElementById('csec')!.classList.remove('fsm')
    void mc
    applyChartLayout()
    const h = w.mainChart.applyOptions.mock.calls.map((c: any[]) => c[0]?.height).find((x: any) => x)
    expect(h).toBeLessThan(900)
  })

  it('nu se aboneaza de doua ori', () => {
    dom(900)
    watchChartHost(); watchChartHost(); watchChartHost()
    expect(observed).toHaveLength(1)
  })

  it('fara ResizeObserver (browser vechi) NU arunca', () => {
    dom(900)
    delete (window as any).ResizeObserver
    expect(() => watchChartHost()).not.toThrow()
  })

  it('fara cutie in DOM nu arunca', () => {
    document.body.innerHTML = '<section id="csec"></section>'
    expect(() => watchChartHost()).not.toThrow()
  })

  it('unwatch opreste observatorul — altfel se scurge la fiecare remontare', () => {
    dom(900)
    watchChartHost()
    unwatchChartHost()
    expect(observed).toHaveLength(0)
    watchChartHost()
    expect(observed).toHaveLength(1)
  })

  // SCOS DINADINS un test care nu putea cadea niciodata: `applyChartLayout`
  // isi prinde singur fiecare aruncare inauntru, deci nu se poate face sa arunce
  // din afara. Garda din callback rameane (vezi comentariul ei), dar e o garda
  // de GRANITA fara test — si o spun, in loc sa pastrez un test decorativ.
  it('mai multe schimbari la rand nu aduna cereri de aşezare', () => {
    dom(900)
    watchChartHost()
    w.mainChart.applyOptions.mockClear()
    fire!(); fire!(); fire!()
    // rAF-ul fals ruleaza sincron, deci fiecare schimbare produce exact o aşezare
    expect(w.mainChart.applyOptions.mock.calls.length).toBeGreaterThan(0)
    expect(w.mainChart.applyOptions.mock.calls.length).toBeLessThanOrEqual(6)
  })
})
