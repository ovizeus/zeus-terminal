// Zeus — data/marketDataPositions.ts
// Ported 1:1 from public/js/data/marketData.js lines 2662-3361 (Chunk F)
// Pending orders, SL/TP edit, render positions, closeLivePos

import { AT } from '../engine/events'
import { TP } from '../core/state'
import { BM, DSL } from '../core/config'
import { fmtNow, toast } from './marketDataHelpers'
import { fP } from '../utils/format'
import { el } from '../utils/dom'
import { manualLiveModifyLimit, liveApiClosePosition, manualLiveGetOpenOrders, manualLiveCancelOrder, manualLiveSetSL, manualLiveSetTP } from '../trading/liveApi'
import { calcLiqPrice } from './marketDataTrading'
import { renderTradeMarkers } from './marketDataOverlays'
import { usePositionsStore } from '../stores/positionsStore'
import { api } from '../services/api'
import { onPositionOpened } from '../trading/positions'
import { addTradeToJournal } from '../services/storage'
import { liveApiSyncState } from '../trading/liveApi'
import { atLog } from '../trading/autotrade'
import { _safePnl } from '../utils/guards'
import { closeDemoPos } from './marketDataClose'
const w = window as any // kept for w.S (klines/mode/feeRate SKIP), w.ZState, w.ARES, fn calls

function _numOrDefault(val: any, fallback: number): number { const n = parseFloat(val); return Number.isFinite(n) ? n : fallback }

// getSymPrice — full version with staleness check
export function getSymPrice(pos: any): number | null {
  if (w.allPrices[pos.sym] && w.allPrices[pos.sym] > 0) return w.allPrices[pos.sym]
  const wlEntry = w.wlPrices[pos.sym] || w.wlPrices[pos.sym?.toUpperCase()]
  if (wlEntry?.price && wlEntry.price > 0) {
    const age = wlEntry.ts ? (Date.now() - wlEntry.ts) : 0
    if (age < 30000) return wlEntry.price
    console.warn('[getSymPrice] Stale price for', pos.sym, 'age:', Math.round(age / 1000) + 's')
    return null
  }
  const k = w.S.klines?.[pos.sym]
  if (k && k.length) return k[k.length - 1].close
  return null
}

// ═══════════════════════════════════════════════════════════════
// PENDING ORDERS ENGINE
// ═══════════════════════════════════════════════════════════════
export function checkPendingOrders(): void {
  if (!TP.pendingOrders || !TP.pendingOrders.length) return
  const toFill: any[] = []
  TP.pendingOrders.forEach(function (ord: any) {
    if (ord.status !== 'WAITING' || ord.mode !== 'demo') return
    const cur = getSymPrice(ord) || (w.allPrices[ord.sym] ? w.allPrices[ord.sym] : null)
    if (!cur || cur <= 0) return
    let filled = false
    if (ord.side === 'LONG' && cur <= ord.limitPrice) filled = true
    if (ord.side === 'SHORT' && cur >= ord.limitPrice) filled = true
    if (filled) toFill.push(ord)
  })
  toFill.forEach(function (ord: any) { _fillDemoPendingOrder(ord) })
}

function _fillDemoPendingOrder(ord: any): void {
  ord.status = 'FILLED'; ord.filledAt = Date.now()
  const idx = TP.pendingOrders.indexOf(ord); if (idx >= 0) TP.pendingOrders.splice(idx, 1)
  const liqPrice = calcLiqPrice(ord.limitPrice, ord.lev, ord.side)
  const pos: any = {
    id: ord.id, side: ord.side, sym: ord.sym, entry: ord.limitPrice, size: ord.size, lev: ord.lev, tp: ord.tp, sl: ord.sl, liqPrice, pnl: 0,
    mode: 'demo', orderType: 'LIMIT', sourceMode: 'paper', controlMode: 'paper', brainModeAtOpen: (w.S.mode || 'assist'),
    dslParams: (() => {
      // [DSL-OFF] If DSL engine is OFF at fill time, do NOT attach DSL. Server skips DSL + places native TP/SL.
      if (!DSL.enabled) return null
      // [MANUAL DSL] Manual limit positions use user-set DSL inputs directly — no Brain.
      const _openDsl = _numOrDefault(el('dslActivatePct')?.value, 0.50)
      const _pl = _numOrDefault(el('dslTrailPct')?.value, 0.60)
      const _pr = _numOrDefault(el('dslTrailSusPct')?.value, 0.50)
      const _iv = _numOrDefault(el('dslExtendPct')?.value, 0.25)
      const _tgt = ord.side === 'LONG' ? ord.limitPrice * (1 + _openDsl / 100) : ord.limitPrice * (1 - _openDsl / 100)
      return { openDslPct: _openDsl, pivotLeftPct: _pl, pivotRightPct: _pr, impulseVPct: _iv, dslTargetPrice: _tgt }
    })(),
    dslAdaptiveState: 'calm', dslHistory: [], openTs: Date.now(), filledAt: Date.now(), createdAt: ord.createdAt,
  }
  if (TP.demoPositions.some((p: any) => p.id === pos.id)) return
  TP.demoPositions.push(pos)
  w.updateDemoBalance(); renderDemoPositions(); renderPendingOrders()
  if (typeof onPositionOpened === 'function') onPositionOpened(pos, 'manual_demo_limit_fill')
  w.ZState.save(); if (typeof w._registerManualOnServer === 'function') w._registerManualOnServer(pos)
  try { window.dispatchEvent(new CustomEvent('zeus:positionsChanged')) } catch (_) {}
  if (typeof renderTradeMarkers === 'function') renderTradeMarkers()
  toast('LIMIT FILLED: ' + ord.side + ' ' + ord.sym.replace('USDT', '') + ' @$' + fP(ord.limitPrice))
  addTradeToJournal({ id: pos.id, time: fmtNow(), side: pos.side, sym: pos.sym.replace('USDT', ''), entry: pos.entry, exit: null, pnl: 0, reason: 'LIMIT Fill', lev: pos.lev, autoTrade: false, journalEvent: 'OPEN', orderType: 'LIMIT', mode: 'demo', openTs: pos.openTs, createdAt: ord.createdAt, filledAt: pos.filledAt })
}

export function cancelPendingOrder(id: any): void {
  const strId = String(id)
  const idx = TP.pendingOrders.findIndex(function (o: any) { return String(o.id) === strId })
  if (idx >= 0) { const ord = TP.pendingOrders[idx]; if (ord.mode === 'demo') { TP.demoBalance += ord.size; w.updateDemoBalance() }; TP.pendingOrders.splice(idx, 1); renderPendingOrders(); w.ZState.save(); toast('Pending LIMIT cancelled'); return }
  const liveIdx = TP.manualLivePending.findIndex(function (o: any) { return String(o.id) === strId || String(o.exchangeOrderId) === strId })
  if (liveIdx >= 0) { const liveOrd = TP.manualLivePending[liveIdx]; if (liveOrd.exchangeOrderId) { manualLiveCancelOrder(liveOrd.sym, liveOrd.exchangeOrderId).then(function () { TP.manualLivePending.splice(liveIdx, 1); renderPendingOrders(); w.ZState.save(); toast('LIVE LIMIT cancelled') }).catch(function (err: any) { toast('Cancel failed: ' + (err.message || err)) }) } }
}

export function modifyPendingPrice(id: any): void {
  const strId = String(id)
  const demoOrd = (TP.pendingOrders || []).find(function (o: any) { return String(o.id) === strId })
  if (demoOrd && demoOrd.mode === 'demo') { const newPrice = prompt('New limit price:', fP(demoOrd.limitPrice)); if (!newPrice) return; const np = parseFloat(newPrice); if (!Number.isFinite(np) || np <= 0) { toast('Invalid price'); return }; demoOrd.limitPrice = np; renderPendingOrders(); w.ZState.save(); toast('Limit price updated to $' + fP(np)); return }
  const liveOrd = TP.manualLivePending.find(function (o: any) { return String(o.id) === strId || String(o.exchangeOrderId) === strId })
  if (liveOrd && liveOrd.exchangeOrderId) { const _newPrice = prompt('New limit price:', fP(liveOrd.limitPrice)); if (!_newPrice) return; const _np = parseFloat(_newPrice); if (!Number.isFinite(_np) || _np <= 0) { toast('Invalid price'); return }; if (typeof manualLiveModifyLimit !== 'function') { toast('Live API not available'); return }; manualLiveModifyLimit(liveOrd.sym, liveOrd.exchangeOrderId, _np, liveOrd.binanceSide).then(function (res: any) { liveOrd.exchangeOrderId = res.orderId; liveOrd.id = res.orderId; liveOrd.limitPrice = _np; renderPendingOrders(); w.ZState.save(); toast('LIVE LIMIT modified @$' + fP(_np)) }).catch(function (err: any) { toast('Modify failed: ' + (err.message || err)); renderPendingOrders() }) }
}

// ═══════════════════════════════════════════════════════════════
// RENDER PENDING ORDERS
// ═══════════════════════════════════════════════════════════════
// [R9] Pending orders render = store patch (React component renders rows).
// TP.pendingOrders + TP.manualLivePending remain the source arrays; this
// function simply publishes them into positionsStore so the React
// <PendingOrderRow> list stays in sync.
export function renderPendingOrders(): void {
  try {
    const pending = Array.isArray(TP.pendingOrders) ? TP.pendingOrders.slice() : []
    const livePending = Array.isArray(TP.manualLivePending) ? TP.manualLivePending.slice() : []
    usePositionsStore.getState().setPendingOrders(pending)
    usePositionsStore.getState().setManualLivePending(livePending)
  } catch (_) { /* ignore */ }
}

// ═══════════════════════════════════════════════════════════════
// LIVE PENDING SYNC
// ═══════════════════════════════════════════════════════════════
let _livePendingSyncTimer: any = null
export function _startLivePendingSync(): void { if (_livePendingSyncTimer) return; _livePendingSyncTimer = setInterval(_syncLivePendingOrders, 5000); setTimeout(_syncLivePendingOrders, 500) }
export function _stopLivePendingSync(): void { if (_livePendingSyncTimer) { clearInterval(_livePendingSyncTimer); _livePendingSyncTimer = null } }

function _syncLivePendingOrders(): void {
  if (!TP.manualLivePending || !TP.manualLivePending.length) { _stopLivePendingSync(); return }
  if (typeof manualLiveGetOpenOrders !== 'function') return
  const symbols: any = {}; TP.manualLivePending.forEach(function (o: any) { symbols[o.sym] = true })
  const symList = Object.keys(symbols)
  Promise.allSettled(symList.map(function (sym) { return manualLiveGetOpenOrders(sym) })).then(function (results) {
    const anyFailed = results.some(function (r) { return r.status === 'rejected' })
    if (anyFailed) return // BUG#4 fix: don't reconcile on API errors — stale tracking is safer than false removal
    const _exchangeOrderIds = new Set<string>()
    results.forEach(function (r: any) { (r.value || []).forEach(function (o: any) { _exchangeOrderIds.add(String(o.orderId)) }) })
    _reconcileLivePending(_exchangeOrderIds)
  })
}

function _reconcileLivePending(exchangeOrderIds: Set<string>): void {
  const toRemove: any[] = []; TP.manualLivePending.forEach(function (ord: any) { if (!exchangeOrderIds.has(String(ord.exchangeOrderId))) toRemove.push(ord) })
  if (!toRemove.length) return
  toRemove.forEach(function (ord: any) {
    const idx = TP.manualLivePending.indexOf(ord); if (idx >= 0) TP.manualLivePending.splice(idx, 1)
    ord.status = 'FILLED'; ord.filledAt = Date.now()
    toast('LIVE LIMIT FILLED: ' + ord.side + ' @$' + fP(ord.limitPrice))
    if (ord.tp) { const _qty = ord.qty || ((ord.size * ord.lev) / ord.limitPrice); manualLiveSetTP({ symbol: ord.sym, side: ord.side, quantity: _qty.toFixed(8), stopPrice: ord.tp }).catch(function (e: any) { toast('TP failed: ' + (e.message || e)) }) }
    if (ord.sl) { const _qty2 = ord.qty || ((ord.size * ord.lev) / ord.limitPrice); manualLiveSetSL({ symbol: ord.sym, side: ord.side, quantity: _qty2.toFixed(8), stopPrice: ord.sl }).catch(function (e: any) { toast('SL failed: ' + (e.message || e)) }) }
    addTradeToJournal({ id: ord.id, time: fmtNow(), side: ord.side, sym: (ord.sym || '').replace('USDT', ''), entry: ord.limitPrice, exit: null, pnl: 0, reason: 'LIVE LIMIT Fill', lev: ord.lev, autoTrade: false, journalEvent: 'OPEN', orderType: 'LIMIT', mode: 'live', isLive: true, openTs: Date.now(), createdAt: ord.createdAt, filledAt: Date.now() })
  })
  if (typeof liveApiSyncState === 'function') setTimeout(liveApiSyncState, 500)
  renderPendingOrders(); w.ZState.save()
  if (!TP.manualLivePending.length) _stopLivePendingSync()
}

export function _resumeLivePendingSyncIfNeeded(): void { if (TP.manualLivePending && TP.manualLivePending.length > 0) _startLivePendingSync() }

// ═══════════════════════════════════════════════════════════════
// SL/TP EDITING
// ═══════════════════════════════════════════════════════════════
export function savePosSLTP(posId: any, mode: string): void {
  const strId = String(posId); const slInput = el('slEdit_' + strId); const tpInput = el('tpEdit_' + strId)
  const newSL = slInput ? parseFloat(slInput.value) || null : null; const newTP = tpInput ? parseFloat(tpInput.value) || null : null
  if (mode === 'demo') {
    const pos = TP.demoPositions.find(function (p: any) { return String(p.id) === strId }); if (!pos) { toast('Position not found'); return }
    if (newSL) { if (pos.side === 'LONG' && newSL >= pos.entry) { toast('LONG SL must be below entry'); return }; if (pos.side === 'SHORT' && newSL <= pos.entry) { toast('SHORT SL must be above entry'); return } }
    if (newTP) { if (pos.side === 'LONG' && newTP <= pos.entry) { toast('LONG TP must be above entry'); return }; if (pos.side === 'SHORT' && newTP >= pos.entry) { toast('SHORT TP must be below entry'); return } }
    pos.sl = newSL; pos.tp = newTP; renderDemoPositions(); w.ZState.save(); toast('SL/TP updated')
  } else if (mode === 'live') {
    const livePos = TP.livePositions.find(function (p: any) { return String(p.id) === strId }); if (!livePos) { toast('Position not found'); return }
    const _qty = livePos.qty || livePos.size
    if (newSL) { if (livePos.side === 'LONG' && newSL >= livePos.entry) { toast('LONG SL must be below entry'); return }; if (livePos.side === 'SHORT' && newSL <= livePos.entry) { toast('SHORT SL must be above entry'); return } }
    if (newTP) { if (livePos.side === 'LONG' && newTP <= livePos.entry) { toast('LONG TP must be above entry'); return }; if (livePos.side === 'SHORT' && newTP >= livePos.entry) { toast('SHORT TP must be below entry'); return } }
    const promises: Promise<any>[] = []
    if (newSL) { promises.push(manualLiveSetSL({ symbol: livePos.sym, side: livePos.side, quantity: String(_qty), stopPrice: newSL, cancelOrderId: livePos._slOrderId || undefined }).then(function (res: any) { livePos._slOrderId = res.orderId; livePos.sl = newSL })) } else if (livePos._slOrderId) { promises.push(manualLiveCancelOrder(livePos.sym, livePos._slOrderId).then(function () { livePos._slOrderId = null; livePos.sl = null }).catch(function () { })) }
    if (newTP) { promises.push(manualLiveSetTP({ symbol: livePos.sym, side: livePos.side, quantity: String(_qty), stopPrice: newTP, cancelOrderId: livePos._tpOrderId || undefined }).then(function (res: any) { livePos._tpOrderId = res.orderId; livePos.tp = newTP })) } else if (livePos._tpOrderId) { promises.push(manualLiveCancelOrder(livePos.sym, livePos._tpOrderId).then(function () { livePos._tpOrderId = null; livePos.tp = null }).catch(function () { })) }
    Promise.allSettled(promises).then(function (results: any[]) { const failed = results.filter(function (r: any) { return r.status === 'rejected' }); if (failed.length === 0) { toast('LIVE SL/TP updated') } else { toast('Partial update — ' + failed.length + ' failed, verifică exchange') }; renderLivePositions() })
  }
}

// ═══════════════════════════════════════════════════════════════
// CHECK DEMO POSITIONS SL/TP
// ═══════════════════════════════════════════════════════════════
export function checkDemoPositionsSLTP(): void {
  if (!TP.demoPositions.length) return
  const toClose: any[] = []
  TP.demoPositions.forEach((pos: any) => {
    if (pos.closed) return; if (pos.autoTrade) return
    const curPrice = getSymPrice(pos); if (!curPrice || !Number.isFinite(curPrice) || curPrice <= 0) return
    let reason: string | null = null
    if (pos.side === 'LONG') { if (pos.tp && curPrice >= pos.tp) reason = 'TP HIT'; else if (pos.sl && curPrice <= pos.sl) reason = 'SL HIT'; else if (pos.liqPrice && curPrice <= pos.liqPrice) reason = 'LIQUIDATED' }
    else { if (pos.tp && curPrice <= pos.tp) reason = 'TP HIT'; else if (pos.sl && curPrice >= pos.sl) reason = 'SL HIT'; else if (pos.liqPrice && curPrice >= pos.liqPrice) reason = 'LIQUIDATED' }
    if (reason) toClose.push({ id: pos.id, reason })
  })
  toClose.forEach(({ id, reason }: any) => closeDemoPos(id, reason))
}

// ═══════════════════════════════════════════════════════════════
// RENDER DEMO POSITIONS
// ═══════════════════════════════════════════════════════════════
// [R9] Demo positions render = store patch. React <DemoPositionRow>
// components in ManualTradePanel filter + render rows from
// `positionsStore.demoPositions`. We still mutate `pos.pnl` in the
// loop below because stats + existing call-sites read it.
let _lastRenderDemo = 0
let _pendingRenderDemo: any = 0
export function renderDemoPositions(): void {
  const _now = Date.now()
  if (_now - _lastRenderDemo < 500) { if (!_pendingRenderDemo) _pendingRenderDemo = setTimeout(renderDemoPositions, 500 - (_now - _lastRenderDemo)); return }
  _lastRenderDemo = _now; _pendingRenderDemo = 0

  const _gMode = (typeof AT !== 'undefined' && AT._serverMode) ? AT._serverMode : 'demo'
  const manualPos = TP.demoPositions.filter((p: any) => !p.closed && !p.autoTrade && (p.mode || 'demo') === _gMode)
  let totalPnL = 0
  manualPos.forEach((pos: any) => {
    const curPrice = getSymPrice(pos)
    if (!curPrice || !Number.isFinite(curPrice) || curPrice <= 0) { pos.pnl = 0; return }
    const diff = curPrice - pos.entry
    pos.pnl = _safePnl(pos.side, diff, pos.entry, pos.size, pos.lev, true)
    totalPnL += pos.pnl
  })

  usePositionsStore.getState().setDemoPositions(TP.demoPositions.slice())

  // Stats
  let _statsWins = 0, _statsLosses = 0, _statsPnl = 0, _statsTrades = 0
  if (_gMode === 'live') {
    const _openManualLive = (TP.livePositions || []).filter(function (p: any) { return !p.closed && !p.autoTrade })
    _openManualLive.forEach(function (p: any) { const _cur = getSymPrice(p); const _pnl = (_cur && _cur > 0) ? calcPosPnL(p, _cur) : (Number.isFinite(p.pnl) ? p.pnl : 0); _statsPnl += _pnl })
    const _jManualLive = (Array.isArray(TP.journal) ? TP.journal : []).filter(function (j: any) { return j.mode === 'live' && !j.autoTrade })
    _jManualLive.forEach(function (j: any) { const _jp = Number(j.pnl) || 0; _statsPnl += _jp; if (_jp >= 0) _statsWins++; else _statsLosses++ })
    _statsTrades = _openManualLive.length + _jManualLive.length
  } else { _statsWins = TP.demoWins || 0; _statsLosses = TP.demoLosses || 0; _statsPnl = totalPnL; _statsTrades = _statsWins + _statsLosses }
  const _pnlClass = _statsPnl > 0 ? 'pos' : _statsPnl < 0 ? 'neg' : 'neut'
  const _wrText = _statsTrades ? Math.round(_statsWins / _statsTrades * 100) + '%' : '0%'
  usePositionsStore.getState().setManualStats(_statsPnl, _pnlClass, _wrText, _statsTrades)
}

export function calcPosPnL(pos: any, cur: any): number { return _safePnl(pos.side, cur, pos.entry, pos.size, pos.lev, false) }

export function updateLiveBalance(): void {
  const balEl = el('liveBalanceAmt') || el('demoBalanceAmt')
  if (balEl && TP.liveBalance) balEl.textContent = '$' + Number(TP.liveBalance).toFixed(2)
  const pnlEl = el('liveUnrealizedPnl')
  if (pnlEl && typeof TP.liveUnrealizedPnL === 'number') pnlEl.textContent = (TP.liveUnrealizedPnL >= 0 ? '+' : '') + '$' + TP.liveUnrealizedPnL.toFixed(2)
}

// [R9] Live positions render = store patch. React <LivePositionRow>
// components in ManualTradePanel filter + render. Mode visibility
// (`livePositionsInDemo` display) is handled reactively in the panel.
export function renderLivePositions(): void {
  // Refresh pnl on each open position so stats readers see current values.
  (TP.livePositions || []).forEach(function (pos: any) {
    if (pos.closed || pos.autoTrade) return
    const cur = getSymPrice(pos)
    if (!cur || !Number.isFinite(cur) || cur <= 0) { if (!pos.fromExchange) pos.pnl = 0; return }
    if (!pos.fromExchange) pos.pnl = calcPosPnL(pos, cur)
  })
  usePositionsStore.getState().setLivePositions(TP.livePositions.slice())
}

// closeLivePos — included here since it's tightly coupled with renderLivePositions
export function closeLivePos(id: any, reason?: string): void {
  const strId = String(id); const idx = TP.livePositions.findIndex((p: any) => String(p.id) === strId); if (idx < 0) return
  const pos = TP.livePositions[idx]; if (pos.status === 'closing' || pos.closed) return
  // [R1] Server-managed position close — unconditional when _serverSeq exists (symmetry with closeDemoPos)
  if (pos._serverSeq) {
    if (typeof w._zeusRequestServerClose === 'function') w._zeusRequestServerClose(pos._serverSeq, pos.id)
    const _closeSeq = pos._serverSeq
    const _closeId = pos.id
    const _doServerClose = function (attempt: number) {
      api.raw<any>('POST', '/api/at/close', { seq: _closeSeq })
        .then(function (d: any) {
          if (d && d.ok && typeof w._zeusConfirmServerClose === 'function') w._zeusConfirmServerClose(_closeSeq)
        })
        .catch(function (err: any) {
          if (attempt < 2) {
            setTimeout(function () { _doServerClose(attempt + 1) }, 2000 * attempt)
          } else {
            w._zeusCloseFailedSeqs = w._zeusCloseFailedSeqs || []
            w._zeusCloseFailedSeqs.push({ seq: _closeSeq, id: _closeId, ts: Date.now() })
          }
        })
    }
    _doServerClose(1)
  }
  if (typeof w.Intervals !== 'undefined' && w.Intervals.clear) w.Intervals.clear('posCheck_' + pos.id)
  const cur = getSymPrice(pos) || pos.entry; const pnl = (cur && Number.isFinite(cur) && cur > 0) ? calcPosPnL(pos, cur) : 0; pos.pnl = pnl; pos.status = 'closing'
  atLog('info', '[LIVE] CLOSING: ' + pos.side + ' ' + pos.sym + ' PnL: ' + (pnl >= 0 ? '+' : '') + '$' + pnl.toFixed(2))
  renderLivePositions()
  if (typeof liveApiClosePosition === 'function') {
    liveApiClosePosition(pos).then(function (res: any) {
      pos.closed = true; pos.status = 'closed'
      const fillPrice = (res && parseFloat(res.avgPrice)) || cur; const fillPnl = calcPosPnL(pos, fillPrice); pos.pnl = fillPnl
      // Restore margin + PnL to live balance (1:1 with closeDemoPos line 51)
      TP.liveBalance = (TP.liveBalance || 0) + pos.size + fillPnl
      if (TP.liveBalance < 0) TP.liveBalance = 0
      { const s = usePositionsStore.getState(); usePositionsStore.getState().setLiveBalance({ ...s.liveBalance, totalBalance: TP.liveBalance }) }
      const finalIdx = TP.livePositions.findIndex((p: any) => p.id === pos.id); if (finalIdx >= 0) TP.livePositions.splice(finalIdx, 1)
      if (typeof addTradeToJournal === 'function') addTradeToJournal({ id: pos.id, time: fmtNow(), side: pos.side, sym: pos.sym || '', entry: pos.entry, exit: fillPrice, size: pos.size, pnl: fillPnl, reason: reason || 'Manual', lev: pos.lev, autoTrade: !!pos.autoTrade, journalEvent: 'CLOSE', regime: (typeof BM !== 'undefined' ? BM.regime || '\u2014' : '\u2014'), isLive: true, openTs: pos.openTs || pos.id, closedAt: Date.now(), mode: 'live' })
      if (typeof DSL !== 'undefined') { delete DSL.positions[String(pos.id)]; if (DSL._attachedIds) DSL._attachedIds.delete(String(pos.id)) }
      atLog('info', '[LIVE] CLOSE CONFIRMED: ' + pos.sym + ' fillPrice=' + fillPrice)
      renderLivePositions()
      // [9A-5] Notify React — live position closed
      try { window.dispatchEvent(new CustomEvent('zeus:positionsChanged')) } catch (_) {}
      try { if (typeof w.ARES !== 'undefined' && typeof w.ARES.onTradeClosed === 'function') w.ARES.onTradeClosed(fillPnl) } catch (_) { }
      if (pos.autoTrade) { try { fetch('/api/risk/pnl', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pnl: fillPnl, owner: 'AT' }) }).catch(function () { }) } catch (_) { } }
      if (typeof liveApiSyncState === 'function') liveApiSyncState()
    }).catch(function (err: any) {
      pos.status = 'open'; pos.closed = false
      atLog('warn', 'LIVE CLOSE FAILED: ' + (err.message || err)); toast('Close failed: ' + (err.message || 'still open on exchange'))
      renderLivePositions()
      if (!pos._closeRetried) { pos._closeRetried = true; setTimeout(function () { if (!pos.closed && pos.status === 'open') { atLog('info', '[RETRY] RETRYING close...'); closeLivePos(pos.id, reason || 'Retry') } }, 2000) }
    })
  } else { pos.closed = true; pos.status = 'closed'; const _fbPnl = calcPosPnL(pos, cur); TP.liveBalance = (TP.liveBalance || 0) + pos.size + _fbPnl; if (TP.liveBalance < 0) TP.liveBalance = 0; { const _s = usePositionsStore.getState(); _s.setLiveBalance({ ..._s.liveBalance, totalBalance: TP.liveBalance }) }; TP.livePositions.splice(idx, 1); addTradeToJournal({ id: pos.id, time: fmtNow(), side: pos.side, sym: pos.sym || '', entry: pos.entry, exit: cur, size: pos.size, pnl: _fbPnl, reason: reason || 'Manual', lev: pos.lev, autoTrade: !!pos.autoTrade, journalEvent: 'CLOSE', isLive: true, openTs: pos.openTs || pos.id, closedAt: Date.now(), mode: 'live' }); renderLivePositions(); try { window.dispatchEvent(new CustomEvent('zeus:positionsChanged')) } catch (_) {} }
}
