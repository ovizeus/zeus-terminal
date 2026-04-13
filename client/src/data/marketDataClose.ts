// Zeus — data/marketDataClose.ts
// Ported 1:1 from public/js/data/marketData.js lines 3362-3471 (Chunk G)
// closeDemoPos — the most critical function in the trading engine

import { getTPObject, getATObject, getBrainMetrics, getDSLObject } from '../services/stateAccessors'
import { fmtNow, toast } from './marketDataHelpers'
import { checkKillThreshold , renderATPositions } from '../trading/autotrade'
import { _bmPostClose } from '../trading/orders'
import { runPostMortem } from '../engine/postMortem'
import { renderTradeMarkers } from './marketDataOverlays'
import { addTradeToJournal } from '../services/storage'
import { renderDemoPositions , getSymPrice } from './marketDataPositions'
import { _safePnl } from '../utils/guards'
const w = window as any // kept for w.S.profile (self-ref SKIP), w.ZLOG, w.ZState, fn calls
// [8D-2A] mutable refs — reads + writes through same objects
const TP = (window as any).TP || ((window as any).TP = {})
const AT = (window as any).AT || ((window as any).AT = {})
const BM = (window as any).BM || ((window as any).BM = {})
const DSL = (window as any).DSL || ((window as any).DSL = {})

export function closeDemoPos(id: any, reason?: string): void {
  const numId = (typeof id === 'string') ? parseInt(id, 10) : Number(id)
  const idx = TP.demoPositions.findIndex((p: any) => p.id === numId || p.id === id)
  if (idx < 0) {
    setTimeout(() => { renderDemoPositions(); renderATPositions() }, 0)
    return
  }
  const pos = TP.demoPositions[idx]
  if (pos.closed || pos.status === 'closing') return // [FIX H3]
  pos.closed = true
  pos.status = 'closing' // [FIX H3]

  // [BUG1 FIX] Server-managed position close
  if (w._serverATEnabled && pos._serverSeq) {
    if (typeof w._zeusRequestServerClose === 'function') w._zeusRequestServerClose(pos._serverSeq, pos.id)
    fetch('/api/at/close', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seq: pos._serverSeq }) })
      .then(function (r: any) { return r.json() })
      .then(function (d: any) { if (d && d.ok && typeof w._zeusConfirmServerClose === 'function') w._zeusConfirmServerClose(pos._serverSeq) })
      .catch(function () { })
  }

  // _bmPostClose
  _bmPostClose(pos, reason)

  // [FIX P10] Guard null/stale price — use entry as fallback
  const curPrice = (true ? getSymPrice(pos) : null) || pos.entry
  const diff = curPrice - pos.entry
  const pnl = _safePnl(pos.side, diff, pos.entry, pos.size, pos.lev, true)
  pos._closePnl = pnl // [FIX BUG4]

  if (typeof w.ZLOG !== 'undefined') w.ZLOG.push('AT', '[CLOSE DEMO] ' + pos.side + ' ' + pos.sym + ' PnL=' + pnl.toFixed(2) + ' ' + (reason || 'Manual'), { id: pos.id, sym: pos.sym, side: pos.side, pnl: pnl, reason: reason || 'Manual' })

  // Return margin + PnL
  TP.demoBalance += pos.size + pnl
  if (TP.demoBalance < 0) TP.demoBalance = 0 // [FIX P13]
  if (pnl >= 0) TP.demoWins++; else TP.demoLosses++

  // [SR] outcome update
  if (typeof w.srUpdateOutcome === 'function') w.srUpdateOutcome(pos, pnl)

  // Kill switch check after realized loss
  if (pos.autoTrade && Number.isFinite(pnl)) {
    AT.realizedDailyPnL = (AT.realizedDailyPnL || 0) + pnl
    AT.closedTradesToday = (AT.closedTradesToday || 0) + 1
    if (typeof checkKillThreshold === 'function') checkKillThreshold()
  }

  // Clean DSL state
  delete DSL.positions[String(pos.id)]
  if (DSL._attachedIds) DSL._attachedIds.delete(String(pos.id))

  // Journal
  addTradeToJournal({
    id: pos.id,
    time: fmtNow(),
    side: pos.side, sym: pos.sym.replace('USDT', ''),
    entry: pos.entry, exit: curPrice,
    pnl, reason: reason || 'Manual', lev: pos.lev,
    autoTrade: !!pos.autoTrade,
    journalEvent: 'CLOSE',
    regime: BM.regime || BM.structure?.regime || '\u2014',
    alignmentScore: BM.structure?.score ?? null,
    volRegime: BM.volRegime || '\u2014',
    profile: w.S.profile || 'fast',
    openTs: pos.openTs || pos.id,
    closedAt: Date.now(),
    mode: pos.mode || ((typeof AT !== 'undefined' && AT._serverMode) || 'demo'),
  })

  TP.demoPositions.splice(idx, 1)

  // Track recently closed IDs
  w._zeusRecentlyClosed = w._zeusRecentlyClosed || []
  w._zeusRecentlyClosed.push(pos.id)
  if (pos._serverSeq && pos._serverSeq !== pos.id) w._zeusRecentlyClosed.push(pos._serverSeq)
  if (w._zeusRecentlyClosed.length > 200) w._zeusRecentlyClosed = w._zeusRecentlyClosed.slice(-100)

  // UI sync
  setTimeout(() => {
    w.updateDemoBalance()
    renderDemoPositions()
    renderATPositions()
    TP.demoPositions = (TP.demoPositions || []).filter((p: any) => !p.closed)
    try { window.dispatchEvent(new CustomEvent('zeus:positionsChanged')) } catch (_) {}
    const autoPosns = TP.demoPositions.filter((p: any) => p.autoTrade)
    if (autoPosns.length === 0) { const el = document.getElementById('atPosCount'); if (el) el.textContent = '0 pozitii' }
    if (typeof renderTradeMarkers === 'function') renderTradeMarkers()
  }, 0)

  toast(`${(reason && (reason.includes('TP') || reason.includes('TP HIT'))) ? 'WIN' : 'CLOSED'} ${reason || 'Inchis'}: ${pos.side} ${pos.sym.replace('USDT', '')} PnL ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`)
  w.ncAdd(pnl >= 0 ? 'info' : 'warning', 'trade', `${pnl >= 0 ? 'WIN' : 'LOSS'} ${reason || 'Inchis'}: ${pos.side} ${pos.sym.replace('USDT', '')} PnL ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`)

  w.ZState.syncNow()

  // Exit overlay (auto trades only)
  if (pos.autoTrade && typeof w.onTradeClosed === 'function') {
    const _openTs = pos.openTs || pos.id
    const _durMs = Date.now() - _openTs
    const _durMin = Math.round(_durMs / 60000)
    w.onTradeClosed({ sym: pos.sym, pnl, percent: (pnl / pos.size * 100), duration: (_durMin > 0 ? _durMin + 'm' : '<1m'), reason: reason || 'CLOSE', isLive: pos.isLive })
  }

  // Post-mortem (async, 200ms delay)
  setTimeout(function () { if (typeof runPostMortem === 'function') runPostMortem(pos, pnl, curPrice) }, 200)

  // Close hooks (ARES, extensions)
  if (Array.isArray(w._demoCloseHooks)) {
    const _hPos = pos, _hPnl = pnl, _hReason = reason
    w._demoCloseHooks.forEach(function (fn: any) { try { fn(_hPos, _hPnl, _hReason) } catch (_) { } })
  }
}
