// Zeus — data/marketDataFeeds.ts
// Ported 1:1 from public/js/data/marketData.js lines 800-1127 (Chunk D1)
// TF picker, fullscreen, price display, API fetches, metrics, RSI display, SR table

import { getTPObject } from '../services/stateAccessors'
import { fmtTime, fmtDate, calcRSI } from './marketDataHelpers'
import { fmt, fP } from '../utils/format'
import { el } from '../utils/dom'
import { _demoTick } from '../engine/aresUI'
import { clearHeatmap, clearSR } from './marketDataOverlays'
import { getChartH } from './marketDataChart'
const w = window as any // kept for w.S (producer), w.mainChart, w.cvdChart, fn calls

// ===== TIMEFRAME =====
export function setTF(tf: any, btn: any): void {
  w.S.chartTf = tf
  document.querySelectorAll('.tfb').forEach((b: any) => b.classList.remove('act'))
  if (btn) btn.classList.add('act')
  const _ztfLbl = document.getElementById('ztfLabel')
  if (_ztfLbl) _ztfLbl.textContent = tf
  const _ztfDd = document.getElementById('ztfDropdown')
  if (_ztfDd) _ztfDd.querySelectorAll('.ztf-item').forEach(function (b: any) { b.classList.toggle('act', b.textContent.trim() === tf) })
  clearHeatmap(); clearSR()
  w.FetchLock.release('klines')
  if (typeof w.fetchKlines === 'function') w.fetchKlines(tf)
  setTimeout(() => {
    const lf = { timeFormatter: (ts: any) => fmtTime(ts), dateFormatter: (ts: any) => fmtDate(ts) }
    ;[w.mainChart, w.cvdChart].forEach((ch: any) => { try { if (ch) ch.applyOptions({ localization: lf }) } catch (_) { } })
  }, 200)
  if (typeof w._usScheduleSave === 'function') w._usScheduleSave()
  setTimeout(() => { if (typeof w.updateDeepDive === 'function') w.updateDeepDive() }, 500)
}
export const setTf = setTF

export function ztfToggle(): void {
  const wr = document.getElementById('ztfWrap')
  if (!wr) return
  wr.classList.toggle('open')
}

export function ztfPick(tf: any, btn: any): void {
  const dd = document.getElementById('ztfDropdown')
  if (dd) dd.querySelectorAll('.ztf-item').forEach(function (b: any) { b.classList.remove('act') })
  if (btn) btn.classList.add('act')
  const lbl = document.getElementById('ztfLabel')
  if (lbl) lbl.textContent = tf
  const wr = document.getElementById('ztfWrap')
  if (wr) wr.classList.remove('open')
  setTF(tf, btn)
}

// Close dropdown on outside click
document.addEventListener('click', function (e: any) {
  const wr = document.getElementById('ztfWrap')
  if (wr && wr.classList.contains('open') && !wr.contains(e.target)) { wr.classList.remove('open') }
})

// Sync dropdown label on load
;(function _ztfSyncOnLoad() {
  if (typeof w.S !== 'undefined' && w.S && w.S.chartTf) {
    const lbl = document.getElementById('ztfLabel')
    if (lbl) lbl.textContent = w.S.chartTf
    const dd = document.getElementById('ztfDropdown')
    if (dd) { dd.querySelectorAll('.ztf-item').forEach(function (b: any) { b.classList.toggle('act', b.textContent.trim() === w.S.chartTf) }) }
  }
})()

// ===== FULLSCREEN =====
export function toggleFS(): void {
  const sec = el('csec'); const btn = el('fsbtn') || el('fsBtn')
  if (!sec) return
  const isFull = sec.classList.toggle('fsm')
  if (btn) btn.textContent = isFull ? '\u2291' : '\u229E'
  const cc = el('cc')
  if (isFull) {
    const h = window.innerHeight - 100
    if (w.mainChart) w.mainChart.applyOptions({ height: h })
    if (cc) cc.style.display = 'none'
  } else {
    if (w.mainChart) w.mainChart.applyOptions({ height: getChartH() })
    if (w.cvdChart) w.cvdChart.applyOptions({ height: 60 })
    if (cc) cc.style.display = (w.S.activeInds && w.S.activeInds.cvd) ? '' : 'none'
  }
}

// ===== PRICE UPDATE =====
export function updatePriceDisplay(): void {
  if (document.hidden) return
  const e = el('bprice'); if (e) e.textContent = '$' + fP(w.S.price)
  const c = (w.S.price - w.S.prevPrice) / w.S.prevPrice * 100
  const bc = el('bchg')
  if (bc) { bc.className = 'bchg ' + (c >= 0 ? 'up' : 'dn'); bc.textContent = (c >= 0 ? '\u25B2 ' : '\u25BC ') + Math.abs(c).toFixed(2) + '%' }
  if (typeof w.calcSRTable === 'function') w.calcSRTable()
  if (typeof w.updateMetrics === 'function') w.updateMetrics()
  const _tp = getTPObject()
  if (_tp?.demoOpen) w.updateDemoLiqPrice()
  if (_tp?.liveOpen) w.updateLiveLiqPrice()
  if (typeof _demoTick === 'function') _demoTick()
}

// ===== FUNDING COUNTDOWN =====
export function calcFrCd(): string {
  if (w.S.frCd === null) return '\u2014'
  const now = new Date()
  const h = now.getUTCHours(), m = now.getUTCMinutes(), s = now.getUTCSeconds()
  const nextH = Math.ceil((h + 1) / 8) * 8 % 24
  const diff = (nextH * 3600) - (h * 3600 + m * 60 + s)
  const d = diff < 0 ? diff + 86400 : diff
  return Math.floor(d / 3600).toString().padStart(2, '0') + ':' + Math.floor((d % 3600) / 60).toString().padStart(2, '0') + ':' + Math.floor(d % 60).toString().padStart(2, '0')
}

// ===== SAFE FETCH WRAPPER =====
export async function safeFetch(url: string, options: any = {}, timeout = 8000, retries = 2): Promise<any> {
  for (let i = 0; i <= retries; i++) {
    try {
      const controller = new AbortController()
      const id = setTimeout(() => controller.abort(), timeout)
      const response = await fetch(url, { ...options, signal: controller.signal })
      clearTimeout(id)
      if (!response.ok) throw new Error('HTTP ' + response.status)
      return await response.json()
    } catch (err: any) {
      if (i === retries) { console.error('[safeFetch] failed after retries:', url, err.message); throw err }
      await new Promise(r => setTimeout(r, 300 * (i + 1)))
    }
  }
}

// ===== THROTTLED UI UPDATE =====
let _lastMainMetricsUpdate = 0
export function throttledMainMetrics(): void {
  const now = Date.now()
  if (now - _lastMainMetricsUpdate < 500) return
  _lastMainMetricsUpdate = now
  if (typeof w.updateMainMetrics === 'function') w.updateMainMetrics()
}

// ===== API FETCHES =====
export async function fetchRSI(tf: string): Promise<void> {
  try {
    const sym = w.S.symbol || 'BTCUSDT'
    const map: any = { '5m': '5m', '15m': '15m', '1h': '1h', '3h': '4h', '4h': '4h', '1d': '1d' }
    const itf = map[tf] || tf
    const d = await safeFetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${itf}&limit=50`)
    if (!Array.isArray(d)) throw new Error('R\u0103spuns invalid RSI')
    const closes = d.map((k: any) => +k[4])
    const rsi = calcRSI(closes)
    w.S.rsi[tf] = rsi
    if (!w.S.rsiData) w.S.rsiData = {}
    w.S.rsiData[tf] = rsi
    renderRSI()
    if (rsi !== null) checkRSIAlerts(rsi, tf)
  } catch (e: any) { console.warn('[fetchRSI]', tf, e.message) }
}

export async function fetchAllRSI(): Promise<void> {
  const now = new Date()
  const upd = el('rsiupd'); if (upd) upd.textContent = 'UPD ' + now.toLocaleTimeString('ro-RO', { timeZone: w.S.tz || 'Europe/Bucharest' })
  await Promise.all(['5m', '15m', '1h', '3h', '4h', '1d'].map(fetchRSI))
}

export async function fetchFG(): Promise<void> {
  try {
    const d = await safeFetch('/api/fng')
    if (!d.data || !d.data[0]) throw new Error('Date Fear&Greed invalide')
    const val = +d.data[0].value, cls = d.data[0].value_classification
    const colors: any = { 'Fear': '#ff8800', 'Extreme Fear': '#ff3355', 'Greed': '#00cc77', 'Extreme Greed': '#00ff99', 'Neutral': '#7a9ab8' }
    const col = colors[cls] || '#7a9ab8'
    const ev = el('fgval'); if (ev) { ev.textContent = val; ev.style.color = col }
    const el2 = el('fglbl'); if (el2) { el2.textContent = cls.toUpperCase(); el2.style.color = col }
    const efg = el('fgf'); if (efg) { efg.style.width = val + '%'; efg.style.background = col }
    const ech = el('fgch'); if (ech) ech.textContent = 'Yesterday: ' + (d.data[1] ? +d.data[1].value : '\u2014') + ' | Week: \u2014'
    const arc = el('fgarc')
    if (arc) { const circ = 175.93; const offset = circ - (val / 100) * circ; arc.style.strokeDashoffset = offset; arc.style.stroke = col }
  } catch (e: any) { console.warn('[fetchFG]', e.message) }
}

export async function fetchATR(): Promise<void> {
  try {
    const sym = w.S.symbol || 'BTCUSDT'
    const d = await safeFetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=1h&limit=32`)
    if (!Array.isArray(d) || d.length < 16) throw new Error('Date ATR insuficiente')
    const klinesForATR = d.map((k: any) => ({ high: +k[2], low: +k[3], close: +k[4] }))
    const atrRes = w._calcATRSeries(klinesForATR, 14, 'wilder')
    if (atrRes.last === null) throw new Error('ATR Wilder: date insuficiente dupa calcul')
    w.S.atr = atrRes.last
    w.S.atrSeries1h = atrRes.series
    if (typeof w.renderChart === 'function') w.renderChart(); throttledMainMetrics()
  } catch (e: any) { console.warn('[fetchATR]', e.message) }
}

export async function fetchOI(): Promise<void> {
  try {
    const sym = w.S.symbol || 'BTCUSDT'
    const d = await safeFetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${sym}`)
    if (!d.openInterest) throw new Error('Date OI invalide')
    w.S.oiPrev = w.S.oi; w.S.oi = +d.openInterest * (w.S.price || 1)
    w.S.oiTs = Date.now()
    if (typeof w.updateMetrics === 'function') w.updateMetrics(); throttledMainMetrics()
  } catch (e: any) { console.warn('[fetchOI]', e.message) }
}

export async function fetchLS(): Promise<void> {
  try {
    const sym = w.S.symbol || 'BTCUSDT'
    const d = await safeFetch(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${sym}&period=5m&limit=1`)
    if (Array.isArray(d) && d[0]) { w.S.ls = { l: +d[0].longAccount, s: +d[0].shortAccount }; if (typeof w.updateMetrics === 'function') w.updateMetrics(); if (typeof w.updateMainMetrics === 'function') w.updateMainMetrics() }
  } catch (e: any) { console.warn('[fetchLS]', e.message) }
}

export async function fetch24h(): Promise<void> {
  try {
    const sym = w.S.symbol || 'BTCUSDT'
    const d = await safeFetch(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${sym}`)
    if (!d.highPrice) throw new Error('Date 24h invalide')
    w.S.high = +d.highPrice; w.S.low = +d.lowPrice
    const h = el('d24h'); const l = el('d24l')
    if (h) h.textContent = 'H: $' + fP(w.S.high)
    if (l) l.textContent = 'L: $' + fP(w.S.low)
  } catch (e: any) { console.warn('[fetch24h]', e.message) }
}

// ===== METRICS TABLE =====
export function setDtTf(tf: any, btn: any): void {
  w.S.dtTf = tf
  document.querySelectorAll('.dtt').forEach((b: any) => b.classList.remove('act'))
  if (btn) btn.classList.add('act')
  updateMetrics()
}

export function updateMetrics(): void {
  const dtp = el('dtp'), dtpc = el('dtpc'), dtps = el('dtps')
  if (dtp) dtp.textContent = w.S.price ? '$' + fP(w.S.price) : '\u2014'
  if (dtpc) { const c = w.S.prevPrice ? ((w.S.price - w.S.prevPrice) / w.S.prevPrice * 100).toFixed(2) + '%' : '\u2014'; dtpc.textContent = c; dtpc.style.color = w.S.price >= w.S.prevPrice ? 'var(--grn)' : 'var(--red)' }
  if (dtps) { dtps.textContent = w.S.price > w.S.prevPrice ? 'BULL' : 'BEAR'; dtps.style.color = w.S.price > w.S.prevPrice ? 'var(--grn)' : 'var(--red)' }
  const dtoi = el('dtoi'), dtoic = el('dtoic'), dtois = el('dtois')
  if (dtoi) dtoi.textContent = w.S.oi ? '$' + fmt(w.S.oi) : '\u2014'
  if (dtoic) dtoic.textContent = w.S.oiPrev && w.S.oi ? (((w.S.oi - w.S.oiPrev) / w.S.oiPrev) * 100).toFixed(2) + '%' : '\u2014'
  if (dtois) { const s = w.S.oi > w.S.oiPrev ? 'RISING' : 'FALLING'; dtois.textContent = s; dtois.style.color = s === 'RISING' ? 'var(--grn)' : 'var(--red)' }
  const dtfr = el('dtfr'), dtfrc = el('dtfrc'), dtfrs = el('dtfrs')
  if (dtfr) dtfr.textContent = w.S.fr !== null && w.S.fr !== undefined ? (w.S.fr * 100).toFixed(4) + '%' : '\u2014'
  if (dtfrc) dtfrc.textContent = calcFrCd()
  if (dtfrs) { const s = w.S.fr > 0 ? 'LONGS PAY' : w.S.fr < 0 ? 'SHORTS PAY' : 'NEUTRAL'; dtfrs.textContent = s; dtfrs.style.color = w.S.fr > 0 ? 'var(--red)' : w.S.fr < 0 ? 'var(--grn)' : 'var(--dim)' }
  const dtls = el('dtls'), dtlsc = el('dtlsc'), dtlss = el('dtlss')
  if (dtls) dtls.textContent = w.S.ls ? w.S.ls.l.toFixed(1) + '% / ' + w.S.ls.s.toFixed(1) + '%' : '\u2014'
  if (dtlsc) dtlsc.textContent = '\u2014'
  if (dtlss) { const s = w.S.ls ? (w.S.ls.l > 55 ? 'LONG HEAVY' : w.S.ls.s > 55 ? 'SHORT HEAVY' : 'BALANCED') : '\u2014'; if (dtlss) dtlss.textContent = s; if (dtlss) dtlss.style.color = s === 'LONG HEAVY' ? 'var(--grn)' : s === 'SHORT HEAVY' ? 'var(--red)' : 'var(--dim)' }
  const dtrsi = el('dtrsi'), dtrsic = el('dtrsic'), dtrsis = el('dtrsis')
  const rsi5 = w.S.rsi['5m'], rsi1h = w.S.rsi['1h']
  if (dtrsi) dtrsi.textContent = rsi5 ? rsi5.toFixed(1) : '\u2014'
  if (dtrsic) dtrsic.textContent = rsi1h ? rsi1h.toFixed(1) : '\u2014'
  if (dtrsis) { const s = rsi5 > 70 ? 'OVERBOUGHT' : rsi5 < 30 ? 'OVERSOLD' : 'NEUTRAL'; dtrsis.textContent = s; dtrsis.style.color = rsi5 > 70 ? 'var(--red)' : rsi5 < 30 ? 'var(--grn)' : 'var(--dim)' }
}

// ===== RSI DISPLAY =====
export function renderRSI(): void {
  const map = [
    { eid: 'rn', bid: 'rb0', tf: '5m' }, { eid: 'r15', bid: 'rb1', tf: '15m' },
    { eid: 'r1h', bid: 'rb2', tf: '1h' }, { eid: 'r3h', bid: 'rb3', tf: '3h' },
    { eid: 'r4h', bid: 'rb4', tf: '4h' }, { eid: 'r1d', bid: 'rb5', tf: '1d' },
  ]
  map.forEach(({ eid, bid, tf }) => {
    const e = el(eid); if (!e) return
    const v = w.S.rsi[tf]
    if (v === null || v === undefined) { e.textContent = '\u2014'; e.className = 'rsiv mid'; return }
    e.textContent = v.toFixed(2)
    e.className = 'rsiv ' + (v > 70 ? 'ob' : v < 30 ? 'os' : 'mid')
    const bar = el(bid)
    const col = v > 70 ? '#ff3355' : v < 30 ? '#00d97a' : '#7a9ab8'
    if (bar) { bar.style.width = Math.max(5, Math.min(100, v)) + '%'; bar.style.background = col }
  })
}

// ===== SR TABLE =====
export function calcSRTable(): void {
  const p = w.S.price; if (!p) return
  const atr = w.S.atr || p * 0.01
  const levels = [
    { pid: 'sr3', did: 'sd3', v: p + atr * 3 }, { pid: 'sr2', did: 'sd2', v: p + atr * 2 },
    { pid: 'sr1', did: 'sd1', v: p + atr }, { pid: 'srdt', did: 'sddt', v: p + atr * 0.5 },
    { pid: 'srnow', did: null, v: p }, { pid: 'srdb', did: 'sddb', v: p - atr * 0.5 },
    { pid: 'ss1', did: 'sds1', v: p - atr }, { pid: 'ss2', did: 'sds2', v: p - atr * 2 },
    { pid: 'ss3', did: 'sds3', v: p - atr * 3 }, { pid: 'szh', did: 'sdh', v: p + atr * 4 },
    { pid: 'szl', did: 'sdl', v: p - atr * 4 },
  ]
  levels.forEach((lv: any) => {
    const ev = el(lv.pid), ed = lv.did ? el(lv.did) : null
    if (ev) ev.textContent = '$' + fP(lv.v)
    if (ed) { const d = ((lv.v - p) / p * 100); ed.textContent = (d >= 0 ? '+' : '') + d.toFixed(2) + '%'; ed.style.color = d > 0 ? 'var(--grn)' : 'var(--red)' }
  })
}

// ===== RSI ALERT CHECK =====
function checkRSIAlerts(rsi: number, tf: string): void {
  if (!w.S.alerts.rsiAlerts) return
  const key = 'rsi_' + tf
  if (!checkRSIAlerts._last) checkRSIAlerts._last = {} as any
  if ((checkRSIAlerts as any)._last[key] && Date.now() - (checkRSIAlerts as any)._last[key] < 300000) return
  if (rsi > 70) { (checkRSIAlerts as any)._last[key] = Date.now(); if (typeof w.sendAlert === 'function') w.sendAlert('RSI OVERBOUGHT', `${tf} RSI: ${rsi.toFixed(1)}`, 'rsi') }
  if (rsi < 30) { (checkRSIAlerts as any)._last[key] = Date.now(); if (typeof w.sendAlert === 'function') w.sendAlert('RSI OVERSOLD', `${tf} RSI: ${rsi.toFixed(1)}`, 'rsi') }
}
(checkRSIAlerts as any)._last = {}
