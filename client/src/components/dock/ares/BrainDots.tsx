import { memo } from 'react'
import { useAresStore } from '../../../stores/aresStore'
import type { AresLobDot } from '../../../types/ares'

/* [R28.2-F] Lob status dots + consciousness dots overlay for the brain SVG.
 *
 * Coordinates mirror the static zone pins produced by `generateBrainSVG` in
 * ARESPanel.tsx. Rendered as a sibling SVG with the same viewBox so the
 * dots land exactly on top of their anatomical zones without touching the
 * mount-once brain SVG generator.
 */

type Zone = { pinX: number; pinY: number }

// Pin coordinates — must match ARESPanel ZONES[].pinX/pinY exactly.
const ZONE_PINS: Zone[] = [
  { pinX: 87,  pinY: 80  }, // 0 frontal
  { pinX: 155, pinY: 30  }, // 1 parietal (consciousness column)
  { pinX: 87,  pinY: 178 }, // 2 temporal
  { pinX: 253, pinY: 125 }, // 3 occipital
  { pinX: 218, pinY: 248 }, // 4 cerebel
  { pinX: 127, pinY: 232 }, // 5 trunchi
]

// Lob id → zone index.
const ZONE_BY_LOB: Record<string, number> = {
  'ldot-frontal': 0,
  'ldot-temporal': 2,
  'ldot-occipital': 3,
  'ldot-cerebel': 4,
  'ldot-trunchi': 5,
}

/** Compute the dot/text placement for a lob zone. Matches generateBrainSVG. */
function _place(z: Zone, offY = 14) {
  const isL = z.pinX < 130
  const isB = z.pinY > 250
  const ta: 'start' | 'middle' | 'end' = isL ? 'end' : isB ? 'middle' : 'start'
  const baseY = isB ? z.pinY + 21 : z.pinY + 2
  const dotY = baseY + offY
  const dotCx = z.pinX + (isL ? -6 : 6)
  const textX = z.pinX + (isL ? -11 : 11)
  return { dotCx, dotY, textX, ta }
}

function LobDot({ dot }: { dot: AresLobDot }) {
  const z = ZONE_PINS[ZONE_BY_LOB[dot.id]]
  if (!z) return null
  const { dotCx, dotY, textX, ta } = _place(z)
  return (
    <g>
      <circle id={dot.id + '-c'} cx={dotCx} cy={dotY - 1} r={2.2} fill={dot.color} opacity={0.85}
        style={{ filter: `drop-shadow(0 0 3px ${dot.color})` }} />
      <text id={dot.id} x={textX} y={dotY + 1} textAnchor={ta}
        fontFamily="monospace" fontSize={5} fill={dot.color} opacity={0.75}>{dot.text}</text>
    </g>
  )
}

function Consciousness({ activeIdx }: { activeIdx: number }) {
  const z = ZONE_PINS[1]
  const { dotCx, dotY, textX, ta } = _place(z)

  const rows: { cDy: number; tDy: number; id: string; tId: string; label: string }[] = [
    { cDy: -1, tDy: 1,  id: 'ldot-c0', tId: 'ldot-parietal-seed',      label: 'SEED' },
    { cDy: 8,  tDy: 10, id: 'ldot-c1', tId: 'ldot-parietal-ascent',    label: 'ASCENT' },
    { cDy: 16, tDy: 18, id: 'ldot-c2', tId: 'ldot-parietal-sovereign', label: 'SOVEREIGN' },
  ]

  return (
    <g>
      {rows.map((r, ci) => {
        const active = ci === activeIdx
        const past = ci < activeIdx
        const dotFill = active ? '#00ff88' : past ? '#00d9ff88' : '#444466'
        const dotOp = active ? 0.95 : past ? 0.55 : 0.35
        const txtFill = active ? '#00ff88' : past ? '#00d9ff' : '#556677'
        const txtOp = active ? 0.9 : past ? 0.55 : 0.38
        const dotStyle = active ? { filter: 'drop-shadow(0 0 3px #00ff88)' } : undefined
        return (
          <g key={r.id}>
            <circle id={r.id} cx={dotCx} cy={dotY + r.cDy} r={2.2} fill={dotFill} opacity={dotOp} style={dotStyle} />
            <text id={r.tId} x={textX} y={dotY + r.tDy} textAnchor={ta}
              fontFamily="monospace" fontSize={5} fill={txtFill} opacity={txtOp}>{r.label}</text>
          </g>
        )
      })}
    </g>
  )
}

/** Store-driven brain-dots SVG overlay (absolute-positioned on top of #ares-core-svg). */
export const BrainDots = memo(function BrainDots() {
  const dots = useAresStore((s) => s.ui.lobDots)
  const activeIdx = useAresStore((s) => s.ui.consciousnessActiveIdx)
  return (
    <svg
      viewBox="0 0 336 280"
      preserveAspectRatio="xMidYMid meet"
      style={{
        position: 'absolute', left: 0, top: 0, right: 0, bottom: 0,
        width: '100%', height: '100%', pointerEvents: 'none',
        overflow: 'visible',
      }}
    >
      {dots.map((d) => <LobDot key={d.id} dot={d} />)}
      <Consciousness activeIdx={activeIdx} />
    </svg>
  )
})
