import { computeTheiaVerdict } from './theiaVerdict'
import type { TheiaVerdictInput } from './theiaVerdict'
import { useATStore } from '../../../stores/atStore'
import { useBrainStore } from '../../../stores/brainStore'

// Endpoint-sourced inputs arrive from TheiaPage (real /api reads). Store/bridge inputs are
// read here directly. Everything REAL — no fabricated values.
export interface VerdictBandProps {
  circuitOpen: boolean | null
  halted: boolean | null
  parityPct: number | null
  testnetPnlTrend: 'up' | 'flat' | 'down' | 'unknown'
}

export function VerdictBand(props: VerdictBandProps) {
  const killTriggered = useATStore((s: any) => !!s.killTriggered)
  const regime = useBrainStore((s: any) => s.regimeEngine?.regime)
  const w = window as any
  const dataStalled = !!(w.S && w.S.dataStalled)
  // Pending endpoint inputs (null) are shown as such and treated conservatively by the
  // verdict (null parity = unknown → not counted as healthy; null halt/circuit = treat as
  // not-failing but flagged "pending" in the chips so green is never faked).
  const input: TheiaVerdictInput = {
    circuitOpen: !!props.circuitOpen,
    halted: !!props.halted,
    dataStalled,
    killTriggered,
    parityPct: props.parityPct,
    regimeStable: !!regime && regime !== 'unknown',
    testnetPnlTrend: props.testnetPnlTrend,
  }
  const v = computeTheiaVerdict(input)
  const dot = v.level === 'green' ? '#00d97a' : v.level === 'amber' ? '#f0b429' : '#ff3b5c'
  const pending = (k: string): boolean =>
    (k === 'parity' && props.parityPct == null) ||
    ((k === 'circuit') && props.circuitOpen == null) ||
    ((k === 'halt') && props.halted == null) ||
    (k === 'pnl' && props.testnetPnlTrend === 'unknown')
  return (
    <div className="theia-card theia-hero theia-verdict">
      <div className="theia-verdict-head">
        <span className="theia-verdict-dot" style={{ background: dot, boxShadow: `0 0 10px ${dot}` }} />
        <span className="theia-verdict-level" style={{ color: dot }}>{v.level.toUpperCase()}</span>
        <span className="theia-verdict-reason">{v.reason}</span>
      </div>
      <div className="theia-verdict-chips">
        {v.breakdown.map((b) => (
          <span key={b.key} className={`theia-chip ${pending(b.key) ? 'pending' : b.ok ? 'ok' : 'bad'}`}>
            {b.key}: {pending(b.key) ? '—' : b.ok ? '✓' : '✕'}
          </span>
        ))}
      </div>
    </div>
  )
}
