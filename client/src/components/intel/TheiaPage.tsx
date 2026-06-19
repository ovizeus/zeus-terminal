import { useEffect, useState, useRef, useCallback } from 'react'
import { VerdictBand } from './theia/VerdictBand'
import { BrainPulseCard } from './theia/BrainPulseCard'
import { EnginePositionsCard } from './theia/EnginePositionsCard'
import { MarketLensCard } from './theia/MarketLensCard'
import { SinceCard } from './theia/SinceCard'
import { SafetyHealthCard } from './theia/SafetyHealthCard'
import { MlDigestCard } from './theia/MlDigestCard'
import { MemorySection } from './theia/MemorySection'
import { useATStore } from '../../stores/atStore'

// THEIA — read-only all-seeing oracle. Live modules read stores / the window.S bridge
// directly; endpoint-sourced inputs are fetched here and passed down. REAL data only —
// when a source is genuinely unavailable a value is null/'—' (pending), never fabricated.
export interface TheiaEndpointState {
  parityPct: number | null
  circuitOpen: boolean | null
  ratePressurePct: number | null
}

async function _safeJson(path: string, signal: AbortSignal): Promise<any | null> {
  try {
    const r = await fetch(path, { credentials: 'same-origin', signal })
    if (!r || !r.ok) return null
    return await r.json()
  } catch (_) { return null }
}

// Defensively extract a 0..1 parity match ratio from the parity report's varied shapes.
function _extractParityPct(d: any): number | null {
  if (!d) return null
  const cand = d.primary || d
  const pct = cand.matchPct ?? cand.pct ?? cand.matchRatio ?? d.matchPct
  if (typeof pct === 'number' && isFinite(pct)) return pct > 1 ? pct / 100 : pct
  const matched = cand.matched ?? cand.matches ?? cand.match
  const total = cand.total ?? cand.count ?? cand.n
  if (typeof matched === 'number' && typeof total === 'number' && total > 0) return matched / total
  return null
}

export function TheiaPage() {
  const [, setTick] = useState(0)
  const [ep, setEp] = useState<TheiaEndpointState>({ parityPct: null, circuitOpen: null, ratePressurePct: null })
  const acRef = useRef<AbortController | null>(null)
  const realizedDaily = useATStore((s: any) => s.realizedDailyPnL)

  const refresh = useCallback(async () => {
    try { acRef.current?.abort() } catch (_) { /* */ }
    const ac = new AbortController(); acRef.current = ac
    const [parity, telem] = await Promise.all([
      _safeJson('/api/brain/parity/report', ac.signal),
      _safeJson('/api/binance-telemetry', ac.signal),
    ])
    if (ac.signal.aborted) return
    const parityPct = _extractParityPct(parity)
    // telemetry: derive rate pressure + circuit/ban state defensively (real fields vary).
    let ratePressurePct: number | null = null
    let circuitOpen: boolean | null = null
    if (telem) {
      const qp = telem.quotaPressure ?? telem.pressure ?? telem?.binance?.quotaPressure
      if (typeof qp === 'number' && isFinite(qp)) ratePressurePct = qp > 1 ? qp : qp * 100
      const banned = telem.banned ?? telem.ipBan ?? telem.circuitOpen ?? telem?.rateState === 'SUPPRESSED'
      if (typeof banned === 'boolean') circuitOpen = banned
    }
    setEp({ parityPct, circuitOpen, ratePressurePct })
  }, [])

  useEffect(() => {
    let alive = true
    refresh()
    const id = setInterval(() => { if (alive) { setTick((t) => t + 1); refresh() } }, 12000)
    return () => { alive = false; clearInterval(id); try { acRef.current?.abort() } catch (_) { /* */ } }
  }, [refresh])

  // testnet/realized P&L trend from the REAL today-realized value (atStore).
  const pnlTrend: 'up' | 'flat' | 'down' | 'unknown' =
    typeof realizedDaily !== 'number' ? 'unknown' : realizedDaily > 0.01 ? 'up' : realizedDaily < -0.01 ? 'down' : 'flat'

  return (
    <div className="theia-page">
      <div className="theia-grid">
        <VerdictBand circuitOpen={ep.circuitOpen} halted={null} parityPct={ep.parityPct} testnetPnlTrend={pnlTrend} />
        <SinceCard />
        <BrainPulseCard />
        <EnginePositionsCard />
        <SafetyHealthCard ratePressurePct={ep.ratePressurePct} circuitOpen={ep.circuitOpen} />
        <MarketLensCard />
        <MlDigestCard />
        <MemorySection />
      </div>
    </div>
  )
}
