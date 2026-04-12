/**
 * Zeus Terminal — core/config.ts (ported from public/js/core/config.js)
 * Configuration constants, indicator definitions, profile timeframes
 * Phase 7E — HIGH RISK foundation file
 */

import { getATObject, getTimezone, getKlines, getPrice } from '../services/stateAccessors'
import { _safeLocalStorageSet } from '../services/storage'
import { updateMTFAlignment, detectSweepDisplacement, computeMarketAtmosphere, detectRegimeEnhanced, setProfile } from '../engine/brain'
import { getLiveLev } from '../data/marketDataTrading'
import { PhaseFilter } from '../engine/phaseFilter'
import { RegimeEngine } from '../engine/regime'
import { computePredatorState } from '../engine/events'
import { _adaptLoad } from '../trading/risk'
import { _mscanUpdateLabel } from '../data/klines'
import { loadPerfFromStorage } from '../engine/perfStore'
import { loadDailyPnl } from '../engine/dailyPnl'
import { renderATLog } from '../trading/autotrade'
import { _aresRender } from '../engine/aresUI'
import { escHtml } from '../utils/dom'
import { _ZI } from '../constants/icons'
const w = window as any // this file CREATES w.BM, w.BRAIN, w.DSL, w.PERF, w.DHF, w.USER_SETTINGS + 20 more — circular reads remain on w

// ── MOVED-TO-TOP state objects ──────────────────────────────────
export const AUB: any = {
  expanded: false,
  sfxEnabled: false,
  audioCtx: null,
  guardCount: 0,
  guardLast: '\u2014',
  domSkips: 0,
  rafFPS: 0,
  _rafLast: 0,
  _rafFrames: 0,
  _perfHeavy: false,
  bb: [],
  macroEvents: [],
  simResult: null,
  simRunning: false,
  simPendingApply: null,
  corr: { eth: null, sol: null },
  mtfStrength: { '5m': 0, '15m': 0, '1h': 0, '4h': 0 },
}
export const AUB_COMPAT: any = {
  ws: false, audio: false, sw: false, crypto: false,
  swDisabled: false,
}
export const AUB_PERF: any = {
  _domCache: {},
  setDOM(id: string, val: any) {
    const el_p = document.getElementById(id)
    if (!el_p) return false
    if (el_p.textContent === String(val)) { AUB.domSkips++; return false }
    el_p.textContent = val
    return true
  },
  setHTML(id: string, val: string) {
    const el_p = document.getElementById(id)
    if (!el_p) return false
    if (el_p.innerHTML === val) { AUB.domSkips++; return false }
    el_p.innerHTML = val
    return true
  }
}
export const AUB_SIM_KEY = 'aub_sim_last'
export const ARIA_STATE: any = {
  expanded: false,
  pattern: null,
  _barKey: '',
  _rafPending: false,
  _updateTs: 0,
  _patternAge: 0,
}
export const NOVA_STATE: any = {
  expanded: false,
  log: [],
  lastMsg: null,
  _verdictTs: 0,
  _cooldowns: { danger: 30000, warn: 15000, info: 8000, ok: 8000 },
  _lastBySeverity: {},
}
export const _AN_KEY_A = 'aria_v1'
export const _AN_KEY_N = 'nova_v1'
export let _dslStripOpen = false
export let _atStripOpen = false
export let _ptStripOpen = false

// Indicators array
export const INDICATORS: any[] = [
  { id: 'ema', ico: _ZI.tup, name: 'EMA 50/200', desc: 'Exponential Moving Average', cat: 'trend', def: true },
  { id: 'wma', ico: _ZI.wave, name: 'WMA 20/50', desc: 'Weighted Moving Average', cat: 'trend', def: true },
  { id: 'st', ico: _ZI.dia, name: 'Supertrend', desc: 'Trend + Stop Loss dinamic', cat: 'trend', def: true },
  { id: 'vp', ico: _ZI.chart, name: 'Volume Profile', desc: 'Volum pe niveluri de pret', cat: 'volume', def: true },
  { id: 'cvd', ico: _ZI.chart, name: 'CVD', desc: 'Cumulative Volume Delta', cat: 'volume', def: false },
  { id: 'macd', ico: _ZI.bolt, name: 'MACD', desc: 'Moving Avg Convergence Div', cat: 'momentum', def: false },
  { id: 'bb', ico: _ZI.tgt, name: 'Bollinger Bands', desc: 'Volatilitate si trend', cat: 'vol', def: false },
  { id: 'stoch', ico: _ZI.wave, name: 'Stochastic RSI', desc: 'RSI imbunatatit cu Stoch', cat: 'momentum', def: false },
  { id: 'obv', ico: _ZI.chart, name: 'OBV', desc: 'On-Balance Volume', cat: 'volume', def: false },
  { id: 'atr', ico: _ZI.ruler, name: 'ATR', desc: 'Average True Range - volat', cat: 'vol', def: false },
  { id: 'vwap', ico: _ZI.chart, name: 'VWAP', desc: 'Volume Weighted Avg Price', cat: 'trend', def: false },
  { id: 'ichimoku', ico: _ZI.cloud, name: 'Ichimoku Cloud', desc: 'Sistem complet japonez', cat: 'trend', def: false },
  { id: 'fib', ico: _ZI.hex, name: 'Fibonacci', desc: 'Retracement auto pe swing', cat: 'support', def: false },
  { id: 'pivot', ico: _ZI.tgt, name: 'Pivot Points', desc: 'Suport/Rezistenta zilnice', cat: 'support', def: false },
  { id: 'rsi14', ico: _ZI.bolt, name: 'RSI 14', desc: 'Relative Strength Index', cat: 'momentum', def: false },
  { id: 'mfi', ico: _ZI.money, name: 'Money Flow Index', desc: 'RSI bazat pe volum', cat: 'volume', def: false },
  { id: 'cci', ico: _ZI.ruler, name: 'CCI', desc: 'Commodity Channel Index', cat: 'momentum', def: false },
]
export let _macdChart: any = null, _macdLineSeries: any = null, _macdSigSeries: any = null, _macdHistSeries: any = null
export let _macdInited = false
export let _audioCtx: any = null
export let _audioReady = false

// Signal Registry
export const SIGNAL_REGISTRY: any = {
  signals: [],
  stats: { total: 0, wins: 0, losses: 0, winRate: 0, expectancy: 0 },
  _lastConfluenceKey: null,
  _lastScanKey: null,
}

export function srRecord(source: any, type: any, direction: any, score: any, _extra?: any) {
  const S = w.S
  const key = source + '|' + type + '|' + direction
  const now = Date.now()
  const recent = SIGNAL_REGISTRY.signals.find((s: any) =>
    s._key === key && (now - s.ts) < 30000
  )
  if (recent) return recent

  const id = now + '-' + Math.random().toString(36).substr(2, 4)
  const entry = {
    id,
    _key: key,
    ts: now,
    source,
    type,
    direction,
    score,
    tf: S.chartTf || '5m',
    entryPrice: S.price || 0,
    tradeId: null,
    outcome: null,
    pnl: null,
    closedAt: null,
  }

  SIGNAL_REGISTRY.signals.unshift(entry)
  if (SIGNAL_REGISTRY.signals.length > 500) SIGNAL_REGISTRY.signals.pop()

  _srSave()
  _srRenderList()
  srStripUpdateBar()
  return entry
}

export function srLinkTrade(pos: any) {
  const dir = pos.side === 'LONG' ? 'LONG' : 'SHORT'
  const sig = SIGNAL_REGISTRY.signals.find((s: any) =>
    !s.tradeId && s.direction === dir && (Date.now() - s.ts) < 120000
  )
  if (sig && !sig.tradeId) {
    sig.tradeId = pos.id
    pos.signalId = sig.id
    _srSave()
  }
}

export function srUpdateOutcome(pos: any, pnl: any) {
  if (!pos.signalId) return
  const sig = SIGNAL_REGISTRY.signals.find((s: any) => s.id === pos.signalId)
  if (!sig) return
  sig.outcome = pnl >= 0 ? 'win' : 'loss'
  sig.pnl = pnl
  sig.closedAt = Date.now()
  _srUpdateStats()
  _srSave()
  _srRenderList()
}

export function _srUpdateStats() {
  const closed = SIGNAL_REGISTRY.signals.filter((s: any) => s.outcome)
  const wins = closed.filter((s: any) => s.outcome === 'win').length
  const losses = closed.length - wins
  const totalPnl = closed.reduce((acc: number, s: any) => acc + (s.pnl || 0), 0)
  SIGNAL_REGISTRY.stats = {
    total: closed.length,
    wins,
    losses,
    winRate: closed.length ? +(wins / closed.length * 100).toFixed(1) : 0,
    expectancy: closed.length ? +(totalPnl / closed.length).toFixed(2) : 0,
  }
  _srRenderStats()
}

export function _srRenderStats() {
  const el_s = document.getElementById('sr-stats')
  if (!el_s) return
  const st = SIGNAL_REGISTRY.stats
  const wr = st.total ? st.winRate : '\u2014'
  const exp = st.total ? (st.expectancy >= 0 ? '+' : '') + st.expectancy : '\u2014'
  el_s.innerHTML =
    `<span class="sr-stat">${_ZI.chart} ${st.total} semnale</span>` +
    `<span class="sr-stat ${st.wins >= st.losses ? 'sr-win' : 'sr-loss'}">${_ZI.ok} ${st.wins}W / ${_ZI.x} ${st.losses}L</span>` +
    `<span class="sr-stat">WR: <b>${wr}%</b></span>` +
    `<span class="sr-stat">Exp: <b>${exp}$</b></span>`
  srStripUpdateBar()
}

export function _srRenderList() {
  const el_l = document.getElementById('sr-list')
  if (!el_l) return
  const items = SIGNAL_REGISTRY.signals.slice(0, 30)
  if (!items.length) {
    el_l.innerHTML = '<div class="sr-empty">Niciun semnal \u00EEnregistrat \u00EEnc\u0103</div>'
    return
  }
  el_l.innerHTML = items.map((s: any) => {
    const t = new Date(s.ts).toLocaleTimeString('ro-RO', {
      timeZone: getTimezone(),
      hour: '2-digit', minute: '2-digit'
    })
    const _type = escHtml(s.type || '')
    const _typeShort = _type.length > 18 ? _type.slice(0, 16) + '\u2026' : _type
    const dirCls = s.direction === 'LONG' ? 'sr-long' : s.direction === 'SHORT' ? 'sr-short' : 'sr-neut'
    const outCls = s.outcome === 'win' ? 'sr-win' : s.outcome === 'loss' ? 'sr-loss' : 'sr-pend'
    const outTxt = s.outcome === 'win' ? `${_ZI.ok} +$${s.pnl?.toFixed(2)}` :
      s.outcome === 'loss' ? `${_ZI.x} $${s.pnl?.toFixed(2)}` : `${_ZI.ld} \u2014`
    const srcIco = s.source === 'confluence' ? _ZI.brain : _ZI.eye
    return `<div class="sr-row">
      <span class="sr-time">${t}</span>
      <span class="sr-src">${srcIco}</span>
      <span class="sr-type" title="${_type}">${_typeShort}</span>
      <span class="sr-dir ${dirCls}">${s.direction}</span>
      <span class="sr-score">${typeof s.score === 'number' ? s.score : s.score}</span>
      <span class="sr-outcome ${outCls}">${outTxt}</span>
    </div>`
  }).join('')
}

export function _srSave() {
  _safeLocalStorageSet('zeus_signal_registry', {
    signals: SIGNAL_REGISTRY.signals.slice(0, 100),
    stats: SIGNAL_REGISTRY.stats,
  })
  w._ucMarkDirty('signalRegistry')
  if (typeof w._userCtxPush === 'function') w._userCtxPush()
}
export function _srLoad() {
  try {
    const raw = localStorage.getItem('zeus_signal_registry')
    if (!raw) return
    const data = JSON.parse(raw)
    SIGNAL_REGISTRY.signals = data.signals || []
    SIGNAL_REGISTRY.stats = data.stats || SIGNAL_REGISTRY.stats
  } catch (_) { /* */ }
}

export function _srEnsureVisible() {
  try {
    const srSec = document.getElementById('sr-strip') || document.getElementById('sr-sec')
    if (!srSec) return
    const mi = document.getElementById('zeus-groups')
    if (!mi) return
    srSec.classList.remove('zg-pending-move')
    srSec.style.removeProperty('visibility')
    srSec.style.removeProperty('display')
    srSec.style.removeProperty('max-height')
    srSec.style.removeProperty('overflow')
    const alreadyIn = srSec.closest('#zeus-groups') !== null
    if (!alreadyIn) {
      const aub = mi.querySelector('#aub')
      if (aub && aub.nextSibling) {
        mi.insertBefore(srSec, aub.nextSibling)
      } else if (aub) {
        mi.appendChild(srSec)
      } else {
        mi.insertBefore(srSec, mi.firstChild)
      }
      console.log('[SR] Fallback: sr-sec fortat in zeus-groups')
    } else {
      const aub = mi.querySelector('#aub')
      if (aub) {
        const nodes = Array.from(mi.children)
        const aubIdx = nodes.indexOf(aub)
        const srIdx = nodes.indexOf(srSec)
        if (srIdx !== aubIdx + 1) {
          if (aub.nextSibling) {
            mi.insertBefore(srSec, aub.nextSibling)
          } else {
            mi.appendChild(srSec)
          }
          console.log('[SR] Fallback: sr-sec repositionat dupa AUB')
        }
      }
    }
    _srUpdateStats()
    _srRenderList()
  } catch (e: any) {
    console.warn('[SR] Fallback _srEnsureVisible error:', e.message)
  }
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  NOTIFICATION CENTER                                        ║
// ╚══════════════════════════════════════════════════════════════╝
export const NOTIFICATION_CENTER: any = {
  items: [],
  maxItems: 100,
  _filter: 'all',
}

export function ncAdd(severity: any, type: any, message: any) {
  const now = Date.now()
  const dup = NOTIFICATION_CENTER.items.find((i: any) =>
    i.message === message && i.type === type && (now - i.ts) < 30000
  )
  if (dup) return

  const item = {
    id: now + '-' + Math.random().toString(36).substr(2, 4),
    ts: now,
    severity,
    type,
    message,
    read: false,
  }

  NOTIFICATION_CENTER.items.unshift(item)
  if (NOTIFICATION_CENTER.items.length > NOTIFICATION_CENTER.maxItems) {
    NOTIFICATION_CENTER.items.pop()
  }

  _ncSave()
  _ncUpdateBadge()

  const panel = document.getElementById('mnotifications')
  if (panel && panel.classList.contains('open')) _ncRenderList()
}

export function _ncRenderList() {
  const list = document.getElementById('nc-list')
  if (!list) return

  const f = NOTIFICATION_CENTER._filter
  const items = NOTIFICATION_CENTER.items.filter((i: any) =>
    f === 'all' || i.severity === f
  )

  if (!items.length) {
    list.innerHTML = '<div class="nc-empty">Nicio notificare' +
      (f !== 'all' ? ' pentru filtrul selectat' : '') + '</div>'
    return
  }

  list.innerHTML = items.map((i: any) => {
    const t = new Date(i.ts).toLocaleTimeString('ro-RO', {
      timeZone: getTimezone(),
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    })
    const ico = i.severity === 'critical' ? _ZI.dRed :
      i.severity === 'warning' ? _ZI.dYlw : '<span class="z-dot" style="background:#4488ff;box-shadow:0 0 4px #4488ff66"></span>'
    const _esc = escHtml
    return `<div class="nc-item ${_esc(i.severity)} ${i.read ? 'nc-read' : ''}" data-id="${_esc(i.id)}">
      <div class="nc-item-hdr">
        <span class="nc-ico">${ico}</span>
        <span class="nc-type">${_esc(i.type)}</span>
        <span class="nc-time">${t}</span>
        <button class="nc-mark" onclick="ncMarkRead('${_esc(i.id)}')">\u2713</button>
      </div>
      <div class="nc-msg">${_esc(i.message)}</div>
    </div>`
  }).join('')
}

export function _ncUpdateBadge() {
  const badge = document.getElementById('nc-badge')
  if (!badge) return
  const unread = NOTIFICATION_CENTER.items.filter((i: any) => !i.read).length
  badge.textContent = unread > 9 ? '9+' : String(unread)
  badge.style.display = unread > 0 ? 'inline-block' : 'none'
}

export function ncFilter(sev: any, tabEl: any) {
  NOTIFICATION_CENTER._filter = sev
  document.querySelectorAll('#mnotifications .nc-tab').forEach((t: any) =>
    t.classList.remove('act')
  )
  if (tabEl) tabEl.classList.add('act')
  _ncRenderList()
}

export function ncMarkRead(id: any) {
  const item = NOTIFICATION_CENTER.items.find((i: any) => i.id === id)
  if (item) { item.read = true; _ncSave(); _ncRenderList(); _ncUpdateBadge() }
}

export function ncMarkAllRead() {
  NOTIFICATION_CENTER.items.forEach((i: any) => { i.read = true })
  _ncSave(); _ncRenderList(); _ncUpdateBadge()
}

export function ncClear() {
  NOTIFICATION_CENTER.items = []
  _ncSave(); _ncRenderList(); _ncUpdateBadge()
}

function _ncSave() {
  _safeLocalStorageSet('zeus_notifications', {
    items: NOTIFICATION_CENTER.items.slice(0, 100),
  })
  w._ucMarkDirty('notifications')
  if (typeof w._userCtxPush === 'function') w._userCtxPush()
}
export function _ncLoad() {
  try {
    const raw = localStorage.getItem('zeus_notifications')
    if (!raw) return
    const data = JSON.parse(raw)
    NOTIFICATION_CENTER.items = data.items || []
  } catch (_) { /* */ }
}

// ══════════════════════════════════════════════════════════════════
// UI Context Persistence
// ══════════════════════════════════════════════════════════════════
let _ctxSaveTimer: any = null
export function _ctxSave() {
  if (_ctxSaveTimer) clearTimeout(_ctxSaveTimer)
  _ctxSaveTimer = setTimeout(function _ctxSaveNow() {
    try {
      const S = w.S
      const AT = getATObject()
      _safeLocalStorageSet('zeus_ui_context', {
        _v: 1,
        ts: Date.now(),
        soundOn: typeof S !== 'undefined' ? !!S.soundOn : false,
        atLog: (typeof AT !== 'undefined' && Array.isArray(AT.log)) ? AT.log.slice(0, 50) : [],
      })
      w._ucMarkDirty('uiContext')
      if (typeof w._userCtxPush === 'function') w._userCtxPush()
    } catch (_) { /* */ }
  }, 1000)
}
export function _ctxLoad() {
  try {
    const S = w.S
    const AT = getATObject()
    const raw = localStorage.getItem('zeus_ui_context')
    if (!raw) return
    const ctx = JSON.parse(raw)
    if (!ctx || ctx._v !== 1) return
    if (typeof S !== 'undefined' && typeof ctx.soundOn === 'boolean') {
      S.soundOn = ctx.soundOn
      const sndEl = document.getElementById('snd')
      if (sndEl) sndEl.innerHTML = S.soundOn ? _ZI.bell : _ZI.bellX
    }
    if (typeof AT !== 'undefined' && Array.isArray(ctx.atLog) && ctx.atLog.length > 0 && AT.log.length === 0) {
      AT.log = ctx.atLog
      if (typeof renderATLog === 'function') renderATLog()
    }
    console.log('[CTX] UI context restored (sound:', ctx.soundOn, ', atLog:', (ctx.atLog || []).length, 'entries)')
  } catch (_) { /* */ }
}

// ══════════════════════════════════════════════════════════════════
// Cross-Device Per-User Sync
// ══════════════════════════════════════════════════════════════════
let _ucPushTimer: any = null
let _ucPulling = false
const _ucVersion = 4
let _ucPushPending = false

let _ucDirtyTs: any = {}
try { _ucDirtyTs = JSON.parse(localStorage.getItem('zeus_uc_dirty_ts') || '{}') } catch (_) { _ucDirtyTs = {} }
if (!localStorage.getItem('zeus_uc_dirty_ts')) {
  const _seedTs = Date.now()
  ;['settings', 'uiContext', 'panels', 'indSettings', 'llvSettings', 'uiScale',
    'signalRegistry', 'perfStats', 'dailyPnl', 'postmortem', 'adaptive',
    'notifications', 'scannerSyms', 'midstackOrder', 'aubData', 'ofHud',
    'teacherData', 'ariaNovaHud', 'aresData'].forEach(function (s) { _ucDirtyTs[s] = _seedTs })
  try { localStorage.setItem('zeus_uc_dirty_ts', JSON.stringify(_ucDirtyTs)) } catch (_) { /* */ }
}
export function _ucMarkDirty(section: string) {
  _ucDirtyTs[section] = Date.now()
  try { localStorage.setItem('zeus_uc_dirty_ts', JSON.stringify(_ucDirtyTs)) } catch (_) { /* */ }
}
w._ucMarkDirty = _ucMarkDirty

function _buildAllSections(): any {
  const _t = function (s: string) { return _ucDirtyTs[s] || 0 }
  const _g = function (k: string) { try { return localStorage.getItem(k) } catch (_) { return null } }
  const _j = function (k: string) { try { return JSON.parse(_g(k) || 'null') } catch (_) { return null } }
  return {
    settings: { ts: _t('settings'), data: _j('zeus_user_settings') },
    uiContext: { ts: _t('uiContext'), data: _j('zeus_ui_context') },
    panels: { ts: _t('panels'), data: { groups: _j('zeus_groups'), dslStrip: _g('zeus_dsl_strip_open'), atStrip: _g('zeus_at_strip_open'), ptStrip: _g('zeus_pt_strip_open'), mtfOpen: _g('zeus_mtf_open'), dslMode: _g('zeus_dsl_mode'), adaptStrip: _g('zeus_adaptive_strip_open') } },
    indSettings: { ts: _t('indSettings'), data: _j('zeus_ind_settings') },
    llvSettings: { ts: _t('llvSettings'), data: _j('zeus_llv_settings') },
    uiScale: { ts: _t('uiScale'), data: _g('zeus_ui_scale') },
    signalRegistry: { ts: _t('signalRegistry'), data: _j('zeus_signal_registry') },
    perfStats: { ts: _t('perfStats'), data: _j('zeus_perf_v1') },
    dailyPnl: { ts: _t('dailyPnl'), data: _j('zeus_daily_pnl_v1') },
    postmortem: { ts: _t('postmortem'), data: _j('zeus_postmortem_v1') },
    adaptive: { ts: _t('adaptive'), data: _j('zeus_adaptive_v1') },
    notifications: { ts: _t('notifications'), data: _j('zeus_notifications') },
    scannerSyms: { ts: _t('scannerSyms'), data: _j('zeus_mscan_syms') },
    midstackOrder: { ts: _t('midstackOrder'), data: _j('zt_midstack_order') },
    aubData: { ts: _t('aubData'), data: { bb: _j('aub_bb'), macro: _j('aub_macro'), sim: _j('aub_sim_last'), expanded: _g('aub_expanded') } },
    ofHud: { ts: _t('ofHud'), data: { v2: _g('of_hud_v2'), pos: _g('of_hud_pos_v1'), anchor: _g('of_hud_anchor_x_v1') } },
    teacherData: { ts: _t('teacherData'), data: { config: _j('zeus_teacher_config'), sessions: _j('zeus_teacher_sessions'), lessons: _j('zeus_teacher_lessons'), stats: _j('zeus_teacher_stats'), memory: _j('zeus_teacher_memory'), v2state: _j('zeus_teacher_v2state'), panelOpen: _g('zeus_teacher_panel_open') } },
    ariaNovaHud: { ts: _t('ariaNovaHud'), data: { aria: _j('aria_v1'), nova: _j('nova_v1') } },
    aresData: { ts: _t('aresData'), data: { wallet: _j('ARES_MISSION_STATE_V1_vw2'), positions: _j('ARES_POSITIONS_V1'), state: _j('ARES_STATE_V1'), init: _j('ares_init_v1'), lastTradeTs: _g('ARES_LAST_TRADE_TS'), journal: _j('ARES_JOURNAL_V1') } },
  }
}

export function _userCtxPushNow() {
  if (_ucPushTimer) { clearTimeout(_ucPushTimer); _ucPushTimer = null }
  _ucPushBeacon()
}
w._userCtxPushNow = _userCtxPushNow

export function _userCtxPush() {
  if (_ucPushTimer) clearTimeout(_ucPushTimer)
  _ucPushTimer = setTimeout(function _ucPushExec() {
    try {
      const payload = { _v: _ucVersion, ts: Date.now(), sections: _buildAllSections() }
      fetch('/api/sync/user-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'same-origin'
      }).then(function (r) {
        if (!r.ok) { console.warn('[UC] push failed:', r.status); _ucPushPending = true; return null }
        return r.json()
      }).then(function (json: any) {
        if (!json) return
        console.log('[UC] \u2705 pushed'); _ucPushPending = false
        if (json.storedSettings && json.storedSettings.data) {
          try {
            const sent = payload.sections.settings ? payload.sections.settings.data : null
            const stored = json.storedSettings.data
            if (sent && stored) {
              const sentAT = typeof sent === 'string' ? JSON.parse(sent) : sent
              const storedAT = typeof stored === 'string' ? JSON.parse(stored) : stored
              if (sentAT.autoTrade && storedAT.autoTrade) {
                const keys = ['lev', 'sl', 'rr', 'size', 'maxPos', 'killPct', 'confMin', 'sigMin']
                const mismatches: string[] = []
                keys.forEach(function (k) {
                  if (sentAT.autoTrade[k] !== storedAT.autoTrade[k]) {
                    mismatches.push(k + ':sent=' + sentAT.autoTrade[k] + '/stored=' + storedAT.autoTrade[k])
                  }
                })
                if (mismatches.length > 0) {
                  console.error('[UC] \u26a0\ufe0f SETTINGS MISMATCH:', mismatches.join(', '))
                  if (typeof w.ZLOG !== 'undefined') w.ZLOG.push('WARN', '[UC] settings mismatch after push', { mismatches: mismatches })
                } else {
                  console.log('[UC] \u2705 settings validated \u2014 server matches client')
                }
              }
            }
          } catch (_) { /* */ }
        }
      }).catch(function (e: any) { console.warn('[UC] push err:', e.message); _ucPushPending = true })
    } catch (_) { /* */ }
  }, 1000)
}

export function _userCtxPull() {
  if (_ucPulling) return
  _ucPulling = true
  if (_ucPushPending) {
    console.log('[UC] retrying pending push before pull')
    _ucPushBeacon()
    _ucPushPending = false
  }
  fetch('/api/sync/user-context', { credentials: 'same-origin' })
    .then(function (r) { return r.ok ? r.json() : null })
    .then(function (json: any) {
      _ucPulling = false
      if (!json || !json.ok || !json.data || !json.data.sections) return
      const sec = json.data.sections
      let _dirty = false

      let localUS: any = JSON.parse(localStorage.getItem('zeus_user_settings') || 'null')
      let localTs = (localUS && localUS._syncTs) ? localUS._syncTs : 0
      const serverSettingsTs = (sec.settings && sec.settings.ts) ? sec.settings.ts : 0
      if (localTs > serverSettingsTs && localTs > 0) {
        console.log('[UC] local newer than server (' + localTs + ' > ' + serverSettingsTs + ') — re-pushing')
        _ucPushBeacon()
      }

      // ── settings section (field-level merge) ──
      if (sec.settings && sec.settings.data) {
        localUS = JSON.parse(localStorage.getItem('zeus_user_settings') || 'null')
        localTs = (localUS && localUS._syncTs) ? localUS._syncTs : 0
        const bootTs = w._zeusBootTs || 0
        const localEditedSinceBoot = localTs > bootTs
        if (sec.settings.ts > (_ucDirtyTs.settings || 0) && !localEditedSinceBoot) {
          const sData = sec.settings.data
          if (sData) {
            if (localUS && typeof localUS === 'object') {
              for (const fk in sData) {
                if (fk === '_syncTs' || fk === '_version') continue
                localUS[fk] = sData[fk]
              }
              localUS._syncTs = sec.settings.ts
              localStorage.setItem('zeus_user_settings', JSON.stringify(localUS))
            } else {
              sData._syncTs = sec.settings.ts
              localStorage.setItem('zeus_user_settings', JSON.stringify(sData))
            }
            _ucDirtyTs.settings = sec.settings.ts; _dirty = true
            if (typeof w.loadUserSettings === 'function') w.loadUserSettings()
            console.log('[UC] \u2705 settings field-merged from server')
          }
        }
      }

      if (sec.uiContext && sec.uiContext.data) {
        if (sec.uiContext.ts > (_ucDirtyTs.uiContext || 0)) {
          localStorage.setItem('zeus_ui_context', JSON.stringify(sec.uiContext.data))
          _ucDirtyTs.uiContext = sec.uiContext.ts; _dirty = true
          if (typeof _ctxLoad === 'function') _ctxLoad()
          console.log('[UC] \u2705 uiContext merged from server')
        }
      }

      if (sec.panels && sec.panels.data) {
        if (sec.panels.ts > (_ucDirtyTs.panels || 0)) {
          const pd = sec.panels.data
          if (pd.groups) localStorage.setItem('zeus_groups', JSON.stringify(pd.groups))
          if (pd.dslStrip != null) localStorage.setItem('zeus_dsl_strip_open', pd.dslStrip)
          if (pd.atStrip != null) localStorage.setItem('zeus_at_strip_open', pd.atStrip)
          if (pd.ptStrip != null) localStorage.setItem('zeus_pt_strip_open', pd.ptStrip)
          if (pd.mtfOpen != null) localStorage.setItem('zeus_mtf_open', pd.mtfOpen)
          if (pd.dslMode != null) localStorage.setItem('zeus_dsl_mode', pd.dslMode)
          if (pd.adaptStrip != null) localStorage.setItem('zeus_adaptive_strip_open', pd.adaptStrip)
          _ucDirtyTs.panels = sec.panels.ts; _dirty = true
          console.log('[UC] \u2705 panels merged from server')
        }
      }

      if (sec.indSettings && sec.indSettings.data) {
        if (sec.indSettings.ts > (_ucDirtyTs.indSettings || 0)) {
          localStorage.setItem('zeus_ind_settings', JSON.stringify(sec.indSettings.data))
          _ucDirtyTs.indSettings = sec.indSettings.ts; _dirty = true
          if (typeof w._indSettingsLoad === 'function') w._indSettingsLoad()
          if (typeof w.renderChart === 'function') w.renderChart()
          console.log('[UC] \u2705 indSettings merged from server')
        }
      }

      if (sec.llvSettings && sec.llvSettings.data) {
        if (sec.llvSettings.ts > (_ucDirtyTs.llvSettings || 0)) {
          localStorage.setItem('zeus_llv_settings', JSON.stringify(sec.llvSettings.data))
          _ucDirtyTs.llvSettings = sec.llvSettings.ts; _dirty = true
          console.log('[UC] \u2705 llvSettings merged from server')
        }
      }

      if (sec.uiScale && sec.uiScale.data != null) {
        if (sec.uiScale.ts > (_ucDirtyTs.uiScale || 0)) {
          localStorage.setItem('zeus_ui_scale', sec.uiScale.data)
          _ucDirtyTs.uiScale = sec.uiScale.ts; _dirty = true
          document.documentElement.style.fontSize = sec.uiScale.data + 'px'
          console.log('[UC] \u2705 uiScale merged from server')
        }
      }

      const _restoreJSON = function (sectionName: string, lsKey: string, reloadFn: any) {
        if (sec[sectionName] && sec[sectionName].data != null) {
          const localDirty2 = _ucDirtyTs[sectionName] || 0
          if (sec[sectionName].ts > localDirty2) {
            localStorage.setItem(lsKey, JSON.stringify(sec[sectionName].data))
            _ucDirtyTs[sectionName] = sec[sectionName].ts; _dirty = true
            if (reloadFn) reloadFn()
            console.log('[UC] \u2705 ' + sectionName + ' merged from server')
          }
        }
      }
      _restoreJSON('signalRegistry', 'zeus_signal_registry', function () { if (typeof _srLoad === 'function') _srLoad() })
      _restoreJSON('perfStats', 'zeus_perf_v1', function () { if (typeof loadPerfFromStorage === 'function') loadPerfFromStorage() })
      _restoreJSON('dailyPnl', 'zeus_daily_pnl_v1', function () { if (typeof loadDailyPnl === 'function') loadDailyPnl() })
      _restoreJSON('postmortem', 'zeus_postmortem_v1', null)
      _restoreJSON('adaptive', 'zeus_adaptive_v1', function () { if (typeof _adaptLoad === 'function') _adaptLoad() })
      _restoreJSON('notifications', 'zeus_notifications', function () { if (typeof _ncLoad === 'function') { _ncLoad(); _ncRenderList(); _ncUpdateBadge() } })
      _restoreJSON('scannerSyms', 'zeus_mscan_syms', null)
      _restoreJSON('midstackOrder', 'zt_midstack_order', null)
      if (sec.aubData && sec.aubData.data) {
        const aubLocalDirty = _ucDirtyTs['aubData'] || 0
        if (sec.aubData.ts > aubLocalDirty) {
          const ad = sec.aubData.data
          if (ad.bb != null) localStorage.setItem('aub_bb', JSON.stringify(ad.bb))
          if (ad.macro != null) localStorage.setItem('aub_macro', JSON.stringify(ad.macro))
          if (ad.sim != null) localStorage.setItem('aub_sim_last', JSON.stringify(ad.sim))
          if (ad.expanded != null) localStorage.setItem('aub_expanded', ad.expanded)
          _ucDirtyTs['aubData'] = sec.aubData.ts; _dirty = true
          console.log('[UC] \u2705 aubData merged from server')
        }
      }
      if (sec.ofHud && sec.ofHud.data) {
        const ofLocalDirty = _ucDirtyTs['ofHud'] || 0
        if (sec.ofHud.ts > ofLocalDirty) {
          const od = sec.ofHud.data
          if (od.v2 != null) localStorage.setItem('of_hud_v2', od.v2)
          if (od.pos != null) localStorage.setItem('of_hud_pos_v1', od.pos)
          if (od.anchor != null) localStorage.setItem('of_hud_anchor_x_v1', od.anchor)
          _ucDirtyTs['ofHud'] = sec.ofHud.ts; _dirty = true
          console.log('[UC] \u2705 ofHud merged from server')
        }
      }
      if (sec.teacherData && sec.teacherData.data) {
        const tLocalDirty = _ucDirtyTs['teacherData'] || 0
        if (sec.teacherData.ts > tLocalDirty) {
          const td = sec.teacherData.data
          if (td.config != null) localStorage.setItem('zeus_teacher_config', JSON.stringify(td.config))
          if (td.sessions != null) localStorage.setItem('zeus_teacher_sessions', JSON.stringify(td.sessions))
          if (td.lessons != null) localStorage.setItem('zeus_teacher_lessons', JSON.stringify(td.lessons))
          if (td.stats != null) localStorage.setItem('zeus_teacher_stats', JSON.stringify(td.stats))
          if (td.memory != null) localStorage.setItem('zeus_teacher_memory', JSON.stringify(td.memory))
          if (td.v2state != null) localStorage.setItem('zeus_teacher_v2state', JSON.stringify(td.v2state))
          if (td.panelOpen != null) localStorage.setItem('zeus_teacher_panel_open', td.panelOpen)
          _ucDirtyTs['teacherData'] = sec.teacherData.ts; _dirty = true
          if (typeof w.teacherLoadAllPersistent === 'function') w.teacherLoadAllPersistent()
          console.log('[UC] \u2705 teacherData merged from server')
        }
      }
      if (sec.ariaNovaHud && sec.ariaNovaHud.data) {
        const anLocalDirty = _ucDirtyTs['ariaNovaHud'] || 0
        if (sec.ariaNovaHud.ts > anLocalDirty) {
          const an = sec.ariaNovaHud.data
          if (an.aria != null) localStorage.setItem('aria_v1', JSON.stringify(an.aria))
          if (an.nova != null) localStorage.setItem('nova_v1', JSON.stringify(an.nova))
          _ucDirtyTs['ariaNovaHud'] = sec.ariaNovaHud.ts; _dirty = true
          console.log('[UC] \u2705 ariaNovaHud merged from server')
        }
      }
      if (sec.aresData && sec.aresData.data) {
        const arLocalDirty = _ucDirtyTs['aresData'] || 0
        if (sec.aresData.ts > arLocalDirty) {
          const ad2 = sec.aresData.data
          if (ad2.wallet != null) localStorage.setItem('ARES_MISSION_STATE_V1_vw2', JSON.stringify(ad2.wallet))
          if (ad2.positions != null) localStorage.setItem('ARES_POSITIONS_V1', JSON.stringify(ad2.positions))
          if (ad2.state != null) localStorage.setItem('ARES_STATE_V1', JSON.stringify(ad2.state))
          if (ad2.init != null) localStorage.setItem('ares_init_v1', JSON.stringify(ad2.init))
          if (ad2.lastTradeTs != null) localStorage.setItem('ARES_LAST_TRADE_TS', ad2.lastTradeTs)
          if (ad2.journal != null) localStorage.setItem('ARES_JOURNAL_V1', JSON.stringify(ad2.journal))
          _ucDirtyTs['aresData'] = sec.aresData.ts; _dirty = true
          console.log('[UC] \u2705 aresData merged from server')
        }
      }
      if (_dirty) { try { localStorage.setItem('zeus_uc_dirty_ts', JSON.stringify(_ucDirtyTs)) } catch (_) { /* */ } }
    })
    .catch(function (e: any) { _ucPulling = false; console.warn('[UC] pull err:', e.message) })
}

// ── CSS inline ───────────────────────────────────────────────────
;(function _ncInjectCSS() {
  if (typeof document === 'undefined') return
  const s = document.createElement('style')
  s.textContent = `
  #nc-bell-wrap { position:relative; display:inline-flex; }
  #nc-badge {
    display:none; position:absolute; top:-4px; right:-5px;
    background:var(--red); color:#fff; border-radius:50%;
    font-size:10px; min-width:12px; height:12px; line-height:12px;
    text-align:center; padding:0 2px; font-family:var(--ff);
    pointer-events:none; font-weight:700;
  }
  #mnotifications .modal { max-height:85vh; display:flex; flex-direction:column; }
  .nc-tabs { display:flex; gap:2px; padding:6px 10px;
    background:#040810; border-bottom:1px solid #0a1a2a; flex-shrink:0; }
  .nc-tab { font-size:11px; padding:3px 10px; border-radius:2px; cursor:pointer;
    border:1px solid #0a1a2a; color:var(--dim); font-family:var(--ff);
    letter-spacing:1px; background:transparent; }
  .nc-tab.act { border-color:var(--gold); color:var(--gold); background:#f0c04011; }
  .nc-actions { display:flex; gap:6px; padding:6px 10px;
    border-bottom:1px solid #0a1a2a; flex-shrink:0; }
  #nc-list { flex:1; overflow-y:auto; max-height:55vh; }
  .nc-item { padding:6px 10px; border-bottom:1px solid #0a1020; }
  .nc-item.nc-read { opacity:.5; }
  .nc-item.critical { border-left:3px solid var(--red); }
  .nc-item.warning  { border-left:3px solid var(--ylw); }
  .nc-item.info     { border-left:3px solid #44aaff; }
  .nc-item-hdr { display:flex; align-items:center; gap:5px; margin-bottom:2px; }
  .nc-ico   { font-size:12px; }
  .nc-type  { font-size:11px; color:var(--gold); letter-spacing:1px;
    text-transform:uppercase; flex:1; }
  .nc-time  { font-size:11px; color:var(--dim); }
  .nc-mark  { background:none; border:1px solid #0a1a2a; color:var(--dim);
    font-size:11px; padding:0 4px; border-radius:2px; cursor:pointer;
    font-family:var(--ff); flex-shrink:0; }
  .nc-mark:hover { color:var(--grn); border-color:var(--grn); }
  .nc-msg   { font-size:12px; color:var(--txt); line-height:1.5; }
  .nc-empty { padding:20px; text-align:center; color:var(--dim); font-size:12px; }
  `
  document.head.appendChild(s)
})()

// ── SR Strip toggle ──────────────────────────────────────────────
export function srStripToggle() {
  const strip = document.getElementById('sr-strip')
  if (!strip) return
  strip.classList.toggle('sr-strip-open')
  if (strip.classList.contains('sr-strip-open')) {
    _srRenderList()
    _srRenderStats()
  }
}

export function srStripUpdateBar() {
  const st = SIGNAL_REGISTRY.stats
  const totalEl = document.getElementById('sr-strip-total')
  const wrEl = document.getElementById('sr-strip-wr')
  const lastEl = document.getElementById('sr-strip-last')
  if (totalEl) totalEl.innerHTML = `<b>${st.total || 0}</b> semnale`
  if (wrEl) {
    if (st.total) {
      const wrGood = st.winRate >= 50
      wrEl.innerHTML = `WR: <b class="${wrGood ? 'sr-strip-wr-good' : 'sr-strip-wr-bad'}">${st.winRate}%</b>`
    } else {
      wrEl.innerHTML = ''
    }
  }
  if (lastEl) {
    const last = SIGNAL_REGISTRY.signals[0]
    if (last) {
      const dirCol = last.direction === 'LONG' ? '#00ff88' : last.direction === 'SHORT' ? '#ff3355' : '#f0c040'
      lastEl.innerHTML = `<span style="color:${dirCol}">${last.direction}</span> <span style="color:#00d9ff88">${(last.type || '').slice(0, 12)}</span>`
    } else {
      lastEl.innerHTML = ''
    }
  }
}

// ── CSS inline for Signal Registry ───────────────────────────
;(function _srInjectCSS() {
  if (typeof document === 'undefined') return
  const style = document.createElement('style')
  style.textContent = `
  #sr-sec { font-family: var(--ff); }
  #sr-strip { background:transparent; border-bottom:none; margin:3px 6px; position:relative; }
  #sr-strip-bar { display:flex; align-items:center; justify-content:space-between; padding:0; min-height:44px; cursor:pointer; user-select:none; gap:0; transition:border-color .25s,box-shadow .25s; color:#00d9ff77; background:none; border:none; border-radius:10px; opacity:1; position:relative; overflow:hidden; }
  #sr-strip-bar:hover { }
  #sr-strip-title { font-size:13px; font-weight:700; letter-spacing:2px; color:#00d9ff; display:flex; align-items:center; gap:5px; }
  #sr-strip-info { display:flex; align-items:center; gap:8px; }
  .sr-strip-stat { font-size:11px; color:#00d9ff66; letter-spacing:0.5px; padding:2px 6px; border-radius:999px; background:#00d9ff11; border:1px solid #00d9ff22; }
  .sr-strip-stat b { color:#00d9ff; }
  .sr-strip-wr-good { color:#00ff88 !important; }
  .sr-strip-wr-bad  { color:#ff3355 !important; }
  .sr-strip-chev { font-size:8px; color:#00d9ff44; transition:transform .25s; margin-left:2px; flex-shrink:0; opacity:.35; }
  #sr-strip.sr-strip-open .sr-strip-chev { transform:rotate(180deg); }
  #sr-strip.sr-strip-open #sr-strip-bar { opacity:1; }
  #sr-strip-info { display:none; }
  #sr-strip.sr-strip-open #sr-strip-info { display:flex; }
  #sr-strip-panel { display:none; border-top:1px solid #00d9ff12; }
  #sr-strip.sr-strip-open #sr-strip-panel { display:block; }
  #mtf-strip { background:transparent; border-bottom:none; margin:3px 6px; }
  #mtf-strip-bar { display:flex; align-items:center; gap:0; padding:0; cursor:pointer; min-height:44px; user-select:none; -webkit-tap-highlight-color:transparent; transition:border-color .25s,box-shadow .25s; color:#00d9ff77; background:none; border:none; border-radius:10px; opacity:1; position:relative; overflow:hidden; }
  #mtf-strip-bar:hover { }
  #mtf-strip-title { font-family:var(--ff); font-size:13px; letter-spacing:2px; color:#00d9ff; flex-shrink:0; }
  #mtf-strip-score { font-family:var(--ff); font-size:13px; color:#00d9ff66; margin-left:auto; }
  #mtf-bar-condensed { display:flex; align-items:center; gap:6px; margin-left:6px; flex:1; overflow:hidden; }
  .mtf-bar-pill { font-size:11px; padding:2px 6px; border-radius:999px; background:#00d9ff11; border:1px solid #00d9ff22; color:#00d9ff88; white-space:nowrap; }
  .mtf-bar-pill.bull { background:#00d97a11; border-color:#00d97a33; color:#00d97a; }
  .mtf-bar-pill.bear { background:#ff335511; border-color:#ff335533; color:#ff3355; }
  .mtf-bar-pill.squeeze { background:#f0c04011; border-color:#f0c04033; color:#f0c040; }
  #mtf-strip.mtf-open #mtf-bar-condensed { display:none; }
  #mtf-strip-chev { font-size:8px; color:#00d9ff44; transition:transform .25s; margin-left:2px; flex-shrink:0; opacity:.35; }
  #mtf-strip.mtf-open #mtf-strip-chev { transform:rotate(180deg); }
  #mtf-strip.mtf-open #mtf-strip-bar { opacity:1; }
  #mtf-strip-panel { display:none; padding:8px 12px 10px; border-top:1px solid #00d9ff12; border-radius:0 0 10px 10px; margin:2px 8px 0; }
  #mtf-strip.mtf-open #mtf-strip-panel { display:block; }
  .mtf-row { display:flex; align-items:center; gap:6px; margin-bottom:5px; font-family:var(--ff); font-size:13px; }
  .mtf-lbl { color:#00d9ff44; letter-spacing:1px; width:82px; flex-shrink:0; }
  .mtf-val { color:#7a9ab8; }
  .mtf-val.good { color:#00d97a; text-shadow:0 0 6px #00d97a55; }
  .mtf-val.warn { color:#f0c040; text-shadow:0 0 6px #f0c04055; }
  .mtf-val.bad  { color:#ff3355; text-shadow:0 0 6px #ff335555; }
  .mtf-score-bar { height:4px; border-radius:2px; background:#0a1525; margin-top:6px; overflow:hidden; }
  .mtf-score-fill { height:100%; border-radius:2px; transition:width .5s; background:linear-gradient(90deg,#00d9ff,#00ffcc); }
  .mtf-tf-row { display:flex; gap:5px; margin-top:4px; }
  .mtf-tf-badge { font-family:var(--ff); font-size:12px; letter-spacing:1px; padding:3px 7px; border-radius:2px; border:1px solid #00d9ff22; color:#00d9ff66; }
  .mtf-tf-badge.bull { color:#00d97a; border-color:#00d97a44; background:#00d97a0a; }
  .mtf-tf-badge.bear { color:#ff3355; border-color:#ff335544; background:#ff33550a; }
  .mtf-tf-badge.neut { color:#7a9ab8; border-color:#7a9ab822; }
  .mtf-update-ts { font-family:var(--ff); font-size:11px; color:#00d9ff22; letter-spacing:1px; margin-top:6px; }
  #sr-stats { display:flex; flex-wrap:wrap; gap:6px; padding:6px 8px;
    background:#040810; border-bottom:1px solid #0a1a2a; }
  .sr-stat { font-size:12px; color:var(--dim); }
  .sr-stat b { color:var(--gold); }
  .sr-win  { color:var(--grn) !important; }
  .sr-loss { color:var(--red) !important; }
  #sr-list { max-height:220px; overflow-y:auto; }
  .sr-row  { display:flex; align-items:center; gap:4px; padding:3px 8px;
    border-bottom:1px solid #0a1020; font-size:12px; }
  .sr-row:hover { background:#05081a; }
  .sr-time  { color:var(--dim); width:32px; flex-shrink:0; }
  .sr-src   { width:14px; flex-shrink:0; }
  .sr-type  { color:#9ab; flex:1; min-width:0; white-space:nowrap; overflow:hidden; }
  .sr-dir   { width:36px; text-align:center; flex-shrink:0; font-size:11px; border-radius:2px; padding:1px 3px; }
  .sr-long  { background:#00d97a22; color:var(--grn); }
  .sr-short { background:#ff335522; color:var(--red); }
  .sr-neut  { background:#f0c04011; color:var(--gold); }
  .sr-score { width:28px; text-align:right; color:var(--gold); flex-shrink:0; }
  .sr-outcome { width:72px; text-align:right; flex-shrink:0; }
  .sr-pend  { color:var(--dim); }
  .sr-empty { padding:16px; text-align:center; color:var(--dim); font-size:12px; }
  `
  document.head.appendChild(style)
})()

// ═══════════════════════════════════════════════════════════════════
// MTF STRUCTURAL MODEL
// ═══════════════════════════════════════════════════════════════════
export function buildMTFStructure() {
  try {
    const BM = w.BM
    const klines = getKlines()
    if (!klines.length || klines.length < 50) {
      BM.structure.regime = 'insufficient data'
      BM.structure.score = 0
      BM.structure.lastUpdate = Date.now()
      return BM.structure
    }
    const reg = detectRegimeEnhanced(klines)
    BM.structure.regime = reg.regime || 'unknown'
    BM.structure.adx = reg.adx || 0
    BM.structure.atrPct = reg.atrPct || 0
    BM.structure.squeeze = !!reg.squeeze
    BM.structure.volMode = reg.volMode || '\u2014'
    BM.structure.structureLabel = reg.structure || '\u2014'
    if (typeof updateMTFAlignment === 'function') updateMTFAlignment()
    BM.structure.mtfAlign = {
      '15m': BM.mtf?.['15m'] || 'neut',
      '1h': BM.mtf?.['1h'] || 'neut',
      '4h': BM.mtf?.['4h'] || 'neut',
    }
    let score = 0
    score += Math.min(30, Math.round((BM.structure.adx / 50) * 30))
    const mainDir = reg.slope20 >= 0 ? 'bull' : 'bear'
    ;['15m', '1h', '4h'].forEach((tf: string) => {
      const dir = BM.structure.mtfAlign[tf]
      if (dir === mainDir) score += 15
      else if (dir === 'neut') score += 5
    })
    if (BM.structure.volMode === 'expansion') score += 15
    else if (BM.structure.volMode === 'contraction') score -= 5
    if (BM.structure.squeeze) score += 10
    BM.structure.score = Math.max(0, Math.min(100, score))
    BM.structure.lastUpdate = Date.now()
    updateVolRegime(reg.atrPct || 0)
    return BM.structure
  } catch (e: any) {
    console.warn('[MTF] buildMTFStructure error:', e.message)
    return w.BM.structure
  }
}

export function updateVolRegime(atrPct: number) {
  try {
    const BM = w.BM
    if (!atrPct || !Number.isFinite(atrPct)) return
    BM.volBuffer.push(atrPct)
    if (BM.volBuffer.length > 200) BM.volBuffer.shift()
    if (BM.volBuffer.length < 10) {
      BM.volRegime = '\u2014'
      BM.volPct = null
      return
    }
    const sorted = BM.volBuffer.slice().sort((a: number, b: number) => a - b)
    const rank = sorted.filter((v: number) => v <= atrPct).length
    const pct = Math.round((rank / sorted.length) * 100)
    BM.volPct = pct
    if (pct >= 85) BM.volRegime = 'EXTREME'
    else if (pct >= 60) BM.volRegime = 'HIGH'
    else if (pct >= 30) BM.volRegime = 'MED'
    else BM.volRegime = 'LOW'
  } catch (e: any) {
    console.warn('[VOL] updateVolRegime error:', e.message)
  }
}

export function updateLiqCycle() {
  try {
    const BM = w.BM
    const klines = getKlines()
    const curPrice = getPrice()
    const lc = BM.liqCycle
    if (klines.length < 20) {
      lc.currentSweep = 'none'
      lc.lastUpdate = Date.now()
      return
    }
    const workKlines = klines.slice(-200)
    const sweep = (typeof detectSweepDisplacement === 'function')
      ? detectSweepDisplacement(workKlines)
      : { type: 'none', reclaim: false, displacement: false }
    lc.currentSweep = sweep.type || 'none'
    lc.sweepDisplacement = !!sweep.displacement
    const window50 = klines.slice(-50)
    let sweepsCount = 0
    let trapsCount = 0
    if (window50.length >= 20) {
      const step = Math.floor((window50.length - 20) / 5) || 1
      for (let i = 0; i + 20 <= window50.length; i += step) {
        const sub = window50.slice(i, i + 20)
        const cur = sub[sub.length - 1]
        const prevHigh = Math.max(...sub.slice(0, -1).map((k: any) => k.high))
        const prevLow = Math.min(...sub.slice(0, -1).map((k: any) => k.low))
        const atr2 = sub.slice(-5).reduce((a: number, k: any) => a + (k.high - k.low), 0) / 5
        if (cur.high > prevHigh && cur.close < prevHigh) {
          sweepsCount++
          const isDisplacement = (prevHigh - cur.close) > atr2 * 0.5
          if (!isDisplacement) trapsCount++
        } else if (cur.low < prevLow && cur.close > prevLow) {
          sweepsCount++
          const isDisplacement = (cur.close - prevLow) > atr2 * 0.5
          if (!isDisplacement) trapsCount++
        }
      }
    }
    lc.sweepsTotal = sweepsCount
    lc.trapsTotal = trapsCount
    lc.trapRate = sweepsCount > 0 ? Math.round((trapsCount / sweepsCount) * 100) / 100 : null
    const magnets = (typeof S !== 'undefined' && S.magnets) ? S.magnets : { above: [], below: [] }
    const nearAbove = magnets.above?.[0]
    const nearBelow = magnets.below?.[0]
    lc.magnetAboveDist = (nearAbove && curPrice)
      ? Math.round(((nearAbove.price - curPrice) / curPrice) * 10000) / 100
      : null
    lc.magnetBelowDist = (nearBelow && curPrice)
      ? Math.round(((curPrice - nearBelow.price) / curPrice) * 10000) / 100
      : null
    if (lc.magnetAboveDist != null && lc.magnetBelowDist != null) {
      lc.magnetBias = lc.magnetAboveDist < lc.magnetBelowDist ? 'above' : 'below'
    } else if (lc.magnetAboveDist != null) {
      lc.magnetBias = 'above'
    } else if (lc.magnetBelowDist != null) {
      lc.magnetBias = 'below'
    } else {
      lc.magnetBias = '\u2014'
    }
    lc.lastUpdate = Date.now()
  } catch (e: any) {
    console.warn('[LIQ] updateLiqCycle error:', e.message)
  }
}

export function renderMTFPanel() {
  try {
    const BM = w.BM
    const st = BM.structure
    const _el = (id: string) => document.getElementById(id)
    const _cls = (el: any, cls: string) => { if (el) { el.className = 'mtf-val'; if (cls) el.classList.add(cls) } }
    const rEl = _el('mtf-regime')
    if (rEl) {
      const rMap: any = { trend: 'good', breakout: 'good', squeeze: 'warn', range: 'warn', panic: 'bad', volatile: 'bad', unknown: '', 'insufficient data': '' }
      rEl.textContent = (st.regime || '\u2014').toUpperCase()
      _cls(rEl, rMap[st.regime] || '')
    }
    const sEl = _el('mtf-structure')
    if (sEl) {
      sEl.textContent = st.structureLabel || '\u2014'
      _cls(sEl, st.structureLabel === 'HH/HL' ? 'good' : st.structureLabel === 'LH/LL' ? 'bad' : 'warn')
    }
    const aEl = _el('mtf-atr')
    if (aEl) {
      aEl.textContent = st.atrPct ? st.atrPct.toFixed(2) + '%' : '\u2014'
      _cls(aEl, st.atrPct > 2 ? 'bad' : st.atrPct > 1 ? 'warn' : 'good')
    }
    const vEl = _el('mtf-vol')
    if (vEl) {
      vEl.textContent = (st.volMode || '\u2014').toUpperCase()
      _cls(vEl, st.volMode === 'expansion' ? 'good' : st.volMode === 'contraction' ? 'warn' : '')
    }
    const sqEl = _el('mtf-squeeze')
    if (sqEl) {
      sqEl.innerHTML = st.squeeze ? _ZI.bolt + ' ACTIV' : 'OFF'
      _cls(sqEl, st.squeeze ? 'warn' : '')
    }
    const adxEl = _el('mtf-adx')
    if (adxEl) {
      adxEl.textContent = st.adx || '\u2014'
      _cls(adxEl, st.adx > 30 ? 'good' : st.adx > 15 ? 'warn' : 'bad')
    }
    const vrEl = _el('mtf-vol-regime')
    if (vrEl) {
      vrEl.textContent = BM.volRegime || '\u2014'
      const vrMap: any = { 'EXTREME': 'bad', 'HIGH': 'warn', 'MED': '', 'LOW': 'good' }
      _cls(vrEl, vrMap[BM.volRegime] || '')
    }
    const vpEl = _el('mtf-vol-pct')
    if (vpEl) {
      vpEl.textContent = BM.volPct != null ? BM.volPct + 'th percentila' : '\u2014 (acumulez date)'
      _cls(vpEl, BM.volPct != null ? (BM.volPct >= 85 ? 'bad' : BM.volPct >= 60 ? 'warn' : BM.volPct < 30 ? 'good' : '') : '')
    }
    const lc = BM.liqCycle
    const swEl = _el('mtf-sweep')
    if (swEl) {
      const sw = lc.sweepSimple
      if (sw && sw.dir !== '\u2014') {
        swEl.textContent = sw.dir + (sw.strength > 0 ? ' ' + sw.strength + '%' : '')
        _cls(swEl, sw.dir === 'BULL' ? 'good' : 'warn')
      } else {
        const swMap: any = { 'above': '\u2B06 ABOVE', 'below': '\u2B07 BELOW', 'none': '\u2014' }
        swEl.textContent = swMap[lc.currentSweep] || '\u2014'
        _cls(swEl, lc.currentSweep !== 'none' ? (lc.sweepDisplacement ? 'good' : 'warn') : '')
      }
    }
    const trEl = _el('mtf-trap-rate')
    if (trEl) {
      if (lc.trapRate != null) {
        const trPct = Math.round(lc.trapRate * 100)
        trEl.textContent = trPct + '% (' + lc.trapsTotal + '/' + lc.sweepsTotal + ')'
        _cls(trEl, trPct >= 70 ? 'bad' : trPct >= 40 ? 'warn' : 'good')
      } else {
        trEl.textContent = '\u2014 (date insuficiente)'
        _cls(trEl, '')
      }
    }
    const maEl = _el('mtf-mag-above')
    if (maEl) {
      maEl.textContent = lc.magnetAboveDist != null ? '+' + lc.magnetAboveDist + '%' : '\u2014'
      _cls(maEl, lc.magnetAboveDist != null ? (lc.magnetAboveDist < 0.5 ? 'warn' : '') : '')
    }
    const mbEl = _el('mtf-mag-below')
    if (mbEl) {
      mbEl.textContent = lc.magnetBelowDist != null ? '-' + lc.magnetBelowDist + '%' : '\u2014'
      _cls(mbEl, lc.magnetBelowDist != null ? (lc.magnetBelowDist < 0.5 ? 'warn' : '') : '')
    }
    const mbsEl = _el('mtf-mag-bias')
    if (mbsEl) {
      const biasMap: any = { 'above': '\u2B06 ABOVE', 'below': '\u2B07 BELOW', '\u2014': '\u2014' }
      mbsEl.textContent = biasMap[lc.magnetBias] || '\u2014'
      _cls(mbsEl, lc.magnetBias === 'above' ? 'good' : lc.magnetBias === 'below' ? 'warn' : '')
    }
    ;['15m', '1h', '4h'].forEach((tf: string) => {
      const b = _el('mtf-' + tf)
      if (b) {
        const dir = st.mtfAlign[tf] || 'neut'
        b.className = 'mtf-tf-badge ' + dir
        b.textContent = tf + ' ' + (dir === 'bull' ? '\u25B2' : dir === 'bear' ? '\u25BC' : '\u2014')
      }
    })
    const sc = st.score || 0
    const scTxt = _el('mtf-score-txt')
    const scFill = _el('mtf-score-fill')
    const scBar = _el('mtf-strip-score')
    if (scTxt) scTxt.textContent = sc + ' / 100'
    if (scFill) (scFill as any).style.width = sc + '%'
    if (scBar) scBar.textContent = sc + ' / 100'
    const tsEl = _el('mtf-ts')
    if (tsEl && st.lastUpdate) {
      const d = new Date(st.lastUpdate)
      tsEl.textContent = 'actualizat ' + d.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    }
    // Regime Engine rows
    const re = BM.regimeEngine || {}
    const reEl = _el('re-regime')
    if (reEl) {
      const reMap: any = { 'TREND_UP': 'good', 'TREND_DOWN': 'bad', 'EXPANSION': 'good', 'SQUEEZE': 'warn', 'RANGE': '', 'CHAOS': 'bad', 'LIQUIDATION_EVENT': 'bad' }
      reEl.textContent = (re.regime || '\u2014')
      _cls(reEl, reMap[re.regime] || '')
    }
    const reTrap = _el('re-trap')
    if (reTrap) {
      reTrap.textContent = (re.trapRisk != null ? re.trapRisk + '%' : '\u2014')
      _cls(reTrap, re.trapRisk >= 60 ? 'bad' : re.trapRisk >= 30 ? 'warn' : 'good')
    }
    const reConf = _el('re-conf')
    if (reConf) {
      reConf.textContent = (re.confidence != null ? re.confidence + '%' : '\u2014')
      _cls(reConf, re.confidence >= 70 ? 'good' : re.confidence >= 40 ? 'warn' : 'bad')
    }
    const pf = BM.phaseFilter || {}
    const pfPhase = _el('pf-phase')
    if (pfPhase) {
      pfPhase.textContent = (pf.phase || '\u2014') + (pf.allow ? '' : ' \u2718')
      const pfMap: any = { 'TREND': 'good', 'EXPANSION': 'good', 'RANGE': '', 'SQUEEZE': 'warn', 'CHAOS': 'bad', 'LIQ_EVENT': 'bad' }
      _cls(pfPhase, pfMap[pf.phase] || '')
    }
    const pfRisk = _el('pf-risk')
    if (pfRisk) {
      pfRisk.textContent = (pf.riskMode || '\u2014')
      _cls(pfRisk, pf.riskMode === 'normal' ? 'good' : pf.riskMode === 'reduced' ? 'warn' : 'bad')
    }
    const pfSize = _el('pf-size')
    if (pfSize) {
      pfSize.textContent = (pf.sizeMultiplier != null ? '\u00D7' + pf.sizeMultiplier : '\u2014')
      _cls(pfSize, pf.sizeMultiplier >= 1 ? 'good' : pf.sizeMultiplier >= 0.6 ? 'warn' : 'bad')
    }
    const reBarPill = _el('mtf-bar-re')
    if (reBarPill) {
      reBarPill.textContent = (re.regime || '\u2014')
      reBarPill.className = 'mtf-bar-pill' + (re.regime === 'TREND_UP' || re.regime === 'EXPANSION' ? ' bull' : re.regime === 'CHAOS' || re.regime === 'LIQUIDATION_EVENT' ? ' bear' : '')
    }
    const brRegime = _el('mtf-bar-regime')
    if (brRegime) {
      brRegime.textContent = (st.regime || '\u2014').toUpperCase()
      brRegime.className = 'mtf-bar-pill' + (st.regime === 'trend' || st.regime === 'breakout' ? ' bull' : st.regime === 'panic' || st.regime === 'volatile' ? ' bear' : '')
    }
    const brScore = _el('mtf-bar-score')
    if (brScore) brScore.textContent = (st.score || 0) + '/100'
    const brVol = _el('mtf-bar-vol')
    if (brVol) brVol.textContent = (BM.volRegime || '\u2014')
    const brSqz = _el('mtf-bar-squeeze')
    if (brSqz) { (brSqz as any).style.display = st.squeeze ? '' : 'none' }
  } catch (e: any) {
    console.warn('[MTF] renderMTFPanel error:', e.message)
  }
}

export function _coreTickMI() {
  try {
    const BM = w.BM
    BM.core.ticks++
    buildMTFStructure()
    const now = Date.now()
    if (now - BM.core.lastLiqTs >= 60000) {
      updateLiqCycle()
      BM.core.lastLiqTs = now
    }
    BM.regimeEngine = RegimeEngine.compute()
    BM.phaseFilter = PhaseFilter.evaluate(BM.regimeEngine)
    if (typeof computeMarketAtmosphere === 'function') {
      computeMarketAtmosphere()
    }
    refreshLiqCycleLight()
    refreshSweepLight()
    renderMTFPanel()
    if (typeof w.ARES !== 'undefined' && document.getElementById('ares-strip')?.classList.contains('open')) {
      _aresRender()
    }
  } catch (e: any) {
    console.warn('[CORE] _coreTickMI error:', e.message)
  }
  // [9A-2] Notify React brainStore — MI tick writes BM.regimeEngine/phaseFilter/atmosphere
  try { window.dispatchEvent(new CustomEvent('zeus:brainStateChanged')) } catch (_) {}
}

export function refreshLiqCycleLight() {
  try {
    const BM = w.BM
    const S = w.S
    const p = (BM && Number.isFinite(BM.lastPrice)) ? BM.lastPrice
      : (S && Number.isFinite(S.lastPrice)) ? S.lastPrice
        : (S && Number.isFinite(S.price)) ? S.price
          : null
    if (!Number.isFinite(p) || p <= 0) return
    if (!BM.liqCycle) BM.liqCycle = {}
    const lc = BM.liqCycle
    const magnets = (S && S.magnets) ? S.magnets : { above: [], below: [] }
    const nearAbove = magnets.above?.[0]
    const nearBelow = magnets.below?.[0]
    lc.magnetAboveDist = (nearAbove && nearAbove.price)
      ? Math.round(((nearAbove.price - p) / p) * 10000) / 100
      : null
    lc.magnetBelowDist = (nearBelow && nearBelow.price)
      ? Math.round(((p - nearBelow.price) / p) * 10000) / 100
      : null
    if (lc.magnetAboveDist != null && lc.magnetBelowDist != null) {
      lc.magnetBias = lc.magnetAboveDist < lc.magnetBelowDist ? 'above' : 'below'
    } else if (lc.magnetAboveDist != null) {
      lc.magnetBias = 'above'
    } else if (lc.magnetBelowDist != null) {
      lc.magnetBias = 'below'
    } else {
      lc.magnetBias = '\u2014'
    }
  } catch (_e) { /* silent */ }
}

export function detectSweepSimple(bars: any, lookback?: number) {
  lookback = lookback || 20
  try {
    if (!bars || bars.length < lookback + 2) return { dir: '\u2014', strength: 0 }
    const slice = bars.slice(-(lookback + 1), -1)
    const prevHigh = Math.max.apply(null, slice.map(function (b: any) { return b.high }))
    const prevLow = Math.min.apply(null, slice.map(function (b: any) { return b.low }))
    const last = bars[bars.length - 1]
    let dir = '\u2014'
    if (last.high > prevHigh && last.close < prevHigh) dir = 'BEAR'
    else if (last.low < prevLow && last.close > prevLow) dir = 'BULL'
    const rng = Math.max(1e-9, last.high - last.low)
    const wick = (dir === 'BEAR') ? Math.max(0, last.high - prevHigh)
      : (dir === 'BULL') ? Math.max(0, prevLow - last.low)
        : 0
    const strength = dir === '\u2014' ? 0 : Math.max(0, Math.min(100, Math.round((wick / rng) * 100)))
    return { dir: dir, strength: strength }
  } catch (_e) { return { dir: '\u2014', strength: 0 } }
}

export function refreshSweepLight() {
  try {
    const BM = w.BM
    if (!BM.liqCycle) BM.liqCycle = {}
    const _kl = getKlines()
    const bars = _kl.length > 22 ? _kl.slice(-100) : null
    const sw = bars ? detectSweepSimple(bars, 20) : { dir: '\u2014', strength: 0 }
    BM.liqCycle.sweepSimple = sw
    if (sw.dir === 'BEAR') {
      BM.liqCycle.currentSweep = 'below'
      BM.liqCycle.sweepDisplacement = true
    } else if (sw.dir === 'BULL') {
      BM.liqCycle.currentSweep = 'above'
      BM.liqCycle.sweepDisplacement = true
    } else {
      BM.liqCycle.currentSweep = 'none'
      BM.liqCycle.sweepDisplacement = false
    }
  } catch (_e) { /* silent */ }
}

export function ZT_capArr(arr: any, max: number) {
  try {
    if (!arr || !arr.length || !Number.isFinite(max) || max <= 0) return
    if (arr.length > max) arr.splice(0, arr.length - max)
  } catch (_) { /* */ }
}

export function ZT_safeInterval(name: string, fn: any, ms: number) {
  try {
    if (!w.__ZT_INT_ERR__) w.__ZT_INT_ERR__ = {}
    const wrap = function () {
      try { fn() }
      catch (e: any) {
        w.__ZT_INT_ERR__[name] = (w.__ZT_INT_ERR__[name] || 0) + 1
        console.warn('[ZT interval error]', name, e && e.message ? e.message : e)
        if (w.__ZT_INT_ERR__[name] === 3) {
          try { if (w.Intervals && w.Intervals.clear) w.Intervals.clear(name) } catch (_) { /* */ }
          try {
            if (w.Intervals && w.Intervals.set) w.Intervals.set(name, wrap, ms)
            else setInterval(wrap, ms)
          } catch (_) { /* */ }
        }
      }
    }
    return wrap
  } catch (_) { return fn }
}

export function _safeCoreTickMI() {
  try {
    if (typeof _coreTickMI === 'function') _coreTickMI()
  } catch (e) {
    console.warn('[MTF] _coreTickMI error', e)
  }
  computePredatorState()
}

export function mtfStripToggle() {
  const BM = w.BM
  const Intervals = w.Intervals
  const strip = document.getElementById('mtf-strip')
  if (!strip) return
  const isOpen = strip.classList.toggle('mtf-open')
  const chev = document.getElementById('mtf-strip-chev')
  if (chev) chev.style.transform = isOpen ? 'rotate(180deg)' : ''
  if (isOpen) {
    BM.core.mtfOn = true
    buildMTFStructure()
    updateLiqCycle()
    BM.core.lastLiqTs = Date.now()
    renderMTFPanel()
    Intervals.clear('coreMI')
    _safeCoreTickMI()
    Intervals.set('coreMI', ZT_safeInterval('coreMI', _safeCoreTickMI, 5000), 5000)
    setTimeout(function () { if (BM.core.mtfOn) { _safeCoreTickMI(); Intervals.set('coreMI', ZT_safeInterval('coreMI', _safeCoreTickMI, 5000), 5000) } }, 2000)
    console.log('[CORE] coreMI started | ticks:', BM.core.ticks)
  } else {
    console.log('[CORE] MTF panel closed — coreMI stays active | ticks:', BM.core.ticks)
  }
  try { localStorage.setItem('zeus_mtf_open', isOpen ? '1' : '0') } catch (_) { /* */ }
}

export function initMTFStrip() {
  try {
    const BM = w.BM
    const Intervals = w.Intervals
    if (localStorage.getItem('zeus_mtf_open') === '1') {
      const strip = document.getElementById('mtf-strip')
      if (strip) {
        strip.classList.add('mtf-open')
        const chev = document.getElementById('mtf-strip-chev')
        if (chev) chev.style.transform = 'rotate(180deg)'
        setTimeout(function () {
          try {
            BM.core.mtfOn = true
            buildMTFStructure()
            updateLiqCycle()
            BM.core.lastLiqTs = Date.now()
            renderMTFPanel()
            Intervals.clear('coreMI')
            _safeCoreTickMI()
            Intervals.set('coreMI', ZT_safeInterval('coreMI', _safeCoreTickMI, 5000), 5000)
            setTimeout(function () { if (BM.core.mtfOn) { _safeCoreTickMI(); Intervals.set('coreMI', ZT_safeInterval('coreMI', _safeCoreTickMI, 5000), 5000) } }, 2000)
            console.log('[CORE] coreMI started (restore) | ticks:', BM.core.ticks)
          } catch (e: any) {
            console.warn('[CORE] initMTFStrip restore error:', e.message)
          }
        }, 1500)
      }
    } else {
      setTimeout(function () {
        try {
          BM.core.mtfOn = true
          buildMTFStructure()
          updateLiqCycle()
          BM.core.lastLiqTs = Date.now()
          Intervals.clear('coreMI')
          _safeCoreTickMI()
          Intervals.set('coreMI', ZT_safeInterval('coreMI', _safeCoreTickMI, 5000), 5000)
          console.log('[CORE] coreMI started (always-on) | ticks:', BM.core.ticks)
        } catch (e: any) {
          console.warn('[CORE] initMTFStrip always-on error:', e.message)
        }
      }, 1500)
    }
  } catch (e: any) {
    console.warn('[MTF] initMTFStrip error:', e.message)
  }
}

// User Settings
export const USER_SETTINGS: any = {
  _version: 1,
  chart: { tf: '5m', tz: 'Europe/Bucharest', heatmap: null, colors: null },
  indicators: null,
  alerts: null,
  profile: 'fast',
  bmMode: null,
  assistArmed: false,
  autoTrade: {
    lev: 5, sl: 1.5, rr: 2, size: 200, maxPos: 4, killPct: 5,
    confMin: 65, sigMin: 3, multiSym: true, smartExitEnabled: false,
  },
}

let _usSettingsTimer: any = null
export function _usScheduleSave() {
  if (_usSettingsTimer) clearTimeout(_usSettingsTimer)
  _usSettingsTimer = setTimeout(_usSave, 800)
}
export function _usFlush() {
  if (_usSettingsTimer) { clearTimeout(_usSettingsTimer); _usSettingsTimer = null; _usSave() }
  if (_ucPushTimer) { clearTimeout(_ucPushTimer); _ucPushTimer = null; _ucPushBeacon() }
}

const _UC_BEACON_PENDING_KEY = 'zeus_uc_beacon_pending'
export function _ucPushBeacon() {
  try {
    const payload = JSON.stringify({
      _v: _ucVersion,
      ts: Date.now(),
      sections: _buildAllSections()
    })
    try { localStorage.setItem(_UC_BEACON_PENDING_KEY, payload) } catch (_) { /* */ }
    if (navigator.sendBeacon) {
      const sent = navigator.sendBeacon('/api/sync/user-context', new Blob([payload], { type: 'application/json' }))
      if (sent) {
        try { localStorage.removeItem(_UC_BEACON_PENDING_KEY) } catch (_) { /* */ }
        console.log('[UC] beacon pushed (all sections)')
      } else {
        console.warn('[UC] sendBeacon returned false — payload saved in LS for retry')
      }
    } else {
      fetch('/api/sync/user-context', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, credentials: 'same-origin', keepalive: true })
        .then(function () { try { localStorage.removeItem(_UC_BEACON_PENDING_KEY) } catch (_) { /* */ } })
        .catch(function () { /* LS pending will be retried on next boot */ })
    }
  } catch (_) { /* */ }
}
export function _ucRetryPendingBeacon() {
  try {
    const pending = localStorage.getItem(_UC_BEACON_PENDING_KEY)
    if (!pending) return
    const parsed = JSON.parse(pending)
    if (parsed.ts && (Date.now() - parsed.ts) > 300000) {
      localStorage.removeItem(_UC_BEACON_PENDING_KEY)
      console.log('[UC] Discarded stale pending beacon (>5min old)')
      return
    }
    console.log('[UC] Retrying unsent beacon from previous session...')
    fetch('/api/sync/user-context', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: pending, credentials: 'same-origin' })
      .then(function (r) { if (r.ok) { localStorage.removeItem(_UC_BEACON_PENDING_KEY); console.log('[UC] Pending beacon re-sent successfully') } })
      .catch(function () { console.warn('[UC] Pending beacon retry failed — will retry next boot') })
  } catch (_) { localStorage.removeItem(_UC_BEACON_PENDING_KEY) }
}
w._usFlush = _usFlush

let _usApplyDone = false

export function _usSave() {
  if (!_usApplyDone) { console.log('[US] skip save — _usApply not yet run'); return }
  try {
    const S = w.S
    const BM = w.BM
    USER_SETTINGS.chart.tf = S.chartTf || '5m'
    USER_SETTINGS.chart.tz = S.tz || 'Europe/Bucharest'
    USER_SETTINGS.chart.heatmap = S.heatmapSettings ? Object.assign({}, S.heatmapSettings) : null
    const _cv = (id: string, def: string) => { const e = document.getElementById(id) as any; return (e && e.value) ? e.value : def }
    USER_SETTINGS.chart.colors = {
      bull: _cv('ccBull', '#00d97a'),
      bear: _cv('ccBear', '#ff3355'),
      bullW: _cv('ccBullW', '#00d97a'),
      bearW: _cv('ccBearW', '#ff3355'),
      priceText: _cv('ccPriceText', '#7a9ab8'),
      priceBg: _cv('ccPriceBg', '#0a0f16'),
    }
    USER_SETTINGS.indicators = Object.assign({}, S.activeInds)
    USER_SETTINGS.alerts = Object.assign({}, S.alerts)
    USER_SETTINGS.profile = S.profile || 'fast'
    USER_SETTINGS.bmMode = (typeof BM !== 'undefined' ? BM.mode : null) || null
    USER_SETTINGS.assistArmed = !!S.assistArmed
    const _iv = (id: string, def: any) => {
      const el = document.getElementById(id) as any
      return el ? (parseFloat(el.value) || def) : def
    }
    USER_SETTINGS.autoTrade = {
      lev: parseInt(document.getElementById('atLev')?.getAttribute('value') || '') || 5,
      sl: _iv('atSL', 1.5),
      rr: _iv('atRR', 2),
      size: _iv('atSize', 200),
      maxPos: parseInt(document.getElementById('atMaxPos')?.getAttribute('value') || '') || 4,
      killPct: _iv('atKillPct', 5),
      riskPct: _iv('atRiskPct', 1),
      maxDay: parseInt(document.getElementById('atMaxDay')?.getAttribute('value') || '') || 5,
      lossStreak: parseInt(document.getElementById('atLossStreak')?.getAttribute('value') || '') || 3,
      maxAddon: parseInt(document.getElementById('atMaxAddon')?.getAttribute('value') || '') || 2,
      confMin: _iv('atConfMin', 65),
      sigMin: parseInt(document.getElementById('atSigMin')?.getAttribute('value') || '') || 3,
      multiSym: (document.getElementById('atMultiSym') as any)?.checked !== false,
      smartExitEnabled: (document.getElementById('atSmartExit') as any)?.checked === true,
      adaptEnabled: (typeof BM !== 'undefined' && BM.adapt) ? !!BM.adapt.enabled : false,
      adaptLive: (typeof BM !== 'undefined' && BM.adapt) ? !!BM.adapt.allowLiveAdjust : false,
    }
    USER_SETTINGS.manualLive = {
      size: _iv('liveSize', null),
      sl: _iv('liveSL', null),
      tp: _iv('liveTP', null),
    }
    USER_SETTINGS.ptLevDemo = (typeof w.getDemoLev === 'function') ? w.getDemoLev() : null
    USER_SETTINGS.ptLevLive = getLiveLev()
    const _dmm = document.getElementById('demoMarginMode') as any
    if (_dmm) USER_SETTINGS.ptMarginMode = _dmm.value
    USER_SETTINGS._syncTs = Date.now()
    localStorage.setItem('zeus_user_settings', JSON.stringify(USER_SETTINGS))
    _ucMarkDirty('settings')
    console.log('[US] Settings saved')
    if (typeof _userCtxPush === 'function') _userCtxPush()
  } catch (e: any) {
    console.warn('[US] Save failed:', e.message)
  }
}

export function _usApply() {
  try {
    const S = w.S
    const BM = w.BM
    const ARM_ASSIST = w.ARM_ASSIST
    const AT = getATObject()
    _usApplyDone = true
    if (USER_SETTINGS.chart.tf && USER_SETTINGS.chart.tf !== S.chartTf) {
      S.chartTf = USER_SETTINGS.chart.tf
      document.querySelectorAll('.tfb').forEach((b: any) => {
        if (b.textContent && b.textContent.trim() === USER_SETTINGS.chart.tf) {
          b.classList.add('act')
        } else {
          b.classList.remove('act')
        }
      })
    }
    if (USER_SETTINGS.chart.tz) S.tz = USER_SETTINGS.chart.tz
    if (USER_SETTINGS.chart.heatmap) Object.assign(S.heatmapSettings, USER_SETTINGS.chart.heatmap)
    if (USER_SETTINGS.chart.colors) {
      const c = USER_SETTINGS.chart.colors
      const _si = (id: string, val: any) => { const e = document.getElementById(id) as any; if (e && val) e.value = val }
      _si('ccBull', c.bull)
      _si('ccBear', c.bear)
      _si('ccBullW', c.bullW)
      _si('ccBearW', c.bearW)
      _si('ccPriceText', c.priceText)
      _si('ccPriceBg', c.priceBg)
      S._savedChartColors = c
      if (typeof w.cSeries !== 'undefined' && w.cSeries) {
        w.cSeries.applyOptions({ upColor: c.bull, downColor: c.bear, borderUpColor: c.bull, borderDownColor: c.bear, wickUpColor: (c.bullW || c.bull) + '77', wickDownColor: (c.bearW || c.bear) + '77' })
      }
      if (typeof w.mainChart !== 'undefined' && w.mainChart) {
        w.mainChart.applyOptions({ layout: { background: { color: c.priceBg || '#0a0f16' }, textColor: c.priceText || '#7a9ab8' }, rightPriceScale: { textColor: c.priceText || '#7a9ab8' } })
      }
    }
    if (USER_SETTINGS.indicators) {
      Object.assign(S.activeInds, USER_SETTINGS.indicators)
      Object.assign(S.indicators, USER_SETTINGS.indicators)
    }
    if (USER_SETTINGS.profile) {
      S.profile = USER_SETTINGS.profile
      const _profBtn = document.getElementById('prof-' + S.profile)
      if (_profBtn) {
        document.querySelectorAll('.znc-pbtn').forEach((b: any) => b.className = 'znc-pbtn')
        _profBtn.classList.add('act-' + S.profile)
      }
    }
    if (USER_SETTINGS.alerts) Object.assign(S.alerts, USER_SETTINGS.alerts)
    if (USER_SETTINGS.assistArmed) {
      S.assistArmed = true
      if (typeof ARM_ASSIST !== 'undefined') { ARM_ASSIST.armed = true; ARM_ASSIST.ts = Date.now() }
    }
    const _setInp = (id: string, val: any) => {
      const el = document.getElementById(id) as any
      if (el) el.value = val
    }
    const at = USER_SETTINGS.autoTrade
    if (typeof AT !== 'undefined') {
      const _atModeEl = document.getElementById('atMode') as any
      if (_atModeEl && AT.mode) _atModeEl.value = AT.mode
    }
    _setInp('atLev', at.lev)
    _setInp('atSL', at.sl)
    _setInp('atRR', at.rr)
    _setInp('atSize', at.size)
    _setInp('atMaxPos', at.maxPos)
    _setInp('atKillPct', at.killPct)
    if (at.riskPct) _setInp('atRiskPct', at.riskPct)
    if (at.maxDay) _setInp('atMaxDay', at.maxDay)
    if (at.lossStreak) _setInp('atLossStreak', at.lossStreak)
    if (at.maxAddon !== undefined) _setInp('atMaxAddon', at.maxAddon)
    _setInp('atConfMin', at.confMin)
    if (typeof BM !== 'undefined' && at.confMin) BM.confMin = parseFloat(at.confMin) || 65
    _setInp('atSigMin', at.sigMin)
    const multiChk = document.getElementById('atMultiSym') as any
    if (multiChk) {
      multiChk.checked = at.multiSym
      if (typeof _mscanUpdateLabel === 'function') _mscanUpdateLabel()
      else {
        const lbl = document.getElementById('atMultiSymLbl')
        if (lbl) lbl.textContent = at.multiSym ? 'ACTIV' : 'DEZACTIVAT'
      }
    }
    if (typeof BM !== 'undefined' && BM.adapt) {
      if (at.adaptEnabled !== undefined) BM.adapt.enabled = !!at.adaptEnabled
      if (at.adaptLive !== undefined) BM.adapt.allowLiveAdjust = !!at.adaptLive
    }
    const _atAdaptEl = document.getElementById('atAdaptEnabled') as any
    if (_atAdaptEl) _atAdaptEl.checked = BM.adapt && BM.adapt.enabled === true
    const _atAdaptLiveEl = document.getElementById('atAdaptLive') as any
    if (_atAdaptLiveEl) _atAdaptLiveEl.checked = BM.adapt && BM.adapt.allowLiveAdjust === true
    const _atSmartExitEl = document.getElementById('atSmartExit') as any
    if (_atSmartExitEl) _atSmartExitEl.checked = at.smartExitEnabled === true
    if (USER_SETTINGS.manualLive) {
      const ml = USER_SETTINGS.manualLive
      if (ml.size != null) _setInp('liveSize', ml.size)
      if (ml.sl != null) _setInp('liveSL', ml.sl)
      if (ml.tp != null) _setInp('liveTP', ml.tp)
    }
    console.log('[US] Settings applied')
  } catch (e: any) {
    console.warn('[US] Apply failed:', e.message)
  }
}

const _SETTINGS_MIGRATIONS: any = {}
const _CURRENT_SETTINGS_VERSION = 1

function _migrateSettings(parsed: any) {
  let v = parsed._version || 0
  while (v < _CURRENT_SETTINGS_VERSION) {
    v++
    if (_SETTINGS_MIGRATIONS[v]) {
      try { _SETTINGS_MIGRATIONS[v](parsed); console.log('[US] migrated \u2192', v) }
      catch (e: any) { console.warn('[US] migration', v, 'failed:', e.message); break }
    }
  }
  parsed._version = _CURRENT_SETTINGS_VERSION
}

export function loadUserSettings() {
  try {
    const raw = localStorage.getItem('zeus_user_settings')
    if (!raw) return
    const parsed = JSON.parse(raw)
    if ((parsed._version || 0) < _CURRENT_SETTINGS_VERSION) {
      _migrateSettings(parsed)
      localStorage.setItem('zeus_user_settings', JSON.stringify(parsed))
      console.log('[US] settings migrated & saved')
    }
    if (parsed.chart) Object.assign(USER_SETTINGS.chart, parsed.chart)
    if (parsed.indicators) USER_SETTINGS.indicators = parsed.indicators
    if (parsed.alerts) USER_SETTINGS.alerts = parsed.alerts
    if (parsed.autoTrade) Object.assign(USER_SETTINGS.autoTrade, parsed.autoTrade)
    if (parsed.profile) USER_SETTINGS.profile = parsed.profile
    if (parsed.bmMode) USER_SETTINGS.bmMode = parsed.bmMode
    if (typeof parsed.assistArmed === 'boolean') USER_SETTINGS.assistArmed = parsed.assistArmed
    if (parsed.ptMarginMode) {
      const _mmSel = document.getElementById('demoMarginMode') as any
      if (_mmSel && (parsed.ptMarginMode === 'cross' || parsed.ptMarginMode === 'isolated')) {
        _mmSel.value = parsed.ptMarginMode
      }
    }
    if (parsed.ptLevDemo) {
      const _dls = document.getElementById('demoLev') as any
      if (_dls) {
        const _found = Array.from(_dls.options).some(function (o: any) { return o.value === String(parsed.ptLevDemo) })
        if (_found) { _dls.value = String(parsed.ptLevDemo) }
        else { _dls.value = 'custom'; const _dcl = document.getElementById('demoCustomLev') as any; if (_dcl) _dcl.value = parsed.ptLevDemo; const _dcr = document.getElementById('demoCustomLevRow') as any; if (_dcr) _dcr.style.display = 'flex' }
      }
    }
    if (parsed.ptLevLive) {
      const _lls = document.getElementById('liveLev') as any
      if (_lls) {
        const _foundL = Array.from(_lls.options).some(function (o: any) { return o.value === String(parsed.ptLevLive) })
        if (_foundL) { _lls.value = String(parsed.ptLevLive) }
        else { _lls.value = 'custom'; const _lcl = document.getElementById('liveCustomLev') as any; if (_lcl) _lcl.value = parsed.ptLevLive; const _lcr = document.getElementById('liveCustomLevRow') as any; if (_lcr) _lcr.style.display = 'flex' }
      }
    }
    if (parsed.manualLive) USER_SETTINGS.manualLive = parsed.manualLive
    _usApply()
    console.log('[US] Settings loaded from localStorage')
  } catch (e: any) {
    console.warn('[US] Load failed:', e.message)
  }
}

// Chart overlay state
export let vwapSeries: any[] = []
export let oviSeries: any[] = []
export let oviPriceSeries: any[] = []
export const BT: any = { running: false, results: null }
export const BT_INDICATORS: any[] = [
  { id: 'rsi_ob', name: 'RSI >70 (OB)', ico: _ZI.bolt, color: '#f5c842' },
  { id: 'rsi_os', name: 'RSI <30 (OS)', ico: _ZI.bolt, color: '#f5c842' },
  { id: 'macd_cross', name: 'MACD Cross \u2191', ico: _ZI.chart, color: '#00e5ff' },
  { id: 'macd_under', name: 'MACD Cross \u2193', ico: _ZI.chart, color: '#00e5ff' },
  { id: 'st_bull', name: 'SuperTrend \u2191', ico: _ZI.dia, color: '#ff8800' },
  { id: 'st_bear', name: 'SuperTrend \u2193', ico: _ZI.dia, color: '#ff8800' },
  { id: 'ema_cross', name: 'EMA50>EMA200', ico: _ZI.tup, color: '#f0c040' },
  { id: 'vol_spike', name: 'Volume Spike', ico: _ZI.chart, color: '#00b8d4' },
  { id: 'confluence_bull', name: 'Confluence \u226565', ico: _ZI.tgt, color: '#aa44ff' },
]
export const DSL: any = {
  enabled: true,
  mode: null,
  magnetEnabled: false,
  magnetMode: 'soft',
  positions: {},
  checkInterval: null,
  _attachedIds: new Set(),
}
export const MSCAN_SYMS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'ZECUSDT']
export const MSCAN: any = {
  data: {},
  wsPool: {},
  lastScan: 0,
  scanning: false,
}

export const DHF: any = {
  days: {
    Sun: { wr: 57, trades: 0, wins: 0 },
    Mon: { wr: 72, trades: 0, wins: 0 },
    Tue: { wr: 63, trades: 0, wins: 0 },
    Wed: { wr: 68, trades: 0, wins: 0 },
    Thu: { wr: 61, trades: 0, wins: 0 },
    Fri: { wr: 64, trades: 0, wins: 0 },
    Sat: { wr: 55, trades: 0, wins: 0 },
  },
  hours: {} as any,
}
;(function initHourPriors() {
  const priors = [
    64, 29, 75, 69, 89, 88, 90, 50, 29, 55, 60, 58,
    62, 58, 56, 60, 64, 66, 68, 63, 57, 55, 60, 62
  ]
  for (let h = 0; h < 24; h++) {
    DHF.hours[h] = { wr: priors[h] || 60, trades: 0, wins: 0 }
  }
})()

export const PERF: any = {
  rsi: { wins: 0, losses: 0, weight: 1.0, pnlSum: 0, feeSum: 0, winPnl: 0, lossPnl: 0 },
  macd: { wins: 0, losses: 0, weight: 1.0, pnlSum: 0, feeSum: 0, winPnl: 0, lossPnl: 0 },
  supertrend: { wins: 0, losses: 0, weight: 1.0, pnlSum: 0, feeSum: 0, winPnl: 0, lossPnl: 0 },
  volume: { wins: 0, losses: 0, weight: 0.8, pnlSum: 0, feeSum: 0, winPnl: 0, lossPnl: 0 },
  funding: { wins: 0, losses: 0, weight: 0.8, pnlSum: 0, feeSum: 0, winPnl: 0, lossPnl: 0 },
  adx: { wins: 0, losses: 0, weight: 0.9, pnlSum: 0, feeSum: 0, winPnl: 0, lossPnl: 0 },
  confluence: { wins: 0, losses: 0, weight: 1.2, pnlSum: 0, feeSum: 0, winPnl: 0, lossPnl: 0 },
}

export const DAILY_STATS: any = {
  days: {},
  peak: 0,
  currentDD: 0,
  maxDD: 0,
  cumPnl: 0,
}
w.DAILY_STATS = DAILY_STATS
export const BEXT: any = {
  priceHistory: {},
  tickerItems: [],
}

export const SESSION_HOURS_BT: any = {
  asia: { start: 0, end: 8 },
  london: { start: 8, end: 13 },
  ny: { start: 13, end: 21 }
}
export let _sessLastBt: any = { ts: 0 }
export const SESS_CFG: any = {
  asia: { label: 'ASIA', col: '#f0c040', h: { start: 0, end: 8 } },
  london: { label: 'LON', col: '#4488ff', h: { start: 8, end: 13 } },
  ny: { label: 'NY', col: '#00ff88', h: { start: 13, end: 21 } }
}

// Brain & BM state
export const BRAIN: any = {
  state: 'scanning',
  score: 0,
  regime: 'unknown',
  thoughts: [],
  neurons: {},
  ofi: { buy: 0, sell: 0, blendBuy: 50, tape: [] },
  tickerQueue: [],
  tickerInterval: null,
  adaptParams: { sl: 1.5, tp: 3.0, size: 200, adjustCount: 0 },
}
export const BM: any = {
  mode: 'assist',
  profile: 'fast',
  confluenceScore: 50,
  confMin: 65,
  applyToOpen: false,
  protectMode: false,
  protectReason: '',
  dailyTrades: 0,
  dailyPnL: 0,
  lossStreak: 0,
  newsRisk: 'low',
  gates: {},
  entryScore: 0,
  entryReady: false,
  mtf: { '15m': 'neut', '1h': 'neut', '4h': 'neut' },
  sweep: { type: 'none', reclaim: false, displacement: false },
  flow: { cvd: 'neut', delta: 0, ofi: 'neut' },
  macroEvents: [],
  qexit: {
    risk: 0,
    signals: {
      divergence: { type: null, conf: 0 },
      climax: { dir: null, mult: 0 },
      regimeFlip: { from: null, to: null, conf: 0 },
      liquidity: { nearestAboveDistPct: null, nearestBelowDistPct: null, bias: 'neutral' },
    },
    action: 'HOLD',
    lastTs: 0,
    lastReason: '',
    shadowStop: null,
    confirm: { div: 0, climax: 0 },
  },
  probScore: 0,
  probBreakdown: { regime: 0, liquidity: 0, signals: 0, flow: 0 },
  macro: {
    cycleScore: 0, sentimentScore: 0, flowScore: 0, composite: 0,
    slope: 0, phase: 'NEUTRAL', confidence: 0, lastUpdate: 0,
  },
  adapt: {
    enabled: false, allowLiveAdjust: false, exitMult: 1.0, lastTs: 0, lastPhase: 'NEUTRAL',
  },
  positionSizing: { baseRiskPct: 1.0, regimeMult: 1.0, perfMult: 1.0, finalMult: 1.0 },
  regimeEngine: {
    regime: 'RANGE', confidence: 0, trendBias: 'neutral',
    volatilityState: 'normal', trapRisk: 0, notes: ['waiting'],
  },
  phaseFilter: {
    allow: false, phase: 'RANGE', reason: 'insufficient data',
    riskMode: 'reduced', sizeMultiplier: 0.5,
    allowedSetups: [], blockedSetups: [],
  },
  atmosphere: {
    category: 'neutral', allowEntry: true, cautionLevel: 'medium',
    confidence: 0, reasons: ['waiting for data'], sizeMultiplier: 1.0,
  },
  structure: {
    regime: 'unknown', adx: 0, atrPct: 0, squeeze: false, volMode: '\u2014',
    structureLabel: '\u2014', mtfAlign: { '15m': 'neut', '1h': 'neut', '4h': 'neut' },
    score: 0, lastUpdate: 0,
  },
  volBuffer: [],
  volRegime: '\u2014',
  volPct: null,
  liqCycle: {
    currentSweep: 'none', sweepDisplacement: false, trapRate: null,
    trapsTotal: 0, sweepsTotal: 0, magnetAboveDist: null, magnetBelowDist: null,
    magnetBias: '\u2014', lastUpdate: 0,
  },
  danger: 0,
  dangerBreakdown: { volatility: 0, spread: 0, liquidations: 0, volume: 0, funding: 0 },
  conviction: 0,
  convictionMult: 1.0,
  core: { lastLiqTs: 0, mtfOn: false, ticks: 0 },
}

export const PROFILE_TF: any = {
  fast: { trigger: '5m', context: '15m', bias: '30m', htf: '1h', cooldown: 2 },
  swing: { trigger: '15m', context: '30m', bias: '1h', htf: '4h', cooldown: 4 },
  defensive: { trigger: '30m', context: '1h', bias: '4h', htf: '4h', cooldown: 6 }
}
BM.performance = BM.performance || {}
BM.performance.byRegime = BM.performance.byRegime || {
  ACCUMULATION: { trades: 0, wins: 0, avgR: 0, mult: 1.00 },
  EARLY_BULL: { trades: 0, wins: 0, avgR: 0, mult: 1.00 },
  LATE_BULL: { trades: 0, wins: 0, avgR: 0, mult: 1.00 },
  DISTRIBUTION: { trades: 0, wins: 0, avgR: 0, mult: 1.00 },
  TOP_RISK: { trades: 0, wins: 0, avgR: 0, mult: 1.00 },
  NEUTRAL: { trades: 0, wins: 0, avgR: 0, mult: 1.00 },
}
BM.adaptive = BM.adaptive || {
  enabled: false, lastRecalcTs: 0, entryMult: 1.0, sizeMult: 1.0, exitMult: 1.0, buckets: {},
}

export const ARM_ASSIST: any = { armed: false, ts: 0, TIMEOUT: 5 * 60 * 1000 }
export const NEWS: any = { events: [], risk: 'low', lastUpdate: 0 }
export const _regimeHistory: any[] = []
export const _fakeout: any = { signalTs: 0, signalDir: null, confirmCount: 0, invalid: false }
export const _SESS_DEF: any = {
  asia: { start: 0, end: 8, color: 'asia' },
  london: { start: 8, end: 16, color: 'london' },
  ny: { start: 13, end: 21, color: 'ny' },
}
export const _SESS_PRIORITY = ['asia', 'london', 'ny']
export const _NEURO_SYMS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA']
export let _neuroLastScan: any = {}
export const ZANIM: any = {
  radarAngle: 0, orbScale: 1, orbDir: 0.002, lastFrame: 0, running: false, particles: []
}
export const _execQueue: any[] = []
export let _execActive = false

// Window exports
w.INDICATORS = INDICATORS
w.WL_SYMS = w.WL_SYMS  // declared in state.js
w.NOTIFICATION_CENTER = NOTIFICATION_CENTER
w.USER_SETTINGS = USER_SETTINGS
w.BT = BT
w.BT_INDICATORS = BT_INDICATORS
w.DSL = DSL
w.MSCAN_SYMS = MSCAN_SYMS
w.MSCAN = MSCAN
w.DHF = DHF
w.PERF = PERF
w.DAILY_STATS = DAILY_STATS
w.BEXT = BEXT
w.SESS_CFG = SESS_CFG
w.BRAIN = BRAIN
w.BM = BM
w.ARM_ASSIST = ARM_ASSIST
// NEWS — no window mapping needed (defined in this file)
w.ZANIM = ZANIM

// Function exports to window (used globally)
w.srRecord = srRecord
w.srLinkTrade = srLinkTrade
w.srUpdateOutcome = srUpdateOutcome
w._srRenderList = _srRenderList
w._srLoad = _srLoad
w._srEnsureVisible = _srEnsureVisible
w.ncAdd = ncAdd
w._ncRenderList = _ncRenderList
w._ncUpdateBadge = _ncUpdateBadge
w.ncFilter = ncFilter
w.ncMarkRead = ncMarkRead
w.ncMarkAllRead = ncMarkAllRead
w.ncClear = ncClear
w._ncLoad = _ncLoad
w._ctxSave = _ctxSave
w._ctxLoad = _ctxLoad
w._userCtxPush = _userCtxPush
w._userCtxPull = _userCtxPull
w.srStripToggle = srStripToggle
w.srStripUpdateBar = srStripUpdateBar
w.buildMTFStructure = buildMTFStructure
w.updateVolRegime = updateVolRegime
w.updateLiqCycle = updateLiqCycle
w.renderMTFPanel = renderMTFPanel
w._coreTickMI = _coreTickMI
w.refreshLiqCycleLight = refreshLiqCycleLight
w.detectSweepSimple = detectSweepSimple
w.refreshSweepLight = refreshSweepLight
w.ZT_capArr = ZT_capArr
w.ZT_safeInterval = ZT_safeInterval
w._safeCoreTickMI = _safeCoreTickMI
w.mtfStripToggle = mtfStripToggle
w.initMTFStrip = initMTFStrip
w._usScheduleSave = _usScheduleSave
w._usSave = _usSave
w._usApply = _usApply
w.loadUserSettings = loadUserSettings
w._ucPushBeacon = _ucPushBeacon
w._ucRetryPendingBeacon = _ucRetryPendingBeacon
