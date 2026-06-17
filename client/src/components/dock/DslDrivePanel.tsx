import { useEffect, useRef, useState } from 'react'
import { api } from '../../services/api'

type MlProposal = {
  mlAction: string; mlReason: string
  mlPlPct: number; mlPrPct: number; mlIvPct: number
  forcedExit: boolean; momentum: number; mfePct?: number
  realPL: number | null; realPR: number | null; realIV: number | null
  realPhase: string | null; price: number
} | null
type DriveRow = {
  seq: number; symbol: string; side: string
  exchange: string | null; mode: string | null
  entry: number; sl: number; ml: MlProposal
}
type DriveState = { ok: boolean; mode: string; positions: DriveRow[]; ts: number }

const POLL_MS = 1500
const actionColor = (a?: string) =>
  a === 'LOOSEN' ? '#26ff9a' : a === 'TIGHTEN' ? '#ffab40'
    : a === 'EXIT' ? '#ff3b30' : a === 'BREATHER' ? '#26c6da' : '#90a4ae'

export function DslDrivePanel() {
  const [rows, setRows] = useState<DriveRow[]>([])
  const [mode, setMode] = useState('SHADOW')
  const [err, setErr] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    let alive = true
    const poll = async () => {
      try {
        const j = await api.raw<DriveState>('GET', '/api/dsldrive/state')
        if (!alive) return
        if (j && j.ok) { setRows(j.positions || []); setMode(j.mode || 'SHADOW'); setErr(null) }
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : String(e))
      }
    }
    poll()
    timer.current = setInterval(poll, POLL_MS)
    return () => { alive = false; if (timer.current) clearInterval(timer.current) }
  }, [])

  const fmt = (x: number) => (Math.abs(x) >= 1000 ? x.toFixed(1) : x.toFixed(2))
  const pct = (x?: number | null) => (Number.isFinite(x as number) ? (x as number).toFixed(2) + '%' : '—')
  // map a trail-width % (0..2%) onto a 0..100% bar — state-driven width, animated by a
  // CSS transition (NOT a keyframe), so the pivots glide like a piston on each poll.
  const barW = (p?: number) => Math.max(4, Math.min(100, ((p || 0) / 2) * 100))

  return (
    <div className="dsldrive-panel">
      <div className="sec"><div className="slbl">DSL DRIVE <span className="dsldrive-mode">{mode}</span></div></div>
      {err && <div className="dsldrive-empty">offline — {err}</div>}
      {!err && !rows.length && <div className="dsldrive-empty">no active positions</div>}
      {rows.map((p) => {
        const ml = p.ml
        return (
          <div className="dsldrive-card" key={p.seq}>
            <div className="dsldrive-sym">
              {p.symbol} <span style={{ color: p.side === 'LONG' ? '#26ff9a' : '#ff5277' }}>{p.side}</span>
              <span className="dsldrive-venue">{p.exchange || p.mode || ''}</span>
            </div>
            <div className="dsldrive-row">entry {fmt(p.entry)} · SL {fmt(p.sl)}{ml && ml.realPhase ? ` · ${ml.realPhase}` : ''}</div>
            {ml ? (
              <>
                <div className="dsldrive-act" style={{ color: actionColor(ml.mlAction) }}>
                  {ml.mlAction}{ml.forcedExit ? ' ⛔' : ''} — {ml.mlReason}
                </div>
                <div className="dsldrive-pivots">
                  {([['PL', ml.mlPlPct], ['PR', ml.mlPrPct], ['IV', ml.mlIvPct]] as [string, number][]).map(([lbl, v]) => (
                    <div className="dsldrive-piv" key={lbl}>
                      <span>{lbl}</span>
                      <div className="dsldrive-bar"><i style={{ width: barW(v) + '%', background: actionColor(ml.mlAction) }} /></div>
                      <span>{pct(v)}</span>
                    </div>
                  ))}
                </div>
                <div className="dsldrive-row dsldrive-mom">momentum {(ml.momentum >= 0 ? '+' : '') + ml.momentum.toFixed(2)} · MFE {pct(ml.mfePct)}</div>
              </>
            ) : <div className="dsldrive-row dsldrive-dim">DSL not armed yet (shadow flag off or position too new)</div>}
          </div>
        )
      })}
    </div>
  )
}
