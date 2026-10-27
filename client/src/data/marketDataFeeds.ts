// Zeus — data/marketDataFeeds.ts
// Ported 1:1 from public/js/data/marketData.js lines 800-1127 (Chunk D1)
// TF picker, fullscreen, price display, API fetches, metrics, RSI display, SR table

import { getTPObject } from '../services/stateAccessors'
import { fmtTime, fmtDate, calcRSI, _calcATRSeries } from './marketDataHelpers'
import { fmt, fP } from '../utils/format'
import { el } from '../utils/dom'
import { _demoTick } from '../engine/aresUI'
import { clearHeatmap, clearSR } from './marketDataOverlays'
import { resetBackfill } from './chartBackfill'
import { getChartH } from './marketDataChart'
import {
  FS_CLASS, measureOccupiedHeight, resolveChartHeight, measureHostHeight,
  enterNativeFullscreen, exitNativeFullscreen, isNativeFullscreen,
} from './chartFullscreen'
import { updateMainMetrics, sendAlert } from './marketDataWS'
import { updateLiveLiqPrice } from './marketDataTrading'
import { updateDeepDive } from '../engine/indicators'
import { lsRatioToSplit, oiWindowDeltaPct, klineTfChangePct } from '../engine/fusionMath'
import { oiHistory } from '../core/state'
const w = window as any // kept for w.S (producer), w.mainChart, w.cvdChart, fn calls

// ===== TIMEFRAME =====
export function setTF(tf: any, btn: any): void {
  // [2026-10-09] A timeframe the OPERATOR picked (btn present) must never be
  // overruled by the boot restore landing later — see noteUserTfChoice in
  // settingsStore. Programmatic restores pass btn=null and do not raise it.
  if (btn) { try { (w as any).__zUserPickedTf = true } catch (_) { /* */ } }
  w.S.chartTf = tf
  try { resetBackfill() } catch (_) { }
  // [Pack D.4] Persist TF directly to localStorage so a refresh-before-
  // _usScheduleSave-fires (800ms debounce) still has the value. The
  // existing USER_SETTINGS path stays as the cross-device source of
  // truth, but localStorage is the fast-path for same-device refresh.
  try { localStorage.setItem('zeus_chart_tf', String(tf)) } catch (_) { /* */ }
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
  setTimeout(() => { if (typeof updateDeepDive === 'function') updateDeepDive() }, 500)
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
// [CHART-FS 2026-10-19] Cerut de operator: la apasarea butonului, tot panoul
// chart (toolbar, chart, legenda, TOATE panourile de indicatori aprinse) sa
// umple ecranul ca TradingView, ca si cum ar fi alta aplicatie.
//
// Ce era inainte, si de ce nu arata asa:
//   * fara API nativ de fullscreen → bara de browser rămânea pe ecran;
//   * `window.innerHeight - 100`, o constanta ghicita, fara sa scada toolbar,
//     legenda si panourile → cu indicatori aprinsi ultimele panouri erau
//     TAIATE de `overflow: hidden`;
//   * `#cc` (CVD) era ASCUNS in fullscreen, exact opusul cerintei;
//   * `_resizeCharts` dadea `getChartH()` = 400px fix, deci orice resize
//     (sau bara de browser pe Android) anula fullscreen-ul.

/** Chartul principal plus sub-chart-urile, in starea curenta (fullscreen sau nu). */
export function applyChartLayout(): void {
  const sec = el('csec')
  if (!sec) return
  const fullscreen = sec.classList.contains(FS_CLASS)
  const h = resolveChartHeight({
    fullscreen,
    viewportH: window.innerHeight,
    occupiedH: measureOccupiedHeight(sec as HTMLElement, 'mc'),
    normalH: getChartH(),
    // Cutia bate socoteala: `#mc` e `flex: 1` in fullscreen, deci browserul
    // i-a calculat deja inaltimea tinand cont de fiecare panou aprins.
    hostH: measureHostHeight(el('mc') as HTMLElement),
  })
  try { if (w.mainChart) w.mainChart.applyOptions({ height: h }) } catch (_) { /* */ }
  try { if (w.cvdChart) w.cvdChart.applyOptions({ height: 60 }) } catch (_) { /* */ }
  // Panourile de indicatori rămân exact cum le-a lasat utilizatorul. In
  // fullscreen NU ascundem nimic — ele sunt parte din „tot panoul chart".
  const cc = el('cc')
  if (cc && !fullscreen) {
    cc.style.display = (w.S && w.S.activeInds && w.S.activeInds.cvd) ? '' : 'none'
  }
  const btn = el('fsbtn') || el('fsBtn')
  if (btn) btn.textContent = fullscreen ? '\u2291' : '\u26F6'
  // React tine propriul `fsMode` pentru glifa butonului; il anuntam ca sa nu
  // rămână desincronizat cand se iese cu Esc sau F11.
  try {
    window.dispatchEvent(new CustomEvent('zeusChartFullscreen', { detail: { fullscreen } }))
  } catch (_) { /* CustomEvent lipsa in medii foarte vechi */ }
}

/**
 * ⚠️ REPARATIA PE CLASA pentru „se strange sus cand pun un indicator".
 *
 * [2026-10-27] Operatorul, cu patru capturi de pe telefon SI de pe PC. Panza
 * ramanea la 340/400px (valoarea de NEfullscreen) in timp ce `#mc` sta intins
 * pe tot ecranul — de aici golul negru. Si „nu la toti", deci declansatorul nu
 * e un indicator anume.
 *
 * CAUZA: chartul are DOI stapani pe inaltime — observatorul din
 * `TradingChart.tsx`, care-l potriveste dupa cutie, si `applyChartLayout` /
 * `_resizeCharts`, care IMPUN 340/400. Cand al doilea scrie peste, observatorul
 * nu se trezeste (s-a schimbat panza, nu cutia) si chartul rameane strans.
 *
 * De aici si „dar nu la toti": un indicator cu PANOU schimba cutia, deci
 * observatorul repara singur; unul care e doar OVERLAY (DAIMON e un sprite
 * absolut in `#mc`) nu o schimba, deci raul rameane. Si T&S repara fiindca
 * schimba cutia.
 *
 * Reparatia principala e ca ambii stapani spun acum ACELASI lucru (inaltimea
 * vine din cutie). Observatorul de aici e plasa de siguranta: daca totusi
 * rameane o cale care impune altceva, urmatoarea schimbare de cutie o corecteaza.
 *
 * Asezarea se face pe `requestAnimationFrame`, ca sa prinda DOM-ul DUPA ce
 * browserul a terminat layout-ul — exact ce facea el manual apasand T&S.
 */
let _hostRo: any = null
let _hostRaf: any = null
export function watchChartHost(): void {
  if (_hostRo) return
  const host = el('mc')
  if (!host || typeof (window as any).ResizeObserver !== 'function') return
  _hostRo = new (window as any).ResizeObserver(function () {
    if (_hostRaf) return
    _hostRaf = requestAnimationFrame(function () {
      _hostRaf = null
      // Garda de GRANITA, fara test si o spun: azi `applyChartLayout` isi
      // prinde singur fiecare aruncare, deci n-o pot declansa dintr-un test.
      // O pastrez fiindca o aruncare INTR-UN callback de ResizeObserver opreste
      // in liniste toate notificarile urmatoare — adica exact bugul ar reveni,
      // fara niciun semn.
      try { applyChartLayout() } catch (_) { /* observatorul trebuie sa traiasca */ }
    })
  })
  try { _hostRo.observe(host) } catch (_) { _hostRo = null }
}

/** Opreste observatorul — folosit de teste si la demontare. */
export function unwatchChartHost(): void {
  if (_hostRaf) { cancelAnimationFrame(_hostRaf); _hostRaf = null }
  if (_hostRo) { try { _hostRo.disconnect() } catch (_) { /* */ } _hostRo = null }
}

export function toggleFS(): void {
  const sec = el('csec')
  if (!sec) return
  const goingFull = !sec.classList.contains(FS_CLASS)
  if (goingFull) {
    sec.classList.add(FS_CLASS)
    // Fullscreen nativ — asta scoate si bara de browser. Un refuz nu rupe
    // nimic: clasa CSS acopera oricum tot viewportul paginii.
    void enterNativeFullscreen(sec as HTMLElement).then(function () { applyChartLayout() })
  } else {
    sec.classList.remove(FS_CLASS)
    void exitNativeFullscreen().then(function () { applyChartLayout() })
  }
  applyChartLayout()
}

// Iesirea din fullscreen nativ se poate face si cu Esc sau F11, fara sa treaca
// prin butonul nostru. Fara asta, clasa `fsm` rămânea pusa si panoul stătea
// peste pagina la dimensiune de ecran plin intr-o fereastra normala.
;(function _bindFullscreenChange() {
  if (typeof document === 'undefined' || !document.addEventListener) return
  // Garda de inregistrare unica: fara ea, un re-import (HMR in dezvoltare) ar
  // lega a doua oara aceiasi listeneri si Esc ar rula de doua ori.
  if ((w as any).__ZEUS_CHART_FS_BOUND__) return
  ;(w as any).__ZEUS_CHART_FS_BOUND__ = true
  const onChange = function () {
    const sec = el('csec')
    if (!sec) return
    if (!isNativeFullscreen() && sec.classList.contains(FS_CLASS)) {
      sec.classList.remove(FS_CLASS)
    }
    applyChartLayout()
  }
  for (const ev of ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange']) {
    try { document.addEventListener(ev, onChange) } catch (_) { /* */ }
  }
  // Esc cand fullscreen-ul nativ a fost refuzat (deci nu exista eveniment nativ).
  try {
    document.addEventListener('keydown', function (e: any) {
      if (e && e.key === 'Escape' && !isNativeFullscreen()) {
        const sec = el('csec')
        if (sec && sec.classList.contains(FS_CLASS)) { sec.classList.remove(FS_CLASS); applyChartLayout() }
      }
    })
  } catch (_) { /* */ }
})()

// ===== PRICE UPDATE =====
export function updatePriceDisplay(): void {
  if (document.hidden) return
  const e = el('bprice'); if (e) e.textContent = '$' + fP(w.S.price)
  const c = (w.S.price - w.S.prevPrice) / w.S.prevPrice * 100
  const bc = el('bchg')
  if (bc) { bc.className = 'bchg ' + (c >= 0 ? 'up' : 'dn'); bc.textContent = (c >= 0 ? '\u25B2 ' : '\u25BC ') + Math.abs(c).toFixed(2) + '%' }
  calcSRTable()
  updateMetrics()
  const _tp = getTPObject()
  if (_tp?.demoOpen) w.updateDemoLiqPrice()
  if (_tp?.liveOpen) updateLiveLiqPrice()
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
  updateMainMetrics()
}

// ===== API FETCHES =====
export async function fetchRSI(tf: string): Promise<void> {
  try {
    const sym = w.S.symbol || 'BTCUSDT'
    const map: any = { '5m': '5m', '15m': '15m', '1h': '1h', '3h': '4h', '4h': '4h', '1d': '1d' }
    const itf = map[tf] || tf
    const d = await safeFetch(`/api/market/klines?symbol=${sym}&interval=${itf}&limit=50`)
    if (!Array.isArray(d)) throw new Error('Invalid RSI response')
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
    // [R29] Expose on w.S so downstream engines (risk.ts macro cortex) can
    // read from canonical state instead of DOM textContent.
    w.S.fearGreed = val
    const ev = el('fgval'); if (ev) { ev.textContent = String(val); ev.style.color = col }
    const el2 = el('fglbl'); if (el2) { el2.textContent = cls.toUpperCase(); el2.style.color = col }
    const efg = el('fgf'); if (efg) { efg.style.width = val + '%'; efg.style.background = col }
    const ech = el('fgch'); if (ech) ech.textContent = 'Yesterday: ' + (d.data[1] ? +d.data[1].value : '\u2014') + ' | Week: \u2014'
    const arc = el('fgarc')
    if (arc) { const circ = 175.93; const offset = circ - (val / 100) * circ; arc.style.strokeDashoffset = String(offset); arc.style.stroke = col }
  } catch (e: any) { console.warn('[fetchFG]', e.message) }
}

export async function fetchATR(): Promise<void> {
  try {
    const sym = w.S.symbol || 'BTCUSDT'
    const d = await safeFetch(`/api/market/klines?symbol=${sym}&interval=1h&limit=32`)
    if (!Array.isArray(d) || d.length < 16) throw new Error('Date ATR insuficiente')
    const klinesForATR = d.map((k: any) => ({ high: +k[2], low: +k[3], close: +k[4] }))
    const atrRes = _calcATRSeries(klinesForATR, 14, 'wilder')
    if (atrRes.last === null) throw new Error('ATR Wilder: date insuficiente dupa calcul')
    w.S.atr = atrRes.last
    w.S.atrSeries1h = atrRes.series
    if (typeof w.renderChart === 'function') w.renderChart(); throttledMainMetrics()
  } catch (e: any) { console.warn('[fetchATR]', e.message) }
}

export async function fetchOI(): Promise<void> {
  try {
    const sym = w.S.symbol || 'BTCUSDT'
    // [T4 Gateway] Read from server cache proxy — NOT direct Binance
    const r = await fetch('/api/market/oi?symbol=' + sym, { credentials: 'include' })
    const j = await r.json()
    if (j.ok && j.data != null) {
      w.S.oiPrev = w.S.oi; w.S.oi = +j.data * (w.S.price || 1)
      w.S.oiTs = Date.now()
      updateMetrics(); throttledMainMetrics()
    }
  } catch (e: any) { console.warn('[fetchOI]', e.message) }
}

export async function fetchLS(): Promise<void> {
  try {
    const sym = w.S.symbol || 'BTCUSDT'
    // [T4 Gateway] Read from server cache proxy
    const r = await fetch('/api/market/sentiment?symbol=' + sym, { credentials: 'include' })
    const j = await r.json()
    if (j.ok && j.data && j.data.ls != null) {
      // j.data.ls is the raw global long/short ACCOUNT RATIO (R = longs/shorts).
      // Convert to long%/short% (sum 100) for the widget + confluence LS vote.
      const split = lsRatioToSplit(+j.data.ls)
      if (split) { w.S.ls = split; updateMetrics(); updateMainMetrics() }
    }
  } catch (e: any) { console.warn('[fetchLS]', e.message) }
}

export async function fetch24h(): Promise<void> {
  try {
    const sym = w.S.symbol || 'BTCUSDT'
    // [T4 Gateway] Read from server cache proxy
    const r = await fetch('/api/market/ticker?symbol=' + sym, { credentials: 'include' })
    const j = await r.json()
    if (!j.ok || !j.data) throw new Error('No cached ticker')
    const d = j.data
    w.S.high = d.highPrice || w.S.high; w.S.low = d.lowPrice || w.S.low
    const h = el('d24h'); const l = el('d24l')
    if (h) h.textContent = 'H: $' + fP(w.S.high)
    if (l) l.textContent = 'L: $' + fP(w.S.low)
  } catch (e: any) { console.warn('[fetch24h]', e.message) }
}

// ===== METRICS TABLE =====
// [2026-06-13] The 1H/4H/12H/1D/1W tabs drive the PRICE row's CHANGE/SIGNAL via
// real klines fetched at that interval (cached per interval). OI/FR/L-S/RSI stay
// live/spot — no per-timeframe history exists for them client-side.
const DT_TF_INTERVAL: Record<string, string> = { '1H': '1h', '4H': '4h', '12H': '12h', '1D': '1d', '1W': '1w' }
// [2026-06-13] RSI is computed per-tf in w.S.rsi for 1h/4h/1d only — 12H/1W have
// no series, so those tabs show "—" for RSI (honest, no fabricated value).
const DT_TF_RSI_KEY: Record<string, string> = { '1H': '1h', '4H': '4h', '1D': '1d' }
const _dtTfChange: Record<string, { pct: number | null; ts: number }> = {}
const _dtTfInflight: Record<string, boolean> = {}
const _DT_TF_TTL = 60000

async function _refreshTfChange(tf: any): Promise<void> {
  const interval = DT_TF_INTERVAL[tf]
  if (!interval) return
  const cached = _dtTfChange[interval]
  if (cached && (Date.now() - cached.ts) < _DT_TF_TTL) return   // still fresh
  if (_dtTfInflight[interval]) return                           // already fetching
  _dtTfInflight[interval] = true
  try {
    const sym = w.S.symbol || 'BTCUSDT'
    const r = await fetch(`/api/market/klines?symbol=${encodeURIComponent(sym)}&interval=${interval}&limit=1`)
    if (r.ok) { const bars = await r.json(); _dtTfChange[interval] = { pct: klineTfChangePct(bars), ts: Date.now() } }
  } catch (_) { /* keep prior cache; updateMetrics shows last value or — */ }
  finally { _dtTfInflight[interval] = false }
  updateMetrics()   // reflect the freshly-fetched per-tf change
}

export function setDtTf(tf: any, btn: any): void {
  w.S.dtTf = tf
  document.querySelectorAll('.dtt').forEach((b: any) => b.classList.remove('act'))
  if (btn) btn.classList.add('act')
  _refreshTfChange(tf)   // async — repaints PRICE change when klines arrive
  updateMetrics()
}

export function updateMetrics(): void {
  const dtp = el('dtp'), dtpc = el('dtpc'), dtps = el('dtps')
  if (dtp) dtp.textContent = w.S.price ? '$' + fP(w.S.price) : '\u2014'
  // [2026-06-13] CHANGE/SIGNAL reflect the selected timeframe tab (1H/4H/12H/1D/1W)
  // from real klines (cached). Falls back to the last-tick change until the first
  // per-tf fetch lands; kicks a refresh when the cache is stale.
  const _tfInt = DT_TF_INTERVAL[w.S.dtTf] || '1h'
  const _tfEntry = _dtTfChange[_tfInt]
  if (!_tfEntry || (Date.now() - _tfEntry.ts) >= _DT_TF_TTL) { _refreshTfChange(w.S.dtTf || '1H') }
  const _tfPct = _tfEntry ? _tfEntry.pct : (w.S.prevPrice ? ((w.S.price - w.S.prevPrice) / w.S.prevPrice * 100) : null)
  if (dtpc) { dtpc.textContent = _tfPct != null ? _tfPct.toFixed(2) + '%' : '\u2014'; dtpc.style.color = _tfPct == null ? 'var(--dim)' : _tfPct >= 0 ? 'var(--grn)' : 'var(--red)' }
  if (dtps) { if (_tfPct == null) { dtps.textContent = '\u2014'; dtps.style.color = 'var(--dim)' } else { dtps.textContent = _tfPct >= 0 ? 'BULL' : 'BEAR'; dtps.style.color = _tfPct >= 0 ? 'var(--grn)' : 'var(--red)' } }
  const dtoi = el('dtoi'), dtoic = el('dtoic'), dtois = el('dtois')
  if (dtoi) dtoi.textContent = w.S.oi ? '$' + fmt(w.S.oi) : '\u2014'
  // OI change over a real 5-minute window (the server refreshes OI ~60s, so the
  // old last-poll delta was ~0%). null \u2192 "\u2014" rather than a fake 0.
  const _oiPct = w.S.oi ? oiWindowDeltaPct(oiHistory as any, w.S.oi, Date.now(), 300000) : null
  if (dtoic) dtoic.textContent = _oiPct != null ? _oiPct.toFixed(2) + '%' : '\u2014'
  if (dtois) {
    if (_oiPct == null) { dtois.textContent = '\u2014'; dtois.style.color = 'var(--dim)' }
    else { const s = _oiPct >= 0 ? 'RISING' : 'FALLING'; dtois.textContent = s; dtois.style.color = s === 'RISING' ? 'var(--grn)' : 'var(--red)' }
  }
  const dtfr = el('dtfr'), dtfrc = el('dtfrc'), dtfrs = el('dtfrs')
  if (dtfr) dtfr.textContent = w.S.fr !== null && w.S.fr !== undefined ? (w.S.fr * 100).toFixed(4) + '%' : '\u2014'
  if (dtfrc) dtfrc.textContent = calcFrCd()
  if (dtfrs) { const s = w.S.fr > 0 ? 'LONGS PAY' : w.S.fr < 0 ? 'SHORTS PAY' : 'NEUTRAL'; dtfrs.textContent = s; dtfrs.style.color = w.S.fr > 0 ? 'var(--red)' : w.S.fr < 0 ? 'var(--grn)' : 'var(--dim)' }
  const dtls = el('dtls'), dtlsc = el('dtlsc'), dtlss = el('dtlss')
  if (dtls) dtls.textContent = w.S.ls ? w.S.ls.l.toFixed(1) + '% / ' + w.S.ls.s.toFixed(1) + '%' : '\u2014'
  if (dtlsc) dtlsc.textContent = '\u2014'
  if (dtlss) { const s = w.S.ls ? (w.S.ls.l > 55 ? 'LONG HEAVY' : w.S.ls.s > 55 ? 'SHORT HEAVY' : 'BALANCED') : '\u2014'; if (dtlss) dtlss.textContent = s; if (dtlss) dtlss.style.color = s === 'LONG HEAVY' ? 'var(--grn)' : s === 'SHORT HEAVY' ? 'var(--red)' : 'var(--dim)' }
  // [2026-06-13] RSI per selected timeframe (1H/4H/1D have a series; 12H/1W don't
  // \u2192 "\u2014"). CURRENT = tf RSI, CHANGE = live 5m RSI (now), SIGNAL from the tf RSI.
  const dtrsi = el('dtrsi'), dtrsic = el('dtrsic'), dtrsis = el('dtrsis')
  const _rsiKey = DT_TF_RSI_KEY[w.S.dtTf]
  const _rsiTf = _rsiKey ? w.S.rsi[_rsiKey] : undefined
  const _rsi5 = w.S.rsi['5m']
  if (dtrsi) dtrsi.textContent = (_rsiTf != null) ? _rsiTf.toFixed(1) : '\u2014'
  if (dtrsic) dtrsic.textContent = (_rsi5 != null) ? _rsi5.toFixed(1) : '\u2014'
  if (dtrsis) { const _r = (_rsiTf != null) ? _rsiTf : _rsi5; const s = _r == null ? '\u2014' : _r > 70 ? 'OVERBOUGHT' : _r < 30 ? 'OVERSOLD' : 'NEUTRAL'; dtrsis.textContent = s; dtrsis.style.color = _r == null ? 'var(--dim)' : _r > 70 ? 'var(--red)' : _r < 30 ? 'var(--grn)' : 'var(--dim)' }
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
  if (!(checkRSIAlerts as any)._last) (checkRSIAlerts as any)._last = {}
  if ((checkRSIAlerts as any)._last[key] && Date.now() - (checkRSIAlerts as any)._last[key] < 300000) return
  if (rsi > 70) { (checkRSIAlerts as any)._last[key] = Date.now(); if (typeof sendAlert === 'function') sendAlert('RSI OVERBOUGHT', `${tf} RSI: ${rsi.toFixed(1)}`, 'rsi') }
  if (rsi < 30) { (checkRSIAlerts as any)._last[key] = Date.now(); if (typeof sendAlert === 'function') sendAlert('RSI OVERSOLD', `${tf} RSI: ${rsi.toFixed(1)}`, 'rsi') }
}
(checkRSIAlerts as any)._last = {}
