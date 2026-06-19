import { useMarketRadarStore } from '../../../stores/marketRadarStore'
import { useBrainStore } from '../../../stores/brainStore'

// Market lens — REAL reads from the window.S canonical bridge (price/oi/funding/atr) +
// marketRadarStore (movers) + brain regime. '—' when a field is genuinely absent.
const dash = (v: any) => (v === undefined || v === null || v === '' || (typeof v === 'number' && !isFinite(v)) ? '—' : String(v))
const num = (v: any, d = 2) => (typeof v === 'number' && isFinite(v) ? v.toFixed(d) : '—')

export function MarketLensCard() {
  const regime = useBrainStore((s: any) => s.regimeEngine?.regime)
  const green = useMarketRadarStore((s: any) => s.green) || []
  const red = useMarketRadarStore((s: any) => s.red) || []
  const src = useMarketRadarStore((s: any) => s.source)
  const w = window as any
  const S = w.S || {}
  const fr = typeof S.fr === 'number' ? (S.fr * 100).toFixed(4) + '%' : '—'
  return (
    <div className="theia-card">
      <h4>📡 Market lens</h4>
      <div className="theia-rows">
        <div><span>Symbol</span><b>{dash(S.symbol)}</b></div>
        <div><span>Price</span><b>{num(S.price)}</b></div>
        <div><span>Regime</span><b>{dash(regime)}</b></div>
        <div><span>Open interest</span><b>{dash(S.oi)}</b></div>
        <div><span>Funding</span><b>{fr}</b></div>
        <div><span>ATR</span><b>{num(S.atr, 4)}</b></div>
        <div><span>Radar movers</span><b>{(Array.isArray(green) || Array.isArray(red)) ? `▲${green.length} ▼${red.length}` : '—'}{src ? ` · ${src}` : ''}</b></div>
      </div>
    </div>
  )
}
