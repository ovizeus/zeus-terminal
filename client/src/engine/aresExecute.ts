// Zeus — engine/aresExecute.ts
// Ported 1:1 from public/js/brain/deepdive.js lines 1467-1653 (Phase 5B2)
// ARES LIVE EXECUTION — Connects decision engine → live orders

import { safeLastKline } from '../utils/dom'

const w = window as any

export async function ARES_EXECUTE(decision: any): Promise<any> {
  if (!decision || !decision.shouldTrade || !decision.side) return null
  if (typeof w.ARES === 'undefined') return null
  if (typeof w.aresPlaceOrder !== 'function') { console.error('[ARES_EXECUTE] aresPlaceOrder not available'); return null }

  const wallet = w.ARES.wallet, positions = w.ARES.positions
  const bal = wallet.balance, avail = wallet.available, confidence = decision.confidence

  let markPrice = 0
  try { if (typeof w.S !== 'undefined' && w.S.price) markPrice = w.S.price; else { const _lk = (typeof safeLastKline === 'function') ? safeLastKline() : null; if (_lk) markPrice = _lk.close } } catch (_) { }
  if (!markPrice || markPrice <= 0) { console.warn('[ARES_EXECUTE] No mark price'); return null }

  const openCount = positions.getOpen().length
  let maxPos: number; if (bal < 300) maxPos = 1; else if (bal < 1000) maxPos = 2; else if (bal < 5000) maxPos = 3; else maxPos = 5
  if (openCount >= maxPos) return null

  let stakePct: number
  if (bal < 300) stakePct = 0.10; else if (bal < 1000) stakePct = 0.12; else if (bal < 5000) stakePct = 0.15; else if (bal < 10000) stakePct = 0.18; else stakePct = 0.20
  if (confidence >= 80) stakePct += 0.03
  let volScore = 50
  try { if (typeof w.S !== 'undefined' && w.S.atr && markPrice > 0) { const atrPct = (w.S.atr / markPrice) * 100; volScore = Math.min(100, Math.round(atrPct / 3 * 100)) } } catch (_) { }
  if (volScore >= 80) stakePct -= 0.05
  stakePct = Math.min(0.25, Math.max(0.05, stakePct))

  let stakeVirtual = bal * stakePct
  stakeVirtual = Math.max(5, Math.min(stakeVirtual, avail, bal * 0.25))
  stakeVirtual = Math.round(stakeVirtual * 100) / 100

  let atrPct = 1.5
  try { if (typeof w.S !== 'undefined' && w.S.atr && markPrice > 0) atrPct = (w.S.atr / markPrice) * 100 } catch (_) { }
  const leverage = Math.min(20, Math.max(5, Math.round(10 + 0.5 * confidence - 2 * atrPct)))

  let notional = stakeVirtual * leverage; if (notional < 5) notional = 5
  const qty = Math.floor((notional / markPrice) * 1000) / 1000
  if (qty <= 0) { console.warn('[ARES_EXECUTE] Calculated qty=0'); return null }

  if (!wallet.reserve(stakeVirtual)) { console.warn('[ARES_EXECUTE] Wallet reserve failed, avail=' + avail + ' need=' + stakeVirtual); return null }

  const binanceSide = decision.side === 'LONG' ? 'BUY' : 'SELL'

  try {
    w.ARES.push('[EXEC] Placing ' + decision.side + ' BTCUSDT x' + leverage + ' stake=$' + stakeVirtual.toFixed(2) + ' qty=' + qty)
    const fill = await w.aresPlaceOrder({ symbol: 'BTCUSDT', side: binanceSide, quantity: qty, leverage })
    const fillPrice = fill.avgPrice || markPrice
    const fillQty = fill.executedQty || qty

    const pos = positions.open({
      side: decision.side, leverage, notional: fillQty * fillPrice, entryPrice: fillPrice,
      confidence, policy: 'BALANCED', reason: decision.reasons.join(' | '),
      targetNetPnL: Math.max(5, Math.round(notional * 0.005)), stakeVirtual,
    })
    positions.updatePos(pos.id, { liveOrderId: fill.orderId, liveQty: fillQty, liveFillPrice: fillPrice, journal: { decision, markPrice, stakeVirtual, leverage, notional, qty, atrPct, volScore, stakePct, ts: Date.now() }, isLive: true })

    const slDistance = markPrice * (atrPct / 100) * 1.5
    const slPrice = decision.side === 'LONG' ? Math.round((fillPrice - slDistance) * 100) / 100 : Math.round((fillPrice + slDistance) * 100) / 100
    try {
      const slResult = await w.aresSetStopLoss({ symbol: 'BTCUSDT', side: binanceSide, quantity: fillQty, stopPrice: slPrice })
      positions.updatePos(pos.id, { slPrice, slOrderId: slResult.orderId })
      w.ARES.push('[SL SET] ' + decision.side + ' SL @ $' + slPrice.toFixed(2))
    } catch (slErr: any) { w.ARES.push('[SL FAIL] ' + (slErr.message || slErr) + ' \u2014 monitor client-side'); positions.updatePos(pos.id, { slPrice, slOrderId: null }) }

    const tpDistance = markPrice * (atrPct / 100) * 2.0
    const tpPrice = decision.side === 'LONG' ? Math.round((fillPrice + tpDistance) * 100) / 100 : Math.round((fillPrice - tpDistance) * 100) / 100
    try {
      const tpResult = await w.aresSetTakeProfit({ symbol: 'BTCUSDT', side: binanceSide, quantity: fillQty, stopPrice: tpPrice })
      positions.updatePos(pos.id, { tpPrice, tpOrderId: tpResult.orderId })
      w.ARES.push('[TP SET] ' + decision.side + ' TP @ $' + tpPrice.toFixed(2))
    } catch (tpErr: any) { w.ARES.push('[TP FAIL] ' + (tpErr.message || tpErr) + ' \u2014 monitor client-side'); positions.updatePos(pos.id, { tpPrice, tpOrderId: null }) }

    w.ARES_DECISION.recordTrade()
    if (typeof w.ARES_JOURNAL !== 'undefined') w.ARES_JOURNAL.recordOpen(decision, pos, fillPrice)
    w.ARES.push('[ARES LIVE OPEN] ' + decision.side + ' BTCUSDT x' + leverage + ' @ $' + fillPrice.toFixed(2) + ' qty=' + fillQty + ' stake=$' + stakeVirtual.toFixed(2) + ' SL=$' + slPrice.toFixed(2) + ' TP=$' + tpPrice.toFixed(2))
    try { if (typeof w._aresRender === 'function') w._aresRender() } catch (_) { }
    return pos

  } catch (err: any) {
    wallet.release(stakeVirtual)
    w.ARES.push('[ARES EXEC FAIL] ' + (err.message || err))
    console.error('[ARES_EXECUTE] Order failed:', err)
    return null
  }
}
