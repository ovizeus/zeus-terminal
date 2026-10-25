import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// [2026-10-25] „setez 30 min, ies din Zeus, cand intru starea e pe 30 min dar
// chartul nu e — dau refresh si dupa aia se schimba."
//
// Raportat de operator, si descrierea lui contine diagnosticul: ETICHETA e
// corecta si DESENUL nu. Deci restaurarea rulase — setTF() scrie eticheta —
// dar lumanarile de pe ecran erau ale altui timeframe.
//
// Lantul, gasit citind codul si confirmat pe el:
//
//   1. core/bootstrapStartApp.ts cheama `fetchKlines('5m')` — un LITERAL, la
//      fiecare pornire, indiferent ce timeframe are operatorul salvat.
//   2. restaurarea cheama setTF('30m'), care face `FetchLock.release('klines')`
//      si apoi `fetchKlines('30m')`. `release` nu verifica cine detine lacatul,
//      deci elibereaza unul tinut de cererea de 5m INCA IN ZBOR.
//   3. acum sunt DOUA cereri de lumanari in aer deodata, iar `fetchKlines`
//      verifica daca raspunsul mai e dorit NUMAI dupa simbol:
//
//          if (w.S.symbol !== sym) { ...stale...; return }
//
//      Nu si dupa timeframe. Deci cine ajunge ULTIMUL scrie `w.S.klines` si
//      deseneaza. Cand raspunsul de 5m intarzie mai mult decat cel de 30m,
//      chartul ramane pe 5m cu eticheta pe 30m — exact ce a vazut el.
//      Un refresh schimba ordinea si de aia „dupa aia se face".
//
// Reparatia e pe CLASA, nu pe simptom: un raspuns trebuie sa DOVEDEASCA faptul
// ca mai e dorit inainte sa scrie, pe toate axele care il pot invechi — simbol
// SI timeframe — nu doar pe cea de care ne-am lovit prima oara.

const w = window as any

function klinesPayload(n = 20) {
  const now = Math.floor(Date.now() / 1000)
  return Array.from({ length: n }, (_, i) => [
    (now - (n - i) * 60) * 1000, '100', '101', '99', '100.5', '10',
  ])
}

let renderCalls = 0

beforeEach(() => {
  renderCalls = 0
  w.S = { symbol: 'BTCUSDT', chartTf: '30m', klines: [], _altKlinePollTimer: null }
  w.FetchLock = { try: () => true, release: () => {} }
  w.__MF = { WS_PROXY_ENABLED: false, ALT_WS_FEEDS: false, CHART_BACKFILL_ENABLED: false }
  w.cSeries = { setData: () => { renderCalls++ }, update: () => {}, priceToCoordinate: () => 0 }
  w.mainChart = { timeScale: () => ({ fitContent: () => {}, scrollToRealTime: () => {} }), applyOptions: () => {} }
  w.renderChart = () => { renderCalls++ }
})

afterEach(() => { vi.restoreAllMocks() })

describe('un raspuns de lumanari pe alt timeframe nu mai poate scrie peste chart', () => {

  it('RASPUNSUL INVECHIT E ARUNCAT: cerere pe 5m, intre timp utilizatorul e pe 30m', async () => {
    const { fetchKlines } = await import('../marketDataChart')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => klinesPayload() })))

    w.S.chartTf = '30m'          // ce vrea operatorul ACUM
    await fetchKlines('5m')      // raspunsul unei cereri mai vechi

    expect(w.S.klines).toHaveLength(0)   // nu a scris nimic
  })

  it('RASPUNSUL DORIT TRECE: acelasi timeframe ca al chartului', async () => {
    const { fetchKlines } = await import('../marketDataChart')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => klinesPayload() })))

    w.S.chartTf = '30m'
    await fetchKlines('30m')

    expect(w.S.klines.length).toBeGreaterThan(0)
  })

  it('garda pe SIMBOL ramane in picioare — nu am inlocuit-o, am adaugat-o', async () => {
    const { fetchKlines } = await import('../marketDataChart')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => klinesPayload() })))

    w.S.chartTf = '30m'
    const p = fetchKlines('30m')
    w.S.symbol = 'ETHUSDT'       // operatorul schimba simbolul in timpul cererii
    await p

    expect(w.S.klines).toHaveLength(0)
  })

  it('cursa exacta din raport: 5m pornit primul, ateriZEAZA ultimul, si TOT pierde', async () => {
    const { fetchKlines } = await import('../marketDataChart')
    // 5m raspunde LENT, 30m rapid — ordinea care producea bugul
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const slow = String(url).includes('interval=5m')
      if (slow) await new Promise(r => setTimeout(r, 40))
      return { ok: true, status: 200, json: async () => klinesPayload(slow ? 5 : 20) }
    }))

    w.S.chartTf = '5m'
    const boot = fetchKlines('5m')       // ce face pornirea
    w.S.chartTf = '30m'                  // restaurarea muta timeframe-ul
    await fetchKlines('30m')             // si cere lumanarile corecte
    const after30 = w.S.klines.length
    await boot                           // raspunsul de 5m ajunge ACUM

    expect(after30).toBe(20)
    expect(w.S.klines).toHaveLength(20)  // 5m NU a suprascris
  })
})

describe('pornirea nu mai cere un timeframe inventat', () => {
  it('bootstrapStartApp nu mai are literalul 5m la fetchKlines', async () => {
    const fs = await import('node:fs')
    const raw = fs.readFileSync(
      '/opt/zeus-terminal/client/src/core/bootstrapStartApp.ts', 'utf8')
    // Doar CODUL. Prima varianta a testului citea tot fisierul si se agata de
    // propriul meu comentariu, care citeaza literalul vechi ca sa explice de ce
    // a disparut — un test care cade pe explicatia fixului, nu pe fix.
    const code = raw.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    expect(code).not.toMatch(/fetchKlines\(\s*'5m'\s*\)/)
    expect(code).toMatch(/fetchKlines\(\s*w\.S\.chartTf/)
  })
})
