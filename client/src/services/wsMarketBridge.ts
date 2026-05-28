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

export function subscribeWatchlist(symbols: string[]) {
  wsSend({ type: 'market.subscribe.wl', symbols: symbols.map(s => s.toUpperCase()) })
}
