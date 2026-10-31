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
  // Mock-ul se purta ca o conserva: intorcea mereu aceeasi forma, oricare ar fi
  // fost cererea. Dar eticheta si butonul de ieşire sunt conduse de datele
  // SERVERULUI (dinadins), deci un mock care nu raspunde la `span` nu putea
  // dovedi nimic despre ele. Acum ecoul exista, ca la server.
  vi.stubGlobal('fetch', vi.fn(async (url: any) => {
    const u = String(url)
    if (u.includes('liq-predict')) return { ok: true, json: async () => ({ symbols: [], at: 0 }) } as any
    const sp = Number(new URL('http://x' + u.replace(/^[^?]*/, '')).searchParams.get('span'))
    const spanPct = sp > 0 ? Math.min(35, sp) : null
    // ⚠️ Acoperirea se TAIE la fereastra cerută, exact ca pe server (se
    // calculeaza din randurile pastrate). Fara asta, harnasamentul ascundea un
    // bug real: reperul de iesire recalculat din acoperire ar fi parut stabil,
    // fiindca acoperirea nu se micsora niciodata.
    const cov = spanPct === null ? PANEL.map.coverage : {
      upPct: Math.min(PANEL.map.coverage.upPct, spanPct),
      downPct: Math.max(PANEL.map.coverage.downPct, -spanPct),
    }
    return { ok: true, json: async () => ({
      ...PANEL, map: { ...PANEL.map, spanPct, coverage: cov },
    }) } as any
  }))
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

// [ZOOM LIQ 2026-10-31] „si fa zoom daa poti pe chart stii ce zic".
describe('zoom pe axa de pret', () => {
  const span = (u: string) => new URL('http://x' + u.replace(/^[^?]*/, '')).searchParams.get('span')
  const lastPanel = () => (globalThis.fetch as any).mock.calls
    .map((c: any[]) => String(c[0])).filter((u: string) => u.includes('liq-panel')).pop() || ''

  it('butonul de fereastra exista si porneste pe FULL', async () => {
    const { container } = render(<LiqMapPanel />)
    await waitFor(() => expect(screen.getByText(/458/)).toBeTruthy())
    const b = container.querySelector('.zlq-span')
    expect(b).toBeTruthy()
    expect(b?.textContent?.trim()).toBe('FULL')
  })

  it('⛔ tap pe un rand din SCARA cere o fereastra de pret', async () => {
    const { container } = render(<LiqMapPanel />)
    await waitFor(() => expect(screen.getByText(/458/)).toBeTruthy())
    expect(span(lastPanel())).toBeNull()
    const row = container.querySelector('.zlq-row') as HTMLElement
    expect(row).toBeTruthy()
    fireEvent.click(row)
    // acoperire +1,5% / -1,75% => prima fereastra 1,75 / 2,5 = 0,7
    await waitFor(() => expect(Number(span(lastPanel()))).toBeCloseTo(0.7, 6))
  })

  it('⛔ tap pe HARTA DE CALDURA cere aceeasi fereastra', async () => {
    const { container } = render(<LiqMapPanel />)
    await waitFor(() => expect(screen.getByText(/458/)).toBeTruthy())
    fireEvent.click(screen.getByText('HEATMAP'))
    const cv = container.querySelector('.zlq-heat canvas') as HTMLElement
    expect(cv).toBeTruthy()
    fireEvent.click(cv)
    await waitFor(() => expect(Number(span(lastPanel()))).toBeCloseTo(0.7, 6))
  })

  it('fiecare tap intra mai adanc', async () => {
    const { container } = render(<LiqMapPanel />)
    await waitFor(() => expect(screen.getByText(/458/)).toBeTruthy())
    const row = container.querySelector('.zlq-row') as HTMLElement
    fireEvent.click(row)
    await waitFor(() => expect(span(lastPanel())).toBeTruthy())
    const s1 = Number(span(lastPanel()))
    fireEvent.click(container.querySelector('.zlq-row') as HTMLElement)
    await waitFor(() => expect(Number(span(lastPanel()))).toBeLessThan(s1))
  })

  it('butonul scoate fereastra din cerere', async () => {
    const { container } = render(<LiqMapPanel />)
    await waitFor(() => expect(screen.getByText(/458/)).toBeTruthy())
    fireEvent.click(container.querySelector('.zlq-row') as HTMLElement)
    await waitFor(() => expect(span(lastPanel())).toBeTruthy())
    fireEvent.click(container.querySelector('.zlq-span') as HTMLElement)
    await waitFor(() => expect(span(lastPanel())).toBeNull())
  })

  it('⛔ eticheta ferestrei vine de la SERVER, nu de la tap', async () => {
    // Serverul margineste fereastra la 35%; daca eticheta ar urma tap-ul, ar
    // scrie altceva decat fereastra pe care s-au numarat randurile.
    vi.stubGlobal('fetch', vi.fn(async (url: any) => {
      if (String(url).includes('liq-predict')) return { ok: true, json: async () => ({ symbols: [], at: 0 }) } as any
      return { ok: true, json: async () => ({ ...PANEL, map: { ...PANEL.map, spanPct: 0.5 } }) } as any
    }))
    const { container } = render(<LiqMapPanel />)
    await waitFor(() => expect(screen.getByText(/458/)).toBeTruthy())
    expect(container.querySelector('.zlq-span')?.textContent?.trim()).toBe('±0.5%')
  })

  it('schimbarea simbolului scoate fereastra — alt simbol, alte distante', async () => {
    const { container } = render(<LiqMapPanel />)
    await waitFor(() => expect(screen.getByText(/458/)).toBeTruthy())
    fireEvent.click(container.querySelector('.zlq-row') as HTMLElement)
    await waitFor(() => expect(span(lastPanel())).toBeTruthy())
    // Banda de simboluri taie sufixul USDT: butonul scrie ETH, nu ETHUSDT.
    // Prima versiune a testului cauta ETHUSDT — testul se inselase, nu codul.
    fireEvent.click(screen.getByText('ETH'))
    await waitFor(() => expect(span(lastPanel())).toBeNull())
  })
})

// ⛔ [ZOOM LIQ 2026-10-31] Gasit RANDAND: serverul trimitea 44 de niveluri la
// ±0,128% si in DOM ajungeau 5. Scara avea pasul FIX 0,25%. Zoom-ul parea sa
// functioneze — butonul scria ±0,128% — si arunca exact rezolutia castigata.
// Deci se verifica DOM-ul, nu functia.
describe('scara deseneaza rezolutia pe care o trimite serverul', () => {
  function fin(bucket: number, stepPct: number, n: number) {
    return {
      ...PANEL,
      map: {
        ...PANEL.map, bucket,
        buckets: Array.from({ length: n }, (_, i) => {
          const pct = Number(((i - Math.floor(n / 2)) * stepPct).toFixed(6))
          return { pct, price: 80000 * (1 + pct / 100), longUsd: 1e5 * (i + 1), shortUsd: 0, n: i + 1 }
        }),
      },
    }
  }

  it('cu treapta de 0,005% se deseneaza toate nivelurile, nu 5', async () => {
    const P = fin(200, 0.005, 21)
    vi.stubGlobal('fetch', vi.fn(async (url: any) => {
      if (String(url).includes('liq-predict')) return { ok: true, json: async () => ({ symbols: [], at: 0 }) } as any
      return { ok: true, json: async () => P } as any
    }))
    const { container } = render(<LiqMapPanel />)
    await waitFor(() => expect(container.querySelectorAll('.zlq-row').length).toBeGreaterThan(0))
    const cuDate = Array.from(container.querySelectorAll('.zlq-row'))
      .filter((r) => r.querySelector('.zlq-bar i'))
    // 20, nu 21: galeata de la 0% se deseneaza in marcajul de PRET, nu ca rand.
    expect(cuDate.length).toBe(20)
    // ...si marcajul de pret NU mai inghite dolarii ei.
    expect(container.querySelector('.zlq-now')?.textContent).toMatch(/\$/)
  })

  it('⛔ marcajul de PRET isi arata dolarii — nu inghite galeata de langa pret', async () => {
    // Bug preexistent: la fereastra plina, galeata de 0% avea 21,7 milioane cu
    // 132 de lichidari in 24h si se desena ca o eticheta goala.
    const P = {
      ...PANEL,
      map: { ...PANEL.map, bucket: 4,
        buckets: [{ pct: 0, price: 80000, longUsd: 21_700_000, shortUsd: 0, n: 132 }] },
    }
    vi.stubGlobal('fetch', vi.fn(async (url: any) => {
      if (String(url).includes('liq-predict')) return { ok: true, json: async () => ({ symbols: [], at: 0 }) } as any
      return { ok: true, json: async () => P } as any
    }))
    const { container } = render(<LiqMapPanel />)
    await waitFor(() => expect(container.querySelector('.zlq-now')).toBeTruthy())
    expect(container.querySelector('.zlq-now')?.textContent).toMatch(/21\.70M/)
  })

  it('fara treapta de la server, scara rămâne pe cea veche si nu crapa', async () => {
    const P = fin(undefined as any, 0.25, 5)
    vi.stubGlobal('fetch', vi.fn(async (url: any) => {
      if (String(url).includes('liq-predict')) return { ok: true, json: async () => ({ symbols: [], at: 0 }) } as any
      return { ok: true, json: async () => P } as any
    }))
    const { container } = render(<LiqMapPanel />)
    await waitFor(() => expect(container.querySelectorAll('.zlq-row').length).toBeGreaterThan(0))
    expect(container.querySelectorAll('.zlq-row').length).toBeGreaterThan(4)
  })
})

// [IESIRE DIN ZOOM 2026-10-31] „zoom pot da mare da mic cum il fac inapoi" —
// se putea doar INTRA; ieşirea era numai „tot inapoi", uşor de ratat.
describe('iesirea din zoom, un pas o data', () => {
  const span = (u: string) => new URL('http://x' + u.replace(/^[^?]*/, '')).searchParams.get('span')
  const lastPanel = () => (globalThis.fetch as any).mock.calls
    .map((c: any[]) => String(c[0])).filter((u: string) => u.includes('liq-panel')).pop() || ''

  it('butonul de ieşire apare DOAR cand e zoom', async () => {
    const { container } = render(<LiqMapPanel />)
    await waitFor(() => expect(screen.getByText(/458/)).toBeTruthy())
    expect(container.querySelector('.zlq-out')).toBeNull()
    fireEvent.click(container.querySelector('.zlq-row') as HTMLElement)
    await waitFor(() => expect(span(lastPanel())).toBeTruthy())
    expect(container.querySelector('.zlq-out')).toBeTruthy()
  })

  it('⛔ doua tapuri inauntru, un pas afara: se intoarce la fereastra de dinainte', async () => {
    const { container } = render(<LiqMapPanel />)
    await waitFor(() => expect(screen.getByText(/458/)).toBeTruthy())
    const row = () => container.querySelector('.zlq-row') as HTMLElement
    fireEvent.click(row())
    await waitFor(() => expect(span(lastPanel())).toBeTruthy())
    const s1 = Number(span(lastPanel()))
    fireEvent.click(row())
    await waitFor(() => expect(Number(span(lastPanel()))).toBeLessThan(s1))
    fireEvent.click(container.querySelector('.zlq-out') as HTMLElement)
    await waitFor(() => expect(Number(span(lastPanel()))).toBeCloseTo(s1, 6))
  })

  it('un pas afara de la primul nivel duce la FULL si butonul dispare', async () => {
    const { container } = render(<LiqMapPanel />)
    await waitFor(() => expect(screen.getByText(/458/)).toBeTruthy())
    fireEvent.click(container.querySelector('.zlq-row') as HTMLElement)
    await waitFor(() => expect(container.querySelector('.zlq-out')).toBeTruthy())
    fireEvent.click(container.querySelector('.zlq-out') as HTMLElement)
    await waitFor(() => expect(span(lastPanel())).toBeNull())
    expect(container.querySelector('.zlq-out')).toBeNull()
  })
})
