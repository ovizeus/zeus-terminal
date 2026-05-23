/**
 * [Phase A.1 — Operator Visibility 2026-05-19]
 * Quota pressure indicator for Binance IP rate-limit.
 *
 * Polls /api/diag/binance-rates every 30s and shows a small colored badge
 * next to the ModeBar with current quota pressure. Surfaces what the
 * preemptive 429 gate (binanceTelemetry.shouldBlockForPressure) sees, so
 * operator can correlate UI feel with backend defensive behavior.
 *
 * Color mapping (uses peakUsedWeight per host vs configured cap):
 *   <70%       — green  (cool)
 *   70-90%     — amber  (rising)
 *   >=90%      — red    (gate may fire soon)
 *   >= blockPublicPct  — red + pulse (gate actively firing on public sources)
 *
 * Toast emitted once per transition into amber/red so operator doesn't
 * miss a degradation event. Recovery transition (back to green) silent.
 */
import { useEffect, useState, useRef } from 'react'
import { api } from '../../services/api'
import { toast } from '../../data/marketDataHelpers'

type HostPressure = Record<string, number>
type Thresholds = { cap: number; blockPublicPct: number; blockSignedPct: number }
type LaneStats = { accepted: number; rejected: number }
type SchedulerStats = {
  totalDecisions: number
  byLane: Record<string, LaneStats>
  byReason: Record<string, number>
}

interface DiagSnapshot {
  quotaPressure?: HostPressure
  quotaThresholds?: Thresholds
  byHost?: Record<string, { peakUsedWeight: number; lastUsedWeight: number | null; calls: number }>
  schedulerStats?: SchedulerStats
  activeCriticalSections?: number
}

const POLL_INTERVAL_MS = 30000

function _classify(pressurePct: number, blockPct: number): 'green' | 'amber' | 'red' | 'block' {
  if (pressurePct >= blockPct) return 'block'
  if (pressurePct >= 90) return 'red'
  if (pressurePct >= 70) return 'amber'
  return 'green'
}

export function QuotaIndicator() {
  const [snap, setSnap] = useState<DiagSnapshot | null>(null)
  const lastLevel = useRef<string>('green')
  const lastSchedRejected = useRef<number>(0)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null

    const fetchOnce = async () => {
      try {
        const data = await api.raw<DiagSnapshot>('GET', '/api/diag/binance-rates')
        if (cancelled || !data) return
        setSnap(data)

        // Surface degradation via toast (silent on recovery)
        const press = data.quotaPressure || {}
        const thr = data.quotaThresholds
        if (!thr) return
        let worstHost = ''
        let worstPct = 0
        for (const [h, p] of Object.entries(press)) {
          const pct = (p as number) * 100
          if (pct > worstPct) { worstPct = pct; worstHost = h }
        }
        const level = _classify(worstPct, thr.blockPublicPct)
        if (level !== lastLevel.current) {
          if (level === 'amber' && lastLevel.current === 'green') {
            toast(`Binance quota rising: ${worstHost} ${worstPct.toFixed(0)}%`, 3000)
          } else if (level === 'red' && lastLevel.current !== 'red' && lastLevel.current !== 'block') {
            toast(`Binance quota high: ${worstHost} ${worstPct.toFixed(0)}% — gate may fire soon`, 4000)
          } else if (level === 'block') {
            toast(`Binance quota at gate threshold: ${worstHost} ${worstPct.toFixed(0)}% — preemptive 429 active`, 5000)
          }
          lastLevel.current = level
        }

        // [Phase A.2 visibility] Toast on first scheduler reject (per session)
        const sched = data.schedulerStats
        if (sched) {
          const totalRejected = Object.values(sched.byLane || {}).reduce((s, v) => s + ((v as LaneStats).rejected || 0), 0)
          if (totalRejected > lastSchedRejected.current && lastSchedRejected.current === 0) {
            const reasons = sched.byReason || {}
            const reasonStr = Object.entries(reasons).map(([k, v]) => `${k}:${v}`).join(' ')
            toast(`Scheduler backpressure: ${totalRejected} rejected (${reasonStr})`, 4000)
          }
          lastSchedRejected.current = totalRejected
        }
      } catch (_) {
        // silent — diag endpoint failures shouldn't show user errors
      }
    }

    fetchOnce()
    timer = setInterval(fetchOnce, POLL_INTERVAL_MS)
    return () => { cancelled = true; if (timer) clearInterval(timer) }
  }, [])

  if (!snap || !snap.quotaPressure || !snap.quotaThresholds) return null

  const thr = snap.quotaThresholds
  const press = snap.quotaPressure

  // Determine worst-host pressure (display takes the most-pressed host)
  let worstHost = ''
  let worstPct = 0
  for (const [h, p] of Object.entries(press)) {
    const pct = (p as number) * 100
    if (pct > worstPct) { worstPct = pct; worstHost = h }
  }
  if (worstPct === 0) return null  // no usedWeight data yet

  const level = _classify(worstPct, thr.blockPublicPct)
  const colorClass = `zmb-quota-${level}`

  // Tooltip with per-host detail
  const tipLines: string[] = [
    `Binance quota pressure (last X-MBX-USED-WEIGHT-1M / cap ${thr.cap})`,
    `Block thresholds — public: ${thr.blockPublicPct}%, signed: ${thr.blockSignedPct}%`,
    '',
  ]
  for (const [h, p] of Object.entries(press)) {
    const pct = ((p as number) * 100).toFixed(1)
    const lastUsed = snap.byHost?.[h]?.lastUsedWeight ?? '?'
    const peakUsed = snap.byHost?.[h]?.peakUsedWeight ?? '?'
    tipLines.push(`${h}: ${pct}% (last ${lastUsed}, peak ${peakUsed})`)
  }

  // [Phase A.2 visibility] Scheduler breakdown
  const sched = snap.schedulerStats
  if (sched && sched.totalDecisions > 0) {
    tipLines.push('')
    tipLines.push(`Scheduler: ${sched.totalDecisions} decisions`)
    const laneSummary = Object.entries(sched.byLane || {})
      .map(([lane, v]) => `${lane}:${(v as LaneStats).accepted}/${(v as LaneStats).rejected}`)
      .filter((s) => !s.endsWith(':0/0'))
      .join(' ')
    if (laneSummary) tipLines.push(`  Lanes (acc/rej): ${laneSummary}`)
    const reasonSummary = Object.entries(sched.byReason || {})
      .map(([r, v]) => `${r}:${v}`)
      .join(' ')
    if (reasonSummary) tipLines.push(`  Rejected: ${reasonSummary}`)
  }
  const crit = snap.activeCriticalSections || 0
  if (crit > 0) {
    tipLines.push('')
    tipLines.push(`⚠ ${crit} critical section(s) active — order pipeline protected`)
  }
  const tip = tipLines.join('\n')

  // Compact display: dot + "QUOTA" label + pct. Optional CRIT badge when
  // critical section active. Host detail + scheduler stats in tooltip.
  return (
    <span
      className={`zmb-quota-indicator ${colorClass}`}
      title={tip}
      data-zmb-quota-level={level}
      data-zmb-quota-host={worstHost}
    >
      <span className="zmb-quota-dot"></span>
      <span className="zmb-quota-label">QUOTA</span>
      <span className="zmb-quota-pct">{worstPct.toFixed(0)}%</span>
      {crit > 0 && <span className="zmb-quota-crit" title="Order pipeline protected — critical section active">🛡</span>}
    </span>
  )
}
