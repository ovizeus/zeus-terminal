// [LIQ-PREDICT 2026-10-26] Rubrica PREDICT, randata.
//
// Testele pe sursa dovedesc ca ruta e chemata si ca semnalul se calculeaza
// corect. Nu dovedesc NIMIC despre ce vede operatorul pe telefon — iar ultimele
// cinci buguri ale panoului le-am gasit uitandu-ma la el randat, nu citind cod.
//
// Ce se apara aici, si e lucrul cel mai important din toata lucrarea: UN
// PROCENT NU ARE VOIE SA APARA PE ECRAN cat timp serverul spune ca se
// calibreaza. Operatorul a cerut explicit asta, intrebat.
//
// Ce NU se poate dovedi aici, si o spun: daca arata bine. Aia e judecata lui.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'
import { LiqMapPanel } from '../LiqMapPanel'

const w = window as any
const NOW = Date.now()

const PANEL = {
  map: { buckets: [{ pct: -0.25, price: 79800, longUsd: 2_560_000, shortUsd: 0, n: 11 }], events: 17,
    coverage: { upPct: 1.5, downPct: -1.75 }, since: NOW - 13 * 3600_000, asOf: NOW },
  heat: { cells: [], cols: 90, events: 0, maxUsd: 0, tMin: NOW - 86400_000, tMax: NOW },
  stats: { events: 458, totalUsd: 18_094_325, since: NOW - 13 * 3600_000,
    exchanges: [{ exchange: 'okx', n: 458, usd: 1.8e7 }], days: 90 },
  top: [{ symbol: 'BTCUSDT', n: 97, usd: 18_094_325 }],
}

const sym = (over: any = {}) => ({
  symbol: 'BTCUSDT', price: 80467, at: NOW,
  signal: {
    symbol: 'BTCUSDT', side: 'DOWN', strength: 72, reason: 'shorts burned — remaining fuel sits below',
    longBurnedUsd: 96_650_000, shortBurnedUsd: 241_480_000, imbalance: -0.43, events: 1185,
    target: { price: 79750, usd: 1.24e8, n: 170, pct: -0.89 },
    crowdLongPct: 69, oiChangePct: -1.24,
  },
  windowMs: 86400_000, eventsInWindow: 1185, oldestEventTs: NOW - 13 * 3600_000,
  context: { oiChangePct: -1.24, oiValueUsd: 7.53e9, crowdLongPct: 69, at: NOW },
  horizons: [
    { horizonMs: 3600_000, calibrating: true, pct: null, resolved: 12, hits: 9, need: 30, controlPct: null, lift: null },
    { horizonMs: 4 * 3600_000, calibrating: true, pct: null, resolved: 8, hits: 5, need: 30, controlPct: null, lift: null },
    { horizonMs: 24 * 3600_000, calibrating: true, pct: null, resolved: 3, hits: 1, need: 30, controlPct: null, lift: null },
  ],
  minSamples: 30,
  baseline: { imbalance: 0.428, n: 1186, hours: 13.4, longUsd: 241.5e6, shortUsd: 96.7e6,
    minEvents: 100, minHours: 6, established: true },
  ...over,
})

function mockFetch(predictSymbols: any[]) {
  vi.stubGlobal('fetch', vi.fn(async (url: any) => ({
    ok: true,
    json: async () => (String(url).includes('liq-predict')
      ? { symbols: predictSymbols, at: NOW }
      : PANEL),
  })))
}

beforeEach(() => {
  w.S = { symbol: 'BTCUSDT', price: 80467 }
  mockFetch([sym()])
  ;(HTMLCanvasElement.prototype as any).getContext = () => ({
    setTransform() {}, clearRect() {}, fillRect() {}, beginPath() {}, moveTo() {},
    lineTo() {}, stroke() {}, set fillStyle(_v: any) {}, set strokeStyle(_v: any) {}, set lineWidth(_v: any) {},
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

async function openPredict() {
  const r = render(<LiqMapPanel />)
  await waitFor(() => expect(screen.getByText(/458/)).toBeTruthy())
  fireEvent.click(screen.getByText('PREDICT'))
  await waitFor(() => expect(r.container.querySelector('.zlq-pr-card')).toBeTruthy())
  return r
}

describe('rubrica exista si se deschide', () => {
  it('tabul PREDICT e al patrulea, langa LIVE', async () => {
    // [2026-10-26] Testul cerea EXACT patru taburi. Contractul s-a schimbat
    // fiindca operatorul a cerut al cincilea („acum sus langa predict poti sa
    // faci bookmap"). Actualizat dinadins, cu motivul scris aici — nu ocolit.
    render(<LiqMapPanel />)
    await waitFor(() => expect(screen.getByText(/458/)).toBeTruthy())
    const tabs = Array.from(document.querySelectorAll('.zlq-tab')).map(t => t.textContent)
    expect(tabs).toEqual(['MAP', 'HEATMAP', 'LIVE', 'PREDICT', 'BOOK'])
    expect(tabs[3]).toBe('PREDICT')
  })

  it('randeaza cartonasul cu simbolul si pretul', async () => {
    await openPredict()
    expect(screen.getByText('80,467')).toBeTruthy()
  })

  it('arata DIRECTIA magnetului, nu doar o cifra', async () => {
    await openPredict()
    expect(screen.getByText(/MAGNET ↓ DOWN/)).toBeTruthy()
  })

  it('arata tinta cu distanta in dolari si procente', async () => {
    await openPredict()
    expect(screen.getByText(/79,750/)).toBeTruthy()
    expect(screen.getByText(/-0\.89%/)).toBeTruthy()
  })
})

describe('⛔ PROCENTUL NU APARE CAT TIMP SE CALIBREAZA', () => {
  it('scrie CALIBRATING pe toate trei orizonturile', async () => {
    const { container } = await openPredict()
    const hor = container.querySelector('.zlq-pr-hor')!.textContent || ''
    expect(hor).toMatch(/CALIBRATING 12\/30/)
    expect(hor).toMatch(/CALIBRATING 8\/30/)
    expect(hor).toMatch(/CALIBRATING 3\/30/)
  })

  it('niciun „% hit rate" pe ecran cat timp serverul spune calibrating', async () => {
    const { container } = await openPredict()
    expect(container.querySelector('.zlq-pr-hor')!.textContent).not.toMatch(/hit rate/)
  })

  it('CHIAR DACA serverul trimite un pct, in calibrare NU se afiseaza', async () => {
    // Garda impotriva mea: daca vreodata serverul se strica si trimite pct
    // langa calibrating:true, panoul tot nu are voie sa-l arate.
    mockFetch([sym({ horizons: [
      { horizonMs: 3600_000, calibrating: true, pct: 100, resolved: 3, hits: 3, need: 30 },
    ] })])
    const { container } = await openPredict()
    const hor = container.querySelector('.zlq-pr-hor')!.textContent || ''
    expect(hor).toMatch(/CALIBRATING 3\/30/)
    expect(hor).not.toMatch(/100%/)
  })

  it('cand e MASURAT, procentul apare — DAR cu rata de baza langa el', async () => {
    mockFetch([sym({ horizons: [
      { horizonMs: 3600_000, calibrating: false, pct: 30, resolved: 41, hits: 12, need: 30,
        controlPct: 9, lift: 3.33 },
    ] })])
    const { container } = await openPredict()
    const t = container.querySelector('.zlq-pr-hor')!.textContent || ''
    expect(t).toMatch(/30%/)
    expect(t).toMatch(/9% base/)
    expect(t).toMatch(/×3\.3/)
  })

  it('⛔ 86% cu oglinda la 86% NU se lauda — scrie NO EDGE', async () => {
    // Masurat: o ţinta la -0,58% e atinsa neconditionat in 86% din cazuri pe
    // 24h. Un panou care ar scrie doar „86% hit rate" ar minti prin omisiune.
    mockFetch([sym({ horizons: [
      { horizonMs: 24 * 3600_000, calibrating: false, pct: 86, resolved: 120, hits: 103, need: 30,
        controlPct: 86, lift: 1.0 },
    ] })])
    const { container } = await openPredict()
    const t = container.querySelector('.zlq-pr-hor')!.textContent || ''
    expect(t).toMatch(/86%/)
    expect(t).toMatch(/no edge/i)
  })

  it('linia de baza a simbolului e VIZIBILA, ca „normal for this market" sa fie verificabil', async () => {
    const { container } = await openPredict()
    const t = container.querySelector('.zlq-pr-rows')!.textContent || ''
    expect(t).toMatch(/71% of/)
    expect(t).toMatch(/burned \$ are longs/)
  })
})

describe('cand nu stie, SPUNE ca nu stie', () => {
  it('NO EDGE in loc de o direcţie slaba', async () => {
    mockFetch([sym({ signal: { ...sym().signal, side: 'NONE', strength: 0,
      reason: 'both sides burning evenly — no magnet', target: null } })])
    await openPredict()
    expect(screen.getByText('NO EDGE')).toBeTruthy()
    expect(screen.queryByText(/MAGNET/)).toBeNull()
  })

  it('si spune MOTIVUL — altfel NO EDGE arata ca o defectiune', async () => {
    mockFetch([sym({ signal: { ...sym().signal, side: 'NONE', strength: 0,
      reason: 'both sides burning evenly — no magnet', target: null } })])
    await openPredict()
    expect(screen.getByText(/both sides burning evenly/)).toBeTruthy()
  })

  it('cartonasul fara semnal e estompat, nu ascuns', async () => {
    mockFetch([sym({ signal: { ...sym().signal, side: 'NONE', strength: 0, reason: 'no data', target: null } })])
    const { container } = await openPredict()
    expect(container.querySelector('.zlq-pr-card.flat')).toBeTruthy()
  })

  it('fara tinta cartografiata NU inventeaza una', async () => {
    mockFetch([sym({ signal: { ...sym().signal, target: null } })])
    await openPredict()
    expect(screen.getByText('no mapped cluster')).toBeTruthy()
  })
})

describe('istoricul se spune pe faţa', () => {
  it('13 ore de colectare se scriu ca 13h, nu se lasa impresia de zile', async () => {
    const { container } = await openPredict()
    expect(container.querySelector('.zlq-pr-ft')!.textContent).toMatch(/13h of history/)
  })

  it('numarul de lichidari din spatele semnalului e vizibil', async () => {
    const { container } = await openPredict()
    expect(container.querySelector('.zlq-pr-ft')!.textContent).toMatch(/1,185 liquidations/)
  })
})

describe('rezistenta', () => {
  it('cu ruta picata rubrica randeaza starea goala, nu cade', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: any) => {
      if (String(url).includes('liq-predict')) throw new Error('down')
      return { ok: true, json: async () => PANEL } as any
    }))
    render(<LiqMapPanel />)
    await waitFor(() => expect(screen.getByText(/458/)).toBeTruthy())
    fireEvent.click(screen.getByText('PREDICT'))
    await waitFor(() => expect(screen.getByText(/Prediction/)).toBeTruthy())
  })

  it('context lipsa NU devine „0% long" — o cifra fabricata', async () => {
    mockFetch([sym({ context: { oiChangePct: null, oiValueUsd: null, crowdLongPct: null, at: null } })])
    const { container } = await openPredict()
    const t = container.querySelector('.zlq-pr-rows')!.textContent || ''
    expect(t).toMatch(/crowd unknown/)
    expect(t).toMatch(/OI unknown/)
    expect(t).not.toMatch(/0% long/)
  })

  it('ambele simboluri se randeaza separat', async () => {
    mockFetch([sym(), sym({ symbol: 'ETHUSDT', price: 2650 })])
    const { container } = await openPredict()
    expect(container.querySelectorAll('.zlq-pr-card')).toHaveLength(2)
    expect(screen.getByText('ETHUSDT')).toBeTruthy()
  })

  it('niciun cuvant romanesc in rubrica', async () => {
    const { container } = await openPredict()
    const txt = (container.querySelector('.zlq-pr') as HTMLElement).textContent!.toLowerCase()
    for (const r of ['lichid', 'pretul', 'tinta', 'ţinta', 'putere', 'fara', 'fără', 'ore de', 'zile']) {
      expect(txt).not.toContain(r)
    }
  })
})
