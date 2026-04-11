// Zeus — data/marketDataChart.ts
// Ported 1:1 from public/js/data/marketData.js lines 111-312 (Chunk B)
// Chart init, fetchKlines, renderChart

import { fmtTime, fmtDate, toast } from './marketDataHelpers'
import { el } from '../utils/dom'
import { _indRenderHook, _macdKlineHook, _syncSubChartsToMain } from '../engine/indicators'
import { llvEnsureCanvas, llvLoadSettings } from './marketDataOverlays'

const w = window as any

// ===== CHART INIT =====
export function getChartH(): number { return window.innerWidth >= 1000 ? 400 : 340 }
export function getChartW(): number {
  const page = document.querySelector('.page') as HTMLElement | null
  if (window.innerWidth >= 1000 && page) return Math.max(400, page.offsetWidth - 390 - 2)
  return Math.min(window.innerWidth, 480)
}

export function initCharts(): void {
  const W = getChartW()
  const locFmt = { timeFormatter: (ts: any) => fmtTime(ts), dateFormatter: (ts: any) => fmtDate(ts) }
  const base = (h: number) => ({
    width: W, height: h,
    layout: { background: { color: '#0a0f16' }, textColor: '#7a9ab8' },
    grid: { vertLines: { color: '#1a2530' }, horzLines: { color: '#1a2530' } },
    rightPriceScale: { borderColor: '#1e2530', scaleMargins: { top: .05, bottom: .15 } },
    timeScale: { borderColor: '#1e2530', timeVisible: false, secondsVisible: false, ticksVisible: false, rightOffset: 12 },
    crosshair: { mode: w.LightweightCharts.CrosshairMode.Normal },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
    handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
  })
  w.mainChart = w.LightweightCharts.createChart(el('mc'), base(getChartH()))
  w.cSeries = w.mainChart.addCandlestickSeries({ upColor: '#00d97a', downColor: '#ff3355', borderUpColor: '#00d97a', borderDownColor: '#ff3355', wickUpColor: '#00d97a77', wickDownColor: '#ff335577' })
  // LLV: load persisted settings and ensure canvas is ready
  if (typeof llvLoadSettings === 'function') llvLoadSettings()
  if (typeof llvEnsureCanvas === 'function') llvEnsureCanvas()
  // Reaplică culorile salvate
  if (w.S._savedChartColors) {
    const c = w.S._savedChartColors
    w.cSeries.applyOptions({ upColor: c.bull, downColor: c.bear, borderUpColor: c.bull, borderDownColor: c.bear, wickUpColor: (c.bullW || c.bull) + '77', wickDownColor: (c.bearW || c.bear) + '77' })
    if (w.mainChart) w.mainChart.applyOptions({ layout: { background: { color: c.priceBg || '#0a0f16' }, textColor: c.priceText || '#7a9ab8' }, rightPriceScale: { textColor: c.priceText || '#7a9ab8' } })
  }
  w.ema50S = w.mainChart.addLineSeries({ color: '#f0c040', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
  w.ema200S = w.mainChart.addLineSeries({ color: '#00b8d4', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
  w.wma20S = w.mainChart.addLineSeries({ color: '#aa44ff', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
  w.wma50S = w.mainChart.addLineSeries({ color: '#ff8822', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, lineStyle: 2 })
  w.stS = w.mainChart.addLineSeries({ color: '#ff8800', lineWidth: 2, priceLineVisible: false, lastValueVisible: false })
  // CVD
  if (el('cc')) {
    const co = Object.assign(base(60), { rightPriceScale: { borderColor: '#1e2530', scaleMargins: { top: .1, bottom: .1 } } })
    w.cvdChart = w.LightweightCharts.createChart(el('cc'), co)
    w.cvdS = w.cvdChart.addLineSeries({ color: '#f0c040', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, title: 'CVD' })
  }
  // Volume overlay
  w.volS = w.mainChart.addHistogramSeries({ color: '#00b8d422', priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false })
  w.mainChart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 }, drawTicks: false, borderVisible: false, visible: false })
  if (w.mainChart) w.mainChart.applyOptions({ localization: locFmt })
  if (w.cvdChart) w.cvdChart.applyOptions({ localization: locFmt, timeScale: { visible: false, timeVisible: false, secondsVisible: false, borderVisible: false, rightOffset: 12 }, rightPriceScale: { visible: true, borderColor: '#1e2530', width: 70 } })
  let syncing = false
  w.mainChart.timeScale().subscribeVisibleLogicalRangeChange((r: any) => {
    if (syncing || !r) return; syncing = true
    try { if (w.cvdChart) w.cvdChart.timeScale().setVisibleLogicalRange(r) } catch (_) { }
    try { if (typeof _syncSubChartsToMain === 'function') _syncSubChartsToMain() } catch (_) { }
    syncing = false
  })
}

// ===== FETCH KLINES =====
export async function fetchKlines(tf: any): Promise<void> {
  if (!w.FetchLock.try('klines')) return
  try {
    const sym = w.S.symbol || 'BTCUSDT'
    const _ac = new AbortController()
    const _acTimer = setTimeout(() => _ac.abort(), 10000)
    let r: Response
    try { r = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${tf}&limit=1000`, { signal: _ac.signal }) }
    catch (fetchErr: any) { clearTimeout(_acTimer); if (fetchErr.name === 'AbortError') throw new Error('Timeout fetch klines (>10s)'); throw fetchErr }
    clearTimeout(_acTimer)
    if (!r || !r.ok) throw new Error(`HTTP ${r ? r.status : 'no response'}`)
    const d = await r.json()
    if (!Array.isArray(d) || !d.length) return
    if (w.S.symbol !== sym) { console.warn('[fetchKlines] stale response for ' + sym); return }
    const _rawKlines = d.map((k: any) => ({ time: Math.floor(k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }))
    w.S.klines = _rawKlines.filter((k: any) => {
      if (!k.open || !k.high || !k.low || !k.close) return false
      if (k.high < k.low || k.close < k.low || k.close > k.high) return false
      if (k.open <= 0 || k.close <= 0) return false
      if (typeof w._isPriceSane === 'function' && !w._isPriceSane(k.close)) return false
      return true
    })
    if (!w.S.klines.length) { console.warn('[fetchKlines] all candles failed sanity'); return }
    if (typeof w._resetKlineWatchdog === 'function') w._resetKlineWatchdog()
    renderChart()
    const symLow = sym.toLowerCase()
    const _klineGen = w.__wsGen
    w.S.wsK = w.WS.open('kline', `wss://fstream.binance.com/ws/${symLow}@kline_${tf}`, {
      onmessage: (e: any) => {
        if (w.__wsGen !== _klineGen) return
        let j: any; try { j = JSON.parse(e.data) } catch (_) { return }
        const k = j.k; if (!k) return
        const bar = { time: Math.floor(k.t / 1000), open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v }
        const last = w.S.klines?.[w.S.klines.length - 1]
        if (last && last.time === bar.time) w.S.klines[w.S.klines.length - 1] = bar
        else { w.S.klines.push(bar); if (w.S.klines.length > 1500) w.S.klines = w.S.klines.slice(-1200) }
        if (typeof w._resetKlineWatchdog === 'function') w._resetKlineWatchdog()
        try { w.cSeries.update(bar) } catch (_) { }
        if (typeof w.updOvrs === 'function') w.updOvrs()
        if (!w._tmThrottle) { w._tmThrottle = setTimeout(function () { w._tmThrottle = null; if (typeof w.renderTradeMarkers === 'function') w.renderTradeMarkers() }, 5000) }
      }
    })
  } catch (e: any) {
    console.error('[fetchKlines]', e.message)
    toast(`Chart: nu pot \u00EEnc\u0103rca datele (${e.message})`)
  } finally { w.FetchLock.release('klines') }
}

// ===== RENDER CHART =====
export function renderChart(): void {
  if (!w.cSeries || !w.S.klines.length) return
  try {
    w.S.chartBars = w.S.klines.map((k: any) => ({ time: k.time, open: k.open, high: k.high, low: k.low, close: k.close }))
    w.cSeries.setData(w.S.klines)
    try { w.mainChart.timeScale().scrollToRealTime() } catch (_) { }
    const c = w.S.klines.map((k: any) => k.close)
    function calcEMA(data: number[], p: number) { const k = 2 / (p + 1); let e = data[0]; return data.map((v: number) => { e = v * k + e * (1 - k); return e }) }
    if (w.S.indicators.ema) {
      const _ep1 = (typeof w.IND_SETTINGS !== 'undefined' && w.IND_SETTINGS.ema) ? Math.round(w.IND_SETTINGS.ema.p1) : 50
      const _ep2 = (typeof w.IND_SETTINGS !== 'undefined' && w.IND_SETTINGS.ema) ? Math.round(w.IND_SETTINGS.ema.p2) : 200
      const e50 = calcEMA(c, _ep1).map((v: number, i: number) => ({ time: w.S.klines[i].time, value: v }))
      const e200 = calcEMA(c, _ep2).map((v: number, i: number) => ({ time: w.S.klines[i].time, value: v }))
      if (w.ema50S) w.ema50S.setData(e50); if (w.ema200S) w.ema200S.setData(e200)
    } else { if (w.ema50S) w.ema50S.setData([]); if (w.ema200S) w.ema200S.setData([]) }
    if (w.S.indicators.wma) {
      const _wp1 = (typeof w.IND_SETTINGS !== 'undefined' && w.IND_SETTINGS.wma) ? Math.round(w.IND_SETTINGS.wma.p1) : 20
      const _wp2 = (typeof w.IND_SETTINGS !== 'undefined' && w.IND_SETTINGS.wma) ? Math.round(w.IND_SETTINGS.wma.p2) : 50
      function calcWMA(data: number[], p: number) { return data.map((v: number, i: number) => { if (i < p - 1) return { time: w.S.klines[i].time, value: 0 }; let s = 0, wt = 0; for (let j = 0; j < p; j++) { s += data[i - j] * (p - j); wt += p - j } return { time: w.S.klines[i].time, value: s / wt } }) }
      if (w.wma20S) w.wma20S.setData(calcWMA(c, _wp1)); if (w.wma50S) w.wma50S.setData(calcWMA(c, _wp2))
    } else { if (w.wma20S) w.wma20S.setData([]); if (w.wma50S) w.wma50S.setData([]) }
    if (w.S.indicators.st && w.S.atr) {
      const atr = w.S.atr
      const mult = (typeof w.IND_SETTINGS !== 'undefined' && w.IND_SETTINGS.st) ? w.IND_SETTINGS.st.mult : 3
      const stData: any[] = []; let up = 0, dn = 0, trend = 1
      w.S.klines.forEach((k: any, i: number) => {
        const hl2 = (k.high + k.low) / 2
        const bu = hl2 + mult * atr, bl = hl2 - mult * atr
        if (i === 0) { up = bu; dn = bl }
        else { up = bu < stData[i - 1]?.up || c[i - 1] > stData[i - 1]?.up ? bu : stData[i - 1].up; dn = bl > stData[i - 1]?.dn || c[i - 1] < stData[i - 1]?.dn ? bl : stData[i - 1].dn }
        if (c[i] > up) trend = 1; else if (c[i] < dn) trend = -1
        stData.push({ time: k.time, value: trend === 1 ? dn : up, up, dn, trend })
      })
      if (w.stS) w.stS.setData(stData.map((d: any) => ({ time: d.time, value: d.value })))
    } else { if (w.stS) w.stS.setData([]) }
    let cvd = 0
    const cvdData = w.S.klines.map((k: any) => { cvd += k.close > k.open ? k.volume : -k.volume; return { time: k.time, value: cvd } })
    if (w.cvdS) w.cvdS.setData(cvdData)
    const volData = w.S.klines.map((k: any) => ({ time: k.time, value: k.volume, color: k.close >= k.open ? '#00d97a44' : '#ff335544' }))
    if (w.volS) w.volS.setData(volData)
    if (typeof _macdKlineHook === 'function') _macdKlineHook()
    if (typeof _indRenderHook === 'function') _indRenderHook()
    if (typeof w.updOvrs === 'function') w.updOvrs()
    if (w.S.vwapOn && typeof w.renderVWAP === 'function') w.renderVWAP()
    if (w.S.oviOn) { clearTimeout(w.S._oviRefreshT); w.S._oviRefreshT = setTimeout(() => { if (typeof w.renderOviLiquid === 'function') w.renderOviLiquid() }, 15000) }
    if (typeof w.renderTradeMarkers === 'function') w.renderTradeMarkers()
  } catch (e) { console.error('renderChart', e) }
}
