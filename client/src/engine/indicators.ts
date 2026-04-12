// Zeus — engine/indicators.ts
// Ported 1:1 from public/js/brain/deepdive.js lines 3733-4912 (Phase 5B1)
// Live API stubs, PWA, Indicator panel, Overlay/Oscillator indicators,
// Signal scanner, Deep Dive narrative generator

import { fmtTime, fmtDate, fmtNow, toast, _calcATRSeries } from '../data/marketDataHelpers'
import { sendAlert } from '../data/marketDataWS'
import { liveApiSyncState } from '../trading/liveApi'
import { fmt, fP } from '../utils/format'
import { escHtml, el } from '../utils/dom'
import { _ZI } from '../constants/icons'
import { playAlertSound } from '../ui/dom2'
import { renderSignals } from './signals'
import { renderVWAP } from '../ui/panels'
import { getChartW } from '../data/marketDataChart'
import { atLog } from '../trading/autotrade'

const w = window as any

// ═══════════════════════════════════════════════════════════════
// LIVE API STUBS
// ═══════════════════════════════════════════════════════════════

export function connectLiveAPI(): void {
  const st = el('apiStatus')
  if (st) { st.innerHTML = _ZI.timer + ' Se verific\u0103 conexiunea exchange...'; st.style.color = 'var(--yel)' }
  fetch('/api/exchange/status', { credentials: 'same-origin' }).then(function (r: Response) { return r.json() }).then(function (data: any) {
    if (!data.ok || !data.connected) {
      if (st) {
        st.innerHTML = _ZI.w + ' Nicio conexiune exchange configurat\u0103.<br><span style="color:#00afff;cursor:pointer" onclick="openM(\'msettings\');swtab(\'msettings\',\'set-exchange\',document.querySelector(\'[data-extab]\'))">' + _ZI.bolt + ' Configureaz\u0103 \u00EEn Settings \u2192 Exchange API</span>'
        st.style.color = '#f0c040'
      }
      return
    }
    const exchange = data.exchange || 'binance'
    const mode = data.mode || 'live'
    w.TP.liveConnected = true; w.TP.liveExchange = exchange
    if (st) {
      st.innerHTML = _ZI.ok + ' <b>' + exchange.toUpperCase() + '</b> \u2014 ' + mode.toUpperCase() + '<br><span style="font-size:8px;color:#556">API: ' + (data.maskedKey || '***') + ' \u00B7 Last verified: ' + (data.lastVerified || 'N/A') + '</span>'
      st.style.color = 'var(--grn)'
    }
    const form = el('liveOrderForm'); if (form) form.style.display = 'block'
    const btn = el('btnConnectExchange'); if (btn) btn.style.display = 'none'
    if (typeof liveApiSyncState === 'function') liveApiSyncState()
  }).catch(function (err: any) {
    if (st) { st.innerHTML = _ZI.x + ' Backend unreachable: ' + escHtml(err.message || err); st.style.color = 'var(--red)' }
  })
}

export function placeLiveOrder(): void {
  toast('placeLiveOrder disabled \u2014 use standard Live Trading panel', 0, _ZI.x)
  atLog('warn', '[BLOCK] placeLiveOrder is disabled (orphan order path \u2014 use Live Trading panel)')
}

export function connectLiveExchange(): void {
  toast('LIVE TRADING DEZACTIVAT \u2014 backend necesar.', 0, _ZI.dRed)
}

export function loadSavedAPI(): void {
  localStorage.removeItem('zt_api_key')
  localStorage.removeItem('zt_api_secret')
  localStorage.removeItem('zt_api_token')
  localStorage.removeItem('zt_api_exchange')
  connectLiveAPI()
}

export function installPWA(): void {
  const prompt = w._dip || w._deferredPrompt
  if (prompt) { prompt.prompt(); prompt.userChoice.then(() => { const b = el('installBtn'); if (b) b.style.display = 'none'; w._dip = null; w._deferredPrompt = null }) }
  else toast('Deschide in Chrome/Brave \u2192 meniu \u2192 Instaleaza aplicatia')
}

// ═══════════════════════════════════════════════════════════════
// INDICATOR STATE INIT
// ═══════════════════════════════════════════════════════════════

export function initIndicatorState(): void {
  if (typeof w.S === 'undefined' || !w.S) return
  if (!w.S.activeInds) w.S.activeInds = { ema: true, wma: true, st: true, vp: true }
  if (!w.S.macdData) w.S.macdData = []
  if (!w.S.signalData) w.S.signalData = {}
}

// ═══════════════════════════════════════════════════════════════
// INDICATOR PANEL
// ═══════════════════════════════════════════════════════════════

export function openIndPanel(): void {
  const ov = document.getElementById('indOverlay')
  const pan = document.getElementById('indPanel')
  const body = document.getElementById('indPanelBody')
  if (!ov || !pan || !body) return

  body.innerHTML = ''
  const _sorted = w.INDICATORS.slice().sort(function (a: any, b: any) {
    const aOn = w.S.activeInds[a.id] ? 1 : 0
    const bOn = w.S.activeInds[b.id] ? 1 : 0
    return bOn - aOn
  })
  _sorted.forEach((ind: any) => {
    const on = !!w.S.activeInds[ind.id]
    const row = document.createElement('div')
    row.className = 'ind-row'
    row.innerHTML = `
      <div class="ind-row-l">
        <span class="ind-row-ico">${ind.ico}</span>
        <div>
          <div class="ind-row-name">${ind.name}</div>
          <div class="ind-row-desc">${ind.desc}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <span class="ind-gear" data-action="openIndSettings" data-id="${ind.id}" title="Settings">${_ZI.bolt}</span>
        <div class="ind-toggle ${on ? 'on' : ''}" data-action="toggleInd" data-id="${ind.id}">
          <div class="ind-toggle-dot"></div>
        </div>
      </div>
    `
    body.appendChild(row)
  })

  // Event delegation for indicator panel buttons
  if (!body.dataset.delegated) {
    body.dataset.delegated = '1'
    body.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('[data-action]') as HTMLElement
      if (!target) return
      const action = target.dataset.action
      const id = target.dataset.id
      if (action === 'openIndSettings') { e.stopPropagation(); openIndSettings(id) }
      else if (action === 'toggleInd') toggleInd(id, target)
    })
  }

  ov.classList.add('open')
  pan.classList.add('open')
}

export function closeIndPanel(): void {
  document.getElementById('indOverlay')?.classList.remove('open')
  document.getElementById('indPanel')?.classList.remove('open')
}

export function toggleInd(id: string, toggleEl: HTMLElement): void {
  w.S.activeInds[id] = !w.S.activeInds[id]
  w.S.indicators[id] = w.S.activeInds[id]
  if (w.S.activeInds[id]) toggleEl.classList.add('on')
  else toggleEl.classList.remove('on')
  applyIndVisibility(id, w.S.activeInds[id])
  if (w.S.activeInds[id] && typeof w.renderChart === 'function') w.renderChart()
  renderActBar()
  toast(w.S.activeInds[id] ? w.INDICATORS.find((i: any) => i.id === id)?.name + ' ON' : w.INDICATORS.find((i: any) => i.id === id)?.name + ' OFF')
  if (typeof w._usSave === 'function') w._usSave()
  if (typeof w._userCtxPushNow === 'function') w._userCtxPushNow()
}

export function applyIndVisibility(id: string, visible: boolean): void {
  const show = visible
  switch (id) {
    case 'ema':
      if (w.ema50S) w.ema50S.applyOptions({ visible: show })
      if (w.ema200S) w.ema200S.applyOptions({ visible: show })
      break
    case 'wma':
      if (w.wma20S) w.wma20S.applyOptions({ visible: show })
      if (w.wma50S) w.wma50S.applyOptions({ visible: show })
      break
    case 'st':
      if (w.stS) w.stS.applyOptions({ visible: show })
      break
    case 'bb':
      if (show) initBBSeries()
      if (bbUpperS) bbUpperS.applyOptions({ visible: show })
      if (w.bbMiddleS) w.bbMiddleS.applyOptions({ visible: show })
      if (w.bbLowerS) w.bbLowerS.applyOptions({ visible: show })
      if (show) updateBB()
      break
    case 'ichimoku':
      if (show) initIchimokuSeries()
      w.ichimokuSeries.forEach((s: any) => { try { s.applyOptions({ visible: show }) } catch (_) { } })
      if (show) updateIchimoku()
      break
    case 'fib':
      if (show) updateFib()
      else { fibSeries.forEach((s: any) => { try { w.mainChart.removeSeries(s) } catch (_) { } }); fibSeries = [] }
      break
    case 'pivot':
      if (show) updatePivot()
      else { w.pivotSeries.forEach((s: any) => { try { w.mainChart.removeSeries(s) } catch (_) { } }); w.pivotSeries = [] }
      break
    case 'vp':
      if (show) updateVP()
      else { w.vpSeries.forEach((s: any) => { try { w.mainChart.removeSeries(s) } catch (_) { } }); w.vpSeries = [] }
      break
    case 'vwap':
      w.S.vwapOn = show
      if (show) { if (typeof renderVWAP === 'function') renderVWAP() }
      else { if (typeof w.vwapSeries !== 'undefined') { w.vwapSeries.forEach((s: any) => { try { w.mainChart.removeSeries(s) } catch (_) { } }); w.vwapSeries = [] } }
      { const vBtn = document.getElementById('vwapBtn'); if (vBtn) vBtn.classList.toggle('on', show) }
      break
    case 'cvd':
      { const cvdEl = document.getElementById('cc'); if (cvdEl) cvdEl.style.display = show ? '' : 'none' }
      break
    case 'macd':
      { const mc = document.getElementById('macdChart'); if (mc) mc.style.display = show ? '' : 'none'; if (show) initMACDChart() }
      break
    case 'rsi14':
      { const rc = document.getElementById('rsiChart'); if (rc) rc.style.display = show ? '' : 'none'; if (show) initRSIChart() }
      break
    case 'stoch':
      { const sc = document.getElementById('stochChart'); if (sc) sc.style.display = show ? '' : 'none'; if (show) initStochChart() }
      break
    case 'atr':
      { const ac = document.getElementById('atrChart'); if (ac) ac.style.display = show ? '' : 'none'; if (show) initATRChart() }
      break
    case 'obv':
      { const oc = document.getElementById('obvChart'); if (oc) oc.style.display = show ? '' : 'none'; if (show) initOBVChart() }
      break
    case 'mfi':
      { const mfc = document.getElementById('mfiChart'); if (mfc) mfc.style.display = show ? '' : 'none'; if (show) initMFIChart() }
      break
    case 'cci':
      { const cc = document.getElementById('cciChart'); if (cc) cc.style.display = show ? '' : 'none'; if (show) initCCIChart() }
      break
  }
}

// ═══════════════════════════════════════════════════════════════
// INDICATOR SETTINGS MODAL
// ═══════════════════════════════════════════════════════════════

export function openIndSettings(id: string): void {
  const cfg = w.IND_SETTINGS[id]
  if (!cfg || Object.keys(cfg).length === 0) { toast('No settings for ' + id.toUpperCase()); return }
  const ind = w.INDICATORS.find((i: any) => i.id === id)
  const labels: Record<string, string> = {
    p1: 'Period 1', p2: 'Period 2', period: 'Period', mult: 'Multiplier',
    stdDev: 'Std Deviation', kPeriod: 'K Period', dPeriod: 'D Period', smooth: 'Smoothing',
    fast: 'Fast', slow: 'Slow', signal: 'Signal', tenkan: 'Tenkan', kijun: 'Kijun',
    senkou: 'Senkou Span B', rows: 'Rows', type: 'Type'
  }
  let html = `<div class="ind-set-title">${ind ? ind.ico : _ZI.bolt} ${ind ? ind.name : id.toUpperCase()} Settings</div>`
  for (const [key, val] of Object.entries(cfg)) {
    if (key === 'levels' || key === 'type') continue
    html += `<div class="ind-set-row"><label>${labels[key] || key}</label><input type="number" id="indset-${id}-${key}" value="${val}" min="1" max="500" step="any" class="ind-set-input"></div>`
  }
  html += `<div style="display:flex;gap:8px;margin-top:10px"><button class="ind-set-btn" data-action="applyIndSettings" data-id="${id}">Apply</button><button class="ind-set-btn cancel" data-action="closeIndSettings">Cancel</button></div>`
  let modal = document.getElementById('indSettingsModal')
  if (!modal) {
    modal = document.createElement('div')
    modal.id = 'indSettingsModal'
    modal.className = 'ind-settings-modal'
    document.body.appendChild(modal)
  }
  modal.innerHTML = html
  ;(modal as HTMLElement).style.display = 'flex'
  // Event delegation for settings modal buttons
  if (!modal.dataset.delegated) {
    modal.dataset.delegated = '1'
    modal.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement
      if (!btn) return
      if (btn.dataset.action === 'applyIndSettings') applyIndSettings(btn.dataset.id)
      else if (btn.dataset.action === 'closeIndSettings') closeIndSettings()
    })
  }
}

export function closeIndSettings(): void {
  const m = document.getElementById('indSettingsModal')
  if (m) (m as HTMLElement).style.display = 'none'
}

export function applyIndSettings(id: string): void {
  const cfg = w.IND_SETTINGS[id]
  if (!cfg) return
  for (const key of Object.keys(cfg)) {
    if (key === 'levels' || key === 'type') continue
    const inp = document.getElementById('indset-' + id + '-' + key) as HTMLInputElement | null
    if (inp) { const v = parseFloat(inp.value); if (isFinite(v) && v > 0) cfg[key] = v }
  }
  closeIndSettings()
  if (typeof w._indSettingsSave === 'function') w._indSettingsSave()
  if (typeof w._userCtxPush === 'function') w._userCtxPush()
  if (w.S.activeInds[id]) {
    if (typeof w.renderChart === 'function') w.renderChart()
    applyIndVisibility(id, true)
  }
  toast(id.toUpperCase() + ' settings updated', 0, _ZI.bolt)
}

// ═══════════════════════════════════════════════════════════════
// OVERLAY — Bollinger Bands
// ═══════════════════════════════════════════════════════════════

export function initBBSeries(): void {
  if (bbUpperS || !w.mainChart) return
  bbUpperS = w.mainChart.addLineSeries({ color: '#ff668866', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, lineStyle: 2 })
  w.bbMiddleS = w.mainChart.addLineSeries({ color: '#ff6688', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
  w.bbLowerS = w.mainChart.addLineSeries({ color: '#ff668866', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, lineStyle: 2 })
}

export function updateBB(): void {
  if (!w.mainChart || !w.S.klines.length) return
  initBBSeries()
  const c = w.S.klines.map((k: any) => k.close)
  const p = Math.round(w.IND_SETTINGS.bb.period) || 20
  const sd = w.IND_SETTINGS.bb.stdDev || 2
  const upper: any[] = [], middle: any[] = [], lower: any[] = []
  for (let i = 0; i < c.length; i++) {
    if (i < p - 1) { upper.push({ time: w.S.klines[i].time, value: 0 }); middle.push({ time: w.S.klines[i].time, value: 0 }); lower.push({ time: w.S.klines[i].time, value: 0 }); continue }
    let sum = 0; for (let j = i - p + 1; j <= i; j++) sum += c[j]; const avg = sum / p
    let variance = 0; for (let j = i - p + 1; j <= i; j++) variance += Math.pow(c[j] - avg, 2); const stdDev = Math.sqrt(variance / p)
    middle.push({ time: w.S.klines[i].time, value: avg })
    upper.push({ time: w.S.klines[i].time, value: avg + sd * stdDev })
    lower.push({ time: w.S.klines[i].time, value: avg - sd * stdDev })
  }
  try { w.bbMiddleS.setData(middle.filter((d: any) => d.value > 0)); bbUpperS.setData(upper.filter((d: any) => d.value > 0)); w.bbLowerS.setData(lower.filter((d: any) => d.value > 0)) } catch (_) { }
}

// ═══════════════════════════════════════════════════════════════
// OVERLAY — Ichimoku Cloud
// ═══════════════════════════════════════════════════════════════

export function initIchimokuSeries(): void {
  if (w.ichimokuSeries.length || !w.mainChart) return
  const tenkanS = w.mainChart.addLineSeries({ color: '#0496ff', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: 'Tenkan' })
  const kijunS = w.mainChart.addLineSeries({ color: '#ff3355', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: 'Kijun' })
  const spanAS = w.mainChart.addLineSeries({ color: '#00d97a66', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, lineStyle: 2 })
  const spanBS = w.mainChart.addLineSeries({ color: '#ff335566', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, lineStyle: 2 })
  const chikouS = w.mainChart.addLineSeries({ color: '#aa44ff66', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, lineStyle: 3 })
  w.ichimokuSeries = [tenkanS, kijunS, spanAS, spanBS, chikouS]
}

function _ichiHL(klines: any[], p: number, idx: number): number {
  let h = -Infinity, l = Infinity
  for (let j = Math.max(0, idx - p + 1); j <= idx; j++) { h = Math.max(h, klines[j].high); l = Math.min(l, klines[j].low) }
  return (h + l) / 2
}

export function updateIchimoku(): void {
  if (!w.mainChart || !w.S.klines.length || w.ichimokuSeries.length < 5) return
  const k = w.S.klines; const cfg = w.IND_SETTINGS.ichimoku
  const tenkan: any[] = [], kijun: any[] = [], spanA: any[] = [], spanB: any[] = [], chikou: any[] = []
  for (let i = 0; i < k.length; i++) {
    const tv = i >= cfg.tenkan - 1 ? _ichiHL(k, cfg.tenkan, i) : null
    const kv = i >= cfg.kijun - 1 ? _ichiHL(k, cfg.kijun, i) : null
    if (tv !== null) tenkan.push({ time: k[i].time, value: tv })
    if (kv !== null) kijun.push({ time: k[i].time, value: kv })
    if (tv !== null && kv !== null && i + cfg.kijun < k.length) spanA.push({ time: k[i + cfg.kijun].time, value: (tv + kv) / 2 })
    if (i >= cfg.senkou - 1 && i + cfg.kijun < k.length) spanB.push({ time: k[i + cfg.kijun].time, value: _ichiHL(k, cfg.senkou, i) })
    if (i >= cfg.kijun) chikou.push({ time: k[i - cfg.kijun].time, value: k[i].close })
  }
  try { w.ichimokuSeries[0].setData(tenkan); w.ichimokuSeries[1].setData(kijun); w.ichimokuSeries[2].setData(spanA); w.ichimokuSeries[3].setData(spanB); w.ichimokuSeries[4].setData(chikou) } catch (_) { }
}

// ═══════════════════════════════════════════════════════════════
// OVERLAY — Fibonacci Retracement
// ═══════════════════════════════════════════════════════════════

export function updateFib(): void {
  fibSeries.forEach((s: any) => { try { w.mainChart.removeSeries(s) } catch (_) { } }); fibSeries = []
  if (!w.mainChart || !w.S.klines.length) return
  const k = w.S.klines; let swH = -Infinity, swL = Infinity, hiIdx = 0, loIdx = 0
  const start = Math.max(0, k.length - 100)
  for (let i = start; i < k.length; i++) { if (k[i].high > swH) { swH = k[i].high; hiIdx = i } if (k[i].low < swL) { swL = k[i].low; loIdx = i } }
  if (swH <= swL) return
  const isUptrend = loIdx < hiIdx
  const colors = ['#ffffff44', '#00d97a55', '#00b8d455', '#f0c04066', '#ff880066', '#ff335566', '#ff668866']
  const levels = w.IND_SETTINGS.fib.levels
  levels.forEach((lv: number, idx: number) => {
    const price = isUptrend ? swH - lv * (swH - swL) : swL + lv * (swH - swL)
    const s = w.mainChart.addLineSeries({ color: colors[idx] || '#888', lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: (lv * 100).toFixed(1) + '%', lineStyle: 2 })
    s.setData([{ time: k[start].time, value: price }, { time: k[k.length - 1].time, value: price }])
    fibSeries.push(s)
  })
}

// ═══════════════════════════════════════════════════════════════
// OVERLAY — Pivot Points
// ═══════════════════════════════════════════════════════════════

export function updatePivot(): void {
  w.pivotSeries.forEach((s: any) => { try { w.mainChart.removeSeries(s) } catch (_) { } }); w.pivotSeries = []
  if (!w.mainChart || !w.S.klines.length) return
  const k = w.S.klines
  const now = Date.now() / 1000
  const dayStart = Math.floor(now / 86400) * 86400
  const prevDay = k.filter((b: any) => b.time >= dayStart - 86400 && b.time < dayStart)
  if (!prevDay.length) return
  let ph = -Infinity, pl = Infinity; const pc = prevDay[prevDay.length - 1].close
  prevDay.forEach((b: any) => { ph = Math.max(ph, b.high); pl = Math.min(pl, b.low) })
  const P = (ph + pl + pc) / 3
  const R1 = 2 * P - pl, S1 = 2 * P - ph
  const R2 = P + (ph - pl), S2 = P - (ph - pl)
  const R3 = ph + 2 * (P - pl), S3 = pl - 2 * (ph - P)
  const today = k.filter((b: any) => b.time >= dayStart)
  if (!today.length) return
  const t0 = today[0].time, t1 = today[today.length - 1].time
  const add = (price: number, color: string, label: string) => {
    const s = w.mainChart.addLineSeries({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: label, lineStyle: 2 })
    s.setData([{ time: t0, value: price }, { time: t1, value: price }])
    w.pivotSeries.push(s)
  }
  add(P, '#f0c040', 'P')
  add(R1, '#ff335566', 'R1'); add(R2, '#ff335588', 'R2'); add(R3, '#ff3355aa', 'R3')
  add(S1, '#00d97a66', 'S1'); add(S2, '#00d97a88', 'S2'); add(S3, '#00d97aaa', 'S3')
}

// ═══════════════════════════════════════════════════════════════
// OVERLAY — Volume Profile
// ═══════════════════════════════════════════════════════════════

export function updateVP(): void {
  w.vpSeries.forEach((s: any) => { try { w.mainChart.removeSeries(s) } catch (_) { } }); w.vpSeries = []
  if (!w.mainChart || !w.S.klines.length) return
  const k = w.S.klines; const rows = w.IND_SETTINGS.vp.rows || 70
  let hi = -Infinity, lo = Infinity
  k.forEach((b: any) => { hi = Math.max(hi, b.high); lo = Math.min(lo, b.low) })
  if (hi <= lo) return
  const step = (hi - lo) / rows
  const buckets = new Array(rows).fill(0)
  k.forEach((b: any) => {
    const idx = Math.min(rows - 1, Math.floor((b.close - lo) / step))
    buckets[idx] += b.volume
  })
  const maxVol = Math.max(...buckets)
  if (!maxVol) return
  const vpS = w.mainChart.addHistogramSeries({
    color: '#00b8d422', priceFormat: { type: 'price' }, priceScaleId: 'vp', scaleMargins: { top: 0, bottom: 0 },
  })
  try { w.mainChart.priceScale('vp').applyOptions({ scaleMargins: { top: 0.05, bottom: 0.05 }, visible: false }) } catch (_) { }
  const vpData: any[] = []
  const step2 = Math.floor(k.length / rows)
  for (let i = 0; i < rows && i * step2 < k.length; i++) {
    vpData.push({ time: k[i * step2].time, value: buckets[i], color: buckets[i] === maxVol ? '#f0c04044' : '#00b8d422' })
  }
  vpS.setData(vpData)
  w.vpSeries.push(vpS)
}

// ═══════════════════════════════════════════════════════════════
// SUB-CHART HELPER
// ═══════════════════════════════════════════════════════════════

function _createSubChart(containerId: string, height?: number): any {
  const container = document.getElementById(containerId)
  if (!container || typeof w.LightweightCharts === 'undefined') return null
  container.style.height = (height || 60) + 'px'
  const chart = w.LightweightCharts.createChart(container, {
    width: getChartW(),
    height: height || 60,
    layout: { background: { color: '#0a0f16' }, textColor: '#7a9ab8' },
    grid: { vertLines: { color: '#1a2030' }, horzLines: { color: '#1a2030' } },
    rightPriceScale: { borderColor: '#1e2530', visible: true, width: 70, scaleMargins: { top: 0.1, bottom: 0.1 } },
    timeScale: { visible: false, rightOffset: 12 },
    crosshair: { mode: w.LightweightCharts.CrosshairMode.Normal },
    handleScroll: { mouseWheel: true, pressedMouseMove: true },
    handleScale: { mouseWheel: true, pinch: true },
  })
  chart.applyOptions({ localization: { timeFormatter: (ts: number) => fmtTime(ts), dateFormatter: (ts: number) => fmtDate(ts) } })
  if (w.mainChart) {
    try {
      const tr = w.mainChart.timeScale().getVisibleLogicalRange()
      if (tr) chart.timeScale().setVisibleLogicalRange(tr)
    } catch (_) { }
  }
  return chart
}

export function _syncSubChartsToMain(): void {
  if (!w.mainChart) return
  try {
    const r = w.mainChart.timeScale().getVisibleLogicalRange()
    if (!r) return
    ;[_rsiChart, w._stochChart, w._atrChart, _obvChart, w._mfiChart, w._cciChart, w._macdChart].forEach((ch: any) => {
      if (ch) try { ch.timeScale().setVisibleLogicalRange(r) } catch (_) { }
    })
  } catch (_) { }
}

// ═══════════════════════════════════════════════════════════════
// OSCILLATORS — RSI, Stoch, ATR, OBV, MFI, CCI
// ═══════════════════════════════════════════════════════════════

export function initRSIChart(): void {
  if (w._rsiInited && _rsiChart) { updateRSI(); return }
  _rsiChart = _createSubChart('rsiChart', 60)
  if (!_rsiChart) return
  w._rsiSeries = _rsiChart.addLineSeries({ color: '#f5c842', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, title: 'RSI' })
  w._rsiInited = true
  updateRSI()
}

export function updateRSI(): void {
  if (!w._rsiInited || !w._rsiSeries || !w.S.klines.length) return
  const c = w.S.klines.map((k: any) => k.close)
  const p = Math.round(w.IND_SETTINGS.rsi14.period) || 14
  const rsiData: any[] = []
  let avgGain = 0, avgLoss = 0
  for (let i = 1; i < c.length; i++) {
    const change = c[i] - c[i - 1]
    if (i <= p) {
      if (change > 0) avgGain += change; else avgLoss -= change
      if (i === p) { avgGain /= p; avgLoss /= p; const rs = avgLoss === 0 ? 100 : avgGain / avgLoss; rsiData.push({ time: w.S.klines[i].time, value: 100 - 100 / (1 + rs) }) }
    } else {
      avgGain = (avgGain * (p - 1) + Math.max(change, 0)) / p
      avgLoss = (avgLoss * (p - 1) + Math.max(-change, 0)) / p
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
      rsiData.push({ time: w.S.klines[i].time, value: 100 - 100 / (1 + rs) })
    }
  }
  try { w._rsiSeries.setData(rsiData); _syncSubChartsToMain() } catch (_) { }
}

export function initStochChart(): void {
  if (w._stochInited && w._stochChart) { updateStoch(); return }
  w._stochChart = _createSubChart('stochChart', 60)
  if (!w._stochChart) return
  w._stochKSeries = w._stochChart.addLineSeries({ color: '#00e5ff', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, title: '%K' })
  w._stochDSeries = w._stochChart.addLineSeries({ color: '#ff8800', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, title: '%D' })
  w._stochInited = true
  updateStoch()
}

export function updateStoch(): void {
  if (!w._stochInited || !w._stochKSeries || !w.S.klines.length) return
  const c = w.S.klines.map((k: any) => k.close)
  const p = Math.round(w.IND_SETTINGS.stoch.kPeriod) || 14
  const dP = Math.round(w.IND_SETTINGS.stoch.dPeriod) || 3
  const sm = Math.round(w.IND_SETTINGS.stoch.smooth) || 3
  const rsi: number[] = []
  let avgG = 0, avgL = 0
  for (let i = 1; i < c.length; i++) {
    const ch = c[i] - c[i - 1]
    if (i <= 14) { if (ch > 0) avgG += ch; else avgL -= ch; if (i === 14) { avgG /= 14; avgL /= 14 } }
    else { avgG = (avgG * 13 + Math.max(ch, 0)) / 14; avgL = (avgL * 13 + Math.max(-ch, 0)) / 14 }
    if (i >= 14) { const rs = avgL === 0 ? 100 : avgG / avgL; rsi.push(100 - 100 / (1 + rs)) }
  }
  const rawK: number[] = []
  for (let i = p - 1; i < rsi.length; i++) {
    let hi = -Infinity, lo = Infinity
    for (let j = i - p + 1; j <= i; j++) { hi = Math.max(hi, rsi[j]); lo = Math.min(lo, rsi[j]) }
    rawK.push(hi === lo ? 50 : (rsi[i] - lo) / (hi - lo) * 100)
  }
  const sK: number[] = []; for (let i = sm - 1; i < rawK.length; i++) { let s = 0; for (let j = 0; j < sm; j++) s += rawK[i - j]; sK.push(s / sm) }
  const sD: number[] = []; for (let i = dP - 1; i < sK.length; i++) { let s = 0; for (let j = 0; j < dP; j++) s += sK[i - j]; sD.push(s / dP) }
  const offset = 14 + p - 1 + sm - 1
  const kData = sK.map((v, i) => ({ time: w.S.klines[offset + i]?.time, value: v })).filter((d: any) => d.time)
  const dOffset = offset + dP - 1
  const dData = sD.map((v, i) => ({ time: w.S.klines[dOffset + i]?.time, value: v })).filter((d: any) => d.time)
  try { w._stochKSeries.setData(kData); w._stochDSeries.setData(dData); _syncSubChartsToMain() } catch (_) { }
}

export function initATRChart(): void {
  if (w._atrInited && w._atrChart) { updateATRInd(); return }
  w._atrChart = _createSubChart('atrChart', 60)
  if (!w._atrChart) return
  w._atrSeries = w._atrChart.addLineSeries({ color: '#ff8800', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, title: 'ATR' })
  w._atrInited = true
  updateATRInd()
}

export function updateATRInd(): void {
  if (!w._atrInited || !w._atrSeries || !w.S.klines.length) return
  const k = w.S.klines; const p = Math.round(w.IND_SETTINGS.atr.period) || 14
  const tr: number[] = []; for (let i = 0; i < k.length; i++) {
    if (i === 0) tr.push(k[i].high - k[i].low)
    else tr.push(Math.max(k[i].high - k[i].low, Math.abs(k[i].high - k[i - 1].close), Math.abs(k[i].low - k[i - 1].close)))
  }
  const atrData: any[] = []; let atr = 0
  for (let i = 0; i < tr.length; i++) {
    if (i < p) { atr += tr[i]; if (i === p - 1) { atr /= p; atrData.push({ time: k[i].time, value: atr }) } }
    else { atr = (atr * (p - 1) + tr[i]) / p; atrData.push({ time: k[i].time, value: atr }) }
  }
  try { w._atrSeries.setData(atrData); _syncSubChartsToMain() } catch (_) { }
}

export function initOBVChart(): void {
  if (w._obvInited && _obvChart) { updateOBV(); return }
  _obvChart = _createSubChart('obvChart', 60)
  if (!_obvChart) return
  w._obvSeries = _obvChart.addLineSeries({ color: '#00b8d4', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, title: 'OBV' })
  w._obvInited = true
  updateOBV()
}

export function updateOBV(): void {
  if (!w._obvInited || !w._obvSeries || !w.S.klines.length) return
  const k = w.S.klines; let obv = 0
  const data = k.map((b: any, i: number) => {
    if (i > 0) { if (b.close > k[i - 1].close) obv += b.volume; else if (b.close < k[i - 1].close) obv -= b.volume }
    return { time: b.time, value: obv }
  })
  try { w._obvSeries.setData(data); _syncSubChartsToMain() } catch (_) { }
}

export function initMFIChart(): void {
  if (w._mfiInited && w._mfiChart) { updateMFI(); return }
  w._mfiChart = _createSubChart('mfiChart', 60)
  if (!w._mfiChart) return
  w._mfiSeries = w._mfiChart.addLineSeries({ color: '#00d97a', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, title: 'MFI' })
  w._mfiInited = true
  updateMFI()
}

export function updateMFI(): void {
  if (!w._mfiInited || !w._mfiSeries || !w.S.klines.length) return
  const k = w.S.klines; const p = Math.round(w.IND_SETTINGS.mfi.period) || 14
  const tp = k.map((b: any) => (b.high + b.low + b.close) / 3)
  const mfData: any[] = []
  for (let i = p; i < k.length; i++) {
    let posFlow = 0, negFlow = 0
    for (let j = i - p + 1; j <= i; j++) {
      const flow = tp[j] * k[j].volume
      if (tp[j] > tp[j - 1]) posFlow += flow; else negFlow += flow
    }
    const mfi = negFlow === 0 ? 100 : 100 - 100 / (1 + posFlow / negFlow)
    mfData.push({ time: k[i].time, value: mfi })
  }
  try { w._mfiSeries.setData(mfData); _syncSubChartsToMain() } catch (_) { }
}

export function initCCIChart(): void {
  if (w._cciInited && w._cciChart) { updateCCI(); return }
  w._cciChart = _createSubChart('cciChart', 60)
  if (!w._cciChart) return
  w._cciSeries = w._cciChart.addLineSeries({ color: '#ff3355', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, title: 'CCI' })
  w._cciInited = true
  updateCCI()
}

export function updateCCI(): void {
  if (!w._cciInited || !w._cciSeries || !w.S.klines.length) return
  const k = w.S.klines; const p = Math.round(w.IND_SETTINGS.cci.period) || 20
  const tp = k.map((b: any) => (b.high + b.low + b.close) / 3)
  const cciData: any[] = []
  for (let i = p - 1; i < tp.length; i++) {
    let sum = 0; for (let j = i - p + 1; j <= i; j++) sum += tp[j]; const avg = sum / p
    let madSum = 0; for (let j = i - p + 1; j <= i; j++) madSum += Math.abs(tp[j] - avg); const mad = madSum / p
    const cci = mad === 0 ? 0 : (tp[i] - avg) / (0.015 * mad)
    cciData.push({ time: k[i].time, value: cci })
  }
  try { w._cciSeries.setData(cciData); _syncSubChartsToMain() } catch (_) { }
}

// ═══════════════════════════════════════════════════════════════
// INDICATOR RENDER HOOK
// ═══════════════════════════════════════════════════════════════

export function _indRenderHook(): void {
  if (w.S.activeInds.bb) updateBB()
  if (w.S.activeInds.ichimoku) updateIchimoku()
  if (w.S.activeInds.fib) updateFib()
  if (w.S.activeInds.pivot) updatePivot()
  if (w.S.activeInds.vp) updateVP()
  if (w.S.activeInds.rsi14 && w._rsiInited) updateRSI()
  if (w.S.activeInds.stoch && w._stochInited) updateStoch()
  if (w.S.activeInds.atr && w._atrInited) updateATRInd()
  if (w.S.activeInds.obv && w._obvInited) updateOBV()
  if (w.S.activeInds.mfi && w._mfiInited) updateMFI()
  if (w.S.activeInds.cci && w._cciInited) updateCCI()
}

export function renderActBar(): void {
  const bar = document.getElementById('actIndBar')
  const cnt = document.getElementById('actCount')
  if (!bar) return
  const active = w.INDICATORS.filter((i: any) => w.S.activeInds[i.id])
  if (cnt) cnt.textContent = active.length
  bar.innerHTML = active.map((i: any) => `
    <span class="act-pill" style="color:${getIndColor(i.id)};border-color:${getIndColor(i.id)}44;background:${getIndColor(i.id)}11"
      data-action="deactivateInd" data-id="${i.id}">
      ${i.ico} ${i.id.toUpperCase()} <span class="kill">\u2715</span>
    </span>`).join('')
  // Event delegation for active indicator pills
  if (!bar.dataset.delegated) {
    bar.dataset.delegated = '1'
    bar.addEventListener('click', (e) => {
      const pill = (e.target as HTMLElement).closest('[data-action="deactivateInd"]') as HTMLElement
      if (pill) deactivateInd(pill.dataset.id)
    })
  }
}

export function getIndColor(id: string): string {
  const map: Record<string, string> = { ema: '#f0c040', wma: '#aa44ff', st: '#ff8800', vp: '#00b8d4', macd: '#00e5ff', bb: '#ff6688', rsi14: '#f5c842', vwap: '#00d97a', fib: '#aa44ff', ichimoku: '#44aaff', stoch: '#ffaa00', obv: '#00b8d4', atr: '#ff8800', pivot: '#f0c040', mfi: '#00d97a', cci: '#ff3355' }
  return map[id] || '#888'
}

export function deactivateInd(id: string): void {
  w.S.activeInds[id] = false
  w.S.indicators[id] = false
  applyIndVisibility(id, false)
  renderActBar()
  if (typeof w._usSave === 'function') w._usSave()
}

export function toggleActBar(): void {
  const bar = document.getElementById('actIndBar')
  if (!bar) return
  ;(bar as HTMLElement).style.display = (bar as HTMLElement).style.display === 'none' ? 'flex' : 'none'
}

// ═══════════════════════════════════════════════════════════════
// MACD
// ═══════════════════════════════════════════════════════════════

export function calcMACD(closes: number[], fast = 12, slow = 26, signal = 9): any {
  if (!closes || closes.length < slow + signal) return null
  const ema = (arr: number[], p: number) => {
    const k = 2 / (p + 1); let v = arr[0]
    return arr.map((x, i) => i === 0 ? v : (v = x * k + v * (1 - k)))
  }
  const fastE = ema(closes, fast)
  const slowE = ema(closes, slow)
  const macdLine = fastE.map((v, i) => v - slowE[i]).slice(slow - 1)
  const sigLine = ema(macdLine, signal)
  const histogram = macdLine.map((v, i) => v - sigLine[i])
  const last = macdLine.length - 1
  return {
    macd: macdLine[last], signal: sigLine[last], hist: histogram[last],
    prevHist: histogram[last - 1] || 0, prevMacd: macdLine[last - 1] || 0, prevSignal: sigLine[last - 1] || 0,
  }
}

export function initMACDChart(): void {
  if (w._macdInited && w._macdChart) { _updateMACDChart(); return }
  const container = document.getElementById('macdChart')
  if (!container || typeof w.LightweightCharts === 'undefined') return
  container.style.height = '60px'
  const width = getChartW()
  w._macdChart = w.LightweightCharts.createChart(container, {
    width, height: 60,
    layout: { background: { color: '#0a0f16' }, textColor: '#7a9ab8' },
    grid: { vertLines: { color: '#1a2030' }, horzLines: { color: '#1a2030' } },
    rightPriceScale: { borderColor: '#1e2530', scaleMargins: { top: 0.1, bottom: 0.1 } },
    timeScale: { borderColor: '#1e2530', timeVisible: true, secondsVisible: false, rightOffset: 12 },
    crosshair: { mode: w.LightweightCharts.CrosshairMode.Normal },
    handleScroll: { mouseWheel: true, pressedMouseMove: true },
    handleScale: { mouseWheel: true, pinch: true },
  })
  w._macdChart.applyOptions({ localization: { timeFormatter: (ts: number) => fmtTime(ts), dateFormatter: (ts: number) => fmtDate(ts) } })
  w._macdChart.timeScale().applyOptions({ visible: false, rightOffset: 12 })
  w._macdChart.applyOptions({ rightPriceScale: { visible: true, borderColor: '#1e2530', width: 70 } })
  w._macdLineSeries = w._macdChart.addLineSeries({ color: '#00e5ff', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, title: 'MACD' })
  w._macdSigSeries = w._macdChart.addLineSeries({ color: '#ff8800', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, title: 'SIG' })
  w._macdHistSeries = w._macdChart.addHistogramSeries({ color: '#00d97a44', priceFormat: { type: 'price', precision: 4, minMove: 0.0001 }, priceScaleId: '', scaleMargins: { top: 0.8, bottom: 0 } })
  w._macdInited = true
  _updateMACDChart()
}

function _updateMACDChart(): void {
  if (!w._macdInited || !w._macdChart || !w._macdLineSeries) return
  const klines = w.S.klines
  if (!klines || klines.length < 35) return
  const closes = klines.map((k: any) => k.close)
  const fast = 12, slow = 26, signal = 9
  const emaFn = (arr: number[], p: number) => {
    const k = 2 / (p + 1); let v = arr[0]
    return arr.map((x: number, i: number) => i === 0 ? v : (v = x * k + v * (1 - k)))
  }
  const fastE = emaFn(closes, fast)
  const slowE = emaFn(closes, slow)
  const macdArr = fastE.map((v: number, i: number) => v - slowE[i]).slice(slow - 1)
  const times = klines.map((k: any) => k.time).slice(slow - 1)
  const sigArr = emaFn(macdArr, signal)
  const histArr = macdArr.map((v: number, i: number) => v - sigArr[i])
  const macdData = times.map((t: number, i: number) => ({ time: t, value: macdArr[i] })).filter((d: any) => Number.isFinite(d.value))
  const sigData = times.map((t: number, i: number) => ({ time: t, value: sigArr[i] })).filter((d: any) => Number.isFinite(d.value))
  const histData = times.map((t: number, i: number) => ({
    time: t, value: histArr[i],
    color: histArr[i] >= 0 ? (histArr[i] >= (histArr[i - 1] || 0) ? '#00d97a' : '#00d97a66') : (histArr[i] <= (histArr[i - 1] || 0) ? '#ff3355' : '#ff335566')
  })).filter((d: any) => Number.isFinite(d.value))
  try {
    w._macdLineSeries.setData(macdData)
    w._macdSigSeries.setData(sigData)
    w._macdHistSeries.setData(histData)
    if (w.mainChart && w._macdChart) {
      const tr = w.mainChart.timeScale().getVisibleRange()
      if (tr) w._macdChart.timeScale().setVisibleRange(tr)
    }
  } catch (e) { console.warn('[MACD]', e) }
}

export function _macdKlineHook(): void {
  if (w._macdInited && w._macdChart) _updateMACDChart()
}

// ═══════════════════════════════════════════════════════════════
// SUPERTREND FLIP + RSI DIVERGENCE DETECTORS
// ═══════════════════════════════════════════════════════════════

export function detectSupertrendFlip(bars: any[]): string | null {
  if (!bars || bars.length < 2) return null
  const last = bars[bars.length - 1]
  const prev = bars[bars.length - 2]
  if (!last || !prev) return null
  const lClose = last.close, pClose = prev.close
  const _stBars = bars.slice(-20)
  const atr14 = (typeof _calcATRSeries === 'function' ? _calcATRSeries(_stBars, 14, 'wilder').last : null) || (last.high - last.low)
  const mult = 3
  const upperBand = ((last.high + last.low) / 2) + mult * atr14
  const lowerBand = ((last.high + last.low) / 2) - mult * atr14
  if (lClose > upperBand && pClose < upperBand) return 'bull'
  if (lClose < lowerBand && pClose > lowerBand) return 'bear'
  return null
}

export function detectRSIDivergence(closes: number[], rsiVal: number): string | null {
  if (!closes || closes.length < 20 || !rsiVal) return null
  const slice = closes.slice(-20)
  const minP = Math.min(...slice), maxP = Math.max(...slice)
  const midP = (minP + maxP) / 2
  const lastP = closes[closes.length - 1]
  if (lastP < midP && rsiVal > 45 && rsiVal < 60) return 'bull_div'
  if (lastP > midP && rsiVal < 55 && rsiVal > 40) return 'bear_div'
  return null
}

// ═══════════════════════════════════════════════════════════════
// SIGNAL SCANNER ENGINE
// ═══════════════════════════════════════════════════════════════

export function runSignalScan(): void {
  const bars = w.S.chartBars || []
  if (bars.length < 30) return
  const closes = bars.map((b: any) => b.close)
  const rsiNow = w.S.rsiData?.['5m'] || parseFloat(document.getElementById('rn')?.textContent || '50') || 50
  const rsi1h = w.S.rsiData?.['1h'] || 60
  const rsi4h = w.S.rsiData?.['4h'] || 60
  const price = w.S.price || 0

  const macdRes = calcMACD(closes)
  const stFlip = detectSupertrendFlip(bars)
  const rsiDiv = detectRSIDivergence(closes, rsiNow)

  const signals: any[] = []
  let bullCount = 0, bearCount = 0

  if (macdRes) {
    const cross = macdRes.macd > macdRes.signal && macdRes.prevMacd <= macdRes.prevSignal
    const dcross = macdRes.macd < macdRes.signal && macdRes.prevMacd >= macdRes.prevSignal
    if (cross) { signals.push({ name: 'MACD Crossover', det: `MACD: ${macdRes.macd.toFixed(2)} | Signal: ${macdRes.signal.toFixed(2)}`, dir: 'bull', str: 'BULLISH' }); bullCount++ }
    if (dcross) { signals.push({ name: 'MACD Crossunder', det: `MACD: ${macdRes.macd.toFixed(2)} | Signal: ${macdRes.signal.toFixed(2)}`, dir: 'bear', str: 'BEARISH' }); bearCount++ }
    if (macdRes.hist > 0 && macdRes.prevHist < macdRes.hist) { signals.push({ name: 'MACD Histogram +', det: `Histograma: +${macdRes.hist.toFixed(2)}`, dir: 'bull', str: 'BULLISH' }); bullCount++ }
    if (macdRes.hist < 0 && macdRes.prevHist > macdRes.hist) { signals.push({ name: 'MACD Histogram \u2212', det: `Histograma: ${macdRes.hist.toFixed(2)}`, dir: 'bear', str: 'BEARISH' }); bearCount++ }
  }

  if (rsiNow < 30) { signals.push({ name: 'RSI Supravanzut (5m)', det: `RSI: ${rsiNow.toFixed(1)} < 30`, dir: 'bull', str: 'STRONG BULL' }); bullCount += 2 }
  if (rsiNow > 70) { signals.push({ name: 'RSI Supracumparat (5m)', det: `RSI: ${rsiNow.toFixed(1)} > 70`, dir: 'bear', str: 'STRONG BEAR' }); bearCount += 2 }
  if (rsiDiv === 'bull_div') { signals.push({ name: 'RSI Divergenta Bullish', det: `Pret jos + RSI mai sus`, dir: 'bull', str: 'BULLISH' }); bullCount++ }
  if (rsiDiv === 'bear_div') { signals.push({ name: 'RSI Divergenta Bearish', det: `Pret sus + RSI mai jos`, dir: 'bear', str: 'BEARISH' }); bearCount++ }

  if (stFlip === 'bull') { signals.push({ name: 'Supertrend Flip \u2191', det: `Schimbare de trend BULLISH`, dir: 'bull', str: 'STRONG BULL' }); bullCount += 2 }
  if (stFlip === 'bear') { signals.push({ name: 'Supertrend Flip \u2193', det: `Schimbare de trend BEARISH`, dir: 'bear', str: 'STRONG BEAR' }); bearCount += 2 }

  if (rsiNow > 55 && rsi1h > 55 && rsi4h > 55) { signals.push({ name: 'RSI Aliniat Bullish MTF', det: `5m:${rsiNow.toFixed(0)} 1h:${rsi1h.toFixed(0)} 4h:${rsi4h.toFixed(0)}`, dir: 'bull', str: 'BULLISH' }); bullCount++ }
  if (rsiNow < 45 && rsi1h < 45 && rsi4h < 45) { signals.push({ name: 'RSI Aliniat Bearish MTF', det: `5m:${rsiNow.toFixed(0)} 1h:${rsi1h.toFixed(0)} 4h:${rsi4h.toFixed(0)}`, dir: 'bear', str: 'BEARISH' }); bearCount++ }

  const sma20 = closes.slice(-20).reduce((a: number, b: number) => a + b, 0) / 20
  const sma50 = closes.slice(-50).reduce((a: number, b: number) => a + b, 0) / 50
  if (price > sma20 && sma20 > sma50) { signals.push({ name: 'Trend Bullish (SMA)', det: `Pret>${sma20.toFixed(0)} > SMA50:${sma50.toFixed(0)}`, dir: 'bull', str: 'BULLISH' }); bullCount++ }
  if (price < sma20 && sma20 < sma50) { signals.push({ name: 'Trend Bearish (SMA)', det: `Pret<${sma20.toFixed(0)} < SMA50:${sma50.toFixed(0)}`, dir: 'bear', str: 'BEARISH' }); bearCount++ }

  w.S.signalData = { signals, bullCount, bearCount }
  if (typeof renderSignals === 'function') renderSignals(signals, bullCount, bearCount)
  if (typeof updateDeepDive === 'function') updateDeepDive()

  if ((bullCount >= 3 || bearCount >= 3) && w.S.alerts?.enabled) {
    if (typeof playAlertSound === 'function') playAlertSound()
    if (bullCount >= 3 && typeof sendAlert === 'function') sendAlert('SEMNAL STRONG BULL', '3+ indicatori aliniati bullish', 'scan')
    if (bearCount >= 3 && typeof sendAlert === 'function') sendAlert('SEMNAL STRONG BEAR', '3+ indicatori aliniati bearish', 'scan')
  }

  signals.filter((s: any) => s.str.includes('STRONG')).forEach((s: any) => {
    if (typeof w.srRecord === 'function') w.srRecord('scan', s.name, s.dir === 'bull' ? 'LONG' : 'SHORT', s.str)
  })
  if (bullCount >= 3 && typeof w.srRecord === 'function') w.srRecord('scan', 'Scan STRONG BULL \u00D7' + bullCount, 'LONG', bullCount * 20)
  if (bearCount >= 3 && typeof w.srRecord === 'function') w.srRecord('scan', 'Scan STRONG BEAR \u00D7' + bearCount, 'SHORT', bearCount * 20)
}

// ═══════════════════════════════════════════════════════════════
// DEEP DIVE — Narrative Context Generator (READ-ONLY)
// ═══════════════════════════════════════════════════════════════

let _ddTimer: ReturnType<typeof setTimeout> | null = null

export function generateDeepDive(): string {
  try {
    if (!w.S || !w.S.price || !w.S.klines || w.S.klines.length < 20) {
      return '<div class="dd-loading">Waiting for market data...</div>'
    }

    const price = w.S.price
    const closes = w.S.klines.map((k: any) => k.close)
    const bars = w.S.chartBars || w.S.klines

    // 1. REGIME
    const regime = (w.BRAIN && w.BRAIN.regime) || 'unknown'
    const regConf = (w.BRAIN && w.BRAIN.regimeConfidence) || 0
    const regAtrPct = (w.BRAIN && w.BRAIN.regimeAtrPct) || 0
    const regSlope = (w.BRAIN && w.BRAIN.regimeSlope) || 0

    const regLabels: Record<string, string> = { trend: regSlope > 0 ? 'UPTREND' : 'DOWNTREND', range: 'RANGING', volatile: 'VOLATILE', breakout: 'BREAKOUT', unknown: 'SCANNING' }
    const regBadge: Record<string, string> = { trend: regSlope > 0 ? 'trend' : 'trend-dn', range: 'range', volatile: 'volatile', breakout: 'breakout', unknown: 'neut' }
    const regLabel = regLabels[regime] || regime.toUpperCase()
    const regCls = regBadge[regime] || 'neut'
    const confStr = regConf > 0 ? ` <span class="dd-hl-dim">(conf ${regConf}%)</span>` : ''
    const atrStr = regAtrPct > 0 ? ` \u00B7 ATR <span class="dd-hl-neut">${regAtrPct.toFixed(2)}%</span>` : ''

    const secRegime = `<div class="dd-section"><div class="dd-title">${_ZI.chart} REGIME</div><div class="dd-body"><span class="dd-badge ${regCls}">${regLabel}</span>${confStr}${atrStr}</div></div>`

    // 2. LIQUIDITY
    let secLiq = ''
    try {
      const magnets = (w.S.magnets) || { above: [], below: [] }
      const nearAbove = magnets.above && magnets.above[0]
      const nearBelow = magnets.below && magnets.below[0]
      const bias = (w.S.magnetBias || w.S.magnets?.bias || 'neut').toLowerCase()
      const biasCls = bias === 'bull' ? 'dd-hl-bull' : bias === 'bear' ? 'dd-hl-bear' : 'dd-hl-neut'
      const biasLbl = bias === 'bull' ? 'BULLISH PULL' : bias === 'bear' ? 'BEARISH PULL' : 'NEUTRAL'
      let aboveStr = '\u2014', belowStr = '\u2014'
      if (nearAbove && nearAbove.price) {
        const distA = ((nearAbove.price - price) / price * 100).toFixed(2)
        const volA = nearAbove.usd > 0 ? ` \u00B7 $${fmt(nearAbove.usd)}` : ''
        aboveStr = `<span class="dd-hl-bear">$${fP(nearAbove.price)}</span> <span class="dd-hl-dim">(+${distA}%${volA})</span>`
      }
      if (nearBelow && nearBelow.price) {
        const distB = ((price - nearBelow.price) / price * 100).toFixed(2)
        const volB = nearBelow.usd > 0 ? ` \u00B7 $${fmt(nearBelow.usd)}` : ''
        belowStr = `<span class="dd-hl-bull">$${fP(nearBelow.price)}</span> <span class="dd-hl-dim">(-${distB}%${volB})</span>`
      }
      secLiq = `<div class="dd-section"><div class="dd-title">${_ZI.mag} LIQUIDITY</div><div class="dd-body">Bias: <span class="${biasCls}">${biasLbl}</span><br>Nearest above: ${aboveStr}<br>Nearest below: ${belowStr}</div></div>`
    } catch (_) {
      secLiq = `<div class="dd-section"><div class="dd-title">${_ZI.mag} LIQUIDITY</div><div class="dd-body"><span class="dd-hl-dim">Scanning magnets...</span></div></div>`
    }

    // 3. INDICATORS
    let secInd = ''
    try {
      const rsi5m = w._safe.rsi(w.S.rsiData?.['5m'] || w.S.rsi?.['5m'])
      const rsi1h = w._safe.rsi(w.S.rsiData?.['1h'] || w.S.rsi?.['1h'] || 50)
      const rsi4h = w._safe.rsi(w.S.rsiData?.['4h'] || w.S.rsi?.['4h'] || 50)
      const rsiCls = (v: number) => v >= 70 ? 'dd-hl-bear' : v <= 30 ? 'dd-hl-bull' : 'dd-hl-neut'
      const rsiLbl = (v: number) => v >= 70 ? 'overbought' : v <= 30 ? 'oversold' : 'neutral'

      let macdStr = '\u2014'
      try {
        const macdR = calcMACD(closes)
        if (macdR) {
          const macdDir = macdR.hist > 0 ? '<span class="dd-hl-bull">\u25B2 BULL</span>' : '<span class="dd-hl-bear">\u25BC BEAR</span>'
          macdStr = `${macdDir} <span class="dd-hl-dim">(hist ${macdR.hist > 0 ? '+' : ''}${macdR.hist.toFixed(1)})</span>`
        }
      } catch (_) { }

      let stStr = '\u2014'
      try {
        const stFlipV = detectSupertrendFlip(bars)
        const sigSt = w.S.signalData?.signals?.find((sg: any) => sg.name.includes('Supertrend'))
        const stDir = sigSt ? sigSt.dir : (stFlipV === 'bull' ? 'bull' : stFlipV === 'bear' ? 'bear' : null)
        if (stDir === 'bull') stStr = '<span class="dd-hl-bull">\u25B2 BULL</span>'
        else if (stDir === 'bear') stStr = '<span class="dd-hl-bear">\u25BC BEAR</span>'
        else stStr = '<span class="dd-hl-neut">\u2014</span>'
      } catch (_) { }

      let frStr = '\u2014'
      if (w.S.fr !== null && w.S.fr !== undefined) {
        const frPct = (w.S.fr * 100).toFixed(4)
        const frCls = w.S.fr > 0.0001 ? 'dd-hl-bear' : w.S.fr < -0.0001 ? 'dd-hl-bull' : 'dd-hl-neut'
        const frLbl = w.S.fr > 0.0001 ? 'longs pay' : w.S.fr < -0.0001 ? 'shorts pay' : 'neutral'
        frStr = `<span class="${frCls}">${frPct}%</span> <span class="dd-hl-dim">(${frLbl})</span>`
      }

      let oiStr = '\u2014'
      if (w.S.oi && w.S.oiPrev && w.S.oiPrev > 0) {
        const oiChg = ((w.S.oi - w.S.oiPrev) / w.S.oiPrev * 100)
        const oiCls = oiChg > 0 ? 'dd-hl-bull' : 'dd-hl-bear'
        oiStr = `<span class="${oiCls}">${oiChg > 0 ? '+' : ''}${oiChg.toFixed(2)}%</span>`
      }

      const ofi = w.BRAIN?.ofi?.blendBuy || 50
      const ofiCls = ofi > 55 ? 'dd-hl-bull' : ofi < 45 ? 'dd-hl-bear' : 'dd-hl-neut'
      const ofiStr = `<span class="${ofiCls}">${ofi.toFixed(0)}% buy</span>`

      secInd = `<div class="dd-section"><div class="dd-title">${_ZI.ruler} INDICATORS</div><div class="dd-body">RSI 5m: <span class="${rsiCls(rsi5m)}">${rsi5m.toFixed(0)}</span> <span class="dd-hl-dim">(${rsiLbl(rsi5m)})</span> \u00B7 1h: <span class="${rsiCls(rsi1h)}">${rsi1h.toFixed(0)}</span> \u00B7 4h: <span class="${rsiCls(rsi4h)}">${rsi4h.toFixed(0)}</span><br>MACD: ${macdStr} \u00B7 ST: ${stStr}<br>Funding: ${frStr} \u00B7 OI \u0394: ${oiStr}<br>Order Flow: ${ofiStr}</div></div>`
    } catch (_) {
      secInd = `<div class="dd-section"><div class="dd-title">${_ZI.ruler} INDICATORS</div><div class="dd-body"><span class="dd-hl-dim">Calculating...</span></div></div>`
    }

    // 4. CONCLUSION
    let secConc = ''
    try {
      const bullC = w.S.signalData?.bullCount || 0
      const bearC = w.S.signalData?.bearCount || 0
      const ofi = w.BRAIN?.ofi?.blendBuy || 50
      const rsi5m = w._safe.rsi(w.S.rsiData?.['5m'] || w.S.rsi?.['5m'])
      const mBias = (w.S.magnetBias || w.S.magnets?.bias || 'neut').toLowerCase()

      let verdict = '', verdictCls = 'neut'
      const bullScore = bullC + (ofi > 55 ? 1 : 0) + (rsi5m > 55 ? 1 : 0) + (mBias === 'bull' ? 1 : 0) + (regime === 'trend' && regSlope > 0 ? 2 : 0)
      const bearScore = bearC + (ofi < 45 ? 1 : 0) + (rsi5m < 45 ? 1 : 0) + (mBias === 'bear' ? 1 : 0) + (regime === 'trend' && regSlope < 0 ? 2 : 0)

      if (regime === 'volatile') { verdict = 'Highly volatile conditions \u2014 avoid new entries until regime stabilizes.'; verdictCls = 'dd-hl-neut' }
      else if (bullScore > bearScore + 2) {
        const nearRes = w.S.magnets?.above?.[0]
        const resWarn = nearRes ? ` Price approaching resistance at $${fP(nearRes.price)} \u2014 wait for retest.` : ''
        verdict = `Bullish bias with ${bullC} aligned signal(s).${resWarn}`; verdictCls = 'dd-hl-bull'
      } else if (bearScore > bullScore + 2) {
        const nearSup = w.S.magnets?.below?.[0]
        const supWarn = nearSup ? ` Watch support at $${fP(nearSup.price)}.` : ''
        verdict = `Bearish pressure with ${bearC} aligned signal(s).${supWarn}`; verdictCls = 'dd-hl-bear'
      } else if (regime === 'range') { verdict = `Market ranging with no clear directional edge. Wait for breakout confirmation.`; verdictCls = 'dd-hl-neut' }
      else { verdict = `Mixed signals \u2014 no strong directional conviction. Neutral stance advised.`; verdictCls = 'dd-hl-neut' }

      secConc = `<div class="dd-section"><div class="dd-title">${_ZI.brain} CONCLUSION</div><div class="dd-body"><span class="${verdictCls}">${verdict}</span></div></div>`
    } catch (_) {
      secConc = `<div class="dd-section"><div class="dd-title">${_ZI.brain} CONCLUSION</div><div class="dd-body"><span class="dd-hl-dim">Analyzing...</span></div></div>`
    }

    // 5. INVALIDATION
    let secInval = ''
    try {
      const nearBelow = w.S.magnets?.below?.[0]
      const nearAbove = w.S.magnets?.above?.[0]
      const bullC = w.S.signalData?.bullCount || 0
      const bearC = w.S.signalData?.bearCount || 0
      const ofi = w.BRAIN?.ofi?.blendBuy || 50
      const isBull = (bullC > bearC) || (ofi > 55)

      let invalStr = ''
      if (isBull && nearBelow && nearBelow.price) invalStr = `Daily close below <span class="dd-hl-bear">$${fP(nearBelow.price)}</span> invalidates bullish scenario.`
      else if (!isBull && nearAbove && nearAbove.price) invalStr = `Reclaim above <span class="dd-hl-bull">$${fP(nearAbove.price)}</span> would invalidate bearish scenario.`
      else if (regime === 'volatile') invalStr = `Volatility cool-down below ATR <span class="dd-hl-neut">${(regAtrPct * 0.5).toFixed(2)}%</span> needed for trend confirmation.`
      else invalStr = `Regime shift or sudden OFI reversal would invalidate current read.`

      secInval = `<div class="dd-section"><div class="dd-title">${_ZI.w} INVALIDATION</div><div class="dd-body">${invalStr}</div></div>`
    } catch (_) {
      secInval = `<div class="dd-section"><div class="dd-title">${_ZI.w} INVALIDATION</div><div class="dd-body"><span class="dd-hl-dim">\u2014</span></div></div>`
    }

    return secRegime + secLiq + secInd + secConc + secInval
  } catch (err) {
    console.warn('[DeepDive] generateDeepDive error:', err)
    return '<div class="dd-loading">Analysis unavailable \u2014 waiting for data.</div>'
  }
}

export function updateDeepDive(): void {
  if (_ddTimer) return
  _ddTimer = setTimeout(function () {
    _ddTimer = null
    try {
      const el_c = document.getElementById('deepdive-content')
      const el_t = document.getElementById('deepdive-upd')
      if (!el_c) return
      el_c.innerHTML = generateDeepDive()
      if (el_t) el_t.textContent = 'updated ' + fmtNow()
    } catch (err) {
      console.warn('[DeepDive] updateDeepDive error:', err)
    }
  }, 500)
}
