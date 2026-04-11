// Zeus — trading/liveApi.ts
// Ported 1:1 from public/js/trading/liveApi.js (Phase 6B)
// Live exchange API proxy functions

import { fmtNow } from '../data/marketDataHelpers'

const w = window as any

const _LIVE_API_BASE = ''  // Same origin
let _LIVE_API_TOKEN = '' // Set from UI config panel or env

// Set the auth token (called from config/bootstrap)
export function liveApiSetToken(token: any): void { _LIVE_API_TOKEN = token || '' }

// Build headers with auth
export function _liveApiHeaders(extra?: any): any {
  var h = Object.assign({ 'Content-Type': 'application/json' }, extra || {})
  if (_LIVE_API_TOKEN) h['Authorization'] = 'Bearer ' + _LIVE_API_TOKEN
  return h
}

// Generate unique idempotency key for mutation requests [S3B2] crypto-grade entropy
export function _idempotencyKey(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  // Fallback for older browsers — still 128-bit via getRandomValues
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    var a = new Uint8Array(16)
    crypto.getRandomValues(a)
    return Array.from(a, function (b: number) { return b.toString(16).padStart(2, '0') }).join('')
  }
  return Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 9)
}

// Fetch with 15s timeout — prevents UI freeze if server hangs
export function _liveApiFetch(url: string, opts?: any): Promise<Response> {
  var _opts = Object.assign({}, opts || {})
  if (typeof AbortSignal !== 'undefined' && (AbortSignal as any).timeout) {
    _opts.signal = (AbortSignal as any).timeout(15000)
  }
  return fetch(url, _opts)
}

// ─── Error handler — user-facing toast + atLog for all backend failures ───
export function _liveApiError(err: any, context?: string): void {
  const msg = (err && err.message) ? err.message : String(err)
  const prefix = context ? ('[' + context + '] ') : ''
  // User-visible alerts
  if (typeof w.toast === 'function') w.toast('LIVE API: ' + prefix + msg)
  if (typeof w.atLog === 'function') w.atLog('warn', '[LIVE] API FAIL: ' + prefix + msg)
  console.error('[liveApi]', context, msg)
}

// ─── Shared response parser — handles 403, 429, 4xx, 5xx consistently ───
export async function _liveApiParse(res: Response, context: string): Promise<any> {
  let data: any
  try { data = await res.json() } catch (_) { data = {} }
  if (!res.ok) {
    let reason = data.error || res.statusText || 'Unknown error'
    if (res.status === 403) reason = reason
    if (res.status === 429) reason = 'Rate limit — asteapta 1 minut'
    if (res.status === 400) reason = 'Validare: ' + reason
    const err: any = new Error(reason)
    err.status = res.status
    _liveApiError(err, context)
    throw err
  }
  return data
}

/**
 * Check server trading status and risk config.
 */
export async function liveApiStatus(): Promise<any> {
  const res = await _liveApiFetch(_LIVE_API_BASE + '/api/status', { headers: _liveApiHeaders() })
  return _liveApiParse(res, 'status')
}

/**
 * Get account balance from exchange (via backend proxy).
 */
export async function liveApiGetBalance(): Promise<any> {
  const res = await _liveApiFetch(_LIVE_API_BASE + '/api/balance', { headers: _liveApiHeaders() })
  return _liveApiParse(res, 'balance')
}

/**
 * Get open positions from exchange (via backend proxy).
 */
export async function liveApiGetPositions(): Promise<any> {
  const res = await _liveApiFetch(_LIVE_API_BASE + '/api/positions', { headers: _liveApiHeaders() })
  return _liveApiParse(res, 'positions')
}

/**
 * Place an order through the backend proxy.
 */
export async function liveApiPlaceOrder(params: any): Promise<any> {
  const res = await _liveApiFetch(_LIVE_API_BASE + '/api/order/place', {
    method: 'POST',
    headers: _liveApiHeaders({ 'x-idempotency-key': _idempotencyKey() }),
    body: JSON.stringify(params),
  })
  const result = await _liveApiParse(res, 'order/place')
  if (typeof w.ZLOG !== 'undefined') w.ZLOG.push('AT', '[LIVE ORDER FILL] ' + (params.symbol || '') + ' ' + (params.side || '') + ' orderId=' + (result.orderId || '') + ' qty=' + (result.executedQty || params.quantity || '') + ' avgPrice=' + (result.avgPrice || ''))
  return result
}

/**
 * Cancel an open order through the backend proxy.
 */
export async function liveApiCancelOrder(symbol: any, orderId: any): Promise<any> {
  const res = await _liveApiFetch(_LIVE_API_BASE + '/api/order/cancel', {
    method: 'POST',
    headers: _liveApiHeaders({ 'x-idempotency-key': _idempotencyKey() }), // [S7]
    body: JSON.stringify({ symbol: symbol, orderId: orderId }),
  })
  return _liveApiParse(res, 'order/cancel')
}

/**
 * Set leverage for a symbol through the backend proxy.
 */
export async function liveApiSetLeverage(symbol: any, leverage: any): Promise<any> {
  const res = await _liveApiFetch(_LIVE_API_BASE + '/api/leverage', {
    method: 'POST',
    headers: _liveApiHeaders(),
    body: JSON.stringify({ symbol: symbol, leverage: leverage }),
  })
  return _liveApiParse(res, 'leverage')
}

/**
 * Close a live position by placing an opposite-side MARKET order.
 */
export async function liveApiClosePosition(pos: any): Promise<any> {
  const closeSide = pos.side === 'LONG' ? 'SELL' : 'BUY'
  const result = await liveApiPlaceOrder({
    symbol: pos.sym,
    side: closeSide,
    type: 'MARKET',
    quantity: String(pos.qty),
    closePosition: true,
  })
  if (typeof w.ZLOG !== 'undefined') w.ZLOG.push('AT', '[LIVE CLOSE CONFIRMED] ' + pos.sym + ' ' + pos.side + ' orderId=' + (result.orderId || ''))
  return result
}

/**
 * Sync live state from backend: balance + positions.
 */
export async function liveApiSyncState(): Promise<any> {
  try {
    const [bal, positions] = await Promise.all([
      liveApiGetBalance(),
      liveApiGetPositions(),
    ])
    // Update balance
    w.TP.liveBalance = bal.totalBalance || 0
    w.TP.liveAvailableBalance = bal.availableBalance || 0
    w.TP.liveUnrealizedPnL = bal.unrealizedPnL || 0
    // [P0-B6] Merge exchange data into existing positions to preserve runtime DSL state
    var _existingById: any = {}
    if (Array.isArray(w.TP.livePositions)) {
      w.TP.livePositions.forEach(function (pos: any) { if (pos && pos.id) _existingById[pos.id] = pos })
    }
    // [FIX C3] Detect positions closed on exchange — account before rebuild
    var _newIds: any = {}
    positions.forEach(function (p: any) { _newIds[p.symbol + '_' + p.side] = true })
    Object.keys(_existingById).forEach(function (eid: string) {
      if (!_newIds[eid]) {
        var gone = _existingById[eid]
        // [FIX SYNC-C1] Before declaring gone, check if exchange still has it by sym+side
        var _goneSymSide = (gone.sym || '') + '_' + (gone.side || '')
        if (_newIds[_goneSymSide]) return // Still on exchange, just different key format
        if (typeof w.ZLOG !== 'undefined') w.ZLOG.push('WARN', '[SYNC] Position gone from exchange: ' + eid, { id: eid, sym: gone.sym, side: gone.side })
        // Clean DSL state for vanished position
        if (typeof w.DSL !== 'undefined' && w.DSL.positions) delete w.DSL.positions[String(gone.id)]
        if (typeof w.DSL !== 'undefined' && w.DSL._attachedIds) w.DSL._attachedIds.delete(String(gone.id))
        // [FIX R6] Journal entry for exchange-closed position
        if (typeof w.addTradeToJournal === 'function') {
          var _exitPrice = (typeof w.getSymPrice === 'function') ? w.getSymPrice(gone) : 0
          if (!_exitPrice || _exitPrice <= 0) _exitPrice = gone.entry
          var _gPnl = (gone.pnl != null && isFinite(gone.pnl)) ? gone.pnl : 0
          w.addTradeToJournal({ id: gone.id, time: fmtNow(), side: gone.side, sym: (gone.sym || '').replace('USDT', ''), entry: gone.entry, exit: _exitPrice, pnl: _gPnl, reason: 'Exchange-closed (sync/fallback)', lev: gone.lev, autoTrade: !!gone.autoTrade, journalEvent: 'CLOSE', openTs: gone.openTs || gone.id, closedAt: Date.now(), mode: 'live' })
        }
      }
    })
    w.TP.livePositions = positions.map(function (p: any) {
      var id = p.symbol + '_' + p.side
      var existing = _existingById[id]
      // [FIX H1] Fallback: match by sym+side when existing pos has different ID
      if (!existing) {
        for (var _ek in _existingById) {
          var _ep = _existingById[_ek]
          if (_ep && _ep.sym === p.symbol && _ep.side === p.side) { existing = _ep; break }
        }
      }
      // Exchange-source fields (always update from reality)
      var _origId = (existing && existing.id) ? existing.id : id
      var fresh: any = {
        id: _origId,
        sym: p.symbol,
        side: p.side,
        size: (p.leverage > 0) ? (p.size * p.entryPrice / p.leverage) : (p.size * p.entryPrice),
        qty: p.size,
        entry: p.entryPrice,
        lev: p.leverage,
        pnl: p.unrealizedPnL,
        liqPrice: p.liquidationPrice || 0,
        isLive: true,
        fromExchange: true,
        mode: 'live',
        openTs: p.updateTime || Date.now(),
      }
      if (existing) {
        // [FIX R7] If ID changed, re-attach DSL state
        if (String(existing.id) !== String(fresh.id) && typeof w.DSL !== 'undefined') {
          if (w.DSL.positions && w.DSL.positions[String(existing.id)]) {
            w.DSL.positions[String(fresh.id)] = w.DSL.positions[String(existing.id)]
            delete w.DSL.positions[String(existing.id)]
          }
          if (w.DSL._attachedIds) {
            w.DSL._attachedIds.delete(String(existing.id))
            w.DSL._attachedIds.add(String(fresh.id))
          }
        }
        // Preserve runtime state from prior sync/open
        var _reclassified = false
        if (!existing.autoTrade && Array.isArray(w._lastServerPositions)) {
          var _nowServerAT = w._lastServerPositions.some(function(sp: any) {
            return sp.symbol === p.symbol && sp.side === p.side && sp.autoTrade !== false
          })
          if (_nowServerAT) _reclassified = true
        }
        fresh.autoTrade = _reclassified ? true : existing.autoTrade
        fresh.controlMode = _reclassified ? 'auto' : (existing.controlMode || 'auto')
        fresh.brainModeAtOpen = _reclassified ? 'auto' : (existing.brainModeAtOpen || 'auto')
        fresh.sourceMode = _reclassified ? 'auto' : (existing.sourceMode || (existing.autoTrade ? 'auto' : 'paper'))
        fresh.sl = existing.sl || null
        fresh.tp = existing.tp || null
        fresh.tpPnl = existing.tpPnl || 0
        fresh.slPnl = existing.slPnl || 0
        fresh.slPct = existing.slPct || 0
        fresh.rr = existing.rr || 0
        fresh.margin = existing.margin || fresh.size
        fresh.originalEntry = existing.originalEntry || fresh.entry
        fresh.originalSize = existing.originalSize || fresh.size
        fresh.originalQty = existing.originalQty || String(fresh.qty || '')
        fresh.addOnCount = existing.addOnCount || 0
        fresh.addOnHistory = existing.addOnHistory || []
        fresh.openTs = existing.openTs || fresh.openTs
        fresh._serverSeq = existing._serverSeq || null
        fresh._serverMode = existing._serverMode || null
        fresh._dsl = existing._dsl || null
        fresh.dslParams = existing.dslParams || {
          openDslPct: 0.50,
          pivotLeftPct: 0.70,
          pivotRightPct: 1.00,
          impulseVPct: 1.30,
        }
        fresh.dslAdaptiveState = existing.dslAdaptiveState || 'calm'
        fresh.dslHistory = existing.dslHistory || []
      } else {
        // New position from exchange
        var _isServerAT = false
        if (Array.isArray(w._lastServerPositions)) {
          _isServerAT = w._lastServerPositions.some(function(sp: any) {
            return sp.symbol === p.symbol && sp.side === p.side && sp.autoTrade !== false
          })
        }
        if (!_isServerAT && Array.isArray(w.TP.livePositions)) {
          var _tpMatch = w.TP.livePositions.find(function(tp: any) {
            return tp.sym === p.symbol && tp.side === p.side && !tp.closed
          })
          if (_tpMatch && _tpMatch.autoTrade) _isServerAT = true
        }
        fresh.autoTrade = _isServerAT
        fresh.controlMode = _isServerAT ? 'auto' : 'user'
        fresh.brainModeAtOpen = _isServerAT ? 'auto' : 'user'
        fresh.sourceMode = _isServerAT ? 'auto' : 'paper'
        fresh.sl = null
        fresh.tp = null
        fresh.tpPnl = 0
        fresh.slPnl = 0
        fresh.slPct = 0
        fresh.rr = 0
        fresh.margin = fresh.size
        fresh.originalEntry = fresh.entry
        fresh.originalSize = fresh.size
        fresh.originalQty = String(fresh.qty || '')
        fresh.addOnCount = 0
        fresh.addOnHistory = []
        fresh.dslParams = {
          openDslPct: 0.50,
          pivotLeftPct: 0.70,
          pivotRightPct: 1.00,
          impulseVPct: 1.30,
        }
        fresh.dslAdaptiveState = 'calm'
        fresh.dslHistory = []
        // [FIX H3] Notify system of new exchange position
        if (typeof w.onPositionOpened === 'function') {
          setTimeout(function () { w.onPositionOpened(fresh, 'exchange-sync') }, 0)
        }
      }
      return fresh
    })
    // Update UI
    if (typeof w.updateLiveBalance === 'function') w.updateLiveBalance()
    if (typeof w.renderLivePositions === 'function') w.renderLivePositions()
    // [9A-5] Notify React after live positions full rebuild
    try { window.dispatchEvent(new CustomEvent('zeus:positionsChanged')) } catch (_) {}
    // [PATCH P2-7] Only log on state change
    var _syncKey = (+bal.totalBalance || 0).toFixed(2) + '|' + positions.length
    if (typeof (liveApiSyncState as any)._prevSnap === 'undefined') (liveApiSyncState as any)._prevSnap = ''
    if (_syncKey !== (liveApiSyncState as any)._prevSnap) {
      ;(liveApiSyncState as any)._prevSnap = _syncKey
      if (typeof w.ZLOG !== 'undefined') w.ZLOG.push('INFO', '[SYNC] balance=$' + (+bal.totalBalance || 0).toFixed(2) + ' positions=' + positions.length)
    }
    return { balance: bal, positions: positions }
  } catch (err) {
    _liveApiError(err, 'syncState')
    return null
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ARES Live Order Adapter
// ═══════════════════════════════════════════════════════════════════════════

var _aresOrderSeq = 0
function _aresClientOrderId(): string {
  _aresOrderSeq = (_aresOrderSeq + 1) % 10000
  return 'ARES_' + Date.now() + '_' + _aresOrderSeq + String(Math.floor(Math.random() * 99)).padStart(2, '0')
}

// [FIX BUG8] AT-specific clientOrderId with AT_ prefix (separate from ARES)
var _atOrderSeq = 0
function _atClientOrderId(): string {
  _atOrderSeq = (_atOrderSeq + 1) % 10000
  return 'AT_' + Date.now() + '_' + _atOrderSeq + String(Math.floor(Math.random() * 99)).padStart(2, '0')
}

/**
 * Place an ARES live market order (entry).
 */
export async function aresPlaceOrder(params: any): Promise<any> {
  const cid = _aresClientOrderId()
  const res = await _liveApiFetch(_LIVE_API_BASE + '/api/order/place', {
    method: 'POST',
    headers: _liveApiHeaders({ 'x-idempotency-key': _idempotencyKey() }),
    body: JSON.stringify({
      symbol: params.symbol,
      side: params.side,
      type: 'MARKET',
      quantity: String(params.quantity),
      leverage: params.leverage,
      newClientOrderId: cid,
      referencePrice: params.referencePrice || 0,
    }),
  })
  const result = await _liveApiParse(res, 'ARES order/place')
  if (typeof w.ZLOG !== 'undefined') w.ZLOG.push('ARES', '[ARES LIVE ORDER] ' + params.symbol + ' ' + params.side + ' qty=' + params.quantity + ' lev=' + params.leverage + 'x orderId=' + (result.orderId || '') + ' cid=' + cid)
  result._aresClientOrderId = cid
  return result
}

/**
 * Set exchange-level SL (STOP_MARKET) for ARES position.
 */
export async function aresSetStopLoss(params: any): Promise<any> {
  const closeSide = params.side === 'BUY' || params.side === 'LONG' ? 'SELL' : 'BUY'
  const cid = _aresClientOrderId()
  const res = await _liveApiFetch(_LIVE_API_BASE + '/api/order/place', {
    method: 'POST',
    headers: _liveApiHeaders({ 'x-idempotency-key': _idempotencyKey() }),
    body: JSON.stringify({
      symbol: params.symbol,
      side: closeSide,
      type: 'STOP_MARKET',
      quantity: String(params.quantity),
      stopPrice: params.stopPrice,
      newClientOrderId: cid,
    }),
  })
  const result = await _liveApiParse(res, 'ARES SL')
  if (typeof w.ZLOG !== 'undefined') w.ZLOG.push('ARES', '[ARES SL SET] ' + params.symbol + ' stopPrice=' + params.stopPrice + ' orderId=' + (result.orderId || ''))
  return result
}

/**
 * Set exchange-level TP (TAKE_PROFIT_MARKET) for ARES position.
 */
export async function aresSetTakeProfit(params: any): Promise<any> {
  const closeSide = params.side === 'BUY' || params.side === 'LONG' ? 'SELL' : 'BUY'
  const cid = _aresClientOrderId()
  const res = await _liveApiFetch(_LIVE_API_BASE + '/api/order/place', {
    method: 'POST',
    headers: _liveApiHeaders({ 'x-idempotency-key': _idempotencyKey() }),
    body: JSON.stringify({
      symbol: params.symbol,
      side: closeSide,
      type: 'TAKE_PROFIT_MARKET',
      quantity: String(params.quantity),
      stopPrice: params.stopPrice,
      newClientOrderId: cid,
    }),
  })
  const result = await _liveApiParse(res, 'ARES TP')
  if (typeof w.ZLOG !== 'undefined') w.ZLOG.push('ARES', '[ARES TP SET] ' + params.symbol + ' stopPrice=' + params.stopPrice + ' orderId=' + (result.orderId || ''))
  return result
}

// [FIX BUG8] AT-specific SL/TP with AT_ prefix
export async function atSetStopLoss(params: any): Promise<any> {
  const closeSide = params.side === 'BUY' || params.side === 'LONG' ? 'SELL' : 'BUY'
  const cid = _atClientOrderId()
  const res = await _liveApiFetch(_LIVE_API_BASE + '/api/order/place', {
    method: 'POST',
    headers: _liveApiHeaders({ 'x-idempotency-key': _idempotencyKey() }),
    body: JSON.stringify({ symbol: params.symbol, side: closeSide, type: 'STOP_MARKET', quantity: String(params.quantity), stopPrice: params.stopPrice, newClientOrderId: cid }),
  })
  return _liveApiParse(res, 'AT SL')
}

export async function atSetTakeProfit(params: any): Promise<any> {
  const closeSide = params.side === 'BUY' || params.side === 'LONG' ? 'SELL' : 'BUY'
  const cid = _atClientOrderId()
  const res = await _liveApiFetch(_LIVE_API_BASE + '/api/order/place', {
    method: 'POST',
    headers: _liveApiHeaders({ 'x-idempotency-key': _idempotencyKey() }),
    body: JSON.stringify({ symbol: params.symbol, side: closeSide, type: 'TAKE_PROFIT_MARKET', quantity: String(params.quantity), stopPrice: params.stopPrice, newClientOrderId: cid }),
  })
  return _liveApiParse(res, 'AT TP')
}

/**
 * Close an ARES position by placing opposite-side MARKET order (reduce-only).
 */
export async function aresClosePosition(pos: any): Promise<any> {
  const closeSide = pos.side === 'LONG' ? 'SELL' : 'BUY'
  const cid = _aresClientOrderId()
  const res = await _liveApiFetch(_LIVE_API_BASE + '/api/order/place', {
    method: 'POST',
    headers: _liveApiHeaders({ 'x-idempotency-key': _idempotencyKey() }),
    body: JSON.stringify({
      symbol: pos.symbol || pos.sym,
      side: closeSide,
      type: 'MARKET',
      quantity: String(pos.qty),
      newClientOrderId: cid,
      closePosition: true,
    }),
  })
  const result = await _liveApiParse(res, 'ARES close')
  if (typeof w.ZLOG !== 'undefined') w.ZLOG.push('ARES', '[ARES CLOSE] ' + (pos.symbol || pos.sym) + ' ' + pos.side + ' qty=' + pos.qty + ' orderId=' + (result.orderId || ''))
  return result
}

/**
 * Cancel exchange-level SL/TP orders for ARES position.
 */
export async function aresCancelOrder(symbol: any, orderId: any): Promise<any> {
  return liveApiCancelOrder(symbol, orderId)
}

// ═══════════════════════════════════════════════════════════════════════════
// MANUAL LIVE TRADING
// ═══════════════════════════════════════════════════════════════════════════

var _manualOrderSeq = 0
function _manualClientOrderId(): string {
  _manualOrderSeq = (_manualOrderSeq + 1) % 10000
  return 'MANUAL_' + Date.now() + '_' + _manualOrderSeq + String(Math.floor(Math.random() * 99)).padStart(2, '0')
}

/**
 * Place a manual live order (MARKET or LIMIT) on Binance.
 */
export async function manualLivePlaceOrder(params: any): Promise<any> {
  var cid = _manualClientOrderId()
  var body: any = {
    symbol: params.symbol,
    side: params.side,
    type: params.type || 'MARKET',
    quantity: String(params.quantity),
    newClientOrderId: cid,
  }
  if (params.leverage) body.leverage = params.leverage
  if (params.type === 'LIMIT' && params.price) {
    body.price = params.price
  }
  if (params.referencePrice) body.referencePrice = params.referencePrice
  var res = await _liveApiFetch(_LIVE_API_BASE + '/api/order/place', {
    method: 'POST',
    headers: _liveApiHeaders({ 'x-idempotency-key': _idempotencyKey() }),
    body: JSON.stringify(body),
  })
  var result = await _liveApiParse(res, 'manual order/place')
  if (typeof w.ZLOG !== 'undefined') w.ZLOG.push('MANUAL', '[MANUAL LIVE ORDER] ' + params.symbol + ' ' + params.side + ' ' + (params.type || 'MARKET') + ' qty=' + params.quantity + ' orderId=' + (result.orderId || '') + ' cid=' + cid)
  result._manualClientOrderId = cid
  return result
}

/**
 * Get open orders from Binance for manual trading (per-user).
 */
export async function manualLiveGetOpenOrders(symbol?: string): Promise<any> {
  var url = _LIVE_API_BASE + '/api/openOrders'
  if (symbol) url += '?symbol=' + encodeURIComponent(symbol)
  var res = await _liveApiFetch(url, { headers: _liveApiHeaders() })
  return _liveApiParse(res, 'openOrders')
}

/**
 * Cancel a manual live order on Binance.
 */
export async function manualLiveCancelOrder(symbol: any, orderId: any): Promise<any> {
  return liveApiCancelOrder(symbol, orderId)
}

/**
 * Modify a manual live LIMIT order: cancel + replace with new price.
 */
export async function manualLiveModifyLimit(symbol: any, orderId: any, newPrice: any, side: any): Promise<any> {
  var cid = _manualClientOrderId()
  var res = await _liveApiFetch(_LIVE_API_BASE + '/api/order/modify', {
    method: 'POST',
    headers: _liveApiHeaders(),
    body: JSON.stringify({ symbol: symbol, orderId: orderId, newPrice: newPrice, side: side, newClientOrderId: cid }),
  })
  var result = await _liveApiParse(res, 'order/modify')
  if (typeof w.ZLOG !== 'undefined') w.ZLOG.push('MANUAL', '[MANUAL MODIFY LIMIT] ' + symbol + ' old=' + orderId + ' new=' + (result.orderId || '') + ' price=' + newPrice)
  return result
}

/**
 * Set or update SL (STOP_MARKET) for a manual live position.
 */
export async function manualLiveSetSL(params: any): Promise<any> {
  var closeSide = (params.side === 'BUY' || params.side === 'LONG') ? 'SELL' : 'BUY'
  var cid = _manualClientOrderId()
  var res = await _liveApiFetch(_LIVE_API_BASE + '/api/manual/protection', {
    method: 'POST',
    headers: _liveApiHeaders(),
    body: JSON.stringify({
      symbol: params.symbol,
      side: closeSide,
      type: 'STOP_MARKET',
      quantity: String(params.quantity),
      stopPrice: params.stopPrice,
      cancelOrderId: params.cancelOrderId || undefined,
      newClientOrderId: cid,
    }),
  })
  var result = await _liveApiParse(res, 'manual SL')
  if (typeof w.ZLOG !== 'undefined') w.ZLOG.push('MANUAL', '[MANUAL SL SET] ' + params.symbol + ' stopPrice=' + params.stopPrice + ' orderId=' + (result.orderId || ''))
  return result
}

/**
 * Set or update TP (TAKE_PROFIT_MARKET) for a manual live position.
 */
export async function manualLiveSetTP(params: any): Promise<any> {
  var closeSide = (params.side === 'BUY' || params.side === 'LONG') ? 'SELL' : 'BUY'
  var cid = _manualClientOrderId()
  var res = await _liveApiFetch(_LIVE_API_BASE + '/api/manual/protection', {
    method: 'POST',
    headers: _liveApiHeaders(),
    body: JSON.stringify({
      symbol: params.symbol,
      side: closeSide,
      type: 'TAKE_PROFIT_MARKET',
      quantity: String(params.quantity),
      stopPrice: params.stopPrice,
      cancelOrderId: params.cancelOrderId || undefined,
      newClientOrderId: cid,
    }),
  })
  var result = await _liveApiParse(res, 'manual TP')
  if (typeof w.ZLOG !== 'undefined') w.ZLOG.push('MANUAL', '[MANUAL TP SET] ' + params.symbol + ' stopPrice=' + params.stopPrice + ' orderId=' + (result.orderId || ''))
  return result
}
