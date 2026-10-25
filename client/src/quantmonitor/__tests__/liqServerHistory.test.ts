import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// [LIQ-HISTORY 2026-10-25] „nivele de lichidari sunt putine, vreau sa vad
// lichidari pana sus si pana jos, dar cu date reale".
//
// Randurile goale nu erau un bug. Harta arata NUMAI lichidari care chiar s-au
// intamplat, pe 24h — iar BTC s-a miscat +0,6% / -0,6% in 24h. Masurat pe
// pretul real, 30 de zile acopera +8,3% / -1,7%.
//
// Serverul tine acum istoricul (liqStore). Clientul il foloseste ca BAZA si
// adauga peste el doar evenimentele mai noi decat reperul `asOf` — altfel
// aceleasi lichidari ar intra de doua ori, iar barele ar arata dublu fata de
// adevar. Adica fix genul de cifra umflata pe care modelul sintetic o producea
// inainte sa fie scos.

const w = window as any

beforeEach(() => {
  w.S = { price: 80000, symbol: 'BTCUSDT', llvBuckets: {} }
  w.__qmLiqServer = null
})
afterEach(() => { vi.restoreAllMocks() })

async function build() {
  const { buildLiqEstimate } = await import('../engines/liqMap')
  buildLiqEstimate()
  return w.S._qmLiqBuckets || {}
}

describe('aducatorul e CHEMAT — altfel unirea de mai jos e cod mort', () => {
  // Mutatia care a scos `setInterval(fetchLiqHistory, 60000)` a SUPRAVIETUIT
  // primei variante a acestui fisier: harta se unea corect, dar nimeni nu mai
  // aducea istoricul, deci scara ramanea exact cum era. Aia e fix capcana
  // SMART_CUT — cod corect in spatele unei cablari rupte — si un test care n-o
  // prinde da o siguranta falsa. Citim CODUL, nu comentariile.
  const fs = require('node:fs') as typeof import('node:fs')
  const src: string = fs.readFileSync(
    '/opt/zeus-terminal/client/src/quantmonitor/index.ts', 'utf8')
    .split('\n').filter((l: string) => !l.trim().startsWith('//')).join('\n')

  it('e importat din liqMap', () => {
    expect(src).toMatch(/import \{[^}]*fetchLiqHistory[^}]*\} from '\.\/engines\/liqMap'/)
  })

  it('se cheama o data la deschidere — scara trebuie plina IMEDIAT, nu peste un minut', () => {
    expect(src).toMatch(/^\s*fetchLiqHistory\(\)/m)
  })

  it('si pe interval, ca istoricul sa nu ramana inghetat la deschidere', () => {
    expect(src).toMatch(/setInterval\(fetchLiqHistory,\s*\d+\)/)
  })

  it('intervalul e inregistrat ca sa fie OPRIT la inchidere (cursa de ciclu de viata)', () => {
    expect(src).toMatch(/intervals\.push\(setInterval\(fetchLiqHistory/)
  })

  it('fisierul a fost chiar citit', () => {
    expect(src.length).toBeGreaterThan(5000)
  })
})

describe('harta de lichidari foloseste istoricul de pe server', () => {

  it('fara istoric, se comporta exact ca inainte — nimic nu se strica', async () => {
    const { QM } = await import('../state')
    QM.liqAgg.binance.btc = []; QM.liqAgg.bybit.btc = []; QM.liqAgg.okx.btc = []
    const b = await build()
    expect(Object.keys(b)).toHaveLength(0)
  })

  it('cosurile de pe server ajung in harta — asta umple scara', async () => {
    const { QM } = await import('../state')
    QM.liqAgg.binance.btc = []; QM.liqAgg.bybit.btc = []; QM.liqAgg.okx.btc = []
    w.__qmLiqServer = {
      asOf: Date.now(),
      buckets: [
        { pct: 5, price: 84000, longUsd: 1_000_000, shortUsd: 0, n: 3 },
        { pct: -1.5, price: 78800, longUsd: 0, shortUsd: 250_000, n: 2 },
      ],
    }
    const b = await build()
    expect(b[5]).toBeTruthy()
    expect(b[5].longVol).toBeCloseTo(1_000_000, 0)
    expect(b[-1.5]).toBeTruthy()
    expect(b[-1.5].shortVol).toBeCloseTo(250_000, 0)
  })

  it('NU numara de doua ori: un eveniment din FEREASTRA acoperita de server e ignorat', async () => {
    // Prima varianta a acestui test trimitea doar `asOf`, fara `since`, si
    // codifica modelul GRESIT („sari peste tot ce e mai vechi decat asOf").
    // Modelul ala a produs regresia din 23:22: pe un simbol fara date la
    // server, clientul isi arunca tot istoricul. Contractul corect e
    // FEREASTRA: serverul spune de unde pana unde acopera.
    const { QM } = await import('../state')
    const asOf = Date.now()
    const since = asOf - 3600_000
    QM.liqAgg.binance.btc = [{ p: 84000, vol: 400_000, side: 'SELL', time: asOf - 60_000 }] as any
    QM.liqAgg.bybit.btc = []; QM.liqAgg.okx.btc = []
    w.__qmLiqServer = { asOf, since, buckets: [{ pct: 5, price: 84000, longUsd: 400_000, shortUsd: 0, n: 1 }] }
    const b = await build()
    expect(b[5].longVol).toBeCloseTo(400_000, 0)   // NU 800.000
  })

  it('dar un eveniment local mai NOU decat reperul intra — nu pierdem direct-ul', async () => {
    const { QM } = await import('../state')
    const asOf = Date.now() - 120_000
    QM.liqAgg.binance.btc = [{ p: 84000, vol: 100_000, side: 'SELL', time: Date.now() }] as any
    QM.liqAgg.bybit.btc = []; QM.liqAgg.okx.btc = []
    w.__qmLiqServer = { asOf, since: asOf - 3600_000, buckets: [{ pct: 5, price: 84000, longUsd: 400_000, shortUsd: 0, n: 1 }] }
    const b = await build()
    expect(b[5].longVol).toBeCloseTo(500_000, 0)
  })

  // ── REGRESIE LIVRATA SI PRINSA DINTR-O CAPTURA (2026-10-25 23:22) ──
  //
  // Dupa livrare, scara operatorului a ramas COMPLET goala — inclusiv cele 6
  // randuri din +-0,75% care aveau date INAINTE. Capturile lui au aratat-o.
  //
  // Cauza era presupunerea mea: „serverul are tot ce are clientul, deci sar
  // peste local ce e mai vechi decat asOf". FALS. Serverul a inceput sa
  // inregistreze abia azi la 20:28; clientul avea 24h in localStorage. Pentru
  // BTC serverul avea ZERO randuri si trimitea asOf=acum, deci garda arunca
  // TOT istoricul local si nu punea nimic in loc.
  //
  // Corect: serverul spune de UNDE incepe acoperirea lui (`since`), iar
  // clientul sare peste local DOAR in fereastra pe care serverul chiar o are.

  it('REGRESIE: fara acoperire pe server, evenimentele locale raman — ca inainte', async () => {
    const { QM } = await import('../state')
    QM.liqAgg.binance.btc = [{ p: 84000, vol: 300_000, side: 'SELL', time: Date.now() - 3600_000 }] as any
    QM.liqAgg.bybit.btc = []; QM.liqAgg.okx.btc = []
    // serverul nu are nimic pe simbolul asta: buckets gol, since 0
    w.__qmLiqServer = { asOf: Date.now(), since: 0, buckets: [] }
    const b = await build()
    expect(b[5]).toBeTruthy()
    expect(b[5].longVol).toBeCloseTo(300_000, 0)
  })

  it('un eveniment local mai VECHI decat acoperirea serverului se pastreaza', async () => {
    const { QM } = await import('../state')
    const since = Date.now() - 1800_000          // serverul are doar ultima jumatate de ora
    QM.liqAgg.binance.btc = [{ p: 84000, vol: 300_000, side: 'SELL', time: since - 3600_000 }] as any
    QM.liqAgg.bybit.btc = []; QM.liqAgg.okx.btc = []
    w.__qmLiqServer = { asOf: Date.now(), since, buckets: [{ pct: 2, price: 81600, longUsd: 50_000, shortUsd: 0, n: 1 }] }
    const b = await build()
    expect(b[5].longVol).toBeCloseTo(300_000, 0)   // local, pastrat
    expect(b[2].longVol).toBeCloseTo(50_000, 0)    // server
  })

  it('dar unul din INTERIORUL acoperirii se sare — acolo chiar se dubla', async () => {
    const { QM } = await import('../state')
    const since = Date.now() - 1800_000
    QM.liqAgg.binance.btc = [{ p: 84000, vol: 300_000, side: 'SELL', time: since + 60_000 }] as any
    QM.liqAgg.bybit.btc = []; QM.liqAgg.okx.btc = []
    w.__qmLiqServer = { asOf: Date.now(), since, buckets: [{ pct: 5, price: 84000, longUsd: 300_000, shortUsd: 0, n: 1 }] }
    const b = await build()
    expect(b[5].longVol).toBeCloseTo(300_000, 0)   // NU 600.000
  })

  it('un raspuns stricat de la server nu darama harta', async () => {
    const { QM } = await import('../state')
    QM.liqAgg.binance.btc = []; QM.liqAgg.bybit.btc = []; QM.liqAgg.okx.btc = []
    for (const bad of [{}, { buckets: 'nu' }, { buckets: [null] }, { buckets: [{ pct: NaN }] }]) {
      w.__qmLiqServer = bad
      await expect(build()).resolves.toBeTruthy()
    }
  })
})
