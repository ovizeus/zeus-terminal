// [LIQ-PANEL 2026-10-25] Testele de pana acum verificau SURSA: ca pictograma e
// cablata, ca ruta e chemata. Niciunul nu a randat panoul. Deci nimic nu
// dovedea ca se vede, ca se citeste, sau macar ca nu arunca la randare.
//
// Operatorul a cerut „sa se citeasca usor, sa se inteleaga, dinamic, tot
// functional". Ce se poate dovedi aici: ca randeaza, ca scrie ce trebuie, ca
// numerele sunt scurte si nu „$NaN", ca taburile chiar schimba vederea, ca
// live-ul reactioneaza, si ca nu scapa niciun cuvant romanesc pe ecran.
//
// Ce NU se poate dovedi aici si o spun: daca arata BINE. Aia ramane judecata
// lui — testele nu au gust.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { LiqMapPanel } from '../LiqMapPanel'

const w = window as any

const PANEL = {
  map: {
    buckets: [
      { pct: 1.5, price: 81200, longUsd: 0, shortUsd: 450_000, n: 4 },
      { pct: -0.25, price: 79800, longUsd: 2_560_000, shortUsd: 0, n: 11 },
      { pct: -1.75, price: 78600, longUsd: 109_395, shortUsd: 0, n: 2 },
    ],
    events: 17, coverage: { upPct: 1.5, downPct: -1.75 }, since: Date.now() - 3 * 3600_000, asOf: Date.now(),
  },
  heat: {
    cells: [
      { t: 10, pct: 1.5, longUsd: 0, shortUsd: 450_000, n: 4 },
      { t: 42, pct: -0.25, longUsd: 2_560_000, shortUsd: 0, n: 11 },
    ],
    cols: 90, events: 15, maxUsd: 2_560_000, tMin: Date.now() - 86400_000, tMax: Date.now(),
  },
  stats: {
    events: 458, totalUsd: 18_094_325, since: Date.now() - 3 * 3600_000,
    exchanges: [{ exchange: 'gate', n: 300, usd: 1e7 }, { exchange: 'okx', n: 158, usd: 8e6 }], days: 90,
  },
  top: [
    { symbol: 'BTCUSDT', n: 97, usd: 18_094_325 },
    { symbol: 'ETHUSDT', n: 77, usd: 2_787_949 },
    { symbol: 'SOLUSDT', n: 28, usd: 51_663 },
  ],
}

beforeEach(() => {
  w.S = { symbol: 'BTCUSDT', price: 80000 }
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => PANEL })))
  // canvas nu exista in jsdom — panoul nu are voie sa cada din cauza asta
  ;(HTMLCanvasElement.prototype as any).getContext = () => ({
    setTransform() {}, clearRect() {}, fillRect() {}, beginPath() {}, moveTo() {},
    lineTo() {}, stroke() {}, set fillStyle(_v: any) {}, set strokeStyle(_v: any) {}, set lineWidth(_v: any) {},
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

async function open() {
  const r = render(<LiqMapPanel />)
  await waitFor(() => expect(screen.getByText(/458/)).toBeTruthy())
  return r
}

describe('panoul CHIAR se randeaza', () => {
  it('nu arunca, si spune ce e si ce simbol arata', async () => {
    const { container } = await open()
    expect(screen.getByText('LIQUIDATION MAP')).toBeTruthy()
    expect(screen.getByText('BTCUSDT')).toBeTruthy()
    expect(container.querySelector('.zlq')).toBeTruthy()
  })

  it('spune raspicat ca datele sunt MASURATE, nu modelate', async () => {
    await open()
    expect(screen.getByText(/MEASURED/)).toBeTruthy()
  })

  it('cu serverul picat randeaza tot, fara sa cada', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down') }))
    const { container } = render(<LiqMapPanel />)
    await waitFor(() => expect(container.querySelector('.zlq')).toBeTruthy())
    expect(screen.getByText('LIQUIDATION MAP')).toBeTruthy()
  })
})

describe('se citeste usor — exact ce a cerut', () => {
  it('cifrele mari sunt SCURTATE, nu insirate', async () => {
    const { container } = await open()
    const txt = container.textContent || ''
    expect(txt).toMatch(/\$18\.09M/)      // nu „18094325"
    expect(txt).not.toMatch(/18094325/)
  })

  it('NICIODATA „$NaN", „undefined" sau „Infinity" pe ecran', async () => {
    const { container } = await open()
    const txt = container.textContent || ''
    expect(txt).not.toMatch(/NaN|undefined|Infinity|\[object/)
  })

  it('procentele poarta semnul — directia e jumatate din informatie', async () => {
    const { container } = await open()
    expect(container.textContent).toMatch(/\+1\.50%/)
    expect(container.textContent).toMatch(/-1\.75%/)
  })

  it('TOT textul vizibil e in ENGLEZA', async () => {
    const { container } = await open()
    const txt = container.textContent || ''
    expect(txt).not.toMatch(/lichid|acoperire|a[șş]tept|goal[aă]|PRE[ȚŢ]|nicio|eveniment/i)
    expect(txt).toMatch(/HISTORY/)
    expect(txt).toMatch(/liquidations/)
  })

  it('nici ABREVIERILE romanesti nu scapa — prinse randand, nu citind sursa', () => {
    // Testul de sursa trecea cu „7z 30z 90z" („z" = zile) fiindca nu e un
    // CUVANT romanesc. S-a vazut abia cand am randat panoul si m-am uitat la
    // ce iese. Deci regula se pazeste si pe forma scurta, nu doar pe cuvinte.
    const { container } = render(<LiqMapPanel />)
    const txt = container.textContent || ''
    expect(txt).not.toMatch(/\b\d+z\b/)
  })
})

describe('culorile separa cele doua lucruri opuse', () => {
  it('barele de long si de short NU au aceeasi culoare', async () => {
    const { container } = await open()
    const bars = [...container.querySelectorAll('.zlq-bar i')] as HTMLElement[]
    expect(bars.length).toBeGreaterThanOrEqual(3)
    const colors = new Set(bars.map((b) => b.style.background))
    expect(colors.size).toBeGreaterThanOrEqual(2)   // chihlimbar SI cyan
  })

  it('fiecare nivel are pret, procent, bara si valoare — nu doar o bara oarba', async () => {
    const { container } = await open()
    const row = container.querySelector('.zlq-row')!
    expect(row.querySelector('.zlq-px')).toBeTruthy()
    expect(row.querySelector('.zlq-pc')).toBeTruthy()
    expect(row.querySelector('.zlq-bar')).toBeTruthy()
    expect(row.querySelector('.zlq-v')).toBeTruthy()
  })
})

describe('e DINAMIC — reactioneaza', () => {
  it('taburile chiar schimba vederea', async () => {
    const { container } = await open()
    expect(container.querySelector('.zlq-map')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'HEATMAP' }))
    await waitFor(() => expect(container.querySelector('.zlq-heat')).toBeTruthy())
    expect(container.querySelector('.zlq-map')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'LIVE' }))
    await waitFor(() => expect(container.textContent).toMatch(/waiting for a liquidation/))
  })

  it('o lichidare LIVE apare in tape, cu dolari si parte', async () => {
    const { container } = await open()
    fireEvent.click(screen.getByRole('tab', { name: 'LIVE' }))
    await act(async () => {
      window.dispatchEvent(new CustomEvent('zeus:liq', {
        detail: { exchange: 'gate', symbol: 'BTCUSDT', side: 'SELL', p: 80123, vol: 250_000, time: Date.now() },
      }))
    })
    await waitFor(() => expect(container.textContent).toMatch(/\$250\.0K/))
    expect(container.textContent).toMatch(/LONG/)
    expect(container.textContent).toMatch(/gate/)
  })

  it('tape-ul SPUNE ca e toata piata — altfel pare ca e simbolul din antet', async () => {
    // Antetul zice BTCUSDT, scara e BTCUSDT, dar pe tape curg GRVT, RLS, DOOD.
    // Cine se uita presupune ca tot panoul e un singur simbol. Nu filtram —
    // pe BTC ar fi un rand pe minut, moarta — dar spunem ce e.
    const { container } = await open()
    fireEvent.click(screen.getByRole('tab', { name: 'LIVE' }))
    await waitFor(() => expect(container.textContent).toMatch(/ALL MARKETS/))
  })

  it('randurile simbolului ales se VAD in fluxul general', async () => {
    const { container } = await open()
    fireEvent.click(screen.getByRole('tab', { name: 'LIVE' }))
    await act(async () => {
      window.dispatchEvent(new CustomEvent('zeus:liq', {
        detail: { exchange: 'gate', symbol: 'GRVTUSDT', side: 'BUY', p: 1.2, vol: 5000, time: Date.now() },
      }))
      window.dispatchEvent(new CustomEvent('zeus:liq', {
        detail: { exchange: 'bybit', symbol: 'BTCUSDT', side: 'SELL', p: 80489, vol: 900000, time: Date.now() + 1 },
      }))
    })
    await waitFor(() => expect(container.querySelectorAll('.zlq-tp').length).toBe(2))
    // exact unul e marcat ca fiind simbolul urmarit
    expect(container.querySelectorAll('.zlq-tp.mine').length).toBe(1)
  })

  it('banda de simboluri exista si se poate schimba simbolul', async () => {
    const { container } = await open()
    const btns = [...container.querySelectorAll('.zlq-sym-b')] as HTMLElement[]
    expect(btns.length).toBeGreaterThanOrEqual(3)
    expect(container.textContent).toMatch(/ETH/)
    fireEvent.click(btns.find((b) => b.textContent!.includes('ETH'))!)
    await waitFor(() => {
      const calls = (globalThis.fetch as any).mock.calls.map((c: any[]) => String(c[0]))
      expect(calls.some((u: string) => u.includes('ETHUSDT'))).toBe(true)
    })
  })

  it('ferestrele 7/30/90 chiar cer alta fereastra', async () => {
    await open()
    fireEvent.click(screen.getByText('7D'))
    await waitFor(() => {
      const calls = (globalThis.fetch as any).mock.calls.map((c: any[]) => String(c[0]))
      expect(calls.some((u: string) => u.includes('days=7'))).toBe(true)
    })
  })
})

describe('gol inseamna gol, si o spune', () => {
  it('fara date, explica DE CE — nu lasa impresia de defectiune', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ map: { buckets: [], events: 0, coverage: { upPct: 0, downPct: 0 } }, heat: { cells: [] }, stats: { events: 0, totalUsd: 0, since: 0, exchanges: [] }, top: [] }) })))
    const { container } = render(<LiqMapPanel />)
    await waitFor(() => expect(container.textContent).toMatch(/is empty — and that is an answer/))
    expect(container.textContent).toMatch(/nobody was liquidated/)
    expect(container.textContent).toMatch(/no source yet/)
  })
})

// [RANGE 2026-10-31] „poti face pe timeframe de 24h, 7 zile ca la coinglass si
// 4 ore?" — harta avea doar 7D / 30D / 90D.
describe('intervalele de timp cerute', () => {
  it('cele cinci butoane exista, in ordine', async () => {
    const { container } = render(<LiqMapPanel />)
    await waitFor(() => expect(screen.getByText(/458/)).toBeTruthy())
    const b = Array.from(container.querySelectorAll('.zlq-win button')).map((x) => x.textContent)
    expect(b).toEqual(['4H', '24H', '7D', '30D', '90D'])
  })

  it('⛔ 4H cere serverului PATRU ORE, nu o zi', async () => {
    render(<LiqMapPanel />)
    await waitFor(() => expect(screen.getByText(/458/)).toBeTruthy())
    fireEvent.click(screen.getByText('4H'))
    await waitFor(() => {
      const calls = (globalThis.fetch as any).mock.calls.map((c: any[]) => String(c[0]))
      const last = calls.filter((u: string) => u.includes('liq-panel')).pop() || ''
      const d = Number(new URL('http://x' + last.replace(/^[^?]*/, '')).searchParams.get('days'))
      expect(d * 24).toBeCloseTo(4, 6)
    })
  })

  it('24H cere exact o zi', async () => {
    render(<LiqMapPanel />)
    await waitFor(() => expect(screen.getByText(/458/)).toBeTruthy())
    fireEvent.click(screen.getByText('24H'))
    await waitFor(() => {
      const calls = (globalThis.fetch as any).mock.calls.map((c: any[]) => String(c[0]))
      const last = calls.filter((u: string) => u.includes('liq-panel')).pop() || ''
      expect(last).toMatch(/days=1(&|$)/)
    })
  })

  it('⛔ numarul de lichidari spune PE CE FEREASTRA, altfel sare de la 1.500 la 157.000 fara explicatie', async () => {
    const { container } = render(<LiqMapPanel />)
    await waitFor(() => expect(screen.getByText(/458/)).toBeTruthy())
    // PANEL.stats.days este 90
    expect(container.textContent).toMatch(/last 90D/)
  })

  it('fereastra afisata vine de la SERVER, nu de la butonul apasat', async () => {
    // Serverul margineste la 365 de zile; daca eticheta ar urma butonul, ar
    // scrie altceva decat fereastra pe care s-au numarat randurile.
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, json: async () => ({ ...PANEL, stats: { ...PANEL.stats, days: 1 } }),
    })))
    const { container } = render(<LiqMapPanel />)
    await waitFor(() => expect(screen.getByText(/458/)).toBeTruthy())
    expect(container.textContent).toMatch(/last 24H/)
    expect(container.textContent).not.toMatch(/last 90D/)
  })
})
