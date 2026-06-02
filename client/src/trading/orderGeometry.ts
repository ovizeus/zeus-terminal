// Pure order geometry — MUST stay bit-identical to server/services/orderGeometry.js.
export interface GeometryInput {
  side: 'LONG' | 'SHORT'; price: number; margin: number; lev: number; slPct: number; rr: number
}
export function computeOrderGeometry({ side, price, margin, lev, slPct, rr }: GeometryInput) {
  const slDist = price * slPct / 100
  const tpDist = slDist * rr
  const isLong = side === 'LONG'
  const sl = isLong ? price - slDist : price + slDist
  const tp = isLong ? price + tpDist : price - tpDist
  const qty = (margin * lev) / price
  const tpPnl = (tpDist / price) * margin * lev
  const slPnl = -(slDist / price) * margin * lev
  return { qty, sl, tp, slPnl, tpPnl, slDist, tpDist }
}
