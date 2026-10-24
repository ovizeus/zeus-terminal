// [2026-10-24] PROBA CERUTA DE OPERATOR: „pur si simplu apas pe dunga sa o pun si nu
// face nimic. probeaza tu."
//
// Trei runde de reparaturi (b306/b307/b308) si simptomul a rămas. Gaura pe care am
// recunoscut-o singur: nimic nu testa gesturile cap-coada, fiindca drawingTools.ts e
// un IIFE care cere un chart viu. Asta e testul care lipsea — porneste MODULUL REAL
// prin PUNTEA REALA, cu un chart fals, si APASA, exact ca el.
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { registerChart, unregisterChart } from '../../bridge/chartBridge'
import { DRAW_NOTICE_ID } from '../drawNotice'

const KLINES = Array.from({ length: 200 }, (_, i) => ({ time: 1700000000 + i * 60, open: 100, high: 101, low: 99, close: 100 }))
vi.mock('../../services/stateAccessors', () => ({ getKlines: () => KLINES }))
// chartBackfill se agata de scala de timp la registerChart; nu e subiectul probei.
vi.mock('../../data/chartBackfill', () => ({ initBackfill: () => {} }))

const RECT = { left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300, x: 0, y: 0, toJSON: () => ({}) }
const calls: any = { priceLines: 0, lineSeries: 0, previews: 0 }

function fakeRefs() {
  const line = () => ({ setData: () => {}, applyOptions: () => {} })
  const candle: any = {
    createPriceLine: () => { calls.priceLines++; return { applyOptions: () => {} } },
    removePriceLine: () => {},
    coordinateToPrice: (y: number) => 200 - y * 0.1,   // y=0 sus => pret mare sus
    priceToCoordinate: (p: number) => (200 - p) / 0.1,
    applyOptions: () => {},
  }
  const chart: any = {
    // Previzualizarea foloseste tot addLineSeries, cu culoarea semi-transparenta.
    // Daca nu le despart, un test care numara total trece si cand trendline-ul NU se
    // mai pune — prins la mutaţie: mutantul pe mouseup a supravieţuit exact asa.
    addLineSeries: (o: any) => {
      if (o && typeof o.color === 'string' && o.color.length > 7) calls.previews++
      else calls.lineSeries++
      return line()
    },
    removeSeries: () => {},
    timeScale: () => ({ coordinateToLogical: (x: number) => Math.round(x / 2), timeToCoordinate: () => 100 }),
    applyOptions: () => {},
    options: () => ({
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
    }),
  }
  return { chart, candle, volume: line(), ema50: line(), ema200: line(), wma20: line(), wma50: line(), st: line() } as any
}

function touch(el: Element, type: string, x: number, y: number) {
  const ev: any = new Event(type, { bubbles: true, cancelable: true })
  const t = { clientX: x, clientY: y, target: el, identifier: 0 }
  ev.touches = type === 'touchend' ? [] : [t]
  ev.changedTouches = [t]
  el.dispatchEvent(ev)
}

function notice() { return document.getElementById(DRAW_NOTICE_ID)?.textContent || '' }
function press(tool: string) { (window as any).drawToolActivate(tool) }

let mc: Element
let refs: any

beforeAll(async () => {
  try { localStorage.clear() } catch (_) { /* */ }
  document.body.innerHTML = '<section id="csec"><div id="mc"></div></section>'
  mc = document.getElementById('mc')!
  mc.getBoundingClientRect = () => RECT as any
  ;(window as any).S = { symbol: 'BTCUSDT' }
  refs = fakeRefs()
  registerChart(refs)
  await import('../drawingTools')
  // Init-ul modulului se face pe un interval de 300 ms; il lasam sa termine, altfel
  // restaurarea din localStorage cade peste primul desen si il dubleaza.
  await new Promise((r) => setTimeout(r, 420))
})

describe('APAS pe butonul de linie, exact ca operatorul', () => {
  it('unealta se armeaza si o ANUNTA', () => {
    const seen: any[] = []
    const h = (e: any) => seen.push(e.detail && e.detail.tool)
    window.addEventListener('zeus:drawToolChanged', h)
    press('hline')
    window.removeEventListener('zeus:drawToolChanged', h)
    expect(seen).toEqual(['hline'])
  })

  it('o ATINGERE pe chart pune dunga', () => {
    const before = calls.priceLines
    touch(mc, 'touchstart', 200, 150)
    touch(mc, 'touchend', 200, 150)
    expect(calls.priceLines).toBe(before + 1)
  })

  // b308: filtrul de tap rapid arunca atingerile de peste 300 ms, complet si fara
  // nicio reactie. Pe telefon o apasare precisa trece des de 300 ms.
  it('o atingere ATENTA, peste 300 ms, pune si ea dunga', async () => {
    press('hline')
    const before = calls.priceLines
    touch(mc, 'touchstart', 180, 120)
    await new Promise((r) => setTimeout(r, 420))
    touch(mc, 'touchend', 180, 120)
    expect(calls.priceLines).toBe(before + 1)
  })

  it('un CLIC de mouse pune dunga', () => {
    press('hline')
    const before = calls.priceLines
    mc.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 150, clientY: 100 }))
    expect(calls.priceLines).toBe(before + 1)
  })

  // b307: tragerea cu mouse-ul nu exista deloc; se putea doar clic-clic.
  it('o TRAGERE cu mouse-ul pune trendline-ul', () => {
    press('tline')
    const before = calls.lineSeries
    const previewsBefore = calls.previews
    mc.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 60, clientY: 80, button: 0 }))
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 160, clientY: 140 }))
    // previzualizarea trebuie sa porneasca la trecerea pragului...
    expect(calls.previews).toBe(previewsBefore + 1)
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 160, clientY: 140 }))
    // ...dar ce conteaza e ca la RIDICARE apare trendline-ul ADEVARAT
    expect(calls.lineSeries).toBe(before + 1)
  })
})

// RUNDA 5 — fluxul pe care NU l-am testat niciodata, si care e exact ce face el:
// trendline prin DOUA ATINGERI, pe telefon.
describe('TRENDLINE prin doua atingeri, cum face el pe telefon', () => {
  it('prima atingere pune punctul 1, a doua inchide linia', () => {
    press('tline')
    const before = calls.lineSeries
    touch(mc, 'touchstart', 80, 90)     // punctul 1
    touch(mc, 'touchend', 80, 90)
    touch(mc, 'touchstart', 240, 170)   // punctul 2
    touch(mc, 'touchend', 240, 170)
    expect(calls.lineSeries).toBe(before + 1)
  })

  // Cazul pe care l-a lovit: atingere in spatiul GOL din dreapta ultimei lumânari.
  // `coordinateToLogical` da un index peste numarul de bare, `_timeAtX` intorcea
  // `null`, iar punctul 1 nu se punea — fara niciun mesaj, butonul galben, scria in
  // continuare „Click first point".
  it('atingerea dincolo de ultima lumânare se prinde la ea, nu se pierde', () => {
    // Scala raspunde cu un logic MULT peste numarul de bare doar in dreapta — adica
    // spatiul gol de dupa ultima lumânare. In stanga rămâne normala, altfel ambele
    // puncte ar cadea pe aceeasi bara si refuzul ar fi corect, dar din alt motiv.
    refs.chart.timeScale = () => ({
      coordinateToLogical: (x: number) => (x > 300 ? 9999 : Math.round(x / 2)),
      timeToCoordinate: () => 100,
    })
    press('tline')
    const before = calls.lineSeries
    touch(mc, 'touchstart', 380, 90)
    touch(mc, 'touchend', 380, 90)
    touch(mc, 'touchstart', 200, 170)
    touch(mc, 'touchend', 200, 170)
    // Punctul 1 S-A pus (prins la ultima bara), deci a doua atingere inchide linia.
    // Inainte, amandoua atingerile cadeau in gol si nu se intampla NIMIC.
    expect(calls.lineSeries).toBe(before + 1)
  })

  it('cand nici pretul nu se poate citi, se SPUNE, nu se tace', () => {
    const saved = refs.candle.coordinateToPrice
    refs.candle.coordinateToPrice = () => null       // chartul nu da pret
    press('tline')
    touch(mc, 'touchstart', 100, 100)
    touch(mc, 'touchend', 100, 100)
    expect(notice()).toContain('Could not read the price')
    refs.candle.coordinateToPrice = saved
  })
})

// MIEZUL rundei a patra: cauza care a supravieţuit trei runde fiindca era MUTA.
describe('chartul ca CIOT — cazul care tacea', () => {
  it('nu desenează pe un chart dezinregistrat, si SPUNE de ce', () => {
    unregisterChart()
    const before = calls.priceLines
    press('hline')
    expect(calls.priceLines).toBe(before)        // nimic desenat, ca si inainte...
    expect(notice()).toContain('Chart is not ready')   // ...dar acum se vede MOTIVUL
  })

  it('dupa reinregistrare desenul merge iar', () => {
    registerChart(fakeRefs())
    const before = calls.priceLines
    press('hline')
    touch(mc, 'touchstart', 220, 160)
    touch(mc, 'touchend', 220, 160)
    expect(calls.priceLines).toBe(before + 1)
  })
})
