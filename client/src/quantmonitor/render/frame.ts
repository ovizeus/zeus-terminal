// QM Render — 1:1 port from ZeuS Modern Quantitative Trading.html render()
import { QM, getLiqTotals } from '../state'
import { bar, binLine, fmtUSD, heatBarOB, asciiChart, cvdChart } from './ascii'

const w = window as any
const REQ = 75

// --- helper: liqMap (order book depth heatmap) ---
function liqMap(): string[] {
  const S = w.S
  const bids: any[] = S?.bids || []
  const asks: any[] = S?.asks || []
  if (!bids.length) return ['  <span class="dg">Loading...</span>']
  const lines: string[] = [], dec = 0, bw = 28
  const bSize = 50
  const bidB: Record<number, number> = {}, askB: Record<number, number> = {}
  bids.forEach((b: any) => { const bk = Math.floor(b.p / bSize) * bSize; bidB[bk] = (bidB[bk] || 0) + b.q })
  asks.forEach((a: any) => { const bk = Math.floor(a.p / bSize) * bSize; askB[bk] = (askB[bk] || 0) + a.q })
  const bidK = Object.keys(bidB).map(Number).sort((a, b) => b - a).slice(0, 6)
  const askK = Object.keys(askB).map(Number).sort((a, b) => a - b).slice(0, 6)
  const maxV = Math.max(...bidK.map(k => bidB[k]), ...askK.map(k => askB[k]), 0.001)
  const price = S?.price || 0
  const spread = S?._qmSpread || 0
  const askWalls: any[] = S?._qmAskWalls || []
  const bidWalls: any[] = S?._qmBidWalls || []

  ;[...askK].reverse().forEach(p => {
    const vol = askB[p], norm = vol / maxV
    const isWall = askWalls.slice(0, 3).some((wl: any) => Math.abs(wl.p - p) < bSize * 1.5)
    lines.push(`  <span class="r">${p.toFixed(dec).padStart(10)}</span> <span class="dg">ASK</span> ${heatBarOB(norm, bw, 'ask')} <span class="dg">${vol.toFixed(3).padStart(9)}</span>${isWall ? '<span class="rb"> \u25C4WALL</span>' : ''}`)
  })
  lines.push(`  <span class="yb">${('\u25BA $' + price.toFixed(dec)).padStart(10)}</span> <span class="y">\u2550\u2550\u2550\u2550\u2550\u2550\u2550 PRICE \u2550\u2550\u2550\u2550\u2550\u2550\u2550</span> <span class="dg">spread:$${spread.toFixed(dec)}</span>`)
  bidK.forEach(p => {
    const vol = bidB[p], norm = vol / maxV
    const isWall = bidWalls.slice(0, 3).some((wl: any) => Math.abs(wl.p - p) < bSize * 1.5)
    lines.push(`  <span class="g">${p.toFixed(dec).padStart(10)}</span> <span class="dg">BID</span> ${heatBarOB(norm, bw, 'bid')} <span class="dg">${vol.toFixed(3).padStart(9)}</span>${isWall ? '<span class="gb"> \u25C4WALL</span>' : ''}`)
  })
  return lines
}

// --- helper: liqChart (liquidation map chart) ---
function liqChart(): string[] {
  const S = w.S
  const price = S?.price || 0
  if (!price) return ['  <span class="dg">Waiting for price data...</span>']

  const dec = 0
  const lines: string[] = []
  const barW = 22
  const liqBuckets: Record<number, any> = S?._qmLiqBuckets || {}
  const realLiqs: any[] = S?._qmRealLiqs || []

  const allLevels: any[] = []
  // [BUG5.5] Multi-resolution levels: 0.25% near price, 0.5% mid, 1% far.
  // Each display level sums all 0.25%-granularity buckets within its window.
  const addLevel = (pct: number, stepSize: number) => {
    if (Math.abs(pct) < 0.1) return
    const half = stepSize / 2
    const lo = pct - half, hi = pct + half
    let longSum = 0, shortSum = 0
    for (const bkStr in liqBuckets) {
      const bpct = +bkStr
      if (bpct >= lo && bpct < hi) {
        const bucket = liqBuckets[bkStr]
        longSum += bucket.longVol || 0
        shortSum += bucket.shortVol || 0
      }
    }
    const vol = pct < 0 ? longSum : shortSum
    const realCount = realLiqs.filter((l: any) => {
      const lpct = ((l.p - price) / price * 100)
      return lpct >= lo && lpct < hi
    }).length
    allLevels.push({ pct, price: price * (1 + pct / 100), vol, realCount, side: pct < 0 ? 'LONG' : 'SHORT', levs: [] })
  }
  // Near zone: 0.25% step, 0.25 → 6%
  for (let pct = 0.25; pct <= 6; pct += 0.25) { addLevel(+pct.toFixed(2), 0.25); addLevel(+(-pct).toFixed(2), 0.25) }
  // Mid zone: 0.5% step, 6.5 → 14%
  for (let pct = 6.5; pct <= 14; pct += 0.5) { addLevel(pct, 0.5); addLevel(-pct, 0.5) }
  // Far zone: 1% step, 15 → 25%
  for (let pct = 15; pct <= 25; pct += 1) { addLevel(pct, 1); addLevel(-pct, 1) }

  const maxVol = Math.max(...allLevels.map(l => l.vol), 1)

  const mkBar = (vol: number, side: string): string => {
    const norm = vol / maxVol
    const filled = Math.round(norm * barW)
    const cls = side === 'SHORT' ? ['sq1', 'sq2', 'sq3', 'sq4', 'sq5', 'sq6'] : ['rq1', 'rq2', 'rq3', 'rq4', 'rq5', 'rq6']
    let s = ''
    for (let i = 0; i < barW; i++) {
      if (i < filled) { const int = filled > 0 ? i / filled : 0; const ci = int > 0.83 ? 5 : int > 0.66 ? 4 : int > 0.5 ? 3 : int > 0.33 ? 2 : int > 0.16 ? 1 : 0; s += `<span class="${cls[ci]}">\u2588</span>` }
      else s += `<span class="d">\u00B7</span>`
    }
    return s
  }

  // SHORT liquidations -- above price, far->near
  const shorts = allLevels.filter(l => l.pct > 0).sort((a, b) => b.pct - a.pct)
  lines.push(`  <span class="sq5"> \u25B2 SHORT LIQUIDATIONS</span> <span class="dg">(price UP \u2192 shorts rekt)</span>`)
  lines.push(`  <span class="dg"> PRICE        DIST    VOLUME                    EST.USD  \u25CF</span>`)
  lines.push(`  <span class="dg"> \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500  \u2500\u2500\u2500\u2500\u2500\u2500  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500  \u2500\u2500\u2500\u2500\u2500\u2500\u2500  \u2500</span>`)
  shorts.forEach(l => {
    const dp = Math.abs(l.pct) < 1 ? 2 : 1
    const dist = ('+' + l.pct.toFixed(dp) + '%').padStart(6)
    const isHot = l.pct <= 1
    const pclr = isHot ? 'yb' : 'sq4'
    const realTag = l.realCount > 0 ? `<span class="sq6">\u25CF</span>` : '<span class="d">\u00B7</span>'
    const hotTag = isHot ? '<span class="sq6"> \u25C4</span>' : l.pct <= 2 ? '<span class="sq5"> \u25C4</span>' : ''
    const volStr = l.vol > 0 ? `<span class="sq4">${fmtUSD(l.vol).padStart(7)}</span>` : `<span class="d">    \u2500  </span>`
    lines.push(` <span class="${pclr}">$${l.price.toFixed(dec).padStart(9)}</span> <span class="sq3">${dist}</span>  ${mkBar(l.vol, 'SHORT')} ${volStr} ${realTag}${hotTag}`)
  })

  // Current price
  lines.push(` <span class="yb">$${price.toFixed(dec).padStart(9)}</span> <span class="yb">  0.0%</span>  <span class="y">\u2550\u2550\u2550\u2550\u2550\u2550 CURRENT PRICE \u2550\u2550\u2550\u2550\u2550\u2550</span>`)

  // LONG liquidations -- below price, near->far
  const longs = allLevels.filter(l => l.pct < 0).sort((a, b) => b.pct - a.pct)
  lines.push(`  <span class="dg"> \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500  \u2500\u2500\u2500\u2500\u2500\u2500  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500  \u2500\u2500\u2500\u2500\u2500\u2500\u2500  \u2500</span>`)
  longs.forEach(l => {
    const dp = Math.abs(l.pct) < 1 ? 2 : 1
    const dist = (l.pct.toFixed(dp) + '%').padStart(6)
    const isHot = l.pct >= -1
    const pclr = isHot ? 'yb' : 'rq4'
    const realTag = l.realCount > 0 ? `<span class="rq6">\u25CF</span>` : '<span class="d">\u00B7</span>'
    const hotTag = isHot ? '<span class="rq6"> \u25C4</span>' : l.pct >= -2 ? '<span class="rq5"> \u25C4</span>' : ''
    const volStr = l.vol > 0 ? `<span class="rq4">${fmtUSD(l.vol).padStart(7)}</span>` : `<span class="d">    \u2500  </span>`
    lines.push(` <span class="${pclr}">$${l.price.toFixed(dec).padStart(9)}</span> <span class="rq3">${dist}</span>  ${mkBar(l.vol, 'LONG')} ${volStr} ${realTag}${hotTag}`)
  })
  lines.push(`  <span class="rq5"> \u25BC LONG LIQUIDATIONS</span> <span class="dg">(price DOWN \u2192 longs rekt)</span>`)

  const posLongRatio = S?._qmPosLongRatio || 0
  const posShortRatio = S?._qmPosShortRatio || 0
  const longRatio = S?._qmLongRatio || 0
  const shortRatio = S?._qmShortRatio || 0
  const openInterest = S?._qmOpenInterest || 0
  const posRatio = posLongRatio > 0 ? `pos ${(posLongRatio * 100).toFixed(0)}%L/${(posShortRatio * 100).toFixed(0)}%S` : `acc ${(longRatio * 100).toFixed(0)}%L/${(shortRatio * 100).toFixed(0)}%S`
  const liqEventCount = (realLiqs.length || 0) + Object.keys(S?.llvBuckets || {}).length
  lines.push(`  <span class="dg">\u25CF real event | ${posRatio} | OI:${openInterest.toFixed(0)}BTC | real liq feed 24h | src: BNB+BYB+OKX | ${liqEventCount} lvl</span>`)

  return lines
}

// --- helper: getPressureTrend ---
function getPressureTrend(): { avg: number; trend: number; rising: boolean } {
  const h: any[] = w.S?._qmPressureHist || []
  if (h.length < 5) return { avg: 0.5, trend: 0, rising: false }
  const avg = h.reduce((s: number, p: any) => s + p.ratio, 0) / h.length
  const recent = h.slice(-5).reduce((s: number, p: any) => s + p.ratio, 0) / 5
  const old = h.slice(0, 5).reduce((s: number, p: any) => s + p.ratio, 0) / Math.min(5, h.length)
  return { avg, trend: recent - old, rising: recent > old }
}

// ================================================================
// RENDER FRAME
// ================================================================
export function renderFrame(): string {
  const S = w.S || {}
  const WALLET = QM.wallet
  const SESSION = QM.session
  const LIQS = QM.liqAgg
  const logs = QM.logs
  const MACRO_EVENTS = QM.macroEvents
  const wsOK = !!S._qmWsOK

  // Alias all b.xxx reads to S / S._qmXxx
  const price: number = S.price || 0
  const chgP: number = S._qmChgP || 0
  const h24: number = S._qmH24 || 0
  const l24: number = S._qmL24 || 0
  const vol: number = S._qmVol || 0
  const bid: number = S._qmBid || 0
  const ask: number = S._qmAsk || 0
  const spread: number = S._qmSpread || 0
  const obBV: number = S._qmObBV || 0
  const obAV: number = S._qmObAV || 0
  const conf: number = S._qmConf || 50
  const sig: number = S._qmSig || 0
  const act: string = S._qmAct || 'HOLD'
  const slope: number = S._qmSlope || 0
  const mom: number = S._qmMom || 0
  const rsi: number = S._qmRsi || 50
  const ticks: number = S._qmTicks || 0
  const liqMagnet: number = S._qmLiqMagnet || 0
  const liqSide: string = S._qmLiqSide || ''
  const cumDelta: number = S._qmCumDelta || 0
  const openInterest: number = S._qmOpenInterest || 0
  const oiValue: number = S._qmOiValue || 0
  const fundingRate: number = S._qmFundingRate || 0
  const longRatio: number = S._qmLongRatio || 0
  const shortRatio: number = S._qmShortRatio || 0
  const oiChange1h: number = S._qmOiChange1h || 0
  const frTrend: number = S._qmFrTrend || 0
  const frHist: number[] = S._qmFrHist || []
  const liq24hLong: number = S._qmLiq24hLong || 0
  const liq24hShort: number = S._qmLiq24hShort || 0
  const liq24hTotal: number = S._qmLiq24hTotal || 0
  const whales: any[] = S._qmWhales || []
  const pressureHist: any[] = S._qmPressureHist || []
  const spreadAvg: number = S._qmSpreadAvg || 0
  const spreadAlert: boolean = !!S._qmSpreadAlert
  const atr: number = S._qmAtr || 0
  const mfi: number = S._qmMfi || 50
  const absorption: any = S._qmAbsorption || { detected: false, side: '', strength: 0 }
  const vwap: number = S._qmVwap || 0
  const volPercentile: number = S._qmVolPercentile || 0
  const regime: string = S._qmRegime || 'RANGING'
  const adx: number = S._qmAdx || 0
  const cascadeRisk: number = S._qmCascadeRisk || 0
  const cascadeZone: string = S._qmCascadeZone || ''
  const orderFlowDelta: number = S._qmOrderFlowDelta || 0
  const ofdHist: number[] = S._qmOfdHist || []
  const fearGreed: number = S._qmFearGreed || 50
  const ticksPerSec: number = S._qmTicksPerSec || 0
  const bbUpper: number = S._qmBbUpper || 0
  const bbLower: number = S._qmBbLower || 0
  const bbMiddle: number = S._qmBbMiddle || 0
  const bbPos: number = S._qmBbPos || 50
  const bbWidth: number = S._qmBbWidth || 0
  const bbSqueeze: boolean = !!S._qmBbSqueeze
  const bbSqueezeStr: number = S._qmBbSqueezeStr || 0
  const nearestSupport: any = S._qmNearestSupport || null
  const nearestResist: any = S._qmNearestResist || null
  const trend1m: number = S._qmTrend1m || 0
  const trend5m: number = S._qmTrend5m || 0
  const trend15m: number = S._qmTrend15m || 0
  const emaCrossStr: number = S._qmEmaCrossStr || 0
  const divergence: string = S._qmDivergence || 'NONE'

  // MTF / RE / PF
  const reRegime: string = S._qmReRegime || 'RANGING'
  const mtfAlignDetailed: any = S._qmMtfAlignDetailed || {}
  const mtfAlignScore: number = S._qmMtfAlignScore || 0
  const trapRatePct: number = S._qmTrapRatePct || 0
  const trapRateStr: string = S._qmTrapRateStr || '\u2500'
  const magnetUpPct: number = S._qmMagnetUpPct || 0
  const magnetDnPct: number = S._qmMagnetDnPct || 0
  const magBias: string = S._qmMagBias || 'BELOW'
  const reTrap: number = S._qmReTrap || 0
  const reConf: number = S._qmReConf || 50
  const pfPhase: string = S._qmPfPhase || ''
  const pfRisk: string = S._qmPfRisk || 'NORMAL'
  const pfSize: number = S._qmPfSize || 1

  // Flow engine
  const flowState: string = S._qmFlowState || 'NEUT'
  const flowTickRate: number = S._qmFlowTickRate || 0
  const flowSampleCount: number = S._qmFlowSampleCount || 0
  const tapeSpeed: string = S._qmTapeSpeed || 'NORMAL'
  const vacDir: string = S._qmVacDir || ''
  const vacPct: number = S._qmVacPct || 0
  const vacTs: number = S._qmVacTs || 0
  const iceActive: boolean = !!S._qmIceActive
  const iceTop: number = S._qmIceTop || 0
  const iceT2: number = S._qmIceT2 || 0
  const iceTs: number = S._qmIceTs || 0
  const flipActive: boolean = !!S._qmFlipActive
  const flipPrv: number = S._qmFlipPrv || 0
  const flipCur: number = S._qmFlipCur || 0
  const flipZ: number = S._qmFlipZ || 0
  const flipTs: number = S._qmFlipTs || 0
  const mmState: string = S._qmMmState || 'IDLE'
  const mmPct: number = S._qmMmPct || 0
  const exhaustActive: boolean = !!S._qmExhaustActive
  const exhaustSide: string = S._qmExhaustSide || ''
  const exhaustTs: number = S._qmExhaustTs || 0
  const voidActive: boolean = !!S._qmVoidActive
  const voidTs: number = S._qmVoidTs || 0
  const bidWalls: any[] = S._qmBidWalls || []
  const stopState: string = S._qmStopState || 'IDLE'
  const stopTs: number = S._qmStopTs || 0
  const smfState: string = S._qmSmfState || 'NEUT'
  const smfScore: number = S._qmSmfScore || 0

  // ARIA
  const ariaCurrentPat: any = S._qmAriaCurrentPat || null
  const ariaCandleType: string = S._qmAriaCandleType || '\u2500'
  const ariaCandleVol: string = S._qmAriaCandleVol || '\u2500'
  const ariaWaiting: boolean = !!S._qmAriaWaiting
  const ariaMTF: Record<string, number> = S._qmAriaMTF || {}
  const ariaWatch: string = S._qmAriaWatch || 'WATCH'
  const ariaPatterns: any[] = S._qmAriaPatterns || []

  // On-chain
  const cyclePct: number = S._qmCyclePct || 0
  const cyclePhase: string = S._qmCyclePhase || ''
  const cyclePhaseClr: string = S._qmCyclePhaseClr || 'dg'
  const cycleDaysElapsed: number = S._qmCycleDaysElapsed || 0
  const cycleDaysRemain: number = S._qmCycleDaysRemain || 0
  const wma200: number = S._qmWma200 || 0
  const wmaRatio: number = S._qmWmaRatio || 0
  const puell: number = S._qmPuell || 0
  const s2fValue: number = S._qmS2fValue || 0
  const s2fModelPrice: number = S._qmS2fModelPrice || 0
  const s2fDeviation: number = S._qmS2fDeviation || 0
  const pi111: number = S._qmPi111 || 0
  const pi350x2: number = S._qmPi350x2 || 0
  const piSignal: boolean = !!S._qmPiSignal
  const rhodlScore: number = S._qmRhodlScore || 50
  const mayerMultiple: number = S._qmMayerMultiple || 0
  const mayer200dma: number = S._qmMayer200dma || 0
  const nupl: number = S._qmNupl || 0
  const realizedProxy: number = S._qmRealizedProxy || 0
  const logRegLow: number = S._qmLogRegLow || 0
  const logRegMid: number = S._qmLogRegMid || 0
  const logRegHigh: number = S._qmLogRegHigh || 0
  const logRegPos: number = S._qmLogRegPos || 50

  // Advanced
  const basisRate: number = S._qmBasisRate || 0
  const markPrice: number = S._qmMarkPrice || 0
  const indexPrice: number = S._qmIndexPrice || 0
  const cvdDivergence: string = S._qmCvdDivergence || 'NONE'
  const cvdDivDir: string = S._qmCvdDivDir || ''
  const frBybit: number = S._qmFrBybit || 0
  const frOkx: number = S._qmFrOkx || 0
  const btcDominance: number = S._qmBtcDominance || 0
  const btcDomPrev: number = S._qmBtcDomPrev || btcDominance
  const stableMarketCap: number = S._qmStableMarketCap || 0
  const stableChange24h: number = S._qmStableChange24h || 0
  const wyckoffPhase: string = S._qmWyckoffPhase || 'UNKNOWN'
  const wyckoffEvent: string = S._qmWyckoffEvent || '\u2500'
  const wyckoffBias: string = S._qmWyckoffBias || 'NEUT'
  const vpNodes: any[] = S._qmVpNodes || []
  const vpPOC: number = S._qmVpPOC || 0
  const vpVAH: number = S._qmVpVAH || 0
  const vpVAL: number = S._qmVpVAL || 0
  const trapHist: any[] = S._qmTrapHist || []

  const ts = new Date().toLocaleTimeString('en-GB', { hour12: false })
  const btcCh = asciiChart(14, 20)
  const o: string[] = []
  function L(t: string) { o.push(t) }

  // === HEADER ===
  L(`<span class="g">\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550</span>`)
  L(`<span class="w"> *ZeuS Smart Alpha AI [V2.0.0]*</span> <span class="dg">(Modern Quantitative Trading)</span>`)
  L(`<span class="g">\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550</span>`)
  L(`<span class="dg">[PATH]: /zeus/ai_engine/btcusdt/config.json</span>`)
  L(`<span class="dg">[STREAM]: wss://stream.binance.com:9443 | BTCUSDT only</span>`)
  L(``)
  L(`<span class="dg">[ SPEED ]</span> |<span class="c">${bar(Math.random() * 10, 25, 25)}</span>| <span class="c">${(Math.random() * 1.2).toFixed(4)} ms</span>`)
  L(``)
  L(`<span class="dg">EXCHANGE: Binance | ACC: ${wsOK ? 'CONNECTED' : 'CONNECTING...'}</span>`)
  L(`<span class="dg">\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550</span>`)

  // === BTC + CHART ===
  const left: string[] = []
  left.push(`<span class="dg">PRICE</span>  : <span class="w">$${price.toFixed(2)}</span> ${chgP >= 0 ? `<span class="g">+${chgP.toFixed(2)}%\u25B2</span>` : `<span class="r">${chgP.toFixed(2)}%\u25BC</span>`}`)
  left.push(`<span class="dg">HIGH</span>   : $${h24.toFixed(2)}`)
  left.push(`<span class="dg">LOW</span>    : $${l24.toFixed(2)}`)
  left.push(`<span class="dg">VOL</span>    : ${vol.toLocaleString(undefined, { maximumFractionDigits: 0 })}`)
  left.push(`<span class="dg">BID</span>: $${bid.toFixed(2)} <span class="dg">ASK</span>: $${ask.toFixed(2)}`)
  left.push(`<span class="dg">SPREAD</span> : $${spread.toFixed(2)}`)
  left.push(``)
  const btt = obBV + obAV, bbp = btt > 0 ? obBV / btt * 100 : 50, bap = btt > 0 ? obAV / btt * 100 : 50
  left.push(`<span class="dg">\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</span>`)
  left.push(`<span class="g">BUY</span>:${Math.round(bbp).toString().padStart(3)}% [<span class="g">${bar(bbp, 100, 12)}</span>] <span class="r">SELL</span>:${Math.round(bap).toString().padStart(3)}% [<span class="r">${bar(bap, 100, 12)}</span>]`)
  left.push(``)
  const bact = act === 'BUY' ? `<span class="gb">${act}</span>` : act === 'SELL' ? `<span class="rb">${act}</span>` : `<span class="yb">${act}</span>`
  left.push(`<span class="dg">AI CONF</span> : [<span class="g">${bar(conf, 100, 14)}</span>] <span class="g">${conf.toFixed(1)}%</span> ${bact}`)
  left.push(`<span class="dg">SIGNAL</span>  : [<span class="c">${bar(sig, 100, 14)}</span>] <span class="c">${sig.toFixed(1)}%</span>`)
  left.push(`<span class="dg">SLOPE</span>:${slope >= 0 ? '+' : ''}${slope.toFixed(4)} <span class="dg">Bid</span>:${price.toFixed(2)}`)
  left.push(`<span class="dg">DIFF</span> :${mom.toFixed(5)} <span class="dg">CONF</span>:${Math.round(conf)}%/${REQ}% ${conf >= REQ ? '<span class="g">\u25CF</span>' : '<span class="r">\u25CB</span>'}`)
  left.push(`<span class="dg">RSI</span>:<span class="${rsi > 70 ? 'r' : rsi < 30 ? 'g' : 'y'}">${rsi.toFixed(1)}</span> <span class="dg">MOM</span>:${mom >= 0 ? '+' : ''}${mom.toFixed(4)}%`)
  left.push(``)
  left.push(`<span class="dg">PROFIT</span> : <span class="g">+0.00 USD</span> <span class="dg">(Goal 15)</span>`)

  const leftW = 38
  for (let i = 0; i < Math.max(left.length, btcCh.length); i++) {
    const ll = left[i] || '', rr = btcCh[i] || ''
    const clean = ll.replace(/<[^>]+>/g, '')
    L(ll + ' '.repeat(Math.max(0, leftW - clean.length)) + ' <span class="g">' + rr + '</span>')
  }
  L(``)

  // === LIQUIDITY MAP (OB Depth) ===
  L(`<span class="c">\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550</span>`)
  L(`<span class="c"> LIQUIDITY MAP</span> <span class="dg">\u2014 Order Flow | 100 levels | 3s refresh</span>`)
  L(`<span class="c">\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550</span>`)
  L(``)
  L(`<span class="w"> BTCUSDT</span> <span class="dg">Depth</span>`)
  L(`<span class="dg">\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</span>`)
  liqMap().forEach(l => L(l))
  L(``)
  L(`  <span class="yb">\u25C4 MAGNET \u25BA</span> <span class="w">$${liqMagnet.toFixed(2)}</span> <span class="dg">(${liqSide})</span>`)
  const bImb = btt > 0 ? ((obBV - obAV) / btt * 100) : 0
  L(`  <span class="dg">IMBALANCE:</span> <span class="${bImb > 0 ? 'g' : 'r'}">${bImb >= 0 ? '+' : ''}${bImb.toFixed(1)}%</span> <span class="dg">${bImb > 0 ? 'BUYERS' : 'SELLERS'}</span>  <span class="dg">CVD:</span> <span class="${cumDelta >= 0 ? 'g' : 'r'}">${cumDelta >= 0 ? '+' : ''}${cumDelta.toFixed(3)}</span>`)
  L(cvdChart())
  L(``)

  // ================================================================
  // === MARKET INTELLIGENCE -- 7 Tools ===
  // ================================================================
  L(`<span class="p">\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550</span>`)
  L(`<span class="p"> MARKET INTELLIGENCE</span> <span class="dg">\u2014 12 Real-Time Analysis Tools + 6 Pro Modules</span>`)
  L(`<span class="p">\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550</span>`)
  L(``)

  // 1. WHALE ALERT
  const bWhales = whales.filter((wh: any) => Date.now() - wh.time < 120000)
  L(`  <span class="c">WHALE DETECTOR</span> <span class="dg">(orders >3BTC)</span>`)
  {
    const wSlice = bWhales.slice(-4).sort((a: any, bw: any) => bw.time - a.time)
    for (let i = 0; i < 4; i++) {
      const wh = wSlice[i]
      if (wh) { const cls = wh.side === 'BID' ? 'g' : 'r'; L(`  <span class="${cls}"> ${wh.side}</span> BTC <span class="w">${wh.q.toFixed(3)}</span> <span class="dg">@ $${wh.p.toFixed(2)}</span>`) }
      else L(`  <span class="d">\u00B7</span>`)
    }
  }
  L(``)

  // 2. BUY/SELL PRESSURE 5min
  const bPr = getPressureTrend()
  L(`  <span class="c">BUY/SELL PRESSURE</span> <span class="dg">(5min rolling)</span>`)
  const bPrClr = bPr.avg > 0.55 ? 'g' : bPr.avg < 0.45 ? 'r' : 'y'
  const bPrDir = bPr.rising ? '<span class="g">\u25B2</span>' : '<span class="r">\u25BC</span>'
  L(`  <span class="dg">BTC:</span> <span class="${bPrClr}">${(bPr.avg * 100).toFixed(1)}% BUY</span> ${bPrDir} <span class="dg">trend:${bPr.trend >= 0 ? '+' : ''}${(bPr.trend * 100).toFixed(2)}%</span>`)

  {
    let sp = '  <span class="dg">BTC 5m:</span> '
    const ph = pressureHist.slice(-25)
    if (ph.length > 5) ph.forEach((p: any) => { sp += `<span class="${p.ratio > 0.52 ? 'g' : p.ratio < 0.48 ? 'r' : 'y'}">\u25AE</span>` })
    else sp += '<span class="dg">accumulating...</span>'
    L(sp)
  }
  L(``)

  // 3. SPREAD MONITOR
  L(`  <span class="c">SPREAD MONITOR</span>`)
  const bSpAlert = spreadAlert ? '<span class="rb"> WIDENING</span>' : '<span class="g"> NORMAL</span>'
  L(`  <span class="dg">BTC:</span> $${spread.toFixed(2)} <span class="dg">avg:$${spreadAvg.toFixed(2)}</span>${bSpAlert}`)
  L(``)

  // 5. VOLATILITY INDEX (ATR)
  L(`  <span class="c">VOLATILITY INDEX</span> <span class="dg">(ATR-14 on 1m)</span>`)
  const bAtrPct = price > 0 ? (atr / price * 100) : 0
  const bVolLvl = bAtrPct > 0.15 ? '<span class="rb">HIGH</span>' : bAtrPct > 0.05 ? '<span class="y">MEDIUM</span>' : '<span class="g">LOW</span>'
  L(`  <span class="dg">BTC ATR:</span> <span class="w">$${atr.toFixed(2)}</span> <span class="dg">(${bAtrPct.toFixed(3)}%)</span> ${bVolLvl}`)

  L(bAtrPct > 0.15 ? `  <span class="rb">!! BTC HIGH VOLATILITY \u2014 large move incoming</span>` : `  <span class="d">\u00B7</span>`)
  L(``)

  // 6. MONEY FLOW INDEX
  L(`  <span class="c">MONEY FLOW INDEX</span> <span class="dg">(MFI-14)</span>`)
  const bMfiClr = mfi > 80 ? 'rb' : mfi < 20 ? 'gb' : mfi > 60 ? 'r' : mfi < 40 ? 'g' : 'y'
  const bMfiTag = mfi > 80 ? 'OVERBOUGHT' : mfi < 20 ? 'OVERSOLD' : mfi > 60 ? 'BULLISH' : mfi < 40 ? 'BEARISH' : 'NEUTRAL'
  L(`  <span class="dg">BTC:</span> <span class="${bMfiClr}">${mfi.toFixed(1)}</span> [<span class="${bMfiClr}">${bar(mfi, 100, 15)}</span>] <span class="${bMfiClr}">${bMfiTag}</span>`)
  L(``)

  // 7. ORDER BOOK ABSORPTION
  L(`  <span class="c">OB ABSORPTION</span> <span class="dg">(stealth accumulation)</span>`)
  if (absorption.detected) {
    const abClr = absorption.side === 'BID' ? 'g' : 'r'
    L(`  <span class="dg">BTC:</span> <span class="${abClr}b">ABSORBING on ${absorption.side}</span> <span class="dg">str:</span><span class="y">${absorption.strength.toFixed(0)}%</span>`)
    L(`  <span class="yb">Whale accumulating \u2014 price held while volume consumed</span>`)
  } else {
    L(`  <span class="dg">BTC: No absorption detected</span>`)
    L(`  <span class="d">\u00B7</span>`)
  }

  L(``)

  // 8. VWAP
  L(`  <span class="c">VWAP</span> <span class="dg">(Volume Weighted Avg Price)</span>`)
  const bVwapDiff = price - vwap
  const bVwapPct = vwap > 0 ? (bVwapDiff / vwap * 100) : 0
  const bVwapClr = bVwapDiff > 0 ? 'g' : 'r'
  const bVwapTag = bVwapDiff > 0 ? 'ABOVE \u2014 bullish' : 'BELOW \u2014 bearish'
  L(`  <span class="dg">BTC:</span> <span class="w">$${vwap.toFixed(2)}</span> <span class="${bVwapClr}">${bVwapDiff >= 0 ? '+' : ''}${bVwapDiff.toFixed(2)} (${bVwapPct >= 0 ? '+' : ''}${bVwapPct.toFixed(3)}%)</span> <span class="dg">${bVwapTag}</span>`)
  L(``)

  // 9. VOLUME PERCENTILE
  L(`  <span class="c">VOLUME PERCENTILE</span> <span class="dg">(current vs 60 candles)</span>`)
  const bVpClr = volPercentile > 80 ? 'rb' : volPercentile > 60 ? 'y' : volPercentile < 20 ? 'g' : 'dg'
  const bVpTag = volPercentile > 90 ? 'EXTREME' : volPercentile > 75 ? 'HIGH' : volPercentile > 50 ? 'ABOVE AVG' : volPercentile > 25 ? 'NORMAL' : 'LOW'
  L(`  <span class="dg">BTC:</span> [<span class="${bVpClr}">${bar(volPercentile, 100, 18)}</span>] <span class="${bVpClr}">${volPercentile.toFixed(0)}%</span> <span class="${bVpClr}">${bVpTag}</span>`)
  L(volPercentile > 85 ? `  <span class="rb">!! BTC VOLUME SPIKE \u2014 unusual activity</span>` : `  <span class="d">\u00B7</span>`)
  L(``)

  // 10. MARKET REGIME
  L(`  <span class="c">MARKET REGIME</span> <span class="dg">(ADX + ATR derived)</span>`)
  const regClr: Record<string, string> = { TRENDING: 'gb', VOLATILE: 'rb', RANGING: 'y', TRANSITION: 'dg' }
  const regDesc: Record<string, string> = { TRENDING: 'Strong directional move', VOLATILE: 'Chaotic \u2014 wide swings', RANGING: 'Sideways \u2014 mean reverting', TRANSITION: 'Shifting \u2014 watch for breakout' }
  L(`  <span class="dg">BTC:</span> <span class="${regClr[regime] || 'dg'}">${regime}</span> <span class="dg">ADX:${adx.toFixed(1)} \u2014 ${regDesc[regime] || ''}</span>`)

  L(``)

  // 11. LIQUIDATION CASCADE RISK
  L(`  <span class="c">CASCADE RISK</span> <span class="dg">(clustered liqs within 3% of price)</span>`)
  const bCasClr = cascadeRisk > 50 ? 'rb' : cascadeRisk > 25 ? 'y' : 'g'
  const bCasTag = cascadeRisk > 60 ? 'DANGER \u2014 cascade likely' : cascadeRisk > 30 ? 'ELEVATED' : 'LOW'
  L(`  <span class="dg">BTC:</span> [<span class="${bCasClr}">${bar(cascadeRisk, 100, 15)}</span>] <span class="${bCasClr}">${cascadeRisk.toFixed(1)}%</span> <span class="dg">${cascadeZone} zone</span> <span class="${bCasClr}">${bCasTag}</span>`)

  L(cascadeRisk > 50 ? `  <span class="rb">!! BTC ${cascadeZone} CASCADE \u2014 chain liquidation risk HIGH</span>` : `  <span class="d">\u00B7</span>`)
  L(``)

  // 12. ORDER FLOW DELTA
  L(`  <span class="c">ORDER FLOW DELTA</span> <span class="dg">(taker buy vs sell, 10 candles)</span>`)
  const bOfd = orderFlowDelta
  const bOfdClr = bOfd > 10 ? 'g' : bOfd < -10 ? 'r' : 'y'
  const bOfdTag = bOfd > 20 ? 'AGGRESSIVE BUYERS' : bOfd < -20 ? 'AGGRESSIVE SELLERS' : bOfd > 5 ? 'BUYERS LEADING' : bOfd < -5 ? 'SELLERS LEADING' : 'BALANCED'
  L(`  <span class="dg">BTC:</span> <span class="${bOfdClr}">${bOfd >= 0 ? '+' : ''}${bOfd.toFixed(1)}%</span> <span class="${bOfdClr}">${bOfdTag}</span>`)
  {
    let sp = '  <span class="dg">BTC OFD:</span> '
    if (ofdHist.length > 3) ofdHist.slice(-20).forEach((v: number) => { sp += `<span class="${v > 5 ? 'g' : v < -5 ? 'r' : 'y'}">|</span>` })
    else sp += '<span class="dg">accumulating...</span>'
    L(sp)
  }
  L(``)

  // 13. BOLLINGER BANDS + SQUEEZE
  L(`  <span class="c">BOLLINGER BANDS</span> <span class="dg">(20-period, 2\u03C3)</span>`)
  const bBBPosClr = bbPos > 85 ? 'rb' : bbPos < 15 ? 'gb' : bbPos > 70 ? 'r' : bbPos < 30 ? 'g' : 'y'
  L(`  <span class="dg">BTC:</span> <span class="r">U:$${bbUpper.toFixed(0)}</span> <span class="y">M:$${bbMiddle.toFixed(0)}</span> <span class="g">L:$${bbLower.toFixed(0)}</span> <span class="dg">pos:</span><span class="${bBBPosClr}">${bbPos.toFixed(0)}%</span> <span class="dg">bw:</span>${bbWidth.toFixed(3)}%`)
  // BB position visual
  const bbBarW = 30
  const bBBFill = Math.round(bbPos / 100 * bbBarW)
  let bbVisB = '  <span class="dg">BTC:</span> <span class="g">L</span>['
  for (let i = 0; i < bbBarW; i++) {
    if (i === bBBFill) bbVisB += '<span class="w">\u25C6</span>'
    else if (i < bbBarW * 0.15 || i > bbBarW * 0.85) bbVisB += '<span class="rb">\u2500</span>'
    else if (i < bbBarW * 0.3 || i > bbBarW * 0.7) bbVisB += '<span class="y">\u2500</span>'
    else bbVisB += '<span class="g">\u2500</span>'
  }
  bbVisB += ']<span class="r">U</span>'
  L(bbVisB)
  L(bbSqueeze ? `  <span class="yb">!! SQUEEZE DETECTED</span> <span class="dg">\u2014 low volatility compression, breakout imminent (str:${bbSqueezeStr.toFixed(0)}%)</span>` : `  <span class="d">\u00B7</span>`)

  L(``)

  // 14. SUPPORT/RESISTANCE
  L(`  <span class="c">SUPPORT / RESISTANCE</span> <span class="dg">(auto-detected pivots)</span>`)
  {
    const bNR = nearestResist
    if (bNR) {
      const dist = ((bNR.price - price) / price * 100)
      const prox = dist < 0.1 ? '<span class="rb"> \u25C4 TESTING</span>' : dist < 0.3 ? '<span class="y"> CLOSE</span>' : ''
      L(`  <span class="dg">BTC</span> <span class="r">R: $${bNR.price.toFixed(0)}</span> <span class="dg">(+${dist.toFixed(2)}% | ${bNR.touches}x tested)</span>${prox}`)
    } else L(`  <span class="dg">R: accumulating pivot data...</span>`)
    const bNS = nearestSupport
    if (bNS) {
      const dist = ((price - bNS.price) / price * 100)
      const prox = dist < 0.1 ? '<span class="gb"> \u25C4 TESTING</span>' : dist < 0.3 ? '<span class="y"> CLOSE</span>' : ''
      L(`  <span class="dg">BTC</span> <span class="g">S: $${bNS.price.toFixed(0)}</span> <span class="dg">(-${dist.toFixed(2)}% | ${bNS.touches}x tested)</span>${prox}`)
    } else L(`  <span class="dg">S: accumulating pivot data...</span>`)
  }

  L(``)

  // 15. MULTI-TIMEFRAME TREND MATRIX
  L(`  <span class="c">TREND MATRIX</span> <span class="dg">(multi-window EMA cross)</span>`)
  const tIcon = (v: number) => v === 1 ? '<span class="gb">\u25B2 UP</span>' : '<span class="rb">\u25BC DN</span>'
  const bT1 = trend1m, bT5 = trend5m, bT15 = trend15m
  const bAlign = bT1 === bT5 && bT5 === bT15
  L(`  <span class="dg">         1m      5m     15m     ALIGN</span>`)
  L(`  <span class="dg">BTC</span>    ${tIcon(bT1)}   ${tIcon(bT5)}   ${tIcon(bT15)}   ${bAlign ? (bT1 === 1 ? '<span class="gb">ALL BULLISH \u25C4\u25C4</span>' : '<span class="rb">ALL BEARISH \u25C4\u25C4</span>') : '<span class="y">MIXED</span>'}`)

  const bECS = emaCrossStr
  L(`  <span class="dg">BTC EMA cross str:</span> <span class="${bECS > 0 ? 'g' : 'r'}">${bECS >= 0 ? '+' : ''}${bECS.toFixed(1)} bps</span>`)
  L(``)

  // 16. DIVERGENCE DETECTOR
  L(`  <span class="c">DIVERGENCE DETECTOR</span> <span class="dg">(price vs RSI, 20-tick window)</span>`)
  const divClr: Record<string, string> = { BULLISH: 'gb', BEARISH: 'rb', NONE: 'dg' }
  const divDesc: Record<string, string> = { BULLISH: 'Price \u2193 + RSI \u2191 \u2014 reversal up likely', BEARISH: 'Price \u2191 + RSI \u2193 \u2014 reversal down likely', NONE: 'No divergence' }
  L(`  <span class="dg">BTC:</span> <span class="${divClr[divergence] || 'dg'}">${divergence}</span> <span class="dg">\u2014 ${divDesc[divergence] || ''}</span>`)
  L(divergence !== 'NONE' ? `  <span class="${divClr[divergence] || 'dg'}">!! BTC ${divergence} DIVERGENCE \u2014 high probability reversal signal</span>` : `  <span class="d">\u00B7</span>`)
  L(``)

  // 17. FEAR & GREED COMPOSITE
  L(`  <span class="c">FEAR & GREED INDEX</span> <span class="dg">(composite: RSI+MFI+FR+L/S+OB+VOL+OFD)</span>`)
  const bFG = fearGreed
  const fgLabel = (v: number) => v >= 80 ? 'EXTREME GREED' : v >= 60 ? 'GREED' : v >= 45 ? 'NEUTRAL' : v >= 25 ? 'FEAR' : 'EXTREME FEAR'
  const fgClr = (v: number) => v >= 80 ? 'rb' : v >= 60 ? 'g' : v >= 45 ? 'y' : v >= 25 ? 'r' : 'rb'
  const fgBar = (v: number) => {
    let s = ''; const w2 = 25, f = Math.round(v / 100 * w2)
    for (let i = 0; i < w2; i++) {
      if (i < f) {
        if (i < w2 * 0.2) s += '<span class="rb">\u2588</span>'
        else if (i < w2 * 0.4) s += '<span class="r">\u2588</span>'
        else if (i < w2 * 0.6) s += '<span class="y">\u2588</span>'
        else if (i < w2 * 0.8) s += '<span class="g">\u2588</span>'
        else s += '<span class="gb">\u2588</span>'
      } else s += '<span class="d">\u2591</span>'
    }
    return s
  }
  L(`  <span class="dg">BTC:</span> ${fgBar(bFG)} <span class="${fgClr(bFG)}">${bFG.toFixed(0)}</span> <span class="${fgClr(bFG)}">${fgLabel(bFG)}</span>`)
  L(`  <span class="dg">FEAR\u25C4\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u25BAGREED</span>`)
  L(``)

  // 18. TAPE SPEED
  L(`  <span class="c">TAPE SPEED</span> <span class="dg">(tick rate analysis)</span>`)
  const bTPS = ticksPerSec
  const tsClr = (v: number) => v > 8 ? 'rb' : v > 3 ? 'g' : 'dg'
  const tsTag = (v: number) => v > 8 ? 'FAST \u2014 high activity' : v > 3 ? 'NORMAL' : 'SLOW \u2014 low activity'
  L(`  <span class="dg">BTC:</span> <span class="${tsClr(bTPS)}">${bTPS.toFixed(1)} ticks/s</span> <span class="${tsClr(bTPS)}">${tsTag(bTPS)}</span>`)
  L(bTPS > 10 ? `  <span class="rb">!! RAPID TAPE \u2014 algo/HFT activity spike</span>` : `  <span class="d">\u00B7</span>`)

  L(``)
  // ================================================================
  L(`<span class="y">\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550</span>`)
  L(`<span class="yb"> LIQUIDATION MAP</span> <span class="dg">\u2014 Binance + Bybit + OKX | Real-Time Aggregated</span>`)
  L(`<span class="y">\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550</span>`)
  L(``)

  // Exchange connection status
  const binSt = (LIQS as any).binance?.connected ? '<span class="g">\u25CF ON</span>' : '<span class="r">\u25CB OFF</span>'
  const bybSt = (LIQS as any).bybit?.connected ? '<span class="g">\u25CF ON</span>' : '<span class="r">\u25CB OFF</span>'
  const okxSt = (LIQS as any).okx?.connected ? '<span class="g">\u25CF ON</span>' : '<span class="r">\u25CB OFF</span>'
  L(`  <span class="dg">EXCHANGES    :</span> <span class="c">BINANCE</span> ${binSt}  <span class="p">BYBIT</span> ${bybSt}  <span class="y">OKX</span> ${okxSt}`)
  L(``)

  // Futures stats
  L(`  <span class="dg">OPEN INTEREST :</span> <span class="w">${openInterest.toFixed(2)} BTC</span> <span class="dg">(\u2248$${fmtUSD(oiValue)})</span>`)
  L(`  <span class="dg">FUNDING RATE  :</span> <span class="${fundingRate >= 0 ? 'g' : 'r'}">${(fundingRate * 100).toFixed(4)}%</span> <span class="dg">BTC</span>`)
  L(`  <span class="dg">LONG/SHORT    :</span> <span class="g">${(longRatio * 100).toFixed(1)}%L</span><span class="dg">/</span><span class="r">${(shortRatio * 100).toFixed(1)}%S</span> <span class="dg">BTC</span>`)
  L(``)

  // === OI Change 1h ===
  const bOiClr = oiChange1h > 0.5 ? 'g' : oiChange1h < -0.5 ? 'r' : 'dg'
  const bOiTag = oiChange1h > 1 ? '<span class="g"> BUILDING</span>' : oiChange1h < -1 ? '<span class="r"> CLOSING</span>' : ''
  L(`  <span class="dg">OI CHANGE 1h  :</span> <span class="${bOiClr}">${oiChange1h >= 0 ? '+' : ''}${oiChange1h.toFixed(2)}%</span>${bOiTag} <span class="dg">BTC</span>`)

  // OI + Price interpretation
  const bOiSignal = oiChange1h > 0.3 && chgP > 0 ? '<span class="gb">SMART MONEY LONG</span>' :
    oiChange1h > 0.3 && chgP < 0 ? '<span class="rb">SQUEEZE BUILDING</span>' :
    oiChange1h < -0.3 && chgP > 0 ? '<span class="y">SHORT COVERING</span>' :
    oiChange1h < -0.3 && chgP < 0 ? '<span class="y">LONG CAPITULATION</span>' : '<span class="dg">NEUTRAL</span>'
  L(`  <span class="dg">OI + PRICE    :</span> ${bOiSignal} <span class="dg">BTC (OI${oiChange1h >= 0 ? '\u2191' : '\u2193'} + Price${chgP >= 0 ? '\u2191' : '\u2193'})</span>`)
  L(``)

  // === Funding Rate Trend ===
  const bFrDir = frTrend > 0.0001 ? '<span class="g">\u25B2 RISING</span>' : frTrend < -0.0001 ? '<span class="r">\u25BC FALLING</span>' : '<span class="dg">\u2550 FLAT</span>'
  L(`  <span class="dg">FR TREND      :</span> ${bFrDir} <span class="dg">BTC</span>`)

  {
    const frMin = Math.min(...(frHist.length > 1 ? frHist : [0, 0]))
    const frMax = Math.max(...(frHist.length > 1 ? frHist : [0, 0]))
    const frRng = frMax - frMin || 0.0001
    let spark = '  <span class="dg">FR(8)  BTC:</span> '
    if (frHist.length > 1) frHist.forEach((f: number) => { const norm = (f - frMin) / frRng; const ch = norm > 0.75 ? '\u2588' : norm > 0.5 ? '\u2593' : norm > 0.25 ? '\u2592' : '\u2591'; spark += `<span class="${f >= 0 ? 'g' : 'r'}">${ch}</span>` })
    else spark += '<span class="dg">loading...</span>'
    spark += ` <span class="dg">${(fundingRate * 100).toFixed(4)}%</span>`
    L(spark)
  }
  L(``)

  // === 24h Aggregated Liquidations ===
  L(`  <span class="dg">\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</span>`)
  L(`  <span class="rb">24h LIQUIDATIONS (estimated from OI drops)</span>`)
  L(`  <span class="dg">\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</span>`)
  L(`  <span class="dg">           LONG LIQ           SHORT LIQ          TOTAL</span>`)
  L(`  <span class="w">BTC</span>    <span class="r">$${fmtUSD(liq24hLong).padStart(10)}</span>       <span class="g">$${fmtUSD(liq24hShort).padStart(10)}</span>       <span class="yb">$${fmtUSD(liq24hTotal).padStart(10)}</span>`)

  {
    const lPct = liq24hTotal > 0 ? liq24hLong / liq24hTotal * 100 : 50
    const sPct = liq24hTotal > 0 ? liq24hShort / liq24hTotal * 100 : 50
    L(liq24hTotal > 0 ? `  <span class="dg">BTC 24h:</span> <span class="r">[${bar(lPct, 100, 15)}]</span> <span class="r">${lPct.toFixed(0)}%L</span> <span class="dg">vs</span> <span class="g">[${bar(sPct, 100, 15)}]</span> <span class="g">${sPct.toFixed(0)}%S</span>` : `  <span class="dg">BTC 24h: estimating from OI history...</span>`)
  }

  // Per-exchange liquidation breakdown
  const btcTot = getLiqTotals()
  L(`  <span class="dg">\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</span>`)
  L(`  <span class="rb">REAL LIQUIDATIONS THIS SESSION</span>`)
  L(`  <span class="dg">\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</span>`)
  L(`  <span class="dg">EXCHANGE       BTC COUNT    BTC TOTAL</span>`)
  L(`  <span class="c">BINANCE</span>     <span class="w">${String(LIQS.binance.btc.length).padStart(6)}</span>     <span class="y">$${fmtUSD(LIQS.binance.totalBtc).padStart(9)}</span>`)
  L(`  <span class="p">BYBIT  </span>     <span class="w">${String(LIQS.bybit.btc.length).padStart(6)}</span>     <span class="y">$${fmtUSD(LIQS.bybit.totalBtc).padStart(9)}</span>`)
  L(`  <span class="y">OKX    </span>     <span class="w">${String(LIQS.okx.btc.length).padStart(6)}</span>     <span class="y">$${fmtUSD(LIQS.okx.totalBtc).padStart(9)}</span>`)
  L(`  <span class="dg">\u2500\u2500\u2500\u2500\u2500\u2500\u2500</span>     <span class="dg">\u2500\u2500\u2500\u2500\u2500\u2500</span>     <span class="dg">\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</span>`)
  L(`  <span class="w">TOTAL  </span>     <span class="gb">${String(btcTot.count).padStart(6)}</span>     <span class="yb">$${fmtUSD(btcTot.total).padStart(9)}</span>`)
  L(``)

  // Recent liquidation feed (last 5 from all exchanges)
  L(`  <span class="rb">LIVE LIQUIDATION FEED</span>`)
  {
    const allRecentLiqs = [
      ...LIQS.binance.btc.slice(-5).map((l: any) => ({ ...l, ex: 'BIN', coin: 'BTC' })),
      ...LIQS.bybit.btc.slice(-5).map((l: any) => ({ ...l, ex: 'BYB', coin: 'BTC' })),
      ...LIQS.okx.btc.slice(-5).map((l: any) => ({ ...l, ex: 'OKX', coin: 'BTC' })),
    ].sort((a, bv) => bv.time - a.time).slice(0, 8)
    for (let i = 0; i < 8; i++) {
      const l = allRecentLiqs[i]
      if (l) {
        const exCls = l.ex === 'BIN' ? 'c' : l.ex === 'BYB' ? 'p' : 'y'
        const sideCls = l.side === 'SELL' ? 'r' : 'g'
        const sideLabel = l.side === 'SELL' ? 'LONG ' : 'SHORT'
        const t = new Date(l.time)
        const ts2 = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`
        L(`  <span class="dg">${ts2}</span> <span class="${exCls}">${l.ex}</span> <span class="${sideCls}">${sideLabel}</span> ${l.coin} <span class="w">$${fmtUSD(l.vol).padStart(7)}</span> <span class="dg">@ $${l.p.toFixed(2)}</span>`)
      } else L(`  <span class="d">\u00B7</span>`)
    }
  }
  L(``)

  // BTC Liquidation chart
  L(`<span class="dg">\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</span>`)
  L(`<span class="w"> BTCUSDT LIQUIDATION MAP</span> <span class="dg">(-25% to +25% from $${price.toFixed(0)} | 0.25%/0.5%/1% grid)</span>`)
  L(`<span class="dg">\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</span>`)
  liqChart().forEach(l => L(l))
  L(``)

  L(``)

  // ================================================================
  // === MTF DETAIL PANEL ===
  // ================================================================
  L(``)
  L(`<span class="g">\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550</span>`)
  L(`<span class="gb"> MTF ANALYSIS</span>  <span class="dg">\u2014 Squeeze \u00B7 Trap \u00B7 Magnet \u00B7 Regime \u00B7 Position Filter</span>`)
  L(`<span class="g">\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550</span>`)
  L(``)

  const sqzStr = bbSqueeze ? `<span class="yb">\u26A1 ACTIV</span> <span class="dg">str:${bbSqueezeStr.toFixed(0)}%</span>` : `<span class="dg">\u2500</span>`
  const regCls2: Record<string, string> = { TRENDING: 'gb', VOLATILE: 'rb', RANGING: 'y', TRANSITION: 'dg', SQUEEZE: 'yb' }
  const strucLabel = (() => { const al = mtfAlignDetailed; const v = Object.values(al) as number[]; const u = v.filter((x: number) => x === 1).length; return u === 3 ? 'ALIGNED BULL' : u === 0 ? 'ALIGNED BEAR' : u === 2 ? 'MOSTLY BULL' : u === 1 ? 'MOSTLY BEAR' : 'MIXED' })()

  L(`  <span class="dg">REGIME     </span>  <span class="${regCls2[reRegime] || 'dg'}">${reRegime}</span>`)
  L(`  <span class="dg">STRUCTURE  </span>  <span class="w">${strucLabel}</span>`)
  L(`  <span class="dg">ATR%       </span>  <span class="${(atr / price * 100) > 0.1 ? 'y' : 'g'}">${price > 0 ? (atr / price * 100).toFixed(3) + '%' : '\u2500'}</span>`)
  L(`  <span class="dg">SQUEEZE    </span>  ${sqzStr}`)
  L(`  <span class="dg">ADX        </span>  <span class="${adx > 35 ? 'gb' : adx > 20 ? 'y' : 'dg'}">${adx.toFixed(0)}</span>   <span class="dg">VOL REGIME:</span> <span class="${volPercentile > 90 ? 'rb' : volPercentile > 75 ? 'y' : 'g'}">${volPercentile > 90 ? 'EXTREME' : volPercentile > 75 ? 'HIGH' : volPercentile > 50 ? 'ELEVATED' : 'NORMAL'}</span>`)
  L(`  <span class="dg">VOL %ILE   </span>  <span class="${volPercentile > 80 ? 'rb' : volPercentile > 60 ? 'y' : 'g'}">${volPercentile.toFixed(0)}th percentile</span>`)
  L(``)
  L(`  <span class="dg">TRAP RATE  </span>  <span class="${trapRatePct > 70 ? 'gb' : trapRatePct > 40 ? 'y' : 'r'}">${trapRateStr}</span>`)
  const upPctStr = magnetUpPct > 0 ? `<span class="g">+${magnetUpPct.toFixed(2)}%</span>` : `<span class="dg">\u2500</span>`
  const dnPctStr = magnetDnPct < 0 ? `<span class="r">${magnetDnPct.toFixed(2)}%</span>` : `<span class="dg">\u2500</span>`
  const magBiasCls = magBias === 'ABOVE' ? 'g' : 'r'
  L(`  <span class="dg">MAGNET \u2191   </span>  ${upPctStr}`)
  L(`  <span class="dg">MAGNET \u2193   </span>  ${dnPctStr}`)
  L(`  <span class="dg">MAG BIAS   </span>  <span class="${magBiasCls}">${magBias === 'ABOVE' ? '\u2191 ABOVE' : '\u2193 BELOW'}</span>`)
  L(``)

  // MTF Align badges
  const tBadge = (lbl: string, v: number) => v === 1 ? `<span class="gb">[${lbl} \u25B2]</span>` : v === -1 ? `<span class="rb">[${lbl} \u25BC]</span>` : `<span class="dg">[${lbl} \u2500]</span>`
  const md = mtfAlignDetailed
  L(`  <span class="dg">MTF ALIGN  </span>  ${tBadge('15m', md['15m'] || 0)} ${tBadge('1h', md['1h'] || 0)} ${tBadge('4h', md['4h'] || 0)}`)
  L(`  <span class="dg">ALIGN SCORE</span>  <span class="w">${mtfAlignScore.toFixed(0)} / 100</span>`)
  L(`  [<span class="${mtfAlignScore > 70 ? 'g' : mtfAlignScore > 40 ? 'y' : 'r'}">${bar(mtfAlignScore, 100, 40)}</span>]`)
  L(``)
  L(`  <span class="dg">\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 RE ENGINE \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</span>`)
  L(`  <span class="dg">RE REGIME  </span>  <span class="${regCls2[reRegime] || 'dg'}">${reRegime}</span>`)
  L(`  <span class="dg">RE TRAP    </span>  <span class="${reTrap > 70 ? 'gb' : 'y'}">${reTrap}%</span>`)
  L(`  <span class="dg">RE CONF    </span>  <span class="${reConf > 65 ? 'gb' : reConf > 40 ? 'y' : 'r'}">${reConf.toFixed(0)}%</span>`)
  L(``)
  L(`  <span class="dg">\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 POSITION FILTER \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</span>`)
  const pfCls = pfPhase === 'SQUEEZE' || pfPhase === 'VOLATILE' ? 'rb' : pfPhase === 'TRENDING' ? 'gb' : 'y'
  L(`  <span class="dg">PF PHASE   </span>  <span class="${pfCls}">${pfPhase || '\u2500'}</span> ${pfPhase === 'SQUEEZE' || pfPhase === 'VOLATILE' ? '<span class="rb">\u2717</span>' : '<span class="g">\u2713</span>'}`)
  L(`  <span class="dg">PF RISK    </span>  <span class="${pfRisk === 'REDUCED' ? 'y' : 'g'}">${pfRisk}</span>`)
  L(`  <span class="dg">PF SIZE    </span>  <span class="${pfSize < 1 ? 'rb' : 'gb'}">\u00D7${pfSize.toFixed(1)}</span>`)
  L(``)

  // ================================================================
  // === FLOW ENGINE PANEL ===
  // ================================================================
  L(`<span class="c">\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550</span>`)
  L(`<span class="c"> FLOW ENGINE</span>  <span class="dg">\u2014 VAC \u00B7 ICE \u00B7 FLIP \u00B7 MMTRAP \u00B7 EXHAUST \u00B7 VOID \u00B7 WALL \u00B7 SMF</span>`)
  L(`<span class="c">\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550</span>`)
  L(``)

  // Status bar
  const flowStateCls = flowState === 'ACTIVE' ? 'gb' : flowState === 'WATCH' ? 'yb' : 'dg'
  const tpsStr = `<span class="y">${flowTickRate.toFixed(1)} t/s</span>`
  const smpStr = `<span class="g">smp ${flowSampleCount}</span>`
  const flowTag = `<span class="${flowStateCls}">FLOW ${flowState}</span>`
  const wsTag = wsOK ? `<span class="g">LIVE</span>` : `<span class="rb">DEAD</span>`
  L(`  ${wsTag}  ${tpsStr}  ${smpStr}  <span class="dg">idle</span>  ${flowTag}`)
  L(``)

  const dot = (active: boolean) => active ? '<span class="g">\u25CF</span>' : '<span class="dg">\u25CB</span>'
  const ago = (ts2: number) => { if (!ts2) return ''; const s = Math.floor((Date.now() - ts2) / 1000); return s < 60 ? `<span class="dg">${s}s ago</span>` : `<span class="dg">${Math.floor(s / 60)}m ago</span>` }

  // REG
  const regFCls: Record<string, string> = { TRENDING: 'gb', VOLATILE: 'rb', RANGING: 'y', TRANSITION: 'dg', SQUEEZE: 'yb' }
  L(`  <span class="dg">REG    </span>  ${dot(regime !== 'RANGING')} <span class="${regFCls[regime] || 'y'}">${regime}</span>  <span class="dg">eng ${tapeSpeed}</span>`)

  // VAC
  const vacCls = vacDir === 'UP' ? 'g' : vacDir === 'DOWN' ? 'r' : 'dg'
  const vacDetails = vacDir ? `<span class="${vacCls}">${vacDir}</span>  <span class="dg">${vacPct >= 0 ? '+' : ''}${vacPct.toFixed(3)}%</span>  <span class="dg">${flowTickRate.toFixed(1)} t/s</span>  ${ago(vacTs)}` : `<span class="dg">\u2500</span>`
  L(`  <span class="dg">VAC    </span>  ${dot(!!vacDir && vacDir !== 'FLAT')} ${vacDetails}`)

  // ICE
  const iceDetails = iceActive ? `<span class="c">top ${iceTop.toFixed(0)}</span>  <span class="dg">t2 ${iceT2.toFixed(0)}</span>  ${ago(iceTs)}` : `<span class="dg">top ${iceTop.toFixed(0)}  t2 ${iceT2.toFixed(0)}</span>  ${ago(iceTs)}`
  L(`  <span class="dg">ICE    </span>  ${dot(iceActive)} ${iceDetails}`)

  // FLIP
  const flipDetails = flipActive ? `<span class="y">prv ${flipPrv >= 0 ? '+' : ''}${flipPrv.toFixed(2)}%</span>  <span class="y">cur ${flipCur >= 0 ? '+' : ''}${flipCur.toFixed(2)}%</span>  <span class="dg">z ${flipZ.toFixed(2)}</span>  ${ago(flipTs)}` : `<span class="dg">prv ${flipPrv.toFixed(2)}%  cur ${flipCur.toFixed(2)}%  z ${flipZ.toFixed(2)}</span>`
  L(`  <span class="dg">FLIP   </span>  ${dot(flipActive)} ${flipDetails}`)

  // ABS (absorption)
  if (absorption?.detected) {
    const abSide = absorption.side === 'BID' ? 'BUY' : 'SELL'
    const abCls2 = absorption.side === 'BID' ? 'g' : 'r'
    L(`  <span class="dg">ABS    </span>  <span class="${abCls2}">\u25CF</span> <span class="dg">EXH</span>  <span class="${abCls2}">${abSide}</span>  <span class="dg">str:${absorption.strength.toFixed(0)}%</span>`)
  } else {
    L(`  <span class="dg">ABS    </span>  ${dot(false)} <span class="dg">IDLE</span>`)
  }

  // MMTRAP
  const mmCls = mmState === 'SHORT' ? 'r' : mmState === 'LONG' ? 'g' : 'dg'
  L(`  <span class="dg">MMTRAP </span>  ${dot(mmState !== 'IDLE')} <span class="${mmCls}">${mmState}</span>  <span class="dg">${mmPct >= 0 ? '+' : ''}${mmPct.toFixed(2)}%</span>`)
  L(`  <span class="dg">ABSORB </span>  ${dot(absorption?.detected)} <span class="dg">${absorption?.detected ? `${absorption.side} absorbing` : 'IDLE'}</span>`)
  L(`  <span class="dg">EXHAUST</span>  ${dot(exhaustActive)} ${exhaustActive ? `<span class="y">IDLE ${exhaustSide}</span>  ${ago(exhaustTs)}` : '<span class="dg">IDLE</span>'}`)
  L(`  <span class="dg">SWEEP  </span>  <span class="dg">IDLE</span>`)
  L(`  <span class="dg">CASCADE</span>  ${dot(cascadeRisk > 40)} ${cascadeRisk > 40 ? `<span class="rb">RISK ${cascadeRisk.toFixed(0)}%</span>` : '<span class="dg">IDLE</span>'}`)

  // MAGNET
  const magStr = magBias === 'ABOVE' ? `<span class="g">\u2191 ${magnetUpPct.toFixed(2)}%</span>` : `<span class="r">\u2193 ${Math.abs(magnetDnPct).toFixed(2)}%</span>`
  L(`  <span class="dg">MAGNET </span>  ${dot(Math.abs(magnetUpPct) < 2 || Math.abs(magnetDnPct) < 2)} ${magStr}`)
  L(`  <span class="dg">VOID   </span>  ${dot(voidActive)} ${voidActive ? `<span class="y">THIN MARKET</span>  ${ago(voidTs)}` : '<span class="dg">IDLE</span>'}`)

  // WALL
  const wall = bidWalls?.length ? bidWalls[0] : null
  const wallStr = wall ? `<span class="g">WALL BID ${wall.p.toFixed(1)}</span>  <span class="dg">str ${wall.q.toFixed(2)}</span>  <span class="dg">d ${(Math.abs(wall.p - price) / price * 100).toFixed(2)}%</span>` : '<span class="dg">\u2500</span>'
  L(`  <span class="dg">WALL   </span>  ${dot(!!wall)} ${wallStr}  <span class="dg">0s ago</span>`)

  // STOP + SMF
  const stopCls = stopState !== 'IDLE' ? 'rb' : 'dg'
  L(`  <span class="dg">STOP   </span>  ${dot(stopState !== 'IDLE')} <span class="${stopCls}">${stopState}</span>  ${ago(stopTs)}`)
  const smfCls = smfState === 'BULL' ? 'gb' : smfState === 'BEAR' ? 'rb' : 'dg'
  L(`  <span class="dg">SMF    </span>  ${dot(smfState !== 'NEUT')} <span class="${smfCls}">${smfState}</span>  <span class="dg">score:${smfScore >= 0 ? '+' : ''}${smfScore}</span>  <span class="dg">0s ago</span>`)
  L(``)

  // ================================================================
  // === ARIA -- PATTERN RECOGNITION PANEL ===
  // ================================================================
  L(`<span class="p">\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550</span>`)
  L(`<span class="p"> ARIA INTELLIGENCE</span>  <span class="dg">\u2014 Pattern Recognition \u00B7 MTF Stack \u00B7 Watch Signal</span>`)
  L(`<span class="p">\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550</span>`)
  L(``)

  const ap = ariaCurrentPat
  // ASCII pattern visual
  const patternArt = (shape: string): string => {
    if (shape === 'sweep_high') return `  <span class="dg">\u2500\u2500 \u2500\u2500 \u2500\u2500\u2500\u2500\u2500\u2500</span><span class="rb">\u25CF</span><span class="dg">\u2500\u2500</span>\n           <span class="rb">\u2570\u2500 (sweep)</span>`
    if (shape === 'sweep_low') return `           <span class="g">\u256D\u2500 (sweep)</span>\n  <span class="dg">\u2500\u2500 \u2500\u2500 \u2500\u2500\u2500\u2500\u2500\u2500</span><span class="g">\u25CF</span><span class="dg">\u2500\u2500</span>`
    if (shape === 'upthrust') return `  <span class="dg">\u2500\u2500\u2500\u2500</span><span class="rb">\u2191</span><span class="dg">\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</span>\n  <span class="dg">\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</span>`
    if (shape === 'spring') return `  <span class="dg">\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</span>\n  <span class="dg">\u2500\u2500\u2500\u2500</span><span class="g">\u2193</span><span class="dg">\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</span>`
    if (shape === 'absorb') return `  <span class="dg">\u2500\u2500</span><span class="c">\u2593\u2593\u2593\u2593</span><span class="dg">\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</span>\n  <span class="dg">\u2500\u2500 accumulation \u2500\u2500</span>`
    if (shape === 'squeeze') return `  <span class="y">\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</span>\n  <span class="y">\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</span>`
    return `  <span class="dg">\u2500\u2500 \u2500\u2500 \u2500\u2500 \u2500\u2500 \u2500\u2500 \u2500\u2500 \u2500\u2500</span>\n  <span class="dg">\u2500\u2500 \u2500\u2500 \u2500\u2500 \u2500\u2500 \u2500\u2500 \u2500\u2500 \u2500\u2500</span>`
  }

  if (ap) {
    const pSide = ap.side === 'BULL' ? '<span class="g">BULL</span>' : ap.side === 'BEAR' ? '<span class="r">BEAR</span>' : '<span class="y">NEUT</span>'
    patternArt(ap.shape).split('\n').forEach((l: string) => L(l))
    L(``)
    L(`  <span class="w">${ap.name}</span>  ${pSide}`)
    L(`  <span class="dg">TF</span> <span class="y">${ap.tf}</span>  <span class="dg">CONF</span> <span class="${ap.conf > 60 ? 'g' : ap.conf > 40 ? 'y' : 'r'}">${ap.conf}%</span>`)
  } else {
    L(`  <span class="dg">\u2500\u2500 \u2500\u2500 \u2500\u2500 \u2500\u2500 \u2500\u2500 \u2500\u2500 \u2500\u2500 \u2500\u2500</span>`)
    L(`  <span class="dg">\u2500\u2500 \u2500\u2500 \u2500\u2500 \u2500\u2500 \u2500\u2500 \u2500\u2500 \u2500\u2500 \u2500\u2500</span>`)
    L(``)
    L(`  <span class="dg">No pattern detected</span>`)
    L(`  <span class="dg">TF 15m  CONF \u2500</span>`)
  }
  L(``)

  // 2-column: CANDLE | MTF STACK
  const ctypeFmt = ariaWaiting ? `<span class="dg">none (waiting close)</span>` : `<span class="${ariaCandleType === 'bullish' ? 'g' : ariaCandleType === 'bearish' ? 'r' : 'y'}">${ariaCandleType}</span>`
  const cvolFmt = `<span class="${ariaCandleVol === 'high' ? 'rb' : ariaCandleVol === 'low' ? 'g' : 'dg'}">${ariaCandleVol}</span>`
  const candleLines: string[] = [
    `  <span class="dg">CANDLE</span>`,
    `  <span class="dg">Type:</span> ${ctypeFmt}`,
    `  <span class="dg">Vol:</span>  ${cvolFmt}`,
    ``,
    `  <span class="p">MTF STACK</span>`
  ]
  const mtfEnt = Object.entries(ariaMTF)
  mtfEnt.forEach(([tf, v]) => {
    const icon = v === 1 ? `<span class="g">\u2713 bull</span>` : v === -1 ? `<span class="r">\u2717 bear</span>` : `<span class="dg">\u2500 \u2500</span>`
    candleLines.push(`  <span class="dg">${tf.padEnd(3)}</span>              ${icon}`)
  })
  candleLines.forEach(l => L(l))
  L(``)

  // WATCH signal
  const watchCls = ariaWatch === 'BULL' ? 'gb' : ariaWatch === 'BEAR' ? 'rb' : 'y'
  L(`  <span class="w">[</span><span class="${watchCls}"> ${ariaWatch} </span><span class="w">]</span>  <span class="dg">Monitor next bar</span>`)
  L(`  <span class="dg">MTF</span> ${tBadge('15m', md['15m'] || 0)} ${tBadge('1h', md['1h'] || 0)} ${tBadge('4h', md['4h'] || 0)}  <span class="dg">VOL:</span><span class="${volPercentile > 80 ? 'rb' : 'y'}">${volPercentile > 80 ? 'EXTREME' : 'NORMAL'}</span>`)
  L(`  <span class="dg">MTF score: <span class="w">${mtfAlignScore.toFixed(0)}/100</span>  VOL: <span class="${volPercentile > 80 ? 'rb' : 'y'}">${volPercentile > 80 ? 'EXTREME' : 'NORMAL'}</span></span>`)
  L(`  <span class="dg">Trap rate:</span> <span class="${trapRatePct > 70 ? 'gb' : trapRatePct > 40 ? 'y' : 'r'}">${trapRateStr}</span>${trapRatePct === 100 ? ' <span class="rb">\u26A0</span>' : ''}  <span class="dg">Magnet:</span> <span class="${magBiasCls}">${magBias === 'ABOVE' ? '\u25B2 ABOVE' : '\u25BC BELOW'}</span>`)
  L(``)
  L(`  <span class="p">RECENT PATTERNS</span>`)
  {
    const pats = (ariaPatterns).slice().reverse().slice(0, 4)
    for (let i = 0; i < 4; i++) {
      const p = pats[i]
      if (p) {
        const t = new Date(p.time)
        const ts2 = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`
        const sc = p.side === 'BULL' ? 'g' : p.side === 'BEAR' ? 'r' : 'y'
        L(`  <span class="dg">${ts2}</span>  <span class="${sc}">\u25CF</span> <span class="w">${p.name}</span>  <span class="${p.conf > 60 ? 'g' : p.conf > 40 ? 'y' : 'r'}">${p.conf}%</span>  <span class="dg">${p.tf}</span>`)
      } else L(`  <span class="d">\u00B7</span>`)
    }
  }
  L(``)

  // ================================================================
  // === ON-CHAIN INTELLIGENCE PANEL ===
  // ================================================================
  L(`<span class="c">\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550</span>`)
  L(`<span class="c"> ON-CHAIN INTELLIGENCE</span>  <span class="dg">\u2014 Macro \u00B7 Cycle \u00B7 On-Chain Proxy Models</span>`)
  L(`<span class="c">\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550</span>`)
  L(``)

  // --- WALLET SIZE TRACKER ---
  L(`  <span class="w">WALLET SIZE TRACKER</span> <span class="dg">(click to edit)</span>`)
  L(`  <span class="dg">\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</span>`)
  const wAddr = WALLET.address || '<not set>'
  const wBtc = WALLET.btcSize || 0
  const wUsd = WALLET.usdValue > 0 ? WALLET.usdValue : wBtc * price
  const wNote = WALLET.note || '\u2500'
  L(`  <span class="dg">ADDR :</span> <span class="edit-field" data-edit="address">${wAddr.length > 30 ? wAddr.slice(0, 14) + '...' + wAddr.slice(-10) : wAddr}</span>`)
  L(`  <span class="dg">BTC  :</span> <span class="edit-field g" data-edit="btcSize">${wBtc.toFixed(4)} BTC</span>`)
  L(`  <span class="dg">USD  :</span> <span class="edit-field y" data-edit="usdValue">$${fmtUSD(wUsd)}</span>`)
  L(`  <span class="dg">NOTE :</span> <span class="edit-field dg" data-edit="note">${wNote}</span>`)
  {
    const move1 = wBtc > 0 && price > 0 ? wBtc * price * 0.01 : 0
    const move5 = wBtc > 0 && price > 0 ? wBtc * price * 0.05 : 0
    const atrRisk = wBtc > 0 && atr > 0 ? wBtc * atr : 0
    L(wBtc > 0 && price > 0 ? `  <span class="dg">1%\u0394  :</span> <span class="g">$${fmtUSD(move1)}</span>  <span class="dg">5%\u0394:</span> <span class="g">$${fmtUSD(move5)}</span>` : `  <span class="dg">1%\u0394  : \u2500  5%\u0394: \u2500</span>`)
    L(wBtc > 0 && atr > 0 ? `  <span class="dg">ATR$ :</span> <span class="y">$${fmtUSD(atrRisk)}</span> <span class="dg">risk/candle</span>` : `  <span class="dg">ATR$ : \u2500  set BTC size to activate</span>`)
  }
  L(``)

  // --- MARKET CYCLE ---
  L(`  <span class="w">MARKET CYCLE</span> <span class="dg">(halving-based, 4yr)</span>`)
  L(`  <span class="dg">\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</span>`)
  const barW48 = 48
  const cycleFill = Math.round(cyclePct / 100 * barW48)
  let cBar = ''
  for (let i = 0; i < barW48; i++) {
    const seg = i / barW48
    const cls = i < cycleFill ? (seg < 0.15 ? 'c' : seg < 0.35 ? 'g' : seg < 0.55 ? 'gb' : seg < 0.70 ? 'yb' : seg < 0.80 ? 'y' : seg < 0.90 ? 'rb' : 'r') : 'd'
    cBar += `<span class="${cls}">\u2588</span>`
  }
  L(`  [${cBar}]`)
  L(`  <span class="dg">PHASE :</span> <span class="${cyclePhaseClr}">${cyclePhase || '\u2500'}</span>`)
  L(`  <span class="dg">POS   :</span> <span class="w">${cyclePct.toFixed(1)}%</span>  <span class="dg">Elapsed:</span> <span class="g">${cycleDaysElapsed}d</span>  <span class="dg">Remain:</span> <span class="r">${cycleDaysRemain}d</span>`)
  L(`  <span class="dg">       ACC\u2500\u2500MARKUP\u2500\u2500EUPHORIA\u2500\u2500DIST\u2500\u2500CAPIT\u2500\u2500BOTTOM</span>`)
  L(``)

  // --- 200-WEEK MA HEATMAP ---
  L(`  <span class="w">200-WEEK MA HEATMAP</span>`)
  L(`  <span class="dg">\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</span>`)
  if (wma200 > 0) {
    const hmIdx = Math.min(10, Math.max(1, Math.round((wmaRatio - 0.5) / 2.5 * 10)))
    const hmBar = Array.from({ length: 10 }, (_, i) => {
      const cls = 'hm' + (i + 1)
      return `<span class="${cls}">${i < hmIdx ? '\u2588' : '\u2591'}</span>`
    }).join('')
    const hmZone = wmaRatio < 0.8 ? 'DEEP UNDERVALUED' : wmaRatio < 1.0 ? 'UNDERVALUED' : wmaRatio < 1.5 ? 'FAIR VALUE' : wmaRatio < 2.0 ? 'OVERVALUED' : wmaRatio < 2.5 ? 'VERY HOT' : 'EXTREME TOP'
    L(`  [${hmBar}]`)
    L(`  <span class="dg">WMA200:</span> <span class="w">$${fmtUSD(wma200)}</span>  <span class="dg">RATIO:</span> <span class="hm${hmIdx}">${wmaRatio.toFixed(3)}\u00D7</span>`)
    L(`  <span class="dg">ZONE  :</span> <span class="hm${hmIdx}">${hmZone}</span>`)
  } else {
    L(`  <span class="dg">Loading 210 weekly candles...</span>`)
  }
  L(``)

  // --- PUELL MULTIPLE ---
  L(`  <span class="w">PUELL MULTIPLE</span> <span class="dg">(miner revenue ratio)</span>`)
  L(`  <span class="dg">\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</span>`)
  if (puell > 0) {
    const pmClr = puell < 0.5 ? 'gb' : puell < 1.0 ? 'g' : puell < 2.0 ? 'y' : puell < 4.0 ? 'yb' : 'rb'
    const pmTag = puell < 0.5 ? 'BUY ZONE \u2014 miner capit' : puell < 1.0 ? 'ACCUMULATE' : puell < 2.0 ? 'NEUTRAL' : puell < 4.0 ? 'CAUTION' : 'SELL ZONE \u2014 euphoria'
    const pmFill = Math.min(30, Math.round(puell / 6 * 30))
    let pmBar = ''; for (let i = 0; i < 30; i++) pmBar += `<span class="${i < pmFill ? pmClr : 'd'}">${i < pmFill ? '\u2588' : '\u2591'}</span>`
    L(`  [${pmBar}] <span class="${pmClr}">${puell.toFixed(2)}\u00D7</span>`)
    L(`  <span class="dg">SIGNAL:</span> <span class="${pmClr}">${pmTag}</span>`)
    L(puell < 0.5 ? `  <span class="gb">!! MINER CAPITULATION \u2014 historic buy zone</span>` : puell > 4.0 ? `  <span class="rb">!! MINER EUPHORIA \u2014 historic sell zone</span>` : `  <span class="d">\u00B7</span>`)
  } else L(`  <span class="dg">Loading daily data...</span>`)
  L(``)

  // --- STOCK-TO-FLOW ---
  L(`  <span class="w">STOCK-TO-FLOW MODEL</span> <span class="dg">(PlanB | post-halving)</span>`)
  L(`  <span class="dg">\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</span>`)
  if (s2fValue > 0) {
    const sfClr = s2fDeviation < -30 ? 'gb' : s2fDeviation < 0 ? 'g' : s2fDeviation < 30 ? 'y' : s2fDeviation < 60 ? 'yb' : 'rb'
    L(`  <span class="dg">SF     :</span> <span class="w">${s2fValue.toFixed(1)}</span>  <span class="dg">(supply\u00F7annual_flow)</span>`)
    L(`  <span class="dg">MODEL$ :</span> <span class="c">$${fmtUSD(s2fModelPrice)}</span>`)
    L(`  <span class="dg">ACTUAL :</span> <span class="w">$${fmtUSD(price)}</span>`)
    L(`  <span class="dg">DEV    :</span> <span class="${sfClr}">${s2fDeviation >= 0 ? '+' : ''}${s2fDeviation.toFixed(1)}%</span> <span class="dg">${s2fDeviation > 0 ? 'above' : 'below'} model</span>`)
    L(`  <span class="dg">* S2F uses hardcoded supply/flow \u2014 indicative only</span>`)
  } else L(`  <span class="dg">Calculating...</span>`)
  L(``)

  // --- PI CYCLE TOP INDICATOR ---
  L(`  <span class="w">PI CYCLE TOP INDICATOR</span>`)
  L(`  <span class="dg">\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</span>`)
  if (pi111 > 0) {
    const piDist = pi350x2 > 0 ? ((pi111 - pi350x2) / pi350x2 * 100) : 0
    const piClr = piSignal ? 'rb' : Math.abs(piDist) < 5 ? 'yb' : 'dg'
    L(`  <span class="dg">111DMA  :</span> <span class="c">$${fmtUSD(pi111)}</span>`)
    L(`  <span class="dg">350DMA\u00D72:</span> <span class="y">$${fmtUSD(pi350x2)}</span>`)
    L(`  <span class="dg">DIST    :</span> <span class="${piClr}">${piDist >= 0 ? '+' : ''}${piDist.toFixed(2)}%</span>`)
    if (piSignal) {
      L(`  <span class="rb">!! PI CYCLE CROSSOVER \u2014 CYCLE TOP SIGNAL ACTIVE</span>`)
    } else if (Math.abs(piDist) < 5) {
      L(`  <span class="yb">!! Pi lines converging \u2014 watch for top signal</span>`)
    } else {
      L(`  <span class="dg">No crossover \u2014 ${piDist < 0 ? '111DMA below 350\u00D72' : 'still room to run'}</span>`)
    }
  } else L(`  <span class="dg">Loading 360+ daily candles...</span>`)
  L(``)

  // --- RHODL WAVES PROXY ---
  L(`  <span class="w">RHODL WAVES</span> <span class="dg">(HODLer sentiment proxy)</span>`)
  L(`  <span class="dg">\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</span>`)
  const rhClr = rhodlScore < 20 ? 'gb' : rhodlScore < 40 ? 'g' : rhodlScore < 60 ? 'y' : rhodlScore < 80 ? 'yb' : 'rb'
  const rhZone = rhodlScore < 20 ? 'DEEP HODL \u2014 accumulation' : rhodlScore < 40 ? 'LONG-TERM HOLDERS dom.' : rhodlScore < 60 ? 'BALANCED' : rhodlScore < 80 ? 'SHORT-TERM FOMO' : 'DISTRIBUTION \u2014 tops'
  const rhFill = Math.round(rhodlScore / 100 * 30)
  let rhBar = ''
  for (let i = 0; i < 30; i++) {
    const seg = i / 30
    const cls = i < rhFill ? (seg < 0.2 ? 'gb' : seg < 0.4 ? 'g' : seg < 0.6 ? 'y' : seg < 0.8 ? 'yb' : 'rb') : 'd'
    rhBar += `<span class="${cls}">${i < rhFill ? '\u2588' : '\u2591'}</span>`
  }
  L(`  [${rhBar}] <span class="${rhClr}">${rhodlScore.toFixed(0)}</span>`)
  L(`  <span class="dg">ZONE  :</span> <span class="${rhClr}">${rhZone}</span>`)
  L(`  <span class="dg">* RHODL proxy via 7d/30d/90d MA ratios \u2014 not on-chain</span>`)
  L(``)

  // --- MAYER MULTIPLE ---
  L(`  <span class="w">MAYER MULTIPLE</span> <span class="dg">(price \u00F7 200 DMA)</span>`)
  L(`  <span class="dg">\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</span>`)
  if (mayerMultiple > 0) {
    const mmClr = mayerMultiple < 0.8 ? 'gb' : mayerMultiple < 1.0 ? 'g' : mayerMultiple < 1.5 ? 'y' : mayerMultiple < 2.4 ? 'yb' : 'rb'
    const mmTag = mayerMultiple < 0.8 ? 'DEEP VALUE BUY' : mayerMultiple < 1.0 ? 'BELOW 200DMA' : mayerMultiple < 1.5 ? 'FAIR' : mayerMultiple < 2.4 ? 'ELEVATED' : 'EXTREME TOP'
    const mmMin = 0.6, mmMax = 3.5, mmW = 40
    const mmFill2 = Math.round(Math.min(1, (mayerMultiple - mmMin) / (mmMax - mmMin)) * mmW)
    let mmBar = ''
    for (let i = 0; i < mmW; i++) {
      const seg = i / mmW
      const cls = i === mmFill2 ? 'w' : i < mmFill2 ? (seg < 0.25 ? 'gb' : seg < 0.45 ? 'g' : seg < 0.65 ? 'y' : seg < 0.85 ? 'yb' : 'rb') : 'd'
      mmBar += `<span class="${cls}">${i === mmFill2 ? '\u25C6' : i < mmFill2 ? '\u2500' : '\u00B7'}</span>`
    }
    L(`  0.6[${mmBar}]3.5`)
    L(`  <span class="dg">MM    :</span> <span class="${mmClr}">${mayerMultiple.toFixed(3)}\u00D7</span>  <span class="dg">200DMA:$${fmtUSD(mayer200dma)}</span>`)
    L(`  <span class="dg">ZONE  :</span> <span class="${mmClr}">${mmTag}</span>`)
    L(`  <span class="dg">KEY   : <0.8 buy  1.0 200dma  2.4 hist.top</span>`)
  } else L(`  <span class="dg">Loading 200 daily candles...</span>`)
  L(``)

  // --- NUPL ---
  L(`  <span class="w">NET UNREALIZED P&amp;L</span> <span class="dg">(NUPL proxy)</span>`)
  L(`  <span class="dg">\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</span>`)
  if (realizedProxy > 0) {
    const nuplClr = nupl < -25 ? 'rb' : nupl < 0 ? 'r' : nupl < 25 ? 'y' : nupl < 50 ? 'g' : nupl < 75 ? 'gb' : 'yb'
    const nuplTag = nupl < -25 ? 'CAPITULATION' : nupl < 0 ? 'HOPE/FEAR' : nupl < 25 ? 'OPTIMISM' : nupl < 50 ? 'BELIEF' : nupl < 75 ? 'THRILL' : 'EXTREME GREED'
    const nuplFill = Math.round(Math.min(30, Math.max(0, (nupl + 50) / 100 * 30)))
    let nuplBar = ''
    for (let i = 0; i < 30; i++) {
      const cls = i < nuplFill ? nuplClr : 'd'
      nuplBar += `<span class="${cls}">${i < nuplFill ? '\u2588' : '\u2591'}</span>`
    }
    L(`  [${nuplBar}] <span class="${nuplClr}">${nupl >= 0 ? '+' : ''}${nupl.toFixed(1)}%</span>`)
    L(`  <span class="dg">PHASE  :</span> <span class="${nuplClr}">${nuplTag}</span>`)
    L(`  <span class="dg">REAL.$  :</span> <span class="dg">$${fmtUSD(realizedProxy)}</span> <span class="dg">(proxy via MAs)</span>`)
  } else L(`  <span class="dg">Loading data...</span>`)
  L(``)

  // --- LOG REGRESSION CHANNEL ---
  L(`  <span class="w">LOG REGRESSION CHANNEL</span> <span class="dg">(power law)</span>`)
  L(`  <span class="dg">\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</span>`)
  if (logRegLow > 0) {
    const lrClr = logRegPos < 20 ? 'gb' : logRegPos < 40 ? 'g' : logRegPos < 60 ? 'y' : logRegPos < 80 ? 'yb' : 'rb'
    const lrTag = logRegPos < 20 ? 'DEEP SUPPORT' : logRegPos < 40 ? 'LOW-MID CHANNEL' : logRegPos < 60 ? 'MID CHANNEL' : logRegPos < 80 ? 'HIGH-MID' : 'TOP OF CHANNEL'
    const lrFill = Math.round(logRegPos / 100 * 40)
    let lrBar = ''
    for (let i = 0; i < 40; i++) {
      const seg = i / 40
      const cls = i === lrFill ? 'w' : i < lrFill ? (seg < 0.25 ? 'gb' : seg < 0.5 ? 'g' : seg < 0.75 ? 'y' : 'rb') : 'd'
      lrBar += `<span class="${cls}">${i === lrFill ? '\u25C6' : i < lrFill ? '\u2500' : '\u00B7'}</span>`
    }
    L(`  LOW[${lrBar}]HIGH`)
    L(`  <span class="dg">LOW  :</span> <span class="g">$${fmtUSD(logRegLow)}</span>  <span class="dg">MID:</span> <span class="y">$${fmtUSD(logRegMid)}</span>  <span class="dg">HIGH:</span> <span class="rb">$${fmtUSD(logRegHigh)}</span>`)
    L(`  <span class="dg">POS  :</span> <span class="${lrClr}">${logRegPos}%</span> <span class="${lrClr}">${lrTag}</span>`)
  } else L(`  <span class="dg">Calculating log regression...</span>`)
  L(``)

  L(`<span class="c">\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550</span>`)
  L(``)

  // ================================================================
  // === ADVANCED MARKET INTELLIGENCE ===
  // ================================================================
  L(`<span class="p">\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550</span>`)
  L(`<span class="p"> ADVANCED INTELLIGENCE</span>  <span class="dg">\u2014 Basis \u00B7 CVD Div \u00B7 Cross-FR \u00B7 Macro \u00B7 Wyckoff \u00B7 Vol Profile \u00B7 Session</span>`)
  L(`<span class="p">\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550</span>`)
  L(``)

  // --- BASIS RATE ---
  L(`  <span class="w">BASIS RATE</span> <span class="dg">(Futures Mark \u2212 Spot Index)</span>`)
  L(`  <span class="dg">\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</span>`)
  const brClr = basisRate > 0.1 ? 'g' : basisRate < -0.1 ? 'r' : basisRate > 0.05 ? 'gb' : 'y'
  const brTag = basisRate > 0.15 ? 'BULLISH PREMIUM \u2014 longs paying' : basisRate > 0.05 ? 'MILD PREMIUM' : Math.abs(basisRate) < 0.05 ? 'NEUTRAL' : basisRate < -0.15 ? 'BEARISH DISCOUNT \u2014 shorts paying' : 'MILD DISCOUNT'
  const brFill = Math.round(Math.min(30, Math.max(0, (basisRate + 0.3) / 0.6 * 30)))
  let brBar = ''
  for (let i = 0; i < 30; i++) {
    const cls = i === 15 ? 'dg' : i < brFill ? (basisRate > 0 ? 'g' : 'r') : 'd'
    brBar += `<span class="${cls}">${i === 15 ? '\u2502' : i < brFill ? '\u2588' : '\u2591'}</span>`
  }
  L(`  <span class="dg">-0.3%</span>[${brBar}]<span class="dg">+0.3%</span>`)
  L(`  <span class="dg">MARK  :</span> <span class="w">$${markPrice > 0 ? markPrice.toFixed(2) : '\u2500'}</span>  <span class="dg">INDEX:</span> <span class="dg">$${indexPrice > 0 ? indexPrice.toFixed(2) : '\u2500'}</span>`)
  L(`  <span class="dg">BASIS :</span> <span class="${brClr}">${basisRate >= 0 ? '+' : ''}${basisRate.toFixed(4)}%</span>  <span class="${brClr}">${brTag}</span>`)
  L(``)

  // --- CVD DIVERGENCE ---
  L(`  <span class="w">CVD DIVERGENCE</span> <span class="dg">(Order Flow vs Price)</span>`)
  L(`  <span class="dg">\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</span>`)
  const cvdClr = cvdDivergence === 'BULLISH' ? 'gb' : cvdDivergence === 'BEARISH' ? 'rb' : 'dg'
  const cvdDesc = cvdDivergence === 'BULLISH' ? 'Price falling but smart money BUYING \u2014 reversal up likely' : cvdDivergence === 'BEARISH' ? 'Price rising but smart money SELLING \u2014 reversal down likely' : 'Price and order flow in sync \u2014 no divergence'
  L(`  <span class="dg">STATUS:</span> <span class="${cvdClr}">${cvdDivergence}</span>  <span class="dg">${cvdDivDir}</span>`)
  L(`  <span class="dg">       ${cvdDesc}</span>`)
  L(cvdDivergence !== 'NONE' ? `  <span class="${cvdClr}">!! CVD DIVERGENCE \u2014 high conviction ${cvdDivergence === 'BULLISH' ? 'LONG' : 'SHORT'} signal</span>` : `  <span class="d">\u00B7</span>`)
  L(``)

  // --- CROSS-EXCHANGE FUNDING RATES ---
  L(`  <span class="w">CROSS-EXCHANGE FUNDING RATES</span>`)
  L(`  <span class="dg">\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</span>`)
  const frBin = (fundingRate) * 100
  const frByb2 = (frBybit) * 100
  const frOkx2 = (frOkx) * 100
  const frClr2 = (f: number) => f > 0.05 ? 'rb' : f > 0.01 ? 'r' : f < -0.05 ? 'gb' : f < -0.01 ? 'g' : 'dg'
  const frAvg = (frBin + frByb2 + frOkx2) / 3
  const frSpread = Math.max(frBin, frByb2, frOkx2) - Math.min(frBin, frByb2, frOkx2)
  L(`  <span class="dg">       BINANCE         BYBIT           OKX</span>`)
  L(`  <span class="c">FR  :</span> <span class="${frClr2(frBin)}">${frBin >= 0 ? '+' : ''}${frBin.toFixed(4)}%</span>      <span class="${frClr2(frByb2)}">${frByb2 >= 0 ? '+' : ''}${frByb2.toFixed(4)}%</span>      <span class="${frClr2(frOkx2)}">${frOkx2 >= 0 ? '+' : ''}${frOkx2.toFixed(4)}%</span>`)
  L(`  <span class="dg">AVG  :</span> <span class="${frClr2(frAvg)}">${frAvg >= 0 ? '+' : ''}${frAvg.toFixed(4)}%</span>  <span class="dg">SPREAD:</span> <span class="${frSpread > 0.05 ? 'yb' : 'dg'}">${frSpread.toFixed(4)}%</span>${frSpread > 0.05 ? ' <span class="yb">\u2190 ARB</span>' : ''}`)
  L(`  <span class="dg">BIAS :</span> <span class="${frClr2(frAvg)}">${frAvg > 0.03 ? 'LONGS PAYING \u2014 overcrowded long' : frAvg < -0.03 ? 'SHORTS PAYING \u2014 overcrowded short' : 'BALANCED'}</span>`)
  L(``)

  // --- MACRO EVENTS COUNTDOWN ---
  L(`  <span class="w">MACRO EVENTS COUNTDOWN</span>`)
  L(`  <span class="dg">\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</span>`)
  const nowMs = Date.now()
  const upcoming = MACRO_EVENTS
    .filter(e => e.date.getTime() > nowMs)
    .sort((a, b2) => a.date.getTime() - b2.date.getTime())
    .slice(0, 4)
  if (upcoming.length) {
    upcoming.forEach(e => {
      const diff = e.date.getTime() - nowMs
      const days = Math.floor(diff / 86400000)
      const hrs = Math.floor((diff % 86400000) / 3600000)
      const mins = Math.floor((diff % 3600000) / 60000)
      const urgency = days < 1 ? 'rb' : days < 3 ? 'yb' : days < 7 ? 'y' : 'dg'
      const timeStr = days > 0 ? `${days}d ${hrs}h` : hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`
      const evtClr = e.name === 'FOMC' ? 'c' : e.name === 'CPI' ? 'y' : 'g'
      L(`  <span class="${evtClr}">${e.name.padEnd(5)}</span> <span class="dg">${e.date.toISOString().slice(0, 10)}</span>  <span class="${urgency}">T-${timeStr}</span>`)
    })
  } else {
    L(`  <span class="dg">No upcoming events in calendar</span>`)
    L(`  <span class="d">\u00B7</span>`)
    L(`  <span class="d">\u00B7</span>`)
    L(`  <span class="d">\u00B7</span>`)
  }
  L(``)

  // --- BTC DOMINANCE ---
  L(`  <span class="w">BTC DOMINANCE</span> <span class="dg">& STABLECOIN INFLOWS</span>`)
  L(`  <span class="dg">\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</span>`)
  const domDelta = btcDominance - btcDomPrev
  const domClr = btcDominance > 55 ? 'gb' : btcDominance > 50 ? 'g' : btcDominance > 45 ? 'y' : 'r'
  const domTag = btcDominance > 58 ? 'BTC SEASON \u2014 alts weak' : btcDominance > 52 ? 'BTC LEADING' : btcDominance > 46 ? 'MIXED' : 'ALT SEASON incoming'
  const domFill = Math.round(Math.min(40, Math.max(0, btcDominance / 100 * 40)))
  let domBar = ''; for (let i = 0; i < 40; i++) domBar += `<span class="${i < domFill ? domClr : 'd'}">${i < domFill ? '\u2588' : '\u2591'}</span>`
  L(`  [${domBar}]`)
  L(`  <span class="dg">BTC.D :</span> <span class="${domClr}">${btcDominance.toFixed(2)}%</span>  <span class="dg">\u0394:</span> <span class="${domDelta > 0 ? 'g' : 'r'}">${domDelta >= 0 ? '+' : ''}${domDelta.toFixed(2)}%</span>`)
  L(`  <span class="dg">SIGNAL:</span> <span class="${domClr}">${domTag}</span>`)
  L(``)

  // --- STABLECOIN INFLOWS ---
  L(`  <span class="dg">USDT + USDC MARKET CAP</span>`)
  const scChg = stableChange24h
  const scClr = scChg > 0.5 ? 'gb' : scChg > 0 ? 'g' : scChg < -0.5 ? 'rb' : 'r'
  const scTag = scChg > 1 ? 'INFLOWS STRONG \u2014 dry powder building' : scChg > 0 ? 'MILD INFLOWS' : scChg < -1 ? 'OUTFLOWS \u2014 capital deploying' : 'STABLE'
  L(`  <span class="dg">TOTAL :</span> <span class="w">$${fmtUSD(stableMarketCap)}</span>  <span class="dg">24h:</span> <span class="${scClr}">${scChg >= 0 ? '+' : ''}${scChg.toFixed(2)}%</span>`)
  L(`  <span class="dg">SIGNAL:</span> <span class="${scClr}">${scTag}</span>`)
  L(``)

  // --- WYCKOFF PHASE DETECTOR ---
  L(`  <span class="w">WYCKOFF PHASE DETECTOR</span>`)
  L(`  <span class="dg">\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</span>`)
  const wyClr = wyckoffBias === 'BULL' ? 'gb' : wyckoffBias === 'BEAR' ? 'rb' : 'dg'
  const wyPhaseDesc: Record<string, string> = { ACCUM: 'Accumulation \u2014 smart money absorbing', MARKUP: 'Markup \u2014 trend established', DISTRIB: 'Distribution \u2014 smart money selling', MARKDOWN: 'Markdown \u2014 downtrend confirmed', UNKNOWN: 'Observing \u2014 no clear phase' }
  const wyEvtDesc: Record<string, string> = { SPRING: 'Shakeout below support + recovery', UPTHRUST: 'Fake breakout above resistance', LPS: 'Last Point of Support \u2014 higher low', LPSY: 'Last Point of Supply \u2014 lower high', SHAKEOUT: 'Violent whipsaw \u2014 weak hands out', SOS: 'Sign of Strength \u2014 volume breakout', SOW: 'Sign of Weakness \u2014 volume breakdown', '\u2500': 'No Wyckoff event detected' }
  // ASCII Wyckoff mini-diagram based on phase
  const wyArt: Record<string, string> = {
    ACCUM: `  <span class="dg">\u2500\u2500\u2500\u2500\u2500\u2500</span><span class="g">\u2570\u2500\u256E</span><span class="dg">\u2500\u2500</span><span class="g">\u256D\u2500\u256F</span><span class="dg">\u2500\u2500\u2500</span>  <span class="c">[ACCUM]</span>`,
    MARKUP: `  <span class="dg">\u2500\u2500</span><span class="g">\u256D\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</span><span class="dg">\u2500\u2500</span>  <span class="gb">[MARKUP\u2191]</span>`,
    DISTRIB: `  <span class="dg">\u2500\u2500</span><span class="r">\u256E\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256D</span><span class="dg">\u2500\u2500</span>  <span class="rb">[DISTRIB]</span>`,
    MARKDOWN: `  <span class="dg">\u2500\u2500</span><span class="r">\u2570\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</span><span class="dg">\u2500\u2500</span>  <span class="rb">[MARKDOWN\u2193]</span>`,
    UNKNOWN: `  <span class="dg">\u2500\u2500 \u2500\u2500 \u2500\u2500 \u2500\u2500 \u2500\u2500 \u2500\u2500 \u2500\u2500 \u2500\u2500  [OBSERVING]</span>`
  }
  L(wyArt[wyckoffPhase] || wyArt.UNKNOWN)
  L(`  <span class="dg">PHASE :</span> <span class="${wyClr}">${wyckoffPhase}</span>  <span class="dg">BIAS:</span> <span class="${wyClr}">${wyckoffBias}</span>`)
  L(`  <span class="dg">EVENT :</span> <span class="${wyClr}">${wyckoffEvent}</span>  <span class="dg">${wyEvtDesc[wyckoffEvent] || ''}</span>`)
  L(`  <span class="dg">       ${wyPhaseDesc[wyckoffPhase] || ''}</span>`)
  L(``)

  // --- VOLUME PROFILE ---
  L(`  <span class="w">INTRADAY VOLUME PROFILE</span> <span class="dg">(last 60 candles)</span>`)
  L(`  <span class="dg">\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</span>`)
  if (vpNodes.length && vpPOC > 0) {
    const vpW = 20
    const show = [...vpNodes].sort((a: any, bv: any) => bv.price - a.price).slice(0, 10)
    show.forEach((node: any) => {
      const isPOC = Math.abs(node.price - vpPOC) < (h24 - l24) / 40
      const isVAH = Math.abs(node.price - vpVAH) < (h24 - l24) / 40
      const isVAL = Math.abs(node.price - vpVAL) < (h24 - l24) / 40
      const isCur = Math.abs(node.price - price) < (h24 - l24) / 30
      const fill = Math.round(node.norm * vpW)
      let nBar = ''; for (let i = 0; i < vpW; i++) nBar += `<span class="${i < fill ? (isPOC ? 'yb' : isCur ? 'gb' : 'g') : 'd'}">${i < fill ? '\u2588' : '\u2591'}</span>`
      const tag = isPOC ? '<span class="yb"> POC</span>' : isVAH ? '<span class="c"> VAH</span>' : isVAL ? '<span class="c"> VAL</span>' : isCur ? '<span class="gb"> \u25C4</span>' : ''
      L(`  <span class="dg">$${node.price.toFixed(0).padStart(7)}</span> ${nBar}${tag}`)
    })
    L(`  <span class="dg">POC:</span> <span class="yb">$${vpPOC.toFixed(0)}</span>  <span class="dg">VAH:</span> <span class="c">$${vpVAH.toFixed(0)}</span>  <span class="dg">VAL:</span> <span class="c">$${vpVAL.toFixed(0)}</span>`)
  } else {
    L(`  <span class="dg">Building volume profile...</span>`)
  }
  L(``)

  // --- POSITION SIZING CALCULATOR ---
  L(`  <span class="w">POSITION SIZING CALCULATOR</span>`)
  L(`  <span class="dg">\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</span>`)
  const wRisk = WALLET.riskPct || 1
  const wAcct = WALLET.usdValue > 0 ? WALLET.usdValue : (WALLET.btcSize || 0) * price
  if (wAcct > 0 && price > 0 && atr > 0) {
    const riskUSD = wAcct * wRisk / 100
    const stopDist = atr * 1.5 // 1.5x ATR stop
    const stopPct = price > 0 ? stopDist / price * 100 : 0
    const sizeBTC = stopDist > 0 ? riskUSD / stopDist : 0
    const sizeUSD = sizeBTC * price
    const leverage = wAcct > 0 ? sizeUSD / wAcct : 0
    // Kelly approximation from session stats
    const winRate = SESSION.totalTrades > 0 ? SESSION.wins / SESSION.totalTrades : 0.5
    const kellyPct = winRate > 0 ? Math.max(0, Math.min(25, (winRate - 0.5) * 200)) : 0
    L(`  <span class="dg">ACCT  :</span> <span class="w">$${fmtUSD(wAcct)}</span>  <span class="dg">RISK:</span> <span class="edit-field y" data-edit="riskPct">${wRisk}%</span>`)
    L(`  <span class="dg">STOP  :</span> <span class="r">$${stopDist.toFixed(0)}</span> <span class="dg">(1.5\u00D7ATR = ${stopPct.toFixed(2)}%)</span>`)
    L(`  <span class="dg">SIZE  :</span> <span class="g">${sizeBTC.toFixed(4)} BTC</span>  <span class="dg">($${fmtUSD(sizeUSD)})</span>`)
    L(`  <span class="dg">LEV   :</span> <span class="${leverage > 10 ? 'rb' : leverage > 5 ? 'y' : 'g'}">${leverage.toFixed(1)}\u00D7</span>`)
    L(`  <span class="dg">KELLY :</span> <span class="${kellyPct > 15 ? 'gb' : kellyPct > 5 ? 'y' : 'dg'}">${kellyPct.toFixed(1)}%</span> <span class="dg">(${SESSION.totalTrades} trades, ${(winRate * 100).toFixed(0)}% win)</span>`)
  } else {
    L(`  <span class="dg">Set wallet size to activate calculator</span>`)
    L(`  <span class="d">\u00B7</span>`)
    L(`  <span class="d">\u00B7</span>`)
    L(`  <span class="d">\u00B7</span>`)
    L(`  <span class="d">\u00B7</span>`)
  }
  L(``)

  // --- SESSION P&L + SIGNAL ACCURACY ---
  L(`  <span class="w">SESSION P&amp;L</span> <span class="dg">(auto-tracked from AI signals)</span>`)
  L(`  <span class="dg">\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</span>`)
  const sessionDur = Math.floor((Date.now() - SESSION.startTime) / 60000)
  const pnlClr = SESSION.pnl > 0 ? 'gb' : SESSION.pnl < 0 ? 'rb' : 'dg'
  L(`  <span class="dg">PNL   :</span> <span class="${pnlClr}">${SESSION.pnl >= 0 ? '+' : ''}${SESSION.pnl.toFixed(3)}%</span>  <span class="dg">session ${sessionDur}min</span>`)
  L(`  <span class="dg">PEAK  :</span> <span class="g">+${SESSION.peak.toFixed(3)}%</span>  <span class="dg">DD:</span> <span class="r">${SESSION.drawdown.toFixed(3)}%</span>`)
  L(`  <span class="dg">TRADES:</span> <span class="w">${SESSION.totalTrades}</span>  <span class="g">W:${SESSION.wins}</span>  <span class="r">L:${SESSION.losses}</span>  <span class="dg">WR:${SESSION.totalTrades > 0 ? (SESSION.wins / SESSION.totalTrades * 100).toFixed(0) : 0}%</span>`)
  // Last 5 trades
  if (SESSION.entries.length) {
    L(`  <span class="dg">\u2500 RECENT TRADES \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</span>`)
    SESSION.entries.slice(-5).reverse().forEach((e: any) => {
      const eCls = e.pnl > 0 ? 'g' : 'r'
      const t = new Date(e.time)
      const tStr = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
      L(`  <span class="dg">${tStr}</span> <span class="${e.side === 'BUY' ? 'g' : 'r'}">${e.side}</span> <span class="dg">$${e.entry.toFixed(0)}\u2192$${e.exit.toFixed(0)}</span> <span class="${eCls}">${e.pnl >= 0 ? '+' : ''}${e.pnl.toFixed(3)}%</span>`)
    })
  } else {
    L(`  <span class="dg">Waiting for first AI signal...</span>`)
  }
  L(``)

  // --- SIGNAL ACCURACY LOG ---
  L(`  <span class="w">SIGNAL ACCURACY LOG</span> <span class="dg">(30s outcome check)</span>`)
  L(`  <span class="dg">\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</span>`)
  const checked = trapHist.filter((t: any) => t.checked)
  const hitRate = checked.length > 0 ? Math.round(checked.filter((t: any) => t.hit).length / checked.length * 100) : 0
  const hrClr = hitRate > 70 ? 'gb' : hitRate > 50 ? 'g' : hitRate > 35 ? 'y' : 'r'
  if (checked.length) {
    let accBar = ''; const accW = 20; const accFill = Math.round(hitRate / 100 * accW)
    for (let i = 0; i < accW; i++) accBar += `<span class="${i < accFill ? hrClr : 'd'}">${i < accFill ? '\u2588' : '\u2591'}</span>`
    L(`  [${accBar}] <span class="${hrClr}">${hitRate}%</span> <span class="dg">(${checked.filter((t: any) => t.hit).length}/${checked.length} signals)</span>`)
    trapHist.slice(-5).reverse().forEach((t: any) => {
      const tCls = t.hit ? 'g' : t.checked ? 'r' : 'dg'
      const res = t.hit ? '\u2713 HIT' : t.checked ? '\u2717 MISS' : 'PENDING'
      L(`  <span class="dg">\u00B7</span> <span class="${t.act === 'BUY' ? 'g' : 'r'}">${t.act}</span> <span class="dg">$${t.price.toFixed(0)}</span>  <span class="${tCls}">${res}</span>`)
    })
  } else {
    L(`  <span class="dg">Accumulating signal data...</span>`)
    L(`  <span class="d">\u00B7</span>`)
    L(`  <span class="d">\u00B7</span>`)
    L(`  <span class="d">\u00B7</span>`)
    L(`  <span class="d">\u00B7</span>`)
    L(`  <span class="d">\u00B7</span>`)
  }
  L(``)

  L(`<span class="p">\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550</span>`)
  L(``)

  L(`<span class="y">[ RECENT LOGS ]</span>`)

  L(``)
  logs.slice(0, 12).forEach(l => {
    const tc = l.tag === 'AI' ? 'c' : l.tag === 'MM' ? 'p' : l.tag === 'SYS' ? 'y' : 'g'
    let m = l.msg.replace(/BUY/g, '<span class="g">BUY</span>').replace(/SELL/g, '<span class="r">SELL</span>').replace(/CONFIRMED/g, '<span class="gb">CONFIRMED</span>').replace(/Blocked/g, '<span class="r">Blocked</span>')
    L(`<span class="dg">[${l.t}]</span>  <span class="${tc}">[${l.tag.padEnd(5)}]</span>  ${m}`)
  })
  L(``)
  L(`<span class="d">${binLine(70)}</span>`)
  L(`<span class="d">${binLine(70)}</span>`)
  L(`<span class="dg">ZeuS Alpha AI...tick ${ticks.toLocaleString()} | ${ts} | ${wsOK ? '<span class="g">\u25CF LIVE</span>' : '<span class="r">\u25CB CONNECTING</span>'}</span><span class="g cursor"> \u2588</span>`)

  return o.join('\n')
}
