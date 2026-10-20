/**
 * [2026-10-20 b292] Jurnalul „full" (pagina legacy /journal.html) golea tot
 * tabelul daca randarea graficului arunca.
 *
 * `fetchJournal` chema `applyFilters()` (care randeaza tabelul CORECT), apoi
 * `renderStats` si `renderChart`, totul in acelasi `.then`. Un `.catch` comun
 * de la capat facea doua lucruri greste: eticheta eroarea ca „Fetch error",
 * desi datele sosiseră perfect, si chema `showEmpty()`, care STERGEA un tabel
 * deja randat. Adica: o eroare de decor omora datele, si mesajul trimitea pe
 * oricine depaneaza pe pista greşita.
 *
 * Gasit randand pagina in jsdom (fara canvas) in timp ce verificam altceva.
 */
import { describe, test, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const JOURNAL_JS = resolve(__dirname, '../../../../public/js/journal.js')
const JOURNAL_HTML = resolve(__dirname, '../../../../public/journal.html')

const TRADES = [
  { seq: 1, openTs: 1792500000000, closeTs: 1792503600000, symbol: 'LINKUSDT', side: 'SHORT',
    mode: 'demo', entryPrice: 12.1, exitPrice: 11.8, size: 131, leverage: 5,
    pnl: 23.47, exitReason: 'DSL_PL', holdMs: 3600000, sl: 12.4, tp: 11.5 },
]

function bootPage(opts: { chartWorks: boolean }) {
  const html = readFileSync(JOURNAL_HTML, 'utf8')
  document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))

  const w = window as unknown as Record<string, unknown>
  w.fetch = ((url: string) => Promise.resolve({
    status: 200,
    json: () => Promise.resolve(
      String(url).includes('annotations')
        ? { ok: true, annotations: {} }
        : { ok: true, trades: TRADES, stats: {} }),
  })) as unknown as typeof fetch
  w._resolvedEnv = 'LIVE'

  if (opts.chartWorks) {
    const ctx: Record<string, unknown> = new Proxy({}, {
      get: (_t, k) => (k === 'canvas' ? { width: 600, height: 200 } : () => ctx),
    })
    HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as typeof HTMLCanvasElement.prototype.getContext
  } else {
    // Exact ce face jsdom fara pachetul `canvas`, si ce ar face un browser
    // cu canvas-ul indisponibil: getContext da null -> renderChart arunca.
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
  }

  // eslint-disable-next-line no-eval
  eval(readFileSync(JOURNAL_JS, 'utf8'))
  return new Promise((r) => setTimeout(r, 60))
}

describe('jurnalul full — izolarea randarii', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    document.body.innerHTML = ''
  })

  test('tabelul se randeaza cand totul merge', async () => {
    await bootPage({ chartWorks: true })
    expect(document.querySelectorAll('#tableBody tr').length).toBe(1)
  })

  test('ACEASTA E REPARATIA: o eroare la grafic NU mai sterge tabelul', async () => {
    await bootPage({ chartWorks: false })
    const rows = document.querySelectorAll('#tableBody tr')
    expect(rows.length).toBe(1)
    const empty = document.getElementById('emptyState')
    expect(empty && empty.style.display).not.toBe('block')
  })

  test('o eroare de randare nu se mai raporteaza ca „Fetch error"', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await bootPage({ chartWorks: false })
    const msgs = spy.mock.calls.map((c) => String(c[0]))
    expect(msgs.some((m) => m.includes('Fetch error'))).toBe(false)
  })

  test('fiecare celula are data-label, pentru casetele de pe telefon', async () => {
    await bootPage({ chartWorks: true })
    const tds = [...document.querySelectorAll('#tableBody tr td')]
    const ths = [...document.querySelectorAll('.j-table thead th')].map((t) => t.textContent!.trim())
    expect(tds.length).toBe(ths.length)
    tds.forEach((td, i) => expect(td.getAttribute('data-label')).toBe(ths[i]))
  })
})
