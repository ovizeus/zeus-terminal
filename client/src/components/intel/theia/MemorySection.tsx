import { useAresStore } from '../../../stores/aresStore'
import { useATStore } from '../../../stores/atStore'
import { useBrainStore } from '../../../stores/brainStore'

// Memory — REAL historical scalars from stores + the AT global. No fabricated curve;
// shows the real session/day memory values. '—' when a field is genuinely absent.
const usd = (v: any) => (typeof v === 'number' && isFinite(v) ? `${v >= 0 ? '+' : ''}$${v.toFixed(2)}` : '—')
const dash = (v: any) => (v === undefined || v === null || v === '' ? '—' : String(v))

export function MemorySection() {
  const realizedDaily = useATStore((s: any) => s.realizedDailyPnL)
  const stageName = useAresStore((s: any) => s.stageName)
  const stageProgress = useAresStore((s: any) => s.stageProgress)
  const fundedTotal = useAresStore((s: any) => s.fundedTotal)
  const aresRealized = useAresStore((s: any) => s.realizedPnL)
  const thoughts = useBrainStore((s: any) => s.thoughts)
  const w = window as any
  const AT = w.AT || {}
  const realized = typeof realizedDaily === 'number' ? realizedDaily : AT.realizedDailyPnL
  const closedToday = AT.closedTradesToday
  const lastThought = Array.isArray(thoughts) && thoughts.length ? (thoughts[0]?.text ?? thoughts[0]) : null
  return (
    <div className="theia-card theia-hero">
      <h4>📜 Memory</h4>
      <div className="theia-mem-grid">
        <div className="theia-mem-cell"><span>Realized (today)</span><b>{usd(realized)}</b></div>
        <div className="theia-mem-cell"><span>Closed (today)</span><b>{closedToday === undefined ? '—' : String(closedToday)}</b></div>
        <div className="theia-mem-cell"><span>ARES realized</span><b>{usd(aresRealized)}</b></div>
        <div className="theia-mem-cell"><span>ARES funded</span><b>{usd(fundedTotal)}</b></div>
        <div className="theia-mem-cell"><span>ARES stage</span><b>{dash(stageName)}{typeof stageProgress === 'number' ? ` ${Math.round(stageProgress)}%` : ''}</b></div>
      </div>
      {lastThought ? <div className="theia-mem-note">Last brain note: {String(lastThought)}</div> : null}
    </div>
  )
}
