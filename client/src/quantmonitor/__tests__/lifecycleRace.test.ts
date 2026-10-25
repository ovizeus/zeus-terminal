/**
 * [2026-10-21] QM init() e async si asteapta 8 fetch-uri inainte de a instala
 * temporizatoarele periodice. Panoul il cheama fire-and-forget, iar cleanup-ul
 * React cheama destroy(). Daca panoul se inchide INAINTE ca init sa termine,
 * destroy() ruleaza primul (goleste `intervals`), apoi init isi reia cursul si
 * instaleaza 8 setInterval-uri NOI care nu mai sunt curatate de nimeni.
 *
 * Fetch-urile scurse lovesc /api/market/* la 5s si 10s, PE TERMEN NELIMITAT,
 * pe un sistem cu istoric documentat de banuri de IP Binance. Fiecare
 * deschidere-inchidere rapida mai adauga un set.
 *
 * Dovada intentiei pierdute: panoul avea deja `let destroyed = false` si
 * `void destroyed` DUPA `return` — cod inaccesibil, variabila necitita.
 * Cineva a vrut garda asta si n-a ajuns niciodata cablata.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

let _basisGate: (() => void) | null = null
const fetchBasisRate = vi.fn(async () => {
  // Cand e armata poarta, primul apel rămâne in aer pana il eliberam noi.
  // Asa putem chema destroy() exact in timpul `Promise.all`, adica DUPA
  // prima garda — singurul mod de a dovedi ca garda a doua e necesara.
  if (_basisGate) {
    await new Promise<void>((res) => { _basisGate = res as unknown as () => void })
  }
})
const fetchCrossExchangeFR = vi.fn(async () => {})
const fetchTopTraderPositionRatio = vi.fn(async () => {})

vi.mock('../../data/basisRate', () => ({ fetchBasisRate }))
vi.mock('../../data/crossExchangeFR', () => ({ fetchCrossExchangeFR }))
vi.mock('../../data/btcDominance', () => ({
  fetchBTCDominance: vi.fn(async () => {}), fetchStablecoins: vi.fn(async () => {}),
}))
vi.mock('../../data/onChainMetrics', () => ({
  fetchWeeklyKlines: vi.fn(async () => {}), fetchDailyKlines: vi.fn(async () => {}),
  calcS2F: vi.fn(), calcLogRegression: vi.fn(), calcMarketCycle: vi.fn(),
}))
vi.mock('../../data/okxLiqWS', () => ({ connectOKXLiq: vi.fn(), disconnectOKXLiq: vi.fn() }))
vi.mock('../engines/liqMap', () => ({
  // [LIQ-HISTORY 2026-10-25] fetchLiqHistory e nou. Fabrica asta nu-l avea,
  // deci iesea `undefined` si init() crapa la apel — testul a prins CORECT
  // o cablare incompleta, nu a devenit obsolet. Mock, nu stergere: cursa pe
  // care o apara (doua seturi de temporizatoare) ramane verificata.
  buildLiqEstimate: vi.fn(), fetchTopTraderPositionRatio, fetchLiqHistory: vi.fn(),
}))
vi.mock('../engines/intel', () => ({ runIntel: vi.fn() }))
vi.mock('../engines/flow', () => ({ calcFLOW: vi.fn() }))
vi.mock('../engines/aria', () => ({ calcARIA: vi.fn() }))
vi.mock('../engines/wyckoff', () => ({
  calcWyckoff: vi.fn(), calcCVDDivergence: vi.fn(), calcVolumeProfile: vi.fn(),
}))
vi.mock('../render/frame', () => ({ renderFrame: () => '' }))
vi.mock('../persistence/liqPersist', () => ({
  loadLiqSnapshot: () => ({ restored: 0 }), startLiqPersist: vi.fn(),
  stopLiqPersist: vi.fn(), saveLiqSnapshot: vi.fn(),
}))

let qm: typeof import('../index')

beforeEach(async () => {
  vi.clearAllMocks()
  _basisGate = null
  vi.useFakeTimers()
  ;(window as unknown as Record<string, unknown>).S = { price: 100, klines: [] }
  // init() face un fetch REST direct inainte de Promise.all
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => [] })) as unknown as typeof fetch
  vi.resetModules()
  qm = await import('../index')
})

afterEach(() => {
  try { qm.destroy() } catch { /* ignora */ }
  vi.useRealTimers()
})

describe('QM — cursa intre init si destroy', () => {
  test('control: deschis normal, temporizatoarele periodice chiar pornesc', async () => {
    await qm.init('qm-screen')
    fetchBasisRate.mockClear()
    await vi.advanceTimersByTimeAsync(11000)
    expect(fetchBasisRate.mock.calls.length).toBeGreaterThan(0)
    expect(fetchTopTraderPositionRatio.mock.calls.length).toBeGreaterThan(0)
  })

  test('ASTA E BUG-UL: inchis inainte ca init sa termine -> fetch-urile curg mai departe', async () => {
    const p = qm.init('qm-screen')   // NU asteptam, ca panoul real
    qm.destroy()                      // utilizatorul inchide panoul imediat
    await p                           // init isi reia cursul dupa await-uri

    fetchBasisRate.mockClear()
    fetchTopTraderPositionRatio.mockClear()
    await vi.advanceTimersByTimeAsync(60000)   // un minut dupa inchidere

    expect(fetchBasisRate).not.toHaveBeenCalled()
    expect(fetchTopTraderPositionRatio).not.toHaveBeenCalled()
  })

  test('si nu se acumuleaza: trei deschideri-inchideri rapide lasa zero temporizatoare', async () => {
    for (let i = 0; i < 3; i++) {
      const p = qm.init('qm-screen')
      qm.destroy()
      await p
    }
    fetchBasisRate.mockClear()
    await vi.advanceTimersByTimeAsync(60000)
    expect(fetchBasisRate).not.toHaveBeenCalled()
  })

  test('PRIMA GARDA: inchis in primul fetch -> nu mai cerem cele 7 de dupa', async () => {
    const p = qm.init('qm-screen')
    qm.destroy()        // inchis cat timp ruleaza fetch-ul REST direct
    await p
    // Pe un sistem cu istoric de banuri de IP, 7 cereri inutile per
    // deschidere abandonata nu sunt gratis.
    expect(fetchBasisRate).not.toHaveBeenCalled()
    expect(fetchCrossExchangeFR).not.toHaveBeenCalled()
    expect(fetchTopTraderPositionRatio).not.toHaveBeenCalled()
  })

  test('A DOUA GARDA: inchis in timpul Promise.all, nu doar la primul fetch', async () => {
    // Armam poarta: fetchBasisRate (din Promise.all) rămâne in aer.
    _basisGate = () => {}
    const p = qm.init('qm-screen')
    await Promise.resolve(); await Promise.resolve()   // trecem prima garda
    qm.destroy()                                       // inchidem IN Promise.all
    if (typeof _basisGate === 'function') (_basisGate as () => void)()
    _basisGate = null
    await p

    fetchBasisRate.mockClear()
    await vi.advanceTimersByTimeAsync(60000)
    expect(fetchBasisRate).not.toHaveBeenCalled()
  })

  test('JETONUL: o rulare invalidata nu instaleaza un AL DOILEA set de temporizatoare', async () => {
    // init #1 rămâne in await; inchidem; redeschidem; #2 termina normal.
    // Fara jeton, #1 isi reia cursul (init #2 i-a pus `_destroyed` pe false)
    // si instaleaza inca un set -> cadenta se DUBLEAZA. Nu facem destroy la
    // final, tocmai ca sa masuram cadenta, nu curatenia.
    const p1 = qm.init('qm-screen')
    qm.destroy()
    const p2 = qm.init('qm-screen')
    await p2
    await p1

    fetchBasisRate.mockClear()
    await vi.advanceTimersByTimeAsync(60000)
    // un singur set la 5s = ~12 apeluri pe minut; doua seturi = ~24
    const n = fetchBasisRate.mock.calls.length
    expect(n).toBeGreaterThan(0)      // panoul e deschis, trebuie sa cheme
    expect(n).toBeLessThanOrEqual(13) // dar NU de doua ori
  })

  test('destroy nu lasa nici bucla de randare in urma', async () => {
    const p = qm.init('qm-screen')
    qm.destroy()
    await p
    const el = document.createElement('div')
    el.id = 'qm-screen'
    document.body.appendChild(el)
    el.innerHTML = 'NEATINS'
    await vi.advanceTimersByTimeAsync(5000)
    expect(el.innerHTML).toBe('NEATINS')
  })
})
