// Quantitative Monitor — Main lifecycle: init() / destroy()
// Manages intervals, WS connections, render loop
import { QM, qmLog, addLiq } from './state'
import { runIntel } from './engines/intel'
import { calcFLOW } from './engines/flow'
import { calcARIA } from './engines/aria'
import { fetchMtfKlines } from './engines/mtf'
import { sumDepthVolume } from './engines/depth'
import { calcWyckoff, calcCVDDivergence, calcVolumeProfile } from './engines/wyckoff'
import { buildLiqEstimate, fetchTopTraderPositionRatio } from './engines/liqMap'
import { fetchBasisRate } from '../data/basisRate'
import { fetchCrossExchangeFR } from '../data/crossExchangeFR'
import { fetchBTCDominance, fetchStablecoins } from '../data/btcDominance'
import { fetchWeeklyKlines, fetchDailyKlines, calcS2F, calcLogRegression, calcMarketCycle } from '../data/onChainMetrics'
import { connectOKXLiq, disconnectOKXLiq } from '../data/okxLiqWS'
import { renderFrame } from './render/frame'
import { loadLiqSnapshot, startLiqPersist, stopLiqPersist, saveLiqSnapshot } from './persistence/liqPersist'

const w = window as any
const intervals: ReturnType<typeof setInterval>[] = []
let renderRaf = 0
let renderIv: ReturnType<typeof setInterval> | null = null
let _destroyed = false
// [2026-10-21 b294] Jeton de rulare pentru cursa init/destroy.
// init() e async si asteapta 8 fetch-uri INAINTE de a instala temporizatoarele
// periodice. Panoul il cheama fire-and-forget, iar cleanup-ul React cheama
// destroy(). Daca panoul se inchide inainte ca init sa termine, destroy()
// rula primul (golea `intervals`), apoi init isi relua cursul si instala 8
// setInterval-uri NOI pe care nu le mai curata nimeni: /api/market/* la 5s si
// 10s, pe termen nelimitat, pe un sistem cu istoric de banuri de IP Binance.
// Masurat in test: 12 apeluri pe minut per deschidere scursa, cumulative.
// Un simplu flag `_destroyed` n-ar fi destul: o a doua deschidere il pune pe
// false, iar prima rulare, inca in await, s-ar crede vie. Jetonul face
// fiecare rulare sa-si recunoasca propria generatie.
// Se incrementeaza DOAR in init(): o inchidere simpla e prinsa de `_destroyed`,
// iar o redeschidere bumpeaza generatia oricum. Am avut si un `_runId++` in
// destroy() si l-am scos — testul de mutatie a aratat ca nu schimba nimic,
// deci era cod care parea sa apere ceva.
let _runId = 0
// [PERF-2] Module-level refs to liquidation handlers so destroy() can
// removeEventListener. Without these, every init() call (each panel toggle)
// leaks one zeus:liq + one zeus:okxLiq listener — after ~5 toggles, addLiq
// fires 5× per liquidation event. Anonymous arrow în prior code prevented
// removal entirely; both handlers now refs.
let _liqHandler: ((e: CustomEvent) => void) | null = null
let _okxLiqHandler: ((e: CustomEvent) => void) | null = null

function runAllEngines(): void {
  if (!w.S || !w.S.price) return
  // Map Zeus kline format {open,high,low,close,volume,time} → QM format {o,h,l,c,v,t}
  // Engines expect HTML-style klines (.h, .l, .c, .o, .v, .t)
  if (w.S.klines && w.S.klines.length > 0 && w.S.klines[0].open !== undefined) {
    w.S.klines = w.S.klines.map((k: any) => ({
      o: k.open ?? k.o, h: k.high ?? k.h, l: k.low ?? k.l,
      c: k.close ?? k.c, v: k.volume ?? k.v, t: k.time ?? k.t,
      // Keep originals for Zeus chart
      open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume, time: k.time
    }))
  }

  // Maintain price buffer (for engines that need history)
  w.S._qmBuf = w.S._qmBuf || []
  w.S._qmBuf.push(w.S.price)
  if (w.S._qmBuf.length > 200) w.S._qmBuf.shift()

  // [DEPTH BRIDGE 2026-10-21] Volumul din carte şi istoricul de delta s-au mutat
  // în `_syncQmVars`, unde stau toate punţile — rulează imediat înainte de aici
  // (bucla: _syncQmVars() apoi runAllEngines()), deci motoarele de mai jos
  // citesc exact aceleaşi valori ca înainte, doar că nu mai sunt zero.

  // Run engines
  runIntel()
  calcFLOW()
  calcARIA()
  calcWyckoff()
  calcCVDDivergence()
  calcVolumeProfile()
  buildLiqEstimate()
}

// [P2-QM 2026-06-10] exported for unit tests (acc L/S mapping from S.ls)
export function _syncQmVars(): void {
  const S = w.S; if (!S) return
  // Price fallback chain: WS markPrice → basisRate REST markPrice → last kline close
  if (!S.price || S.price <= 0) {
    if (S.markPrice && S.markPrice > 0) S.price = S.markPrice
    else if (S.klines?.length) S.price = S.klines[S.klines.length - 1].close || 0
  }
  // [DEPTH BRIDGE 2026-10-21] Puntea lipsă, singura CALCULATĂ dintre toate.
  // `obBV`/`obAV` (volum total pe bid / pe ask) erau citite în 11 locuri
  // (runAllEngines, intel.ts de 6 ori, flow.ts:88, frame.ts prin aliasuri) şi
  // scrise în ZERO. Nu lipsea un alias ca la celelalte 28 din b294, lipsea
  // ÎNSUMAREA: datele soseau tot timpul în `S.bids`/`S.asks` din fluxul depth20.
  // Două motoare mureau din asta: CVD Divergence nu putea semnala niciodată
  // (istoricul de delta era `0 - 0` la fiecare tick) şi scorul SMF rămânea
  // blocat pe NEUT (`0 > 0` e fals în ambele sensuri).
  // Scriem pe `S`, nu local, ca să ajungă la toţi cei 11 cititori.
  const _obBV = sumDepthVolume(S.bids), _obAV = sumDepthVolume(S.asks)
  S.obBV = _obBV; S.obAV = _obAV
  S._qmObBV = _obBV; S._qmObAV = _obAV
  // Istoricul de delta e stare derivată din puntea de deasupra, deci stă lângă
  // ea. Rulează înaintea motoarelor (bucla: _syncQmVars apoi runAllEngines),
  // exact ca înainte de mutare.
  S._qmDeltaHist = S._qmDeltaHist || []
  S._qmDeltaHist.push(_obBV - _obAV)
  if (S._qmDeltaHist.length > 40) S._qmDeltaHist.shift()

  S._qmBasisRate = S.basisRate || 0
  S._qmFrBybit = S.frBybit || 0
  S._qmFrOkx = S.frOkx || 0
  S._qmBtcDominance = S.btcDominance || 0
  S._qmBtcDomPrev = S.btcDomPrev || S.btcDominance || 0
  S._qmStableMarketCap = S.stableMarketCap || 0
  S._qmStableChange24h = S.stableChange24h || 0
  S._qmOpenInterest = S.oi || 0
  // [P2-QM 2026-06-10] acc L/S fallback fields had zero writers (always 0%).
  // S.ls = {l, s} percentage split (sum≈100) from fetchLS/lsRatioToSplit;
  // frame.ts multiplies by 100 for display, so store as 0..1 fractions.
  S._qmLongRatio = S.ls?.l ? S.ls.l / 100 : 0
  S._qmShortRatio = S.ls?.s ? S.ls.s / 100 : 0
  S._qmWsOK = !!(S.bnbOk || S.bybOk)
  S._qmChgP = S.chg24hPct || 0
  S._qmH24 = S.high24h || 0
  S._qmL24 = S.low24h || 0
  S._qmVol = S.vol24h || 0
  S._qmBid = S.bids?.[0]?.p || 0
  S._qmAsk = S.asks?.[0]?.p || 0
  S._qmSpread = S._qmAsk > 0 && S._qmBid > 0 ? S._qmAsk - S._qmBid : 0
  // FR from server funding cache (basisRate.ts populates S.fr)
  if (S.fr && S.fr !== 0) S._qmFr = S.fr

  // [2026-10-21 b294] PUNTEA NETERMINATA.
  // Portarea din HTML a aliasat CITIRILE randarii la `S._qmFoo`, dar puntea a
  // rămas la ~20 de campuri din 157. Masurat pe tot repo-ul (1014 fisiere):
  // 71 de campuri citite de frame.ts n-aveau niciun scriitor. Cele 28 de mai
  // jos erau cazul supărător — valoarea EXISTA deja pe S, calculata la fiecare
  // 60s de calcS2F/calcLogRegression/calcMarketCycle si de basisRate, si era
  // aruncata. Exemplu masurat pe date vii: Mayer Multiple real 1,137
  // (BTC $82.743 / media 200 zile $72.767) in timp ce panoul afisa 0.
  // Celelalte 43 n-au nicio sursa in cod — alea sunt functii neterminate, nu
  // punte lipsa, si rămân in Book ca atare.
  S._qmAtr = S.atr || 0
  S._qmMarkPrice = S.markPrice || 0
  S._qmIndexPrice = S.indexPrice || 0
  S._qmFundingRate = S.fr || 0
  S._qmOiValue = S.oi || 0
  // Stock-to-Flow
  S._qmS2fValue = S.s2fValue || 0
  S._qmS2fModelPrice = S.s2fModelPrice || 0
  S._qmS2fDeviation = S.s2fDeviation || 0
  // Mayer Multiple + medii lungi
  S._qmMayer200dma = S.mayer200dma || 0
  S._qmMayerMultiple = S.mayerMultiple || 0
  S._qmWma200 = S.wma200 || 0
  S._qmWmaRatio = S.wmaRatio || 0
  // Regresie logaritmica
  S._qmLogRegMid = S.logRegMid || 0
  S._qmLogRegHigh = S.logRegHigh || 0
  S._qmLogRegLow = S.logRegLow || 0
  S._qmLogRegPos = S.logRegPos || 0
  // Metrici on-chain derivate
  S._qmNupl = S.nupl || 0
  S._qmRealizedProxy = S.realizedProxy || 0
  S._qmRhodlScore = S.rhodlScore || 0
  S._qmPuell = S.puell || 0
  // Pi Cycle Top
  S._qmPi111 = S.pi111 || 0
  S._qmPi350x2 = S.pi350x2 || 0
  S._qmPiSignal = S.piSignal || ''
  // Ciclul de piata
  S._qmCyclePct = S.cyclePct || 0
  S._qmCyclePhase = S.cyclePhase || ''
  S._qmCyclePhaseClr = S.cyclePhaseClr || ''
  S._qmCycleDaysElapsed = S.cycleDaysElapsed || 0
  S._qmCycleDaysRemain = S.cycleDaysRemain || 0
}

function startRenderLoop(screenId: string): void {
  renderIv = setInterval(() => {
    if (_destroyed) return
    const el = document.getElementById(screenId)
    if (!el) return
    _syncQmVars()
    runAllEngines()
    el.innerHTML = renderFrame()
  }, 500)
  intervals.push(renderIv)
}

export async function init(screenId: string, _canvasId?: string): Promise<void> {
  const myRun = ++_runId
  // Rularea asta e inca cea curenta? (vezi comentariul de la _runId)
  const aborted = () => _destroyed || myRun !== _runId
  _destroyed = false
  qmLog('SYS', 'ZeuS Quantitative Monitor V2.0.0')
  qmLog('SYS', 'Initializing engines...')

  // Verify Zeus data is available
  if (!w.S || !w.S.price) {
    qmLog('SYS', 'Waiting for Zeus data feed...')
  }

  // [BUG5.5.3] Restore 24h liq snapshot from localStorage before WS connects
  // so the map is immediately populated with what was there last session.
  const { restored } = loadLiqSnapshot()
  if (restored > 0) qmLog('SYS', `Restored ${restored} liq events from last session`)

  // Connect OKX liquidation WS
  connectOKXLiq()

  // Subscribe to existing Zeus liquidation events
  // [PERF-2] Both handlers stored in module refs so destroy() can remove them.
  _liqHandler = (e: CustomEvent) => {
    if (_destroyed) return
    addLiq(e.detail.exchange || 'binance', e.detail)
  }
  _okxLiqHandler = (e: CustomEvent) => {
    if (_destroyed) return
    addLiq('okx', e.detail)
  }
  window.addEventListener('zeus:liq', _liqHandler as EventListener)
  window.addEventListener('zeus:okxLiq', _okxLiqHandler as EventListener)

  // [QM-FIX] Ensure price is available from REST before rendering
  try {
    const pr = await fetch('/api/market/klines?symbol=BTCUSDT&interval=5m&limit=1')
    if (pr.ok) {
      const kd = await pr.json()
      if (Array.isArray(kd) && kd.length && w.S) {
        const close = +kd[0][4]
        if (close > 0 && (!w.S.price || w.S.price <= 0)) w.S.price = close
      }
    }
  } catch (_) {}

  // Panoul s-a inchis in timpul fetch-ului de mai sus? Ieșim inainte sa mai
  // cerem 7 lucruri de care nimeni nu are nevoie.
  if (aborted()) return

  // Fetch new data sources
  await Promise.all([
    fetchBasisRate(),
    fetchCrossExchangeFR(),
    fetchBTCDominance(),
    fetchStablecoins(),
    fetchTopTraderPositionRatio(),
    fetchWeeklyKlines(),
    fetchDailyKlines(),
    fetchMtfKlines(),
  ]).catch(() => { /* silent */ })

  calcS2F()
  calcLogRegression()
  calcMarketCycle()

  // GARDA CARE CONTEAZA: tot ce urmeaza instaleaza temporizatoare si
  // ascultatori. Daca panoul s-a inchis in timpul await-urilor de mai sus,
  // destroy() a rulat deja si a golit `intervals`, deci orice am porni acum
  // ar rula pentru totdeauna, nevazut si necuratat.
  if (aborted()) return

  qmLog('SYS', 'All engines ready — rendering')

  // Start periodic fetches
  intervals.push(setInterval(fetchBasisRate, 5000))
  intervals.push(setInterval(fetchCrossExchangeFR, 30000))
  intervals.push(setInterval(fetchBTCDominance, 300000))
  intervals.push(setInterval(fetchStablecoins, 600000))
  intervals.push(setInterval(fetchTopTraderPositionRatio, 10000))
  // Stiva MTF: 3 cereri (5m/1h/1d) la 3 minute = 1 cerere/minut. Cache-ul
  // serverului ţine klines 60 s, deci o cadenta mai rapida n-ar aduce date mai
  // proaspete, doar trafic spre Binance pe un sistem cu istoric de banuri.
  intervals.push(setInterval(() => { fetchMtfKlines() }, 180000))
  intervals.push(setInterval(() => { fetchWeeklyKlines() }, 3600000))
  intervals.push(setInterval(() => { fetchDailyKlines() }, 900000))
  intervals.push(setInterval(() => { calcS2F(); calcLogRegression(); calcMarketCycle() }, 60000))

  // Start render loop
  startRenderLoop(screenId)

  // [2026-06-26] Liquidation-direction particles removed (green-flood flicker source).

  // [BUG5.5.3] Throttled save every 10s + flush on beforeunload/pagehide
  startLiqPersist()
}

export function destroy(): void {
  _destroyed = true
  // [BUG5.5.3] Final flush of liq snapshot before teardown so closing the panel
  // (or switching away) does not lose the 24h rolling buffer.
  saveLiqSnapshot(true)
  stopLiqPersist()
  intervals.forEach(iv => clearInterval(iv))
  intervals.length = 0
  if (renderIv) { clearInterval(renderIv); renderIv = null }
  if (renderRaf) { cancelAnimationFrame(renderRaf); renderRaf = 0 }
  disconnectOKXLiq()
  // [PERF-2] Remove zeus:liq + zeus:okxLiq listeners to prevent zombie
  // accumulation across init/destroy cycles
  if (_liqHandler) {
    window.removeEventListener('zeus:liq', _liqHandler as EventListener)
    _liqHandler = null
  }
  if (_okxLiqHandler) {
    window.removeEventListener('zeus:okxLiq', _okxLiqHandler as EventListener)
    _okxLiqHandler = null
  }
  // Clean QM state from w.S
  if (w.S) {
    Object.keys(w.S).filter((k: string) => k.startsWith('_qm')).forEach((k: string) => delete w.S[k])
  }
  QM.logs.length = 0
  QM.session.entries.length = 0
}
