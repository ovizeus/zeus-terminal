import { useEffect, useState } from 'react'
import { ZiMetric, toneColor, type ZiTone } from '../../zi'

const DASH = '—'
const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? String(v) : DASH)
const HEAD = { color: 'var(--zi-mut)', margin: '8px 0 4px' } as const

/**
 * [2026-10-10] Was `#brainDashBody`, filled by the second polling IIFE in
 * core/bootstrapBrainDash.ts. That IIFE had no store: it fetched
 * GET /api/brain/dashboard (credentials same-origin) 5 s after start and then
 * every 30 s. The same endpoint and the same cadence are kept here, so no
 * server load is added; nothing is cached or invented. Before the first
 * successful response every value is an em dash.
 *
 * Field mapping (response -> this card):
 *   thoughts[-8..]          -> LIVE THINKING: severity, ts, text (newest first)
 *   selfScore               -> SELF-SCORE: accuracyToday, streak, bestStreak,
 *                              decisionsToday, avoidedLosses, regretTrades
 *   learnedRules[0..8]      -> id, rule, blockEntry, hitCount
 *   dslRecommendations[]    -> regime, param, current, recommended, reason
 *   calibration{key:{gap,samples}} -> CONFIDENCE CALIBRATION
 *   antiPatterns[0..6]      -> pattern, occurrences, lossRate
 *   sessionReviews[last]    -> trades, wins, losses, winRate, totalPnl, conclusions[]
 */
export function BrainDashboardCard() {
  const [d, setD] = useState<any>(null)

  useEffect(() => {
    let alive = true
    const poll = () => {
      try {
        fetch('/api/brain/dashboard', { credentials: 'same-origin' })
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => { if (alive && data) setD(data) })
          .catch(() => { /* keep the last good data */ })
      } catch (_) { /* fetch unavailable */ }
    }
    const first = setTimeout(poll, 5000)
    const id = setInterval(poll, 30000)
    return () => { alive = false; clearTimeout(first); clearInterval(id) }
  }, [])

  const thoughts: any[] = d?.thoughts || []
  const ss = d?.selfScore
  const rules: any[] = d?.learnedRules || []
  const dsl: any[] = d?.dslRecommendations || []
  const cal = d?.calibration || {}
  const calKeys = Object.keys(cal)
  const ap: any[] = d?.antiPatterns || []
  const reviews: any[] = d?.sessionReviews || []
  const rev = reviews.length ? reviews[reviews.length - 1] : null
  const accTone: ZiTone = typeof ss?.accuracyToday !== 'number' ? 'neutral' : ss.accuracyToday >= 60 ? 'pos' : 'neg'

  return (
    <div className="theia-card">
      <h4>Brain dashboard</h4>

      <div className="zi-lbl" style={HEAD}>Live thinking</div>
      {thoughts.length === 0 && <div className="zi-num" style={{ fontSize: 11 }}>{DASH}</div>}
      {thoughts.slice(-8).reverse().map((t, i) => {
        const sev = t.severity || 'info'
        const tone: ZiTone = sev === 'critical' ? 'neg' : sev === 'warning' ? 'warn' : 'neutral'
        const icon = sev === 'critical' ? '●' : sev === 'warning' ? '▲' : '○'
        const ago = typeof t.ts === 'number' ? Math.round((Date.now() - t.ts) / 60000) + 'm' : DASH
        return (
          <div key={i} className="zi-num" style={{ fontSize: 11, color: toneColor(tone), padding: '1px 0' }}>
            {icon} <span style={{ color: 'var(--zi-mut)' }}>{ago}</span> {String(t.text ?? DASH)}
          </div>
        )
      })}

      <div className="zi-lbl" style={HEAD}>Self-score</div>
      <div className="theia-rows">
        <ZiMetric label="Accuracy" value={typeof ss?.accuracyToday === 'number' ? ss.accuracyToday + '%' : DASH} tone={accTone} />
        <ZiMetric label="Streak" value={typeof ss?.streak === 'number' ? ss.streak + 'W' : DASH} tone={typeof ss?.streak === 'number' && ss.streak >= 3 ? 'pos' : 'neutral'} />
        <ZiMetric label="Best" value={typeof ss?.bestStreak === 'number' ? ss.bestStreak + 'W' : DASH} />
        <ZiMetric label="Decisions" value={num(ss?.decisionsToday)} />
        <ZiMetric label="Avoided" value={num(ss?.avoidedLosses)} tone={ss?.avoidedLosses > 0 ? 'pos' : 'neutral'} />
        <ZiMetric label="Regret" value={num(ss?.regretTrades)} tone={ss?.regretTrades > 3 ? 'neg' : 'neutral'} />
      </div>

      {rules.length > 0 && (
        <>
          <div className="zi-lbl" style={HEAD}>Learned rules ({rules.length})</div>
          {rules.slice(0, 8).map((r, i) => (
            <div key={i} className="zi-num" style={{ fontSize: 11, padding: '1px 0' }}>
              <span style={{ color: 'var(--zi-warn)' }}>#{r.id}</span> {String(r.rule ?? DASH)}
              {r.blockEntry && <span style={{ color: 'var(--zi-neg)' }}> [BLOCK]</span>}
              <span style={{ color: 'var(--zi-mut)' }}> hits:{r.hitCount || 0}</span>
            </div>
          ))}
        </>
      )}

      {dsl.length > 0 && (
        <>
          <div className="zi-lbl" style={HEAD}>DSL recommendations</div>
          {dsl.map((r, i) => (
            <div key={i} className="zi-num" style={{ fontSize: 11, padding: '1px 0' }}>
              <span style={{ color: 'var(--zi-mut)' }}>{r.regime || ''}</span> {r.param}:{' '}
              <span style={{ color: 'var(--zi-neg)' }}>{String(r.current)}</span> →{' '}
              <span style={{ color: 'var(--zi-pos)' }}>{String(r.recommended)}</span>{' '}
              <span style={{ color: 'var(--zi-mut)' }}>{r.reason || ''}</span>
            </div>
          ))}
        </>
      )}

      {calKeys.length > 0 && (
        <>
          <div className="zi-lbl" style={HEAD}>Confidence calibration</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {calKeys.map((k) => {
              const cv = cal[k] || {}
              const tone: ZiTone = cv.gap > 5 ? 'pos' : cv.gap < -10 ? 'neg' : 'neutral'
              return (
                <span key={k} className="zi-num" style={{ fontSize: 11 }}>
                  <span style={{ color: 'var(--zi-mut)' }}>{k}</span>{' '}
                  <span style={{ color: toneColor(tone) }}>{typeof cv.gap === 'number' ? (cv.gap > 0 ? '+' : '') + cv.gap + '%' : DASH}</span>{' '}
                  <span style={{ color: 'var(--zi-mut)' }}>({num(cv.samples)})</span>
                </span>
              )
            })}
          </div>
        </>
      )}

      {ap.length > 0 && (
        <>
          <div className="zi-lbl" style={HEAD}>Anti-patterns ({ap.length})</div>
          {ap.slice(0, 6).map((p, i) => (
            <div key={i} className="zi-num" style={{ fontSize: 11, padding: '1px 0' }}>
              {String(p.pattern ?? DASH)} <span style={{ color: 'var(--zi-mut)' }}>×{num(p.occurrences)}</span>{' '}
              <span style={{ color: 'var(--zi-neg)' }}>{Math.round((p.lossRate || 0) * 100)}% loss</span>
            </div>
          ))}
        </>
      )}

      {rev && (
        <>
          <div className="zi-lbl" style={HEAD}>Session review</div>
          <div className="zi-num" style={{ fontSize: 11 }}>
            {num(rev.trades)} trades | <span style={{ color: 'var(--zi-pos)' }}>{num(rev.wins)}W</span> /{' '}
            <span style={{ color: 'var(--zi-neg)' }}>{num(rev.losses)}L</span> | WR:{' '}
            <span style={{ color: toneColor(rev.winRate >= 60 ? 'pos' : rev.winRate < 40 ? 'neg' : 'warn') }}>{num(rev.winRate)}%</span> | PnL:{' '}
            <span style={{ color: toneColor((rev.totalPnl || 0) >= 0 ? 'pos' : 'neg') }}>${(rev.totalPnl || 0).toFixed(2)}</span>
          </div>
          {(rev.conclusions || []).map((c: string, i: number) => (
            <div key={i} className="zi-num" style={{ fontSize: 11, color: 'var(--zi-lbl)', padding: '1px 0' }}>▸ {String(c)}</div>
          ))}
        </>
      )}
    </div>
  )
}
