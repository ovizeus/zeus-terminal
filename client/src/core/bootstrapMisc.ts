// Zeus — core/bootstrapMisc.ts
// Ported 1:1 from public/js/core/bootstrap.js lines 1121-1720 (Chunk C)
// PIN lock, build info, welcome modal, PWA, master reset, heartbeat, resize

import { getATObject, getTPObject, getBrainMetrics, getDSLObject, getTimezone } from '../services/stateAccessors'
import { toast } from '../data/marketDataHelpers'
import { _ZI } from '../constants/icons'
import { connectBNB } from '../data/marketDataWS'
import { connectWatchlist } from '../services/symbols'
import { getChartH, getChartW } from '../data/marketDataChart'
import { closeAllDemoPos } from '../trading/autotrade'
const w = window as any // kept for w.PERF (write-only SKIP), w.BlockReason, w.Intervals, w.WS, w.BUILD, fn calls, w.mainChart, w.cvdChart
// [8D-4A] mutable refs
const TP = getTPObject()
const AT = getATObject()
const BM = getBrainMetrics()
const DSL = getDSLObject()

// ===== PIN LOCK =====
let _pinSetCache: boolean | null = null

export async function _pinIsSet(): Promise<boolean> {
  if (_pinSetCache !== null) return _pinSetCache
  try { const r = await fetch('/auth/pin/status', { credentials: 'same-origin' }); if (!r.ok) return false; const d = await r.json(); _pinSetCache = !!d.pinSet; return _pinSetCache } catch (_) { return false }
}

export async function _pinCheckLock(): Promise<void> {
  const isSet = await _pinIsSet(); if (!isSet) return
  if (sessionStorage.getItem('zeus_pin_unlocked')) return
  const ls = document.getElementById('pinLockScreen')
  if (ls) { ls.style.display = 'flex'; setTimeout(function () { const inp = document.getElementById('pinLockInput') as HTMLInputElement | null; if (inp) inp.focus() }, 100); const inp = document.getElementById('pinLockInput'); if (inp) { inp.addEventListener('keydown', function (e: any) { if (e.key === 'Enter') pinUnlock() }) } }
}

export async function pinUnlock(): Promise<void> {
  const inp = document.getElementById('pinLockInput') as HTMLInputElement | null; const msg = document.getElementById('pinLockMsg')
  if (!inp) return; const val = inp.value.trim(); if (!val) { if (msg) msg.textContent = 'Introdu PIN-ul'; return }
  try {
    const r = await fetch('/auth/pin/verify', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Zeus-Request': '1' }, credentials: 'same-origin', body: JSON.stringify({ pin: val }) })
    const d = await r.json()
    if (d.ok === true) { sessionStorage.setItem('zeus_pin_unlocked', '1'); const ls = document.getElementById('pinLockScreen'); if (ls) { ls.style.transition = 'opacity .3s'; ls.style.opacity = '0'; setTimeout(function () { ls.style.display = 'none'; if (typeof _showWelcomeModal === 'function') _showWelcomeModal() }, 300) } }
    else if (d.error === 'pin_not_set') { if (msg) msg.textContent = 'PIN nu este configurat'; sessionStorage.setItem('zeus_pin_unlocked', '1'); const ls2 = document.getElementById('pinLockScreen'); if (ls2) ls2.style.display = 'none' }
    else if (d.error === 'session_invalid') { if (msg) msg.textContent = 'Sesiune expirat\u0103 \u2014 re-autentific\u0103-te' }
    else { if (msg) msg.textContent = 'PIN incorect!'; inp.value = ''; inp.focus(); inp.classList.add('pin-lock-shake'); setTimeout(function () { inp.classList.remove('pin-lock-shake') }, 500) }
  } catch (err) { if (msg) msg.textContent = 'Eroare de re\u021Bea' }
}

export async function pinActivate(): Promise<void> {
  const inp = document.getElementById('pinInput') as HTMLInputElement | null; const conf = document.getElementById('pinConfirm') as HTMLInputElement | null; const msg = document.getElementById('pin-msg')
  if (!inp || !conf) return; const val = inp.value.trim(); const val2 = conf.value.trim()
  if (!val || val.length < 4) { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = 'PIN-ul trebuie s\u0103 aib\u0103 minim 4 caractere' }; return }
  if (val !== val2) { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = 'PIN-urile nu coincid' }; return }
  try {
    const r = await fetch('/auth/pin/set', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Zeus-Request': '1' }, credentials: 'same-origin', body: JSON.stringify({ pin: val }) })
    const d = await r.json()
    if (d.ok) { inp.value = ''; conf.value = ''; _pinSetCache = true; if (msg) { msg.style.color = 'var(--grn-bright)'; msg.innerHTML = _ZI.ok + ' PIN activat!' }; _pinUpdateUI(); sessionStorage.setItem('zeus_pin_unlocked', '1') }
    else if (d.error === 'session_invalid') { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = 'Sesiune expirat\u0103' } }
    else { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = d.error || 'Eroare la setarea PIN-ului' } }
  } catch (err) { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = 'Eroare de re\u021Bea' } }
}

export async function pinRemove(): Promise<void> {
  try { const r = await fetch('/auth/pin/remove', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Zeus-Request': '1' }, credentials: 'same-origin' }); const d = await r.json(); if (d.ok) { _pinSetCache = false; sessionStorage.removeItem('zeus_pin_unlocked'); try { localStorage.removeItem('zeus_pin_hash') } catch (_) { }; const msg = document.getElementById('pin-msg'); if (msg) { msg.style.color = 'var(--blu)'; msg.textContent = 'PIN dezactivat.' }; _pinUpdateUI() } } catch (_) { }
}

export async function _pinUpdateUI(): Promise<void> {
  const isSet = await _pinIsSet(); const status = document.getElementById('pinStatus'); const actBtn = document.getElementById('pinActivateBtn'); const remBtn = document.getElementById('pinRemoveBtn')
  if (status) { status.innerHTML = isSet ? 'ACTIVAT ' + _ZI.ok : 'DEZACTIVAT'; status.style.color = isSet ? 'var(--grn-bright)' : '#556' }
  if (actBtn) actBtn.innerHTML = isSet ? _ZI.rfsh + ' SCHIMB\u0102 PIN' : _ZI.lock + ' ACTIVEAZ\u0102 PIN'
  if (remBtn) (remBtn as HTMLElement).style.display = isSet ? '' : 'none'
}

// ===== BUILD INFO =====
export function _renderBuildInfo(): void {
  try { const el = document.getElementById('hub-build-info'); if (!el) return; const b = w.BUILD || {}; const name = b.name || 'ZeuS'; const ver = b.version || 'v90'; const feat = Array.isArray(b.features) ? b.features.join(' \u00B7 ') : ''; const ts = b.ts ? new Date(b.ts).toLocaleTimeString() : '\u2014'; el.innerHTML = 'Version: ' + name + ' ' + ver + '<br>' + (feat ? 'Features: ' + feat + '<br>' : '') + 'Boot: ' + ts } catch (e) { }
}

// ===== WELCOME MODAL =====
let _wlcShown = false
export function _showWelcomeModal(): void {
  try {
    if (_wlcShown) return; if (_pinIsSet() && !sessionStorage.getItem('zeus_pin_unlocked')) return; _wlcShown = true
    const m = document.getElementById('mwelcome'); if (!m) return; m.style.display = 'flex'
    const isLive = (typeof AT !== 'undefined' && AT.mode === 'live'); const _wlcEnv = w._resolvedEnv || (isLive ? 'REAL' : 'DEMO'); const modeLabel = _wlcEnv === 'TESTNET' ? 'TESTNET' : (isLive ? 'LIVE' : 'DEMO')
    const greetEl = document.getElementById('wlcGreeting'); if (greetEl) greetEl.textContent = 'Welcome back, Commander'
    const badgeEl = document.getElementById('wlcModeBadge'); if (badgeEl) { badgeEl.textContent = modeLabel; badgeEl.className = 'wlc-mode-badge ' + (_wlcEnv === 'TESTNET' ? 'wlc-testnet' : (isLive ? 'wlc-live' : 'wlc-demo')) }
    const verEl = document.getElementById('wlcVersion'); const b = w.BUILD || {}; if (verEl) verEl.textContent = 'ZEUS TERMINAL ' + (b.version || '').toUpperCase()
    const balEl = document.getElementById('wlcBalance'); if (balEl) { let bal = 0; if (typeof TP !== 'undefined') bal = isLive ? (TP.liveBalance || 0) : (TP.demoBalance || 0); balEl.textContent = '$' + bal.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) }
    let todayTrades = 0, todayWins = 0, todayPnl = 0
    if (typeof TP !== 'undefined' && Array.isArray(TP.journal)) { const tz = (typeof w.S !== 'undefined' && getTimezone()) || 'Europe/Bucharest'; const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date()); const closed = TP.journal.filter(function (t: any) { if (t.journalEvent !== 'CLOSE' || !Number.isFinite(t.pnl)) return false; if ((t.mode || 'demo') !== (isLive ? 'live' : 'demo')) return false; const ts = t.closedAt || t.time || 0; if (!ts) return false; const dk = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(ts)); return dk === todayStr }); todayTrades = closed.length; closed.forEach(function (t: any) { todayPnl += (t.pnl || 0); if (t.pnl >= 0) todayWins++ }) }
    const pnlEl = document.getElementById('wlcDailyPnl'); if (pnlEl) { if (todayTrades > 0) { pnlEl.textContent = (todayPnl >= 0 ? '+' : '') + '$' + todayPnl.toFixed(0); pnlEl.className = 'wlc-value ' + (todayPnl > 0 ? 'wlc-pos' : todayPnl < 0 ? 'wlc-neg' : '') } else { pnlEl.textContent = 'no trades yet'; pnlEl.className = 'wlc-value' } }
    const trEl = document.getElementById('wlcTrades'); if (trEl) trEl.textContent = String(todayTrades)
    const wrEl = document.getElementById('wlcWinRate'); if (wrEl) { if (todayTrades > 0) { const wr = Math.round(todayWins / todayTrades * 100); wrEl.textContent = wr + '%'; wrEl.className = 'wlc-value ' + (wr >= 50 ? 'wlc-pos' : 'wlc-neg') } else { wrEl.textContent = 'N/A'; wrEl.className = 'wlc-value' } }
    const posEl = document.getElementById('wlcPositions'); if (posEl) { let openCount = 0; if (typeof TP !== 'undefined') { const arr = isLive ? (TP.livePositions || []) : (TP.demoPositions || []); openCount = arr.filter(function (p: any) { return !p.closed }).length }; posEl.textContent = String(openCount); posEl.className = 'wlc-value' + (openCount > 0 ? ' wlc-gold' : '') }
    const atEl = document.getElementById('wlcAT'); if (atEl) { if (typeof AT !== 'undefined') { atEl.textContent = AT.enabled ? 'ON' : 'OFF'; atEl.className = 'wlc-value ' + (AT.enabled ? 'wlc-on' : 'wlc-off') } else { atEl.textContent = 'OFF'; atEl.className = 'wlc-value wlc-off' } }
    const brEl = document.getElementById('wlcBrain'); if (brEl) { if (typeof BM !== 'undefined') { brEl.textContent = (BM.mode || 'assist').toUpperCase(); brEl.className = 'wlc-value wlc-gold' } else { brEl.textContent = 'N/A'; brEl.className = 'wlc-value' } }
    m.addEventListener('click', function (e: any) { if (e.target === m) w.closeM('mwelcome') })
    const _wlcEsc = function (e: any) { if (e.key === 'Escape') { w.closeM('mwelcome'); document.removeEventListener('keydown', _wlcEsc) } }; document.addEventListener('keydown', _wlcEsc)
  } catch (e) { console.warn('[WLC]', e) }
}

// ===== PWA =====
export function registerServiceWorker(): void {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => { console.log('[PWA] New SW — reloading'); window.location.reload() })
    navigator.serviceWorker.register('/sw.js').then((reg: any) => { reg.update().catch(() => { }); reg.addEventListener('updatefound', () => { const nw = reg.installing; if (nw) nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) nw.postMessage({ type: 'SKIP_WAITING' }) }) }) }).catch((err: any) => console.warn('[PWA] SW failed:', err))
  }
}
export function showPWAUpdateBanner(): void { const banner = document.getElementById('pwaUpdateBanner'); if (banner) banner.style.display = 'flex' }
export function hidePWAUpdateBanner(): void { const banner = document.getElementById('pwaUpdateBanner'); if (banner) banner.style.display = 'none' }
export function setPWAVersion(): void { const versionEl = document.getElementById('pwaVersion'); if (versionEl && w.BUILD && w.BUILD.version) versionEl.textContent = w.BUILD.version }
export function setupPWAReloadBtn(): void { const btn = document.getElementById('pwaReloadBtn'); if (btn) btn.onclick = () => { if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage({ action: 'skipWaiting' }); window.location.reload() } }

// ===== MASTER RESET =====
export function masterReset(): void {
  if (!window.confirm('MASTER RESET\n\u0218terge TOATE datele \u0219i reporne\u0219te Zeus Terminal?')) return
  try { localStorage.clear() } catch (e) { }
  if (typeof TP !== 'undefined') { TP.demoPositions = []; TP.livePositions = []; TP.demoBalance = 10000; TP.demoPnL = 0; TP.demoWins = 0; TP.demoLosses = 0 }
  if (typeof AT !== 'undefined') { AT.enabled = false; AT.killTriggered = false; AT.totalTrades = 0; AT.wins = 0; AT.losses = 0; AT.totalPnL = 0; AT.dailyPnL = 0; AT.realizedDailyPnL = 0; AT.closedTradesToday = 0; AT.lastTradeTs = 0; AT.lastTradeSide = null }
  if (typeof DSL !== 'undefined') { DSL.positions = {}; DSL.enabled = false }
  if (typeof w.PERF !== 'undefined') { Object.keys(w.PERF).forEach((k: string) => { w.PERF[k].wins = 0; w.PERF[k].losses = 0; w.PERF[k].weight = 1.0 }) }
  if (typeof w.DHF !== 'undefined') { ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach((d: string) => { if (w.DHF.days[d]) { w.DHF.days[d].wins = w.DHF.days[d].losses = w.DHF.days[d].trades = 0; w.DHF.days[d].wr = 60 } }); Object.keys(w.DHF.hours || {}).forEach((h: string) => { w.DHF.hours[h].wins = w.DHF.hours[h].losses = w.DHF.hours[h].trades = 0; w.DHF.hours[h].wr = 60 }) }
  if (typeof BM !== 'undefined') { BM.protectMode = false; BM.protectReason = '' }
  if (typeof w.BlockReason !== 'undefined') w.BlockReason.clear()
  if (typeof w.Intervals !== 'undefined') w.Intervals.clearAll()
  if (typeof w.WS !== 'undefined') w.WS.closeAll()
  toast('Master Reset complet \u2014 re\u00EEnc\u0103rcare...')
  setTimeout(() => location.reload(), 800)
}

// ===== HEARTBEAT RECONNECT =====
;(function () {
  let _lastTick = 0; let _armed = false
  const _origIngest = w.ingestPrice
  w.ingestPrice = function (raw: any, source: any) { _lastTick = Date.now(); _armed = true; return _origIngest ? _origIngest(raw, source) : false }
  setInterval(function () {
    if (!_armed) return
    if (Date.now() - _lastTick > 10000) {
      console.warn('[ZEUS] Heartbeat: no tick for 10s \u2014 forcing reconnect')
      try { connectBNB(); connectWatchlist() } catch (e) { console.error('[ZEUS] Reconnect error', e) }
      _lastTick = Date.now()
    }
  }, 5000)
})()

// ===== CLOSE ALL BTN LONG-PRESS =====
if (!w._closeAllBtnInited) {
  w._closeAllBtnInited = true
  function _initCloseAllBtn() {
    const btn = document.getElementById('closeAllBtn')
    if (btn && typeof w.attachConfirmClose === 'function') w.attachConfirmClose(btn, closeAllDemoPos)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _initCloseAllBtn)
  else setTimeout(_initCloseAllBtn, 500)
}

// ===== DESKTOP CHART RESIZE =====
;(function () {
  let _rzTimer: any = null
  function _resizeCharts() {
    if (typeof w.mainChart === 'undefined' || !w.mainChart) return
    const width = getChartW(); const h = getChartH()
    try { w.mainChart.applyOptions({ width, height: h }); if (typeof w.cvdChart !== 'undefined' && w.cvdChart) w.cvdChart.applyOptions({ width, height: 60 }); try { if (w.cvdChart) w.cvdChart.timeScale().applyOptions({ rightOffset: 12 }) } catch (_) { }; try { if (typeof w._macdChart !== 'undefined' && w._macdChart) w._macdChart.timeScale().applyOptions({ rightOffset: 12 }) } catch (_) { } } catch (e) { }
  }
  window.addEventListener('resize', function () { clearTimeout(_rzTimer); _rzTimer = setTimeout(_resizeCharts, 120) })
  window.addEventListener('zeusReady', function () { setTimeout(_resizeCharts, 500) })
})()
