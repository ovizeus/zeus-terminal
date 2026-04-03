import { usePositionsStore, useATStore, useBrainStore } from '../../stores'

export function PanelShell() {
  const demoCount = usePositionsStore((s) => s.demoPositions.length)
  const liveCount = usePositionsStore((s) => s.livePositions.length)
  const demoBalance = usePositionsStore((s) => s.demoBalance)
  const atEnabled = useATStore((s) => s.enabled)
  const atMode = useATStore((s) => s.mode)
  const brainMode = useBrainStore((s) => s.brain.mode)
  const confluence = useBrainStore((s) => s.brain.confluenceScore)

  return (
    <main className="zr-panels">
      <section className="zr-panel" data-panel="chart">
        <div className="zr-panel__header">Chart</div>
        <div className="zr-panel__body zr-panel__body--chart">
          Chart placeholder — will wrap Lightweight Charts in Phase 2
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
            <span className="zr-kv__label">Enabled</span>
            <span className={`zr-kv__value ${atEnabled ? 'zr-kv__value--grn' : ''}`}>
              {atEnabled ? 'ON' : 'OFF'}
            </span>
          </div>
          <div className="zr-kv">
            <span className="zr-kv__label">Mode</span>
            <span className="zr-kv__value">{atMode}</span>
          </div>
        </div>
      </section>
    </main>
  )
}
