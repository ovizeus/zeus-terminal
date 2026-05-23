import { memo } from 'react'
import { useAresStore } from '../../../stores/aresStore'

/** Stats row: Δ / Day / WR / Pred. */
export const StatsRow = memo(function StatsRow() {
  const stats = useAresStore((s) => s.ui.stats)
  const predAcc = useAresStore((s) => s.ui.cognitive.predictionAccuracy)
  const deltaColor = stats.delta.startsWith('-') ? '#ff4466' : '#00ff88'
  const predColor = predAcc > 0 ? (predAcc > 55 ? '#00d9ff' : '#ff9944') : '#445566'
  return (
    <div id="ares-stats-row">
      <div className="ares-stat-cell">
        <div className="ares-stat-label">TRAJECTORY Δ</div>
        <div className="ares-stat-val" id="ares-stat-delta" style={{ color: deltaColor }}>{stats.delta || '—'}</div>
        <div className="ares-stat-sub">vs curve</div>
      </div>
      <div className="ares-stat-cell">
        <div className="ares-stat-label">MISSION DAY</div>
        <div className="ares-stat-val" id="ares-stat-day" style={{ color: '#00d9ff' }}>{stats.day || '— / 365'}</div>
        <div className="ares-stat-sub">elapsed</div>
      </div>
      <div className="ares-stat-cell">
        <div className="ares-stat-label">WIN RATE</div>
        <div className="ares-stat-val" id="ares-stat-wr" style={{ color: '#00d9ff' }}>{stats.winRate || '—%'}</div>
        <div className="ares-stat-sub">last 10</div>
      </div>
      <div className="ares-stat-cell">
        <div className="ares-stat-label">PRED ACC</div>
        <div className="ares-stat-val" id="ares-stat-pred" style={{ color: predColor }}>{stats.prediction || '—'}</div>
        <div className="ares-stat-sub">5min pred</div>
      </div>
    </div>
  )
})
