import { useState } from 'react'
import { useMarketStore } from '../../stores'
import { TradingChart } from '../chart/TradingChart'
import { PositionTable } from '../trading/PositionTable'
import { ATPanel } from '../trading/ATPanel'
import { BrainCockpit } from '../brain/BrainCockpit'
import { ForecastPanel } from '../brain/ForecastPanel'
import { DeepDivePanel } from '../brain/DeepDivePanel'

type PosTab = 'demo' | 'live'
type BrainTab = 'cockpit' | 'forecast' | 'deepdive'

export function PanelShell() {
  const price = useMarketStore((s) => s.market.price)
  const symbol = useMarketStore((s) => s.market.symbol)
  const [posTab, setPosTab] = useState<PosTab>('demo')
  const [brainTab, setBrainTab] = useState<BrainTab>('cockpit')

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
        <div className="zr-panel__header">
          <div className="zr-panel__header-tabs">
            <button
              className={`zr-panel__header-tab ${brainTab === 'cockpit' ? 'zr-panel__header-tab--active' : ''}`}
              onClick={() => setBrainTab('cockpit')}
            >
              Cockpit
            </button>
            <button
              className={`zr-panel__header-tab ${brainTab === 'forecast' ? 'zr-panel__header-tab--active' : ''}`}
              onClick={() => setBrainTab('forecast')}
            >
              Forecast
            </button>
            <button
              className={`zr-panel__header-tab ${brainTab === 'deepdive' ? 'zr-panel__header-tab--active' : ''}`}
              onClick={() => setBrainTab('deepdive')}
            >
              Deep Dive
            </button>
          </div>
        </div>
        <div className="zr-panel__body">
          {brainTab === 'cockpit' && <BrainCockpit />}
          {brainTab === 'forecast' && <ForecastPanel />}
          {brainTab === 'deepdive' && <DeepDivePanel />}
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
