// [2026-11-21] MARKETS — panoul complet: ~100 de active traditionale, live (Gate prin serverul nostru),
// grupe, cautare, sortare, grafic 7 zile, corelatia cu BTC pe 30 de zile. Doar informare.
import { useEffect, useMemo, useState } from 'react'
import { useTradfi } from './useTradfi'
import { GROUPS, selectItems, fmtPrice, fmtPct, fmtCompact, corrInfo, type SortKey, type TradfiGroup, type TradfiItem } from '../../markets/tradfi'
import './markets.css'

const GROUP_LABEL: Record<TradfiGroup, string> = {
  metals: 'Metal', energy: 'Energy', indices: 'Index', forex: 'FX / Bond', stocks: 'Stock', crypto: 'Crypto-linked',
}

function Spark({ v }: { v: number[] }) {
  if (v.length < 2) return <svg className="zmkp-spark" aria-hidden="true" />
  const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1
  const pts = v.map((x, i) => `${(i / (v.length - 1)) * 58 + 1},${22 - ((x - lo) / span) * 20}`).join(' ')
  const up = v[v.length - 1] >= v[0]
  return (
    <svg className="zmkp-spark" viewBox="0 0 60 24" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={up ? '#00d97a' : '#ff3355'} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function Row({ it, open, onToggle }: { it: TradfiItem; open: boolean; onToggle: () => void }) {
  const ci = corrInfo(it.corrBtc)
  const tone = it.chg24 == null ? 'flat' : it.chg24 > 0 ? 'up' : it.chg24 < 0 ? 'dn' : 'flat'
  const pos = it.high24 != null && it.low24 != null && it.high24 > it.low24
    ? Math.max(0, Math.min(100, ((it.price - it.low24) / (it.high24 - it.low24)) * 100)) : null
  return (
    <div className="zmkp-item" role="button" tabIndex={0} onClick={onToggle} aria-expanded={open}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}>
      <div className="zmkp-grid">
        <div className="zmkp-name">
          <span className="n">{it.name}</span>
          <span className="s"><i className={'zmkp-dot' + (it.open ? ' open' : '')} />{it.sym} · {GROUP_LABEL[it.group]}</span>
        </div>
        <Spark v={it.spark} />
        <div className="zmkp-px">
          <span className="p">{fmtPrice(it.price)}</span>
          <span className={'c ' + tone}>{fmtPct(it.chg24)}</span>
        </div>
        <div className={'zmkp-corr ' + ci.tone} title={ci.text}><small>BTC</small>{ci.label}</div>
      </div>
      {open && (
        <div className="zmkp-det">
          {pos != null && (
            <div>
              <div className="zmkp-range"><i style={{ left: pos + '%' }} /></div>
              <div className="zmkp-range-l"><span>24h low {fmtPrice(it.low24 as number)}</span><span>24h high {fmtPrice(it.high24 as number)}</span></div>
            </div>
          )}
          <div className="zmkp-kv">
            <div><span>30 days</span><b className={it.chg30 == null ? '' : it.chg30 >= 0 ? 'up' : 'dn'}>{fmtPct(it.chg30)}</b></div>
            <div><span>24h volume</span><b>{fmtCompact(it.vol24)}</b></div>
            <div><span>Market</span><b className={it.open ? 'up' : 'flat'}>{it.open ? 'Open' : 'Closed'}</b></div>
          </div>
          <div>BTC correlation {ci.label}: {ci.text}</div>
          {!it.open && <div className="flat">The exchange is closed — the price is the 24/7 contract tracking it.</div>}
        </div>
      )}
    </div>
  )
}

function ago(ts: number | null): string {
  if (!ts) return '—'
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  return s < 60 ? s + 's ago' : Math.round(s / 60) + 'm ago'
}

export function MarketsPanel({ onClose }: { onClose: () => void }) {
  const { snap, err } = useTradfi(true)
  const [group, setGroup] = useState<'all' | TradfiGroup>('all')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<SortKey>('default')
  const [openSym, setOpenSym] = useState<string | null>(null)
  const [, tick] = useState(0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const t = setInterval(() => tick((x) => x + 1), 1000)          // „actualizat acum X s"
    return () => { document.removeEventListener('keydown', onKey); clearInterval(t) }
  }, [onClose])

  const items = snap?.items || []
  const list = useMemo(() => selectItems(items, group, q, sort), [items, group, q, sort])
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length }
    for (const i of items) c[i.group] = (c[i.group] || 0) + 1
    return c
  }, [items])
  const s = snap?.sessions || {}

  return (
    <div className="zmkp z-modal--open" role="dialog" aria-modal="true" aria-label="Markets">
      <div className="zmkp-head">
        <div className="zmkp-row1">
          <div className="zmkp-title">MARKETS</div>
          <button className="zmkp-close" onClick={onClose} aria-label="Close markets">×</button>
        </div>
        <div className="zmkp-sub">
          {err === 'locked' ? <span className="warn">Not available for this account.</span>
            : err ? <span className="warn">Connection lost — showing the last prices.</span>
              : snap?.stale ? <span className="warn">Prices are delayed — the source is not answering.</span>
                : <><b>● Live</b> · updated {ago(snap?.asOf ?? null)} · information only</>}
        </div>
        <div className="zmkp-sess">
          <span className={'zmkp-pill' + (s.us ? ' open' : '')}>US stocks {s.us ? 'open' : 'closed'}</span>
          <span className={'zmkp-pill' + (s.cmdty ? ' open' : '')}>Commodities {s.cmdty ? 'open' : 'closed'}</span>
          <span className={'zmkp-pill' + (s.fx ? ' open' : '')}>Forex {s.fx ? 'open' : 'closed'}</span>
          <span className={'zmkp-pill' + (s.de ? ' open' : '')}>Europe {s.de ? 'open' : 'closed'}</span>
          <span className={'zmkp-pill' + (s.jp ? ' open' : '')}>Asia {s.jp ? 'open' : 'closed'}</span>
        </div>
      </div>

      <div className="zmkp-tools">
        <div className="zmkp-tabs" role="tablist">
          {GROUPS.map((g) => (
            <button key={g.id} role="tab" aria-selected={group === g.id} className={'zmkp-tab' + (group === g.id ? ' on' : '')} onClick={() => setGroup(g.id)}>
              {g.label}<span className="n">{counts[g.id] || 0}</span>
            </button>
          ))}
        </div>
        <div className="zmkp-line">
          <input className="zmkp-search" type="search" placeholder="Search gold, Nvidia, S&P…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search markets" />
          <select className="zmkp-sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort">
            <option value="default">Default</option>
            <option value="gainers">Top gainers</option>
            <option value="losers">Top losers</option>
            <option value="corr">Most like BTC</option>
            <option value="volume">Most traded</option>
          </select>
        </div>
      </div>

      <div className="zmkp-list">
        {!items.length && !err && <div className="zmkp-empty">Loading live prices…</div>}
        {!items.length && err && <div className="zmkp-empty">{err === 'locked' ? 'Not available for this account.' : 'Could not load prices — retrying.'}</div>}
        {items.length > 0 && !list.length && <div className="zmkp-empty">Nothing matches “{q}”.</div>}
        {list.map((it) => (
          <Row key={it.sym} it={it} open={openSym === it.sym} onToggle={() => setOpenSym(openSym === it.sym ? null : it.sym)} />
        ))}
        {snap && (
          <div className="zmkp-foot">
            Prices are Gate.io contracts whose index tracks the real asset; 24h change is rolling, not since the market open.
            When an exchange is closed the contract keeps trading, so its price can drift from the last close.
            BTC correlation uses 30 days of daily returns. Holidays are not shown as closed.
          </div>
        )}
      </div>
    </div>
  )
}
