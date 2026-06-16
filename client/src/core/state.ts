/**
 * Zeus Terminal — core/state.ts (ported from public/js/core/state.js)
 * Global state objects — ALL exported to window for compat
 * Phase 7E — HIGH RISK foundation file
 */

import { getATObject, getBrainMetrics, getDSLObject } from '../services/stateAccessors'
import { isValidMarketPrice } from '../utils/dom'
import { _safeLocalStorageSet } from '../services/storage'
import { shouldFlagAttributionDivergence } from '../services/shadowCompareRules'
import { _applyATToggleUI, updateATMode, updateATStats , atLog , renderATPositions } from '../trading/autotrade'
import { useATStore } from '../stores/atStore'
import { _dslTrimAll } from '../trading/dsl'
import { aubBBSnapshot } from '../engine/aub'
import { loadJournalFromStorage } from '../services/storage'
import { syncBrainFromState } from '../engine/brain'
import { _updateWhyBlocked } from '../data/klines'
import { onPositionOpened } from '../trading/positions'
import { renderLivePositions , renderDemoPositions } from '../data/marketDataPositions'
import { runAutoTradeCheck } from '../trading/autotrade'
import { PROFILE_TF } from './config'
import { readCached as _readServerATCache, writeCached as _writeServerATCache } from './serverATCache'
import { _applyGlobalModeUI } from '../data/marketDataTrading'
import { useBrainStore } from '../stores/brainStore'
import { acquirePositionWrite, releasePositionWrite, getDropCount, getLockHeld } from '../utils/positionMutex'
import { shouldSkipFrameForExchange } from '../utils/exchangeGuard'
import { resolveEffectiveFlag } from '../utils/positionSource'
import type { ATConfig } from '../types'
const w = window as any // this file CREATES w.S, w.TP, w.TC, w.CORE_STATE, w.BlockReason, w.ZState — circular reads remain on w

w.__SYNC_VERSION__ = 'v12'
console.log('[ZEUS] state.js loaded — sync version:', w.__SYNC_VERSION__)

// ══════════════════════════════════════════════════════════════════
// [MULTI-USER] Per-user localStorage isolation
// ══════════════════════════════════════════════════════════════════
;(function _initUserScopedStorage() {
  let uid: any = null
  try {
    // zeus_token is httpOnly; read the non-httpOnly zeus_uid companion cookie
    // set by server alongside zeus_token (see server/routes/auth.js _setAuthCookie).
    const m = document.cookie.match(/zeus_uid=([^;]+)/)
    if (m) uid = parseInt(m[1], 10) || null
  } catch (_e) { /* not logged in */ }
  w._zeusUserId = uid

  const _USER_KEYS: any = {
    'zt_state_v1': 1, 'zt_journal': 1, 'zeus_user_settings': 1,
    'ARES_MISSION_STATE_V1': 1, 'ARES_MISSION_STATE_V1_vw2': 1,
    'ARES_POSITIONS_V1': 1, 'ARES_STATE_V1': 1, 'ares_init_v1': 1,
    'ARES_LAST_TRADE_TS': 1, 'ARES_JOURNAL_V1': 1,
    'zeus_postmortem_v1': 1, 'zeus_daily_pnl_v1': 1, 'zeus_adaptive_v1': 1,
    'zeus_signal_registry': 1, 'zeus_notifications': 1,
    'zeus_perf_v1': 1, 'zeus_ind_settings': 1,
    // zeus_tg_bot_token/chat_id removed — stored server-side only
    'zeus_uc_beacon_pending': 1, 'zeus_uc_dirty_ts': 1,
    'zeus_groups': 1, 'zeus_ui_context': 1,
    'zt_cloud_last_hash': 1,
    'zeus_dsl_strip_open': 1, 'zeus_at_strip_open': 1,
    'zeus_pt_strip_open': 1, 'zeus_mtf_open': 1,
    'zeus_dsl_mode': 1, 'zeus_adaptive_strip_open': 1,
    'zeus_theme': 1, 'zeus_llv_settings': 1, 'zeus_ui_scale': 1,
    'zeus_mscan_syms': 1, 'zt_midstack_order': 1,
    'aub_bb': 1, 'aub_macro': 1, 'aub_sim_last': 1, 'aub_expanded': 1,
    'of_hud_v2': 1, 'of_hud_pos_v1': 1, 'of_hud_anchor_x_v1': 1,
    // [ZT6] Teacher v2 (current codebase): 7 keys actively used
    'zeus_teacher_config': 1, 'zeus_teacher_sessions': 1,
    'zeus_teacher_lessons': 1, 'zeus_teacher_stats': 1,
    'zeus_teacher_memory': 1, 'zeus_teacher_v2state': 1,
    'zeus_teacher_panel_open': 1,
    'aria_v1': 1, 'nova_v1': 1,
    'zeus_dev_enabled': 1,
    'zeus_drawings_v1': 1,
    'zeus_ts_open': 1,
    'zeus_pin_hash': 1, 'zeus_pin_unlocked_until': 1, // [ZT6] PIN unlock is per-user
    'zt_api_key': 1, 'zt_api_secret': 1, 'zt_api_token': 1, 'zt_api_exchange': 1
    // [ZT6] Intentionally NOT scoped (per-browser, not per-user):
    //   'zeus_tab_leader' — multi-tab leader election for AT executor (all
    //     logged-in tabs across users must see the same leader).
    //   'zeus_app_version' — PWA/update banner install-version marker tied
    //     to the browser cache, not to the logged-in user.
  }
  const _USER_PREFIXES = ['zt_cloud_']

  function _isUserKey(key: string) {
    if (_USER_KEYS[key]) return true
    for (let i = 0; i < _USER_PREFIXES.length; i++) {
      if (key.indexOf(_USER_PREFIXES[i]) === 0) return true
    }
    return false
  }

  function _scopedKey(key: string) {
    if (!w._zeusUserId || !_isUserKey(key)) return key
    return key + ':' + w._zeusUserId
  }

  const _origGet = localStorage.getItem.bind(localStorage)
  const _origSet = localStorage.setItem.bind(localStorage)
  const _origRemove = localStorage.removeItem.bind(localStorage)
  w._lsOrigGet = _origGet
  w._lsOrigSet = _origSet
  w._lsOrigRemove = _origRemove

  if (uid) {
    let _migrated = 0
    const keys = Object.keys(_USER_KEYS)
    for (let i = 0; i < keys.length; i++) {
      const baseKey = keys[i]
      const newKey = baseKey + ':' + uid
      const oldVal = _origGet(baseKey)
      if (oldVal !== null) {
        if (_origGet(newKey) === null) {
          _origSet(newKey, oldVal)
          _migrated++
        }
        _origRemove(baseKey)
      }
    }
    try {
      for (let j = 0; j < localStorage.length; j++) {
        const k = localStorage.key(j)
        if (!k) continue
        for (let p = 0; p < _USER_PREFIXES.length; p++) {
          if (k.indexOf(_USER_PREFIXES[p]) === 0 && k.indexOf(':') === -1) {
            const nk = k + ':' + uid
            if (_origGet(nk) === null) { _origSet(nk, _origGet(k)!); _migrated++ }
            _origRemove(k)
            j--
            break
          }
        }
      }
    } catch (_) { /* */ }
    if (_migrated > 0) console.log('[ZEUS] Migrated', _migrated, 'localStorage keys to user-scoped for uid=' + uid)
  }

  localStorage.getItem = function (key: string) { return _origGet(_scopedKey(key)) }
  localStorage.setItem = function (key: string, val: string) { return _origSet(_scopedKey(key), val) }
  localStorage.removeItem = function (key: string) { return _origRemove(_scopedKey(key)) }

  w._lsClearUser = function () {
    const id = w._zeusUserId
    if (!id) return
    const suffix = ':' + id
    const toRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.length > suffix.length && k.substring(k.length - suffix.length) === suffix) {
        toRemove.push(k)
      }
    }
    for (let r = 0; r < toRemove.length; r++) { _origRemove(toRemove[r]) }
    console.log('[ZEUS] Cleared', toRemove.length, 'user-scoped localStorage keys for uid=' + id)
    w._zeusUserId = null
  }

  console.log('[ZEUS] User-scoped localStorage active — uid=' + (uid || 'none'))
})()

// ── P1: TRADING CONFIG — DOM-free parameter source ───────────────
// Phase 3 C3: the 8 AT-relevant keys (lev, size, slPct, rr, maxPos, sigMin,
// minADX, cooldownMs) are delegated to atStore.config via a Proxy.
// Reads return atStore values; writes route through patchConfig and are
// also mirrored on the backing object so Object.keys/enumeration still work.
// Every other TC key (riskPct, hourStart, hourEnd, confMin, dslActivatePct,
// dslTrailPct, dslTrailSusPct, dslExtendPct) stays as a plain property on
// the backing object — untouched legacy behavior.
{
  const _tcDefaults: any = {
    lev: 5,
    size: 200,
    slPct: 1.5,
    rr: 2,
    riskPct: 1,
    maxPos: 3,
    cooldownMs: 60000,
    minADX: 18,
    hourStart: 0,
    hourEnd: 23,
    sigMin: 3,
    confMin: 65,
    dslActivatePct: 0.50,
    dslTrailPct: 0.60,
    dslTrailSusPct: 0.50,
    dslExtendPct: 0.25,
  }
  if (!w.TC || !w.TC.__atStoreProxy) {
    const _tcBacking: any = w.TC ? { ..._tcDefaults, ...w.TC } : { ..._tcDefaults }
    try {
      // Seed atStore from backing defaults so first Proxy read matches legacy values.
      useATStore.getState().patchConfig({
        lev: _tcBacking.lev,
        size: _tcBacking.size,
        slPct: _tcBacking.slPct,
        rr: _tcBacking.rr,
        maxPos: _tcBacking.maxPos,
        sigMin: _tcBacking.sigMin,
        adxMin: _tcBacking.minADX,
        cooldownMs: _tcBacking.cooldownMs,
      })
    } catch (_) { /* defensive */ }

    const AT_DELEGATED = new Set(['lev', 'size', 'slPct', 'rr', 'maxPos', 'sigMin', 'minADX', 'cooldownMs'])
    const TC_TO_CFG: Record<string, keyof ATConfig> = {
      lev: 'lev', size: 'size', slPct: 'slPct', rr: 'rr',
      maxPos: 'maxPos', sigMin: 'sigMin', minADX: 'adxMin', cooldownMs: 'cooldownMs',
    }

    w.TC = new Proxy(_tcBacking, {
      get(target: any, prop: string | symbol) {
        if (prop === '__atStoreProxy') return true
        if (typeof prop === 'string' && AT_DELEGATED.has(prop)) {
          try { return useATStore.getState().config[TC_TO_CFG[prop]] } catch (_) { return target[prop] }
        }
        return target[prop]
      },
      set(target: any, prop: string | symbol, value: any) {
        if (typeof prop === 'string' && AT_DELEGATED.has(prop)) {
          const n = Number(value)
          if (Number.isFinite(n)) {
            try { useATStore.getState().patchConfig({ [TC_TO_CFG[prop]]: n } as Partial<ATConfig>) } catch (_) { /* defensive */ }
          }
          target[prop] = value
          return true
        }
        target[prop] = value
        return true
      },
    })
  }
}

export function syncDOMtoTC() {
  if (typeof document === 'undefined') return
  // [R34] Typed `HTMLInputElement | null` instead of `as any` — `.value` is
  // a structural property of input-like elements only.
  const _el = function (id: string) { return document.getElementById(id) as HTMLInputElement | null }
  const _pf = function (id: string, def: any) { const v = parseFloat(_el(id)?.value ?? ''); return Number.isFinite(v) ? v : def }
  const TC = w.TC
  // Phase 3 C5: the 6 AT keys (lev/size/slPct/rr/maxPos/sigMin) are now
  // sourced from atStore.config (populated by AutoTradePanel on edit and by
  // settingsStore on load/WS). Reading DOM here would route DOM values back
  // through the TC Proxy into the store, making DOM the implicit source
  // again — exactly what Phase 3 eliminates. DROPPED for AT keys.
  // riskPct + dsl* remain DOM-sourced (out-of-scope for Phase 3 atStore).
  TC.riskPct = Math.max(0.1, Math.min(5, _pf('atRiskPct', TC.riskPct)))
  TC.dslActivatePct = _pf('dslActivatePct', TC.dslActivatePct)
  TC.dslTrailPct = _pf('dslTrailPct', TC.dslTrailPct)
  TC.dslTrailSusPct = _pf('dslTrailSusPct', TC.dslTrailSusPct)
  TC.dslExtendPct = _pf('dslExtendPct', TC.dslExtendPct)
}
w.syncDOMtoTC = syncDOMtoTC

let _tcPushTimer: any = null
let _tcPushVersion = 0
export function pushTCtoServer() {
  const TC = w.TC
  const DSL = getDSLObject()
  if (typeof TC === 'undefined') return
  // [T-MAXTRADES 2026-06-07] maxDay (daily entry cap) — read the same DOM input
  // the brain uses (atMaxDay) so the server cap matches what the operator sees;
  // fall back to TC.maxDay. Server clamps 0..100; undefined → no cap change.
  let _maxDay: number | undefined
  try {
    const _el = (typeof document !== 'undefined') ? (document.getElementById('atMaxDay') as HTMLInputElement | null) : null
    const _v = _el ? parseInt(_el.value || '') : NaN
    _maxDay = Number.isFinite(_v) && _v >= 0 ? _v : (typeof (TC as any).maxDay === 'number' ? (TC as any).maxDay : undefined)
  } catch (_) { _maxDay = (typeof (TC as any).maxDay === 'number') ? (TC as any).maxDay : undefined }
  const payload: any = {
    confMin: TC.confMin,
    sigMin: TC.sigMin,
    adxMin: TC.minADX,
    maxPos: TC.maxPos,
    maxDay: _maxDay,
    cooldownMs: TC.cooldownMs,
    lev: TC.lev,
    size: TC.size,
    slPct: TC.slPct,
    rr: TC.rr,
    dslMode: (typeof DSL !== 'undefined' && DSL.mode) ? DSL.mode : undefined,
    symbols: w._atSelectedSymbols || null,
  }
  _tcPushVersion++
  void _tcPushVersion
  fetch('/api/tc/sync', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(function (r: any) {
    if (!r.ok) console.warn('[TC] Server sync failed:', r.status)
  }).catch(function () {
    // silent
  })
}
export function _tcPushDebounced() {
  if (_tcPushTimer) clearTimeout(_tcPushTimer)
  _tcPushTimer = setTimeout(pushTCtoServer, 500)
}
w.pushTCtoServer = pushTCtoServer
w._tcPushDebounced = _tcPushDebounced

w.CORE_STATE = {
  score: 0,
  engineStatus: "idle",
  lastUpdate: 0
}

// BlockReason
export const BlockReason: any = {
  _current: null as any,
  _lastLogCode: null as any,
  _lastLogTs: 0,
  _lastLogKey: null as any,
  set(code: any, text: any, source?: any) {
    const br = { code, text, source: source || 'engine', ts: Date.now() }
    this._current = br
    // [R30] DOM write removed — <BlockReasonText/> subscribes to
    // brainStore.blockReasonDisplay, which engine/brain.ts updates every
    // cycle. Call sites already mirror {code,text} into brainStore.blockReason
    // via the _setBR helpers (klines.ts, autotrade.ts, etc).
    const now = Date.now()
    const _logKey = String(code) + '|' + String(text || '')
    const sameKey = (_logKey === this._lastLogKey)
    const debounceElapsed = (now - this._lastLogTs) >= 60000
    if (!sameKey || debounceElapsed) {
      atLog('warn', 'BLOCKED: ' + text)
      this._lastLogCode = code
      this._lastLogKey = _logKey
      this._lastLogTs = now
    }
    if (typeof _updateWhyBlocked === 'function') _updateWhyBlocked(code, text)
    if ((code === 'KILL' || code === 'PROTECT' || code === 'DATA_STALL')) aubBBSnapshot('BLOCK_' + code, { text })
    return br
  },
  clear() {
    this._current = null
    this._lastLogCode = null
    this._lastLogTs = 0
    this._lastLogKey = null
    // [R30] DOM write removed — see BlockReason.set above.
    if (typeof _updateWhyBlocked === 'function') _updateWhyBlocked(null, null)
  },
  get() { return this._current },
  text() { return this._current?.text || '\u2014' },
}

// ── 1. ATOMIC SNAPSHOT BUILDER ───────────────────────────────────
export function buildExecSnapshot(side: any, cond: any) {
  const S = w.S
  const TC = w.TC
  const BM = getBrainMetrics()
  const _tf = PROFILE_TF?.[S.profile || 'fast'] || { trigger: '5m', context: '15m' }

  // Phase 3 C5: read AT config from atStore (canonical source). Previous
  // DOM fallback via document.getElementById('atLev') etc. removed — the
  // store always has valid finite defaults (seeded in C3 at Proxy install).
  const _atCfg = useATStore.getState().config
  const _levRaw = _atCfg.lev
  const _sizeRaw = _atCfg.size
  const _slRaw = _atCfg.slPct
  const _rrRaw = _atCfg.rr

  const lev = (Number.isFinite(_levRaw) && _levRaw >= 1) ? Math.min(125, Math.max(1, _levRaw)) : 5
  const size = (Number.isFinite(_sizeRaw) && _sizeRaw > 0) ? Math.min(100000, _sizeRaw) : 200
  const slPct = (Number.isFinite(_slRaw) && _slRaw > 0) ? Math.min(20, Math.max(0.1, _slRaw)) : 1.5
  let rr = Number(_rrRaw); if (!Number.isFinite(rr) || rr <= 0) rr = 2; rr = Math.max(0.1, Math.min(20, rr))

  const pCore = (w.CORE_STATE && isFinite(w.CORE_STATE.price)) ? +w.CORE_STATE.price : NaN
  const pS = (S && isFinite(S.price)) ? +S.price : NaN
  const price = isFinite(pCore) ? pCore : (isFinite(pS) ? pS : NaN)

  if (!isValidMarketPrice(price)) {
    console.error('[buildExecSnapshot] REJECTED — invalid price:', price, '| CORE:', w.CORE_STATE?.price, '| S:', S?.price)
    return null
  }

  const slDist = price * slPct / 100

  return Object.freeze({
    ts: Date.now(),
    symbol: S.symbol,
    side,
    price,
    regime: BM.regime || '\u2014',
    score: cond?.score || BM?.entryScore || 0,
    mode: (S.mode || 'assist').toUpperCase(),
    profile: S.profile || 'fast',
    tf: _tf,
    lev,
    size,
    slPct,
    rr,
    riskPct: (typeof TC !== 'undefined' && Number.isFinite(TC.riskPct)) ? TC.riskPct : 1,
    sl: side === 'LONG' ? price - slDist : price + slDist,
    tp: side === 'LONG' ? price + (slDist * rr) : price - (slDist * rr),
    btcAnchor: S.symbol === 'BTCUSDT' ? price : (S.btcPrice || 0),
    reason: cond?.reason || 'AUTO',
    gates: cond?.gates || null,
  })
}

// State persistence (ZState)
export const ZState = (() => {
  const KEY = 'zt_state_v1'
  let _saveTimer: any = null
  let _dirty = false
  let _lastEditTs = 0
  let _stateVersion = 0
  let _saving = false
  function markDirty() { _dirty = true; _lastEditTs = Date.now(); _stateVersion++ }

  function _serialize(): any {
    const TP = w.TP
    const DSL = getDSLObject()
    const AT = getATObject()
    return {
      ts: Date.now(),
      v: _stateVersion,
      lastEditTs: _lastEditTs,
      demoBalance: (typeof TP !== 'undefined') ? TP.demoBalance : 10000,
      demoPnL: (typeof TP !== 'undefined') ? TP.demoPnL : 0,
      demoWins: (typeof TP !== 'undefined') ? TP.demoWins : 0,
      demoLosses: (typeof TP !== 'undefined') ? TP.demoLosses : 0,
      positions: (typeof TP !== 'undefined' ? TP.demoPositions || [] : [])
        .filter(function (p: any) {
          if (p.closed) return false
          if (w._serverATEnabled && p.autoTrade) return false
          return true
        })
        .map((p: any) => ({
          id: p.id, side: p.side, sym: p.sym, entry: p.entry,
          size: p.size, lev: p.lev, tp: p.tp, sl: p.sl,
          liqPrice: p.liqPrice, autoTrade: !!p.autoTrade,
          openTs: p.openTs || p.id, isLive: !!p.isLive,
          _serverSeq: p._serverSeq || null,
          mode: p.mode || 'demo',
          controlMode: p.controlMode || null,
          sourceMode: p.sourceMode || null,
          brainModeAtOpen: p.brainModeAtOpen || null,
          dslParams: p.dslParams || null,
          _dslUserEdited: !!p._dslUserEdited,
          dslAdaptiveState: p.dslAdaptiveState || null,
          dslHistory: Array.isArray(p.dslHistory) ? p.dslHistory.slice(-20) : [],
          dsl: (typeof DSL !== 'undefined' && DSL.positions?.[String(p.id)])
            ? (function (d: any) {
              return {
                active: d.active ?? false,
                currentSL: d.currentSL ?? null,
                pivotLeft: d.pivotLeft ?? null,
                pivotRight: d.pivotRight ?? null,
                impulseVal: d.impulseVal ?? null,
                yellowLine: d.yellowLine ?? null,
                originalSL: d.originalSL ?? null,
                originalTP: d.originalTP ?? null,
                source: d.source ?? null,
                attachedTs: d.attachedTs ?? null,
                impulseTriggered: d.impulseTriggered ?? false,
                log: Array.isArray(d.log) ? d.log.slice(-20) : [],
              }
            })(DSL.positions[String(p.id)])
            : null
        })),
      liveManualPositions: (typeof TP !== 'undefined' ? TP.livePositions || [] : [])
        .filter(function (p: any) {
          if (p.closed) return false
          // [Phase 3A] Whitelist: only whitelisted-manual positions are serialized as manual.
          // Ambiguous positions (autoTrade undefined, sourceMode unknown) are dropped — they
          // will rehydrate from server on reconnect if still live. Never coerce unknown → manual.
          const _isManual = (p.autoTrade === false) || (p.sourceMode === 'manual') || (p.sourceMode === 'paper')
          if (!_isManual) return false
          if (!p.isLive && !p.fromExchange) return false
          return true
        })
        .map((p: any) => ({
          id: p.id, side: p.side, sym: p.sym, entry: p.entry,
          size: p.size, lev: p.lev, tp: p.tp, sl: p.sl, qty: p.qty,
          liqPrice: p.liqPrice, autoTrade: false, isLive: true, fromExchange: true,
          mode: p.mode || 'live', openTs: p.openTs || p.id,
          controlMode: p.controlMode || 'paper',
          sourceMode: p.sourceMode || 'paper',
          brainModeAtOpen: p.brainModeAtOpen || null,
          _serverSeq: p._serverSeq || null,
          _serverMode: p._serverMode || null,
          dslParams: p.dslParams || null,
          _dslUserEdited: !!p._dslUserEdited,
          dslAdaptiveState: p.dslAdaptiveState || null,
          dslHistory: Array.isArray(p.dslHistory) ? p.dslHistory.slice(-20) : [],
          dsl: (typeof DSL !== 'undefined' && DSL.positions?.[String(p.id)])
            ? (function (d: any) {
              return {
                active: d.active ?? false, currentSL: d.currentSL ?? null,
                pivotLeft: d.pivotLeft ?? null, pivotRight: d.pivotRight ?? null,
                impulseVal: d.impulseVal ?? null, yellowLine: d.yellowLine ?? null,
                originalSL: d.originalSL ?? null, originalTP: d.originalTP ?? null,
                source: d.source ?? null, attachedTs: d.attachedTs ?? null,
                impulseTriggered: d.impulseTriggered ?? false,
                log: Array.isArray(d.log) ? d.log.slice(-20) : [],
              }
            })(DSL.positions[String(p.id)])
            : null
        })),
      pendingOrders: (typeof TP !== 'undefined' ? TP.pendingOrders || [] : [])
        .filter(function (o: any) { return o && !o.cancelled && !o.filled })
        .map(function (o: any) {
          return { id: o.id, side: o.side, sym: o.sym, limitPrice: o.limitPrice, size: o.size, lev: o.lev, tp: o.tp, sl: o.sl, mode: o.mode || 'demo', createdAt: o.createdAt }
        }),
      manualLivePending: (typeof TP !== 'undefined' ? TP.manualLivePending || [] : [])
        .filter(function (o: any) { return o && !o.cancelled && !o.filled })
        .map(function (o: any) {
          return { orderId: o.orderId, symbol: o.symbol, side: o.side, price: o.price, origQty: o.origQty, leverage: o.leverage, tp: o.tp, sl: o.sl, clientOrderId: o.clientOrderId, createdAt: o.createdAt }
        }),
      at: typeof AT !== 'undefined' ? {
        enabled: AT.enabled,
        mode: AT.mode,
        killTriggered: AT.killTriggered,
        cooldownMs: AT.cooldownMs,
        lastTradeTs: AT.lastTradeTs,
        lastTradeSide: AT.lastTradeSide,
        realizedDailyPnL: AT.realizedDailyPnL,
        closedTradesToday: AT.closedTradesToday,
        dailyPnL: AT.dailyPnL,
        dailyStart: AT.dailyStart,
        totalTrades: AT.totalTrades,
        wins: AT.wins, losses: AT.losses, totalPnL: AT.totalPnL,
      } : null,
      blockReason: BlockReason.get(),
      symbol: typeof w.S !== 'undefined' ? w.S.symbol : null,
      closedIds: (function () {
        const ids: string[] = []
        if (typeof TP !== 'undefined' && Array.isArray(TP.journal)) {
          TP.journal.forEach(function (j: any) { if (j.id && j.journalEvent === 'CLOSE') ids.push(String(j.id)) })
        }
        if (Array.isArray(w._zeusRecentlyClosed)) {
          w._zeusRecentlyClosed.forEach(function (id: any) { ids.push(String(id)) })
        }
        return Array.from(new Set(ids)).slice(-1000)
      })(),
    }
  }

  function save() {
    _saving = true
    try {
      const data = _serialize()
      console.log('[ZState] SAVE — pos:', (data.positions || []).length, 'bal:', data.demoBalance, 'ts:', data.ts, 'v:', data.v)
      if (typeof _safeLocalStorageSet === 'function') _safeLocalStorageSet(KEY, data)
      else try { localStorage.setItem(KEY, JSON.stringify(data)) } catch (_) { }
    }
    catch (e: any) { console.warn('[ZState] save failed:', e.message) }
    finally { _saving = false }
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY)
      if (!raw) return null
      return JSON.parse(raw)
    } catch (_e) { return null }
  }

  function restore() {
    try {
      const snap = load()
      const TP = w.TP
      const AT = getATObject()
      const DSL = getDSLObject()
      console.log('[ZState] RESTORE — snap:', snap ? ('pos:' + (snap.positions || []).length + ' bal:' + snap.demoBalance + ' ts:' + snap.ts) : 'NULL')
      if (!snap) return false

      if (typeof TP !== 'undefined' && !w._serverATEnabled) {
        if (typeof snap.demoBalance === 'number' && isFinite(snap.demoBalance)) TP.demoBalance = snap.demoBalance
        if (typeof snap.demoPnL === 'number' && isFinite(snap.demoPnL)) TP.demoPnL = snap.demoPnL
        if (typeof snap.demoWins === 'number' && isFinite(snap.demoWins)) TP.demoWins = snap.demoWins
        if (typeof snap.demoLosses === 'number' && isFinite(snap.demoLosses)) TP.demoLosses = snap.demoLosses
      } else if (w._serverATEnabled) {
        console.log('[ZState] RESTORE — skipping demo financial fields (serverAT authoritative)')
      }

      if (snap.at && typeof AT !== 'undefined') {
        const a = snap.at
        AT.enabled = !!a.enabled
        AT.mode = a.mode || 'demo'
        AT._modeConfirmed = false
        AT.cooldownMs = a.cooldownMs || 120000
        AT.lastTradeTs = a.lastTradeTs || 0
        AT.lastTradeSide = a.lastTradeSide || null
        AT.totalTrades = a.totalTrades || 0
        AT.wins = a.wins || 0
        AT.losses = a.losses || 0
        AT.totalPnL = a.totalPnL || 0
        AT.dailyStart = a.dailyStart || new Date().toDateString()
        const _today = new Date().toDateString()
        if (a.dailyStart && a.dailyStart !== _today) {
          AT.killTriggered = false
          AT.realizedDailyPnL = 0
          AT.closedTradesToday = 0
          AT.dailyPnL = 0
          AT.dailyStart = _today
          console.log('[ZState] Zi noua detectata — reset daily counters + killTriggered')
        } else {
          AT.killTriggered = !!a.killTriggered
          AT.realizedDailyPnL = a.realizedDailyPnL || 0
          AT.closedTradesToday = a.closedTradesToday || 0
          AT.dailyPnL = a.dailyPnL || 0
        }
      }

      // [SRV-POS] Boot restore mutex — prevents race with first WS push / liveApi sync
      const _bootSeq = acquirePositionWrite()
      try {
      if (snap.positions?.length && typeof TP !== 'undefined' && snap.at?.mode !== 'live') {
        const existing = new Set((TP.demoPositions || []).map((p: any) => String(p.id)))
        let closedPosIds = new Set<string>()
        try {
          let jEntries = (Array.isArray(TP.journal) && TP.journal.length > 0) ? TP.journal : null
          if (!jEntries) {
            const _jRaw = localStorage.getItem('zt_journal')
            if (_jRaw && _jRaw.length > 2) {
              try { jEntries = JSON.parse(_jRaw) } catch (_) {
                console.warn('[ZState] Corrupted journal in localStorage — clearing')
                try { localStorage.removeItem('zt_journal') } catch (_) { /* */ }
              }
              {
                try { loadJournalFromStorage() } catch (_) { /* */ }
                if (Array.isArray(TP.journal) && TP.journal.length > 0) jEntries = TP.journal
              }
            }
          }
          if (Array.isArray(jEntries)) {
            jEntries.forEach((j: any) => { if (j && j.id && j.journalEvent === 'CLOSE') closedPosIds.add(String(j.id)) })
          }
        } catch (_) { /* */ }

        console.log('[ZState] Restoring positions:', snap.positions.length, 'existing:', existing.size, 'closed:', closedPosIds.size)
        TP.demoPositions = TP.demoPositions || []
        snap.positions.forEach(function (p: any) {
          if (p.closed || closedPosIds.has(String(p.id))) {
            return
          }
          if (!existing.has(String(p.id))) {
            const _restoredPos = { ...p, _restored: true, _classifySource: 'boot_resume', _classifyExchange: 'binance' }
            TP.demoPositions.push(_restoredPos)
            console.log('[ZState] Restored pos:', p.id, p.side, p.sym)
            if (p.dsl && typeof DSL !== 'undefined') {
              DSL.positions = DSL.positions || {}
              const _k = String(p.id)
              DSL.positions[_k] = DSL.positions[_k] || {}
              const _d = DSL.positions[_k]
              if (_d.active == null) _d.active = p.dsl.active ?? false
              if (_d.currentSL == null) _d.currentSL = p.dsl.currentSL ?? null
              if (_d.pivotLeft == null) _d.pivotLeft = p.dsl.pivotLeft ?? null
              if (_d.pivotRight == null) _d.pivotRight = p.dsl.pivotRight ?? null
              if (_d.impulseVal == null) _d.impulseVal = p.dsl.impulseVal ?? null
              if (_d.yellowLine == null) _d.yellowLine = p.dsl.yellowLine ?? null
              if (_d.originalSL == null) _d.originalSL = p.dsl.originalSL ?? null
              if (_d.originalTP == null) _d.originalTP = p.dsl.originalTP ?? null
              if (_d.source == null) _d.source = p.dsl.source ?? 'restore'
              if (_d.attachedTs == null) _d.attachedTs = p.dsl.attachedTs ?? Date.now()
              if (_d.impulseTriggered == null) _d.impulseTriggered = p.dsl.impulseTriggered ?? false
              if (!Array.isArray(_d.log)) _d.log = Array.isArray(p.dsl.log) ? p.dsl.log : []
            }
            if (typeof onPositionOpened === 'function') onPositionOpened(_restoredPos, 'restore')
          }
        })
        setTimeout(renderDemoPositions, 500)
        setTimeout(renderATPositions, 500)
      }

      // [PHASE3B] Restore manual live/testnet positions
      if (Array.isArray(snap.liveManualPositions) && snap.liveManualPositions.length && typeof TP !== 'undefined') {
        TP.livePositions = TP.livePositions || []
        const _existLive = new Set(TP.livePositions.map(function (p: any) { return String(p.id) }))
        snap.liveManualPositions.forEach(function (p: any) {
          if (p.closed || _existLive.has(String(p.id))) return
          const _restoredLive = Object.assign({}, p, { _restored: true, _classifySource: 'boot_resume', _classifyExchange: 'binance' })
          TP.livePositions.push(_restoredLive)
          if (p.dsl && typeof DSL !== 'undefined') {
            DSL.positions = DSL.positions || {}
            const _k = String(p.id)
            DSL.positions[_k] = DSL.positions[_k] || {}
            const _d = DSL.positions[_k]
            if (_d.active == null) _d.active = p.dsl.active ?? false
            if (_d.currentSL == null) _d.currentSL = p.dsl.currentSL ?? null
            if (_d.pivotLeft == null) _d.pivotLeft = p.dsl.pivotLeft ?? null
            if (_d.pivotRight == null) _d.pivotRight = p.dsl.pivotRight ?? null
            if (_d.impulseVal == null) _d.impulseVal = p.dsl.impulseVal ?? null
            if (_d.originalSL == null) _d.originalSL = p.dsl.originalSL ?? null
            if (_d.originalTP == null) _d.originalTP = p.dsl.originalTP ?? null
            if (_d.source == null) _d.source = p.dsl.source ?? 'restore'
            if (_d.attachedTs == null) _d.attachedTs = p.dsl.attachedTs ?? Date.now()
          }
          if (typeof onPositionOpened === 'function') onPositionOpened(_restoredLive, 'restore')
        })
        if (typeof renderLivePositions === 'function') setTimeout(renderLivePositions, 500)
        console.log('[ZState] Restored', snap.liveManualPositions.length, 'live manual position(s)')
      }
      } finally { releasePositionWrite(_bootSeq) }

      // Restore pending orders
      if (Array.isArray(snap.pendingOrders) && snap.pendingOrders.length && typeof TP !== 'undefined') {
        TP.pendingOrders = TP.pendingOrders || []
        const _existPending = new Set(TP.pendingOrders.map(function (o: any) { return String(o.id) }))
        snap.pendingOrders.forEach(function (o: any) {
          if (!_existPending.has(String(o.id))) {
            TP.pendingOrders.push(o)
          }
        })
        if (typeof w.renderPendingOrders === 'function') setTimeout(w.renderPendingOrders, 600)
      }

      // Restore manual live pending
      if (Array.isArray(snap.manualLivePending) && snap.manualLivePending.length && typeof TP !== 'undefined') {
        TP.manualLivePending = TP.manualLivePending || []
        const _existLivePending = new Set(TP.manualLivePending.map(function (o: any) { return String(o.orderId) }))
        snap.manualLivePending.forEach(function (o: any) {
          if (!_existLivePending.has(String(o.orderId))) {
            TP.manualLivePending.push(o)
          }
        })
      }

      // Restore block reason
      if (snap.blockReason) {
        BlockReason._current = snap.blockReason
        try {
          useBrainStore.getState().setBlockReason({
            code: snap.blockReason.code,
            text: snap.blockReason.text || '',
          })
        } catch (_e) { }
      }

      console.log('[ZState] Restored:', snap.positions?.length || 0, 'positions, kill:', snap.at?.killTriggered)
      if (typeof _dslTrimAll === 'function') _dslTrimAll()
      return true
    } catch (e: any) {
      console.warn('[ZState.restore] Failed:', e.message)
      if (typeof w.ZLOG !== 'undefined') w.ZLOG.push('ERROR', '[ZState.restore] ' + e.message)
      return false
    }
  }

  function clear() {
    try { localStorage.removeItem(KEY) } catch (_) { /* */ }
  }

  // ── SERVER SYNC (PC <-> Phone) ──
  let _syncTimer: any = null
  let _syncing = false
  let _syncReady = false
  let _syncQueued = false
  let _merging = false

  const _syncHeaders: any = { 'Content-Type': 'application/json' }
  let _offlinePending = false

  function _pushToServer() {
    if (_syncing || _merging) { _syncQueued = true; return }
    if (!_syncReady) { console.warn('[sync] push blocked — syncReady=false'); return }
    _syncing = true
    _syncQueued = false
    _lastPushTs = Date.now()
    const data = _serialize()
    const _pushDirtySnapshot = _dirty
    console.log('[sync] PUSHING to server — pos:', (data.positions || []).length, 'bal:', data.demoBalance)
    fetch('/api/sync/state', {
      method: 'POST',
      headers: _syncHeaders,
      credentials: 'same-origin',
      body: JSON.stringify(data)
    }).then(function (r: any) { return r.json() })
      .then(function (j: any) { if (j.ok) console.log('[sync] pushed OK ts=' + data.ts); else console.warn('[sync] push rejected:', j) })
      .catch(function (e: any) { console.warn('[sync] push failed:', e.message); if (typeof navigator !== 'undefined' && !navigator.onLine) _offlinePending = true })
      .finally(function () {
        _syncing = false
        if (_pushDirtySnapshot && _dirty && _lastEditTs <= data.lastEditTs) { _dirty = false }
        if (_syncQueued) { _syncQueued = false; setTimeout(_pushToServer, 200) }
      })
  }

  function syncToServer() {
    if (_syncTimer) clearTimeout(_syncTimer)
    _syncTimer = setTimeout(_pushToServer, 1500)
  }

  function syncNow() {
    if (_syncTimer) clearTimeout(_syncTimer)
    _pushToServer()
  }

  function markSyncReady() { _syncReady = true; console.log('[sync] markSyncReady — pushes now enabled'); _connectWS() }

  // ── WebSocket real-time sync ──
  let _ws: any = null
  let _wsRetry = 0
  let _wsVisListener = false
  // [Phase 3E] Track if we've ever been connected — first open is initial bootstrap,
  // subsequent opens are reconnects and must trigger canonical-truth re-pull.
  let _wsEverConnected = false
  let _lastPushTs = 0 // cooldown: ignore sync signals shortly after our own push
  w._zsSyncPushTs = function () { return _lastPushTs }
  w._zsMarkPush = function () { _lastPushTs = Date.now() }
  function _connectWS() {
    if (typeof WebSocket === 'undefined') return
    if (_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) return
    try {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
      _ws = new WebSocket(proto + '//' + location.host + '/ws/sync')
      _ws.onopen = function () {
        _wsRetry = 0
        console.log('[ws] sync connected')
        // [Phase 3E] On re-open (not first connect), pull canonical AT state immediately
        // so positions (with full ownership fields: autoTrade, sourceMode, controlMode,
        // mode) are re-hydrated via _applyServerATState. Closes stale-window regression
        // where Manual/AT panels could misclassify after reconnect.
        if (_wsEverConnected) {
          console.log('[ws] reconnected — pulling canonical AT state')
          try { _atPollOnce() } catch (_) { /* */ }
        }
        _wsEverConnected = true
      }
      _ws.onmessage = function (ev: any) {
        try {
          const msg = JSON.parse(ev.data)
          if (msg.type === 'sync') {
            if (Date.now() - _lastPushTs < 3000) { console.log('[ws] sync signal ignored (own push cooldown)'); return }
            console.log('[ws] sync signal — pulling'); pullAndMerge()
          }
          if (msg.type === 'at_update' && msg.data) { _applyServerATState(msg.data) }
        } catch (_) { /* */ }
      }
      _ws.onclose = function () {
        _ws = null
        const delay = Math.min(30000, 1000 * Math.pow(2, _wsRetry++))
        setTimeout(_connectWS, delay)
      }
      if (!_wsVisListener) {
        _wsVisListener = true
        document.addEventListener('visibilitychange', function () {
          if (!document.hidden) { _wsRetry = 0; _connectWS() }
        })
      }
      _ws.onerror = function () { /* */ }
    } catch (e: any) { console.warn('[ws] connect failed:', e.message) }
  }

  // ── Server AT state consumer ──
  // [Task S8-P0-3 2026-05-28] Pre-arm from localStorage cache to close the
  // race window between boot and the first /api/at/state response. If the
  // last session ran with server-AT active, lock the client AT engine
  // immediately at boot so a manual trade or scheduled brain cycle in the
  // ~50-500ms before preboot completes can't bypass the lockout.
  // Preboot still overrides if server state has changed.
  w._serverATEnabled = _readServerATCache()
  // [Phase 2 S6-B4] Demo-authority window mirrors. Default false at boot;
  // overwritten on first at_update / pullState response if present.
  // S6-B5 will wire the client AT engine gate against these flags.
  w._serverATDemoEnabled = false
  w._serverBrainDemoEnabled = false
  w._srvPosFlags = { master: false, testnet: false, real: false }
  let _atPollTimer: any = null

  function _mapServerPos(sp: any) {
    const TP = w.TP
    let existingPos: any = null
    if (typeof TP !== 'undefined' && sp.seq) {
      const allClient = [].concat(TP.demoPositions || [], TP.livePositions || [])
      for (let i = 0; i < allClient.length; i++) {
        if ((allClient[i] as any)._serverSeq === sp.seq || (allClient[i] as any).id === sp.seq) { existingPos = allClient[i]; break }
      }
      if (!existingPos) {
        const _spSym = sp.symbol || sp.sym
        for (let j = 0; j < allClient.length; j++) {
          if ((allClient[j] as any).sym === _spSym && (allClient[j] as any).side === sp.side && !(allClient[j] as any).closed && !(allClient[j] as any)._serverSeq) {
            existingPos = allClient[j]
            // [FIX DUP] Claim this client-opened pos as server-tracked NOW so clientOnlyDemo
            // filter excludes it — prevents duplicate (client + server-mapped) in TP arrays
            existingPos._serverSeq = sp.seq
            break
          }
        }
      }
    }
    // [Phase 9A1] No more 'auto'/'assist' heuristic default. When the server omits
    // ownership fields we must preserve the client's last-known tag — inventing
    // 'auto' for live and 'assist' for demo is what caused manual positions to
    // flicker onto the AT card after a reconnect or a minimal server snapshot.
    // Final fallback is 'manual' (conservative) only for brand-new positions
    // that have no existingPos and no server-side hint at all.
    return {
      // [FIX DUP] Preserve client id when matched — avoids id change in UI that confuses
      // render cycles and DSL attachment (DSL is keyed by pos.id)
      id: (existingPos && existingPos.id) ? existingPos.id : (sp.seq || sp.id || Date.now()),
      side: sp.side,
      sym: sp.symbol || sp.sym,
      entry: sp.price || sp.entry,
      size: sp.size || 0,
      // [Phase 9A2] When the server optimizes out `lev`, fall back to the client's
      // last-known leverage before defaulting to 1. Without this the card briefly
      // showed x1 for positions opened at x10/x20 whenever a snapshot omitted lev.
      lev: (typeof sp.lev === 'number' && sp.lev > 0)
        ? sp.lev
        : (existingPos && typeof existingPos.lev === 'number' && existingPos.lev > 0)
          ? existingPos.lev
          : 1,
      tp: sp.tp || 0,
      sl: sp.sl || 0,
      liqPrice: 0,
      pnl: sp.closePnl || 0,
      qty: sp.qty || 0,
      margin: sp.margin || sp.size || 0,
      tpPnl: sp.tpPnl || 0,
      slPnl: sp.slPnl || 0,
      addOnCount: sp.addOnCount || 0,
      originalEntry: sp.originalEntry || sp.price || sp.entry || 0,
      originalSize: sp.originalSize || sp.size || 0,
      originalQty: sp.originalQty || '',
      addOnHistory: sp.addOnHistory || [],
      slPct: sp.slPct || 0,
      rr: sp.rr || 0,
      // [Phase 3A] Fallback is explicit: manual/paper sourceMode → autoTrade=false.
      // For AT-origin (sourceMode='auto' or anything not manual/paper), AT-safe default=true.
      // If server sends sp.autoTrade explicitly, always trust that first.
      // [Phase 8B3] When server response omits BOTH autoTrade and sourceMode,
      // prefer the client's last-known ownership tag over the safe-AT default.
      // Without this, a manual position whose server snapshot drops ownership
      // fields would be silently reclassified to AT-owned, moving it off the
      // Manual card mid-session. Order: server field → client existingPos →
      // sp.sourceMode heuristic → existingPos.sourceMode heuristic → default true.
      // [Phase 9A1] autoTrade resolution, strict conservative default:
      //   1. Server explicit wins.
      //   2. Else preserve existingPos.autoTrade (never change owner mid-life).
      //   3. Else derive from sp.sourceMode if present.
      //   4. Else derive from existingPos.sourceMode.
      //   5. Else default FALSE (conservative manual ownership).
      //      Previously defaulted to TRUE which caused brand-new positions
      //      without any server ownership info to land on the AT card.
      autoTrade: (sp.autoTrade !== undefined)
        ? !!sp.autoTrade
        : (existingPos && typeof existingPos.autoTrade === 'boolean')
          ? existingPos.autoTrade
          : (sp.sourceMode === 'auto')
            ? true
            : (sp.sourceMode === 'manual' || sp.sourceMode === 'paper' || sp.sourceMode === 'assist')
              ? false
              : (existingPos && existingPos.sourceMode === 'auto')
                ? true
                : (existingPos && (existingPos.sourceMode === 'manual' || existingPos.sourceMode === 'paper' || existingPos.sourceMode === 'assist'))
                  ? false
                  : false,
      openTs: sp.ts || sp.openTs || Date.now(),
      label: ((sp.mode === 'live') ? (w._executionEnv === 'TESTNET' ? '\uD83D\uDFE1 TESTNET' : (w._executionEnv === 'REAL' ? '\uD83D\uDD34 LIVE' : '\u26D4 LOCKED')) : '\uD83C\uDFAE DEMO') + ' ' + (sp.side || ''),
      mode: sp.mode || 'demo',
      // [SERVER-ARES P2 2026-06-07] Engine attribution \u2014 'ARES' rows render in
      // the ARES panel and are EXCLUDED from the AT panel (renderATPositions).
      // Server value wins; preserve the client's last-known tag otherwise.
      owner: (sp.owner != null) ? sp.owner : ((existingPos && existingPos.owner) || undefined),
      // [Phase 9A1] Ownership resolution, strict order:
      //   1. Explicit server value wins.
      //   2. Else client's existingPos value (preserves whatever opened the pos).
      //   3. Else derive from sp.autoTrade if present (true → auto, false → manual).
      //   4. Else 'manual' — conservative default so an unidentified position
      //      lands in the Manual panel instead of being falsely claimed by AT.
      sourceMode: sp.sourceMode
        ? sp.sourceMode
        : (existingPos && existingPos.sourceMode)
          ? existingPos.sourceMode
          : (sp.autoTrade === true)
            ? 'auto'
            : (sp.autoTrade === false)
              ? 'manual'
              : 'manual',
      controlMode: sp.controlMode
        ? sp.controlMode
        : (existingPos && existingPos.controlMode)
          ? existingPos.controlMode
          : (sp.autoTrade === true)
            ? 'auto'
            : 'manual',
      brainModeAtOpen: sp.brainModeAtOpen
        ? sp.brainModeAtOpen
        : (existingPos && existingPos.brainModeAtOpen)
          ? existingPos.brainModeAtOpen
          : (sp.autoTrade === true)
            ? 'auto'
            : 'manual',
      dslParams: (existingPos && existingPos.dslParams && (
        existingPos.controlMode === 'user' ||
        existingPos.controlMode === 'paper' ||
        existingPos._dslUserEdited ||
        !existingPos.autoTrade ||
        (existingPos._dslParamsPushedAt && (Date.now() - existingPos._dslParamsPushedAt) < 10000)
      )) ? existingPos.dslParams : (sp.dslParams || {}),
      _dslUserEdited: existingPos ? !!existingPos._dslUserEdited : !!sp._dslUserEdited,
      dslAdaptiveState: (sp.dsl && sp.dsl.phase) ? sp.dsl.phase : 'calm',
      dslHistory: existingPos ? (existingPos.dslHistory || []) : [],
      closed: sp.status ? sp.status !== 'OPEN' : !!sp.closed,
      _serverSeq: sp.seq,
      _serverMode: sp.mode,
      _dsl: sp.dsl || null,
      _classifySource: 'ws_push',
      _classifyExchange: sp.exchange || 'binance',
    }
  }

  const _pendingServerCloses: any = {}
  const _pendingCloseIds: any = {}
  w._zeusRequestServerClose = function (seq: any, id: any) {
    _pendingServerCloses[seq] = Date.now()
    if (id) _pendingCloseIds[id] = Date.now()
  }
  w._zeusConfirmServerClose = function (seq: any) {
    delete _pendingServerCloses[seq]
  }

  // [WS-2] Frame-level seq dedup. Server WS-1 helper attaches `seq` field
  // (monotonic counter from _wsFrameSeq) on every getFullState payload. On
  // reconnect: warm-start frame + first onChange frame may carry divergent
  // snapshots if AT mutates în the millisecond gap between them. Tracking
  // last-applied frame seq lets us skip stale frames last-write-wins style
  // without trusting timestamps. Per-tab counter (resets on reload).
  let _lastAppliedFrameSeq = 0

  // ── [SRV-POS] Shadow mode — READ-ONLY diagnostic ──
  // Stores server positions separately; compares with legacy TP positions every 10s.
  // Zero state mutation — purely observational.
  let _shadowDemoPositions: any[] = []
  let _shadowLivePositions: any[] = []
  const _vectorHits = { v1: 0, v2: 0, v3: 0, v4: 0, v5: 0 }
  // Mutex imported from ../utils/positionMutex (acquirePositionWrite, releasePositionWrite)

  function _shadowCompare() {
    const TP = w.TP
    if (typeof TP === 'undefined') return
    const _srvPosMode = (w._executionEnv === 'REAL') ? 'real' : (w._executionEnv === 'TESTNET') ? 'testnet' : 'demo'
    const _flagOn = resolveEffectiveFlag(w._srvPosFlags, _srvPosMode)

    // Shadow = server positions. Compare target depends on flag state:
    // Flag OFF: compare server vs TP (detects classification drift)
    // Flag ON: compare server vs EXCHANGE (detects server-exchange drift, since TP = server)
    let compareAll: any[]
    if (_flagOn) {
      const exPositions = w._lastExchangePositions
      if (!Array.isArray(exPositions) || exPositions.length === 0) return
      compareAll = exPositions.map((p: any) => ({
        sym: p.symbol, side: p.side, mode: 'live',
        autoTrade: null, _classifySource: 'exchange_raw',
      }))
    } else {
      compareAll = (TP.demoPositions || []).concat(TP.livePositions || [])
    }

    const shadowAll = _shadowDemoPositions.concat(_shadowLivePositions)
    let divergences = 0
    const divergenceDetails: any[] = []
    const shadowMap = new Map<string, any>()
    shadowAll.forEach((p: any) => {
      const key = `${p.sym || p.symbol}/${p.side}/${p.mode || 'demo'}`
      shadowMap.set(key, p)
    })
    compareAll.forEach((p: any) => {
      const key = `${p.sym || p.symbol}/${p.side}/${p.mode || 'demo'}`
      const sp = shadowMap.get(key)
      if (!sp) return
      const legacyAT = !!p.autoTrade
      const shadowAT = !!sp.autoTrade
      // [SHADOW-FP 2026-06-07] exchange_raw rows carry no attribution
      // (autoTrade hardcoded null above) — comparing it flagged every
      // server-side AT position as a permanent v1 false positive.
      if (shouldFlagAttributionDivergence(p, sp)) {
        divergences++
        // Vector detection based on _classifySource marker
        const source = p._classifySource || 'unknown'
        if (source === 'sync_merge') _vectorHits.v3++
        else if (source === 'boot_resume') _vectorHits.v4++
        else if (source === 'ws_push') _vectorHits.v2++
        else if (p.autoTrade === undefined || p.autoTrade === null) _vectorHits.v1++
        else _vectorHits.v5++

        const detail = { key, legacyAT, shadowAT, source, id: p.id }
        divergenceDetails.push(detail)
        console.warn(`[SRV-POS SHADOW] DIVERGENCE ${key}: legacy=${legacyAT} shadow=${shadowAT} source=${source}`)
      }
      shadowMap.delete(key)
    })
    if (divergences > 0) {
      console.warn(`[SRV-POS SHADOW] ${divergences} divergences. vectors=${JSON.stringify(_vectorHits)} writeDrops=${getDropCount()}`)
      // Report to server for operator visibility
      _reportDivergence(divergences, divergenceDetails)
    }
  }

  // Per-tab cooldown — multi-tab scenario (3 tabs × 1/min = 3/min) is acceptable:
  // server buffer is 100 entries and server rate limit is 5/min per IP, so 3 tabs
  // give ~33min of data before eviction. Not worth localStorage coordination overhead.
  let _lastDivergenceReport = 0
  function _reportDivergence(count: number, details: any[]) {
    if (Date.now() - _lastDivergenceReport < 60000) return
    _lastDivergenceReport = Date.now()
    try {
      fetch('/api/srv-pos/shadow-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-zeus-request': '1' },
        body: JSON.stringify({
          ts: Date.now(),
          count,
          vectors: { ..._vectorHits },
          writeDrops: getDropCount(),
          details: details.slice(0, 10),
        }),
      }).catch(() => {})
    } catch (_) {}
  }

  // Compare every 10s
  setInterval(_shadowCompare, 10000)

  // Expose diagnostics for /api/market/cache/health
  w._srvPosDiagnostics = function () {
    return {
      vectorHits: { ..._vectorHits },
      writeDropCount: getDropCount(),
      shadowDemo: _shadowDemoPositions.length,
      shadowLive: _shadowLivePositions.length,
      lastFrameSeq: _lastAppliedFrameSeq,
      writeLockHeld: getLockHeld(),
    }
  }
  w._acquirePositionWrite = acquirePositionWrite
  w._releasePositionWrite = releasePositionWrite

  function _applyServerATState(state: any) {
    if (!state) return
    if (shouldSkipFrameForExchange(state.exchange, w._activeExchange)) {
      console.warn(`[SRV-POS] frame for ${state.exchange}, active=${w._activeExchange}, skipped`)
      return
    }
    // [WS-2] dedup gate — skip if frame seq is not strictly newer than last
    // applied (handles reconnect duplicate scenarios where warm-start +
    // onChange race în the same RAF). Lenient: missing seq still applies
    // (legacy server payloads pre-WS-1).
    if (typeof state.seq === 'number' && state.seq > 0) {
      // [SRV-POS] SEQ RESET detection: PM2 reload → server seq restarts at 1.
      // If new seq is less than 50% of tracked seq, it's a server restart, not a stale frame.
      if (state.seq <= _lastAppliedFrameSeq) {
        if (_lastAppliedFrameSeq > 10 && state.seq < _lastAppliedFrameSeq * 0.5) {
          console.warn(`[SRV-POS] seq reset detected (old=${_lastAppliedFrameSeq}, new=${state.seq}), tracker reset`)
          _lastAppliedFrameSeq = 0
        } else {
          return
        }
      }
      _lastAppliedFrameSeq = state.seq
    }
    // [SP2-9] Stash ownership state for future "SERVER/YOU DRIVING / SAFETY NET ON" indicator (data-only).
    if (state.ownership) { try { (window as any).ZEUS_OWNERSHIP = state.ownership } catch (_) {} }
    const TP = w.TP
    const AT = getATObject()
    const Intervals = w.Intervals
    // [LOCKOUT-FIX] Only consider server AT authoritative when server actually
    // drives brain+AT (MF.SERVER_AT && MF.SERVER_BRAIN). Legacy clients without
    // the serverActive field default to the old behavior (locked).
    // [POS-FLICKER FIX R2] Only update _serverATEnabled when the field is
    // explicitly present in the response. AT-state-only payloads from
    // /api/at/state often omit serverActive — defaulting them to true caused
    // the serialize filter to flip-flop, producing the pos:3 → pos:0 → pos:3
    // flicker every ~10s.
    if ('serverActive' in state) {
      const _prev = !!w._serverATEnabled
      const _next = state.serverActive !== false
      if (_prev !== _next) {
        // [FIX #3] Log MF.SERVER_AT flip so client lockout transitions are visible.
        try { console.warn('[AT/SERVER-FLIP] _serverATEnabled ' + _prev + ' → ' + _next + ' — client AT engine ' + (_next ? 'LOCKED (server owns)' : 'UNLOCKED (client owns)')) } catch (_) {}
        // [Task S8-P0-3 2026-05-28] Persist for next boot's pre-arm race fix.
        try { _writeServerATCache(_next) } catch (_) {}
      }
      w._serverATEnabled = _next
    }
    // [Phase 2 S6-B4] Demo-authority window mirrors. Read-model only —
    // these flags are consumed by S6-B5+ to gate the client AT engine for
    // demo users; today (S6-B4) they are pure read state with no behavior
    // attached. Mirror only when the field is explicitly present so legacy
    // pre-S6-B4 server payloads (or AT-state-only payloads that omit them)
    // do not silently flip the window flags.
    if ('serverATDemoEnabled' in state) {
      w._serverATDemoEnabled = !!state.serverATDemoEnabled
    }
    if ('serverBrainDemoEnabled' in state) {
      w._serverBrainDemoEnabled = !!state.serverBrainDemoEnabled
    }
    if (state.srvPosFlags) {
      w._srvPosFlags = state.srvPosFlags
      // [PAPER-LOCKED ROOT FIX 2026-06-15] Mark flags as server-loaded so
      // liveApiSyncState stops treating the default {master:false} as "legacy
      // path" during the boot/refresh window (which dropped autoTrade → PAPER).
      w._srvPosFlagsLoaded = true
    }
    const _now = Date.now()
    Object.keys(_pendingServerCloses).forEach(function (k) {
      if (_now - _pendingServerCloses[k] > 120000) delete _pendingServerCloses[k]
    })
    Object.keys(_pendingCloseIds).forEach(function (k) {
      if (_now - _pendingCloseIds[k] > 120000) delete _pendingCloseIds[k]
    })
    const _rcSet = new Set<string>()
    if (Array.isArray(w._zeusRecentlyClosed)) {
      w._zeusRecentlyClosed.forEach(function (id: any) { _rcSet.add(String(id)) })
    }
    Object.keys(_pendingCloseIds).forEach(function (k) { _rcSet.add(String(k)) })
    if (w._syncClosedIds && w._syncClosedIds.size > 0) {
      w._syncClosedIds.forEach(function (id: string) { _rcSet.add(id) })
    }
    function _filterOpen(arr: any[]) {
      return (arr || []).filter(function (p: any) {
        if (p.status && p.status !== 'OPEN') return false
        if (p.closed) return false
        if (_pendingServerCloses[p.seq]) return false
        return true
      })
    }
    function _excludeRecentlyClosed(mapped: any[]) {
      if (_rcSet.size === 0) return mapped
      const result = mapped.filter(function (p: any) {
        const excluded = _rcSet.has(String(p.id)) || _rcSet.has(String(p._serverSeq))
        return !excluded
      })
      return result
    }
    if (typeof TP !== 'undefined') {
      // [POS-FLICKER FIX] Skip position rebuild entirely if the response carries
      // no position keys at all (e.g. an AT-state-only payload from /api/at/state).
      // Without this guard, the rebuild path runs with serverATDemo=[] and wipes
      // TP.demoPositions every 10s — causing the panel to flicker until the next
      // pullAndMerge restores them. We still rebuild when the server explicitly
      // returns position arrays (even empty), which is the legitimate "all closed"
      // signal.
      const _hasPosKeys = ('demoPositions' in state) || ('livePositions' in state) || ('positions' in state)
      if (!_hasPosKeys) {
        // fall through to AT-state sync below; leave TP.demoPositions alone
      } else {
      let serverATDemo: any[], serverATLive: any[]
      if (state.demoPositions && state.livePositions) {
        const _rawFiltered = _filterOpen(state.demoPositions)
        serverATDemo = _excludeRecentlyClosed(_rawFiltered.map(_mapServerPos))
        serverATLive = _excludeRecentlyClosed(_filterOpen(state.livePositions).map(_mapServerPos))
        w._lastServerPositions = (state.livePositions || []).concat(state.demoPositions || [])
        // [P5A CLIENT AT UPDATE] Cache write via split arrays path.
        try {
          const _liveKeys = (state.livePositions || []).map((p: any) => `${p.symbol || p.sym}/${p.side}/autoTrade=${p.autoTrade}/src=${p.sourceMode || '?'}/live=${p.live ? p.live.status : 'none'}`)
          console.log(`[P5A CLIENT AT UPDATE] split-path cache written live=${(state.livePositions||[]).length} demo=${(state.demoPositions||[]).length} liveKeys=[${_liveKeys.join(' | ')}] execEnv=${(w as any)._executionEnv || 'n/a'} atMode=${(state as any).mode} ts=${Date.now()}`)
        } catch (_) {}
      } else {
        const serverPosns = _filterOpen(state.positions)
        const mapped = serverPosns.map(_mapServerPos)
        serverATDemo = _excludeRecentlyClosed(mapped.filter(function (p: any) { return p.mode !== 'live' }))
        serverATLive = _excludeRecentlyClosed(mapped.filter(function (p: any) { return p.mode === 'live' }))
        w._lastServerPositions = state.positions || []
        // [P5A CLIENT AT UPDATE] Cache write via fallback positions-only path (NO split arrays — weaker signal).
        try {
          const _allKeys = (state.positions || []).map((p: any) => `${p.symbol || p.sym}/${p.side}/mode=${p.mode}/autoTrade=${p.autoTrade}/src=${p.sourceMode || '?'}`)
          console.log(`[P5A CLIENT AT UPDATE] fallback-path cache written total=${(state.positions||[]).length} keys=[${_allKeys.join(' | ')}] execEnv=${(w as any)._executionEnv || 'n/a'} atMode=${(state as any).mode} ts=${Date.now()}`)
        } catch (_) {}
      }
      const _serverDemoIds = new Set<string>()
      serverATDemo.forEach(function (p: any) { _serverDemoIds.add(String(p.id)); if (p._serverSeq) _serverDemoIds.add(String(p._serverSeq)) })
      const _serverLiveIds = new Set<string>()
      serverATLive.forEach(function (p: any) { _serverLiveIds.add(String(p.id)); if (p._serverSeq) _serverLiveIds.add(String(p._serverSeq)) })
      const clientOnlyDemo = (TP.demoPositions || []).filter(function (p: any) {
        if (p.closed) return false
        if (_rcSet.has(String(p.id))) return false
        if (!p.autoTrade && !p._serverSeq) return true
        // [POS-FLICKER FIX R4] Keep client-originated AT positions that are not
        // (yet) server-backed. Client AT engine can open positions faster than
        // the server register round-trip, so these live without _serverSeq for
        // some time. Dropping them here when server returns empty caused the
        // panel to flicker: _applyServerATState wiped them every 10s and the
        // pullMerge-demo from /api/sync/state restored them. Keep if either
        // explicitly _localOnly, OR has no _serverSeq (not yet registered).
        if (p.autoTrade && !_serverDemoIds.has(String(p.id)) && !_serverDemoIds.has(String(p._serverSeq)) && (p._localOnly || !p._serverSeq)) return true
        return false
      })
      const clientOnlyLive = (TP.livePositions || []).filter(function (p: any) {
        if (p.closed) return false
        if (_rcSet.has(String(p.id))) return false
        if (!p.autoTrade && !p._serverSeq) return true
        // Same rationale as demo — keep client-originated AT positions not yet server-backed.
        if (p.autoTrade && !_serverLiveIds.has(String(p.id)) && !_serverLiveIds.has(String(p._serverSeq)) && (p._localOnly || !p._serverSeq)) return true
        return false
      })
      // [Phase 8B1] Atomic sync barrier — compute next demo + live arrays into
      // locals, then assign TP.demoPositions / TP.livePositions / demo balance
      // fields in one tight block with no intervening function calls. Previously
      // TP.demoPositions was assigned on line 1 and TP.livePositions on line 14
      // with function-filter bodies in between; any engine code that read both
      // fields in that window saw mixed-era state (new demo + stale live).
      const _seenDemoIds = new Set<string>()
      const _seenDemoSeqs = new Set<string>()
      const _nextDemoPositions = serverATDemo.concat(clientOnlyDemo).filter(function (p: any) {
        const pid = String(p.id)
        if (_seenDemoIds.has(pid)) return false
        _seenDemoIds.add(pid)
        if (p._serverSeq) {
          const sk = String(p._serverSeq)
          if (_seenDemoSeqs.has(sk)) return false
          _seenDemoSeqs.add(sk)
        }
        return true
      })
      const _seenLiveIds = new Set<string>()
      const _seenLiveSeqs = new Set<string>()
      const _nextLivePositions = serverATLive.concat(clientOnlyLive).filter(function (p: any) {
        const pid = String(p.id)
        if (_seenLiveIds.has(pid)) return false
        _seenLiveIds.add(pid)
        if (p._serverSeq) {
          const sk = String(p._serverSeq)
          if (_seenLiveSeqs.has(sk)) return false
          _seenLiveSeqs.add(sk)
        }
        return true
      })
      // [SRV-POS] Shadow update — READ-ONLY, never touches TP
      _shadowDemoPositions = serverATDemo.slice()
      _shadowLivePositions = serverATLive.slice()

      // [SRV-POS 4.4] Flag-gated TP write
      const _srvPosMode = (w._executionEnv === 'REAL') ? 'real' : (w._executionEnv === 'TESTNET') ? 'testnet' : 'demo'
      const _srvPosActive = resolveEffectiveFlag(w._srvPosFlags, _srvPosMode)

      // [Phase 8B1] Single atomic TP mutation — no function calls between writes.
      // [SRV-POS] Newer-wins mutex: protects against WS push + liveApi sync racing.
      const _writeSeq = acquirePositionWrite()
      if (_writeSeq === 0) {
        // Stale writer — drop silently (logged in acquirePositionWrite)
      } else {
      const _prevMerging = _merging
      _merging = true
      try {
        if (_srvPosActive) {
          // Flag ON: server positions are CANONICAL — no clientOnly merge
          // [FLICKER-FIX] When WS positions.changed is active, skip REST overwrite.
          // WS is real-time; REST poll is stale by up to 10s and causes flicker
          // by replacing positions with a snapshot that may be missing newly opened ones.
          const _wsActive = (w as any)._positionsChangedActive === true
          if (!_wsActive) {
            TP.demoPositions = serverATDemo
            TP.livePositions = serverATLive
          }
        } else {
          // Flag OFF: legacy merge (server + clientOnly)
          TP.demoPositions = _nextDemoPositions
          TP.livePositions = _nextLivePositions
        }
        if (state.demoBalance) {
          TP.demoBalance = state.demoBalance.balance || TP.demoBalance
          TP.demoPnL = state.demoBalance.pnl || 0
          TP._serverStartBalance = state.demoBalance.startBalance || 10000
        }
      } finally {
        _merging = _prevMerging
        releasePositionWrite(_writeSeq)
      }
      }
      // [Phase 8B1] Render AFTER the atomic mutation block.
      if (typeof renderLivePositions === 'function') renderLivePositions()
      } // end _hasPosKeys block
    }
    if (typeof AT !== 'undefined') {
      AT.killTriggered = !!state.killActive
      AT.killReason = state.killReason || null
      AT.killLoss = state.killLoss || 0
      AT.killLimit = state.killLimit || 0
      AT.killBalRef = state.killBalRef || 0
      AT.killModeAtTrigger = state.killModeAtTrigger || null
      AT.killActiveAt = state.killActiveAt || 0
      // Server is source of truth for dailyPnL — sync to window.AT to avoid stale localStorage drift
      if (typeof state.dailyPnL === 'number') AT.dailyPnL = state.dailyPnL
      // [Task S8-P1-4 2026-05-28] When the server owns AT, the client's
      // _bmPostClose never fires, so w.BM.lossStreak/dailyTrades would stay 0
      // and brain PREDATOR/DEFENSE gates would mis-compute. Mirror the
      // server-broadcast counters into BM so the gates stay correct. Only
      // when server-authoritative — in client-AT mode BM owns these locally.
      if (w._serverATEnabled) {
        try {
          const _bm = getBrainMetrics()
          if (_bm) {
            if (typeof state.lossStreak === 'number') _bm.lossStreak = state.lossStreak
            if (typeof state.winStreak === 'number') _bm.winStreak = state.winStreak
            if (typeof state.dailyTrades === 'number') _bm.dailyTrades = state.dailyTrades
          }
        } catch (_) { /* BM not ready — non-fatal */ }
      }
      if (!state.killActive && state.killActiveAt === 0) {
        // Kill cleared on server — wipe local realized counter so journal recompute can't retrigger
        AT.realizedDailyPnL = 0
      }
      if (typeof state.killPct === 'number' && state.killPct > 0) {
        // [R34] Typed `HTMLInputElement | null` — targets a number input.
        const _kpEl = document.getElementById('atKillPct') as HTMLInputElement | null
        if (_kpEl) _kpEl.value = String(state.killPct)
      }
      // [MODE-RESTORE-FIX 2026-05-14] Removed legacy `AT._enabledPerMode` cache +
      // auto-restore via setTimeout(toggleAutoTrade, 600) on WS mode switch.
      // Post-BUG-T7 (atActive split into atActiveDemo + atActiveLive 2026-05-13),
      // server `state.atActive` IS already per-mode authoritative — block below
      // (`if (typeof state.atActive === 'boolean') ...`) syncs AT.enabled from
      // server truth and calls _applyATToggleUI. Legacy auto-restore raced with
      // it: 600ms later toggleAutoTrade() FLIPPED state, undid server-correct
      // value, triggered POST /api/at/toggle + _usScheduleSave 800ms later →
      // POST /api/user/settings → 409 cascade când multi-device. Audit_log
      // smoking gun: AT_MODE_CHANGE imediat urmat de AT_TOGGLE was=true→now=false
      // la +1 sec, NU operator-initiated.
      const _prevMode = AT._serverMode || AT.mode || 'demo'
      if (state.mode && state.mode !== _prevMode && AT.enabled) {
        AT.enabled = false
        if (typeof Intervals !== 'undefined') Intervals.clear('atCheck')
        clearInterval(AT.interval); AT.interval = null
        useATStore.getState().patchUI({ btnClass: 'at-main-btn off', dotBg: '#aa44ff', dotShadow: '0 0 6px #aa44ff', btnText: 'AUTO TRADE OFF' })
      }
      if (state.mode) { AT.mode = state.mode; AT._serverMode = state.mode; AT._modeConfirmed = true }
      AT._serverStats = state.stats || null
      AT._serverDemoStats = state.demoStats || null
      AT._serverLiveStats = state.liveStats || null
      const _ds = state.demoStats || state.stats
      if (_ds) {
        TP.demoWins = _ds.wins || 0
        TP.demoLosses = _ds.losses || 0
      }
    }
    if (typeof state.atActive === 'boolean' && typeof AT !== 'undefined') {
      if (AT.enabled !== state.atActive) {
        AT.enabled = state.atActive
        if (typeof _applyATToggleUI === 'function') _applyATToggleUI(state.atActive)
      }
    }
    // [BUG-T7 2026-05-17] Mirror per-mode atActive into uiStore for ModeBar
    // opposite-mode badge. Server already split atActive into atActiveDemo +
    // atActiveLive (BUG-T7 2026-05-13); the opposite-mode value is whichever
    // is NOT the current engineMode. False when server omits the field.
    try {
      const _cur = (state.mode || AT.mode || 'demo')
      const _opp = _cur === 'live' ? state.atActiveDemo : state.atActiveLive
      const _oppBool = typeof _opp === 'boolean' ? _opp : false
      const _uiState: any = require('../stores/uiStore').useUiStore.getState()
      if (_uiState.oppositeModeAtEnabled !== _oppBool && typeof _uiState.patch === 'function') {
        _uiState.patch({ oppositeModeAtEnabled: _oppBool })
      }
    } catch (_) {}
    w._apiConfigured = !!state.apiConfigured
    w._exchangeMode = state.exchangeMode || null
    // [Phase 3D] resolvedEnv mirror uses server canonical truth directly — no false derivation.
    // When exec is blocked (null), mirror stays null. Legacy fallback removed.
    w._resolvedEnv = (state.resolvedEnv !== undefined && state.resolvedEnv !== null) ? state.resolvedEnv : null
    // Phase 2C: canonical mirrors. null is preserved (LOCKED state for non-demo).
    w._executionEnv = (state.executionEnv !== undefined) ? state.executionEnv : null
    w._executionBlockedReason = (state.executionBlockedReason !== undefined) ? state.executionBlockedReason : null
    w.executionReady = !!(state.apiConfigured && state.mode === 'live' && !state.killActive)
    if (state.mode) _applyGlobalModeUI(state.mode)
    if (typeof updateATMode === 'function') updateATMode()
    updateATStats()
    renderATPositions()
    if (typeof w.updateDemoBalance === 'function') w.updateDemoBalance()
    if (typeof w.atUpdateBanner === 'function') w.atUpdateBanner()
    if (typeof w.ptUpdateBanner === 'function') w.ptUpdateBanner()
    if (typeof w.dslUpdateBanner === 'function') w.dslUpdateBanner()
  }

  function _startATPolling() {
    if (_atPollTimer) return
    _atPollOnce()
    _atPollTimer = w.Intervals.set('atPoll', _atPollOnce, 30000)
  }

  function _retryFailedCloses() {
    if (!Array.isArray(w._zeusCloseFailedSeqs) || w._zeusCloseFailedSeqs.length === 0) return
    const stale = w._zeusCloseFailedSeqs.splice(0, w._zeusCloseFailedSeqs.length)
    const now = Date.now()
    for (let i = 0; i < stale.length; i++) {
      if (now - stale[i].ts > 300000) continue
      const entry = stale[i]
      fetch('/api/at/close', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seq: entry.seq }) })
        .then(function (r) { return r.ok ? r.json() : null })
        .then(function (d: any) { if (d && d.ok && typeof w._zeusConfirmServerClose === 'function') w._zeusConfirmServerClose(entry.seq) })
        .catch(function () { w._zeusCloseFailedSeqs = w._zeusCloseFailedSeqs || []; w._zeusCloseFailedSeqs.push({ seq: entry.seq, id: entry.id, ts: entry.ts }) })
    }
  }

  function _atPollOnce() {
    _retryFailedCloses()
    fetch('/api/at/state', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (data: any) { if (data) _applyServerATState(data) })
      .catch(function () { /* */ })
    // [L1-DIAG] Poll server AT block reasons and surface in atLog feed
    _pollServerBlocks()
  }

  // [L1-DIAG] Track last seen server block timestamp + dedup key
  let _lastSrvBlockTs = 0
  let _lastSrvBlockKey = ''
  function _pollServerBlocks() {
    const qs = _lastSrvBlockTs > 0 ? ('?since=' + _lastSrvBlockTs) : ''
    fetch('/api/brain/recent-blocks' + qs, { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (data: any) {
        if (!data || !data.ok || !Array.isArray(data.blocks)) return
        for (const b of data.blocks) {
          if (!b || !b.ts) continue
          if (b.ts <= _lastSrvBlockTs) continue
          _lastSrvBlockTs = b.ts
          const sym = String(b.symbol || '?').replace('USDT', '')
          const reasons = Array.isArray(b.reasons) ? b.reasons.join(',') : String(b.reasons || '?')
          const key = sym + '|' + (b.stage || '') + '|' + reasons
          if (key === _lastSrvBlockKey) continue
          _lastSrvBlockKey = key
          const parts = ['[SRV-BLOCK] ' + sym]
          if (b.stage) parts.push('stage=' + b.stage)
          if (b.score != null) parts.push('conf=' + b.score)
          if (b.adx != null) parts.push('adx=' + (typeof b.adx === 'number' ? b.adx.toFixed(0) : b.adx))
          if (b.confidence != null) parts.push('fconf=' + b.confidence)
          parts.push('reasons=[' + reasons + ']')
          atLog('info', parts.join(' '))
        }
      })
      .catch(function () { /* */ })
  }

  // ── Offline queue ──
  if (typeof window !== 'undefined') {
    window.addEventListener('online', function () {
      if (_offlinePending) {
        _offlinePending = false
        console.log('[sync] back online — pushing pending state')
        setTimeout(_pushToServer, 1500)
      }
      _connectWS()
    })
  }

  function pullFromServer() {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    const timer = ctrl ? setTimeout(function () { ctrl!.abort() }, 10000) : null
    const opts: any = { credentials: 'same-origin' }
    if (ctrl) opts.signal = ctrl.signal
    return fetch('/api/sync/state', opts).then(function (r) {
      if (timer) clearTimeout(timer)
      if (!r.ok) { console.warn('[sync] pull HTTP', r.status); return null }
      return r.json()
    })
      .then(function (j: any) {
        if (!j) return null
        if (!j.ok || !j.data) { console.warn('[sync] pull state \u2014 server returned:', j); return null }
        return j.data
      }).catch(function (e: any) { if (timer) clearTimeout(timer); console.warn('[sync] pull state FAILED:', e.message || e); return null })
  }

  function pullJournalFromServer() {
    return fetch('/api/sync/journal', { credentials: 'same-origin' }).then(function (r) { return r.json() })
      .then(function (j: any) {
        if (!j.ok || !j.data) return null
        return j.data
      }).catch(function (e: any) { console.warn('[sync] pull journal FAILED:', e.message || e); return null })
  }

  const _origSave = save
  function saveAndSync() {
    _origSave()
    syncToServer()
  }
  function saveLocalOnly() {
    _origSave()
  }

  function scheduleSaveAndSync() {
    markDirty()
    if (_saveTimer) clearTimeout(_saveTimer)
    _saveTimer = setTimeout(saveAndSync, 800)
  }

  // ── [B16] Shared merge helpers ──
  function _buildClosedSet(serverClosedIds: any) {
    const TP = w.TP
    const s = new Set<string>()
    if (Array.isArray(TP.journal)) TP.journal.forEach(function (j: any) { if (j.id) s.add(String(j.id)) })
    if (Array.isArray(w._zeusRecentlyClosed)) w._zeusRecentlyClosed.forEach(function (id: any) { s.add(String(id)) })
    if (Array.isArray(serverClosedIds)) serverClosedIds.forEach(function (id: any) { s.add(String(id)) })
    return s
  }

  function _mergePositionsInto(targetArray: any[], serverPositions: any[], closedSet: Set<string>, label: string) {
    if (!Array.isArray(targetArray) || !Array.isArray(serverPositions)) return 0
    const existingIds = new Set(targetArray.map(function (p: any) { return String(p.id) }))
    const existingSeqs = new Set(targetArray.filter(function (p: any) { return p._serverSeq }).map(function (p: any) { return String(p._serverSeq) }))
    let added = 0
    serverPositions.forEach(function (p: any) {
      if (p.closed || closedSet.has(String(p.id)) || existingIds.has(String(p.id))) return
      if (p.seq && existingSeqs.has(String(p.seq))) return
      if (p._serverSeq && existingSeqs.has(String(p._serverSeq))) return
      targetArray.push(Object.assign({}, p, { _restored: true }))
      added++
    })
    if (added > 0) console.log('[sync] ' + label + ' — merged ' + added + ' position(s)')
    return added
  }

  w._zeusMerge = { buildClosedSet: _buildClosedSet, mergePositionsInto: _mergePositionsInto }

  function pullAndMerge(): Promise<boolean> {
    if (_saving) { console.log('[sync] pullAndMerge deferred — save in progress'); return Promise.resolve(false) }
    _merging = true
    // 15s safety timeout — prevents _merging lock if server hangs
    const _mergeTimeout = setTimeout(function () { _merging = false }, 15000)
    return pullFromServer().then(function (serverSnap: any) {
      if (!serverSnap || !serverSnap.ts) return false
      const TP = w.TP
      const AT = getATObject()
      const Intervals = w.Intervals

      if (typeof TP === 'undefined') return false
      const localSnap = load()
      const localTs = (localSnap && localSnap.ts) ? localSnap.ts : 0
      let changed = false
      const _closedSet = _buildClosedSet(serverSnap.closedIds)

      if (Array.isArray(serverSnap.closedIds) && serverSnap.closedIds.length > 0) {
        if (!w._syncClosedIds) w._syncClosedIds = new Set<string>()
        serverSnap.closedIds.forEach(function (id: any) { w._syncClosedIds.add(String(id)) })
      }

      if (w._serverATEnabled) {
        // Skip position merge — _applyServerATState handles positions
      } else {
        if (serverSnap.positions && serverSnap.positions.length) {
          TP.demoPositions = TP.demoPositions || []
          TP.livePositions = TP.livePositions || []
          const demoOnly = serverSnap.positions.filter(function (p: any) { return (p.mode || 'demo') !== 'live' })
          const liveOnly = serverSnap.positions.filter(function (p: any) { return (p.mode || 'demo') === 'live' })
          if (_mergePositionsInto(TP.demoPositions, demoOnly, _closedSet, 'pullMerge-demo') > 0) changed = true
          if (_mergePositionsInto(TP.livePositions, liveOnly, _closedSet, 'pullMerge-live') > 0) changed = true
        }
        {
          const serverIds = new Set((serverSnap.positions || []).map(function (p: any) { return String(p.id) }))
          const serverClosedIds2 = new Set(Array.isArray(serverSnap.closedIds) ? serverSnap.closedIds.map(String) : [])
          const now = Date.now()
          function _cleanArray(arr: any[]) {
            const toRemove: string[] = []
            ;(arr || []).forEach(function (p: any) {
              const pid = String(p.id)
              // [POS-FLICKER FIX R3] Server-managed AT positions (with _serverSeq)
              // live in /api/at/state, NOT in /api/sync/state. The sync file omits
              // them by design (serialize filter at line ~359). Without this guard
              // _cleanArray would mistake them for "stale" and remove them every
              // pullAndMerge tick — then _applyServerATState restores them at the
              // next /api/at/state poll. That ping-pong is what users see as the
              // panel positions disappearing for a few seconds and reappearing.
              if (p && p._serverSeq && p.autoTrade) return
              if (serverClosedIds2.has(pid) || _closedSet.has(pid)) {
                toRemove.push(pid)
              } else if (!p.closed && !serverIds.has(pid) && serverSnap.ts > (p.openTs || p.id) && (now - (p.openTs || p.id)) > 120000) {
                toRemove.push(pid)
              }
            })
            if (toRemove.length > 0) { changed = true; return (arr || []).filter(function (p: any) { return toRemove.indexOf(String(p.id)) === -1 }) }
            return arr
          }
          TP.demoPositions = _cleanArray(TP.demoPositions)
          TP.livePositions = _cleanArray(TP.livePositions)
        }
      }

      const _serverEditTs = serverSnap.lastEditTs || serverSnap.ts || 0
      if (!w._serverATEnabled && serverSnap.ts > localTs && !(_dirty && _lastEditTs > _serverEditTs)) {
        const _lActive = (TP.demoPositions || []).filter(function (p: any) { return !p.closed }).length
        const _sPos = (serverSnap.positions || []).length
        if (!(_lActive > 0 && _sPos === 0) && !(Math.abs(_lActive - _sPos) > 2 && _lActive > 0)) {
          if (typeof serverSnap.demoBalance === 'number' && isFinite(serverSnap.demoBalance)) { TP.demoBalance = serverSnap.demoBalance; changed = true }
          if (typeof serverSnap.demoPnL === 'number') TP.demoPnL = serverSnap.demoPnL
          if (typeof serverSnap.demoWins === 'number') TP.demoWins = serverSnap.demoWins
          if (typeof serverSnap.demoLosses === 'number') TP.demoLosses = serverSnap.demoLosses
        }
        if (serverSnap.at && typeof AT !== 'undefined') {
          if (typeof serverSnap.at.killTriggered === 'boolean') AT.killTriggered = serverSnap.at.killTriggered
          if (typeof serverSnap.at.realizedDailyPnL === 'number') AT.realizedDailyPnL = serverSnap.at.realizedDailyPnL
          if (typeof serverSnap.at.closedTradesToday === 'number') AT.closedTradesToday = serverSnap.at.closedTradesToday
          if (typeof serverSnap.at.enabled === 'boolean' && serverSnap.at.enabled !== AT.enabled) {
            AT.enabled = serverSnap.at.enabled
            changed = true
            setTimeout(function () {
              if (typeof w.atUpdateBanner === 'function') w.atUpdateBanner()
              if (typeof w.ptUpdateBanner === 'function') w.ptUpdateBanner()
              if (AT.enabled) {
                useATStore.getState().patchUI({ btnClass: 'at-main-btn on', dotBg: '#00ff88', dotShadow: '0 0 10px #00ff88', btnText: 'AUTO TRADE ON', status: { icon: 'dGrn', text: 'Active \u2014 scan every 30s', action: null } })
                if (!AT.interval && typeof runAutoTradeCheck === 'function') AT.interval = Intervals.set('atCheck', runAutoTradeCheck, 30000)
              } else {
                useATStore.getState().patchUI({ btnClass: 'at-main-btn off', dotBg: '#aa44ff', dotShadow: '0 0 6px #aa44ff', btnText: 'AUTO TRADE OFF', status: { icon: null, text: 'Configure below', action: null } })
                if (typeof Intervals !== 'undefined') Intervals.clear('atCheck')
                clearInterval(AT.interval); AT.interval = null
              }
            }, 50)
          }
          if (serverSnap.at.mode) AT.mode = serverSnap.at.mode
          if (typeof serverSnap.at.totalTrades === 'number') AT.totalTrades = serverSnap.at.totalTrades
          if (typeof serverSnap.at.wins === 'number') AT.wins = serverSnap.at.wins
          if (typeof serverSnap.at.losses === 'number') AT.losses = serverSnap.at.losses
          if (typeof serverSnap.at.totalPnL === 'number') AT.totalPnL = serverSnap.at.totalPnL
          if (typeof serverSnap.at.lastTradeTs === 'number') AT.lastTradeTs = serverSnap.at.lastTradeTs
          // [9A-4] Notify React after server AT diff applied
          try { window.dispatchEvent(new CustomEvent('zeus:atStateChanged')) } catch (_) {}
        }
      }

      if (changed) {
        saveLocalOnly()
        setTimeout(function () {
          if (typeof w.updateDemoBalance === 'function') w.updateDemoBalance()
          renderDemoPositions()
          renderATPositions()
          syncBrainFromState()
          // [9A-5] Notify React — positions/balance changed from server merge
          try { window.dispatchEvent(new CustomEvent('zeus:positionsChanged')) } catch (_) {}
        }, 100)
      }
      return changed
    }).catch(function (e: any) { console.warn('[sync] pullAndMerge failed:', e); return false })
      .finally(function () { clearTimeout(_mergeTimeout); _merging = false })
  }

  function syncBeacon() {
    try {
      const data = _serialize()
      const payload = JSON.stringify({
        ts: data.ts,
        positions: data.positions,
        demoBalance: data.demoBalance,
        demoPnL: data.demoPnL,
        demoWins: data.demoWins,
        demoLosses: data.demoLosses,
        at: data.at,
        closedIds: data.closedIds,
        symbol: data.symbol
      })
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/sync/state', new Blob([payload], { type: 'application/json' }))
        console.log('[sync] \u2705 beacon pushed (critical state)')
      } else {
        fetch('/api/sync/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, credentials: 'same-origin', keepalive: true })
      }
    } catch (_) { /* */ }
  }

  return { save: saveAndSync, saveLocal: saveLocalOnly, load, restore, clear, scheduleSave: scheduleSaveAndSync, syncToServer, syncNow, syncBeacon, pullFromServer, pullJournalFromServer, pullAndMerge, markSyncReady, startATPolling: _startATPolling, _applyPreboot: _applyServerATState, markDirty, isDirty: function () { return _dirty }, isMerging: function () { return _merging } }
})()

// ╔═══════════════════════════════════════════════════════════════════╗
// ║  GLOBAL DECLARATIONS                                              ║
// ╚═══════════════════════════════════════════════════════════════════╝

// Main state object S
export const S: any = {
  price: 0, prevPrice: 0, high: 0, low: 0,
  fr: null, frCd: null, oi: null, oiPrev: null, ls: null, atr: null,
  totalUSD: 0, longUSD: 0, shortUSD: 0, cnt: 0, longCnt: 0, shortCnt: 0,
  buckets: Array(20).fill(0).map(() => ({ l: 0, s: 0 })), bIdx: 0,
  pairs: {}, btcClusters: {}, asks: [], bids: [],
  bnbOk: false, bybOk: false,
  w1m: { l: 0, s: 0, v: 0 }, w5m: { l: 0, s: 0, v: 0 }, w15m: { l: 0, s: 0, v: 0 },
  rsi: {}, events: [], dtTf: '1H',
  soundOn: false, chartTf: '5m',
  indicators: { ema: true, wma: true, st: true, vp: true },
  overlays: { liq: false, zs: false, sr: false, llv: false, oflow: false, ovi: false },
  llvSettings: { bucketPct: 0.3, maxBarWidthPct: 30, opacity: 0.7, minUsd: 0, longCol: '#00d4aa', shortCol: '#ff4466', showLabels: true, labelMode: 'compact' },
  klines: [], liqMinUsd: 100 /* [LIQ-WARMUP 2026-06-07] 500→100, see marketStore */, liqSym: 'BTC', wsK: null,
  // [2026-06-13] Persist the chosen symbol across reloads (operator request).
  symbol: (() => { try { const s = localStorage.getItem('zeus_chart_symbol'); return (s && /^[A-Z0-9]{2,20}USDT$/.test(s)) ? s : 'BTCUSDT' } catch { return 'BTCUSDT' } })(), tz: 'Europe/Bucharest',
  magnetBias: 'neut',
  cloudEmail: '',
  alerts: { enabled: false, volSpike: true, volThreshold: 500, pivotCross: false, divergence: true, rsiAlerts: true, whaleOrders: true, whaleMinBtc: 100, liqAlerts: true, liqMinBtc: 1 },
  heatmapPockets: [],
  heatmapSettings: { lookback: 400, pivotWidth: 1, atrLen: 121, atrBandPct: 0.05, extendUnhit: 30, keepTouched: true, heatContrast: 0.3, minWeight: 0, longCol: '#01c4fe', shortCol: '#ffe400' },
  scenario: { primary: null, alternate: null, failure: null, updated: 0 },
  liqMetrics: {
    bnb: { count: 0, usd: 0, lastTs: 0, msgCount: 0 },
    byb: { count: 0, usd: 0, lastTs: 0, msgCount: 0, connected: false, connectedAt: 0, reconnects: 0 }
  },
}

// Chart series refs
export let mainChart: any, cSeries: any, ema50S: any, ema200S: any, wma20S: any, wma50S: any, stS: any, cvdChart: any, cvdS: any, volChart: any, volS: any
export let bbUpperS: any = null, bbMiddleS: any = null, bbLowerS: any = null
// [2026-06-16] batch-1 overlay series refs (window-global, lazy-init in indicators.ts)
export let smaS: any = null, hmaS: any = null, psarS: any = null, vwmaS: any = null
export let keraS: any = null, keraUpS: any = null, keraLowS: any = null // KERAUNOS overlay
export let aetMidS: any = null, aetUpS: any = null, aetLowS: any = null // AETHER overlay
export let msZigS: any = null // MOIRA market-structure zigzag overlay
export let nemS: any = null // NEMESIS exhaustion-marker carrier series
export let irisSeries: any[] = [] // IRIS rainbow EMA ribbon
export let pythiaMarkS: any = null, pythiaTpS: any = null, pythiaSlS: any = null // PYTHIA entries + target/stop
export let kcUpperS: any = null, kcMiddleS: any = null, kcLowerS: any = null
export let dcUpperS: any = null, dcMiddleS: any = null, dcLowerS: any = null
export let ichimokuSeries: any[] = []
export let fibSeries: any[] = []
export let pivotSeries: any[] = []
export let vpSeries: any[] = []
export let _rsiChart: any = null, _rsiSeries: any = null, _rsiInited = false
export let _stochChart: any = null, _stochKSeries: any = null, _stochDSeries: any = null, _stochInited = false
export let _atrChart: any = null, _atrSeries: any = null, _atrInited = false
export let _obvChart: any = null, _obvSeries: any = null, _obvInited = false
export let _mfiChart: any = null, _mfiSeries: any = null, _mfiInited = false
export let _cciChart: any = null, _cciSeries: any = null, _cciInited = false
// [2026-06-16] batch-2 oscillator panes
export let _adxChart: any = null, _adxSeries: any = null, _adxPlusSeries: any = null, _adxMinusSeries: any = null, _adxInited = false
export let _willrChart: any = null, _willrSeries: any = null, _willrInited = false
export let _rocChart: any = null, _rocSeries: any = null, _rocInited = false
export let _cmfChart: any = null, _cmfSeries: any = null, _cmfInited = false
export let _aoChart: any = null, _aoSeries: any = null, _aoInited = false
// [2026-06-16] batch-3 oscillator panes
export let _aroonChart: any = null, _aroonUpSeries: any = null, _aroonDnSeries: any = null, _aroonInited = false
export let _trixChart: any = null, _trixSeries: any = null, _trixInited = false
export let _uoChart: any = null, _uoSeries: any = null, _uoInited = false
export let _chopChart: any = null, _chopSeries: any = null, _chopInited = false
// [2026-06-16] PLUTUS markers (main-chart carrier) + HELIOS regime pane
export let plutusS: any = null
export let _heliosChart: any = null, _heliosSeries: any = null, _heliosMidS: any = null, _heliosInited = false
// [2026-06-16] HERMES fair-value-gap markers + magnet band (main-chart overlay)
export let hermesMarkS: any = null, hermesTopS: any = null, hermesBotS: any = null
// [2026-06-16] CHARON liquidity-pool price lines (carrier + line refs) + ATLAS accel pane
export let charonS: any = null, _charonLines: any[] = []
export let _atlasChart: any = null, _atlasSeries: any = null, _atlasInited = false
// [2026-06-16] EOS divergence markers + PANTHEON confluence pane + AEGIS entry markers
export let eosS: any = null
export let _pantheonChart: any = null, _pantheonSeries: any = null, _pantheonInited = false
export let aegisMarkS: any = null, aegisStopS: any = null
// [2026-06-16] SELENE dominant-cycle oscillator pane
export let _seleneChart: any = null, _seleneSeries: any = null, _seleneMidS: any = null, _seleneInited = false

// Indicator Settings
export const IND_SETTINGS: any = {
  ema: { p1: 50, p2: 200, p3: 20, p4: 100 },
  wma: { p1: 20, p2: 50 },
  st: { period: 10, mult: 3 },
  bb: { period: 20, stdDev: 2 },
  rsi14: { period: 14 },
  stoch: { kPeriod: 14, dPeriod: 3, smooth: 3 },
  macd: { fast: 12, slow: 26, signal: 9 },
  atr: { period: 14 },
  obv: { smoothing: 0 },
  mfi: { period: 14 },
  cci: { period: 20 },
  ichimoku: { tenkan: 9, kijun: 26, senkou: 52 },
  fib: { levels: [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] },
  pivot: { type: 'standard' },
  vwap: { stdDev: 1, stdDev2: 2 },
  vp: { rows: 70 },
  cvd: { smoothing: 0 },
  // [2026-06-16] batch-1 overlays
  sma: { period: 20 },
  hma: { period: 21 },
  psar: { step: 0.02, maxAf: 0.2 },
  kc: { period: 20, mult: 2 },
  dc: { period: 20 },
  // [2026-06-16] batch-2 oscillators
  adx: { period: 14 },
  willr: { period: 14 },
  roc: { period: 12 },
  cmf: { period: 20 },
  ao: { fast: 5, slow: 34 },
  // [2026-06-16] batch-3
  vwma: { period: 20 },
  aroon: { period: 14 },
  trix: { period: 15 },
  uo: { p1: 7, p2: 14, p3: 28 },
  chop: { period: 14 },
  // [2026-06-16] KERAUNOS — invented composite overlay
  kera: { er: 10, atrP: 14, mult: 1.6 },
  // [2026-06-16] AETHER — invented squeeze/breakout overlay
  aether: { period: 20, bbMult: 2, kcMult: 1.5 },
  // [2026-06-16] MOIRA — market-structure swing skeleton
  ms: { lookback: 5 },
  // [2026-06-16] NEMESIS — exhaustion / reversal signals
  nem: { setupLen: 9, climaxMult: 2 },
  // [2026-06-16] IRIS — rainbow EMA ribbon
  iris: { base: 8, step: 13 },
  // [2026-06-16] PYTHIA — backend-confirmed entries + ATR targets
  pythia: { fast: 21, slow: 50, atrLen: 14, tpMult: 2.5, slMult: 1.2 },
  // [2026-06-16] PLUTUS — smart-money footprint (Wyckoff effort vs result)
  plutus: { lookback: 20, volMult: 1.5 },
  // [2026-06-16] HELIOS — regime oracle (rolling Hurst exponent)
  helios: { period: 30 },
  // [2026-06-16] HERMES — fair-value-gap (imbalance) magnet zones
  hermes: { minPct: 0.05 },
  // [2026-06-16] CHARON — liquidity pools (stop-hunt levels)
  charon: { lookback: 5, tolPct: 0.15, minHits: 2 },
  // [2026-06-16] ATLAS — momentum acceleration oscillator
  atlas: { rocLen: 10, smooth: 5 },
  // [2026-06-16] EOS — price/RSI divergence detector
  eos: { lookback: 5, rsiPeriod: 14 },
  // [2026-06-16] PANTHEON — max-confluence meter (no tunable params)
  pantheon: {},
  // [2026-06-16] AEGIS — confluence-gated entry trigger
  aegis: { thr: 0.4, atrMult: 1.5 },
  // [2026-06-16] SELENE — dominant-cycle oscillator
  selene: { detrendLen: 20, minP: 8, maxP: 60 },
}
export let liqSeries: any[] = [], srSeries: any[] = []
export let zsSeries: any[] = []

// ── IND_SETTINGS persistence ──
export function _indSettingsSave() {
  try {
    const data = JSON.stringify(IND_SETTINGS)
    if (typeof _safeLocalStorageSet === 'function') _safeLocalStorageSet('zeus_ind_settings', data)
    else localStorage.setItem('zeus_ind_settings', data)
    if (typeof w._ucMarkDirty === 'function') w._ucMarkDirty('indSettings')
  } catch (_) { /* */ }
}
export function _indSettingsLoad() {
  try {
    const raw = localStorage.getItem('zeus_ind_settings')
    if (!raw) return
    const saved = JSON.parse(raw)
    if (!saved || typeof saved !== 'object') return
    for (const k in saved) {
      if (IND_SETTINGS[k] && typeof saved[k] === 'object') {
        for (const p in saved[k]) {
          if (IND_SETTINGS[k].hasOwnProperty(p)) IND_SETTINGS[k][p] = saved[k][p]
        }
      }
    }
  } catch (_) { /* */ }
}
_indSettingsLoad()
w._indSettingsSave = _indSettingsSave
w._indSettingsLoad = _indSettingsLoad

// Trading Positions state
// [Phase 12.A — Batch C] liveExchange defaults to null (no connected exchange yet).
// Server is the canonical source via useUiStore.activeExchange / TP writer in
// indicators.ts (set on verify-success). A hardcoded 'binance' was a lie on boot
// for Bybit users and after logout — null forces consumers to treat "no exchange"
// as a distinct state instead of silently defaulting to Binance.
export const TP: any = { demoOpen: false, liveOpen: false, demoSide: 'LONG', liveSide: 'LONG', demoBalance: 10000, demoPnL: 0, demoWins: 0, demoLosses: 0, demoPositions: [], livePositions: [], pendingOrders: [], manualLivePending: [], liveConnected: false, liveExchange: null, liveBalance: 0, liveAvailableBalance: 0, liveUnrealizedPnL: 0 }

// OI + Watchlist + Prices
export const oiHistory: any[] = []
export const WL_SYMS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'ZECUSDT']
export const wlPrices: any = {}
export const allPrices: any = {}
w.S = S; w.allPrices = allPrices; w.WL_SYMS = WL_SYMS; w.wlPrices = wlPrices

// Window exports for backward compat
w.BlockReason = BlockReason
w.buildExecSnapshot = buildExecSnapshot
w.ZState = ZState
w.TP = TP
w.oiHistory = oiHistory
w.wlPrices = wlPrices
w.IND_SETTINGS = IND_SETTINGS

// [Phase 3C] Engine mode single truth — useATStore.mode is canonical.
// Legacy AT.mode / AT._serverMode are read mirrors, kept in sync by this
// subscriber. Any code that continues to write AT.mode directly creates
// a transient divergence until the store writes back here; avoid that
// pattern for new code. Read render-critical code from the store.
try {
  useATStore.subscribe((s, prev) => {
    if (s.mode === prev.mode && s._serverMode === prev._serverMode) return
    const _AT = w.AT
    if (!_AT) return
    if (s.mode && _AT.mode !== s.mode) _AT.mode = s.mode
    const _nextServerMode = s._serverMode || s.mode || ''
    if (_AT._serverMode !== _nextServerMode) _AT._serverMode = _nextServerMode
  })
} catch (_) { /* defensive: subscribe never throws in zustand v4 but keep the net */ }
