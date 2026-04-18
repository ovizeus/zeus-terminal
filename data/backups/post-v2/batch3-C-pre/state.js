// Zeus v124 — core/state.js
// Global state objects — ALL exported to window for compat
'use strict';
window.__SYNC_VERSION__ = 'v12';  // bump this to verify phone has new JS
console.log('[ZEUS] state.js loaded — sync version:', window.__SYNC_VERSION__);

// ══════════════════════════════════════════════════════════════════
// [MULTI-USER] Per-user localStorage isolation
// Intercepts getItem/setItem/removeItem for user-scoped keys,
// auto-suffixing with :userId. Installed BEFORE any LS reads.
// ══════════════════════════════════════════════════════════════════
(function _initUserScopedStorage() {
  // Extract userId from JWT cookie synchronously (available before any async)
  var uid = null;
  try {
    var m = document.cookie.match(/zeus_token=([^;]+)/);
    if (m) {
      var parts = m[1].split('.');
      if (parts.length >= 2) {
        var payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        uid = payload.id || null;
      }
    }
  } catch (e) { /* not logged in or malformed token */ }
  window._zeusUserId = uid;

  // Keys that MUST be scoped per user (contain positions, balances, trading data, credentials)
  var _USER_KEYS = {
    // Core state & journal
    'zt_state_v1': 1, 'zt_journal': 1, 'zeus_user_settings': 1,
    // ARES simulation engine
    'ARES_MISSION_STATE_V1': 1, 'ARES_MISSION_STATE_V1_vw2': 1,
    'ARES_POSITIONS_V1': 1, 'ARES_STATE_V1': 1, 'ares_init_v1': 1,
    'ARES_LAST_TRADE_TS': 1, 'ARES_JOURNAL_V1': 1,
    // Analytics & performance
    'zeus_postmortem_v1': 1, 'zeus_daily_pnl_v1': 1, 'zeus_adaptive_v1': 1,
    'zeus_signal_registry': 1, 'zeus_notifications': 1,
    'zeus_perf_v1': 1, 'zeus_ind_settings': 1,
    // Telegram credentials
    'zeus_tg_bot_token': 1, 'zeus_tg_chat_id': 1,
    // Cloud sync
    'zeus_uc_beacon_pending': 1, 'zeus_uc_dirty_ts': 1,
    'zeus_groups': 1, 'zeus_ui_context': 1,
    'zt_cloud_last_hash': 1,
    // Strip/panel open states
    'zeus_dsl_strip_open': 1, 'zeus_at_strip_open': 1,
    'zeus_pt_strip_open': 1, 'zeus_mtf_open': 1,
    'zeus_dsl_mode': 1, 'zeus_adaptive_strip_open': 1,
    // Settings & UI
    'zeus_theme': 1, 'zeus_llv_settings': 1, 'zeus_ui_scale': 1,
    'zeus_mscan_syms': 1, 'zt_midstack_order': 1,
    // AUB (Alien Upgrade Bay)
    'aub_bb': 1, 'aub_macro': 1, 'aub_sim_last': 1, 'aub_expanded': 1,
    // Orderflow HUD
    'of_hud_v2': 1, 'of_hud_pos_v1': 1, 'of_hud_anchor_x_v1': 1,
    // Teacher module
    'zeus_teacher_enabled': 1, 'zeus_teacher_mode': 1,
    'zeus_teacher_sessionState': 1, 'zeus_teacher_cumulative': 1,
    'zeus_teacher_checklistPrefs': 1, 'zeus_teacher_checklistState': 1,
    'zeus_teacher_dismissed': 1,
    'zeus_teacher_config': 1, 'zeus_teacher_sessions': 1,
    'zeus_teacher_lessons': 1, 'zeus_teacher_stats': 1,
    'zeus_teacher_memory': 1, 'zeus_teacher_v2state': 1,
    'zeus_teacher_panel_open': 1,
    // ARIA & NOVA HUD
    'aria_v1': 1, 'nova_v1': 1,
    // Dev mode
    'zeus_dev_enabled': 1,
    // Drawings
    'zeus_drawings_v1': 1,
    // Time & Sales
    'zeus_ts_open': 1,
    // Legacy credential cleanup (removeItem only, but scope for safety)
    'zeus_pin_hash': 1,
    'zt_api_key': 1, 'zt_api_secret': 1, 'zt_api_token': 1, 'zt_api_exchange': 1
  };
  // Prefix-based user-scoped keys (e.g. zt_cloud_*)
  var _USER_PREFIXES = ['zt_cloud_'];

  function _isUserKey(key) {
    if (_USER_KEYS[key]) return true;
    for (var i = 0; i < _USER_PREFIXES.length; i++) {
      if (key.indexOf(_USER_PREFIXES[i]) === 0) return true;
    }
    return false;
  }

  function _scopedKey(key) {
    if (!window._zeusUserId || !_isUserKey(key)) return key;
    return key + ':' + window._zeusUserId;
  }

  // Save original methods (bound to localStorage context)
  var _origGet = localStorage.getItem.bind(localStorage);
  var _origSet = localStorage.setItem.bind(localStorage);
  var _origRemove = localStorage.removeItem.bind(localStorage);
  // Expose originals for migration/cleanup (bypasses proxy)
  window._lsOrigGet = _origGet;
  window._lsOrigSet = _origSet;
  window._lsOrigRemove = _origRemove;

  // Migration: move old un-scoped keys to user-scoped keys (runs once per user)
  if (uid) {
    var _migrated = 0;
    var keys = Object.keys(_USER_KEYS);
    for (var i = 0; i < keys.length; i++) {
      var baseKey = keys[i];
      var newKey = baseKey + ':' + uid;
      var oldVal = _origGet(baseKey);
      if (oldVal !== null) {
        if (_origGet(newKey) === null) {
          _origSet(newKey, oldVal);
          _migrated++;
        }
        _origRemove(baseKey);
      }
    }
    // Migrate prefix-based keys (zt_cloud_*)
    try {
      for (var j = 0; j < localStorage.length; j++) {
        var k = localStorage.key(j);
        if (!k) continue;
        for (var p = 0; p < _USER_PREFIXES.length; p++) {
          if (k.indexOf(_USER_PREFIXES[p]) === 0 && k.indexOf(':') === -1) {
            var nk = k + ':' + uid;
            if (_origGet(nk) === null) { _origSet(nk, _origGet(k)); _migrated++; }
            _origRemove(k);
            j--; // re-check same index after removal
            break;
          }
        }
      }
    } catch (_) { }
    if (_migrated > 0) console.log('[ZEUS] Migrated', _migrated, 'localStorage keys to user-scoped for uid=' + uid);
  }

  // Install proxy — all existing code automatically gets user-scoped keys
  localStorage.getItem = function (key) { return _origGet(_scopedKey(key)); };
  localStorage.setItem = function (key, val) { return _origSet(_scopedKey(key), val); };
  localStorage.removeItem = function (key) { return _origRemove(_scopedKey(key)); };

  // Logout cleanup — clear ALL user-scoped keys for the current user
  window._lsClearUser = function () {
    var id = window._zeusUserId;
    if (!id) return;
    var suffix = ':' + id;
    var toRemove = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.length > suffix.length && k.substring(k.length - suffix.length) === suffix) {
        toRemove.push(k);
      }
    }
    for (var r = 0; r < toRemove.length; r++) { _origRemove(toRemove[r]); }
    console.log('[ZEUS] Cleared', toRemove.length, 'user-scoped localStorage keys for uid=' + id);
    window._zeusUserId = null;
  };

  console.log('[ZEUS] User-scoped localStorage active — uid=' + (uid || 'none'));
})();

// ── P1: TRADING CONFIG — DOM-free parameter source ───────────────
// All trading parameters that were previously read from DOM inputs.
// Client syncs DOM→TC on input change. Server sets TC directly.
// Functions read from TC first, DOM fallback only if TC value missing.
window.TC = window.TC || {
  // AT execution params
  lev: 5,           // leverage (1-125)
  size: 200,        // position size ($) — margin cap for risk-based sizing
  slPct: 1.5,       // stop loss %
  rr: 2,            // risk:reward ratio
  riskPct: 1,       // risk % per trade (from atRiskPct)
  maxPos: 3,        // max simultaneous positions (source: atMaxPos)
  cooldownMs: 60000, // cooldown between trades (ms)
  minADX: 18,       // minimum ADX for entry
  hourStart: 0,     // trading hours start (UTC)
  hourEnd: 23,      // trading hours end (UTC)
  sigMin: 3,        // minimum signal count
  confMin: 65,      // minimum confluence score
  // DSL params (global defaults)
  dslActivatePct: 40,
  dslTrailPct: 0.8,
  dslTrailSusPct: 1.0,
  dslExtendPct: 20,
};

// Sync DOM → TC (called on input changes and at boot)
function syncDOMtoTC() {
  if (typeof document === 'undefined') return;
  var _el = function (id) { return document.getElementById(id); };
  var _pi = function (id, def) { var v = parseInt(_el(id)?.value); return Number.isFinite(v) ? v : def; };
  var _pf = function (id, def) { var v = parseFloat(_el(id)?.value); return Number.isFinite(v) ? v : def; };
  TC.lev = Math.max(1, Math.min(125, _pi('atLev', TC.lev)));
  TC.size = Math.max(1, _pf('atSize', TC.size));
  TC.slPct = Math.max(0.1, Math.min(20, _pf('atSL', TC.slPct)));
  TC.rr = Math.max(0.1, Math.min(20, _pf('atRR', TC.rr)));
  TC.maxPos = Math.max(1, _pi('atMaxPos', TC.maxPos));
  TC.riskPct = Math.max(0.1, Math.min(5, _pf('atRiskPct', TC.riskPct)));
  TC.sigMin = Math.max(1, _pi('atSigMin', TC.sigMin));
  TC.dslActivatePct = _pf('dslActivatePct', TC.dslActivatePct);
  TC.dslTrailPct = _pf('dslTrailPct', TC.dslTrailPct);
  TC.dslTrailSusPct = _pf('dslTrailSusPct', TC.dslTrailSusPct);
  TC.dslExtendPct = _pf('dslExtendPct', TC.dslExtendPct);
}
window.syncDOMtoTC = syncDOMtoTC;

// [P4] Push TC to server for brain config sync
// Maps client TC field names → server STC field names
var _tcPushTimer = null;
var _tcPushVersion = 0;
function pushTCtoServer() {
  if (typeof TC === 'undefined') return;
  var payload = {
    confMin: TC.confMin,
    sigMin: TC.sigMin,
    adxMin: TC.minADX,    // client=minADX, server=adxMin
    maxPos: TC.maxPos,
    cooldownMs: TC.cooldownMs,
    lev: TC.lev,
    size: TC.size,
    slPct: TC.slPct,
    rr: TC.rr,
    dslMode: (typeof DSL !== 'undefined' && DSL.mode) ? DSL.mode : undefined,
    symbols: window._atSelectedSymbols || null,
  };
  _tcPushVersion++;
  var ver = _tcPushVersion;
  fetch('/api/tc/sync', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(function (r) {
    if (!r.ok) console.warn('[TC] Server sync failed:', r.status);
  }).catch(function () {
    // silent — server may be down or feature disabled
  });
}
// Debounced version (500ms) — called on every input change
function _tcPushDebounced() {
  if (_tcPushTimer) clearTimeout(_tcPushTimer);
  _tcPushTimer = setTimeout(pushTCtoServer, 500);
}
window.pushTCtoServer = pushTCtoServer;
window._tcPushDebounced = _tcPushDebounced;

// CORE_STATE — active fields only (market/indicators/position were never populated — removed)
window.CORE_STATE = {
  score: 0,
  engineStatus: "idle",
  lastUpdate: 0
};

// BlockReason — unified block reason
const BlockReason = {
  _current: null,
  _lastLogCode: null,   // FIX2: debounce log by code
  _lastLogTs: 0,        // FIX2: timestamp of last log
  _lastLogKey: null,    // FIX3: initializat explicit (anterior lipsea)
  set(code, text, source) {
    const br = { code, text, source: source || 'engine', ts: Date.now() };
    this._current = br;
    // Update cockpit display
    const el_br = document.getElementById('zad-block-reason');
    if (el_br) {
      el_br.textContent = text;
      el_br.className = 'znc-block-reason block';
      el_br.style.display = 'block';
    }
    // FIX2: debounce AT log — only log if code+reason changed OR 60s elapsed
    // [patch] key = code|reason so different reasons under same code always log
    const now = Date.now();
    const _logKey = String(code) + '|' + String(text || '');  // FIX: 'reason' era undefined, parametrul corect e 'text'
    const sameKey = (_logKey === this._lastLogKey);
    const debounceElapsed = (now - this._lastLogTs) >= 60000;
    if (!sameKey || debounceElapsed) {
      if (typeof atLog === 'function') atLog('warn', 'BLOCKED: ' + text);
      this._lastLogCode = code;   // kept for backward compat
      this._lastLogKey = _logKey;
      this._lastLogTs = now;
    }
    // FIX3: update WHY BLOCKED pill
    if (typeof _updateWhyBlocked === 'function') _updateWhyBlocked(code, text);
    if (typeof aubBBSnapshot === 'function' && (code === 'KILL' || code === 'PROTECT' || code === 'DATA_STALL')) aubBBSnapshot('BLOCK_' + code, { text });
    return br;
  },
  clear() {
    this._current = null;
    this._lastLogCode = null;
    this._lastLogTs = 0;
    this._lastLogKey = null;  // FIX2: reset complet la clear()
    const el_br = document.getElementById('zad-block-reason');
    if (el_br) { el_br.textContent = ''; el_br.style.display = 'none'; }
    if (typeof _updateWhyBlocked === 'function') _updateWhyBlocked(null, null);
  },
  get() { return this._current; },
  text() { return this._current?.text || '—'; },
};

// ── 1. ATOMIC SNAPSHOT BUILDER ───────────────────────────────────
function buildExecSnapshot(side, cond) {
  const _tf = PROFILE_TF?.[S.profile || 'fast'] || { trigger: '5m', context: '15m' };


  // Atomic snapshot builder
  // [P1] Read from TC (server-safe), DOM fallback
  const _levRaw = (typeof TC !== 'undefined' && Number.isFinite(TC.lev)) ? TC.lev : parseInt(document.getElementById('atLev')?.value);
  const _sizeRaw = (typeof TC !== 'undefined' && Number.isFinite(TC.size)) ? TC.size : parseFloat(document.getElementById('atSize')?.value);
  const _slRaw = (typeof TC !== 'undefined' && Number.isFinite(TC.slPct)) ? TC.slPct : parseFloat(document.getElementById('atSL')?.value);
  const _rrRaw = (typeof TC !== 'undefined' && Number.isFinite(TC.rr)) ? TC.rr : parseFloat(document.getElementById('atRR')?.value);

  const lev = (Number.isFinite(_levRaw) && _levRaw >= 1) ? Math.min(125, Math.max(1, _levRaw)) : 5;
  const size = (Number.isFinite(_sizeRaw) && _sizeRaw > 0) ? Math.min(100000, _sizeRaw) : 200;
  const slPct = (Number.isFinite(_slRaw) && _slRaw > 0) ? Math.min(20, Math.max(0.1, _slRaw)) : 1.5;
  let rr = Number(_rrRaw); if (!Number.isFinite(rr) || rr <= 0) rr = 2; rr = Math.max(0.1, Math.min(20, rr)); // [v119-p6 FIX1A] always finite, clamped, snapshot-safe

  // [patch FIX B] prefer CORE_STATE.price (more authoritative), fallback S.price
  const pCore = (window.CORE_STATE && isFinite(window.CORE_STATE.price)) ? +window.CORE_STATE.price : NaN;
  const pS = (S && isFinite(S.price)) ? +S.price : NaN;
  const price = isFinite(pCore) ? pCore : (isFinite(pS) ? pS : NaN);

  // [PATCH1 B1] Reject execution if price is invalid — never build snapshot with price <= 0
  if (!isValidMarketPrice(price)) {
    console.error('[buildExecSnapshot] REJECTED — invalid price:', price, '| CORE:', window.CORE_STATE?.price, '| S:', S?.price);
    return null;
  }

  const slDist = price * slPct / 100;

  return Object.freeze({
    ts: Date.now(),
    symbol: S.symbol,
    side,
    price,                   // price at decision time — LOCKED
    regime: BM.regime || '—',
    score: cond?.score || BM?.entryScore || 0,
    mode: (S.mode || 'assist').toUpperCase(),
    profile: S.profile || 'fast',
    tf: _tf,
    lev,
    size,
    slPct,
    rr,       // [v105 FIX Bug4] rr inclus explicit in snapshot — anterior lipsea, _snap.rr era undefined
    riskPct: (typeof TC !== 'undefined' && Number.isFinite(TC.riskPct)) ? TC.riskPct : 1, // [RISK RAILS]
    sl: side === 'LONG' ? price - slDist : price + slDist,
    tp: side === 'LONG' ? price + (slDist * rr) : price - (slDist * rr),
    btcAnchor: S.symbol === 'BTCUSDT' ? price : (S.btcPrice || 0),
    reason: cond?.reason || 'AUTO',
    gates: cond?.gates || null,
  });
}

// [v105 FIX Bug6] escHtml — sanitizeaza campuri dinamice injectate in innerHTML

// State persistence (ZState)
const ZState = (() => {
  const KEY = 'zt_state_v1';
  let _saveTimer = null;
  // [S2B2-T1] Dirty flag + version counter + freshness tracking
  let _dirty = false;         // true when local state mutated since last confirmed push
  let _lastEditTs = 0;        // timestamp of last real local mutation
  let _stateVersion = 0;      // monotonic version — increments on actual data changes
  let _saving = false;        // true during save() — prevents pullAndMerge race
  function markDirty() { _dirty = true; _lastEditTs = Date.now(); _stateVersion++; }

  function _serialize() {
    return {
      ts: Date.now(),
      v: _stateVersion,           // [S2B2-T1] monotonic version for causality
      lastEditTs: _lastEditTs,   // [S2B2-T1] when user last mutated state
      // Demo balance & stats persistence
      demoBalance: (typeof TP !== 'undefined') ? TP.demoBalance : 10000,
      demoPnL: (typeof TP !== 'undefined') ? TP.demoPnL : 0,
      demoWins: (typeof TP !== 'undefined') ? TP.demoWins : 0,
      demoLosses: (typeof TP !== 'undefined') ? TP.demoLosses : 0,
      positions: (typeof TP !== 'undefined' ? TP.demoPositions || [] : [])
        .filter(function (p) {
          if (p.closed) return false;
          // [v3] When serverAT is active, don't sync AT positions via cross-device state
          // (serverAT is the single source of truth — prevents pullAndMerge resurrection loop)
          if (window._serverATEnabled && p.autoTrade) return false;
          return true;
        })
        .map(p => ({
          id: p.id, side: p.side, sym: p.sym, entry: p.entry,
          size: p.size, lev: p.lev, tp: p.tp, sl: p.sl,
          liqPrice: p.liqPrice, autoTrade: !!p.autoTrade,
          openTs: p.openTs || p.id, isLive: !!p.isLive,
          mode: p.mode || 'demo',
          // [PATCH1] Persist per-position control state
          controlMode: p.controlMode || null,
          sourceMode: p.sourceMode || null,
          brainModeAtOpen: p.brainModeAtOpen || null,
          dslParams: p.dslParams || null,
          dslAdaptiveState: p.dslAdaptiveState || null,
          dslHistory: Array.isArray(p.dslHistory) ? p.dslHistory.slice(-20) : [],
          // DSL state for this position — câmpuri reale (nu sl/activated care nu există)
          dsl: (typeof DSL !== 'undefined' && DSL.positions?.[String(p.id)])
            ? (function (d) {
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
              };
            })(DSL.positions[String(p.id)])
            : null
        })),
      // [PHASE3B] Live manual positions (non-AT, user-opened) — persist for refresh restore
      liveManualPositions: (typeof TP !== 'undefined' ? TP.livePositions || [] : [])
        .filter(function (p) {
          if (p.closed) return false;
          if (p.autoTrade) return false; // AT positions restored from server, not localStorage
          if (!p.isLive && !p.fromExchange) return false; // only real live positions
          return true;
        })
        .map(p => ({
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
            ? (function (d) {
              return {
                active: d.active ?? false, currentSL: d.currentSL ?? null,
                pivotLeft: d.pivotLeft ?? null, pivotRight: d.pivotRight ?? null,
                impulseVal: d.impulseVal ?? null, yellowLine: d.yellowLine ?? null,
                originalSL: d.originalSL ?? null, originalTP: d.originalTP ?? null,
                source: d.source ?? null, attachedTs: d.attachedTs ?? null,
                impulseTriggered: d.impulseTriggered ?? false,
                log: Array.isArray(d.log) ? d.log.slice(-20) : [],
              };
            })(DSL.positions[String(p.id)])
            : null
        })),
      // Pending orders (demo LIMIT waiting for fill)
      pendingOrders: (typeof TP !== 'undefined' ? TP.pendingOrders || [] : [])
        .filter(function (o) { return o && !o.cancelled && !o.filled; })
        .map(function (o) {
          return { id: o.id, side: o.side, sym: o.sym, limitPrice: o.limitPrice, size: o.size, lev: o.lev, tp: o.tp, sl: o.sl, mode: o.mode || 'demo', createdAt: o.createdAt };
        }),
      // Manual live pending LIMIT orders (metadata only — source of truth is Binance)
      manualLivePending: (typeof TP !== 'undefined' ? TP.manualLivePending || [] : [])
        .filter(function (o) { return o && !o.cancelled && !o.filled; })
        .map(function (o) {
          return { orderId: o.orderId, symbol: o.symbol, side: o.side, price: o.price, origQty: o.origQty, leverage: o.leverage, tp: o.tp, sl: o.sl, clientOrderId: o.clientOrderId, createdAt: o.createdAt };
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
      symbol: typeof S !== 'undefined' ? S.symbol : null,
      // [B10] runMode/assistArmed removed — dead fields, never read by server
      // Closed position IDs — prevents server zombie resurrection
      closedIds: (function () {
        var ids = [];
        if (typeof TP !== 'undefined' && Array.isArray(TP.journal)) {
          TP.journal.forEach(function (j) { if (j.id && j.journalEvent === 'CLOSE') ids.push(String(j.id)); });
        }
        if (Array.isArray(window._zeusRecentlyClosed)) {
          window._zeusRecentlyClosed.forEach(function (id) { ids.push(String(id)); });
        }
        // Deduplicate and keep last 1000
        return Array.from(new Set(ids)).slice(-1000);
      })(),
    };
  }

  function save() {
    // [v105 FIX Bug8] _safeLocalStorageSet (hoisted function declaration) — protejeaza la QuotaExceededError
    // Anterior: localStorage.setItem direct — putea arunca exceptie si corupe starea silentios
    _saving = true; // [S2B2-T1] gate against concurrent pullAndMerge
    try {
      var data = _serialize();
      console.log('[ZState] SAVE — pos:', (data.positions || []).length, 'bal:', data.demoBalance, 'ts:', data.ts, 'v:', data.v);
      _safeLocalStorageSet(KEY, data);
    }
    catch (e) { console.warn('[ZState] save failed:', e.message); }
    finally { _saving = false; }
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }

  function restore() {
    try {
      const snap = load();
      console.log('[ZState] RESTORE — snap:', snap ? ('pos:' + (snap.positions || []).length + ' bal:' + snap.demoBalance + ' ts:' + snap.ts) : 'NULL');
      if (!snap) return false;

      // Restore demo balance & stats — [B17b] skip when serverAT already applied (preboot)
      if (typeof TP !== 'undefined' && !window._serverATEnabled) {
        if (typeof snap.demoBalance === 'number' && isFinite(snap.demoBalance)) TP.demoBalance = snap.demoBalance;
        if (typeof snap.demoPnL === 'number' && isFinite(snap.demoPnL)) TP.demoPnL = snap.demoPnL;
        if (typeof snap.demoWins === 'number' && isFinite(snap.demoWins)) TP.demoWins = snap.demoWins;
        if (typeof snap.demoLosses === 'number' && isFinite(snap.demoLosses)) TP.demoLosses = snap.demoLosses;
      } else if (window._serverATEnabled) {
        console.log('[ZState] RESTORE — skipping demo financial fields (serverAT authoritative)');
      }

      // Restore AT state
      if (snap.at && typeof AT !== 'undefined') {
        const a = snap.at;
        AT.enabled = !!a.enabled;  // Restore saved enabled state (will be resumed after feed ready)
        AT.mode = a.mode || 'demo';
        AT._modeConfirmed = false; // [ZT-AUD-001] unconfirmed until server pushes state
        AT.cooldownMs = a.cooldownMs || 120000;
        AT.lastTradeTs = a.lastTradeTs || 0;
        AT.lastTradeSide = a.lastTradeSide || null;
        AT.totalTrades = a.totalTrades || 0;
        AT.wins = a.wins || 0;
        AT.losses = a.losses || 0;
        AT.totalPnL = a.totalPnL || 0;
        AT.dailyStart = a.dailyStart || new Date().toDateString();
        // dailyStart sanity guard — zi nouă = reset contoare zilnice + kill
        const _today = new Date().toDateString();
        if (a.dailyStart && a.dailyStart !== _today) {
          AT.killTriggered = false;
          AT.realizedDailyPnL = 0;
          AT.closedTradesToday = 0;
          AT.dailyPnL = 0;
          AT.dailyStart = _today;
          console.log('[ZState] Zi nouă detectată — reset daily counters + killTriggered');
        } else {
          AT.killTriggered = !!a.killTriggered;
          AT.realizedDailyPnL = a.realizedDailyPnL || 0;
          AT.closedTradesToday = a.closedTradesToday || 0;
          AT.dailyPnL = a.dailyPnL || 0;
        }
      }

      // Restore open positions (demo mode only — live uses exchange truth)
      if (snap.positions?.length && typeof TP !== 'undefined' && snap.at?.mode !== 'live') {
        const existing = new Set((TP.demoPositions || []).map(p => String(p.id)));
        // Build set of closed position IDs from journal
        let closedPosIds = new Set();
        try {
          // Try to get journal from memory first, then localStorage
          let jEntries = (Array.isArray(TP.journal) && TP.journal.length > 0) ? TP.journal : null;
          if (!jEntries) {
            const _jRaw = localStorage.getItem('zt_journal');
            if (_jRaw && _jRaw.length > 2) {
              try { jEntries = JSON.parse(_jRaw); } catch (_) {
                // [FIX C8] Corrupted journal in localStorage — clear it to prevent zombie resurrection
                console.warn('[ZState] Corrupted journal in localStorage — clearing');
                try { localStorage.removeItem('zt_journal'); } catch (_) { }
              }
              if (typeof loadJournalFromStorage === 'function') {
                try { loadJournalFromStorage(); } catch (_) { }
                if (Array.isArray(TP.journal) && TP.journal.length > 0) jEntries = TP.journal;
              }
            }
          }
          if (Array.isArray(jEntries)) {
            jEntries.forEach(j => { if (j && j.id && j.journalEvent === 'CLOSE') closedPosIds.add(String(j.id)); }); // [S9] only CLOSE events
          }
        } catch (_) { }

        console.log('[ZState] Restoring positions:', snap.positions.length, 'existing:', existing.size, 'closed:', closedPosIds.size);
        TP.demoPositions = TP.demoPositions || [];
        snap.positions.forEach(p => {
          if (p.closed || closedPosIds.has(String(p.id))) {
            console.log('[ZState] Skip closed/journal pos:', p.id);
            return;
          }
          if (!existing.has(String(p.id))) {
            const _restoredPos = { ...p, _restored: true };
            TP.demoPositions.push(_restoredPos);
            console.log('[ZState] Restored pos:', p.id, p.side, p.sym);
            // Restore DSL — merge fara overwrite
            if (p.dsl && typeof DSL !== 'undefined') {
              DSL.positions = DSL.positions || {};
              const _k = String(p.id);
              DSL.positions[_k] = DSL.positions[_k] || {};
              const _d = DSL.positions[_k];
              if (_d.active == null) _d.active = p.dsl.active ?? false;
              if (_d.currentSL == null) _d.currentSL = p.dsl.currentSL ?? null;
              if (_d.pivotLeft == null) _d.pivotLeft = p.dsl.pivotLeft ?? null;
              if (_d.pivotRight == null) _d.pivotRight = p.dsl.pivotRight ?? null;
              if (_d.impulseVal == null) _d.impulseVal = p.dsl.impulseVal ?? null;
              if (_d.yellowLine == null) _d.yellowLine = p.dsl.yellowLine ?? null;
              if (_d.originalSL == null) _d.originalSL = p.dsl.originalSL ?? null;
              if (_d.originalTP == null) _d.originalTP = p.dsl.originalTP ?? null;
              if (_d.source == null) _d.source = p.dsl.source ?? 'restore';
              if (_d.attachedTs == null) _d.attachedTs = p.dsl.attachedTs ?? Date.now();
              if (_d.impulseTriggered == null) _d.impulseTriggered = p.dsl.impulseTriggered ?? false;
              if (!Array.isArray(_d.log)) _d.log = Array.isArray(p.dsl.log) ? p.dsl.log : [];
            }
            if (typeof onPositionOpened === 'function') onPositionOpened(_restoredPos, 'restore');
          }
        });
        if (typeof renderDemoPositions === 'function') setTimeout(renderDemoPositions, 500);
        if (typeof renderATPositions === 'function') setTimeout(renderATPositions, 500);
      }

      // [PHASE3B] Restore manual live/testnet positions
      if (Array.isArray(snap.liveManualPositions) && snap.liveManualPositions.length && typeof TP !== 'undefined') {
        TP.livePositions = TP.livePositions || [];
        var _existLive = new Set(TP.livePositions.map(function (p) { return String(p.id); }));
        snap.liveManualPositions.forEach(function (p) {
          if (p.closed || _existLive.has(String(p.id))) return;
          var _restoredLive = Object.assign({}, p, { _restored: true });
          TP.livePositions.push(_restoredLive);
          // Restore DSL state
          if (p.dsl && typeof DSL !== 'undefined') {
            DSL.positions = DSL.positions || {};
            var _k = String(p.id);
            DSL.positions[_k] = DSL.positions[_k] || {};
            var _d = DSL.positions[_k];
            if (_d.active == null) _d.active = p.dsl.active ?? false;
            if (_d.currentSL == null) _d.currentSL = p.dsl.currentSL ?? null;
            if (_d.pivotLeft == null) _d.pivotLeft = p.dsl.pivotLeft ?? null;
            if (_d.pivotRight == null) _d.pivotRight = p.dsl.pivotRight ?? null;
            if (_d.impulseVal == null) _d.impulseVal = p.dsl.impulseVal ?? null;
            if (_d.originalSL == null) _d.originalSL = p.dsl.originalSL ?? null;
            if (_d.originalTP == null) _d.originalTP = p.dsl.originalTP ?? null;
            if (_d.source == null) _d.source = p.dsl.source ?? 'restore';
            if (_d.attachedTs == null) _d.attachedTs = p.dsl.attachedTs ?? Date.now();
          }
          if (typeof onPositionOpened === 'function') onPositionOpened(_restoredLive, 'restore');
        });
        if (typeof renderLivePositions === 'function') setTimeout(renderLivePositions, 500);
        console.log('[ZState] Restored', snap.liveManualPositions.length, 'live manual position(s)');
      }

      // Restore pending orders (demo LIMIT)
      if (Array.isArray(snap.pendingOrders) && snap.pendingOrders.length && typeof TP !== 'undefined') {
        TP.pendingOrders = TP.pendingOrders || [];
        var _existPending = new Set(TP.pendingOrders.map(function (o) { return String(o.id); }));
        snap.pendingOrders.forEach(function (o) {
          if (!_existPending.has(String(o.id))) {
            TP.pendingOrders.push(o);
          }
        });
        if (typeof renderPendingOrders === 'function') setTimeout(renderPendingOrders, 600);
      }

      // Restore manual live pending (metadata for LIMIT orders on Binance)
      if (Array.isArray(snap.manualLivePending) && snap.manualLivePending.length && typeof TP !== 'undefined') {
        TP.manualLivePending = TP.manualLivePending || [];
        var _existLivePending = new Set(TP.manualLivePending.map(function (o) { return String(o.orderId); }));
        snap.manualLivePending.forEach(function (o) {
          if (!_existLivePending.has(String(o.orderId))) {
            TP.manualLivePending.push(o);
          }
        });
      }

      // Restore block reason
      if (snap.blockReason) BlockReason._current = snap.blockReason;

      console.log('[ZState] Restored:', snap.positions?.length || 0, 'positions, kill:', snap.at?.killTriggered);
      // REQ 3: restore NEVER rebuilds DOM/layout — only updates values + renders position tables
      // initZeusGroups / initActBar / initAUB are NOT called here
      // P8: trim DSL logs immediately after restore to prevent memory spike
      if (typeof _dslTrimAll === 'function') _dslTrimAll();
      return true;
    } catch (e) {
      // [v106 FIX1] Restore state esuat — logat, aplicatia porneste cu stare goala
      console.warn('[ZState.restore] Failed:', e.message);
      if (typeof ZLOG !== 'undefined') ZLOG.push('ERROR', '[ZState.restore] ' + e.message);
      return false;
    }
  }

  function clear() {
    try { localStorage.removeItem(KEY); } catch (_) { }
  }

  // Debounced save — prevents thrashing (old local-only version, replaced by scheduleSaveAndSync)
  // kept as internal helper only

  // ── SERVER SYNC (PC <-> Phone) ──
  let _syncTimer = null;
  let _syncing = false;
  let _syncReady = false; // prevents push before initial pull completes
  let _syncQueued = false; // queue push when one is already in-flight
  let _merging = false; // [S2B1-T2] prevents push during pullAndMerge async gap

  var _syncHeaders = { 'Content-Type': 'application/json' };
  var _offlinePending = false;

  function _pushToServer() {
    if (_syncing || _merging) { _syncQueued = true; return; } // [S2B1-T2] also block during merge
    if (!_syncReady) { console.warn('[sync] push blocked — syncReady=false'); return; }
    _syncing = true;
    _syncQueued = false;
    const data = _serialize();
    var _pushDirtySnapshot = _dirty; // [S2B2-T1] snapshot dirty state before push
    console.log('[sync] PUSHING to server — pos:', (data.positions || []).length, 'bal:', data.demoBalance);
    fetch('/api/sync/state', {
      method: 'POST',
      headers: _syncHeaders,
      credentials: 'same-origin',
      body: JSON.stringify(data)
    }).then(function (r) { return r.json(); })
      .then(function (j) { if (j.ok) console.log('[sync] pushed OK ts=' + data.ts); else console.warn('[sync] push rejected:', j); })
      .catch(function (e) { console.warn('[sync] push failed:', e.message); if (typeof navigator !== 'undefined' && !navigator.onLine) _offlinePending = true; })
      .finally(function () {
        _syncing = false;
        // [S2B2-T1] Clear dirty only if no new mutations occurred during push
        if (_pushDirtySnapshot && _dirty && _lastEditTs <= data.lastEditTs) { _dirty = false; }
        if (_syncQueued) { _syncQueued = false; setTimeout(_pushToServer, 200); }
      });
    // Journal sync disabled — server reads from SQLite at_closed (single source of truth)
    // POST /api/sync/journal is no-op on server; no need to send data
  }

  function syncToServer() {
    if (_syncTimer) clearTimeout(_syncTimer);
    _syncTimer = setTimeout(_pushToServer, 1500);
  }

  // Immediate push (no debounce) — used on visibility hidden / tab close
  function syncNow() {
    if (_syncTimer) clearTimeout(_syncTimer);
    _pushToServer();
  }

  function markSyncReady() { _syncReady = true; console.log('[sync] markSyncReady — pushes now enabled'); _connectWS(); }

  // ── WebSocket real-time sync (instant cross-device push) ──
  var _ws = null;
  var _wsRetry = 0;
  var _wsVisListener = false;
  function _connectWS() {
    if (typeof WebSocket === 'undefined') return;
    if (_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) return;
    try {
      var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      _ws = new WebSocket(proto + '//' + location.host + '/ws/sync');
      _ws.onopen = function () { _wsRetry = 0; console.log('[ws] sync connected'); };
      _ws.onmessage = function (ev) {
        try {
          var msg = JSON.parse(ev.data);
          if (msg.type === 'sync') { console.log('[ws] sync signal — pulling'); pullAndMerge(); }
          if (msg.type === 'at_update' && msg.data) { _applyServerATState(msg.data); }
        } catch (_) { }
      };
      _ws.onclose = function () {
        _ws = null;
        var delay = Math.min(30000, 1000 * Math.pow(2, _wsRetry++));
        setTimeout(_connectWS, delay);
      };
      // Reconnect WS when tab comes back to foreground
      if (!_wsVisListener) {
        _wsVisListener = true;
        document.addEventListener('visibilitychange', function () {
          if (!document.hidden) { _wsRetry = 0; _connectWS(); }
        });
      }
      _ws.onerror = function () { };
    } catch (e) { console.warn('[ws] connect failed:', e.message); }
  }

  // ── Server AT state consumer (single source of truth) ──
  window._serverATEnabled = false;
  var _atPollTimer = null;

  function _mapServerPos(sp) {
    // Preserve existing client-side controlMode if position already synced
    var existingPos = null;
    if (typeof TP !== 'undefined' && sp.seq) {
      var allClient = [].concat(TP.demoPositions || [], TP.livePositions || []);
      for (var i = 0; i < allClient.length; i++) {
        if (allClient[i]._serverSeq === sp.seq || allClient[i].id === sp.seq) { existingPos = allClient[i]; break; }
      }
      // Fallback: match by sym+side for manual positions restored from ZState (no _serverSeq yet)
      if (!existingPos) {
        var _spSym = sp.symbol || sp.sym;
        for (var j = 0; j < allClient.length; j++) {
          if (allClient[j].sym === _spSym && allClient[j].side === sp.side && !allClient[j].closed && !allClient[j]._serverSeq) {
            existingPos = allClient[j]; break;
          }
        }
      }
    }
    var srcMode = sp.mode === 'live' ? 'auto' : 'assist';
    return {
      id: sp.seq || sp.id || Date.now(),
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
      // [Batch B] Addon fields from server
      addOnCount: sp.addOnCount || 0,
      originalEntry: sp.originalEntry || sp.price || sp.entry || 0,
      originalSize: sp.originalSize || sp.size || 0,
      originalQty: sp.originalQty || '',
      addOnHistory: sp.addOnHistory || [],
      slPct: sp.slPct || 0,
      rr: sp.rr || 0,
      autoTrade: (sp.autoTrade !== undefined) ? !!sp.autoTrade : true,
      openTs: sp.ts || sp.openTs || Date.now(),
      label: ((sp.mode === 'live') ? (window._resolvedEnv === 'TESTNET' ? '\uD83D\uDFE1 TESTNET' : '\uD83D\uDD34 LIVE') : '\uD83C\uDFAE DEMO') + ' ' + (sp.side || ''),
      mode: sp.mode || 'demo',
      // [AT-PANEL] Server explicit values take priority over stale existingPos values
      sourceMode: sp.sourceMode ? sp.sourceMode : (existingPos ? existingPos.sourceMode : srcMode),
      controlMode: sp.controlMode ? sp.controlMode : (existingPos ? existingPos.controlMode : srcMode),
      brainModeAtOpen: sp.brainModeAtOpen ? sp.brainModeAtOpen : (existingPos ? existingPos.brainModeAtOpen : srcMode),
      // Preserve client-side dslParams for manual/paper positions + Take Control + race window
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
    };
  }

  // [BUG1 FIX] Track positions pending server close — prevent resurrection
  var _pendingServerCloses = {};  // { seq: timestamp }
  // Also track by client-side id (for _zeusRecentlyClosed cross-reference)
  var _pendingCloseIds = {};      // { id: timestamp }
  window._zeusRequestServerClose = function (seq, id) {
    _pendingServerCloses[seq] = Date.now();
    if (id) _pendingCloseIds[id] = Date.now();
  };
  window._zeusConfirmServerClose = function (seq) {
    delete _pendingServerCloses[seq];
  };

  function _applyServerATState(state) {
    if (!state) return;
    window._serverATEnabled = true;
    // Expire stale pending closes (>120s)
    var _now = Date.now();
    Object.keys(_pendingServerCloses).forEach(function (k) {
      if (_now - _pendingServerCloses[k] > 120000) delete _pendingServerCloses[k];
    });
    Object.keys(_pendingCloseIds).forEach(function (k) {
      if (_now - _pendingCloseIds[k] > 120000) delete _pendingCloseIds[k];
    });
    // Build recently-closed exclusion set
    var _rcSet = new Set();
    if (Array.isArray(window._zeusRecentlyClosed)) {
      window._zeusRecentlyClosed.forEach(function (id) { _rcSet.add(String(id)); });
    }
    Object.keys(_pendingCloseIds).forEach(function (k) { _rcSet.add(String(k)); });
    // Filter open positions and exclude pending closes
    function _filterOpen(arr) {
      return (arr || []).filter(function (p) {
        if (p.status && p.status !== 'OPEN') return false;
        if (p.closed) return false;
        if (_pendingServerCloses[p.seq]) return false;
        return true;
      });
    }
    function _excludeRecentlyClosed(mapped) {
      if (_rcSet.size === 0) return mapped;
      return mapped.filter(function (p) { return !_rcSet.has(String(p.id)) && !_rcSet.has(String(p._serverSeq)); });
    }
    // [v4] MERGE server AT positions with client-only manual positions
    // Server AT only knows about positions IT opened. Manual demo/live positions
    // are client-only and must be PRESERVED — not wiped on every poll.
    if (typeof TP !== 'undefined') {
      // Get server AT positions (mapped to client format)
      var serverATDemo, serverATLive;
      if (state.demoPositions && state.livePositions) {
        serverATDemo = _excludeRecentlyClosed(_filterOpen(state.demoPositions).map(_mapServerPos));
        serverATLive = _excludeRecentlyClosed(_filterOpen(state.livePositions).map(_mapServerPos));
        // [AT-MANUAL-SEP] Cache raw server positions for liveApiSyncState AT detection
        window._lastServerPositions = (state.livePositions || []).concat(state.demoPositions || []);
      } else {
        var serverPosns = _filterOpen(state.positions);
        var mapped = serverPosns.map(_mapServerPos);
        serverATDemo = _excludeRecentlyClosed(mapped.filter(function (p) { return p.mode !== 'live'; }));
        serverATLive = _excludeRecentlyClosed(mapped.filter(function (p) { return p.mode === 'live'; }));
        window._lastServerPositions = state.positions || [];
      }
      // Build set of server AT position IDs (by seq) for fast lookup
      var _serverDemoIds = new Set();
      serverATDemo.forEach(function (p) { _serverDemoIds.add(String(p.id)); if (p._serverSeq) _serverDemoIds.add(String(p._serverSeq)); });
      var _serverLiveIds = new Set();
      serverATLive.forEach(function (p) { _serverLiveIds.add(String(p.id)); if (p._serverSeq) _serverLiveIds.add(String(p._serverSeq)); });
      // Preserve client-only manual positions (non-autoTrade, not closed, not in recently-closed)
      var clientOnlyDemo = (TP.demoPositions || []).filter(function (p) {
        if (p.closed) return false;
        if (_rcSet.has(String(p.id))) return false;
        // Keep if NOT an AT position (manual/paper) AND not a server-synced position
        if (!p.autoTrade && !p._serverSeq) return true;
        // Also keep AT positions that were opened client-side and not yet on server
        // (race window: position just opened, server hasn't picked it up yet)
        if (p.autoTrade && !_serverDemoIds.has(String(p.id)) && !_serverDemoIds.has(String(p._serverSeq)) && p._localOnly) return true;
        return false;
      });
      var clientOnlyLive = (TP.livePositions || []).filter(function (p) {
        if (p.closed) return false;
        if (_rcSet.has(String(p.id))) return false;
        if (!p.autoTrade && !p._serverSeq) return true;
        return false;
      });
      // MERGE: server AT positions + preserved client-only manual positions
      TP.demoPositions = serverATDemo.concat(clientOnlyDemo);
      TP.livePositions = serverATLive.concat(clientOnlyLive);
      // [PTVIS-FIX] Re-render live positions after merge (preserves PT/manual visibility)
      if (typeof renderLivePositions === 'function') renderLivePositions();
      // Update demo balance from server (always — it's the demo balance source of truth)
      if (state.demoBalance) {
        TP.demoBalance = state.demoBalance.balance || TP.demoBalance;
        TP.demoPnL = state.demoBalance.pnl || 0;
        TP._serverStartBalance = state.demoBalance.startBalance || 10000;
      }
    }
    // Update AT state
    if (typeof AT !== 'undefined') {
      AT.killTriggered = !!state.killActive;
      // [KILL FIX] Sync killPct from server to DOM — server is source of truth
      if (typeof state.killPct === 'number' && state.killPct > 0) {
        var _kpEl = document.getElementById('atKillPct');
        if (_kpEl) _kpEl.value = state.killPct;
      }
      // Detect mode change — save/restore per-mode AT state
      if (!AT._enabledPerMode) AT._enabledPerMode = {};
      var _prevMode = AT._serverMode || AT.mode || 'demo';
      if (state.mode && state.mode !== _prevMode) {
        // [C2-fix] Save AT.enabled for the mode we are LEAVING
        AT._enabledPerMode[_prevMode] = !!AT.enabled;
        // Pause AT during transition (stop interval, update UI)
        if (AT.enabled) {
          AT.enabled = false;
          if (typeof Intervals !== 'undefined') Intervals.clear('atCheck');
          clearInterval(AT.interval); AT.interval = null;
          var _btn = document.getElementById('atMainBtn');
          var _dot = document.getElementById('atBtnDot');
          var _txt = document.getElementById('atBtnTxt');
          if (_btn) _btn.className = 'at-main-btn off';
          if (_dot) { _dot.style.background = '#aa44ff'; _dot.style.boxShadow = '0 0 6px #aa44ff'; }
          if (_txt) _txt.textContent = 'AUTO TRADE OFF';
        }
        // [C2-fix] Restore AT if it was previously enabled in the TARGET mode
        if (AT._enabledPerMode[state.mode]) {
          if (typeof atLog === 'function') atLog('info', '\u25B6 AT restoring — was ON in ' + state.mode.toUpperCase());
          setTimeout(function () {
            if (typeof toggleAutoTrade === 'function') toggleAutoTrade();
          }, 600);
        } else {
          var _st2 = document.getElementById('atStatus');
          if (_st2) _st2.textContent = '\u23F9 AT oprit — mod schimbat la ' + state.mode.toUpperCase();
          if (typeof atLog === 'function') atLog('warn', '\u23F9 AT paused — mode switched from ' + _prevMode + ' to ' + state.mode);
        }
      }
      // [C1] Server is authoritative for mode — set AT.mode directly (single source of truth)
      if (state.mode) { AT.mode = state.mode; AT._serverMode = state.mode; AT._modeConfirmed = true; }
      // [v3] Store per-mode stats separately — no more mixing
      AT._serverStats = state.stats || null;
      AT._serverDemoStats = state.demoStats || null;
      AT._serverLiveStats = state.liveStats || null;
      // Update TP demo stats from demo-specific stats (not global)
      var _ds = state.demoStats || state.stats;
      if (_ds) {
        TP.demoWins = _ds.wins || 0;
        TP.demoLosses = _ds.losses || 0;
      }
    }
    // [AT-TOGGLE-FIX] Sync AT enabled state from server (authoritative)
    if (typeof state.atActive === 'boolean' && typeof AT !== 'undefined') {
      if (AT.enabled !== state.atActive) {
        AT.enabled = state.atActive;
        if (typeof _applyATToggleUI === 'function') _applyATToggleUI(state.atActive);
      }
    }
    // Track API configuration status for execution readiness
    window._apiConfigured = !!state.apiConfigured;
    // [MODE-P2] Exchange environment truth — separate from readiness
    // exchangeMode: 'testnet' | 'live' | null (null = no creds configured)
    // resolvedEnv: 'DEMO' | 'TESTNET' | 'REAL' (derived from engineMode + exchangeMode)
    window._exchangeMode = state.exchangeMode || null;
    // [LIVE-PARITY] Fallback checks exchangeMode to avoid showing REAL when actually TESTNET
    if (state.resolvedEnv) {
        window._resolvedEnv = state.resolvedEnv;
    } else if (state.mode === 'demo') {
        window._resolvedEnv = 'DEMO';
    } else if (state.exchangeMode === 'testnet') {
        window._resolvedEnv = 'TESTNET';
    } else {
        window._resolvedEnv = 'REAL';
    }
    // [HARDENING] Unified execution readiness flag — separate from environment
    // executionReady = has creds + live mode + kill switch off (does NOT mean REAL — could be TESTNET)
    window.executionReady = !!(state.apiConfigured && state.mode === 'live' && !state.killActive);
    // Sync global mode UI with server state
    if (state.mode && typeof _applyGlobalModeUI === 'function') _applyGlobalModeUI(state.mode);
    if (typeof updateATMode === 'function') updateATMode();
    if (typeof updateATStats === 'function') updateATStats();
    if (typeof renderATPositions === 'function') renderATPositions();
    if (typeof updateDemoBalance === 'function') updateDemoBalance();
    // Refresh banners
    if (typeof atUpdateBanner === 'function') atUpdateBanner();
    if (typeof ptUpdateBanner === 'function') ptUpdateBanner();
    if (typeof dslUpdateBanner === 'function') dslUpdateBanner();
  }

  function _startATPolling() {
    if (_atPollTimer) return;
    // Initial fetch
    _atPollOnce();
    // Poll every 10s as fallback (WS push is primary)
    _atPollTimer = Intervals.set('atPoll', _atPollOnce, 10000); // [S14] use Intervals registry
  }

  function _atPollOnce() {
    fetch('/api/at/state', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) { if (data) _applyServerATState(data); })
      .catch(function () { });
  }

  // ── Offline queue: re-push when back online ──
  if (typeof window !== 'undefined') {
    window.addEventListener('online', function () {
      if (_offlinePending) {
        _offlinePending = false;
        console.log('[sync] back online — pushing pending state');
        setTimeout(_pushToServer, 1500);
      }
      // Reconnect WebSocket if dropped
      _connectWS();
    });
  }

  function pullFromServer() {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 10000) : null;
    var opts = { credentials: 'same-origin' };
    if (ctrl) opts.signal = ctrl.signal;
    return fetch('/api/sync/state', opts).then(function (r) {
      if (timer) clearTimeout(timer);
      if (!r.ok) { console.warn('[sync] pull HTTP', r.status); return null; }
      return r.json();
    })
      .then(function (j) {
        if (!j) return null;
        if (!j.ok || !j.data) { console.warn('[sync] pull state \u2014 server returned:', j); return null; }
        return j.data;
      }).catch(function (e) { if (timer) clearTimeout(timer); console.warn('[sync] pull state FAILED:', e.message || e); return null; });
  }

  function pullJournalFromServer() {
    return fetch('/api/sync/journal', { credentials: 'same-origin' }).then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok || !j.data) return null;
        return j.data;
      }).catch(function (e) { console.warn('[sync] pull journal FAILED:', e.message || e); return null; });
  }

  // Enhanced save — local + server
  var _origSave = save;
  function saveAndSync() {
    _origSave();
    syncToServer();
  }
  // Local-only save (for periodic 30s interval — never pushes to server)
  function saveLocalOnly() {
    _origSave();
  }

  // Debounced save — also syncs to server
  // [S2B2-T1] scheduleSaveAndSync marks dirty — it's called after real user mutations
  function scheduleSaveAndSync() {
    markDirty();
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(saveAndSync, 800);
  }

  // ── [B16] Shared merge helpers — single source of truth for position merge logic ──
  // Used by: boot merge (bootstrap.js), visibility resume (bootstrap.js), pullAndMerge (below)
  function _buildClosedSet(serverClosedIds) {
    var s = new Set();
    if (Array.isArray(TP.journal)) TP.journal.forEach(function (j) { if (j.id) s.add(String(j.id)); });
    if (Array.isArray(window._zeusRecentlyClosed)) window._zeusRecentlyClosed.forEach(function (id) { s.add(String(id)); });
    if (Array.isArray(serverClosedIds)) serverClosedIds.forEach(function (id) { s.add(String(id)); });
    return s;
  }

  function _mergePositionsInto(targetArray, serverPositions, closedSet, label) {
    if (!Array.isArray(targetArray) || !Array.isArray(serverPositions)) return 0;
    var existingIds = new Set(targetArray.map(function (p) { return String(p.id); }));
    var added = 0;
    serverPositions.forEach(function (p) {
      if (p.closed || closedSet.has(String(p.id)) || existingIds.has(String(p.id))) return;
      targetArray.push(Object.assign({}, p, { _restored: true }));
      added++;
    });
    if (added > 0) console.log('[sync] ' + label + ' — merged ' + added + ' position(s)');
    return added;
  }

  // Expose for bootstrap.js (classic script tags, no ES modules)
  window._zeusMerge = { buildClosedSet: _buildClosedSet, mergePositionsInto: _mergePositionsInto };

  // ── Pull from server and merge into local state (used by periodic sync + boot) ──
  function pullAndMerge() {
    // [S2B2-T1] Skip if save is in progress — prevents timestamp mismatch race
    if (_saving) { console.log('[sync] pullAndMerge deferred — save in progress'); return Promise.resolve(false); }
    _merging = true; // [S2B1-T2] block pushes during async merge
    return pullFromServer().then(function (serverSnap) {
      if (!serverSnap || !serverSnap.ts) return false;
      if (typeof TP === 'undefined') return false;
      var localSnap = load();
      var localTs = (localSnap && localSnap.ts) ? localSnap.ts : 0;
      var changed = false;
      // [B16] Use shared helpers for closedIds + merge
      var _closedSet = _buildClosedSet(serverSnap.closedIds);

      if (window._serverATEnabled) {
        // Skip position merge entirely — _applyServerATState handles positions
      } else {
        // Merge positions by mode — split demo vs live, using shared helper
        if (serverSnap.positions && serverSnap.positions.length) {
          TP.demoPositions = TP.demoPositions || [];
          TP.livePositions = TP.livePositions || [];
          var demoOnly = serverSnap.positions.filter(function (p) { return (p.mode || 'demo') !== 'live'; });
          var liveOnly = serverSnap.positions.filter(function (p) { return (p.mode || 'demo') === 'live'; });
          if (_mergePositionsInto(TP.demoPositions, demoOnly, _closedSet, 'pullMerge-demo') > 0) changed = true;
          if (_mergePositionsInto(TP.livePositions, liveOnly, _closedSet, 'pullMerge-live') > 0) changed = true;
        }
        // Remove positions closed on other device
        {
          var serverIds = new Set((serverSnap.positions || []).map(function (p) { return String(p.id); }));
          var serverClosedIds = new Set(Array.isArray(serverSnap.closedIds) ? serverSnap.closedIds.map(String) : []);
          var now = Date.now();
          function _cleanArray(arr) {
            var toRemove = [];
            (arr || []).forEach(function (p) {
              var pid = String(p.id);
              if (serverClosedIds.has(pid) || _closedSet.has(pid)) {
                toRemove.push(pid);
              } else if (!p.closed && !serverIds.has(pid) && serverSnap.ts > (p.openTs || p.id) && (now - (p.openTs || p.id)) > 30000) {
                toRemove.push(pid);
              }
            });
            if (toRemove.length > 0) { changed = true; return (arr || []).filter(function (p) { return toRemove.indexOf(String(p.id)) === -1; }); }
            return arr;
          }
          TP.demoPositions = _cleanArray(TP.demoPositions);
          TP.livePositions = _cleanArray(TP.livePositions);
        }
      }

      // Merge balance if server is newer — [B17] skip when serverAT is active (balance from _applyServerATState only)
      var _serverEditTs = serverSnap.lastEditTs || serverSnap.ts || 0;
      if (!window._serverATEnabled && serverSnap.ts > localTs && !(_dirty && _lastEditTs > _serverEditTs)) {
        var _lActive = (TP.demoPositions || []).filter(function (p) { return !p.closed; }).length;
        var _sPos = (serverSnap.positions || []).length;
        if (!(_lActive > 0 && _sPos === 0) && !(Math.abs(_lActive - _sPos) > 2 && _lActive > 0)) {
          if (typeof serverSnap.demoBalance === 'number' && isFinite(serverSnap.demoBalance)) { TP.demoBalance = serverSnap.demoBalance; changed = true; }
          if (typeof serverSnap.demoPnL === 'number') TP.demoPnL = serverSnap.demoPnL;
          if (typeof serverSnap.demoWins === 'number') TP.demoWins = serverSnap.demoWins;
          if (typeof serverSnap.demoLosses === 'number') TP.demoLosses = serverSnap.demoLosses;
        }
        // AT state — full cross-device sync
        if (serverSnap.at && typeof AT !== 'undefined') {
          if (typeof serverSnap.at.killTriggered === 'boolean') AT.killTriggered = serverSnap.at.killTriggered;
          if (typeof serverSnap.at.realizedDailyPnL === 'number') AT.realizedDailyPnL = serverSnap.at.realizedDailyPnL;
          if (typeof serverSnap.at.closedTradesToday === 'number') AT.closedTradesToday = serverSnap.at.closedTradesToday;
          // Sync AT enabled/mode across devices
          if (typeof serverSnap.at.enabled === 'boolean' && serverSnap.at.enabled !== AT.enabled) {
            AT.enabled = serverSnap.at.enabled;
            changed = true;
            // Update AT UI to reflect remote toggle
            setTimeout(function () {
              if (typeof atUpdateBanner === 'function') atUpdateBanner();
              if (typeof ptUpdateBanner === 'function') ptUpdateBanner();
              var btn = document.getElementById('atMainBtn');
              var dot = document.getElementById('atBtnDot');
              var txt = document.getElementById('atBtnTxt');
              if (btn && dot && txt) {
                if (AT.enabled) {
                  btn.className = 'at-main-btn on';
                  dot.style.background = '#00ff88'; dot.style.boxShadow = '0 0 10px #00ff88';
                  txt.textContent = 'AUTO TRADE ON';
                  var st = document.getElementById('atStatus'); if (st) st.innerHTML = _ZI.dGrn + ' Activ — scan la 30s';
                  if (!AT.interval && typeof runAutoTradeCheck === 'function') AT.interval = Intervals.set('atCheck', runAutoTradeCheck, 30000);
                } else {
                  btn.className = 'at-main-btn off';
                  dot.style.background = '#aa44ff'; dot.style.boxShadow = '0 0 6px #aa44ff';
                  txt.textContent = 'AUTO TRADE OFF';
                  var st = document.getElementById('atStatus'); if (st) st.textContent = 'Configureaza mai jos';
                  if (typeof Intervals !== 'undefined') Intervals.clear('atCheck');
                  clearInterval(AT.interval); AT.interval = null;
                }
              }
            }, 50);
          }
          if (serverSnap.at.mode) AT.mode = serverSnap.at.mode;
          if (typeof serverSnap.at.totalTrades === 'number') AT.totalTrades = serverSnap.at.totalTrades;
          if (typeof serverSnap.at.wins === 'number') AT.wins = serverSnap.at.wins;
          if (typeof serverSnap.at.losses === 'number') AT.losses = serverSnap.at.losses;
          if (typeof serverSnap.at.totalPnL === 'number') AT.totalPnL = serverSnap.at.totalPnL;
          if (typeof serverSnap.at.lastTradeTs === 'number') AT.lastTradeTs = serverSnap.at.lastTradeTs;
        }
        // Brain state — runMode/assistArmed now managed exclusively by user-context sync
        // (_userCtxPull → settings section → _usApply). ZState no longer applies them
        // to prevent conflicting dual-source updates. ZState still SAVES them for backup.
      }

      if (changed) {
        saveLocalOnly();
        setTimeout(function () {
          if (typeof updateDemoBalance === 'function') updateDemoBalance();
          if (typeof renderDemoPositions === 'function') renderDemoPositions();
          if (typeof renderATPositions === 'function') renderATPositions();
          if (typeof syncBrainFromState === 'function') syncBrainFromState();
        }, 100);
      }
      return changed;
    }).catch(function (e) { console.warn('[sync] pullAndMerge failed:', e); return false; })
      .finally(function () { _merging = false; }); // [S2B1-T2] always release merge lock
  }

  // [C1] sendBeacon push for beforeunload — minimal critical data
  function syncBeacon() {
    try {
      var data = _serialize();
      // Minimal payload: positions, balance, closedIds, AT state, timestamp
      var payload = JSON.stringify({
        ts: data.ts,
        positions: data.positions,
        demoBalance: data.demoBalance,
        demoPnL: data.demoPnL,
        demoWins: data.demoWins,
        demoLosses: data.demoLosses,
        at: data.at,
        closedIds: data.closedIds,
        symbol: data.symbol
      });
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/sync/state', new Blob([payload], { type: 'application/json' }));
        console.log('[sync] \u2705 beacon pushed (critical state)');
      } else {
        fetch('/api/sync/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, credentials: 'same-origin', keepalive: true });
      }
    } catch (_) { }
  }

  return { save: saveAndSync, saveLocal: saveLocalOnly, load, restore, clear, scheduleSave: scheduleSaveAndSync, syncToServer, syncNow, syncBeacon, pullFromServer, pullJournalFromServer, pullAndMerge, markSyncReady, startATPolling: _startATPolling, _applyPreboot: _applyServerATState, markDirty, isDirty: function () { return _dirty; }, isMerging: function () { return _merging; } };
})();

// ╔═══════════════════════════════════════════════════════════════════╗
// ║  GLOBAL DECLARATIONS — toate variabilele globale, într-un singur  ║
// ║  loc, înainte de orice funcție care le folosește.                  ║
// ║  Ordinea: utils → S → TP → chart → DSL → engine → AT → AUB       ║
// ╚═══════════════════════════════════════════════════════════════════╝

// Main state object S
const S = {
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
  magnetBias: 'neut', // FIX 12: initialized, no || 'neut' fallback needed
  cloudEmail: '',
  alerts: { enabled: false, volSpike: true, volThreshold: 500, pivotCross: false, divergence: true, rsiAlerts: true, whaleOrders: true, whaleMinBtc: 100, liqAlerts: true, liqMinBtc: 1 },
  heatmapPockets: [],
  heatmapSettings: { lookback: 400, pivotWidth: 1, atrLen: 121, atrBandPct: 0.05, extendUnhit: 30, keepTouched: true, heatContrast: 0.3, minWeight: 0, longCol: '#01c4fe', shortCol: '#ffe400' },
  // ── Scenario Engine state (additive, read-only advisory) ─────
  scenario: { primary: null, alternate: null, failure: null, updated: 0 },
  // ── Liq Source Metrics (observability) ─────
  liqMetrics: {
    bnb: { count: 0, usd: 0, lastTs: 0, msgCount: 0 },
    byb: { count: 0, usd: 0, lastTs: 0, msgCount: 0, connected: false, connectedAt: 0, reconnects: 0 }
  },
};

// Chart series refs
let mainChart, cSeries, ema50S, ema200S, wma20S, wma50S, stS, cvdChart, cvdS, volChart, volS;
// [INDICATORS] Overlay series refs
let bbUpperS = null, bbMiddleS = null, bbLowerS = null;
let ichimokuSeries = []; // tenkan, kijun, spanA, spanB, chikou
let fibSeries = [];      // dynamic line series for fib levels
let pivotSeries = [];    // P, S1-S3, R1-R3 line series
let vpSeries = [];       // volume profile horizontal bars
// [INDICATORS] Sub-chart refs (oscillators)
let _rsiChart = null, _rsiSeries = null, _rsiInited = false;
let _stochChart = null, _stochKSeries = null, _stochDSeries = null, _stochInited = false;
let _atrChart = null, _atrSeries = null, _atrInited = false;
let _obvChart = null, _obvSeries = null, _obvInited = false;
let _mfiChart = null, _mfiSeries = null, _mfiInited = false;
let _cciChart = null, _cciSeries = null, _cciInited = false;
// [INDICATORS] Settings (TradingView defaults)
const IND_SETTINGS = {
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
};
let liqSeries = [], srSeries = [];
let zsSeries = [];

// ── IND_SETTINGS persistence (cross-device sync) ──
function _indSettingsSave() {
  try {
    var data = JSON.stringify(IND_SETTINGS);
    if (typeof _safeLocalStorageSet === 'function') _safeLocalStorageSet('zeus_ind_settings', data);
    else localStorage.setItem('zeus_ind_settings', data);
    if (typeof _ucMarkDirty === 'function') _ucMarkDirty('indSettings');
    if (typeof _userCtxPush === 'function') _userCtxPush();
  } catch (_) { }
}
function _indSettingsLoad() {
  try {
    var raw = localStorage.getItem('zeus_ind_settings');
    if (!raw) return;
    var saved = JSON.parse(raw);
    if (!saved || typeof saved !== 'object') return;
    for (var k in saved) {
      if (IND_SETTINGS[k] && typeof saved[k] === 'object') {
        for (var p in saved[k]) {
          if (IND_SETTINGS[k].hasOwnProperty(p)) IND_SETTINGS[k][p] = saved[k][p];
        }
      }
    }
  } catch (_) { }
}
_indSettingsLoad(); // restore on boot
window._indSettingsSave = _indSettingsSave;
window._indSettingsLoad = _indSettingsLoad;

// Trading Positions state
const TP = { demoOpen: false, liveOpen: false, demoSide: 'LONG', liveSide: 'LONG', demoBalance: 10000, demoPnL: 0, demoWins: 0, demoLosses: 0, demoPositions: [], livePositions: [], pendingOrders: [], manualLivePending: [], liveConnected: false, liveExchange: 'binance', liveBalance: 0, liveAvailableBalance: 0, liveUnrealizedPnL: 0 };
// [V1.5] Legacy API_KEY/API_SECRET removed — credentials are server-side only (credentialStore)

// OI + Watchlist + Prices
const oiHistory = [];
const WL_SYMS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'ZECUSDT'];
const wlPrices = {};
const allPrices = {};
window.S = S; window.allPrices = allPrices; // [v122 FIX] const not auto-exposed to window; IIFEs use window.S

// ╔══════════════════════════════════════════════════════════════╗

// Window exports for backward compat
// (CORE_STATE already on window from declaration; S and allPrices already exported above)
window.BlockReason = BlockReason;
window.buildExecSnapshot = buildExecSnapshot;
window.ZState = ZState;
window.TP = TP;
window.oiHistory = oiHistory;
window.wlPrices = wlPrices;
