/**
 * Zeus — WS Market Bridge
 * Routes market.* messages from server /ws/sync to local handlers.
 * Replaces 5 direct Binance WS connections with 1 server proxy.
 */

import { subscribe as wsSubscribe, send as wsSend } from './ws'

type MarketHandler = (msg: any) => void
const _handlers: Map<string, Set<MarketHandler>> = new Map()
let _installed = false

function _dispatch(msg: any) {
  if (!msg || !msg.type || !msg.type.startsWith('market.')) return
  const fns = _handlers.get(msg.type)
  if (fns) fns.forEach(fn => { try { fn(msg) } catch (_) {} })
  const allFns = _handlers.get('market.*')
  if (allFns) allFns.forEach(fn => { try { fn(msg) } catch (_) {} })
}

export function install() {
  if (_installed) return
  _installed = true
  wsSubscribe(_dispatch)
  // Also listen to non-market.* types via the raw ws listener
  wsSubscribe((msg: any) => {
    if (msg && msg.type === 'server.shutdown') {
      const graceMs = msg.graceMs || 5000
      const jitter = Math.random() * 3000
      try { const { toast } = require('../data/marketDataHelpers'); toast(`Server restarting — reconnecting in ${Math.round((graceMs + jitter) / 1000)}s`, graceMs) } catch (_) {}
    }
  })
  on('market.degraded', (msg) => {
    try { const { toast } = require('../data/marketDataHelpers'); toast(`WS DEGRADED: ${msg.symbol || '?'} — fallback REST active`, 5000) } catch (_) {}
  })
  on('market.recovered', (msg) => {
    try { const { toast } = require('../data/marketDataHelpers'); toast(`WS RECOVERED: ${msg.symbol || '?'} — live stream restored`, 3000) } catch (_) {}
  })
}

export function on(type: string, fn: MarketHandler): () => void {
  if (!_handlers.has(type)) _handlers.set(type, new Set())
  _handlers.get(type)!.add(fn)
  return () => { _handlers.get(type)?.delete(fn) }
}

export function off(type: string, fn: MarketHandler) {
  _handlers.get(type)?.delete(fn)
}

export function subscribeSymbol(symbol: string, timeframes?: string[]) {
  wsSend({ type: 'market.subscribe', symbol: symbol.toUpperCase(), timeframes })
}

export function unsubscribeSymbol(symbol: string) {
  wsSend({ type: 'market.unsubscribe', symbol: symbol.toUpperCase() })
}

// [2026-11-21] Abonarea la lista de sus (ETH, SOL, BNB, XRP) se PIERDEA: `send()` arunca mesajul daca soclul
// nu e inca deschis (caseta se monteaza inainte), iar la reconectare (revenire din fundal) nu se retrimitea.
// Jurnalul serverului: „wss clients: 2, subs: 0". Casetele aratau „—" pana la urmatoarea difuzare (≤10 s).
// Acum: reincercam pana trece, si retrimitem la fiecare reconectare — serverul raspunde imediat cu
// ultimele preturi (subscribe → _sendCachedValues).
let _wlSyms: string[] = []
let _wlRetry: ReturnType<typeof setInterval> | null = null
let _wlReconnectHooked = false
function _sendWl(): boolean {
  return _wlSyms.length > 0 && wsSend({ type: 'market.subscribe.wl', symbols: _wlSyms }) === true
}
export function subscribeWatchlist(symbols: string[]) {
  _wlSyms = symbols.map(s => s.toUpperCase())
  if (!_wlReconnectHooked) {
    _wlReconnectHooked = true
    wsSubscribe((msg: any) => { if (msg && msg.type === 'reconnect') _sendWl() })
  }
  if (_sendWl()) return
  if (_wlRetry) clearInterval(_wlRetry)
  let tries = 0
  _wlRetry = setInterval(() => {
    tries++
    if (_sendWl() || tries >= 60) { if (_wlRetry) clearInterval(_wlRetry); _wlRetry = null }
  }, 1000)
}
export function _resetWlForTest() { _wlSyms = []; if (_wlRetry) clearInterval(_wlRetry); _wlRetry = null; _wlReconnectHooked = false }
