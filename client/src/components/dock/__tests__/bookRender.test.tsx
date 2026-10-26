// [BOOKMAP 2026-10-26] Rubrica BOOK, randata.
//
// Lectia ultimelor doua zile: toate bugurile care au ajuns la operator le-am
// gasit UITANDU-MA la panou, nu citind cod. Si una a plecat chiar in productie
// (serviciul PREDICT mort) fiindca testele citeau TEXTUL sursei.
//
// Ce se apara aici:
//   - tabul exista si deschide rubrica
//   - cele doua canvas-uri se deseneaza (harta + CHARTUL pretului, separat)
//   - zoom-ul schimba CHIAR cererea catre server
//   - pereţii arata fermitatea, si lista goala spune ca e goala
//   - starea „inca nu am instantanee" NU arata ca o defectiune
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

// Grila: 8 coloane, 10 randuri, cu pretul in URCARE ca sa se vada chartul.
function mkBook(over: any = {}) {
  const cols = 8, rows = 10
  const cells: any[] = []
  for (let c = 0; c < cols; c++) {
    cells.push({ col: c, row: 3, pct: -0.04, bidUsd: 1.2e6, askUsd: 0 })
    cells.push({ col: c, row: 6, pct: 0.04, bidUsd: 0, askUsd: 9e5 })
  }
  return {
    symbol: 'BTCUSDT',
    heat: { cells, cols, rows, bandPct: 0.1, rowPct: 0.004,
      mids: Array.from({ length: cols }, (_, i) => 80000 + i * 12),
      tMin: NOW - 600_000, tMax: NOW, maxUsd: 1.2e6, frames: 120,
      exchanges: ['binance'], spread: 0.1 },
    ladder: { cells, mid: 80050, bandPct: 0.1, rowPct: 0.004, maxUsd: 1.2e6,
      frames: 120, excludedLevels: 4231 },
    walls: [
      { side: 'BID', price: 79931, pct: -0.15, usd: 1.16e8, peakUsd: 2e8, firmness: 0.92, distUsd: -119 },
      { side: 'ASK', price: 80180, pct: 0.16, usd: 4.2e7, peakUsd: 6e7, firmness: 0.41, distUsd: 130 },
    ],
    top: { bestBid: 80049.9, bestAsk: 80050.1, spread: 0.2, mid: 80050, ts: NOW,
      bidTopUsd: 3.3e6, askTopUsd: 2.9e6 },
    source: { deepLevels: 2000, deepFrames: 120, topFrames: 60,
      health: { usedWeight1m: 980, running: true } },
    asked: { band: 'auto', windowMs: 600_000, cols: 110, rows: 56 },
    at: NOW,
    ...over,
  }
}

let lastBookUrl = ''
const drawn: any[] = []
function mockFetch(bookPayload: any) {
  vi.stubGlobal('fetch', vi.fn(async (url: any) => {
    const u = String(url)
    if (u.includes('bookmap')) { lastBookUrl = u; return { ok: true, json: async () => bookPayload } as any }
    if (u.includes('liq-predict')) return { ok: true, json: async () => ({ symbols: [], at: NOW }) } as any
    return { ok: true, json: async () => PANEL } as any
  }))
}

beforeEach(() => {
  lastBookUrl = ''
  w.S = { symbol: 'BTCUSDT', price: 80050 }
  mockFetch(mkBook())
  // Context care INREGISTREAZA, nu doar tace. Riscul real la chartul pretului
  // nu e sa lipseasca din DOM — e sa iasa o LINIE DREAPTA (exact ce se intampla
  // daca il desenezi in harta, unde randurile sunt ancorate pe mijlocul
  // fiecarei coloane). Deci testul se uita la ce s-a desenat.
  drawn.length = 0
  ;(HTMLCanvasElement.prototype as any).getContext = function () {
    const rec: any = { ops: [], pts: [], fills: 0, strokes: 0 }
    drawn.push(rec)
    return {
      setTransform() {}, clearRect() {}, setLineDash() {},
      fillRect() { rec.fills++ },
      beginPath() { rec.ops.push('begin') },
      moveTo(x: number, y: number) { rec.pts.push([x, y]) },
      lineTo(x: number, y: number) { rec.pts.push([x, y]) },
      stroke() { rec.strokes++ },
      set fillStyle(_v: any) {}, set strokeStyle(_v: any) {}, set lineWidth(_v: any) {},
    }
  }
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

async function openBook() {
  const r = render(<LiqMapPanel />)
  await waitFor(() => expect(screen.getByText(/458/)).toBeTruthy())
  fireEvent.click(screen.getByText('BOOK'))
  await waitFor(() => expect(r.container.querySelector('.zbk')).toBeTruthy())
  return r
}

describe('rubrica exista si se deschide', () => {
  it('BOOK e al cincilea tab, dupa PREDICT', async () => {
    render(<LiqMapPanel />)
    await waitFor(() => expect(screen.getByText(/458/)).toBeTruthy())
    const tabs = Array.from(document.querySelectorAll('.zlq-tab')).map(t => t.textContent)
    expect(tabs).toEqual(['MAP', 'HEATMAP', 'LIVE', 'PREDICT', 'BOOK'])
  })

  it('deseneaza DOUA canvas-uri: harta SI chartul pretului', async () => {
    // Separate dinadins: harta e relativa la mijlocul fiecarei coloane, deci
    // pretul ar ieşi o linie dreapta in ea. Masurat: pe 10 minute pretul
    // depaseste chiar si banda de ±0,16% in 21% din cazuri pe BTC.
    const { container } = await openBook()
    expect(container.querySelector('.zbk-canvas canvas')).toBeTruthy()
    const pc = container.querySelector('.zbk-price') as HTMLElement
    expect(pc).toBeTruthy()
    expect(pc.hasAttribute('hidden')).toBe(false)
    expect(container.querySelector('.zbk-price canvas')).toBeTruthy()
  })

  it('⛔ chartul pretului NU e o linie dreapta — are puncte la inaltimi DIFERITE', async () => {
    // Mutatia care mi-a supravietuit prima data: ascunsesem canvas-ul si
    // testul tot il gasea in DOM. Riscul adevarat e insa linia dreapta, deci
    // testul se uita la PUNCTELE desenate.
    await openBook()
    await waitFor(() => expect(drawn.length).toBeGreaterThanOrEqual(2))
    const cuLinie = drawn.filter((d: any) => d.pts.length >= 2)
    expect(cuLinie.length).toBeGreaterThan(0)
    const varianta = cuLinie.some((d: any) => {
      const ys = d.pts.map((p: any) => p[1])
      return Math.max(...ys) - Math.min(...ys) > 1
    })
    expect(varianta).toBe(true)
  })

  it('harta CHIAR deseneaza celule, nu doar fundalul', async () => {
    await openBook()
    await waitFor(() => expect(drawn.some((d: any) => d.fills > 5)).toBe(true))
  })

  it('axa hartii e in PROCENTE, nu in dolari — banda e relativa', async () => {
    const { container } = await openBook()
    const ax = container.querySelector('.zbk-axis')!.textContent || ''
    expect(ax).toMatch(/\+0\.100%/)
    expect(ax).toMatch(/-0\.100%/)
  })

  it('axa chartului arata intervalul REAL de pret din fereastra', async () => {
    const { container } = await openBook()
    const ax = container.querySelector('.zbk-price-ax')!.textContent || ''
    expect(ax).toMatch(/80,084/)   // 80000 + 7*12
    expect(ax).toMatch(/80,000/)
  })

  it('spune raspicat ca e lichiditate care STA, nu o prezicere', async () => {
    await openBook()
    expect(screen.getByText(/RESTING LIQUIDITY/)).toBeTruthy()
    expect(screen.getByText(/NOT A FORECAST/)).toBeTruthy()
  })
})

describe('ZOOM — schimba CHIAR cererea catre server', () => {
  it('apasarea pe o banda trimite band=... in cerere', async () => {
    await openBook()
    fireEvent.click(screen.getByText('0.05%'))
    await waitFor(() => expect(lastBookUrl).toMatch(/band=0\.05/))
  })

  it('apasarea pe o fereastra trimite window=... in cerere', async () => {
    await openBook()
    fireEvent.click(screen.getByText('2m'))
    await waitFor(() => expect(lastBookUrl).toMatch(/window=120/))
  })

  it('butonul apasat se vede ca apasat', async () => {
    const { container } = await openBook()
    fireEvent.click(screen.getByText('0.1%'))
    await waitFor(() => {
      const act = Array.from(container.querySelectorAll('.zbk-z.act')).map(b => b.textContent)
      expect(act).toContain('0.1%')
    })
  })

  it('NICIO banda din interfaţa nu depaseste ce exista in carte (±0,16%)', async () => {
    const { container } = await openBook()
    const et = Array.from(container.querySelectorAll('.zbk-z')).map(b => b.textContent || '')
    for (const e of et) {
      const m = e.match(/^([\d.]+)%$/)
      if (m) expect(parseFloat(m[1])).toBeLessThanOrEqual(0.2)
    }
  })
})

describe('pereţii — fermitatea e pe ecran', () => {
  it('arata partea, pretul, distanţa, dolarii si fermitatea', async () => {
    const { container } = await openBook()
    const t = container.querySelector('.zbk-walls')!.textContent || ''
    expect(t).toMatch(/BID/)
    expect(t).toMatch(/79,931/)
    expect(t).toMatch(/-119/)
    expect(t).toMatch(/92%/)
    expect(t).toMatch(/41%/)
  })

  it('explica ce e fermitatea — altfel cifra nu se poate citi', async () => {
    await openBook()
    expect(screen.getByText(/share of snapshots it was actually there/)).toBeTruthy()
  })

  it('fara pereţi spune ca nu are, nu lasa gol', async () => {
    mockFetch(mkBook({ walls: [] }))
    await openBook()
    expect(screen.getByText(/no level thick enough/)).toBeTruthy()
  })
})

describe('onestitatea despre ce se vede', () => {
  it('spune CAT DE ADANC vede si cata greutate Binance s-a folosit', async () => {
    const { container } = await openBook()
    const t = container.querySelector('.zbk-src')!.textContent || ''
    expect(t).toMatch(/2,000 levels/)
    expect(t).toMatch(/120 snapshots/)
    expect(t).toMatch(/980\/2400/)
  })

  it('spune cate niveluri au rams IN AFARA benzii — altfel pare ca le vezi pe toate', async () => {
    const { container } = await openBook()
    expect(container.querySelector('.zbk-src')!.textContent).toMatch(/4,231 levels outside band/)
  })

  it('explica de ce zoom-ul nu te DEPARTEAZA de pret', async () => {
    await openBook()
    expect(screen.getByText(/there are no/)).toBeTruthy()
  })

  it('fara instantanee spune ca ASTEAPTA, nu ca e stricat', async () => {
    mockFetch(mkBook({ heat: { ...mkBook().heat, frames: 0, cells: [] } }))
    const r = render(<LiqMapPanel />)
    await waitFor(() => expect(screen.getByText(/458/)).toBeTruthy())
    fireEvent.click(screen.getByText('BOOK'))
    await waitFor(() => expect(screen.getByText(/Waiting for the first snapshot/)).toBeTruthy())
    expect(screen.queryByText(/error|broken|failed/i)).toBeNull()
  })

  it('cu ruta picata randeaza starea goala, nu cade', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: any) => {
      const u = String(url)
      if (u.includes('bookmap')) throw new Error('down')
      if (u.includes('liq-predict')) return { ok: true, json: async () => ({ symbols: [], at: NOW }) } as any
      return { ok: true, json: async () => PANEL } as any
    }))
    render(<LiqMapPanel />)
    await waitFor(() => expect(screen.getByText(/458/)).toBeTruthy())
    fireEvent.click(screen.getByText('BOOK'))
    await waitFor(() => expect(screen.getByText(/order book/i)).toBeTruthy())
  })

  it('niciun cuvant romanesc in rubrica', async () => {
    const { container } = await openBook()
    const txt = (container.querySelector('.zbk') as HTMLElement).textContent!.toLowerCase()
    for (const r of ['carte', 'pereti', 'pereţi', 'fermitate', 'lichiditate', 'banda', 'bandă', 'adanc'])
      expect(txt).not.toContain(r)
  })
})

describe('⛔ grila ingusta la inceput: CORECTA, dar trebuie SPUSA', () => {
    // Verificat aritmetic pe starea reala a serverului: la ritm lent se strang
    // ~20 de cadre in fereastra de 10 minute iar clientul cere 110 coloane.
    // Serverul margineste grila la numarul de cadre (altfel ar fi un pieptene
    // de dungi cu gauri — clasa bugului de la b327). Dar o harta cu 20 de
    // coloane late arata ca una stricata daca nu se spune de ce.
    it('spune cate coloane din cate, cand sunt mai puţine', async () => {
        mockFetch(mkBook({ heat: { ...mkBook().heat, cols: 20, colsAsked: 110 } }))
        const { container } = await openBook()
        const t = container.querySelector('.zbk-legend')!.textContent || ''
        expect(t).toMatch(/20\/110 columns/)
        expect(t).toMatch(/filling in/)
    })

    it('cand grila e completa NU mai spune nimic — zgomot pe ecran', async () => {
        mockFetch(mkBook({ heat: { ...mkBook().heat, cols: 110, colsAsked: 110 } }))
        const { container } = await openBook()
        expect(container.querySelector('.zbk-legend')!.textContent).not.toMatch(/filling in/)
    })

    it('fara colsAsked nu arunca si nu inventeaza eticheta', async () => {
        const h: any = { ...mkBook().heat }
        delete h.colsAsked
        mockFetch(mkBook({ heat: h }))
        const { container } = await openBook()
        expect(container.querySelector('.zbk-legend')).toBeTruthy()
        expect(container.querySelector('.zbk-legend')!.textContent).not.toMatch(/filling in/)
    })
})

describe('⛔ incape pe telefon — masurat, nu din gust', () => {
    it('randul de perete INCAPE pe 320px — citit din foaia de stil, calculat', () => {
        // Operatorul citeste Zeus de pe TELEFON, deci lizibilitatea e
        // aritmetica, nu gust. iPhone SE: 320px minus 12px padding x2 = 296
        // utili. Testul CITESTE grid-template-columns si gap din CSS si face
        // suma — daca cineva lataeste o coloana, testul cade.
        const css = readFileSync(join(__dirname, '..', '..', '..', 'styles', 'liqmap.css'), 'utf8')
        const i = css.indexOf('@media (max-width: 380px)', css.indexOf('.zbk'))
        expect(i).toBeGreaterThan(-1)
        const bloc = css.slice(i, i + 700)
        const m = bloc.match(/\.zbk-wall\s*\{[^}]*grid-template-columns:\s*([^;]+);[^}]*gap:\s*(\d+)px/)
        expect(m).toBeTruthy()
        const coloane = m![1].trim().split(/\s+/)
        const gap = parseInt(m![2], 10)
        const fixe = coloane.filter(c => c.endsWith('px')).map(c => parseInt(c, 10))
        expect(coloane).toContain('1fr')
        const total = fixe.reduce((a, b) => a + b, 0) + gap * (coloane.length - 1)
        const UTILI = 296
        expect(total).toBeLessThan(UTILI)
        // Coloanei de dolari trebuie sa-i rameana destul ca sa incapa „116.0M"
        expect(UTILI - total).toBeGreaterThanOrEqual(60)
    })

    it('coloana dolarilor rameane 1fr — ea poarta cifra care conteaza', async () => {
        const { container } = await openBook()
        const w = container.querySelector('.zbk-wall')
        expect(w).toBeTruthy()
        expect(w!.children.length).toBe(5)
    })
})
