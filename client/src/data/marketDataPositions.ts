// Zeus — data/marketDataPositions.ts
// Ported 1:1 from public/js/data/marketData.js lines 2662-3361 (Chunk F)
// Pending orders, SL/TP edit, render positions, closeLivePos

import { AT } from '../engine/events'
import { TP } from '../core/state'
import { BM, DSL } from '../core/config'
import { fmtNow, toast } from './marketDataHelpers'
import { fmt, fP } from '../utils/format'
import { escHtml, el } from '../utils/dom'
import { _ZI } from '../constants/icons'
import { manualLiveModifyLimit, liveApiClosePosition, manualLiveGetOpenOrders, manualLiveCancelOrder, manualLiveSetSL, manualLiveSetTP } from '../trading/liveApi'
import { calcLiqPrice } from './marketDataTrading'
import { calcDslTargetPrice } from '../engine/brain'
import { renderTradeMarkers } from './marketDataOverlays'
import { attachConfirmClose } from '../engine/events'
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
    dslParams: Object.assign({ pivotLeftPct: _numOrDefault(el('dslTrailPct')?.value, 0.70), pivotRightPct: _numOrDefault(el('dslTrailSusPct')?.value, 1.00), impulseVPct: _numOrDefault(el('dslExtendPct')?.value, 1.30) }, typeof calcDslTargetPrice === 'function' ? calcDslTargetPrice(ord.side, ord.limitPrice, ord.tp) : { openDslPct: 1.5, dslTargetPrice: ord.side === 'LONG' ? ord.limitPrice * 1.015 : ord.limitPrice * 0.985 }),
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
function _pendingOrderClickHandler(e: Event): void {
  const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement
  if (!btn) return
  const id = btn.dataset.id
  if (btn.dataset.action === 'cancelPendingOrder') cancelPendingOrder(id)
  else if (btn.dataset.action === 'modifyPendingPrice') modifyPendingPrice(id)
}
export function renderPendingOrders(): void {
  const cont = el('pendingOrdersTable'); if (!cont) return
  const _gMode = (typeof AT !== 'undefined' && AT._serverMode) ? AT._serverMode : 'demo'
  const allPending: any[] = []
  if (_gMode === 'demo') { (TP.pendingOrders || []).forEach(function (o: any) { if (o.status === 'WAITING') allPending.push(o) }) }
  if (_gMode === 'live') { (TP.manualLivePending || []).forEach(function (o: any) { if (o.status === 'WAITING') allPending.push(o) }) }
  if (!allPending.length) { cont.innerHTML = '<div style="color:var(--dim);text-align:center;padding:4px;font-size:9px">No pending orders</div>'; return }
  cont.innerHTML = allPending.map(function (ord: any) {
    const symBase = escHtml((ord.sym || '').replace('USDT', ''))
    const sideColor = ord.side === 'LONG' ? 'var(--cyan)' : 'var(--blu)'
    const modeBadge = ord.mode === 'live' ? '<span style="background:#ff444422;color:#ff4444;padding:1px 5px;border-radius:3px;font-size:9px;font-weight:700;margin-left:4px">LIVE</span>' : '<span style="background:#aa44ff22;color:#aa44ff;padding:1px 5px;border-radius:3px;font-size:9px;font-weight:700;margin-left:4px">DEMO</span>'
    const age = Date.now() - (ord.createdAt || Date.now()); const ageStr = age < 60000 ? Math.floor(age / 1000) + 's' : Math.floor(age / 60000) + 'm'
    const _rawPrice = getSymPrice(ord) || (w.allPrices[ord.sym] || null)
    const curPrice = (_rawPrice && Number.isFinite(_rawPrice) && _rawPrice > 0) ? _rawPrice : 0
    const distPct = curPrice > 0 ? (((ord.limitPrice - curPrice) / curPrice) * 100).toFixed(2) : '?'
    return '<div class="pos-row pos-pending" style="border-color:' + sideColor + '"><div style="display:flex;justify-content:space-between;align-items:center"><span style="font-weight:700;color:' + sideColor + '"><span style="background:#00d4ff22;color:#00d4ff;padding:1px 6px;border-radius:3px;font-size:9px;font-weight:700;margin-right:4px"> WAITING LIMIT</span>' + escHtml(ord.side) + ' ' + symBase + ' ' + ord.lev + 'x' + modeBadge + '</span><div style="display:flex;gap:4px"><button data-action="modifyPendingPrice" data-id="' + ord.id + '" style="padding:6px 10px;background:#001a33;border:1px solid #00aaff;color:#00d4ff;border-radius:3px;font-size:9px;cursor:pointer;font-weight:700;min-height:36px">EDIT MODIFY</button><button data-action="cancelPendingOrder" data-id="' + ord.id + '" style="padding:6px 10px;background:#2a0010;border:1px solid #ff4466;color:#ff4466;border-radius:3px;font-size:9px;cursor:pointer;font-weight:700;min-height:36px">\u2715 CANCEL</button></div></div><div style="display:flex;justify-content:space-between;font-size:12px;margin-top:3px;color:var(--dim)"><span>Limit: $' + fP(ord.limitPrice) + ' | Size: $' + fmt(ord.size) + '</span><span>Now: $' + (curPrice > 0 ? fP(curPrice) : '\u2014') + ' (' + distPct + '%)</span></div><div style="font-size:11px;color:var(--dim);margin-top:1px">' + (ord.sl ? 'SL: $' + fP(ord.sl) + ' ' : '') + (ord.tp ? 'TP: $' + fP(ord.tp) + ' ' : '') + '| ' + ageStr + ' ago' + (ord.exchangeOrderId ? ' | OID: ' + ord.exchangeOrderId : '') + '</div></div>'
  }).join('')
  // Event delegation for pending order buttons — re-attach every render to survive React remounts
  cont.removeEventListener('click', _pendingOrderClickHandler)
  cont.addEventListener('click', _pendingOrderClickHandler)
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
let _lastRenderDemo = 0
let _pendingRenderDemo: any = 0
export function renderDemoPositions(): void {
  const _now = Date.now()
  if (_now - _lastRenderDemo < 500) { if (!_pendingRenderDemo) _pendingRenderDemo = setTimeout(renderDemoPositions, 500 - (_now - _lastRenderDemo)); return }
  _lastRenderDemo = _now; _pendingRenderDemo = 0
  const table = el('demoPosTable'); if (!table) return
  const _ae = document.activeElement as any
  if (_ae && _ae.tagName === 'INPUT' && (_ae.id && (_ae.id.startsWith('slEdit_') || _ae.id.startsWith('tpEdit_'))) && table.contains(_ae)) return
  const _gMode = (typeof AT !== 'undefined' && AT._serverMode) ? AT._serverMode : 'demo'
  const manualPos = TP.demoPositions.filter((p: any) => !p.closed && !p.autoTrade && (p.mode || 'demo') === _gMode)
  let totalPnL = 0
  if (!manualPos.length) { table.innerHTML = '<div style="color:var(--dim);text-align:center;padding:8px">No open positions</div>' }
  else {
    const html = manualPos.map((pos: any) => {
      const curPrice = getSymPrice(pos)
      if (!curPrice || !Number.isFinite(curPrice) || curPrice <= 0) { pos.pnl = 0; const symBase = escHtml((pos.sym || 'BTC').replace('USDT', '')); return `<div class="pos-row"><div style="display:flex;justify-content:space-between;align-items:center"><span style="font-weight:700">${escHtml(pos.side)} ${symBase} ${pos.lev}x</span><button data-id="${pos.id}" style="padding:10px 14px;background:#2a0010;border:2px solid #ff4466;color:#ff4466;border-radius:4px;font-size:10px;cursor:pointer;min-height:52px;font-weight:700">\u2715 CLOSE</button></div><div style="font-size:13px;margin-top:3px;color:#ff8800">Price unavailable</div></div>` }
      const diff = curPrice - pos.entry; pos.pnl = _safePnl(pos.side, diff, pos.entry, pos.size, pos.lev, true); totalPnL += pos.pnl
      const pnlPct = pos.size > 0 ? (pos.pnl / w._safe.num(pos.size, null, 1) * 100).toFixed(2) : '0.00'
      const margin = w._safe.num(pos.size, null, 0); const lev = w._safe.num(pos.lev, null, 1); const notional = margin * lev; const feeRate = w._safe.num(typeof w.S !== 'undefined' ? w.S.feeRate : null, null, 0.0004); const estFees = notional * feeRate * 2; const roe = margin > 0 ? (pos.pnl / margin * 100).toFixed(2) : '0.00'
      const symBase = escHtml((pos.sym || 'BTC').replace('USDT', ''))
      const modeBadge = (pos.mode || 'demo') === 'live' ? '<span style="background:#ff444422;color:#ff4444;padding:1px 5px;border-radius:3px;font-size:10px;font-weight:700;margin-left:6px">LIVE</span>' : '<span style="background:#aa44ff22;color:#aa44ff;padding:1px 5px;border-radius:3px;font-size:10px;font-weight:700;margin-left:6px">DEMO</span>'
      const _dslSt = typeof DSL !== 'undefined' && DSL.positions ? DSL.positions[String(pos.id)] : null; const _dslActive = _dslSt && _dslSt.active; const _slVal = _dslActive && _dslSt.currentSL > 0 ? _dslSt.currentSL : pos.sl; const _slLabel = _dslActive ? 'DSL' : 'SL'; const _slColor = _dslActive ? '#39ff14' : '#ff6644'
      return `<div class="pos-row ${escHtml(pos.side) === 'LONG' ? 'pos-long' : 'pos-short'}"><div style="display:flex;justify-content:space-between;align-items:center"><span style="font-weight:700">${escHtml(pos.side)} ${symBase} ${pos.lev}x${modeBadge}</span><button data-id="${pos.id}" style="padding:10px 14px;background:#2a0010;border:2px solid #ff4466;color:#ff4466;border-radius:4px;font-size:10px;cursor:pointer;min-height:52px;font-weight:700">\u2715 CLOSE</button></div><div style="display:flex;justify-content:space-between;font-size:13px;margin-top:3px"><span style="color:var(--dim)">Entry: $${fP(pos.entry)} | Now: $${fP(curPrice)}</span><span style="color:${pos.pnl >= 0 ? 'var(--grn)' : 'var(--red)'}">${pos.pnl >= 0 ? '+' : ''}$${pos.pnl.toFixed(2)} (${pnlPct}%)</span></div><div style="font-size:12px;color:var(--dim);margin-top:1px">Margin: $${fmt(margin)} | Notional: $${fmt(notional)} | Fees\u2248$${fmt(estFees)} | ROE: ${roe}%</div>${_dslActive ? `<div style="font-size:12px;color:${_slColor};margin-top:1px">${_slLabel}: $${fP(_slVal)}${pos.tp ? ' | TP: $' + fP(pos.tp) : ''}</div>` : ''}<div style="display:flex;gap:4px;margin-top:3px;align-items:center"><span style="font-size:10px;color:#ff6644;width:22px">SL:</span><input id="slEdit_${pos.id}" type="number" step="0.1" value="${pos.sl || ''}" placeholder="\u2014" style="flex:1;background:#0a0a14;border:1px solid #333;color:#ff6644;padding:3px 5px;border-radius:3px;font-size:11px;font-family:var(--ff);width:60px"><span style="font-size:10px;color:#00ff88;width:22px">TP:</span><input id="tpEdit_${pos.id}" type="number" step="0.1" value="${pos.tp || ''}" placeholder="\u2014" style="flex:1;background:#0a0a14;border:1px solid #333;color:#00ff88;padding:3px 5px;border-radius:3px;font-size:11px;font-family:var(--ff);width:60px"><button data-action="savePosSLTP" data-id="${pos.id}" data-mode="demo" style="padding:3px 8px;background:#001a22;border:1px solid #00aaff;color:#00d4ff;border-radius:3px;font-size:9px;cursor:pointer;font-weight:700;min-height:24px">SAVE</button></div>${pos.liqPrice ? `<div style="font-size:12px;color:${pos.side === 'LONG' ? '#ff3355' : '#00d97a'};margin-top:1px">LIQ: $${fP(pos.liqPrice)}</div>` : ''}</div>`
    }).join('')
    table.innerHTML = html
    table.querySelectorAll('button[data-id]:not([data-action])').forEach(function (btn: any) { const posId = btn.getAttribute('data-id'); attachConfirmClose(btn, function () { closeDemoPos(posId) }) })
  }
  // Event delegation for savePosSLTP on demo positions
  if (!table.dataset.delegated) {
    table.dataset.delegated = '1'
    table.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-action="savePosSLTP"]') as HTMLElement
      if (btn) savePosSLTP(btn.dataset.id, btn.dataset.mode)
    })
  }
  // Stats
  const _statsMode = (typeof AT !== 'undefined' && AT._serverMode) ? AT._serverMode : 'demo'
  let _statsWins = 0, _statsLosses = 0, _statsPnl = 0, _statsTrades = 0
  if (_statsMode === 'live') {
    const _openManualLive = (TP.livePositions || []).filter(function (p: any) { return !p.closed && !p.autoTrade })
    _openManualLive.forEach(function (p: any) { const _cur = getSymPrice(p); const _pnl = (_cur && _cur > 0) ? calcPosPnL(p, _cur) : (Number.isFinite(p.pnl) ? p.pnl : 0); _statsPnl += _pnl })
    const _jManualLive = (Array.isArray(TP.journal) ? TP.journal : []).filter(function (j: any) { return j.mode === 'live' && !j.autoTrade })
    _jManualLive.forEach(function (j: any) { const _jp = Number(j.pnl) || 0; _statsPnl += _jp; if (_jp >= 0) _statsWins++; else _statsLosses++ })
    _statsTrades = _openManualLive.length + _jManualLive.length
  } else { _statsWins = TP.demoWins || 0; _statsLosses = TP.demoLosses || 0; _statsPnl = totalPnL; _statsTrades = _statsWins + _statsLosses }
  const pnlEl = el('demoPnL'); if (pnlEl) { pnlEl.textContent = '$' + _statsPnl.toFixed(2); pnlEl.className = 'tp-pnl-val ' + (_statsPnl > 0 ? 'pos' : _statsPnl < 0 ? 'neg' : 'neut') }
  const wr = el('demoWR'); if (wr) wr.textContent = _statsTrades ? Math.round(_statsWins / _statsTrades * 100) + '%' : '0%'
  const tr = el('demoTrades'); if (tr) tr.textContent = _statsTrades
}

export function calcPosPnL(pos: any, cur: any): number { return _safePnl(pos.side, cur, pos.entry, pos.size, pos.lev, false) }

export function updateLiveBalance(): void {
  const balEl = el('liveBalanceAmt') || el('demoBalanceAmt')
  if (balEl && TP.liveBalance) balEl.textContent = '$' + Number(TP.liveBalance).toFixed(2)
  const pnlEl = el('liveUnrealizedPnl')
  if (pnlEl && typeof TP.liveUnrealizedPnL === 'number') pnlEl.textContent = (TP.liveUnrealizedPnL >= 0 ? '+' : '') + '$' + TP.liveUnrealizedPnL.toFixed(2)
}

export function renderLivePositions(): void {
  const cont = el('livePositions'); const contDemo = el('livePositionsDemo'); const contWrap = el('livePositionsInDemo')
  const _isLiveMode = (typeof AT !== 'undefined' && AT._serverMode === 'live')
  if (contWrap) contWrap.style.display = _isLiveMode ? 'block' : 'none'
  const _ae = document.activeElement as any
  if (_ae && _ae.tagName === 'INPUT' && (_ae.id && (_ae.id.startsWith('slEdit_') || _ae.id.startsWith('tpEdit_'))) && cont && cont.contains(_ae)) return
  const live = TP.livePositions.filter((p: any) => !p.closed && p.status !== 'closing' && !p.autoTrade)
  if (!live.length) {
    const _emptyTarget = (_isLiveMode && contDemo) ? contDemo : cont
    if (_emptyTarget) _emptyTarget.innerHTML = '<div style="color:var(--dim);text-align:center;padding:8px;font-size:9px">No exchange positions</div>'
    if (_isLiveMode && cont) cont.innerHTML = ''; if (!_isLiveMode && contDemo) contDemo.innerHTML = ''; return
  }
  const html = live.map(function (pos: any) {
    const cur = getSymPrice(pos)
    if (!cur || !Number.isFinite(cur) || cur <= 0) { pos.pnl = 0; return `<div class="pos-row ${pos.side === 'LONG' ? 'pos-long' : 'pos-short'}"><div style="display:flex;justify-content:space-between;align-items:center"><span style="font-weight:700">${_ZI.dRed} ${escHtml(pos.side)} ${escHtml((pos.sym || '').replace('USDT', ''))} ${pos.lev}x</span><button data-live-id="${pos.id}" style="padding:10px 14px;background:#2a0010;border:2px solid #ff4466;color:#ff4466;border-radius:4px;font-size:10px;cursor:pointer;min-height:52px;font-weight:700">\u2715 CLOSE</button></div><div style="font-size:13px;margin-top:3px;color:#ff8800">Price unavailable</div></div>` }
    const pnl = (pos.fromExchange && Number.isFinite(pos.pnl)) ? pos.pnl : calcPosPnL(pos, cur); if (!pos.fromExchange) pos.pnl = pnl
    const pnlPct = pos.size > 0 ? (pnl / w._safe.num(pos.size, null, 1) * 100).toFixed(2) : '0.00'; const symBase = escHtml((pos.sym || '').replace('USDT', ''))
    return `<div class="pos-row ${pos.side === 'LONG' ? 'pos-long' : 'pos-short'}"><div style="display:flex;justify-content:space-between;align-items:center"><span style="font-weight:700">${_ZI.dRed} ${escHtml(pos.side)} ${symBase} ${pos.lev}x</span><button data-live-id="${pos.id}" style="padding:10px 14px;background:#2a0010;border:2px solid #ff4466;color:#ff4466;border-radius:4px;font-size:10px;cursor:pointer;min-height:52px;font-weight:700">\u2715 CLOSE</button></div><div style="display:flex;justify-content:space-between;font-size:13px;margin-top:3px"><span style="color:var(--dim)">Entry: $${fP(pos.entry)} | Now: $${fP(cur)}</span><span style="color:${pnl >= 0 ? 'var(--grn)' : 'var(--red)'}">${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPct}%)</span></div>${pos.liqPrice ? `<div style="font-size:12px;color:#ff3355;margin-top:1px">LIQ: $${fP(pos.liqPrice)}</div>` : ''}<div style="display:flex;gap:4px;margin-top:3px;align-items:center"><span style="font-size:10px;color:#ff6644;width:22px">SL:</span><input id="slEdit_${pos.id}" type="number" step="0.1" value="${pos.sl || ''}" placeholder="\u2014" style="flex:1;background:#0a0a14;border:1px solid #333;color:#ff6644;padding:3px 5px;border-radius:3px;font-size:11px;font-family:var(--ff);width:60px"><span style="font-size:10px;color:#00ff88;width:22px">TP:</span><input id="tpEdit_${pos.id}" type="number" step="0.1" value="${pos.tp || ''}" placeholder="\u2014" style="flex:1;background:#0a0a14;border:1px solid #333;color:#00ff88;padding:3px 5px;border-radius:3px;font-size:11px;font-family:var(--ff);width:60px"><button data-action="savePosSLTP" data-id="${pos.id}" data-mode="live" style="padding:3px 8px;background:#001a22;border:1px solid #00aaff;color:#00d4ff;border-radius:3px;font-size:9px;cursor:pointer;font-weight:700;min-height:24px">SAVE</button></div></div>`
  }).join('')
  const _target = (_isLiveMode && contDemo) ? contDemo : cont
  if (_target) _target.innerHTML = html
  if (_target) _target.querySelectorAll('button[data-live-id]').forEach(function (btn: any) { const posId = btn.getAttribute('data-live-id'); attachConfirmClose(btn, function () { closeLivePos(posId) }) })
  if (_isLiveMode && cont && cont !== _target) cont.innerHTML = ''
  if (!_isLiveMode && contDemo && contDemo !== _target) contDemo.innerHTML = ''
  // Event delegation for savePosSLTP on live positions
  ;[cont, contDemo].forEach(c => {
    if (!c || c.dataset.liveDelegated) return
    c.dataset.liveDelegated = '1'
    c.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-action="savePosSLTP"]') as HTMLElement
      if (btn) savePosSLTP(btn.dataset.id, btn.dataset.mode)
    })
  })
}

// closeLivePos — included here since it's tightly coupled with renderLivePositions
export function closeLivePos(id: any, reason?: string): void {
  const strId = String(id); const idx = TP.livePositions.findIndex((p: any) => String(p.id) === strId); if (idx < 0) return
  const pos = TP.livePositions[idx]; if (pos.status === 'closing' || pos.closed) return
  if (w._serverATEnabled && pos._serverSeq) { if (typeof w._zeusRequestServerClose === 'function') w._zeusRequestServerClose(pos._serverSeq, pos.id); fetch('/api/at/close', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seq: pos._serverSeq }) }).then(function (r) { return r.json() }).then(function (d: any) { if (d && d.ok && typeof w._zeusConfirmServerClose === 'function') w._zeusConfirmServerClose(pos._serverSeq) }).catch(function () { }) }
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
  } else { pos.closed = true; pos.status = 'closed'; const _fbPnl = calcPosPnL(pos, cur); TP.liveBalance = (TP.liveBalance || 0) + pos.size + _fbPnl; if (TP.liveBalance < 0) TP.liveBalance = 0; TP.livePositions.splice(idx, 1); addTradeToJournal({ id: pos.id, time: fmtNow(), side: pos.side, sym: pos.sym || '', entry: pos.entry, exit: cur, size: pos.size, pnl: _fbPnl, reason: reason || 'Manual', lev: pos.lev, autoTrade: !!pos.autoTrade, journalEvent: 'CLOSE', isLive: true, openTs: pos.openTs || pos.id, closedAt: Date.now(), mode: 'live' }); renderLivePositions(); try { window.dispatchEvent(new CustomEvent('zeus:positionsChanged')) } catch (_) {} }
}
