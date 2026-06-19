import { useEffect, useState, useRef } from 'react'
import { VerdictBand } from './theia/VerdictBand'
import { BrainPulseCard } from './theia/BrainPulseCard'
import { EnginePositionsCard } from './theia/EnginePositionsCard'
import { MarketLensCard } from './theia/MarketLensCard'

// THEIA — read-only all-seeing oracle. Live modules read Zustand stores / the window.S
// bridge directly (refreshed by the tick). Endpoint-sourced inputs are fetched here and
// passed down (wired in Task 4). REAL data only — never fabricated.
export function TheiaPage() {
  const [, setTick] = useState(0)
  // Endpoint-derived state (filled by Task 4 fetches). null = "not yet known" → shown as
  // pending, never as a fake-healthy value.
  const [circuitOpen] = useState<boolean | null>(null)
  const [halted] = useState<boolean | null>(null)
  const [parityPct] = useState<number | null>(null)
  const [pnlTrend] = useState<'up' | 'flat' | 'down' | 'unknown'>('unknown')
  const acRef = useRef<AbortController | null>(null)

  useEffect(() => {
    let alive = true
    const poll = () => { if (alive) setTick((t) => t + 1) }
    const id = setInterval(poll, 12000)
    return () => { alive = false; clearInterval(id); try { acRef.current?.abort() } catch (_) { /* */ } }
  }, [])

  return (
    <div className="theia-page">
      <div className="theia-grid">
        <VerdictBand circuitOpen={circuitOpen} halted={halted} parityPct={parityPct} testnetPnlTrend={pnlTrend} />
        <BrainPulseCard />
        <EnginePositionsCard />
        <MarketLensCard />
      </div>
    </div>
  )
}
