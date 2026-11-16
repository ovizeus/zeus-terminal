import { useEffect, useState } from 'react'
import { startPoll } from '../../../utils/poll'
import { useDslStore } from '../../../stores/dslStore'

// ML / OMEGA digest — REAL reads. Reuses the existing OMEGA mood/health endpoints (the same
// ones OmegaPage/DoctorPanel call). '—' when a field is genuinely absent.
const dash = (v: any) => (v === undefined || v === null || v === '' ? '—' : String(v))

export function MlDigestCard() {
  const [mood, setMood] = useState<any>(null)
  const [health, setHealth] = useState<any>(null)
  const dslMode = useDslStore((s: any) => s.mode ?? s.dslMode)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const r = await fetch('/api/omega/mood', { credentials: 'same-origin' })
        if (alive && r.ok) setMood(await r.json())
      } catch (_) { /* */ }
      try {
        const r = await fetch('/api/omega/health', { credentials: 'same-origin' })
        if (alive && r.ok) setHealth(await r.json())
      } catch (_) { /* */ }
    }
    const stop = startPoll(load, 15000)   // [2026-11-16] nimic in fundal, fara suprapuneri
    return () => { alive = false; stop() }
  }, [])

  const moodLabel = mood?.mood ?? mood?.state ?? mood?.current
  const ringsOk = health?.ringsOk ?? health?.healthy ?? health?.ok
  const ringsTotal = health?.ringsTotal ?? health?.total ?? (Array.isArray(health?.rings) ? health.rings.length : undefined)
  return (
    <div className="theia-card">
      <h4>🤖 ML / OMEGA digest</h4>
      <div className="theia-rows">
        <div><span>Mood</span><b>{dash(moodLabel)}</b></div>
        <div><span>Ring health</span><b>{ringsOk !== undefined && ringsTotal !== undefined ? `${ringsOk}/${ringsTotal}` : dash(ringsOk)}</b></div>
        <div><span>DSL mode</span><b>{dash(dslMode)}</b></div>
      </div>
    </div>
  )
}
