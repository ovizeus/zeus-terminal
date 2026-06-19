import { useBrainStore } from '../../../stores/brainStore'

// Brain live pulse — REAL reads from brainStore. '—' when a field is genuinely absent.
const dash = (v: any) => (v === undefined || v === null || v === '' ? '—' : String(v))

export function BrainPulseCard() {
  const brainState = useBrainStore((s: any) => s.brainState)
  const regime = useBrainStore((s: any) => s.regimeEngine?.regime)
  const entryReady = useBrainStore((s: any) => s.entryReady)
  const entryScore = useBrainStore((s: any) => s.entryScore)
  const gates = useBrainStore((s: any) => s.gates) || {}
  const gateKeys = Object.keys(gates)
  const gatesOpen = gateKeys.filter((k) => gates[k] === true || gates[k]?.ok === true).length
  return (
    <div className="theia-card">
      <h4>🧠 Brain pulse</h4>
      <div className="theia-rows">
        <div><span>Engine</span><b>{dash(brainState)}</b></div>
        <div><span>Regime</span><b>{dash(regime)}</b></div>
        <div><span>Entry ready</span><b>{entryReady === undefined ? '—' : entryReady ? 'YES' : 'no'}</b></div>
        <div><span>Entry score</span><b>{dash(entryScore)}</b></div>
        <div><span>Gates</span><b>{gateKeys.length ? `${gatesOpen}/${gateKeys.length} open` : '—'}</b></div>
      </div>
    </div>
  )
}
