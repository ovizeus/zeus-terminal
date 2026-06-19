import { useATStore } from '../../../stores/atStore'

// Safety & health — REAL reads from the window.S bridge (feed/freshness) + atStore (kill)
// + endpoint-derived rate pressure / circuit (props from TheiaPage). '—' when absent.
const pct = (v: number | null) => (typeof v === 'number' && isFinite(v) ? `${v.toFixed(0)}%` : '—')

export interface SafetyHealthProps {
  ratePressurePct: number | null
  circuitOpen: boolean | null
}

export function SafetyHealthCard(props: SafetyHealthProps) {
  const killTriggered = useATStore((s: any) => s.killTriggered)
  const w = window as any
  const S = w.S || {}
  const stalled = S.dataStalled
  const feed = (ok: any) => (ok === undefined ? '—' : ok ? 'ok' : 'down')
  return (
    <div className="theia-card">
      <h4>🛡️ Safety &amp; health</h4>
      <div className="theia-rows">
        <div><span>Data feed</span><b style={{ color: stalled ? '#ff6680' : undefined }}>{stalled === undefined ? '—' : stalled ? 'STALLED' : 'fresh'}</b></div>
        <div><span>Circuit / ban</span><b style={{ color: props.circuitOpen ? '#ff6680' : undefined }}>{props.circuitOpen == null ? '—' : props.circuitOpen ? 'OPEN' : 'closed'}</b></div>
        <div><span>Rate pressure</span><b>{pct(props.ratePressurePct)}</b></div>
        <div><span>Binance feed</span><b>{feed(S.bnbOk)}</b></div>
        <div><span>Bybit feed</span><b>{feed(S.bybOk)}</b></div>
        <div><span>Kill-switch</span><b style={{ color: killTriggered ? '#ff6680' : undefined }}>{killTriggered === undefined ? '—' : killTriggered ? 'TRIGGERED' : 'armed/ok'}</b></div>
      </div>
    </div>
  )
}
