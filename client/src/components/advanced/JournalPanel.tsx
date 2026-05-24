import { useCallback, useEffect, useState } from 'react'

const PAGE_SIZE = 25

interface Trade {
  seq: number; symbol: string; side: string; mode: string; entryPrice: number
  exitPrice: number | null; pnl: number; exitReason: string; closedAt: string
  env?: string | null; exchange?: string | null; size?: number; leverage?: number
  tier?: string; regime?: string; holdMs?: number
}

export function JournalPanel() {
  const [trades, setTrades] = useState<Trade[]>([])
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)

  const fetchPage = useCallback(async (p: number) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/journal?limit=${PAGE_SIZE}&offset=${p * PAGE_SIZE}`, { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setTrades(data.trades || [])
        setTotal(data.total || 0)
        setPage(p)
      }
    } catch (_) {}
    setLoading(false)
  }, [])

  useEffect(() => { fetchPage(0) }, [fetchPage])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const canPrev = page > 0
  const canNext = page < totalPages - 1

  function exportCSV() {
    if (trades.length === 0) return
    const header = 'Time,Symbol,Side,Entry,Exit,PnL,Reason,Mode,Env,Exchange\n'
    const rows = trades.map((t) =>
      `${t.closedAt},${t.symbol},${t.side},${t.entryPrice},${t.exitPrice ?? ''},${t.pnl.toFixed(2)},${t.exitReason},${t.mode},${t.env || ''},${t.exchange || ''}`
    ).join('\n')
    const blob = new Blob([header + rows], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `zeus-journal-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="zr-journal">
      <div className="zr-journal__header">
        <span className="zr-journal__title">TRADE JOURNAL</span>
        <span style={{ fontSize: 10, color: '#667', letterSpacing: 0.5 }}>{total} trades</span>
        <button className="csv-btn" onClick={exportCSV} disabled={trades.length === 0}>CSV</button>
      </div>

      {loading ? (
        <div className="zr-pos-empty" style={{ color: '#00d4ff' }}>Loading...</div>
      ) : trades.length === 0 ? (
        <div className="zr-pos-empty">No closed trades yet</div>
      ) : (
        <div className="zr-journal__list">
          {trades.map((t) => {
            const isWin = t.pnl >= 0
            const envTag = t.env || (t.mode === 'demo' ? 'DEMO' : null)
            const exchTag = t.exchange === 'binance' ? 'BIN' : t.exchange === 'bybit' ? 'BYB' : null
            const tag = envTag && exchTag ? (envTag + ' · ' + exchTag) : (envTag || exchTag || null)
            return (
              <div key={t.seq} className={`zr-journal__row ${isWin ? 'zr-journal__row--win' : 'zr-journal__row--loss'}`}>
                <span className="zr-journal__time">
                  {new Date(t.closedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className={`zr-pos-side ${t.side === 'LONG' ? 'zr-pos-side--long' : 'zr-pos-side--short'}`}>
                  {t.side === 'LONG' ? 'L' : 'S'}
                </span>
                <span className="zr-journal__sym">{t.symbol.replace('USDT', '')}</span>
                <span className="zr-journal__prices">
                  {t.entryPrice?.toFixed(2) ?? '—'} → {t.exitPrice?.toFixed(2) ?? '—'}
                </span>
                <span className={`zr-journal__pnl ${isWin ? 'zr-kv__value--grn' : 'zr-kv__value--red'}`}>
                  ${t.pnl.toFixed(2)}
                </span>
                <span className="zr-journal__reason">{t.exitReason}</span>
                {tag ? <span style={{ color: 'rgba(0,212,255,0.75)', fontSize: 10, letterSpacing: 0.5, marginLeft: 6 }}>{tag}</span> : null}
              </div>
            )
          })}
        </div>
      )}

      {/* Pagination controls */}
      {total > PAGE_SIZE && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', padding: '10px 0', borderTop: '1px solid #112233' }}>
          <button
            onClick={() => fetchPage(0)}
            disabled={!canPrev}
            style={{ background: 'none', border: '1px solid #00aaff44', color: canPrev ? '#00d4ff' : '#334', padding: '4px 10px', borderRadius: 4, cursor: canPrev ? 'pointer' : 'default', fontSize: 11, fontFamily: 'var(--ff)', letterSpacing: 1 }}
          >« 1</button>
          <button
            onClick={() => fetchPage(page - 1)}
            disabled={!canPrev}
            style={{ background: 'none', border: '1px solid #00aaff44', color: canPrev ? '#00d4ff' : '#334', padding: '4px 10px', borderRadius: 4, cursor: canPrev ? 'pointer' : 'default', fontSize: 11, fontFamily: 'var(--ff)', letterSpacing: 1 }}
          >← PREV</button>
          <span style={{ color: '#889', fontSize: 11, letterSpacing: 1, fontFamily: 'var(--ff)' }}>
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => fetchPage(page + 1)}
            disabled={!canNext}
            style={{ background: 'none', border: '1px solid #00aaff44', color: canNext ? '#00d4ff' : '#334', padding: '4px 10px', borderRadius: 4, cursor: canNext ? 'pointer' : 'default', fontSize: 11, fontFamily: 'var(--ff)', letterSpacing: 1 }}
          >NEXT →</button>
          <button
            onClick={() => fetchPage(totalPages - 1)}
            disabled={!canNext}
            style={{ background: 'none', border: '1px solid #00aaff44', color: canNext ? '#00d4ff' : '#334', padding: '4px 10px', borderRadius: 4, cursor: canNext ? 'pointer' : 'default', fontSize: 11, fontFamily: 'var(--ff)', letterSpacing: 1 }}
          >{totalPages} »</button>
        </div>
      )}
    </div>
  )
}
