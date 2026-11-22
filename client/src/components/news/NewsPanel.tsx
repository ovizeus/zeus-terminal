// [2026-11-21] MARKET NEWS — panoul complet: rezumat AI, ce misca piata acum (impact masurat), toate titlurile
// cu filtre si cautare, calendarul economic cu numaratoare inversa si reactia masurata, alegerea alertelor.
// „S-a miscat DUPA stire", niciodata „din cauza" — cauza nu se poate dovedi pe ecran, reactia da.
import { useEffect, useMemo, useState } from 'react'
import { useNews } from './useNews'
import { NEWS_FILTERS, filterNews, bestMove, ago, countdown, setAlertPref, markSeen, chartCoinTag, type NewsCat, type NewsItem, type CalEvent, type NewsMove, type AlertPref } from '../../markets/news'
import '../markets/markets.css'
import './news.css'

function MoveChip({ m }: { m: NewsMove }) {
  const b = bestMove(m)
  if (b.v == null) return <span className="zmn-move flat">{m.px} <small>pending</small></span>
  return <span className={'zmn-move ' + (b.v > 0 ? 'up' : b.v < 0 ? 'dn' : 'flat')}>{m.px} {b.v >= 0 ? '+' : ''}{b.v.toFixed(2)}% <small>{b.label}</small></span>
}

function MoveTable({ moves }: { moves: NewsMove[] }) {
  if (!moves.length) return null
  const f = (v: number | null) => (v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%')
  const c = (v: number | null) => (v == null ? 'flat' : v > 0 ? 'up' : v < 0 ? 'dn' : 'flat')
  return (
    <div className="zmn-mtab">
      <div className="h"><span>Asset</span><span>+15 min</span><span>+1 hour</span><span>Since</span></div>
      {moves.map((m) => (
        <div key={m.px}><span>{m.px}</span><span className={c(m.m15)}>{f(m.m15)}</span><span className={c(m.m60)}>{f(m.m60)}</span><span className={c(m.since)}>{f(m.since)}</span></div>
      ))}
    </div>
  )
}

function NewsRow({ it, open, onToggle }: { it: NewsItem; open: boolean; onToggle: () => void }) {
  return (
    <div className="zmkp-item zmn-item" role="button" tabIndex={0} aria-expanded={open} onClick={onToggle}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}>
      <div className="zmn-meta">
        <span>{ago(it.ts)}</span><span>·</span><span>{it.sources[0]}</span>
        {it.sources.length > 1 && <span className="zmn-multi">+{it.sources.length - 1} sources</span>}
        {it.official && <span className="zmn-off">Official</span>}
      </div>
      <div className="zmn-title">{it.title}</div>
      {(it.tags.length > 0 || it.moves.length > 0) && (
        <div className="zmn-chips">
          {it.moves.map((m) => <MoveChip key={m.px} m={m} />)}
          {it.tags.filter((t) => !it.moves.some((m) => m.px === t)).map((t) => <span key={t} className="zmn-tag">{t}</span>)}
        </div>
      )}
      {open && (
        <div className="zmkp-det">
          <MoveTable moves={it.moves} />
          {it.moves.length > 0 && <div className="flat">Measured price moves after publication. A move after a headline is not proof it was caused by it.</div>}
          <div className="zmn-links">
            {it.links.map((l) => (
              <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>Read on {l.source} ↗</a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function CalRow({ e }: { e: CalEvent }) {
  const past = e.ts <= Date.now()
  const d = new Date(e.ts)
  return (
    <div className={'zmn-cal' + (past ? ' past' : '')}>
      <div className="zmn-cal-time">
        <b>{d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</b>
        <span>{past ? 'released' : countdown(e.ts)}</span>
      </div>
      <div className="zmn-cal-main">
        <div className="zmn-cal-t"><i className={'zmn-imp ' + e.impact.toLowerCase()} title={e.impact + ' impact'} />{e.country} · {e.title}</div>
        <div className="zmn-cal-v">
          {e.actual && <span>Actual <b>{e.actual}</b></span>}
          <span>Forecast <b>{e.forecast || '—'}</b></span>
          <span>Previous <b>{e.previous || '—'}</b></span>
        </div>
        {past && e.moves.length > 0 && <div className="zmn-chips">{e.moves.map((m) => <MoveChip key={m.px} m={m} />)}</div>}
      </div>
    </div>
  )
}

const PREF_LABEL: Record<AlertPref, string> = { off: 'Off', app: 'In-app', app_tg: 'In-app + Telegram' }

export function NewsPanel({ onClose }: { onClose: () => void }) {
  const { snap, err } = useNews(true)
  const [view, setView] = useState<'news' | 'cal'>('news')
  const [cat, setCat] = useState<'all' | NewsCat | `coin:${string}`>('all')
  // [2026-11-21] stirile monedei din grafic (BTC, ETH, SOL…) — etichetele vin de pe server
  const coin = chartCoinTag((window as any).S?.symbol)
  useEffect(() => { markSeen(); return () => markSeen() }, [])
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [impact, setImpact] = useState<'high' | 'all'>('high')
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [, tick] = useState(0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const t = setInterval(() => tick((x) => x + 1), 30_000)
    return () => { document.removeEventListener('keydown', onKey); clearInterval(t) }
  }, [onClose])

  const items = snap?.items || []
  const list = useMemo(() => filterNews(items, cat, q), [items, cat, q])
  const counts = useMemo(() => { const c: Record<string, number> = { all: items.length }; for (const i of items) c[i.cat] = (c[i.cat] || 0) + 1; return c }, [items])
  const cal = useMemo(() => (snap?.calendar || []).filter((e) => impact === 'all' || e.impact === 'High' || e.impact === 'Medium'), [snap, impact])
  const days = useMemo(() => {
    const g: Array<{ day: string; ev: CalEvent[] }> = []
    for (const e of cal) {
      const day = new Date(e.ts).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' })
      const last = g[g.length - 1]
      if (last && last.day === day) last.ev.push(e); else g.push({ day, ev: [e] })
    }
    return g
  }, [cal])
  const pref: AlertPref = snap?.prefs?.alerts || 'app'
  const choosePref = async (p: AlertPref) => {
    const ok = await setAlertPref(p)
    setSavedMsg(ok ? (p === 'app_tg' ? 'Saved. Telegram alerts need your Telegram bot set up in Settings.' : 'Saved.') : 'Could not save — try again.')
    setTimeout(() => setSavedMsg(null), 4000)
  }

  return (
    <div className="zmkp zmn z-modal--open" role="dialog" aria-modal="true" aria-label="Market news">
      <div className="zmkp-head">
        <div className="zmkp-row1">
          <div>
            <span className="zmkp-kicker">Headlines · measured market reaction</span>
            <div className="zmkp-title">MARKET NEWS</div>
          </div>
          <button className="zmkp-close" onClick={onClose} aria-label="Close market news">×</button>
        </div>
        <div className="zmkp-sub">
          {err === 'locked' ? <span className="warn">Not available for this account.</span>
            : err ? <span className="warn">Connection lost — showing the last headlines.</span>
              : <><b>● Live</b> · {snap ? `${snap.sources.ok}/${snap.sources.total} sources` : '…'} · information only</>}
        </div>
        <div className="zmn-seg" role="tablist">
          <button role="tab" aria-selected={view === 'news'} className={view === 'news' ? 'on' : ''} onClick={() => setView('news')}>Headlines</button>
          <button role="tab" aria-selected={view === 'cal'} className={view === 'cal' ? 'on' : ''} onClick={() => setView('cal')}>Economic calendar</button>
        </div>
      </div>

      {view === 'news' && (
        <>
          <div className="zmkp-tools">
            <div className="zmkp-tabs" role="tablist">
              {coin && (
                <button role="tab" aria-selected={cat === `coin:${coin}`} className={'zmkp-tab' + (cat === `coin:${coin}` ? ' on' : '')} onClick={() => setCat(`coin:${coin}`)}>
                  {coin}<span className="n">{items.filter((i) => i.tags.includes(coin)).length}</span>
                </button>
              )}
              {NEWS_FILTERS.map((f) => (
                <button key={f.id} role="tab" aria-selected={cat === f.id} className={'zmkp-tab' + (cat === f.id ? ' on' : '')} onClick={() => setCat(f.id)}>
                  {f.label}<span className="n">{counts[f.id] || 0}</span>
                </button>
              ))}
            </div>
            <input className="zmkp-search" type="search" placeholder="Search Fed, Bitcoin, oil…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search news" />
          </div>
          <div className="zmkp-list">
            {!snap && !err && <div className="zmkp-empty">Loading headlines…</div>}
            {snap && !q && cat === 'all' && (
              <div className="zmn-section">
                <div className="zmn-brief">
                  <div className="zmn-brief-h"><span>AI briefing</span><small>{snap.brief ? 'OMEGA · ' + ago(snap.brief.at) + ' ago' : ''}</small></div>
                  {snap.brief ? <p>{snap.brief.text}</p>
                    : <p className="flat">{snap.briefStatus === 'daily_cap' ? 'Daily AI limit reached — back tomorrow. Headlines and measured moves below are live.'
                      : snap.briefStatus === 'unavailable' ? 'AI briefing coming soon — the AI service is not available right now.'
                        : 'AI briefing coming soon — it appears once the top stories have measured moves.'}</p>}
                </div>
                {snap.top.length > 0 && <div className="zmn-h">What's moving markets</div>}
                {snap.top.map((it) => <NewsRow key={'top' + it.id} it={it} open={openId === 'top' + it.id} onToggle={() => setOpenId(openId === 'top' + it.id ? null : 'top' + it.id)} />)}
                <div className="zmn-h">All headlines</div>
              </div>
            )}
            {snap && !list.length && <div className="zmkp-empty">Nothing matches “{q}”.</div>}
            {list.map((it) => <NewsRow key={it.id} it={it} open={openId === it.id} onToggle={() => setOpenId(openId === it.id ? null : it.id)} />)}
            {snap && (
              <div className="zmkp-foot">
                Headlines from Bloomberg, Financial Times, MarketWatch, Investing.com, Seeking Alpha, ZeroHedge, ForexLive, OilPrice, Kitco,
                Cointelegraph, The Block, Decrypt, Bitcoin Magazine, CryptoSlate, Bitcoin.com, Blockworks, The Defiant, CryptoPotato, U.Today
                and BeInCrypto, official releases from the Federal Reserve, ECB, Bank of England and SEC, and Binance listing and delisting announcements. Only titles and links are shown.
                Moves are measured from 1-minute prices after publication; the same story from several outlets is grouped.
              </div>
            )}
          </div>
        </>
      )}

      {view === 'cal' && (
        <>
          <div className="zmkp-tools">
            <div className="zmkp-tabs" role="tablist">
              <button role="tab" aria-selected={impact === 'high'} className={'zmkp-tab' + (impact === 'high' ? ' on' : '')} onClick={() => setImpact('high')}>High + Medium</button>
              <button role="tab" aria-selected={impact === 'all'} className={'zmkp-tab' + (impact === 'all' ? ' on' : '')} onClick={() => setImpact('all')}>All</button>
            </div>
          </div>
          <div className="zmkp-list">
            {snap?.calendarNote && <div className="zmn-note">{snap.calendarNote}</div>}
            {days.map((d) => (
              <div key={d.day}>
                <div className="zmn-h">{d.day}</div>
                {d.ev.map((e) => <CalRow key={e.id} e={e} />)}
              </div>
            ))}
            {snap && !days.length && !snap.calendarNote && <div className="zmkp-empty">No events in this range.</div>}
            <div className="zmkp-foot">Economic calendar from ForexFactory and company earnings from Nasdaq (times in your local time zone; earnings times are approximate: before the open or after the close). After a high-impact release the panel shows how the main markets moved.</div>
          </div>
        </>
      )}

      <div className="zmn-alerts">
        <span>Alerts</span>
        {(['off', 'app', 'app_tg'] as AlertPref[]).map((p) => (
          <button key={p} className={pref === p ? 'on' : ''} onClick={() => choosePref(p)} aria-pressed={pref === p}>{PREF_LABEL[p]}</button>
        ))}
        {savedMsg && <em>{savedMsg}</em>}
      </div>
    </div>
  )
}
