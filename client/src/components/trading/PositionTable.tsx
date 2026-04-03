import { usePositionsStore, useMarketStore } from '../../stores'
import type { Position } from '../../types'

function calcPnl(pos: Position, currentPrice: number): number {
  if (!currentPrice || currentPrice <= 0) return 0
  const diff = pos.side === 'LONG' ? currentPrice - pos.price : pos.price - currentPrice
  return (diff / pos.price) * pos.size * pos.lev
}

function calcPnlPct(pos: Position, currentPrice: number): number {
  if (!currentPrice || currentPrice <= 0) return 0
  const diff = pos.side === 'LONG' ? currentPrice - pos.price : pos.price - currentPrice
  return (diff / pos.price) * 100 * pos.lev
}

function PositionRow({ pos, currentPrice }: { pos: Position; currentPrice: number }) {
  const pnl = calcPnl(pos, currentPrice)
  const pnlPct = calcPnlPct(pos, currentPrice)
  const isProfit = pnl >= 0

  return (
    <tr className="zr-pos-row">
      <td className="zr-pos-cell">
        <span className={`zr-pos-side ${pos.side === 'LONG' ? 'zr-pos-side--long' : 'zr-pos-side--short'}`}>
          {pos.side}
        </span>
      </td>
      <td className="zr-pos-cell">{pos.symbol}</td>
      <td className="zr-pos-cell zr-pos-cell--right">${pos.size}</td>
      <td className="zr-pos-cell zr-pos-cell--right">{pos.lev}x</td>
      <td className="zr-pos-cell zr-pos-cell--right">{pos.price.toFixed(2)}</td>
      <td className="zr-pos-cell zr-pos-cell--right">
        {pos.sl > 0 ? pos.sl.toFixed(2) : '—'}
      </td>
      <td className="zr-pos-cell zr-pos-cell--right">
        {pos.tp > 0 ? pos.tp.toFixed(2) : '—'}
      </td>
      <td className={`zr-pos-cell zr-pos-cell--right ${isProfit ? 'zr-pos-cell--grn' : 'zr-pos-cell--red'}`}>
        ${pnl.toFixed(2)} ({pnlPct.toFixed(2)}%)
      </td>
      <td className="zr-pos-cell zr-pos-cell--center">
        {pos.autoTrade ? 'AT' : 'Manual'}
      </td>
    </tr>
  )
}

export function PositionTable({ mode }: { mode: 'demo' | 'live' }) {
  const positions = mode === 'demo'
    ? usePositionsStore((s) => s.demoPositions)
    : usePositionsStore((s) => s.livePositions)
  const balance = mode === 'demo'
    ? usePositionsStore((s) => s.demoBalance)
    : usePositionsStore((s) => s.liveBalance.totalBalance)
  const currentPrice = useMarketStore((s) => s.market.price)

  const openPositions = positions.filter((p) => p.status === 'OPEN')
  const totalUnrealized = openPositions.reduce((sum, p) => sum + calcPnl(p, currentPrice), 0)

  return (
    <div className="zr-pos-table-wrap">
      <div className="zr-pos-summary">
        <span className="zr-pos-summary__item">
          Balance: <strong>${balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
        </span>
        <span className="zr-pos-summary__item">
          Open: <strong>{openPositions.length}</strong>
        </span>
        <span className={`zr-pos-summary__item ${totalUnrealized >= 0 ? 'zr-pos-summary__item--grn' : 'zr-pos-summary__item--red'}`}>
          uPnL: <strong>${totalUnrealized.toFixed(2)}</strong>
        </span>
      </div>

      {openPositions.length === 0 ? (
        <div className="zr-pos-empty">No open positions</div>
      ) : (
        <table className="zr-pos-table">
          <thead>
            <tr>
              <th className="zr-pos-th">Side</th>
              <th className="zr-pos-th">Symbol</th>
              <th className="zr-pos-th zr-pos-th--right">Size</th>
              <th className="zr-pos-th zr-pos-th--right">Lev</th>
              <th className="zr-pos-th zr-pos-th--right">Entry</th>
              <th className="zr-pos-th zr-pos-th--right">SL</th>
              <th className="zr-pos-th zr-pos-th--right">TP</th>
              <th className="zr-pos-th zr-pos-th--right">PnL</th>
              <th className="zr-pos-th zr-pos-th--center">Source</th>
            </tr>
          </thead>
          <tbody>
            {openPositions.map((pos) => (
              <PositionRow key={pos.seq} pos={pos} currentPrice={currentPrice} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
