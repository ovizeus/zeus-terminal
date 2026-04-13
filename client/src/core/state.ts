/**
 * Zeus Terminal — core/state.ts (ported from public/js/core/state.js)
 * Global state objects — ALL exported to window for compat
 * Phase 7E — HIGH RISK foundation file
 */

const w = window as any

w.__SYNC_VERSION__ = 'v12'
console.log('[ZEUS] state.js loaded — sync version:', w.__SYNC_VERSION__)

// ══════════════════════════════════════════════════════════════════
// [MULTI-USER] Per-user localStorage isolation
// ══════════════════════════════════════════════════════════════════
;(function _initUserScopedStorage() {
  let uid: any = null
  try {
    const m = document.cookie.match(/zeus_token=([^;]+)/)
    if (m) {
      const parts = m[1].split('.')
      if (parts.length >= 2) {
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
        uid = payload.id || null
      }
    }
  } catch (_e) { /* not logged in or malformed token */ }
  w._zeusUserId = uid

  const _USER_KEYS: any = {
    'zt_state_v1': 1, 'zt_journal': 1, 'zeus_user_settings': 1,
    'ARES_MISSION_STATE_V1': 1, 'ARES_MISSION_STATE_V1_vw2': 1,
    'ARES_POSITIONS_V1': 1, 'ARES_STATE_V1': 1, 'ares_init_v1': 1,
    'ARES_LAST_TRADE_TS': 1, 'ARES_JOURNAL_V1': 1,
    'zeus_postmortem_v1': 1, 'zeus_daily_pnl_v1': 1, 'zeus_adaptive_v1': 1,
    'zeus_signal_registry': 1, 'zeus_notifications': 1,
    'zeus_perf_v1': 1, 'zeus_ind_settings': 1,
    'zeus_tg_bot_token': 1, 'zeus_tg_chat_id': 1,
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
    'zeus_teacher_enabled': 1, 'zeus_teacher_mode': 1,
    'zeus_teacher_sessionState': 1, 'zeus_teacher_cumulative': 1,
    'zeus_teacher_checklistPrefs': 1, 'zeus_teacher_checklistState': 1,
    'zeus_teacher_dismissed': 1,
    'zeus_teacher_config': 1, 'zeus_teacher_sessions': 1,
    'zeus_teacher_lessons': 1, 'zeus_teacher_stats': 1,
    'zeus_teacher_memory': 1, 'zeus_teacher_v2state': 1,
    'zeus_teacher_panel_open': 1,
    'aria_v1': 1, 'nova_v1': 1,
    'zeus_dev_enabled': 1,
    'zeus_drawings_v1': 1,
    'zeus_ts_open': 1,
    'zeus_pin_hash': 1,
    'zt_api_key': 1, 'zt_api_secret': 1, 'zt_api_token': 1, 'zt_api_exchange': 1
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
w.TC = w.TC || {
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
  dslActivatePct: 40,
  dslTrailPct: 0.8,
  dslTrailSusPct: 1.0,
  dslExtendPct: 20,
}

export function syncDOMtoTC() {
  if (typeof document === 'undefined') return
  const _el = function (id: string) { return document.getElementById(id) }
  const _pi = function (id: string, def: any) { const v = parseInt((_el(id) as any)?.value); return Number.isFinite(v) ? v : def }
  const _pf = function (id: string, def: any) { const v = parseFloat((_el(id) as any)?.value); return Number.isFinite(v) ? v : def }
  const TC = w.TC
  TC.lev = Math.max(1, Math.min(125, _pi('atLev', TC.lev)))
  TC.size = Math.max(1, _pf('atSize', TC.size))
  TC.slPct = Math.max(0.1, Math.min(20, _pf('atSL', TC.slPct)))
  TC.rr = Math.max(0.1, Math.min(20, _pf('atRR', TC.rr)))
  TC.maxPos = Math.max(1, _pi('atMaxPos', TC.maxPos))
  TC.riskPct = Math.max(0.1, Math.min(5, _pf('atRiskPct', TC.riskPct)))
  TC.sigMin = Math.max(1, _pi('atSigMin', TC.sigMin))
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
  const DSL = w.DSL
  if (typeof TC === 'undefined') return
  const payload: any = {
    confMin: TC.confMin,
    sigMin: TC.sigMin,
    adxMin: TC.minADX,
    maxPos: TC.maxPos,
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
    const el_br = document.getElementById('zad-block-reason')
    if (el_br) {
      el_br.textContent = text
      el_br.className = 'znc-block-reason block'
      el_br.style.display = 'block'
    }
    const now = Date.now()
    const _logKey = String(code) + '|' + String(text || '')
    const sameKey = (_logKey === this._lastLogKey)
    const debounceElapsed = (now - this._lastLogTs) >= 60000
    if (!sameKey || debounceElapsed) {
      if (typeof w.atLog === 'function') w.atLog('warn', 'BLOCKED: ' + text)
      this._lastLogCode = code
      this._lastLogKey = _logKey
      this._lastLogTs = now
    }
    if (typeof w._updateWhyBlocked === 'function') w._updateWhyBlocked(code, text)
    if (typeof w.aubBBSnapshot === 'function' && (code === 'KILL' || code === 'PROTECT' || code === 'DATA_STALL')) w.aubBBSnapshot('BLOCK_' + code, { text })
    return br
  },
  clear() {
    this._current = null
    this._lastLogCode = null
    this._lastLogTs = 0
    this._lastLogKey = null
    const el_br = document.getElementById('zad-block-reason')
    if (el_br) { el_br.textContent = ''; el_br.style.display = 'none' }
    if (typeof w._updateWhyBlocked === 'function') w._updateWhyBlocked(null, null)
  },
  get() { return this._current },
  text() { return this._current?.text || '\u2014' },
}

// ── 1. ATOMIC SNAPSHOT BUILDER ───────────────────────────────────
export function buildExecSnapshot(side: any, cond: any) {
  const S = w.S
  const TC = w.TC
  const BM = w.BM
  const PROFILE_TF = w.PROFILE_TF
  const _tf = PROFILE_TF?.[S.profile || 'fast'] || { trigger: '5m', context: '15m' }

  const _levRaw = (typeof TC !== 'undefined' && Number.isFinite(TC.lev)) ? TC.lev : parseInt(document.getElementById('atLev')?.getAttribute('value') || '')
  const _sizeRaw = (typeof TC !== 'undefined' && Number.isFinite(TC.size)) ? TC.size : parseFloat(document.getElementById('atSize')?.getAttribute('value') || '')
  const _slRaw = (typeof TC !== 'undefined' && Number.isFinite(TC.slPct)) ? TC.slPct : parseFloat(document.getElementById('atSL')?.getAttribute('value') || '')
  const _rrRaw = (typeof TC !== 'undefined' && Number.isFinite(TC.rr)) ? TC.rr : parseFloat(document.getElementById('atRR')?.getAttribute('value') || '')

  const lev = (Number.isFinite(_levRaw) && _levRaw >= 1) ? Math.min(125, Math.max(1, _levRaw)) : 5
  const size = (Number.isFinite(_sizeRaw) && _sizeRaw > 0) ? Math.min(100000, _sizeRaw) : 200
  const slPct = (Number.isFinite(_slRaw) && _slRaw > 0) ? Math.min(20, Math.max(0.1, _slRaw)) : 1.5
  let rr = Number(_rrRaw); if (!Number.isFinite(rr) || rr <= 0) rr = 2; rr = Math.max(0.1, Math.min(20, rr))

  const pCore = (w.CORE_STATE && isFinite(w.CORE_STATE.price)) ? +w.CORE_STATE.price : NaN
  const pS = (S && isFinite(S.price)) ? +S.price : NaN
  const price = isFinite(pCore) ? pCore : (isFinite(pS) ? pS : NaN)

  if (!w.isValidMarketPrice(price)) {
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
    const DSL = w.DSL
    const AT = w.AT
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
          mode: p.mode || 'demo',
          controlMode: p.controlMode || null,
          sourceMode: p.sourceMode || null,
          brainModeAtOpen: p.brainModeAtOpen || null,
          dslParams: p.dslParams || null,
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
          if (p.autoTrade) return false
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
      if (typeof w._safeLocalStorageSet === 'function') w._safeLocalStorageSet(KEY, data)
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
      const AT = w.AT
      const DSL = w.DSL
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
              if (typeof w.loadJournalFromStorage === 'function') {
                try { w.loadJournalFromStorage() } catch (_) { /* */ }
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
            console.log('[ZState] Skip closed/journal pos:', p.id)
            return
          }
          if (!existing.has(String(p.id))) {
            const _restoredPos = { ...p, _restored: true }
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
            if (typeof w.onPositionOpened === 'function') w.onPositionOpened(_restoredPos, 'restore')
          }
        })
        if (typeof w.renderDemoPositions === 'function') setTimeout(w.renderDemoPositions, 500)
        if (typeof w.renderATPositions === 'function') setTimeout(w.renderATPositions, 500)
      }

      // [PHASE3B] Restore manual live/testnet positions
      if (Array.isArray(snap.liveManualPositions) && snap.liveManualPositions.length && typeof TP !== 'undefined') {
        TP.livePositions = TP.livePositions || []
        const _existLive = new Set(TP.livePositions.map(function (p: any) { return String(p.id) }))
        snap.liveManualPositions.forEach(function (p: any) {
          if (p.closed || _existLive.has(String(p.id))) return
          const _restoredLive = Object.assign({}, p, { _restored: true })
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
          if (typeof w.onPositionOpened === 'function') w.onPositionOpened(_restoredLive, 'restore')
        })
        if (typeof w.renderLivePositions === 'function') setTimeout(w.renderLivePositions, 500)
        console.log('[ZState] Restored', snap.liveManualPositions.length, 'live manual position(s)')
      }

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
      if (snap.blockReason) BlockReason._current = snap.blockReason

      console.log('[ZState] Restored:', snap.positions?.length || 0, 'positions, kill:', snap.at?.killTriggered)
      if (typeof w._dslTrimAll === 'function') w._dslTrimAll()
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
  function _connectWS() {
    if (typeof WebSocket === 'undefined') return
    if (_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) return
    try {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
      _ws = new WebSocket(proto + '//' + location.host + '/ws/sync')
      _ws.onopen = function () { _wsRetry = 0; console.log('[ws] sync connected') }
      _ws.onmessage = function (ev: any) {
        try {
          const msg = JSON.parse(ev.data)
          if (msg.type === 'sync') { console.log('[ws] sync signal — pulling'); pullAndMerge() }
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
  w._serverATEnabled = false
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
            existingPos = allClient[j]; break
          }
        }
      }
    }
    const srcMode = sp.mode === 'live' ? 'auto' : 'assist'
    return {
      id: (existingPos ? existingPos.id : null) || sp.seq || sp.id || Date.now(),
      side: sp.side,
      sym: sp.symbol || sp.sym,
      entry: sp.price || sp.entry,
      size: sp.size || 0,
      lev: sp.lev || 1,
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
      autoTrade: (sp.autoTrade !== undefined) ? !!sp.autoTrade : true,
      openTs: sp.ts || sp.openTs || Date.now(),
      label: ((sp.mode === 'live') ? (w._resolvedEnv === 'TESTNET' ? '\uD83D\uDFE1 TESTNET' : '\uD83D\uDD34 LIVE') : '\uD83C\uDFAE DEMO') + ' ' + (sp.side || ''),
      mode: sp.mode || 'demo',
      sourceMode: sp.sourceMode ? sp.sourceMode : (existingPos ? existingPos.sourceMode : srcMode),
      controlMode: sp.controlMode ? sp.controlMode : (existingPos ? existingPos.controlMode : srcMode),
      brainModeAtOpen: sp.brainModeAtOpen ? sp.brainModeAtOpen : (existingPos ? existingPos.brainModeAtOpen : srcMode),
      dslParams: (existingPos && existingPos.dslParams && (
        existingPos.controlMode === 'user' ||
        existingPos.controlMode === 'paper' ||
        !existingPos.autoTrade ||
        (existingPos._dslParamsPushedAt && (Date.now() - existingPos._dslParamsPushedAt) < 10000)
      )) ? existingPos.dslParams : (sp.dslParams || {}),
      dslAdaptiveState: (sp.dsl && sp.dsl.phase) ? sp.dsl.phase : 'calm',
      dslHistory: existingPos ? (existingPos.dslHistory || []) : [],
      closed: sp.status ? sp.status !== 'OPEN' : !!sp.closed,
      _serverSeq: sp.seq,
      _serverMode: sp.mode,
      _dsl: sp.dsl || null
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

  function _applyServerATState(state: any) {
    if (!state) return
    const TP = w.TP
    const AT = w.AT
    const Intervals = w.Intervals
    w._serverATEnabled = true
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
      return mapped.filter(function (p: any) { return !_rcSet.has(String(p.id)) && !_rcSet.has(String(p._serverSeq)) })
    }
    if (typeof TP !== 'undefined') {
      let serverATDemo: any[], serverATLive: any[]
      if (state.demoPositions && state.livePositions) {
        serverATDemo = _excludeRecentlyClosed(_filterOpen(state.demoPositions).map(_mapServerPos))
        serverATLive = _excludeRecentlyClosed(_filterOpen(state.livePositions).map(_mapServerPos))
        w._lastServerPositions = (state.livePositions || []).concat(state.demoPositions || [])
      } else {
        const serverPosns = _filterOpen(state.positions)
        const mapped = serverPosns.map(_mapServerPos)
        serverATDemo = _excludeRecentlyClosed(mapped.filter(function (p: any) { return p.mode !== 'live' }))
        serverATLive = _excludeRecentlyClosed(mapped.filter(function (p: any) { return p.mode === 'live' }))
        w._lastServerPositions = state.positions || []
      }
      const _serverDemoIds = new Set<string>()
      serverATDemo.forEach(function (p: any) { _serverDemoIds.add(String(p.id)); if (p._serverSeq) _serverDemoIds.add(String(p._serverSeq)) })
      const _serverLiveIds = new Set<string>()
      serverATLive.forEach(function (p: any) { _serverLiveIds.add(String(p.id)); if (p._serverSeq) _serverLiveIds.add(String(p._serverSeq)) })
      const clientOnlyDemo = (TP.demoPositions || []).filter(function (p: any) {
        if (p.closed) return false
        if (_rcSet.has(String(p.id))) return false
        if (!p.autoTrade && !p._serverSeq) return true
        if (p.autoTrade && !_serverDemoIds.has(String(p.id)) && !_serverDemoIds.has(String(p._serverSeq)) && p._localOnly) return true
        // Keep recently opened positions even if they have _serverSeq but server hasn't synced yet
        if (!p.autoTrade && p._serverSeq && !_serverDemoIds.has(String(p.id)) && !_serverDemoIds.has(String(p._serverSeq)) && p.openTs && (_now - p.openTs) < 30000) return true
        return false
      })
      const clientOnlyLive = (TP.livePositions || []).filter(function (p: any) {
        if (p.closed) return false
        if (_rcSet.has(String(p.id))) return false
        if (!p.autoTrade && !p._serverSeq) return true
        if (!p.autoTrade && p._serverSeq && !_serverLiveIds.has(String(p.id)) && !_serverLiveIds.has(String(p._serverSeq)) && p.openTs && (_now - p.openTs) < 30000) return true
        return false
      })
      TP.demoPositions = serverATDemo.concat(clientOnlyDemo)
      TP.livePositions = serverATLive.concat(clientOnlyLive)
      if (typeof w.renderLivePositions === 'function') w.renderLivePositions()
      if (state.demoBalance) {
        TP.demoBalance = state.demoBalance.balance || TP.demoBalance
        TP.demoPnL = state.demoBalance.pnl || 0
        TP._serverStartBalance = state.demoBalance.startBalance || 10000
      }
    }
    if (typeof AT !== 'undefined') {
      AT.killTriggered = !!state.killActive
      if (typeof state.killPct === 'number' && state.killPct > 0) {
        const _kpEl = document.getElementById('atKillPct') as any
        if (_kpEl) _kpEl.value = state.killPct
      }
      if (!AT._enabledPerMode) AT._enabledPerMode = {}
      const _prevMode = AT._serverMode || AT.mode || 'demo'
      if (state.mode && state.mode !== _prevMode) {
        AT._enabledPerMode[_prevMode] = !!AT.enabled
        if (AT.enabled) {
          AT.enabled = false
          if (typeof Intervals !== 'undefined') Intervals.clear('atCheck')
          clearInterval(AT.interval); AT.interval = null
          const _btn = document.getElementById('atMainBtn')
          const _dot = document.getElementById('atBtnDot')
          const _txt = document.getElementById('atBtnTxt')
          if (_btn) _btn.className = 'at-main-btn off'
          if (_dot) { (_dot as any).style.background = '#aa44ff'; (_dot as any).style.boxShadow = '0 0 6px #aa44ff' }
          if (_txt) _txt.textContent = 'AUTO TRADE OFF'
        }
        if (AT._enabledPerMode[state.mode]) {
          if (typeof w.atLog === 'function') w.atLog('info', '\u25B6 AT restoring — was ON in ' + state.mode.toUpperCase())
          setTimeout(function () {
            if (typeof w.toggleAutoTrade === 'function') w.toggleAutoTrade()
          }, 600)
        } else {
          const _st2 = document.getElementById('atStatus')
          if (_st2) _st2.textContent = '\u23F9 AT oprit — mod schimbat la ' + state.mode.toUpperCase()
          if (typeof w.atLog === 'function') w.atLog('warn', '\u23F9 AT paused — mode switched from ' + _prevMode + ' to ' + state.mode)
        }
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
        if (typeof w._applyATToggleUI === 'function') w._applyATToggleUI(state.atActive)
      }
    }
    w._apiConfigured = !!state.apiConfigured
    w._exchangeMode = state.exchangeMode || null
    if (state.resolvedEnv) {
      w._resolvedEnv = state.resolvedEnv
    } else if (state.mode === 'demo') {
      w._resolvedEnv = 'DEMO'
    } else if (state.exchangeMode === 'testnet') {
      w._resolvedEnv = 'TESTNET'
    } else {
      w._resolvedEnv = 'REAL'
    }
    w.executionReady = !!(state.apiConfigured && state.mode === 'live' && !state.killActive)
    if (state.mode && typeof w._applyGlobalModeUI === 'function') w._applyGlobalModeUI(state.mode)
    if (typeof w.updateATMode === 'function') w.updateATMode()
    if (typeof w.updateATStats === 'function') w.updateATStats()
    if (typeof w.renderATPositions === 'function') w.renderATPositions()
    if (typeof w.updateDemoBalance === 'function') w.updateDemoBalance()
    if (typeof w.atUpdateBanner === 'function') w.atUpdateBanner()
    if (typeof w.ptUpdateBanner === 'function') w.ptUpdateBanner()
    if (typeof w.dslUpdateBanner === 'function') w.dslUpdateBanner()
  }

  function _startATPolling() {
    if (_atPollTimer) return
    _atPollOnce()
    _atPollTimer = w.Intervals.set('atPoll', _atPollOnce, 10000)
  }

  function _atPollOnce() {
    fetch('/api/at/state', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (data: any) { if (data) _applyServerATState(data) })
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
    const existingSymSide = new Set(targetArray.filter(function (p: any) { return !p.closed }).map(function (p: any) { return (p.sym || p.symbol || '') + '_' + (p.side || '') }))
    let added = 0
    serverPositions.forEach(function (p: any) {
      if (p.closed || closedSet.has(String(p.id))) return
      if (existingIds.has(String(p.id))) return
      if (p.seq && existingSeqs.has(String(p.seq))) return
      var _symSide = (p.symbol || p.sym || '') + '_' + (p.side || '')
      if (existingSymSide.has(_symSide)) return
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
    return pullFromServer().then(function (serverSnap: any) {
      if (!serverSnap || !serverSnap.ts) return false
      const TP = w.TP
      const AT = w.AT
      const Intervals = w.Intervals
      const _ZI = w._ZI
      if (typeof TP === 'undefined') return false
      const localSnap = load()
      const localTs = (localSnap && localSnap.ts) ? localSnap.ts : 0
      let changed = false
      const _closedSet = _buildClosedSet(serverSnap.closedIds)

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
          const serverSeqs = new Set((serverSnap.positions || []).filter(function (p: any) { return p.seq }).map(function (p: any) { return String(p.seq) }))
          const serverSymSides = new Set((serverSnap.positions || []).filter(function (p: any) { return !p.closed }).map(function (p: any) { return (p.symbol || p.sym || '') + '_' + (p.side || '') }))
          const serverClosedIds2 = new Set(Array.isArray(serverSnap.closedIds) ? serverSnap.closedIds.map(String) : [])
          const now = Date.now()
          function _cleanArray(arr: any[]) {
            const toRemove: string[] = []
            ;(arr || []).forEach(function (p: any) {
              const pid = String(p.id)
              if (serverClosedIds2.has(pid) || _closedSet.has(pid)) {
                toRemove.push(pid)
              } else if (!p.closed && !serverIds.has(pid) && !(p._serverSeq && serverSeqs.has(String(p._serverSeq))) && !serverSymSides.has((p.sym || p.symbol || '') + '_' + (p.side || '')) && serverSnap.ts > (p.openTs || p.id) && (now - (p.openTs || p.id)) > 120000) {
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
              const btn = document.getElementById('atMainBtn')
              const dot = document.getElementById('atBtnDot')
              const txt = document.getElementById('atBtnTxt')
              if (btn && dot && txt) {
                if (AT.enabled) {
                  btn.className = 'at-main-btn on'
                  ;(dot as any).style.background = '#00ff88'; (dot as any).style.boxShadow = '0 0 10px #00ff88'
                  txt.textContent = 'AUTO TRADE ON'
                  const st = document.getElementById('atStatus'); if (st) st.innerHTML = _ZI.dGrn + ' Activ — scan la 30s'
                  if (!AT.interval && typeof w.runAutoTradeCheck === 'function') AT.interval = Intervals.set('atCheck', w.runAutoTradeCheck, 30000)
                } else {
                  btn.className = 'at-main-btn off'
                  ;(dot as any).style.background = '#aa44ff'; (dot as any).style.boxShadow = '0 0 6px #aa44ff'
                  txt.textContent = 'AUTO TRADE OFF'
                  const st = document.getElementById('atStatus'); if (st) st.textContent = 'Configureaza mai jos'
                  if (typeof Intervals !== 'undefined') Intervals.clear('atCheck')
                  clearInterval(AT.interval); AT.interval = null
                }
              }
            }, 50)
          }
          if (serverSnap.at.mode) AT.mode = serverSnap.at.mode
          if (typeof serverSnap.at.totalTrades === 'number') AT.totalTrades = serverSnap.at.totalTrades
          if (typeof serverSnap.at.wins === 'number') AT.wins = serverSnap.at.wins
          if (typeof serverSnap.at.losses === 'number') AT.losses = serverSnap.at.losses
          if (typeof serverSnap.at.totalPnL === 'number') AT.totalPnL = serverSnap.at.totalPnL
          if (typeof serverSnap.at.lastTradeTs === 'number') AT.lastTradeTs = serverSnap.at.lastTradeTs
        }
      }

      if (changed) {
        saveLocalOnly()
        setTimeout(function () {
          if (typeof w.updateDemoBalance === 'function') w.updateDemoBalance()
          if (typeof w.renderDemoPositions === 'function') w.renderDemoPositions()
          if (typeof w.renderATPositions === 'function') w.renderATPositions()
          if (typeof w.syncBrainFromState === 'function') w.syncBrainFromState()
        }, 100)
      }
      return changed
    }).catch(function (e: any) { console.warn('[sync] pullAndMerge failed:', e); return false })
      .finally(function () { _merging = false })
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
  overlays: { liq: false, zs: false, sr: false, llv: false, oflow: false },
  llvSettings: { bucketPct: 0.3, maxBarWidthPct: 30, opacity: 0.7, minUsd: 0, longCol: '#00d4aa', shortCol: '#ff4466', showLabels: true, labelMode: 'compact' },
  klines: [], liqMinUsd: 500, liqSym: 'BTC', wsK: null,
  symbol: 'BTCUSDT', tz: 'Europe/Bucharest',
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

// Indicator Settings
export const IND_SETTINGS: any = {
  ema: { p1: 50, p2: 200 },
  wma: { p1: 20, p2: 50 },
  st: { period: 10, mult: 3 },
  bb: { period: 20, stdDev: 2 },
  rsi14: { period: 14 },
  stoch: { kPeriod: 14, dPeriod: 3, smooth: 3 },
  macd: { fast: 12, slow: 26, signal: 9 },
  atr: { period: 14 },
  obv: {},
  mfi: { period: 14 },
  cci: { period: 20 },
  ichimoku: { tenkan: 9, kijun: 26, senkou: 52 },
  fib: { levels: [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] },
  pivot: { type: 'standard' },
  vwap: {},
  vp: { rows: 70 },
}
export let liqSeries: any[] = [], srSeries: any[] = []
export let zsSeries: any[] = []

// ── IND_SETTINGS persistence ──
export function _indSettingsSave() {
  try {
    const data = JSON.stringify(IND_SETTINGS)
    if (typeof w._safeLocalStorageSet === 'function') w._safeLocalStorageSet('zeus_ind_settings', data)
    else localStorage.setItem('zeus_ind_settings', data)
    if (typeof w._ucMarkDirty === 'function') w._ucMarkDirty('indSettings')
    if (typeof w._userCtxPush === 'function') w._userCtxPush()
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
export const TP: any = { demoOpen: false, liveOpen: false, demoSide: 'LONG', liveSide: 'LONG', demoBalance: 10000, demoPnL: 0, demoWins: 0, demoLosses: 0, demoPositions: [], livePositions: [], pendingOrders: [], manualLivePending: [], liveConnected: false, liveExchange: 'binance', liveBalance: 0, liveAvailableBalance: 0, liveUnrealizedPnL: 0 }

// OI + Watchlist + Prices
export const oiHistory: any[] = []
export const WL_SYMS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'ZECUSDT']
export const wlPrices: any = {}
export const allPrices: any = {}
w.S = S; w.allPrices = allPrices

// Window exports for backward compat
w.BlockReason = BlockReason
w.buildExecSnapshot = buildExecSnapshot
w.ZState = ZState
w.TP = TP
w.oiHistory = oiHistory
w.wlPrices = wlPrices
w.IND_SETTINGS = IND_SETTINGS
