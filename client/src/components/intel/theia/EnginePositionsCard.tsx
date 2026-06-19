import { useAresStore } from '../../../stores/aresStore'
import { usePositionsStore } from '../../../stores/positionsStore'

// Engine & positions — REAL reads from aresStore + positionsStore. '—' when absent.
const dash = (v: any) => (v === undefined || v === null || v === '' ? '—' : String(v))
const usd = (v: any) => (typeof v === 'number' && isFinite(v) ? `$${v.toFixed(2)}` : '—')

export function EnginePositionsCard() {
  const serverSide = useAresStore((s: any) => s.serverSide)
  const stageName = useAresStore((s: any) => s.stageName)
  const aresBalance = useAresStore((s: any) => s.balance)
  const aresRealized = useAresStore((s: any) => s.realizedPnL)
  const lastDecision = useAresStore((s: any) => s.lastDecision) || {}
  const live = usePositionsStore((s: any) => s.livePositions) || []
  const demo = usePositionsStore((s: any) => s.demoPositions) || []
  const liveBal = usePositionsStore((s: any) => s.liveBalance) || {}
  const liveConnected = usePositionsStore((s: any) => s.liveConnected)
  return (
    <div className="theia-card">
      <h4>⚔️ Engine & positions</h4>
      <div className="theia-rows">
        <div><span>ARES owner</span><b>{serverSide === undefined ? '—' : serverSide ? 'SERVER' : 'client'}</b></div>
        <div><span>ARES stage</span><b>{dash(stageName)}</b></div>
        <div><span>ARES decision</span><b>{dash(lastDecision.action || lastDecision.state)}</b></div>
        <div><span>Live positions</span><b>{Array.isArray(live) ? live.length : '—'}{liveConnected ? '' : ' (off)'}</b></div>
        <div><span>Demo positions</span><b>{Array.isArray(demo) ? demo.length : '—'}</b></div>
        <div><span>Live uPnL</span><b>{usd(liveBal.unrealizedPnL)}</b></div>
        <div><span>ARES wallet</span><b>{usd(aresBalance)}</b></div>
        <div><span>ARES realized</span><b>{usd(aresRealized)}</b></div>
      </div>
    </div>
  )
}
