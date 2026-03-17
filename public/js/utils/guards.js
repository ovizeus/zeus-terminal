// Zeus v122 — utils/guards.js
// Safety guards, watchdogs, degraded mode, recovery
'use strict';

// Safety configuration
const _SAFETY = {
  isReconnecting: false,
  dataStalled: false,
  lastPriceTs: Date.now(),
  lastKlineTs: Date.now(),
  lastServerSync: 0,
  serverNow: 0,
  serverDayId: 0,     // floor(serverTime / 86400000)
  storedDayId: 0,
  priceHistory: [],   // last N prices for sanity check
  maxPriceSalt: 0.20, // 20% max jump per tick
  wsIntervals: new Set(),  // track all intervals for cleanup
  autoSuspended: false,
  stallTimer: null,
  // Anti-spam stall counters
  _stallMissedChecks: 0,   // consecutive missed watchdog ticks
  _stallLastLogTs: 0,      // last time we logged a stall warning (debounce)
  dataStalledSince: 0,
  // Degraded mode: tracks which secondary feeds are down (not trading feed)
  degradedFeeds: new Set(),
};
const _safe = {
  _last: {},
  num(v, key, fallback) {
    const n = +v;
    if (!Number.isFinite(n)) {
      if (key && _safe._last[key] != null) return _safe._last[key];
      return fallback ?? 0;
    }
    if (key) _safe._last[key] = n;
    return n;
  },
  price(v) { return _safe.num(v, 'price', S.price || 0); },
  pct(v) { return Math.max(-100, Math.min(100, _safe.num(v, 'pct', 0))); },
  rsi(v) { return Math.max(0, Math.min(100, _safe.num(v, 'rsi', 50))); },
  atr(v) { return _safe.num(v, 'atr', 0); },
};

// ── SAFE PnL CALCULATOR ──────────────────────────────────────────
// Calculates leveraged PnL safely — returns 0 on any invalid input
// isDiff=true: curOrDiff is already (curPrice - entry), isDiff=false: curOrDiff is curPrice
function _safePnl(side, curOrDiff, entry, size, lev, isDiff) {
  const _entry = _safe.num(entry, null, 0);
  const _size = _safe.num(size, null, 0);
  const _lev = _safe.num(lev, null, 1);
  if (_entry <= 0 || _size <= 0) return 0;
  const _diff = isDiff
    ? (side === 'LONG' ? _safe.num(curOrDiff, null, 0) : -_safe.num(curOrDiff, null, 0))
    : (side === 'LONG'
      ? _safe.num(curOrDiff, null, _entry) - _entry
      : _entry - _safe.num(curOrDiff, null, _entry));
  return _diff / _entry * _size * _lev;
}


// Recovery mode state
let _recoveryMode = false;

// Price sanity check
function _isPriceSane(newPrice) {
  if (!Number.isFinite(newPrice) || newPrice <= 0) return false;
  const last = S.price;
  if (!last || last <= 0) return true;  // first price always accepted
  const pctChange = Math.abs(newPrice - last) / last;
  // [FIX v85 BUG2] Prag dinamic: max 5% default, sau 3×ATR% dacă ATR disponibil
  // Înlocuit: 20% fix (prea permisiv pentru crypto intraday)
  let maxAllowed = 0.05; // 5% default
  if (S.atr && last > 0) {
    const atrPct = S.atr / last;
    maxAllowed = Math.max(0.05, atrPct * 3); // cel puțin 5%, mai mare în perioade volatile
  }
  if (pctChange > maxAllowed) {
    console.warn(`[SAFETY] Price spike ignored: ${last} → ${newPrice} (${(pctChange * 100).toFixed(1)}% > max ${(maxAllowed * 100).toFixed(1)}%)`);
    return false;
  }
  return true;
}

// ── 3. SERVER TIME SYNC ──────────────────────────────────────
async function _syncServerTime() {
  try {
    // AbortSignal.timeout fallback for older mobile browsers
    let _signal;
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
      _signal = AbortSignal.timeout(5000);
    } else {
      const _ctrl = new AbortController();
      setTimeout(() => _ctrl.abort(), 5000);
      _signal = _ctrl.signal;
    }
    const r = await fetch('https://fapi.binance.com/fapi/v1/time', { signal: _signal });
    const d = await r.json();
    const st = +d.serverTime;
    if (!Number.isFinite(st) || st <= 0) return;
    _SAFETY.serverNow = st;
    _SAFETY.lastServerSync = Date.now();
    const dayId = Math.floor(st / 86400000);
    if (_SAFETY.storedDayId && dayId !== _SAFETY.storedDayId) {
      // New UTC day — reset daily counters
      _onNewUTCDay(dayId);
    }
    _SAFETY.storedDayId = dayId;
    _SAFETY.serverDayId = dayId;
  } catch (_) { /* network fail — use local as fallback */ }
}

function _onNewUTCDay(newDayId) {
  const _rPnL = +(AT.realizedDailyPnL) || 0;
  const _closed = +(AT.closedTradesToday) || 0;
  AT.dailyPnL = 0; AT.realizedDailyPnL = 0; AT.closedTradesToday = 0;
  AT.dailyStart = new Date().toDateString();
  atLog('info', `📅 New UTC day (${newDayId}) — daily counters reset`);
  // Kill switch: only keep if there was REAL loss today
  if (AT.killTriggered && _closed === 0 && Math.abs(_rPnL) < 0.01) {
    AT.killTriggered = false;
    const kb = el('atKillBtn'); if (kb) kb.classList.remove('triggered');
    atLog('info', 'ℹ️ Kill switch cleared — no realized loss on new day');
  }
}

// Init server time sync interval
function _startServerTimeSync() {
  _syncServerTime(); // immediate
  Intervals.set('serverTime', _syncServerTime, 60000);
}

// ── 5. DATA WATCHDOG ─────────────────────────────────────────

// Watchdog & intervals
function _resetWatchdog() {
  _SAFETY.lastPriceTs = Date.now();
  _SAFETY._stallMissedChecks = 0;  // reset consecutive miss counter on any valid tick

  if (_SAFETY.dataStalled) {
    // req 4: log restore only once
    _SAFETY.dataStalled = false;
    _SAFETY.dataStalledSince = 0;
    _SAFETY._stallLastLogTs = 0;   // reset debounce so next stall logs fresh
    S.dataStalled = false;
    S.dataStalledSince = 0;
    _SAFETY.autoSuspended = false;
    atLog('info', '✅ Data feed restored — AT resuming');  // logged once here, never repeated
    const sb = el('dataStallBanner'); if (sb) sb.style.display = 'none';
  }
}

function _resetKlineWatchdog() {
  _SAFETY.lastKlineTs = Date.now();
}

function _startWatchdog() {
  // Watchdog fires every 5s — we require 2 consecutive misses = 10s min before stall
  const STALL_THRESHOLD_MS = 15000;  // req 1: min 15s since last price/kline
  const STALL_KLINE_THRESH = 20000;  // klines less frequent than price
  const STALL_MISS_REQUIRED = 2;      // req 2: 2 consecutive missed checks
  const STALL_LOG_DEBOUNCE = 30000;  // req 3: only log once per 30s
  const STALL_AT_SUSPEND_MS = 20000;  // req 6: suspend AT only after 20s stall

  Intervals.set('watchdog', () => {
    const now = Date.now();
    const priceAge = now - _SAFETY.lastPriceTs;
    const klineAge = now - _SAFETY.lastKlineTs;
    const isMissed = (priceAge > STALL_THRESHOLD_MS || klineAge > STALL_KLINE_THRESH)
      && !_SAFETY.isReconnecting;

    if (isMissed) {
      _SAFETY._stallMissedChecks = (_SAFETY._stallMissedChecks || 0) + 1;
    } else {
      _SAFETY._stallMissedChecks = 0;  // reset on any good tick
    }

    // req 2: need 2+ consecutive missed checks before declaring stall
    if (_SAFETY._stallMissedChecks >= STALL_MISS_REQUIRED) {
      const stallAge = _SAFETY.dataStalledSince
        ? now - _SAFETY.dataStalledSince
        : 0;

      if (!_SAFETY.dataStalled) {
        // First time entering stall
        _SAFETY.dataStalled = true;
        _SAFETY.dataStalledSince = now;
        S.dataStalled = true;
        S.dataStalledSince = now;
        const sb = el('dataStallBanner'); if (sb) sb.style.display = 'block';
      }

      // req 3: debounce log — at most once per 30s
      const timeSinceLastLog = now - (_SAFETY._stallLastLogTs || 0);
      if (timeSinceLastLog >= STALL_LOG_DEBOUNCE) {
        _SAFETY._stallLastLogTs = now;
        const stalledForSec = Math.round((now - _SAFETY.dataStalledSince) / 1000);
        atLog('warn', `⚠️ DATA STALLED ${stalledForSec}s — price feed unresponsive`);
      }

      // req 6: suspend AT only after 20s of confirmed stall
      const stalledMs = now - (_SAFETY.dataStalledSince || now);
      if (stalledMs >= STALL_AT_SUSPEND_MS && !_SAFETY.autoSuspended) {
        _SAFETY.autoSuspended = true;
        atLog('warn', '⏸ AUTO-TRADE suspended (stall > 20s)');
      }
    }
    // FIX3: refresh WHY BLOCKED pill every watchdog tick (cooldown countdown)
    if (typeof _updateWhyBlocked === 'function') _updateWhyBlocked();
  }, 5000);
}

// ── 1. INTERNET DROPOUT / AUTO-RECOVERY ──────────────────────
// [MOVED TO TOP] _recoveryMode

// ── DEGRADED MODE — secondary feed down, AT continues ────────────
// BNB feed down but BYB (liq) or watchlist still up → DEGRADED not RECOVERY
// [FIX] Debounce: max 1 log per 60s per enter/exit/continues to prevent log spam
const _degradedLogTs = { enter: 0, exit: 0, continues: 0 };
const _DEGRADED_LOG_COOLDOWN = 60000; // 60s
function _enterDegradedMode(source) {
  _SAFETY.degradedFeeds.add(source);
  const now = Date.now();
  if (now - _degradedLogTs.enter >= _DEGRADED_LOG_COOLDOWN) {
    _degradedLogTs.enter = now;
    atLog('warn', `⚠️ DEGRADED: ${source} feed down — continuing with reduced data`);
    ncAdd('warning', 'system', `⚠️ Feed degradat: ${source} down`);
  }
  updConn();
  _updateWhyBlocked();
}
function _exitDegradedMode(source) {
  _SAFETY.degradedFeeds.delete(source);
  if (_SAFETY.degradedFeeds.size === 0) {
    const now = Date.now();
    if (now - _degradedLogTs.exit >= _DEGRADED_LOG_COOLDOWN) {
      _degradedLogTs.exit = now;
      atLog('info', `✅ ${source} feed restored — full data mode`);
    }
    _updateWhyBlocked();
  }
  updConn();
}
function _isDegradedOnly() {
  // True if only secondary feeds are down (BYB liq) — not the price feed
  return _SAFETY.degradedFeeds.size > 0 && !_SAFETY.dataStalled && !_SAFETY.isReconnecting;
}

function _enterRecoveryMode(source) {
  if (_recoveryMode) return;
  _recoveryMode = true;
  _SAFETY.isReconnecting = true;
  _SAFETY.autoSuspended = true;
  atLog('warn', `⚡ RECOVERY MODE: ${source} disconnected — AT suspended`);
  const rb = el('recoveryBanner'); if (rb) rb.style.display = 'flex';
  updConn();
  ncAdd('critical', 'system', `⚡ RECOVERY MODE: ${source} disconnected`);  // [NC]
}

function _exitRecoveryMode() {
  _recoveryMode = false;
  _SAFETY.isReconnecting = false;
  setTimeout(() => {
    _verifyPositionsAfterReconnect();
    _SAFETY.autoSuspended = false;
    const rb = el('recoveryBanner'); if (rb) rb.style.display = 'none';
    atLog('info', '✅ Connection restored — positions verified');
    updConn();
  }, 2000);  // 2s settle time before resuming
}

function _verifyPositionsAfterReconnect() {
  // In demo mode: check if SL/TP were hit during offline by current price
  const autoPosns = (TP.demoPositions || []).filter(p => p.autoTrade && !p.closed);
  if (!autoPosns.length) return;
  autoPosns.forEach(pos => {
    const cur = getSymPrice(pos);
    if (!cur || !Number.isFinite(cur)) return;
    if (pos.side === 'LONG') {
      if (cur <= pos.sl) { closeDemoPos(pos.id, '🔌 SL (reconnect verify)'); }
      else if (pos.tp != null && Number.isFinite(pos.tp) && cur >= pos.tp) { closeDemoPos(pos.id, '🔌 TP (reconnect verify)'); }
    } else {
      if (cur >= pos.sl) { closeDemoPos(pos.id, '🔌 SL (reconnect verify)'); }
      else if (pos.tp != null && Number.isFinite(pos.tp) && cur <= pos.tp) { closeDemoPos(pos.id, '🔌 TP (reconnect verify)'); }
    }
  });
}

// ── 7. MEMORY / INTERVAL SAFETY ──────────────────────────────
// All WS reconnects should use _safeSetInterval to track
function _safeSetInterval(fn, ms, name) {
  // Now delegates to Intervals manager for dedup + tracking
  const key = name || ('_safe_' + Math.random().toString(36).slice(2, 7));
  return Intervals.set(key, fn, ms);
}

function _clearAllIntervals() {
  // Delegates to Intervals manager
  Intervals.clearAll();
}

// FIX 21: Cleanup intervals and WebSockets on page unload

// Error handlers
window.addEventListener('beforeunload', function () {
  try {
    Intervals.clearAll();
    if (typeof WS !== 'undefined') WS.closeAll();
    if (typeof ZState !== 'undefined') ZState.saveLocal(); // persist state locally before exit (no server push on unload)
  } catch (_) { }
});

// ── 9. EXECUTION SAFETY LOCK ─────────────────────────────────
function _isExecAllowed() {
  if (_SAFETY.isReconnecting) return [false, 'reconnecting'];
  if (_SAFETY.dataStalled) return [false, 'data stalled'];
  if (_SAFETY.autoSuspended) return [false, 'AT suspended'];
  if (!Number.isFinite(S.price) || S.price <= 0) return [false, 'price invalid'];
  // FIX1: degraded = secondary feed down → still allowed (log warning only)
  // [FIX] Debounce: max 1 log per 60s to prevent AT tick spam
  if (_isDegradedOnly()) {
    const now = Date.now();
    if (now - _degradedLogTs.continues >= _DEGRADED_LOG_COOLDOWN) {
      _degradedLogTs.continues = now;
      atLog('warn', `⚠️ DEGRADED feeds: ${[..._SAFETY.degradedFeeds].join(',')} — AT continues (reduced data)`);
    }
  }
  return [true, 'ok'];
}

// ── 10. GLOBAL ERROR HANDLING ────────────────────────────────
window.addEventListener('error', (e) => {
  console.error('[ZEUS ERR]', e.message, e.filename, e.lineno);
  if (AT.enabled && (S.mode || 'assist') === 'auto') {
    // Don't stop terminal — just log
    atLog('warn', `⚠️ JS Error: ${e.message?.substring(0, 60)}`);
  }
});

window.addEventListener('unhandledrejection', (e) => {
  console.warn('[ZEUS PROMISE]', e.reason);
});

// ── INIT SAFETY ENGINE ───────────────────────────────────────
function initSafetyEngine() {
  _startServerTimeSync();
  _startWatchdog();
  // Online/offline events
  window.addEventListener('online', () => { _exitRecoveryMode(); });
  window.addEventListener('offline', () => { _enterRecoveryMode('Network'); });
}

// ─── MAIN SCAN LOOP ────────────────────────────────────────────
