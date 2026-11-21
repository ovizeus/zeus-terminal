// [2026-11-21] Caseta MARKETS de sub banda „EXECUTION MODE" — la fel de lata si de inalta, acelasi
// limbaj (linii de scanare), paleta platina + albastru-otel (aleasa de operator, 21 nov). Atingerea deschide panoul complet (activeModal 'markets').
import { useUiStore } from '../../stores'
import { useTradfi } from './useTradfi'
import { HIGHLIGHTS, fmtPrice, fmtPct, type TradfiItem } from '../../markets/tradfi'
import './markets.css'

function Chip({ it }: { it: TradfiItem }) {
  const up = (it.chg24 ?? 0) >= 0
  return (
    <span className="zmk-chip">
      <span className="zmk-chip-n">{it.name}</span>
      <span className="zmk-chip-p">{fmtPrice(it.price)}</span>
      <span className={'zmk-chip-c ' + (up ? 'up' : 'dn')}>{up ? '▲' : '▼'} {fmtPct(it.chg24).replace(/^[+-]/, '')}</span>
    </span>
  )
}

export function MarketsBar() {
  const openModal = useUiStore((s) => s.openModal)
  const { snap, err } = useTradfi(false)
  const bySym = new Map((snap?.items || []).map((i) => [i.sym, i]))
  const hl = HIGHLIGHTS.map((s) => bySym.get(s)).filter(Boolean) as TradfiItem[]
  const usOpen = !!snap?.sessions?.us
  const live = !!snap && !snap.stale && !err

  return (
    <div id="zeus-markets-bar" className="zmk-bar" role="button" tabIndex={0}
      aria-label="Open global markets"
      onClick={() => openModal('markets')}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModal('markets') } }}>
      <div className="zmk-status">
        <div className={'zmk-indicator' + (live ? ' live' : '')}></div>
        <div className="zmk-info">
          <span className="zmk-label">{usOpen ? 'Wall St open · live' : 'Cross-asset · live'}</span>
          <span className="zmk-title">GLOBAL MARKETS</span>
        </div>
      </div>
      <div className="zmk-ticker" aria-hidden="true">
        {hl.length ? (
          <div className="zmk-track">
            {hl.map((it) => <Chip key={it.sym} it={it} />)}
            {hl.map((it) => <Chip key={'b' + it.sym} it={it} />)}
          </div>
        ) : (
          <span className="zmk-wait">{err === 'locked' ? 'Unavailable' : err ? 'Reconnecting…' : 'Loading prices…'}</span>
        )}
      </div>
      <span className="zmk-btn"><span className="tx">OPEN</span><span className="ar" aria-hidden="true">›</span></span>
    </div>
  )
}
