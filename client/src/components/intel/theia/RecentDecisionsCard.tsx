import { useEffect, useState } from 'react'
import { _relTime, _decisionColor } from './theiaDecisions'

// 🧭 Recent brain decisions — REAL canonical trail from /api/brain/decisions/recent.
// Read-only; empty state when the trail has no rows. Never fabricated.
interface Decision { symbol?: string; ts?: number; dir?: string; action?: string; conf?: number; tier?: string }

const dash = (v: any) => (v === undefined || v === null || v === '' ? '—' : String(v))

export function RecentDecisionsCard() {
  const [rows, setRows] = useState<Decision[] | null>(null)
  const [now, setNow] = useState(() => 0)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const r = await fetch('/api/brain/decisions/recent?limit=12', { credentials: 'same-origin' })
        if (!alive || !r.ok) return
        const d = await r.json()
        if (alive && d && Array.isArray(d.decisions)) { setRows(d.decisions); setNow(Date.now()) }
      } catch (_) { /* leave previous rows; never fabricate */ }
    }
    load()
    const id = setInterval(load, 12000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  return (
    <div className="theia-card theia-hero">
      <h4>🧭 Recent brain decisions</h4>
      {rows === null ? (
        <div className="theia-dec-empty">loading…</div>
      ) : rows.length === 0 ? (
        <div className="theia-dec-empty">no decisions yet</div>
      ) : (
        <div className="theia-dec-list">
          {rows.map((d, i) => {
            const act = d.action || d.dir || '—'
            return (
              <div className="theia-dec-row" key={`${d.ts}-${i}`}>
                <span className="theia-dec-sym">{dash(d.symbol)}</span>
                <span className="theia-dec-act" style={{ color: _decisionColor(d.action || d.dir || '') }}>{String(act).toUpperCase()}</span>
                <span className="theia-dec-dir">{d.dir && d.dir !== d.action ? d.dir : ''}</span>
                <span className="theia-dec-conf">{typeof d.conf === 'number' ? `${d.conf}%` : '—'}</span>
                <span className="theia-dec-tier">{dash(d.tier)}</span>
                <span className="theia-dec-time">{_relTime(d.ts as number, now)}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
