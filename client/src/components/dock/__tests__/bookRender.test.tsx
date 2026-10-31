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
      priceLo: 79900, priceHi: 80200, rowUsd: (80200 - 79900) / rows,
      tMin: NOW - 600_000, tMax: NOW, maxUsd: 1.2e6, loUsd: 2e5, frames: 120,
      heldCols: 0, colsAsked: 110, exchanges: ['binance'], spread: 0.1 },
    trades: [
      { id: 1, ts: NOW - 500_000, price: 79980, qty: 2, usd: 159960, sell: false },
      { id: 2, ts: NOW - 200_000, price: 80080, qty: 5, usd: 400400, sell: true },
    ],
    liqs: [{ ts: NOW - 300_000, price: 80020, usd: 250000, sell: true }],
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
    const rec: any = { ops: [], pts: [], fills: 0, strokes: 0, alphas: [], arcs: [], rects: [] }
    drawn.push(rec)
    return {
      setTransform() {}, clearRect() {}, setLineDash() {},
      fillRect(x: number, y: number, w: number, h: number) { rec.fills++; rec.rects.push([x, y, w, h]) },
      beginPath() { rec.ops.push('begin') },
      moveTo(x: number, y: number) { rec.pts.push([x, y]) },
      lineTo(x: number, y: number) { rec.pts.push([x, y]) },
      stroke() { rec.strokes++ },
      // [2026-10-31] Lipseau `arc` si `fill`, iar bulele si inelele de
      // lichidare sunt cercuri — deci componenta arunca si TOATE testele de
      // randare cadeau. Nu codul era stricat, ci mock-ul meu.
      arc(x: number, y: number, r: number) { rec.arcs.push([x, y, r]) },
      fill() { rec.fills++ },
      closePath() {},
      set fillStyle(v: any) {
        const m = String(v).match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/)
        if (m) rec.alphas.push(parseFloat(m[1]))
      },
      set strokeStyle(_v: any) {}, set lineWidth(_v: any) {},
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

  it('UN SINGUR canvas: linia pretului s-a mutat INAPOI in harta', async () => {
    // [2026-10-30] Contract schimbat dinadins, la cererea lui („exact asa, ca
    // la Bookmap"). Banda separata exista fiindca grila era RELATIVA la
    // mijlocul fiecarei coloane, deci pretul ieşea o linie dreapta in ea.
    // Acum grila e pe PRET ABSOLUT — linia urmeaza pretul chiar in harta, iar
    // banda de deasupra n-ar mai arata nimic in plus.
    const { container } = await openBook()
    expect(container.querySelector('.zbk-canvas canvas')).toBeTruthy()
    expect(container.querySelector('.zbk-price')).toBeNull()
  })

  it('⛔ linia pretului NU e dreapta — are puncte la inaltimi DIFERITE', async () => {
    // Riscul a rams acelasi dupa mutarea in harta: o linie dreapta inseamna ca
    // axa nu e pe pret adevarat.
    await openBook()
    // Un singur canvas de acum: banda separata de pret a fost scoasa cand
    // grila a trecut pe pret absolut.
    await waitFor(() => expect(drawn.length).toBeGreaterThanOrEqual(1))
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

  it('axa hartii e in DOLARI — grila e pe pret absolut', async () => {
    // Era in procente cand grila era relativa. Acum randurile SUNT preturi,
    // deci axa trebuie sa spuna preturi — altfel bulele n-ar avea reper.
    const { container } = await openBook()
    const ax = container.querySelector('.zbk-axis')!.textContent || ''
    expect(ax).toMatch(/80,200/)
    expect(ax).toMatch(/79,900/)
    expect(ax).not.toMatch(/%/)
  })

  it('BULELE si LICHIDARILE sunt in legenda, ca sa se recunoasca', async () => {
    const { container } = await openBook()
    const t = container.querySelector('.zbk-legend')!.textContent || ''
    expect(t).toMatch(/trades/)
    expect(t).toMatch(/liquidations/)
    expect(container.querySelector('.zbk-legend i.zbk-dot')).toBeTruthy()
    expect(container.querySelector('.zbk-legend i.zbk-ring')).toBeTruthy()
  })

  it('SPUNE de pe ce burse vin lichidarile — carnetul e Binance, ele nu', async () => {
    await openBook()
    expect(screen.getByText(/Bybit \+ OKX \+ Gate/)).toBeTruthy()
  })

  it('spune raspicat ca e lichiditate care STA, nu o prezicere', async () => {
    await openBook()
    expect(screen.getByText(/RESTING LIQUIDITY/)).toBeTruthy()
    expect(screen.getByText('NEREUS')).toBeTruthy()
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
    const srcs = container.querySelectorAll('.zbk-src')
    const t = srcs[srcs.length - 1].textContent || ''
    expect(t).toMatch(/2,000 levels/)
    expect(t).toMatch(/120 snapshots/)
    expect(t).toMatch(/980\/2400/)
  })

  it('spune cate niveluri au rams IN AFARA benzii — altfel pare ca le vezi pe toate', async () => {
    const { container } = await openBook()
    const srcs2 = container.querySelectorAll('.zbk-src')
    expect(srcs2[srcs2.length - 1].textContent).toMatch(/4,231 levels outside band/)
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

describe('⛔ SIMBOLUL — cartea exista doar pe BTC si ETH (clasa bugului de la b328)', () => {
    it('afiseaza simbolul pe care SERVERUL l-a dat, nu pe cel din chart', async () => {
        w.S = { symbol: 'SOLUSDT', price: 180 }
        mockFetch(mkBook({ symbol: 'BTCUSDT' }))
        const r = render(<LiqMapPanel />)
        await waitFor(() => expect(screen.getByText(/458/)).toBeTruthy())
        fireEvent.click(screen.getByText('BOOK'))
        await waitFor(() => expect(r.container.querySelector('.zbk')).toBeTruthy())
        expect(r.container.querySelector('.zbk-sym')!.textContent).toBe('BTCUSDT')
    })

    it('SPUNE raspicat cand cartea nu e a simbolului din chart', async () => {
        w.S = { symbol: 'SOLUSDT', price: 180 }
        mockFetch(mkBook({ symbol: 'BTCUSDT' }))
        const r = render(<LiqMapPanel />)
        await waitFor(() => expect(screen.getByText(/458/)).toBeTruthy())
        fireEvent.click(screen.getByText('BOOK'))
        await waitFor(() => expect(r.container.querySelector('.zbk-mismatch')).toBeTruthy())
        const t = r.container.querySelector('.zbk-mismatch')!.textContent || ''
        expect(t).toMatch(/BTCUSDT/)
        expect(t).toMatch(/SOLUSDT/)
        expect(t).toMatch(/only/i)
    })

    it('nota de jos NU mai pretinde ca e cartea simbolului din chart', async () => {
        w.S = { symbol: 'SOLUSDT', price: 180 }
        mockFetch(mkBook({ symbol: 'BTCUSDT' }))
        const r = render(<LiqMapPanel />)
        await waitFor(() => expect(screen.getByText(/458/)).toBeTruthy())
        fireEvent.click(screen.getByText('BOOK'))
        await waitFor(() => expect(r.container.querySelector('.zbk-note')).toBeTruthy())
        const t = r.container.querySelector('.zbk-note')!.textContent || ''
        expect(t).toMatch(/BTCUSDT/)
        expect(t).not.toMatch(/SOLUSDT/)
    })

    it('cand simbolul se potriveste NU apare niciun avertisment — zgomot pe ecran', async () => {
        const { container } = await openBook()
        expect(container.querySelector('.zbk-mismatch')).toBeNull()
        expect(container.querySelector('.zbk-sym')!.textContent).toBe('BTCUSDT')
    })
})

describe('⛔ coloanele TINUTE — pieptenele din captura lui', () => {
    it('spune cate coloane sunt tinute intre instantanee', async () => {
        mockFetch(mkBook({ heat: { ...mkBook().heat, heldCols: 10 } }))
        const { container } = await openBook()
        expect(container.querySelector('.zbk-legend')!.textContent).toMatch(/10 held between snapshots/)
    })

    it('cand nimic nu e tinut, TACE — altfel e zgomot pe ecran', async () => {
        mockFetch(mkBook({ heat: { ...mkBook().heat, heldCols: 0 } }))
        const { container } = await openBook()
        expect(container.querySelector('.zbk-legend')!.textContent).not.toMatch(/held between/)
    })

    it('celulele tinute se deseneaza MAI STINS decat cele masurate', async () => {
        // Nu e cosmetica: o celula tinuta nu e o observaţie noua, si diferenta
        // trebuie sa se VADA, nu doar sa fie scrisa.
        const b = mkBook()
        const cells = [
            { col: 0, row: 3, pct: -0.04, bidUsd: 1.2e6, askUsd: 0 },
            { col: 1, row: 3, pct: -0.04, bidUsd: 1.2e6, askUsd: 0, held: true },
        ]
        mockFetch(mkBook({ heat: { ...b.heat, cells, cols: 2, heldCols: 1 } }))
        await openBook()
        await waitFor(() => expect(drawn.some((d: any) => d.fills > 1)).toBe(true))
        const alfe = drawn.flatMap((d: any) => d.alphas || [])
        // doua umpleri de celula cu aceiasi dolari, dar opacitati DIFERITE
        expect(new Set(alfe.map((a: number) => a.toFixed(3))).size).toBeGreaterThan(1)
    })
})

describe('⛔ „nu stiu sa-l citesc" — panoul trebuie sa se explice SINGUR', () => {
    it('explicatia e DESCHISA din start — el nu trebuie sa o caute', async () => {
        try { localStorage.removeItem('zbk.help') } catch { /* */ }
        const { container } = await openBook()
        expect(container.querySelector('.zbk-help-b')).toBeTruthy()
    })

    it('spune ce inseamna FIECARE culoare, nu doar cum se numeste', async () => {
        const { container } = await openBook()
        const t = container.querySelector('.zbk-help-b')!.textContent || ''
        expect(t).toMatch(/buy orders waiting/i)
        expect(t).toMatch(/sell orders waiting/i)
        expect(t).toMatch(/brighter/i)
    })

    it('explica FERMITATEA cu cifre, fiindca aia e cheia listei de jos', async () => {
        const { container } = await openBook()
        const t = container.querySelector('.zbk-help-b')!.textContent || ''
        expect(t).toMatch(/firmness/i)
        expect(t).toMatch(/100%/)
        expect(t).toMatch(/30%/)
    })

    it('explica la ce foloseste fiecare axa de zoom', async () => {
        const { container } = await openBook()
        const t = container.querySelector('.zbk-help-b')!.textContent || ''
        expect(t).toMatch(/BAND/)
        expect(t).toMatch(/SPAN/)
    })

    it('se poate INCHIDE, si alegerea se tine minte', async () => {
        const { container } = await openBook()
        fireEvent.click(screen.getByText(/HOW TO READ/))
        await waitFor(() => expect(container.querySelector('.zbk-help-b')).toBeNull())
        let stocat: string | null = null
        try { stocat = localStorage.getItem('zbk.help') } catch { /* */ }
        expect(stocat).toBe('0')
    })

    it('odata inchisa, rameane inchisa la urmatoarea deschidere', async () => {
        try { localStorage.setItem('zbk.help', '0') } catch { /* */ }
        const { container } = await openBook()
        expect(container.querySelector('.zbk-help-b')).toBeNull()
        expect(screen.getByText(/HOW TO READ/)).toBeTruthy()
        try { localStorage.removeItem('zbk.help') } catch { /* */ }
    })

    it('fara localStorage (mod privat) NU crapa si explicatia e vizibila', async () => {
        const orig = Object.getOwnPropertyDescriptor(window, 'localStorage')
        Object.defineProperty(window, 'localStorage', {
            configurable: true,
            get() { throw new Error('blocked') },
        })
        try {
            const { container } = await openBook()
            expect(container.querySelector('.zbk-help-b')).toBeTruthy()
        } finally {
            if (orig) Object.defineProperty(window, 'localStorage', orig)
        }
    })

    it('explicatia e in ENGLEZA', async () => {
        const { container } = await openBook()
        const t = (container.querySelector('.zbk-help-b') as HTMLElement).textContent!.toLowerCase()
        for (const r of ['cumpar', 'vanzare', 'pretul', 'banda', 'timp', 'fermitate'])
            expect(t).not.toContain(r)
    })
})

describe('⛔ BULELE si LICHIDARILE chiar se DESENEAZA', () => {
  // Fara testele astea, tot ce a cerut el („cu bule, lichidari, nu sari nimic")
  // ar putea lipsi din desen fara ca nimic sa cada. Contextul fals inregistreaza
  // fiecare `arc`, deci se poate verifica numarul si pozitia lor.
  it('se deseneaza cercuri — bule si inele', async () => {
    await openBook()
    await waitFor(() => expect(drawn.some((d: any) => (d.arcs || []).length > 0)).toBe(true))
    const arcs = drawn.flatMap((d: any) => d.arcs || [])
    // 2 tranzactii + 1 lichidare din fixtura
    expect(arcs.length).toBeGreaterThanOrEqual(3)
  })

  it('bulele au RAZE DIFERITE — altfel marimea nu spune nimic', async () => {
    await openBook()
    await waitFor(() => expect(drawn.flatMap((d: any) => d.arcs || []).length).toBeGreaterThan(1))
    const raze = drawn.flatMap((d: any) => d.arcs || []).map((a: any) => a[2])
    expect(new Set(raze.map((r: number) => r.toFixed(2))).size).toBeGreaterThan(1)
  })

  it('cercurile stau la INALTIMI diferite — pretul lor conteaza', async () => {
    await openBook()
    await waitFor(() => expect(drawn.flatMap((d: any) => d.arcs || []).length).toBeGreaterThan(1))
    const ys = drawn.flatMap((d: any) => d.arcs || []).map((a: any) => a[1])
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(1)
  })

  it('si la momente diferite pe orizontala — timpul lor conteaza', async () => {
    await openBook()
    await waitFor(() => expect(drawn.flatMap((d: any) => d.arcs || []).length).toBeGreaterThan(1))
    const xs = drawn.flatMap((d: any) => d.arcs || []).map((a: any) => a[0])
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(1)
  })

  it('o tranzactie IN AFARA grilei de pret NU se deseneaza', async () => {
    // Agatata la margine, ar arata ca o bula uriasa la un pret unde n-a fost
    // nimic — exact clasa de minciuna pe care am inchis-o si la harta.
    const b = mkBook()
    mockFetch(mkBook({ trades: [{ id: 9, ts: NOW - 100_000, price: 40000, qty: 10, usd: 400000, sell: false }], liqs: [] }))
    void b
    await openBook()
    const arcs = drawn.flatMap((d: any) => d.arcs || [])
    expect(arcs.length).toBe(0)
  })

  it('⛔ o tranzactie IN AFARA ferestrei de TIMP nu se agata de margine', async () => {
    // [2026-10-31] Gasit RANDAND cu date vii: `xOf` prindea la margine
    // (`Math.max(0, Math.min(1, f))`), deci toate tranzactiile mai vechi decat
    // harta se stiveau pe marginea stanga — o coloana de bule la cel mai vechi
    // moment, unde in realitate nu era nimic. In productie inelul tine 20 min
    // si fereastra implicita a hartii e 10, deci ar fi fost JUMATATE din bule.
    // Pe axa de PRET aceeasi minciuna era deja inchisa; pe axa de TIMP nu.
    mockFetch(mkBook({
      trades: [
        { id: 1, ts: NOW - 5_000_000, price: 80000, qty: 9, usd: 720000, sell: false },
        { id: 2, ts: NOW - 4_000_000, price: 80010, qty: 9, usd: 720000, sell: true },
        { id: 3, ts: NOW - 100_000, price: 80020, qty: 9, usd: 720000, sell: false },
      ],
      liqs: [{ ts: NOW - 6_000_000, price: 80030, usd: 500000, sell: true }],
    }))
    await openBook()
    const arcs = drawn.flatMap((d: any) => d.arcs || [])
    expect(arcs.length).toBe(1)                       // doar cea din fereastra
    expect(arcs.every((a: any) => a[0] > 1)).toBe(true)
  })

  it('⛔ eticheta spune cate bule s-au DESENAT, nu cate au venit', async () => {
    // Spunea lungimea listei. Cu prag pe marime si fereastra de timp, desenul
    // arunca o parte — deci anunta o cifra pe care nu o desena. Aceeasi clasa
    // ca fermitatea de 2450%: un numar care arata credibil si nu e masurat.
    mockFetch(mkBook({
      trades: [
        { id: 1, ts: NOW - 5_000_000, price: 80000, qty: 9, usd: 720000, sell: false },
        { id: 2, ts: NOW - 4_000_000, price: 80010, qty: 9, usd: 720000, sell: true },
        { id: 3, ts: NOW - 100_000, price: 80020, qty: 9, usd: 720000, sell: false },
      ],
      liqs: [],
    }))
    const { container } = await openBook()
    await waitFor(() => {
      const t = container.querySelector('.zbk-src')?.textContent || ''
      expect(t).toMatch(/1 of 3 trades drawn/)
    })
  })

  it('fara tranzactii si fara lichidari, harta tot se deseneaza', async () => {
    mockFetch(mkBook({ trades: [], liqs: [] }))
    const { container } = await openBook()
    expect(container.querySelector('.zbk-canvas canvas')).toBeTruthy()
    expect(drawn.some((d: any) => d.fills > 5)).toBe(true)
  })

  it('COB-ul deseneaza bare IN DREAPTA hartii', async () => {
    // Prima versiune verifica doar ca exista umpleri — si harta singura le
    // producea, deci mutatia care scotea COB-ul trecea nepedepsita.
    // Acum se uita UNDE: COB-ul sta dincolo de latimea hartii.
    await openBook()
    await waitFor(() => expect(drawn.flatMap((d: any) => d.rects || []).length).toBeGreaterThan(5))
    const rects = drawn.flatMap((d: any) => d.rects || [])
    // Geometria, calculata nu ghicita: in jsdom clientWidth e 0, deci latimea
    // cade pe 320. cobW = max(26, min(64, 320*0.13)) = 42, deci harta se
    // opreste la 276 si COB-ul incepe la 278. Orice dreptunghi dincolo de 277
    // e al COB-ului — celulele hartii nu pot ajunge acolo.
    const W = 320, cobW = Math.max(26, Math.min(64, Math.round(W * 0.13)))
    const mapW = Math.max(40, W - cobW - 2)
    const inCob = rects.filter((r: any) => r[0] >= mapW + 1)
    expect(inCob.length).toBeGreaterThan(0)
  })

  it('bulele de TRANZACTII au raze diferite intre ele, nu doar fata de inele', async () => {
    // Fixtura fara lichidari, cu doua tranzactii foarte diferite ca marime.
    mockFetch(mkBook({
      liqs: [],
      trades: [
        // peste pragul de 2% din cea mai mare (16.016), ca testul sa masoare
        // RAZA, nu filtrul — prima incercare punea 4.000 si era taiata, corect
        { id: 1, ts: NOW - 500_000, price: 79980, qty: 0.5, usd: 40000, sell: false },
        { id: 2, ts: NOW - 200_000, price: 80080, qty: 10, usd: 800800, sell: true },
      ],
    }))
    await openBook()
    await waitFor(() => expect(drawn.flatMap((d: any) => d.arcs || []).length).toBeGreaterThan(1))
    const raze = drawn.flatMap((d: any) => d.arcs || []).map((a: any) => a[2])
    expect(Math.max(...raze) - Math.min(...raze)).toBeGreaterThan(1)
  })

  it('LINIA pretului merge pe ORIZONTALA, nu sta pe loc', async () => {
    // Mutatia care fixa x-ul liniei trecea, fiindca testele se uitau doar la
    // x-ul BULELOR. Aici se verifica chiar punctele liniei.
    await openBook()
    await waitFor(() => expect(drawn.flatMap((d: any) => d.pts || []).length).toBeGreaterThan(2))
    const xs = drawn.flatMap((d: any) => d.pts || []).map((p: any) => p[0])
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(5)
  })
})
