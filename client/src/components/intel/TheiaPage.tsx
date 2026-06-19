import { useEffect, useState, useRef } from 'react'

// THEIA — read-only all-seeing oracle. Module components are added in later tasks;
// this shell owns the endpoint-poll lifecycle and lays out the hero + grid. REAL data only.
export function TheiaPage() {
  const [, setTick] = useState(0)
  const acRef = useRef<AbortController | null>(null)
  useEffect(() => {
    let alive = true
    const poll = () => { if (alive) setTick(t => t + 1) } // modules self-fetch; tick drives refresh cadence
    const id = setInterval(poll, 12000)
    return () => { alive = false; clearInterval(id); try { acRef.current?.abort() } catch (_) { /* */ } }
  }, [])
  return (
    <div className="theia-page">
      <div className="theia-grid">
        {/* Module cards are added in Tasks 3–4 */}
        <div className="theia-card theia-empty">THEIA — modules loading…</div>
      </div>
    </div>
  )
}
