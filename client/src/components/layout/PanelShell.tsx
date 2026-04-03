import { useState } from 'react'
import { useBrainStore, useMarketStore } from '../../stores'
import { TradingChart } from '../chart/TradingChart'
import { PositionTable } from '../trading/PositionTable'
import { ATPanel } from '../trading/ATPanel'

type PosTab = 'demo' | 'live'

export function PanelShell() {
  const brainMode = useBrainStore((s) => s.brain.mode)
  const confluence = useBrainStore((s) => s.brain.confluenceScore)
  const regime = useBrainStore((s) => s.brain.regimeEngine.regime)
  const danger = useBrainStore((s) => s.brain.danger)
  const price = useMarketStore((s) => s.market.price)
  const symbol = useMarketStore((s) => s.market.symbol)
  const [posTab, setPosTab] = useState<PosTab>('demo')

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
        <div className="zr-panel__header">
          <div className="zr-panel__header-tabs">
            <button
              className={`zr-panel__header-tab ${posTab === 'demo' ? 'zr-panel__header-tab--active' : ''}`}
              onClick={() => setPosTab('demo')}
            >
              Demo
            </button>
            <button
              className={`zr-panel__header-tab ${posTab === 'live' ? 'zr-panel__header-tab--active' : ''}`}
              onClick={() => setPosTab('live')}
            >
              Live
            </button>
          </div>
        </div>
        <div className="zr-panel__body">
          <PositionTable mode={posTab} />
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
          <div className="zr-kv">
            <span className="zr-kv__label">Regime</span>
            <span className="zr-kv__value">{regime}</span>
          </div>
          <div className="zr-kv">
            <span className="zr-kv__label">Danger</span>
            <span className={`zr-kv__value ${danger > 60 ? 'zr-kv__value--red' : danger > 30 ? 'zr-kv__value--ylw' : ''}`}>
              {danger}
            </span>
          </div>
        </div>
      </section>

      <section className="zr-panel" data-panel="at">
        <div className="zr-panel__header">AutoTrade</div>
        <div className="zr-panel__body">
          <ATPanel />
        </div>
      </section>
    </main>
  )
}
