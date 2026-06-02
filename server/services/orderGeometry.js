'use strict';
// Pure order geometry — shared structural math for client & server sizing parity.
// Margin selection (riskPct vs Kelly) is OUT of scope and computed by callers.
function computeOrderGeometry({ side, price, margin, lev, slPct, rr }) {
  const slDist = price * slPct / 100;
  const tpDist = slDist * rr;
  const isLong = side === 'LONG';
  const sl = isLong ? price - slDist : price + slDist;
  const tp = isLong ? price + tpDist : price - tpDist;
  const qty = (margin * lev) / price;
  const tpPnl = (tpDist / price) * margin * lev;
  const slPnl = -(slDist / price) * margin * lev;
  return { qty, sl, tp, slPnl, tpPnl, slDist, tpDist };
}
module.exports = { computeOrderGeometry };
