import { useBrainStore } from '../../../stores/brainStore'

// Brain live pulse — REAL reads from brainStore. '—' when a field is genuinely absent.
const dash = (v: any) => (v === undefined || v === null || v === '' ? '—' : String(v))

export function BrainPulseCard() {
  // [2026-10-11] Four of these five used to read from the store's TOP level,
  // where they do not exist. Only `brainState` lives there; `regimeEngine`,
  // `entryReady`, `entryScore` and `gates` all live under `brain`. So Regime,
  // Entry ready, Entry score and Gates rendered an em dash permanently, and
  // the dash looked like "no data yet" rather than like a bug. Pre-existing —
  // identical at the pre-institutional-redesign tag — and invisible to the
  // compiler because the selectors are typed `(s: any)`.
  const brainState = useBrainStore((s: any) => s.brainState)
  const regime = useBrainStore((s: any) => s.brain?.regimeEngine?.regime)
  const entryReady = useBrainStore((s: any) => s.brain?.entryReady)
  const entryScore = useBrainStore((s: any) => s.brain?.entryScore)
  const gates = useBrainStore((s: any) => s.brain?.gates) || {}
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
