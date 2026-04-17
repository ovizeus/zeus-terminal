import { memo } from 'react'
import { useAresStore } from '../../../stores/aresStore'

/* [R28.2-F] Mission-arc progress SVG. React-rendered replacement for
 * the imperative `_aresRenderArc` which set `svg.innerHTML = ...` on
 * every _aresRender tick. Store slice `ui.missionArc` is populated by
 * aresStoreSync on each tick.
 */

const W = 260
const PAD = 20
const ARC_W = W - PAD * 2

export const MissionArc = memo(function MissionArc() {
  const arc = useAresStore((s) => s.ui.missionArc)
  if (!arc.visible) {
    return (
      <svg id="ares-arc-svg" viewBox="0 0 260 56" preserveAspectRatio="xMidYMid meet" />
    )
  }

  const xActual = PAD + arc.pct * ARC_W
  const xTarget = PAD + arc.tPct * ARC_W
  const col = arc.col
  const delta = arc.trajectoryDelta
  const startLbl = arc.startBalance ? '$' + Math.round(arc.startBalance).toLocaleString() : '$?'
  const dayLbl = 'MISSION ARC \u2014 DAY ' + arc.daysPassed + '/365'

  return (
    <svg id="ares-arc-svg" viewBox="0 0 260 56" preserveAspectRatio="xMidYMid meet">
      <line x1={PAD} y1={32} x2={PAD + ARC_W} y2={32} stroke="#0a1520" strokeWidth={4} strokeLinecap="round" />
      <line x1={PAD} y1={32} x2={PAD + ARC_W} y2={32} stroke={col + '22'} strokeWidth={2} strokeDasharray="3 5" strokeLinecap="round" />
      <line
        x1={PAD} y1={32} x2={xActual.toFixed(1)} y2={32}
        stroke={col} strokeWidth={3} strokeLinecap="round"
        style={{ filter: `drop-shadow(0 0 4px ${col})` }}
      />
      <line
        x1={xTarget.toFixed(1)} y1={26} x2={xTarget.toFixed(1)} y2={38}
        stroke={col + '88'} strokeWidth={1} strokeDasharray="2 2"
      />
      <circle
        cx={xActual.toFixed(1)} cy={32} r={5}
        fill={col} stroke="#010408" strokeWidth={2}
        style={{ filter: `drop-shadow(0 0 8px ${col})`, animation: 'aresCoreDot 1.5s ease-in-out infinite' }}
      />
      <text x={PAD} y={52} fontFamily="monospace" fontSize={7} fill={col + '44'}>{startLbl}</text>
      <text x={PAD + ARC_W} y={52} fontFamily="monospace" fontSize={7} fill={col + '44'} textAnchor="end">$1,000,000</text>
      <text x={PAD + ARC_W / 2} y={16} fontFamily="monospace" fontSize={6} fill={col + '88'} textAnchor="middle" letterSpacing={2}>{dayLbl}</text>
      {Math.abs(delta) > 0.1 ? (
        <text
          x={xActual.toFixed(1)}
          y={xActual > xTarget ? 22 : 46}
          fontFamily="monospace" fontSize={6}
          fill={delta >= 0 ? '#00ff88' : '#ff4466'}
          textAnchor="middle"
          style={{ filter: `drop-shadow(0 0 4px ${delta >= 0 ? '#00ff88' : '#ff4466'})` }}
        >
          {(delta >= 0 ? '+' : '') + delta + '%'}
        </text>
      ) : null}
    </svg>
  )
})
