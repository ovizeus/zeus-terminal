// Quantitative Monitor — Main lifecycle: init() / destroy()
// Manages intervals, WS connections, render loop
import { QM, qmLog, addLiq } from './state'
import { startPoll } from '../utils/poll'
import { day24Of } from '../engine/liqPulse'
import { getSignalData, getKlines } from '../services/stateAccessors'
import { runIntel } from './engines/intel'
import { calcFLOW } from './engines/flow'
import { calcARIA } from './engines/aria'
import { fetchMtfKlines } from './engines/mtf'
import { sumDepthVolume } from './engines/depth'
import { normalizeKlines } from './engines/klinesNorm'
import { calcWyckoff, calcCVDDivergence, calcVolumeProfile } from './engines/wyckoff'
import { buildLiqEstimate, fetchTopTraderPositionRatio, fetchLiqHistory } from './engines/liqMap'
import { fetchBasisRate } from '../data/basisRate'
import { fetchTicker24 } from './engines/ticker24'
import { fetchCrossExchangeFR } from '../data/crossExchangeFR'
import { fetchBTCDominance, fetchStablecoins } from '../data/btcDominance'
import { fetchWeeklyKlines, fetchDailyKlines, calcS2F, calcLogRegression, calcMarketCycle } from '../data/onChainMetrics'
import { connectOKXLiq, disconnectOKXLiq } from '../data/okxLiqWS'
import { renderFrame } from './render/frame'
import { loadLiqSnapshot, startLiqPersist, stopLiqPersist, saveLiqSnapshot } from './persistence/liqPersist'

const w = window as any
const intervals: ReturnType<typeof setInterval>[] = []
// [2026-11-16] Buclele rapide (5 s / 10 s) prin startPoll: nimic in fundal, fara suprapuneri.
const polls: (() => void)[] = []
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
  // Map Zeus kline format {open,high,low,close,volume,time} → QM format {o,h,l,c,v,t}.
  // [KLINES REMAP 2026-10-21] Înainte, asta remapa TOT vectorul la fiecare tick:
  // garda testa `klines[0].open !== undefined`, iar remap-ul păstra `open` pentru
  // graficul Zeus, deci condiţia nu se putea stinge niciodată — ~1 000 de obiecte
  // pe secundă, 3,6 milioane pe oră, pe aceleaşi date. Acum convertim doar barele
  // care n-au încă formatul QM: tot vectorul la o aducere proaspătă, şi numai
  // coada când lumânarea vie e înlocuită (marketDataChart.ts:142/162/193 o pune
  // la loc în format Zeus, deci ea TREBUIE prinsă — vezi engines/klinesNorm.ts).
  normalizeKlines(w.S.klines)

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

  // [CVD REAL 2026-10-21] Afişajul CVD avea zero scriitori, deci arăta mereu
  // +0.000. Sursa NU e puntea de deasupra: CVD înseamnă delta din tranzacţii
  // EXECUTATE, nu dezechilibrul cărţii de ordine — alimentat din adâncime ar
  // scrie „CVD" peste un număr care nu e CVD. Vine din acumulatorul de pe calea
  // de aggTrade (orderflow.ts `_onMsg`), singurul loc care vede tranzacţii reale.
  // Scriem pe AMBELE nume: `_qmCumDelta` e citit de randare, iar `cumDelta`
  // (fără prefix) e citit de scorul SMF în flow.ts:105, cu ±15 puncte. Al doilea
  // n-avea nici el scriitor, deci SMF avea DOUĂ intrări moarte, nu una — prima
  // (obBV/obAV) a fost reparată în b301, asta e a doua.
  const _cvd = w.RAW_FLOW?.cumDelta || 0
  S._qmCumDelta = _cvd; S.cumDelta = _cvd

  // [RSI REAL 2026-10-21] `_qmRsi` n-avea scriitor, iar randarea face
  // `S._qmRsi || 50`, deci panoul afişa CONSTANT `RSI:50.0`, cu culoarea de
  // neutru — un „neutru" care arată ca o citire reală. Mai înşelător decât un
  // zero: zeroul se vede ca lipsă, 50 se vede ca informaţie.
  // Sursa exista şi e populată: `S.rsi[tf]` (marketDataFeeds.ts:239). Intervalul
  // canonic pentru o citire VIE e '5m' — exact ce foloseşte panoul existent
  // pentru RSI-ul live (`dtrsic`). Nu scriem nimic când lipseşte, ca să nu
  // inventăm o valoare; atunci randarea rămâne pe propriul ei fallback.
  const _rsi5 = S.rsi?.['5m']
  if (Number.isFinite(_rsi5)) S._qmRsi = _rsi5

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
  // [2026-11-21] 24h LIQUIDATIONS: campurile n-aveau scriitor ($0 mereu). Acum totalurile MASURATE pe
  // 24h ale monedei din chart (server liq-panel, aceeasi cerere ca cadranul LIQ). Fara date: null → „—".
  {
    const d24 = day24Of(String(S.symbol || 'BTCUSDT'))
    S._qmLiq24hLong = d24 ? d24.long : null
    S._qmLiq24hShort = d24 ? d24.short : null
    S._qmLiq24hTotal = d24 ? d24.total : null
  }
  // [2026-11-21] Punti lipsa (R-C-15): regimul si faza EXISTA in BM (RegimeEngine / PhaseFilter, calculate
  // la fiecare ciclu) dar monitorul afisa implicite inventate („RANGING", 50%, NORMAL, ×1.0).
  {
    const _BM = (window as any).BM || {}
    const re = _BM.regimeEngine, pf = _BM.phaseFilter
    if (re && re.regime) { S._qmReRegime = String(re.regime).toUpperCase(); S._qmReConf = Number(re.confidence) || 0; S._qmReTrap = Number(re.trapRisk) || 0 }
    if (pf && pf.phase) { S._qmPfPhase = String(pf.phase).toUpperCase(); S._qmPfRisk = String(pf.riskMode || 'normal').toUpperCase(); S._qmPfSize = Number(pf.sizeMultiplier) > 0 ? Number(pf.sizeMultiplier) : 1; S._qmPfAllow = pf.allow !== false }
    // Primele randuri (AI CONF / SIGNAL / DIFF / SLOPE) erau constante: 50% / 0% / 0 / 0.
    // CONF = confluenta reala; SIGNAL = cat de unite sunt semnalele (majoritatea / total);
    // DIFF = schimbarea ultimei lumanari (fractie); SLOPE = panta EMA20 pe 10 bare (%), ca regimeEnhanced.
    // MAGNET / MAG BIAS: „$0.00 ()" si „BELOW" mereu. Acum magnetii reali ai aplicatiei (S.magnets,
    // calculati in ui/panels.ts: pereti din carte, niveluri de volum, niveluri ATR).
    const mg = S.magnets, px = Number(S._qmPrice || S.price) || 0
    const near = (arr: any[], up: boolean) => {
      let best: number | null = null
      for (const m of arr || []) { const p = Number(typeof m === 'number' ? m : m && m.price); if (!(p > 0)) continue; if (up ? p <= px : p >= px) continue; if (best == null || Math.abs(p - px) < Math.abs(best - px)) best = p }
      return best
    }
    if (mg && px > 0) {
      const a = near(mg.above, true), b = near(mg.below, false)
      S._qmMagnetUpPct = a != null ? ((a - px) / px) * 100 : 0
      S._qmMagnetDnPct = b != null ? ((b - px) / px) * 100 : 0
      const pick = a != null && (b == null || a - px <= px - b) ? a : b
      if (pick != null) { S._qmLiqMagnet = pick; S._qmLiqSide = pick >= px ? 'ABOVE' : 'BELOW' }
    }
    const mb = String(S.magnetBias || '').toLowerCase()
    S._qmMagBias = mb === 'above' || mb === 'up' || mb === 'bull' ? 'ABOVE' : mb === 'below' || mb === 'down' || mb === 'bear' ? 'BELOW' : (S._qmMagnetUpPct && S._qmMagnetDnPct ? (Math.abs(S._qmMagnetUpPct) <= Math.abs(S._qmMagnetDnPct) ? 'ABOVE' : 'BELOW') : S._qmMagBias)
    // ── Pereti din carte (ASK/BID WALLS): nimeni nu-i scria. Nivelurile ≥ 3,5× media (ca in ui/panels).
    const wallsOf = (rows: any[]) => {
      const lv = (rows || []).map((r: any) => ({ p: Number(r && (r.p ?? r[0])), q: Number(r && (r.q ?? r[1])) })).filter((r) => r.p > 0 && r.q > 0)
      if (!lv.length) return []
      const avg = lv.reduce((s2, r) => s2 + r.q, 0) / lv.length
      return lv.filter((r) => r.q >= avg * 3.5).sort((x, y) => y.q - x.q).slice(0, 5)
    }
    S._qmAskWalls = wallsOf(S.asks); S._qmBidWalls = wallsOf(S.bids)
    // ── Istoric propriu al monitorului: pret (1/s, 20 min), OI (1/min, 70 min), funding (1/5 min, 24 valori).
    const nowMs = Date.now()
    const ring = (key: string, v: number, everyMs: number, keepMs: number) => {
      const arr: Array<{ t: number; v: number }> = S[key] || (S[key] = [])
      if (Number.isFinite(v) && v !== 0 && (!arr.length || nowMs - arr[arr.length - 1].t >= everyMs)) arr.push({ t: nowMs, v })
      while (arr.length && nowMs - arr[0].t > keepMs) arr.shift()
      return arr
    }
    const pxR = ring('_qmPxRing', px, 1000, 20 * 60000)
    const trendOver = (min: number): number => {
      if (!pxR.length || nowMs - pxR[0].t < min * 60000 * 0.9) return 0          // 0 = inca nu stim („—")
      const win = pxR.filter((x) => nowMs - x.t <= min * 60000)
      const mean = win.reduce((s2, x) => s2 + x.v, 0) / win.length
      return px > mean * (1 + 1e-4) ? 1 : px < mean * (1 - 1e-4) ? -1 : 0
    }
    S._qmTrend1m = trendOver(1); S._qmTrend5m = trendOver(5); S._qmTrend15m = trendOver(15)
    const oiR = ring('_qmOiRing', Number(S.oi), 60000, 70 * 60000)
    const old = oiR.find((x) => nowMs - x.t >= 60 * 60000)
    S._qmOiChange1h = old && old.v > 0 ? ((oiR[oiR.length - 1].v - old.v) / old.v) * 100 : 0
    const frR = ring('_qmFrRing', Number(S.fr), 5 * 60000, 24 * 5 * 60000)
    S._qmFrHist = frR.map((x) => x.v)
    S._qmFrTrend = frR.length > 1 ? frR[frR.length - 1].v - frR[0].v : 0
    S._qmTicks = (S._qmTicks || 0) + 1
    S._qmFlowTickRate = Number(S._qmTicksPerSec) || 0
    S._qmFlowSampleCount = pxR.length
    const cs = Number(_BM.confluenceScore)
    if (Number.isFinite(cs)) S._qmConf = cs
    // ACT (langa AI CONF) era „HOLD" mereu. Acum: peste pragul de confluenta → directia majoritatii
    // semnalelor (BUY / SELL); altfel HOLD. Doar afisaj — nu e o comanda.
    try {
      const sd = getSignalData(), thr = Number(_BM.confMin) > 0 ? Number(_BM.confMin) : 65
      S._qmAct = Number.isFinite(cs) && cs >= thr && sd.bullCount !== sd.bearCount ? (sd.bullCount > sd.bearCount ? 'BUY' : 'SELL') : 'HOLD'
    } catch { S._qmAct = 'HOLD' }
    // SIGNAL ACCURACY LOG „(30s outcome check)": nimeni nu-l scria. Fiecare trecere HOLD→BUY/SELL se
    // noteaza cu pretul; dupa 30 s: HIT daca pretul a mers in directia semnalului, altfel MISS.
    {
      const th: any[] = S._qmTrapHist || (S._qmTrapHist = [])
      if (S._qmAct !== 'HOLD' && S._qmAct !== S._qmLastAct && px > 0) th.push({ act: S._qmAct, price: px, time: nowMs, checked: false, hit: false })
      S._qmLastAct = S._qmAct
      for (const t of th) if (!t.checked && nowMs - t.time >= 30000 && px > 0) { t.checked = true; t.hit = t.act === 'BUY' ? px > t.price : px < t.price }
      while (th.length > 50) th.shift()
    }
    // Trap rate (ARIA): din capcanele MMTRAP reale (flow.ts) — cate s-au CONFIRMAT, adica pretul a
    // continuat in sensul intoarcerii dupa 30 s. Fara capcane verificate: „─", nu 0%.
    {
      const seen: any[] = S._qmTrapSeen || (S._qmTrapSeen = [])
      for (const tr of S._qmMmtrapHist || []) if (!seen.some((x) => x.time === tr.time) && px > 0) seen.push({ time: tr.time, type: tr.type, price: px, done: false, ok: false })
      for (const x of seen) if (!x.done && nowMs - x.time >= 30000 && px > 0) { x.done = true; x.ok = x.type === 'SHORT' ? px < x.price : px > x.price }
      while (seen.length && nowMs - seen[0].time > 3600000) seen.shift()
      const done = seen.filter((x) => x.done)
      if (done.length) { const ok = done.filter((x) => x.ok).length; S._qmTrapRatePct = Math.round((ok / done.length) * 100); S._qmTrapRateStr = `${S._qmTrapRatePct}% (${ok}/${done.length})` }
      else { S._qmTrapRatePct = 0; S._qmTrapRateStr = '─' }
    }
    try {
      const sd = getSignalData(); const tot = (sd.bullCount || 0) + (sd.bearCount || 0)
      S._qmSig = tot > 0 ? (Math.max(sd.bullCount, sd.bearCount) / tot) * 100 : 0
    } catch { /* fara semnale */ }
    const kl = getKlines()
    if (kl && kl.length >= 30) {
      const c = kl.slice(-60).map((k: any) => +k.close)
      const a = 2 / 21; let e = c[0]; const ema = c.map((v: number) => (e = v * a + e * (1 - a)))
      const e0 = ema[ema.length - 10], e1 = ema[ema.length - 1]
      S._qmSlope = e0 > 0 ? ((e1 - e0) / e0) * 100 : 0
      const p0 = c[c.length - 2], p1 = c[c.length - 1]
      S._qmMom = p0 > 0 ? (p1 - p0) / p0 : 0
      // EMA cross str: EMA9 − EMA21 in puncte de baza din pret (era 0 mereu)
      const emaN = (n: number) => { const k = 2 / (n + 1); let v = c[0]; for (const x of c) v = x * k + v * (1 - k); return v }
      S._qmEmaCrossStr = p1 > 0 ? ((emaN(9) - emaN(21)) / p1) * 1e4 : 0
    }
  }
  // [2026-11-15] Datele de 24h sunt ale monedei din chart — daca moneda s-a
  // schimbat si ticker-ul inca e al celei vechi, nu le aratam (0 = „inca nu").
  const _t24ok = !S.ticker24Sym || String(S.symbol || 'BTCUSDT').toUpperCase() === S.ticker24Sym
  S._qmChgP = _t24ok ? (S.chg24hPct || 0) : 0
  S._qmH24 = _t24ok ? (S.high24h || 0) : 0
  S._qmL24 = _t24ok ? (S.low24h || 0) : 0
  S._qmVol = _t24ok ? (S.vol24h || 0) : 0
  S._qmQuoteVol = _t24ok ? (S.quoteVol24h || 0) : 0
  S._qmBid = S.bids?.[0]?.p || 0
  S._qmAsk = S.asks?.[0]?.p || 0
  // PRICE: pretul viu; pana soseste (sau dupa o schimbare de moneda, cand e
  // pus pe 0) mijlocul carte de ordine, apoi pretul de marcaj, apoi ultimul
  // pret din ticker. Inainte panoul arata PRICE 0.00 langa BID/ASK reale.
  S._qmPrice = qmDisplayPrice(S)
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

// [2026-11-15] „Pe telefon, daca intru, se blocheaza." Bucla rescria tot ecranul
// (sute de randuri de text cu culori) la fiecare 500 ms, si in fundal, si cand
// panoul nu se vedea; o exceptie dintr-un calcul iesea necaptata in fiecare tic.
// Acum: nu deseneaza cand pagina e ascunsa sau panoul nu e pe ecran, nu rescrie
// DOM-ul cand nu s-a schimbat nimic, prinde erorile, iar pe ecrane inguste
// (telefon) deseneaza o data pe secunda.
let _lastHtml = ''
function startRenderLoop(screenId: string): void {
  const every = (typeof window !== 'undefined' && window.innerWidth && window.innerWidth < 760) ? 1000 : 500
  renderIv = setInterval(() => {
    if (_destroyed) return
    if (typeof document !== 'undefined' && document.hidden) return
    const el = document.getElementById(screenId)
    if (!el || (el as HTMLElement).offsetParent === null && el.getClientRects().length === 0) return
    try {
      _syncQmVars()
      runAllEngines()
      const html = renderFrame()
      if (html !== _lastHtml) { el.innerHTML = html; _lastHtml = html }
    } catch (e: any) {
      console.warn('[QM] render tick failed:', e?.message || e)
    }
  }, every)
  intervals.push(renderIv)
}

/** Pretul afisat: viu, apoi mijlocul cartii, apoi marcajul, apoi ultimul din ticker. */
export function qmDisplayPrice(S: any): number {
  const live = Number(S?.price)
  if (live > 0) return live
  const b = Number(S?.bids?.[0]?.p), a = Number(S?.asks?.[0]?.p)
  if (b > 0 && a > 0 && a >= b) return (a + b) / 2
  const mark = Number(S?.markPrice)
  if (mark > 0) return mark
  const last = Number(S?.last24h)
  return last > 0 ? last : 0
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
    fetchTicker24(),
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
  polls.push(startPoll(fetchBasisRate, 5000, { immediate: false }))
  intervals.push(setInterval(fetchTicker24, 30000))
  intervals.push(setInterval(fetchCrossExchangeFR, 30000))
  intervals.push(setInterval(fetchBTCDominance, 300000))
  intervals.push(setInterval(fetchStablecoins, 600000))
  polls.push(startPoll(fetchTopTraderPositionRatio, 10000, { immediate: false }))
  // [LIQ-HISTORY 2026-10-25] Istoricul de 30 de zile. O data la deschidere ca
  // scara sa fie plina IMEDIAT, apoi la 60 s — mai des n-ar aduce nimic, e
  // istoric, iar reperul `asOf` acopera oricum golul cu evenimente in direct.
  fetchLiqHistory()
  intervals.push(setInterval(fetchLiqHistory, 60000))
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
  polls.forEach(stop => stop())
  polls.length = 0
  _lastHtml = ''
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
