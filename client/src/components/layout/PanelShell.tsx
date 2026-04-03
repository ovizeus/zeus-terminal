import { useState, type ReactNode } from 'react'
import { useMarketStore } from '../../stores'
import { TradingChart } from '../chart/TradingChart'
import { PositionTable } from '../trading/PositionTable'
import { ATPanel } from '../trading/ATPanel'
import { BrainCockpit } from '../brain/BrainCockpit'
import { ForecastPanel } from '../brain/ForecastPanel'
import { DeepDivePanel } from '../brain/DeepDivePanel'
import { OrderFlowPanel } from '../advanced/OrderFlowPanel'
import { TeacherPanel } from '../advanced/TeacherPanel'
import { JournalPanel } from '../advanced/JournalPanel'
import { ErrorBoundary } from '../ErrorBoundary'

/** Collapsible strip panel — matches old frontend's strip layout */
function Strip({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="zr-panel">
      <button className="zr-strip__toggle" onClick={() => setOpen(!open)}>
        <span>{title}</span>
        <span className={`zr-strip__chevron ${open ? 'zr-strip__chevron--open' : ''}`}>▶</span>
      </button>
      <div className={`zr-panel__body ${open ? '' : 'zr-panel__body--collapsed'}`}>
        <ErrorBoundary>{children}</ErrorBoundary>
      </div>
    </section>
  )
}

type PosTab = 'demo' | 'live' | 'journal'
type BrainTab = 'cockpit' | 'forecast' | 'deepdive'

export function PanelShell() {
  const price = useMarketStore((s) => s.market.price)
  const symbol = useMarketStore((s) => s.market.symbol)
  const [posTab, setPosTab] = useState<PosTab>('demo')
  const [brainTab, setBrainTab] = useState<BrainTab>('cockpit')

  return (
    <main className="zr-panels">
      {/* ── Chart — always visible, prominent ── */}
      <section className="zr-panel zr-panel--chart" data-panel="chart">
        <div className="zr-panel__header">
          {symbol} — ${price > 0 ? price.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '—'}
        </div>
        <div className="zr-panel__body zr-panel__body--chart">
          <ErrorBoundary><TradingChart /></ErrorBoundary>
        </div>
      </section>

      {/* ── Positions / Journal ── */}
      <Strip title="POSITIONS" defaultOpen>
        <div className="zr-panel__header-tabs" style={{ marginBottom: 8 }}>
          {(['demo', 'live', 'journal'] as PosTab[]).map((t) => (
            <button
              key={t}
              className={`zr-panel__header-tab ${posTab === t ? 'zr-panel__header-tab--active' : ''}`}
              onClick={() => setPosTab(t)}
            >
              {t === 'demo' ? 'Demo' : t === 'live' ? 'Live' : 'Journal'}
            </button>
          ))}
        </div>
        {posTab === 'journal' ? <JournalPanel /> : <PositionTable mode={posTab} />}
      </Strip>

      {/* ── Brain ── */}
      <Strip title="BRAIN" defaultOpen>
        <div className="zr-panel__header-tabs" style={{ marginBottom: 8 }}>
          {(['cockpit', 'forecast', 'deepdive'] as BrainTab[]).map((t) => (
            <button
              key={t}
              className={`zr-panel__header-tab ${brainTab === t ? 'zr-panel__header-tab--active' : ''}`}
              onClick={() => setBrainTab(t)}
            >
              {t === 'cockpit' ? 'Cockpit' : t === 'forecast' ? 'Forecast' : 'Deep Dive'}
            </button>
          ))}
        </div>
        {brainTab === 'cockpit' && <BrainCockpit />}
        {brainTab === 'forecast' && <ForecastPanel />}
        {brainTab === 'deepdive' && <DeepDivePanel />}
      </Strip>

      {/* ── AutoTrade ── */}
      <Strip title="AUTOTRADE" defaultOpen>
        <ATPanel />
      </Strip>

      {/* ── Flow ── */}
      <Strip title="FLOW">
        <OrderFlowPanel />
      </Strip>

      {/* ── Teacher ── */}
      <Strip title="TEACHER">
        <TeacherPanel />
      </Strip>
    </main>
  )
}
