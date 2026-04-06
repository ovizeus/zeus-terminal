// Zeus — data/marketDataOverlays.ts
// Ported 1:1 from public/js/data/marketData.js lines 314-798 (Chunk C)
// Overlays, Trade Markers, LLV Canvas, Heatmap, S/R

const w = window as any

// ===== OVERLAYS =====
export function updOvrs(): void {
  if (w.S.overlays.liq) renderHeatmapOverlay()
  if (w.S.overlays.sr) renderSROverlay()
  if (w.S.oviOn && typeof w.renderOviLiquid === 'function') w.renderOviLiquid()
}

export function togOvr(o: any, btn: any): void {
  w.S.overlays[o] = !w.S.overlays[o]
  if (btn) btn.classList.toggle('act', w.S.overlays[o])
  if (o === 'liq') { clearHeatmap(); if (w.S.overlays.liq) renderHeatmapOverlay() }
  if (o === 'sr') { clearSR(); if (w.S.overlays.sr) renderSROverlay() }
  if (o === 'zs') { if (typeof w.clearZS === 'function') w.clearZS(); if (w.S.overlays.zs && typeof w.renderZS === 'function') w.renderZS() }
  if (o === 'llv') { clearLiqLevels(); if (w.S.overlays.llv) renderLiqLevels() }
}

export function clearHeatmap(): void { w.liqSeries.forEach((s: any) => { try { w.mainChart.removeSeries(s) } catch (_) { } }); w.liqSeries = [] }
export function clearSR(): void { w.srSeries.forEach((s: any) => { try { w.mainChart.removeSeries(s) } catch (_) { } }); w.srSeries = [] }

// ═══════════════════════════════════════════════════════
// ===== TRADE MARKERS (chart overlay) =====
// ═══════════════════════════════════════════════════════
let _tradePriceLines: any[] = []

function _tsToBarTime(tsMs: any): number {
  if (!tsMs || !w.S.klines.length) return 0
  const tsSec = Math.floor(tsMs / 1000)
  let lo = 0, hi = w.S.klines.length - 1, best = w.S.klines[0].time
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    if (w.S.klines[mid].time <= tsSec) { best = w.S.klines[mid].time; lo = mid + 1 }
    else hi = mid - 1
  }
  return best
}

function _classifyExitReason(reason: any): string {
  if (!reason) return 'CLOSE'
  const r = reason.toUpperCase()
  if (r.includes('SL') || r.includes('STOP LOSS') || r.includes('SL HIT')) return 'SL'
  if (r.includes('TP') && !r.includes('TTP') || r.includes('TAKE PROFIT') || r.includes('TP HIT')) return 'TP'
  if (r.includes('DSL')) return 'DSL'
  if (r.includes('TTP')) return 'TTP'
  if (r.includes('EMERGENCY')) return 'EMERGENCY'
  if (r.includes('EXPIR') || r.includes('LIQ') || r.includes('LIQUIDATED')) return 'EXPIRY'
  if (r.includes('MANUAL') || r.includes('CLOSE ALL')) return 'MANUAL_CLOSE'
  if (r.includes('PARTIAL') || r.includes('\u25D1')) return 'PARTIAL'
  return 'CLOSE'
}

function _exitMarkerMeta(exitType: string): { color: string, text: string } {
  switch (exitType) {
    case 'SL': return { color: '#ff3355', text: 'SL' }
    case 'TP': return { color: '#00d97a', text: 'TP' }
    case 'DSL': return { color: '#aa44ff', text: 'DSL' }
    case 'TTP': return { color: '#f0c040', text: 'TTP' }
    case 'MANUAL_CLOSE': return { color: '#f0c040', text: 'CLOSE' }
    case 'EMERGENCY': return { color: '#ff8800', text: 'EMRG' }
    case 'EXPIRY': return { color: '#888888', text: 'EXP' }
    case 'PARTIAL': return { color: '#00b8d4', text: 'PART' }
    default: return { color: '#888888', text: 'EXIT' }
  }
}

export function renderTradeMarkers(): void {
  if (!w.cSeries || !w.S.klines || !w.S.klines.length) return
  try {
    _tradePriceLines.forEach(function (pl: any) { try { w.cSeries.removePriceLine(pl) } catch (_) { } })
    _tradePriceLines = []

    const curMode = (typeof w.AT !== 'undefined' && w.AT._serverMode) ? w.AT._serverMode : 'demo'
    const markers: any[] = []
    const curSym = (w.S.symbol || 'BTCUSDT').toUpperCase()

    const openPos = curMode === 'live' ? (w.TP.livePositions || []) : (w.TP.demoPositions || [])
    openPos.forEach(function (pos: any) {
      if (pos.closed || pos.status === 'closing') return
      const posSym = (pos.sym || pos.symbol || '').toUpperCase()
      if (posSym !== curSym) return

      const entryBarTime = _tsToBarTime(pos.openTs || pos.id)
      if (!entryBarTime) return

      const isAuto = !!pos.autoTrade
      const isLong = pos.side === 'LONG'
      const label = (isAuto ? 'AT ' : 'MAN ') + pos.side
      const entryColor = isAuto ? (isLong ? '#00d97a' : '#ff3355') : (isLong ? '#00b8d4' : '#ff8822')

      markers.push({ time: entryBarTime, position: isLong ? 'belowBar' : 'aboveBar', color: entryColor, shape: isLong ? 'arrowUp' : 'arrowDown', text: label })

      let effectiveSL = pos.sl
      if (typeof w.DSL !== 'undefined' && w.DSL.positions && w.DSL.positions[String(pos.id)]) {
        const dsl = w.DSL.positions[String(pos.id)]
        if (dsl.active && dsl.currentSL > 0) effectiveSL = dsl.currentSL
      }
      if (effectiveSL && Number.isFinite(effectiveSL)) {
        _tradePriceLines.push(w.cSeries.createPriceLine({ price: effectiveSL, color: '#ff335599', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'SL ' + (isAuto ? 'AT' : 'MAN') }))
      }
      if (pos.tp && Number.isFinite(pos.tp)) {
        _tradePriceLines.push(w.cSeries.createPriceLine({ price: pos.tp, color: '#00d97a99', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'TP ' + (isAuto ? 'AT' : 'MAN') }))
      }
    })

    const journal = (typeof w.TP !== 'undefined' && Array.isArray(w.TP.journal)) ? w.TP.journal : []
    journal.forEach(function (t: any) {
      if (t.journalEvent !== 'CLOSE') return
      const tMode = t.mode || (t.isLive ? 'live' : 'demo')
      if (tMode !== curMode) return
      const tSym = ((t.sym || '') + 'USDT').toUpperCase()
      if (tSym !== curSym) return
      if (t.entry == null || t.exit == null) return

      const isAuto = !!t.autoTrade
      const isLong = (t.side || '').toUpperCase() === 'LONG'
      const entryLabel = (isAuto ? 'AT ' : 'MAN ') + (t.side || '?')

      const entryTs = t.openTs || t.id
      const entryBarTime = _tsToBarTime(entryTs)
      if (entryBarTime) {
        const eColor = isAuto ? (isLong ? '#00d97a' : '#ff3355') : (isLong ? '#00b8d4' : '#ff8822')
        markers.push({ time: entryBarTime, position: isLong ? 'belowBar' : 'aboveBar', color: eColor, shape: isLong ? 'arrowUp' : 'arrowDown', text: entryLabel })
      }

      const exitTs = t.closedAt || (t.id ? t.id + 60000 : 0)
      const exitBarTime = _tsToBarTime(exitTs)
      if (exitBarTime) {
        const exitType = _classifyExitReason(t.reason)
        const meta = _exitMarkerMeta(exitType)
        markers.push({ time: exitBarTime, position: isLong ? 'aboveBar' : 'belowBar', color: meta.color, shape: 'circle', text: meta.text })
      }
    })

    markers.sort(function (a: any, b: any) { return a.time - b.time })
    w.cSeries.setMarkers(markers)
  } catch (e) { console.warn('[TradeMarkers]', e) }
}

// ═══════════════════════════════════════════════════════
// [p19 LLV] LIQ Levels V2 — Canvas Overlay
// ═══════════════════════════════════════════════════════
let _llvLines: any[] = []
let _llvCanvas: HTMLCanvasElement | null = null
let _llvCtx: CanvasRenderingContext2D | null = null
let _llvResizeObs: ResizeObserver | null = null
let _llvRenderTimer: any = null

export function llvEnsureCanvas(): void {
  const mcEl = document.getElementById('mc')
  if (!mcEl) return
  const parent = mcEl.parentElement
  if (!parent) return
  const pos = getComputedStyle(parent).position
  if (pos === 'static') parent.style.position = 'relative'
  if (_llvCanvas && _llvCanvas.parentElement === parent) return
  _llvCanvas = document.createElement('canvas')
  _llvCanvas.id = 'llvCanvas'
  _llvCanvas.style.cssText = 'position:absolute;inset:0;z-index:10;pointer-events:none;'
  parent.appendChild(_llvCanvas)
  _llvCtx = _llvCanvas.getContext('2d')
  llvResizeCanvas()
  if (_llvResizeObs) _llvResizeObs.disconnect()
  _llvResizeObs = new ResizeObserver(function () { llvResizeCanvas(); if (w.S.overlays.llv) llvRequestRender() })
  _llvResizeObs.observe(parent)
  if (w.mainChart) { w.mainChart.timeScale().subscribeVisibleLogicalRangeChange(llvRequestRender) }
}

export function llvResizeCanvas(): void {
  if (!_llvCanvas) return
  const parent = _llvCanvas.parentElement
  if (!parent) return
  _llvCanvas.width = parent.offsetWidth
  _llvCanvas.height = parent.offsetHeight
}

export function llvClearCanvas(): void {
  if (_llvCanvas && _llvCtx) { _llvCtx.clearRect(0, 0, _llvCanvas.width, _llvCanvas.height) }
}

export function llvRequestRender(): void {
  if (!w.S.overlays.llv) return
  if (_llvRenderTimer) clearTimeout(_llvRenderTimer)
  _llvRenderTimer = setTimeout(function () { _llvRenderTimer = null; renderLiqLevels() }, 250)
}

export function clearLiqLevels(): void {
  _llvLines.forEach(function (pl: any) { try { if (w.mainChart && pl && pl._series) { pl._series.removePriceLine(pl._line) } } catch (_) { } })
  _llvLines = []
  llvClearCanvas()
}

export function renderLiqLevels(): void {
  if (!w.mainChart || !w.S.llvBuckets || !w.cSeries) return
  try {
    llvEnsureCanvas()
    llvClearCanvas()
    if (!_llvCanvas || !_llvCtx) return

    const st = w.S.llvSettings
    const curPrice = w.S.price || 0
    if (!curPrice) return

    const buckets: any[] = Object.values(w.S.llvBuckets)
    if (!buckets.length) return

    const twMap: any = { '1d': 86400, '3d': 259200, '7d': 604800, '14d': 1209600, '30d': 2592000 }
    const twSec = twMap[st.timeWindow || '7d'] || 604800
    const now = Date.now()
    const cutoff = now - twSec * 1000

    const minUsd = st.minUsd || 0
    const longCol = st.longCol || '#00d4aa'
    const shortCol = st.shortCol || '#ff4466'
    const opRaw = st.opacity != null ? st.opacity : 70
    const opacity = opRaw <= 1 ? opRaw : opRaw / 100
    const maxBarWidthPct = st.maxBarWidthPct || 30
    const showLabels = st.showLabels !== false

    const canvasW = _llvCanvas.width
    const canvasH = _llvCanvas.height

    const visible = buckets.filter(function (b: any) {
      if (b.ts < cutoff) return false
      if ((b.longUSD + b.shortUSD) < minUsd) return false
      return true
    })
    if (!visible.length) return

    let maxUsdInView = 0
    visible.forEach(function (b: any) { const t = b.longUSD + b.shortUSD; if (t > maxUsdInView) maxUsdInView = t })
    if (!maxUsdInView) return

    const ctx = _llvCtx
    ctx.save()
    ctx.globalAlpha = opacity

    visible.forEach(function (b: any) {
      const y = w.cSeries.priceToCoordinate(b.price)
      if (y == null || y < 0 || y > canvasH) return
      const longUSD = b.longUSD
      const shortUSD = b.shortUSD
      const totalBTC = b.longBTC + b.shortBTC
      const barMaxW = canvasW * (maxBarWidthPct / 100)

      if (longUSD > 0) { const longW = (longUSD / maxUsdInView) * barMaxW; ctx.fillStyle = longCol; ctx.fillRect(0, y - 2, longW, 4) }
      if (shortUSD > 0) { const shortW = (shortUSD / maxUsdInView) * barMaxW; ctx.fillStyle = shortCol; ctx.fillRect(0, y + 2, shortW, 4) }

      if (showLabels) {
        let btcStr: string
        if (totalBTC >= 1000) { btcStr = (totalBTC / 1000).toFixed(1) + 'k' }
        else if (totalBTC >= 1) { btcStr = totalBTC.toFixed(1) }
        else if (totalBTC >= 0.01) { btcStr = totalBTC.toFixed(2) }
        else { btcStr = totalBTC.toFixed(3) }
        const distPct = Math.abs(b.price - curPrice) / curPrice * 100
        const label = btcStr + ' BTC | ' + distPct.toFixed(1) + '%'
        ctx.font = 'bold 9px monospace'
        ctx.fillStyle = '#00ff88'
        ctx.shadowColor = 'rgba(0,0,0,0.9)'
        ctx.shadowBlur = 3
        ctx.globalAlpha = Math.min(opacity + 0.2, 1)
        ctx.fillText(label, 4, y - 5)
        ctx.shadowBlur = 0
        ctx.globalAlpha = opacity
      }
    })

    ctx.restore()
  } catch (e) { console.warn('[LLV] renderLiqLevels error:', e) }
}

export function llvSaveSettings(): void {
  try {
    localStorage.setItem('zeus_llv_settings', JSON.stringify(w.S.llvSettings))
    if (typeof w._ucMarkDirty === 'function') w._ucMarkDirty('llvSettings')
    if (typeof w._userCtxPush === 'function') w._userCtxPush()
  } catch (e: any) { console.warn('[LLV] save settings error:', e) }
  renderLiqLevels()
  if (typeof w.closeM === 'function') w.closeM('mllv')
}

export function llvLoadSettings(): void {
  try {
    const raw = localStorage.getItem('zeus_llv_settings')
    if (!raw) return
    const saved = JSON.parse(raw)
    Object.keys(saved).forEach(function (k: string) { w.S.llvSettings[k] = saved[k] })
    const st = w.S.llvSettings
    const bEl = document.getElementById('llvBucket') as any
    if (bEl) { const bv = Math.round(st.bucketPct / 0.1); bEl.value = bv; const bvEl = document.getElementById('llvBucketV'); if (bvEl) bvEl.textContent = st.bucketPct.toFixed(1) + '%' }
    const mEl = document.getElementById('llvMinUsd') as any
    if (mEl) { mEl.value = st.minUsd / 1000; const mvEl = document.getElementById('llvMinUsdV'); if (mvEl) mvEl.textContent = '$' + (st.minUsd / 1000) + 'k' }
    const slEl = document.getElementById('llvShowLabels') as any
    if (slEl) slEl.checked = st.showLabels !== false
    const lEl = document.getElementById('llvLongCol') as any
    if (lEl) lEl.value = st.longCol || '#00d4aa'
    const scEl = document.getElementById('llvShortCol') as any
    if (scEl) scEl.value = st.shortCol || '#ff4466'
    const mbwEl = document.getElementById('llvMaxBarW') as any
    if (mbwEl) { mbwEl.value = st.maxBarWidthPct || 30; const mbvEl = document.getElementById('llvMaxBarWV'); if (mbvEl) mbvEl.textContent = (st.maxBarWidthPct || 30) + '%' }
    const opEl = document.getElementById('llvOpacity') as any
    if (opEl) { opEl.value = st.opacity != null ? st.opacity : 70; const ovEl = document.getElementById('llvOpacityV'); if (ovEl) ovEl.textContent = (st.opacity != null ? st.opacity : 70) + '%' }
    const twEl = document.getElementById('llvTimeWindow') as any
    if (twEl) twEl.value = st.timeWindow || '7d'
  } catch (e: any) { console.warn('[LLV] load settings error:', e) }
}

let _llvPressTimer: any = null
let _llvLongFired = false
export function _llvPressStart(_e: any): void {
  _llvLongFired = false
  _llvPressTimer = setTimeout(function () { _llvLongFired = true; _llvPressTimer = null; if (typeof w.openM === 'function') w.openM('mllv') }, 500)
}
export function _llvPressEnd(_e: any): void {
  if (_llvPressTimer) { clearTimeout(_llvPressTimer); _llvPressTimer = null }
}

// ===== HEATMAP =====
export function calcHeatmapPockets(klines: any[]): any[] {
  if (!klines || klines.length < 50) return []
  const hs = w.S.heatmapSettings
  const closes = klines.map((k: any) => k.close)
  const _hmAtrRes = w._calcATRSeries(klines, hs.atrLen || 121, 'wilder')
  const A = (_hmAtrRes.last || 0) * hs.atrBandPct
  const width = hs.pivotWidth; const pockets: any[] = []
  for (let i = width; i < klines.length - width; i++) {
    const k = klines[i]
    let isHigh = true, isLow = true
    for (let j = i - width; j <= i + width; j++) { if (j === i) continue; if (klines[j].high >= k.high) isHigh = false; if (klines[j].low <= k.low) isLow = false }
    if (isHigh) { pockets.push({ idx: i, side: -1, price: k.high, top: k.high + A, bot: k.high, weight: k.volume * ((k.high - k.low) || 1) * 100, hit: false }) }
    if (isLow) { pockets.push({ idx: i, side: 1, price: k.low, top: k.low, bot: k.low - A, weight: k.volume * ((k.high - k.low) || 1) * 100, hit: false }) }
  }
  const cur = closes[closes.length - 1]
  pockets.forEach((p: any) => { p.hit = p.side === 1 ? cur < p.top : cur > p.bot })
  return pockets.filter((p: any) => p.weight >= hs.minWeight)
}

export function renderHeatmapOverlay(): void {
  if (!w.mainChart || !w.S.klines.length) return
  clearHeatmap()
  const pockets = calcHeatmapPockets(w.S.klines.slice(-w.S.heatmapSettings.lookback))
  if (!pockets.length) return
  const weights = pockets.map((p: any) => p.weight)
  const maxW = Math.max(...weights) || 1
  const hs = w.S.heatmapSettings
  pockets.slice(-100).forEach((p: any) => {
    const norm = p.weight / maxW
    const alpha = Math.max(0.05, norm * hs.heatContrast)
    const col = p.side === 1 ? hs.longCol : hs.shortCol
    const hex = (n: number) => Math.round(n * 255).toString(16).padStart(2, '0')
    void hex(alpha) // used in original for colA but not referenced below
    const mid = (p.top + p.bot) / 2
    const startIdx = Math.max(0, p.idx)
    const end = p.hit && !hs.keepTouched ? p.idx + hs.extendUnhit / 2 : p.idx + hs.extendUnhit
    const endIdx = Math.min(w.S.klines.length - 1, end)
    const pocketTs = w.S.klines.slice(startIdx, endIdx + 1).map((k: any) => k.time)
    if (!pocketTs.length) return
    try {
      const topL = w.mainChart.addLineSeries({ color: col + '33', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
      topL.setData(pocketTs.map((t: any) => ({ time: t, value: p.top }))); w.liqSeries.push(topL)
      const botL = w.mainChart.addLineSeries({ color: col + '33', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
      botL.setData(pocketTs.map((t: any) => ({ time: t, value: p.bot }))); w.liqSeries.push(botL)
      const distPct = w.S.price ? ((mid - w.S.price) / w.S.price * 100).toFixed(2) : null
      const amtLabel = p.weight >= 1e6 ? '$' + (p.weight / 1e6).toFixed(1) + 'M' : p.weight >= 1e3 ? '$' + (p.weight / 1e3).toFixed(0) + 'K' : '$' + p.weight.toFixed(0)
      const liqLabel = `${p.side === 1 ? 'LIQ\u2191' : 'LIQ\u2193'} ${amtLabel}${distPct ? ' | ' + (Number(distPct) > 0 ? '+' : '') + distPct + '%' : ''}`
      const sm = w.mainChart.addLineSeries({ color: col + '55', lineWidth: Math.max(4, Math.round(norm * 16)), priceLineVisible: false, lastValueVisible: true, title: liqLabel })
      sm.setData(pocketTs.map((t: any) => ({ time: t, value: mid }))); w.liqSeries.push(sm)
    } catch (_) { }
  })
}

export function renderSROverlay(): void {
  if (!w.mainChart || !w.S.klines.length) return
  clearSR()
  const recent = w.S.klines.slice(-50)
  const highs = recent.map((k: any) => k.high).sort((a: number, b: number) => b - a).slice(0, 3)
  const lows = recent.map((k: any) => k.low).sort((a: number, b: number) => a - b).slice(0, 3)
  const _lastK = w.S.klines[w.S.klines.length - 1]
  if (!_lastK) return
  const lastT = _lastK.time
  const firstT = w.S.klines[Math.max(0, w.S.klines.length - 50)].time
  ;[...highs.map((v: number) => ({ v, c: '#ff335566' })), ...lows.map((v: number) => ({ v, c: '#00d97a66' }))].forEach(({ v, c }: any) => {
    try {
      const s = w.mainChart.addLineSeries({ color: c, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, lineStyle: 2 })
      s.setData([{ time: firstT, value: v }, { time: lastT, value: v }]); w.srSeries.push(s)
    } catch (_) { }
  })
}
