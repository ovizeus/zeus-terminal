// Quantitative Monitor — Main lifecycle: init() / destroy()
// Manages intervals, WS connections, render loop
import { QM, qmLog, addLiq } from './state'
import { runIntel } from './engines/intel'
import { calcFLOW } from './engines/flow'
import { calcARIA } from './engines/aria'
import { calcWyckoff, calcCVDDivergence, calcVolumeProfile } from './engines/wyckoff'
import { buildLiqEstimate, fetchTopTraderPositionRatio } from './engines/liqMap'
import { fetchBasisRate } from '../data/basisRate'
import { fetchCrossExchangeFR } from '../data/crossExchangeFR'
import { fetchBTCDominance, fetchStablecoins } from '../data/btcDominance'
import { fetchWeeklyKlines, fetchDailyKlines, calcS2F, calcLogRegression, calcMarketCycle } from '../data/onChainMetrics'
import { connectOKXLiq, disconnectOKXLiq } from '../data/okxLiqWS'
import { renderFrame } from './render/frame'
import { initParticles, destroyParticles } from './particles/canvas'

const w = window as any
const intervals: ReturnType<typeof setInterval>[] = []
let renderRaf = 0
let renderIv: ReturnType<typeof setInterval> | null = null
let _destroyed = false

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

  // Maintain delta history
  const obBV = w.S.obBV || 0, obAV = w.S.obAV || 0
  w.S._qmDeltaHist = w.S._qmDeltaHist || []
  w.S._qmDeltaHist.push(obBV - obAV)
  if (w.S._qmDeltaHist.length > 40) w.S._qmDeltaHist.shift()

  // Run engines
  runIntel()
  calcFLOW()
  calcARIA()
  calcWyckoff()
  calcCVDDivergence()
  calcVolumeProfile()
  buildLiqEstimate()
}

function startRenderLoop(screenId: string): void {
  renderIv = setInterval(() => {
    if (_destroyed) return
    const el = document.getElementById(screenId)
    if (!el) return
    runAllEngines()
    el.innerHTML = renderFrame()
  }, 500)
  intervals.push(renderIv)
}

export async function init(screenId: string, canvasId: string): Promise<void> {
  _destroyed = false
  qmLog('SYS', 'ZeuS Quantitative Monitor V2.0.0')
  qmLog('SYS', 'Initializing engines...')

  // Verify Zeus data is available
  if (!w.S || !w.S.price) {
    qmLog('SYS', 'Waiting for Zeus data feed...')
  }

  // Connect OKX liquidation WS
  connectOKXLiq()

  // Subscribe to existing Zeus liquidation events
  const liqHandler = (e: CustomEvent) => {
    if (_destroyed) return
    addLiq(e.detail.exchange || 'binance', e.detail)
  }
  window.addEventListener('zeus:liq', liqHandler as EventListener)
  window.addEventListener('zeus:okxLiq', ((e: CustomEvent) => {
    if (_destroyed) return
    addLiq('okx', e.detail)
  }) as EventListener)

  // Fetch new data sources
  await Promise.all([
    fetchBasisRate(),
    fetchCrossExchangeFR(),
    fetchBTCDominance(),
    fetchStablecoins(),
    fetchTopTraderPositionRatio(),
    fetchWeeklyKlines(),
    fetchDailyKlines(),
  ]).catch(() => { /* silent */ })

  calcS2F()
  calcLogRegression()
  calcMarketCycle()

  qmLog('SYS', 'All engines ready — rendering')

  // Start periodic fetches
  intervals.push(setInterval(fetchBasisRate, 5000))
  intervals.push(setInterval(fetchCrossExchangeFR, 30000))
  intervals.push(setInterval(fetchBTCDominance, 300000))
  intervals.push(setInterval(fetchStablecoins, 600000))
  intervals.push(setInterval(fetchTopTraderPositionRatio, 10000))
  intervals.push(setInterval(() => { fetchWeeklyKlines() }, 3600000))
  intervals.push(setInterval(() => { fetchDailyKlines() }, 900000))
  intervals.push(setInterval(() => { calcS2F(); calcLogRegression(); calcMarketCycle() }, 60000))

  // Start render loop
  startRenderLoop(screenId)

  // Start particles
  initParticles(canvasId)
}

export function destroy(): void {
  _destroyed = true
  intervals.forEach(iv => clearInterval(iv))
  intervals.length = 0
  if (renderIv) { clearInterval(renderIv); renderIv = null }
  if (renderRaf) { cancelAnimationFrame(renderRaf); renderRaf = 0 }
  disconnectOKXLiq()
  destroyParticles()
  // Clean QM state from w.S
  if (w.S) {
    Object.keys(w.S).filter((k: string) => k.startsWith('_qm')).forEach((k: string) => delete w.S[k])
  }
  QM.logs.length = 0
  QM.session.entries.length = 0
}
