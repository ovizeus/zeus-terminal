/**
 * Zeus Terminal — Safety guards, watchdogs, degraded mode, recovery
 * (ported from public/js/utils/guards.js)
 */

import { getATObject, getTPObject, getPrice, getATR } from '../services/stateAccessors'
import { el } from './dom'
import { _updateWhyBlocked } from '../data/klines'
import { updConn } from '../data/marketDataWS'
import { atLog } from '../trading/autotrade'
import { closeDemoPos } from '../data/marketDataClose'
import { getSymPrice } from '../data/marketDataPositions'
const w = window as Record<string, any> // kept for w.S writes (dataStalled, dataStalledSince), w.S.mode (self-ref), atLog, w.ncAdd, fn calls
// [8D-6C2] AT = mutable ref to AT — reads + writes through same object
const AT = getATObject()

// Safety configuration
export const _SAFETY: Record<string, any> = {
  isReconnecting: false,
  dataStalled: false,
  lastPriceTs: Date.now(),
  lastKlineTs: Date.now(),
  lastServerSync: 0,
  serverNow: 0,
  serverDayId: 0,    // floor(serverTime / 86400000)
  storedDayId: 0,
  priceHistory: [],  // last N prices for sanity check
  maxPriceSalt: 0.20, // 20% max jump per tick
  wsIntervals: new Set(), // track all intervals for cleanup
  autoSuspended: false,
  stallTimer: null,
  // Anti-spam stall counters
  _stallMissedChecks: 0,  // consecutive missed watchdog ticks
  _stallLastLogTs: 0,     // last time we logged a stall warning (debounce)
  dataStalledSince: 0,
  // Degraded mode: tracks which secondary feeds are down (not trading feed)
  degradedFeeds: new Set(),
}
w._SAFETY = _SAFETY

export const _safe: Record<string, any> = {
  _last: {} as Record<string, any>,
  num(v: any, key: string | null, fallback?: number) {
    const n = +v
    if (!Number.isFinite(n)) {
      if (key && _safe._last[key] != null) return _safe._last[key]
      return fallback ?? 0
    }
    if (key) _safe._last[key] = n
    return n
  },
  price(v: any) { return _safe.num(v, 'price', getPrice()) },
  pct(v: any) { return Math.max(-100, Math.min(100, _safe.num(v, 'pct', 0))) },
  rsi(v: any) { return Math.max(0, Math.min(100, _safe.num(v, 'rsi', 50))) },
  atr(v: any) { return _safe.num(v, 'atr', 0) },
}
w._safe = _safe

// ── SAFE PnL CALCULATOR ──────────────────────────────────────────
export function _safePnl(side: string, curOrDiff: any, entry: any, size: any, lev: any, isDiff?: boolean): number {
  const _entry = _safe.num(entry, null, 0)
  const _size = _safe.num(size, null, 0)
  const _lev = _safe.num(lev, null, 1)
  if (_entry <= 0 || _size <= 0) return 0
  const _diff = isDiff
    ? (side === 'LONG' ? _safe.num(curOrDiff, null, 0) : -_safe.num(curOrDiff, null, 0))
    : (side === 'LONG'
      ? _safe.num(curOrDiff, null, _entry) - _entry
      : _entry - _safe.num(curOrDiff, null, _entry))
  return _diff / _entry * _size * _lev
}

// Recovery mode state
let _recoveryMode = false

// Price sanity check
export function _isPriceSane(newPrice: number): boolean {
  if (!Number.isFinite(newPrice) || newPrice <= 0) return false
  const last = getPrice()
  if (!last || last <= 0) return true  // first price always accepted
  const pctChange = Math.abs(newPrice - last) / last
  // [FIX v85 BUG2] Prag dinamic: max 5% default, sau 3xATR% daca ATR disponibil
  let maxAllowed = 0.05 // 5% default
  const _atr = getATR()
  if (_atr && last > 0) {
    const atrPct = _atr / last
    maxAllowed = Math.max(0.05, atrPct * 3) // cel putin 5%, mai mare in perioade volatile
  }
  if (pctChange > maxAllowed) {
    console.warn(`[SAFETY] Price spike ignored: ${last} → ${newPrice} (${(pctChange * 100).toFixed(1)}% > max ${(maxAllowed * 100).toFixed(1)}%)`)
    return false
  }
  return true
}
// _isPriceSane — exported, consumers import directly

// ── 3. SERVER TIME SYNC ──────────────────────────────────────
export async function _syncServerTime(): Promise<void> {
  try {
    // AbortSignal.timeout fallback for older mobile browsers
    let _signal: AbortSignal
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
      _signal = AbortSignal.timeout(5000)
    } else {
      const _ctrl = new AbortController()
      setTimeout(() => _ctrl.abort(), 5000)
      _signal = _ctrl.signal
    }
    const r = await fetch('https://fapi.binance.com/fapi/v1/time', { signal: _signal })
    const d = await r.json()
    const st = +d.serverTime
    if (!Number.isFinite(st) || st <= 0) return
    _SAFETY.serverNow = st
    _SAFETY.lastServerSync = Date.now()
    const dayId = Math.floor(st / 86400000)
    if (_SAFETY.storedDayId && dayId !== _SAFETY.storedDayId) {
      // New UTC day — reset daily counters
      _onNewUTCDay(dayId)
    }
    _SAFETY.storedDayId = dayId
    _SAFETY.serverDayId = dayId
  } catch (_e) { /* network fail — use local as fallback */ }
}

export function _onNewUTCDay(_newDayId: number): void {
  const _rPnL = +(AT?.realizedDailyPnL) || 0
  const _closed = +(AT?.closedTradesToday) || 0
  AT.dailyPnL = 0; AT.realizedDailyPnL = 0; AT.closedTradesToday = 0
  AT.dailyStart = new Date().toDateString()
  atLog('info', `[DAY] New UTC day (${_newDayId}) — daily counters reset`)
  // Kill switch: only keep if there was REAL loss today
  if (AT.killTriggered && _closed === 0 && Math.abs(_rPnL) < 0.01) {
    AT.killTriggered = false
    const kb = el('atKillBtn'); if (kb) kb.classList.remove('triggered')
    atLog('info', '[INFO] Kill switch cleared — no realized loss on new day')
  }
  // [9A-4] Notify React after daily counter reset
  try { window.dispatchEvent(new CustomEvent('zeus:atStateChanged')) } catch (_) {}
}

// Init server time sync interval
export function _startServerTimeSync(): void {
  _syncServerTime() // immediate
  w.Intervals.set('serverTime', _syncServerTime, 60000)
}

// ── 5. DATA WATCHDOG ─────────────────────────────────────────

// Watchdog & intervals
export function _resetWatchdog(): void {
  _SAFETY.lastPriceTs = Date.now()
  _SAFETY._stallMissedChecks = 0  // reset consecutive miss counter on any valid tick

  if (_SAFETY.dataStalled) {
    // req 4: log restore only once
    _SAFETY.dataStalled = false
    _SAFETY.dataStalledSince = 0
    _SAFETY._stallLastLogTs = 0   // reset debounce so next stall logs fresh
    w.S.dataStalled = false
    w.S.dataStalledSince = 0
    _SAFETY.autoSuspended = false
    atLog('info', '[OK] Data feed restored — AT resuming')  // logged once here, never repeated
    const sb = el('dataStallBanner'); if (sb) sb.style.display = 'none'
  }
}
// _resetWatchdog — exported, consumers import directly

export function _resetKlineWatchdog(): void {
  _SAFETY.lastKlineTs = Date.now()
}
// _resetKlineWatchdog — exported, consumers import directly

export function _startWatchdog(): void {
  // Watchdog fires every 5s — we require 2 consecutive misses = 10s min before stall
  const STALL_THRESHOLD_MS = 15000  // req 1: min 15s since last price/kline
  const STALL_KLINE_THRESH = 20000  // klines less frequent than price
  const STALL_MISS_REQUIRED = 2      // req 2: 2 consecutive missed checks
  const STALL_LOG_DEBOUNCE = 30000  // req 3: only log once per 30s
  const STALL_AT_SUSPEND_MS = 20000  // req 6: suspend AT only after 20s stall

  w.Intervals.set('watchdog', () => {
    const now = Date.now()
    const priceAge = now - _SAFETY.lastPriceTs
    const klineAge = now - _SAFETY.lastKlineTs
    const isMissed = (priceAge > STALL_THRESHOLD_MS || klineAge > STALL_KLINE_THRESH)
      && !_SAFETY.isReconnecting

    if (isMissed) {
      _SAFETY._stallMissedChecks = (_SAFETY._stallMissedChecks || 0) + 1
    } else {
      _SAFETY._stallMissedChecks = 0  // reset on any good tick
    }

    // req 2: need 2+ consecutive missed checks before declaring stall
    if (_SAFETY._stallMissedChecks >= STALL_MISS_REQUIRED) {
      if (!_SAFETY.dataStalled) {
        // First time entering stall
        _SAFETY.dataStalled = true
        _SAFETY.dataStalledSince = now
        w.S.dataStalled = true
        w.S.dataStalledSince = now
        const sb = el('dataStallBanner'); if (sb) sb.style.display = 'block'
      }

      // req 3: debounce log — at most once per 30s
      const timeSinceLastLog = now - (_SAFETY._stallLastLogTs || 0)
      if (timeSinceLastLog >= STALL_LOG_DEBOUNCE) {
        _SAFETY._stallLastLogTs = now
        const stalledForSec = Math.round((now - _SAFETY.dataStalledSince) / 1000)
        atLog('warn', `[STALL] DATA STALLED ${stalledForSec}s — price feed unresponsive`)
      }

      // req 6: suspend AT only after 20s of confirmed stall
      const stalledMs = now - (_SAFETY.dataStalledSince || now)
      if (stalledMs >= STALL_AT_SUSPEND_MS && !_SAFETY.autoSuspended) {
        _SAFETY.autoSuspended = true
        atLog('warn', '[PAUSE] AUTO-TRADE suspended (stall > 20s)')
      }
    }
    // FIX3: refresh WHY BLOCKED pill every watchdog tick (cooldown countdown)
    if (typeof _updateWhyBlocked === 'function') _updateWhyBlocked()
  }, 5000)
}

// ── DEGRADED MODE — secondary feed down, AT continues ────────────
const _degradedLogTs: Record<string, number> = { enter: 0, exit: 0, continues: 0 }
const _DEGRADED_LOG_COOLDOWN = 60000 // 60s

export function _enterDegradedMode(source: string): void {
  _SAFETY.degradedFeeds.add(source)
  const now = Date.now()
  if (now - _degradedLogTs.enter >= _DEGRADED_LOG_COOLDOWN) {
    _degradedLogTs.enter = now
    atLog('warn', `[DEGRADED] ${source} feed down — continuing with reduced data`)
    w.ncAdd('warning', 'system', `Feed degradat: ${source} down`)
  }
  updConn()
  _updateWhyBlocked()
}
// _enterDegradedMode — exported, consumers import directly

export function _exitDegradedMode(source: string): void {
  _SAFETY.degradedFeeds.delete(source)
  if (_SAFETY.degradedFeeds.size === 0) {
    const now = Date.now()
    if (now - _degradedLogTs.exit >= _DEGRADED_LOG_COOLDOWN) {
      _degradedLogTs.exit = now
      atLog('info', `[OK] ${source} feed restored — full data mode`)
    }
    _updateWhyBlocked()
  }
  updConn()
}
// _exitDegradedMode — exported, consumers import directly

export function _isDegradedOnly(): boolean {
  // True if only secondary feeds are down (BYB liq) — not the price feed
  return _SAFETY.degradedFeeds.size > 0 && !_SAFETY.dataStalled && !_SAFETY.isReconnecting
}
// _isDegradedOnly — exported, consumers import directly

export function _enterRecoveryMode(source: string): void {
  if (_recoveryMode) return
  _recoveryMode = true
  _SAFETY.isReconnecting = true
  _SAFETY.autoSuspended = true
  atLog('warn', `[RECOVERY] ${source} disconnected — AT suspended`)
  const rb = el('recoveryBanner'); if (rb) rb.style.display = 'flex'
  updConn()
  w.ncAdd('critical', 'system', `[RECOVERY] ${source} disconnected`)  // [NC]
}
// _enterRecoveryMode — exported, consumers import directly

export function _exitRecoveryMode(): void {
  _recoveryMode = false
  _SAFETY.isReconnecting = false
  setTimeout(() => {
    _verifyPositionsAfterReconnect()
    _SAFETY.autoSuspended = false
    const rb = el('recoveryBanner'); if (rb) rb.style.display = 'none'
    atLog('info', '[OK] Connection restored — positions verified')
    updConn()
  }, 2000)  // 2s settle time before resuming
}
// _exitRecoveryMode — exported, consumers import directly

export function _verifyPositionsAfterReconnect(): void {
  // In demo mode: check if SL/TP were hit during offline by current price
  const autoPosns = (getTPObject()?.demoPositions || []).filter((p: any) => p.autoTrade && !p.closed)
  if (!autoPosns.length) return
  autoPosns.forEach((pos: any) => {
    const cur = getSymPrice(pos)
    if (!cur || !Number.isFinite(cur)) return
    if (pos.side === 'LONG') {
      if (cur <= pos.sl) { closeDemoPos(pos.id, 'SL (reconnect verify)') }
      else if (pos.tp != null && Number.isFinite(pos.tp) && cur >= pos.tp) { closeDemoPos(pos.id, 'TP (reconnect verify)') }
    } else {
      if (cur >= pos.sl) { closeDemoPos(pos.id, 'SL (reconnect verify)') }
      else if (pos.tp != null && Number.isFinite(pos.tp) && cur <= pos.tp) { closeDemoPos(pos.id, 'TP (reconnect verify)') }
    }
  })
}

// ── 7. MEMORY / INTERVAL SAFETY ──────────────────────────────
export function _safeSetInterval(fn: any, ms: number, name?: string): any {
  // Now delegates to Intervals manager for dedup + tracking
  const key = name || ('_safe_' + Math.random().toString(36).slice(2, 7))
  return w.Intervals.set(key, fn, ms)
}

export function _clearAllIntervals(): void {
  // Delegates to Intervals manager
  w.Intervals.clearAll()
}

// [C7] Client error forwarding — send uncaught errors to server
;(function () {
  const _errQueue: any[] = []
  let _errTimer: ReturnType<typeof setTimeout> | null = null
  function _flushErrors() {
    if (_errQueue.length === 0) return
    const batch = _errQueue.splice(0, 5)
    batch.forEach(function (e: any) {
      try {
        navigator.sendBeacon('/api/client-error', new Blob([JSON.stringify(e)], { type: 'application/json' }))
      } catch (_e2) { /* */ }
    })
  }
  w.onerror = function (msg: any, src: any, line: any, col: any, err: any) {
    if (typeof w.ZLOG !== 'undefined') w.ZLOG.push('ERROR', '[ERR] ' + String(msg || '') + ' (line ' + line + ')')
    _errQueue.push({ msg: String(msg).slice(0, 500), src: String(src || '').slice(0, 200), line: line, col: col, stack: (err && err.stack) ? String(err.stack).slice(0, 1000) : '', ua: navigator.userAgent })
    if (!_errTimer) _errTimer = setTimeout(function () { _errTimer = null; _flushErrors() }, 2000)
  }
  window.addEventListener('unhandledrejection', function (ev) {
    const reason: any = ev.reason || {}
    _errQueue.push({ msg: 'UnhandledRejection: ' + String(reason.message || reason).slice(0, 500), src: '', line: 0, col: 0, stack: reason.stack ? String(reason.stack).slice(0, 1000) : '', ua: navigator.userAgent })
    if (!_errTimer) _errTimer = setTimeout(function () { _errTimer = null; _flushErrors() }, 2000)
  })
})()

// Error handlers
// beforeunload — desktop browsers
window.addEventListener('beforeunload', function () {
  try {
    if (typeof w.TabLeader !== 'undefined') w.TabLeader.release() // [B1] release leadership
    if (typeof w._usFlush === 'function') w._usFlush() // flush settings + sendBeacon to server
    if (typeof w.ZState !== 'undefined') {
      w.ZState.syncBeacon() // [C1] sendBeacon critical state to server
      w.ZState.saveLocal()  // persist state locally before exit
    }
    w.Intervals.clearAll()
    if (typeof w.WS !== 'undefined') w.WS.closeAll() // close WS AFTER saves are done
  } catch (_e) { /* */ }
})
// pagehide — mobile Safari/Chrome (guaranteed on app close/swipe)
window.addEventListener('pagehide', function () {
  try {
    if (typeof w._usFlush === 'function') w._usFlush()
    if (typeof w.ZState !== 'undefined') {
      w.ZState.syncBeacon() // [C1] sendBeacon critical state
      w.ZState.saveLocal()
    }
  } catch (_e) { /* */ }
})

// ── 9. EXECUTION SAFETY LOCK ─────────────────────────────────
export function _isExecAllowed(): [boolean, string] {
  if (_SAFETY.isReconnecting) return [false, 'reconnecting']
  if (_SAFETY.dataStalled) return [false, 'data stalled']
  if (_SAFETY.autoSuspended) return [false, 'AT suspended']
  const _p = getPrice(); if (!Number.isFinite(_p) || _p <= 0) return [false, 'price invalid']
  // FIX1: degraded = secondary feed down → still allowed (log warning only)
  // [FIX] Debounce: max 1 log per 60s to prevent AT tick spam
  if (_isDegradedOnly()) {
    const now = Date.now()
    if (now - _degradedLogTs.continues >= _DEGRADED_LOG_COOLDOWN) {
      _degradedLogTs.continues = now
      atLog('warn', `[DEGRADED] feeds: ${[..._SAFETY.degradedFeeds].join(',')} — AT continues (reduced data)`)
    }
  }
  return [true, 'ok']
}
// _isExecAllowed — exported, consumers import directly

// ── 10. GLOBAL ERROR HANDLING ────────────────────────────────
window.addEventListener('error', (e) => {
  console.error('[ZEUS ERR]', e.message, e.filename, e.lineno)
  if (AT?.enabled && (w.S?.mode || 'assist') === 'auto') {
    // Don't stop terminal — just log
    atLog('warn', `[ERR] JS Error: ${e.message?.substring(0, 60)}`)
  }
})

// unhandledrejection: single handler at line 330 (error reporting IIFE) — no duplicate needed

// ── INIT SAFETY ENGINE ───────────────────────────────────────
export function initSafetyEngine(): void {
  _startServerTimeSync()
  _startWatchdog()
  // Online/offline events
  window.addEventListener('online', () => { _exitRecoveryMode() })
  window.addEventListener('offline', () => { _enterRecoveryMode('Network') })
}
// initSafetyEngine — exported, consumers import directly
