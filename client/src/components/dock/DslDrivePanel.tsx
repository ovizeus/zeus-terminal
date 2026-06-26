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
  cockpit?: { capPct: number; pivotLeft: number; pivotRight: number; plPct: number | null; prPct: number | null; action: string } | null
  dsl: { phase: string; active: boolean; progress: number; activationPrice: number; currentSL: number } | null
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
  const [score, setScore] = useState<any>(null)

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

  useEffect(() => {
    let alive = true
    const poll = async () => { try { const j = await api.raw<any>('GET', '/api/dsldrive/scoreboard'); if (alive && j && j.ok) setScore(j) } catch (_) {} }
    poll(); const t = setInterval(poll, 5000); return () => { alive = false; clearInterval(t) }
  }, [])

  const fmt = (x: number) => (Math.abs(x) >= 1000 ? x.toFixed(1) : x.toFixed(2))
  const pct = (x?: number | null) => (Number.isFinite(x as number) ? (x as number).toFixed(2) + '%' : '—')
  // map a trail-width % (0..2%) onto a 0..100% bar — state-driven width, animated by a
  // CSS transition (NOT a keyframe), so the pivots glide like a piston on each poll.
  const barW = (p?: number) => Math.max(4, Math.min(100, ((p || 0) / 2) * 100))

  return (
    <div className="dsldrive-panel">
      <div className="sec"><div className="slbl">DSL DRIVE <span className="dsldrive-mode">{mode}</span></div></div>
      {score && score.trades > 0 && (
        <div className="dsldrive-score">
          <span>ML vs baseline · {score.trades} trades</span>
          <span style={{ color: score.avgAdvantage >= 0 ? '#26ff9a' : '#ff5277' }}>
            adv {score.avgAdvantage >= 0 ? '+' : ''}{score.avgAdvantage}% · ML {score.avgMlPnlPct}% vs base {score.avgBaselinePnlPct}% · win {score.winRate}%
          </span>
        </div>
      )}
      {score?.mlControl && score.mlControl.n > 0 ? (
        <div className="dsl-losscut-card dsl-mlctl-card">
          <h4>🧠 ML-Control DSL <span className="dsl-shadow-tag">REAL MEASURE</span></h4>
          <div className="dsl-losscut-verdict" style={{ color: score.mlControl.expDelta >= 0 ? '#26ff9a' : '#ff5277' }}>
            Δexp {score.mlControl.expDelta >= 0 ? '+' : ''}{score.mlControl.expDelta}% · ML {score.mlControl.avgMlPnlPct}% vs base {score.mlControl.avgBaselinePnlPct}% · N={score.mlControl.n}
          </div>
          <div className="dsl-losscut-rows">
            <span>R:R {score.mlControl.rr} vs {score.mlControl.rrBaseline}</span>
            <span>WR {score.mlControl.wrMl}% vs {score.mlControl.wrBaseline}%</span>
          </div>
          {score.mlControl.byAction && (
            <div className="dsl-mlctl-actions">
              {Object.entries(score.mlControl.byAction).map(([a, b]: [string, any]) => (
                <span key={a} style={{ color: actionColor(a) }}>{a} ×{b.n} ({b.avgAdvantage >= 0 ? '+' : ''}{b.avgAdvantage}%)</span>
              ))}
            </div>
          )}
          <DslSparkline data={score.mlControl.spark} />
        </div>
      ) : (
        <div className="dsl-losscut-card dsl-muted">🧠 ML-Control DSL (real measure) — gathering data…</div>
      )}
      {score?.lossSide && score.lossSide.n > 0 ? (
        <div className="dsl-losscut-card">
          <h4>🛡️ Smart Loss-Cut <span className="dsl-shadow-tag">SHADOW</span></h4>
          <div className="dsl-losscut-verdict">
            R:R {score.lossSide.rr} vs {score.lossSide.rrBaseline} · Δexp {score.lossSide.expDelta >= 0 ? '+' : ''}{score.lossSide.expDelta} · N={score.lossSide.n} · not yet live
          </div>
          <div className="dsl-losscut-rows">
            <span>avgLoss {score.lossSide.avgLossSmart} vs {score.lossSide.avgLossBaseline}</span>
            <span>WR {score.lossSide.wrSmart}% vs {score.lossSide.wrBaseline}%</span>
          </div>
          <DslSparkline data={score.lossSide.spark} />
        </div>
      ) : (
        <div className="dsl-losscut-card dsl-muted">🛡️ Smart Loss-Cut (shadow) — no data yet</div>
      )}
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
            {p.dsl ? (
              p.dsl.active ? (
                <div className="dsldrive-arm dsldrive-arm-on">● DSL ARMED · {p.dsl.phase}</div>
              ) : (
                <div className="dsldrive-arm dsldrive-arm-off">
                  ○ DSL not armed · arms at {fmt(p.dsl.activationPrice || 0)}
                  <div className="dsldrive-bar dsldrive-arm-bar"><i style={{ width: Math.max(2, Math.min(100, p.dsl.progress)) + '%' }} /></div>
                  <span className="dsldrive-armpct">{Math.round(p.dsl.progress)}%</span>
                </div>
              )
            ) : <div className="dsldrive-arm dsldrive-arm-off">○ DSL not attached</div>}
            {p.cockpit ? (
              <div className="dsldrive-act" style={{ color: actionColor(p.cockpit.action), fontWeight: 700 }}>
                🧠 ML FULL · cap {Number(p.cockpit.capPct || 0).toFixed(2)}% · {p.cockpit.action}
                <div className="dsldrive-row" style={{ fontWeight: 400 }}>stop {fmt(p.cockpit.pivotLeft)} · trail {pct(p.cockpit.plPct || 0)}</div>
              </div>
            ) : null}
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

// Inline cumulative-advantage sparkline for the Smart Loss-Cut card.
function DslSparkline({ data }: { data?: number[] }) {
  if (!data || data.length < 2) return null
  const w = 180, h = 32
  const min = Math.min(...data), max = Math.max(...data), rng = max - min || 1
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${(h - ((v - min) / rng) * h).toFixed(1)}`).join(' ')
  const up = data[data.length - 1] >= data[0]
  return (
    <svg className="dsl-spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={up ? '#26ff9a' : '#ff5277'} strokeWidth="1.5" />
    </svg>
  )
}
