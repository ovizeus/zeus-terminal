// [2026-11-21] Caseta MARKET NEWS de sub GLOBAL MARKETS — aceeasi latime, inaltime si paleta (platina + otel).
// Titlurile importante defileaza spre stanga cu eticheta activului si reactia masurata; atingerea deschide panoul.
import { useUiStore } from '../../stores'
import { useNews } from './useNews'
import { bestMove, countdown, type NewsItem } from '../../markets/news'
import '../markets/markets.css'
import './news.css'

function Head({ it }: { it: NewsItem }) {
  const mv = it.moves.map((m) => ({ m, b: bestMove(m) })).find((x) => x.b.v != null)
  return (
    <span className="zmn-chip">
      {it.tags[0] && <span className="zmn-chip-tag">{it.tags[0]}</span>}
      <span className="zmn-chip-t">{it.title}</span>
      {mv && <span className={'zmk-chip-c ' + ((mv.b.v as number) >= 0 ? 'up' : 'dn')}>{mv.m.px} {(mv.b.v as number) >= 0 ? '+' : ''}{(mv.b.v as number).toFixed(2)}%</span>}
    </span>
  )
}

export function NewsBar() {
  const openModal = useUiStore((s) => s.openModal)
  const { snap, err } = useNews(false)
  const heads = (snap?.top?.length ? snap.top : snap?.items || []).slice(0, 6)
  const nextHigh = (snap?.calendar || []).find((e) => e.impact === 'High' && e.ts > Date.now())
  const live = !!snap && !err

  return (
    <div id="zeus-news-bar" className="zmk-bar" role="button" tabIndex={0} aria-label="Open market news"
      onClick={() => openModal('news')}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModal('news') } }}>
      <div className="zmk-status">
        <div className={'zmk-indicator' + (live ? ' live' : '')}></div>
        <div className="zmk-info">
          <span className="zmk-label">{nextHigh ? `${nextHigh.country} ${nextHigh.title.slice(0, 14)} ${countdown(nextHigh.ts)}` : 'Headlines · live'}</span>
          <span className="zmk-title">MARKET NEWS</span>
        </div>
      </div>
      <div className="zmk-ticker" aria-hidden="true">
        {heads.length ? (
          <div className="zmk-track zmn-track">
            {heads.map((it) => <Head key={it.id} it={it} />)}
            {heads.map((it) => <Head key={'b' + it.id} it={it} />)}
          </div>
        ) : (
          <span className="zmk-wait">{err === 'locked' ? 'Unavailable' : err ? 'Reconnecting…' : 'Loading headlines…'}</span>
        )}
      </div>
      <span className="zmk-btn"><span className="tx">OPEN</span><span className="ar" aria-hidden="true">›</span></span>
    </div>
  )
}
