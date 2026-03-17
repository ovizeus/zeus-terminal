// Zeus v122 — core/state.js
// Global state objects — ALL exported to window for compat
'use strict';
window.__SYNC_VERSION__ = 'v9';  // bump this to verify phone has new JS
console.log('[ZEUS] state.js loaded — sync version:', window.__SYNC_VERSION__);

// CORE_STATE — single source of truth
window.CORE_STATE = {
  market: {},
  indicators: {},
  score: 0,
  position: null,
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
  const _levRaw = parseInt(document.getElementById('atLev')?.value);
  const _sizeRaw = parseFloat(document.getElementById('atSize')?.value);
  const _slRaw = parseFloat(document.getElementById('atSL')?.value);
  const _rrRaw = parseFloat(document.getElementById('atRR')?.value);

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

  function _serialize() {
    return {
      ts: Date.now(),
      // Demo balance & stats persistence
      demoBalance: (typeof TP !== 'undefined') ? TP.demoBalance : 10000,
      demoPnL: (typeof TP !== 'undefined') ? TP.demoPnL : 0,
      demoWins: (typeof TP !== 'undefined') ? TP.demoWins : 0,
      demoLosses: (typeof TP !== 'undefined') ? TP.demoLosses : 0,
      positions: (typeof TP !== 'undefined' ? TP.demoPositions || [] : [])
        .filter(p => !p.closed)
        .map(p => ({
          id: p.id, side: p.side, sym: p.sym, entry: p.entry,
          size: p.size, lev: p.lev, tp: p.tp, sl: p.sl,
          liqPrice: p.liqPrice, autoTrade: !!p.autoTrade,
          openTs: p.openTs || p.id, isLive: !!p.isLive,
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
    };
  }

  function save() {
    // [v105 FIX Bug8] _safeLocalStorageSet (hoisted function declaration) — protejeaza la QuotaExceededError
    // Anterior: localStorage.setItem direct — putea arunca exceptie si corupe starea silentios
    try {
      var data = _serialize();
      console.log('[ZState] SAVE — pos:', (data.positions || []).length, 'bal:', data.demoBalance, 'ts:', data.ts);
      _safeLocalStorageSet(KEY, data);
    }
    catch (e) { console.warn('[ZState] save failed:', e.message); }
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

      // Restore demo balance & stats
      if (typeof TP !== 'undefined') {
        if (typeof snap.demoBalance === 'number' && isFinite(snap.demoBalance)) TP.demoBalance = snap.demoBalance;
        if (typeof snap.demoPnL === 'number' && isFinite(snap.demoPnL)) TP.demoPnL = snap.demoPnL;
        if (typeof snap.demoWins === 'number' && isFinite(snap.demoWins)) TP.demoWins = snap.demoWins;
        if (typeof snap.demoLosses === 'number' && isFinite(snap.demoLosses)) TP.demoLosses = snap.demoLosses;
      }

      // Restore AT state
      if (snap.at && typeof AT !== 'undefined') {
        const a = snap.at;
        AT.enabled = !!a.enabled;  // Restore saved enabled state (will be resumed after feed ready)
        AT.mode = a.mode || 'demo';
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
            jEntries.forEach(j => { if (j && j.id) closedPosIds.add(String(j.id)); });
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

  // BUG-03 FIX: Shared sync token — must match server SYNC_TOKEN
  var _SYNC_TOKEN = 'b8daa0b5d63ee1a9f5f4d9c33c20b46d';
  var _syncHeaders = { 'Content-Type': 'application/json', 'X-Sync-Token': _SYNC_TOKEN };

  function _pushToServer() {
    if (_syncing) return;
    if (!_syncReady) { console.warn('[sync] push blocked — syncReady=false'); return; }
    _syncing = true;
    const data = _serialize();
    console.log('[sync] PUSHING to server — pos:', (data.positions || []).length, 'bal:', data.demoBalance);
    fetch('/api/sync/state', {
      method: 'POST',
      headers: _syncHeaders,
      body: JSON.stringify(data)
    }).then(function (r) { return r.json(); })
      .then(function (j) { if (j.ok) console.log('[sync] pushed OK ts=' + data.ts); else console.warn('[sync] push rejected:', j); })
      .catch(function (e) { console.warn('[sync] push failed:', e.message); })
      .finally(function () { _syncing = false; });
    // Also sync journal
    if (typeof TP !== 'undefined' && Array.isArray(TP.journal) && TP.journal.length > 0) {
      fetch('/api/sync/journal', {
        method: 'POST',
        headers: _syncHeaders,
        body: JSON.stringify(TP.journal.slice(0, 100))
      }).catch(function () { });
    }
  }

  function syncToServer() {
    if (_syncTimer) clearTimeout(_syncTimer);
    _syncTimer = setTimeout(_pushToServer, 1500);
  }

  function markSyncReady() { _syncReady = true; console.log('[sync] markSyncReady — pushes now enabled'); }

  function pullFromServer() {
    return fetch('/api/sync/state', { headers: { 'X-Sync-Token': _SYNC_TOKEN } }).then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok || !j.data) return null;
        return j.data;
      }).catch(function () { return null; });
  }

  function pullJournalFromServer() {
    return fetch('/api/sync/journal', { headers: { 'X-Sync-Token': _SYNC_TOKEN } }).then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok || !j.data) return null;
        return j.data;
      }).catch(function () { return null; });
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
  function scheduleSaveAndSync() {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(saveAndSync, 800);
  }

  return { save: saveAndSync, saveLocal: saveLocalOnly, load, restore, clear, scheduleSave: scheduleSaveAndSync, syncToServer, pullFromServer, pullJournalFromServer, markSyncReady };
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
};
let liqSeries = [], srSeries = [];
let zsSeries = [];

// Trading Positions state
const TP = { demoOpen: false, liveOpen: false, demoSide: 'LONG', liveSide: 'LONG', demoBalance: 10000, demoPnL: 0, demoWins: 0, demoLosses: 0, demoPositions: [], livePositions: [], liveConnected: false, liveExchange: 'binance', liveBalance: 0, liveAvailableBalance: 0, liveUnrealizedPnL: 0 };
let API_KEY = '';
let API_SECRET = '';

// OI + Watchlist + Prices
const oiHistory = [];
const WL_SYMS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'ZECUSDT'];
const wlPrices = {};
const allPrices = {};
window.S = S; window.allPrices = allPrices; // [v122 FIX] const not auto-exposed to window; IIFEs use window.S

// ╔══════════════════════════════════════════════════════════════╗

// Window exports for backward compat
window.CORE_STATE = CORE_STATE;
window.BlockReason = BlockReason;
window.buildExecSnapshot = buildExecSnapshot;
window.ZState = ZState;
window.S = S;
window.TP = TP;
window.oiHistory = oiHistory;
window.allPrices = allPrices;
window.wlPrices = wlPrices;
