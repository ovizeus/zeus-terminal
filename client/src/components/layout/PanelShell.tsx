import { usePositionsStore, useATStore, useBrainStore, useMarketStore } from '../../stores'
import { TradingChart } from '../chart/TradingChart'

export function PanelShell() {
  const demoCount = usePositionsStore((s) => s.demoPositions.length)
  const liveCount = usePositionsStore((s) => s.livePositions.length)
  const demoBalance = usePositionsStore((s) => s.demoBalance)
  const atEnabled = useATStore((s) => s.enabled)
  const atMode = useATStore((s) => s.mode)
  const atTrades = useATStore((s) => s.totalTrades)
  const atWins = useATStore((s) => s.wins)
  const atLosses = useATStore((s) => s.losses)
  const atPnL = useATStore((s) => s.totalPnL)
  const atKill = useATStore((s) => s.killTriggered)
  const brainMode = useBrainStore((s) => s.brain.mode)
  const confluence = useBrainStore((s) => s.brain.confluenceScore)
  const price = useMarketStore((s) => s.market.price)
  const symbol = useMarketStore((s) => s.market.symbol)

  return (
    <main className="zr-panels">
      <section className="zr-panel zr-panel--chart" data-panel="chart">
        <div className="zr-panel__header">
          {symbol} — ${price > 0 ? price.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '—'}
        </div>
        <div className="zr-panel__body zr-panel__body--chart">
          <TradingChart />
        </div>
      </section>

      <section className="zr-panel" data-panel="positions">
        <div className="zr-panel__header">Positions</div>
        <div className="zr-panel__body">
          <div className="zr-kv">
            <span className="zr-kv__label">Demo Balance</span>
            <span className="zr-kv__value">${demoBalance.toLocaleString()}</span>
          </div>
          <div className="zr-kv">
            <span className="zr-kv__label">Demo Open</span>
            <span className="zr-kv__value">{demoCount}</span>
          </div>
          <div className="zr-kv">
            <span className="zr-kv__label">Live Open</span>
            <span className="zr-kv__value">{liveCount}</span>
          </div>
        </div>
      </section>

      <section className="zr-panel" data-panel="brain">
        <div className="zr-panel__header">Brain Cockpit</div>
        <div className="zr-panel__body">
          <div className="zr-kv">
            <span className="zr-kv__label">Mode</span>
            <span className="zr-kv__value">{brainMode}</span>
          </div>
          <div className="zr-kv">
            <span className="zr-kv__label">Confluence</span>
            <span className="zr-kv__value">{confluence}</span>
          </div>
        </div>
      </section>

      <section className="zr-panel" data-panel="at">
        <div className="zr-panel__header">AutoTrade</div>
        <div className="zr-panel__body">
          <div className="zr-kv">
            <span className="zr-kv__label">Status</span>
            <span className={`zr-kv__value ${atKill ? 'zr-kv__value--red' : atEnabled ? 'zr-kv__value--grn' : ''}`}>
              {atKill ? 'KILLED' : atEnabled ? 'ON' : 'OFF'}
            </span>
          </div>
          <div className="zr-kv">
            <span className="zr-kv__label">Mode</span>
            <span className="zr-kv__value">{atMode}</span>
          </div>
          <div className="zr-kv">
            <span className="zr-kv__label">Trades</span>
            <span className="zr-kv__value">{atTrades} ({atWins}W / {atLosses}L)</span>
          </div>
          <div className="zr-kv">
            <span className="zr-kv__label">Total PnL</span>
            <span className={`zr-kv__value ${atPnL >= 0 ? 'zr-kv__value--grn' : 'zr-kv__value--red'}`}>
              ${atPnL.toFixed(2)}
            </span>
          </div>
        </div>
      </section>
    </main>
  )
}
