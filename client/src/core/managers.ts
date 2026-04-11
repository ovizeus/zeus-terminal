/**
 * Zeus Terminal — Core Managers (ported from public/js/core/managers.js)
 * Intervals, WS, FetchLock, ingestPrice, Timeouts — all set on window.*
 */

import { _resetWatchdog, _isPriceSane } from '../utils/guards'
const w = window as Record<string, any>

// FIX: Initialize __wsGen to 0 immediately — undefined !== 0 would kill all WS connections
w.__wsGen = w.__wsGen || 0

// ===== MODULE: INTERVALS =====
export const Intervals = w.Intervals = w.Intervals || (function () {
  const _map: Record<string, any> = {}
  return {
    set: function (name: string, fn: any, ms: number) {
      if (typeof fn !== 'function') { console.warn('[Intervals] not ready or bad fn:', name); return null }
      if (_map[name]) { clearInterval(_map[name]); delete _map[name] }
      _map[name] = setInterval(fn, ms)
      return _map[name]
    },
    clear: function (name: string) {
      if (_map[name]) { clearInterval(_map[name]); delete _map[name] }
    },
    clearGroup: function (...names: string[]) {
      names.forEach(function (n) { w.Intervals.clear(n) })
    },
    clearAll: function () {
      Object.keys(_map).forEach(function (n) { w.Intervals.clear(n) })
    },
    list: function () { return Object.keys(_map) }
  }
})()

// ===== MODULE: WS =====
export const WS = w.WS = w.WS || (function () {
  const _map: Record<string, any> = {}
  return {
    open: function (name: string, url: string, handlers: any) {
      if (!handlers) handlers = {}
      if (w.__wsGen === undefined || w.__wsGen === null) w.__wsGen = 0
      console.log(`[WS] open called: ${name}`, url, '| gen:', w.__wsGen)
      // FIX 10: cancel any pending reconnect timer for this connection before opening
      if (w.Timeouts) w.Timeouts.clear(name + 'Reconnect')
      w.WS.close(name) // also nulls all handlers on old socket
      const ws = new WebSocket(url)
      const gen = w.__wsGen
      ws.onopen = function (e: any) {
        console.log(`[WS] onopen: ${name} | current gen ${w.__wsGen}, my gen ${gen}`, gen !== w.__wsGen ? '→ STALE, closing' : '→ OK')
        if (w.__wsGen !== gen) { ws.close(); return }
        if (handlers.onopen) handlers.onopen(e)
      }
      ws.onmessage = function (e: any) { if (w.__wsGen !== gen) return; if (handlers.onmessage) handlers.onmessage(e) }
      ws.onerror = function (e: any) {
        console.error(`[WS] onerror: ${name}`, e)
        if (handlers.onerror) handlers.onerror(e)
      }
      ws.onclose = function (e: any) {
        console.log(`[WS] onclose: ${name} | code ${e.code}, reason "${e.reason || '—'}", wasClean ${e.wasClean}`)
        if (_map[name] === ws) delete _map[name]
        if (handlers.onclose) handlers.onclose(e)
      }
      _map[name] = ws
      return ws
    },
    close: function (name: string) {
      if (_map[name]) {
        // FIX 10: clear ALL handlers before closing to prevent stale event firing
        try {
          _map[name].onopen = null
          _map[name].onmessage = null
          _map[name].onerror = null
          _map[name].onclose = null
          _map[name].close()
        } catch (_e) { /* */ }
        delete _map[name]
      }
    },
    closeSymbolFeeds: function () {
      // [PATCH4 W1] Close ALL symbol-bound feeds including orderflow
      ;['bnb', 'byb', 'kline', 'of_agg'].forEach(function (n) { w.WS.close(n) })
    },
    closeAll: function () { Object.keys(_map).forEach(function (n) { w.WS.close(n) }) },
    get: function (name: string) { return _map[name] },
    isOpen: function (name: string) { return _map[name] && _map[name].readyState === WebSocket.OPEN }
  }
})()

// ── 3. FETCH LOCK ────────────────────────────────────────────────
export const FetchLock = w.FetchLock = w.FetchLock || (function () {
  const _locks: Record<string, boolean> = {}
  return {
    try: function (name: string) {
      if (_locks[name]) return false
      _locks[name] = true
      return true
    },
    release: function (name: string) { delete _locks[name] },
    guarded: async function (this: any, name: string, fn: () => Promise<void>) {
      if (!this.try(name)) return
      try { await fn() } finally { this.release(name) }
    }
  }
})()

// ── 4. PRICE INGRESS ─────────────────────────────────────────────
export const ingestPrice = w.ingestPrice = w.ingestPrice || function (_raw: any, _source: any) {
  const p = +_raw
  if (!Number.isFinite(p) || p <= 0) return false
  if (!_isPriceSane(p)) return false
  if (typeof w.S !== 'undefined') {
    w.S.prevPrice = w.S.price || p
    w.S.price = p
    if (w.S.symbol) w.allPrices[w.S.symbol] = p // BUG1: track main symbol
  }
  _resetWatchdog()
  return true
}

// ── 9. TIMEOUTS MANAGER ──────────────────────────────────────────
// Prevents reconnect storms and duplicate timeout chains
export const Timeouts = w.Timeouts = w.Timeouts || (function () {
  const _map: Record<string, any> = {}
  return {
    set: function (name: string, fn: () => void, ms: number) {
      // Cancel existing before setting new (dedup)
      if (_map[name]) { clearTimeout(_map[name]) }
      _map[name] = setTimeout(function () {
        delete _map[name]
        fn()
      }, ms)
      return _map[name]
    },
    clear: function (name: string) {
      if (_map[name]) { clearTimeout(_map[name]); delete _map[name] }
    },
    clearAll: function () {
      Object.keys(_map).forEach(function (n) {
        clearTimeout(_map[n])
      })
      // Clear all keys
      Object.keys(_map).forEach(function (n) { delete _map[n] })
    },
    active: function () { return Object.keys(_map) }
  }
})()
