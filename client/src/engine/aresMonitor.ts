// Zeus — engine/aresMonitor.ts
// Ported 1:1 from public/js/brain/deepdive.js lines 1660-1882 (Phase 5B2)
// ARES POSITION MONITOR + DSL (Dynamic Stop Loss Manager)
// + Hook ARES in closeDemoPos

const w = window as any

// DSL configuration
const DSL_CFG = {
  BE_TRIGGER: 1.0, TRAIL_TRIGGER: 1.5, TRAIL_DIST: 1.0,
  TIGHTEN_TRIGGER: 3.0, TIGHTEN_DIST: 0.5, MIN_MOVE: 0.001,
}

function _getAtrPct(): number {
  let atrPct = 1.5
  try { if (typeof w.S !== 'undefined' && w.S.atr && w.S.price > 0) { const ap = (w.S.atr / w.S.price) * 100; if (ap > 0) atrPct = ap } } catch (_) { }
  return atrPct
}

function _computeDslStop(pos: any, markPrice: number): number | null {
  const dir = pos.side === 'LONG' ? 1 : -1
  const priceDiff = (markPrice - pos.entryPrice) * dir
  const atrPct = _getAtrPct()
  const atrPrice = pos.entryPrice * (atrPct / 100)

  if (priceDiff >= atrPrice * DSL_CFG.TIGHTEN_TRIGGER) {
    const trailDist = atrPrice * DSL_CFG.TIGHTEN_DIST
    return pos.side === 'LONG' ? markPrice - trailDist : markPrice + trailDist
  }
  if (priceDiff >= atrPrice * DSL_CFG.TRAIL_TRIGGER) {
    const trailDist = atrPrice * DSL_CFG.TRAIL_DIST
    return pos.side === 'LONG' ? markPrice - trailDist : markPrice + trailDist
  }
  if (priceDiff >= atrPrice * DSL_CFG.BE_TRIGGER) {
    const buffer = pos.entryPrice * 0.001
    return pos.side === 'LONG' ? pos.entryPrice + buffer : pos.entryPrice - buffer
  }
  return null
}

async function check(): Promise<void> {
  if (typeof w.ARES === 'undefined') return
  const openPos = w.ARES.positions.getOpen()
  if (openPos.length === 0) return

  let markPrice = 0
  try { if (typeof w.S !== 'undefined' && w.S.price) markPrice = w.S.price } catch (_) { }
  if (!markPrice) return

  for (const pos of openPos) {
    if (!pos.isLive) continue

    if (pos.slPrice) {
      const idealSl = _computeDslStop(pos, markPrice)
      if (idealSl !== null) {
        const isBetter = pos.side === 'LONG' ? idealSl > pos.slPrice : idealSl < pos.slPrice
        const movePct = Math.abs(idealSl - pos.slPrice) / pos.entryPrice
        if (isBetter && movePct >= DSL_CFG.MIN_MOVE) {
          const newSl = Math.round(idealSl * 100) / 100
          try {
            if (pos.slOrderId) await w.aresCancelOrder('BTCUSDT', pos.slOrderId)
            const slResult = await w.aresSetStopLoss({ symbol: 'BTCUSDT', side: pos.side === 'LONG' ? 'BUY' : 'SELL', quantity: pos.liveQty || pos.qty, stopPrice: newSl })
            const phase = _computeDslStop(pos, markPrice) !== null ? 'DSL' : 'BE'
            w.ARES.positions.updatePos(pos.id, { slPrice: newSl, slOrderId: slResult.orderId, _slMovedBE: true, _dslPhase: phase })
            w.ARES.push('[DSL] ' + pos.side + ' SL \u2192 $' + newSl.toFixed(2) + ' (was $' + pos.slPrice.toFixed(2) + ')')
          } catch (e: any) { w.ARES.push('[DSL FAIL] ' + (e.message || e)) }
        }
      }
    }

    if (!pos.slOrderId && pos.slPrice) {
      const slHit = (pos.side === 'LONG' && markPrice <= pos.slPrice) || (pos.side === 'SHORT' && markPrice >= pos.slPrice)
      if (slHit) { w.ARES.push('[EMERGENCY SL] Client-side SL trigger for ' + pos.id); await _closeLivePosition(pos, markPrice, 'emergency_sl'); continue }
    }
    if (!pos.tpOrderId && pos.tpPrice) {
      const tpHit = (pos.side === 'LONG' && markPrice >= pos.tpPrice) || (pos.side === 'SHORT' && markPrice <= pos.tpPrice)
      if (tpHit) { w.ARES.push('[EMERGENCY TP] Client-side TP trigger for ' + pos.id); await _closeLivePosition(pos, markPrice, 'emergency_tp'); continue }
    }
  }
}

async function _closeLivePosition(pos: any, markPrice: number, reason: string): Promise<any> {
  try {
    if (pos.slOrderId) try { await w.aresCancelOrder('BTCUSDT', pos.slOrderId) } catch (_) { }
    if (pos.tpOrderId) try { await w.aresCancelOrder('BTCUSDT', pos.tpOrderId) } catch (_) { }

    const closeResult = await w.aresClosePosition({ symbol: 'BTCUSDT', side: pos.side, qty: pos.liveQty || pos.qty })
    const closePrice = closeResult.avgPrice || markPrice
    const dir = pos.side === 'LONG' ? 1 : -1
    const grossPnl = ((closePrice - pos.entryPrice) * dir / pos.entryPrice) * (pos.notional || 0)
    const fees = w.ARES.wallet.roundTripFees(pos.notional || 0)
    const netPnl = grossPnl - fees

    w.ARES.positions.updatePos(pos.id, { closePrice, closeReason: reason, grossPnl, netPnl, fees })
    w.ARES.positions.closePosition(pos.id)
    w.ARES.onTradeClosed(netPnl, pos)
    if (typeof w.ARES_JOURNAL !== 'undefined') w.ARES_JOURNAL.recordClose(pos.id, { closePrice, netPnl, closeReason: reason })
    w.ARES.push('[ARES CLOSE] ' + pos.side + ' @ $' + closePrice.toFixed(2) + ' PnL=$' + netPnl.toFixed(2) + ' reason=' + reason)
    try { if (typeof w._aresRender === 'function') w._aresRender() } catch (_) { }
    return { netPnl, closePrice }
  } catch (err: any) {
    w.ARES.push('[ARES CLOSE FAIL] ' + (err.message || err))
    console.error('[ARES_MONITOR] Close failed:', err)
    return null
  }
}

export const ARES_MONITOR = { check, closeLivePosition: _closeLivePosition }

// ── Hook ARES in closeDemoPos ──────────────────────────────────
;(function _aresHookClose() {
  if (!w._demoCloseHooks) w._demoCloseHooks = []
  function _sN(v: any) { v = +v; return Number.isFinite(v) ? v : null }
  function _pnlFromPos(pos: any) {
    if (!pos) return null
    const d = _sN(pos.netPnL) ?? _sN(pos.pnlNet) ?? _sN(pos.pnl) ?? _sN(pos.realizedPnL) ?? _sN(pos.realized) ?? _sN(pos.profit) ?? null
    if (d !== null) return d
    const g = _sN(pos.grossPnL)
    if (g !== null) return g - (_sN(pos.fee) ?? _sN(pos.fees) ?? 0)
    return null
  }
  w._demoCloseHooks.push(function (pos: any, pnl: number, reason: string) {
    if (typeof w.ARES === 'undefined' || typeof w.ARES.onTradeClosed !== 'function') return
    setTimeout(function () {
      try {
        let finalPnl = Number.isFinite(pnl) ? pnl : _pnlFromPos(pos)
        if (!Number.isFinite(finalPnl)) finalPnl = 0
        w.ARES.onTradeClosed(finalPnl, pos)
      } catch (_) { }
    }, 350)
  })
})()
