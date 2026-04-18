/** ARES dock page view — 1:1 from initARES() + initAriaBrain() in deepdive.js
 *  Entire panel is JS-generated in original. This is the visual shell
 *  including the strip bar, neural brain SVG, and all sections. */
import { useCallback, useEffect, useRef } from 'react'
import { _aresRender } from '../../engine/aresUI'
import { StripBadge } from './ares/StripBadge'
import { StripConf } from './ares/StripConf'
import { ImmSpan } from './ares/ImmSpan'
import { EmotionSpan } from './ares/EmotionSpan'
import { CognitiveBar } from './ares/CognitiveBar'
import { StatsRow } from './ares/StatsRow'
import { StageCol } from './ares/StageCol'
import { WalletCol } from './ares/WalletCol'
import { ObjectivesCol } from './ares/ObjectivesCol'

// ── 136 brain nodes from deepdive.js initAriaBrain() line 3181 ──
const BRAIN_NODES: [number, number][] = [
  [175.8,93.6],[105.6,172.3],[106.7,127.4],[91.9,115.7],[84.0,149.6],[167.4,87.2],[224.9,146.7],[192.7,169.4],[217.0,139.1],[177.9,104.1],
  [122.5,82.5],[131.5,177.6],[136.7,204.4],[112.5,91.8],[84.0,123.3],[92.4,105.3],[184.3,164.2],[164.7,125.7],[59.7,82.5],[154.2,161.2],
  [148.4,92.4],[141.0,192.1],[204.3,95.3],[247.1,122.7],[93.5,175.2],[114.6,250.5],[38.0,104.1],[53.3,161.8],[170.0,230.1],[249.2,132.7],
  [238.1,202.6],[152.6,141.4],[289.8,233.6],[113.0,79.6],[278.2,107.6],[75.0,11.9],[213.3,200.3],[136.2,142.6],[94.0,132.1],[100.9,179.9],
  [100.9,95.9],[101.4,199.7],[74.5,151.9],[40.1,178.7],[164.7,149.0],[183.7,87.8],[197.5,100.6],[173.7,133.2],[139.9,78.4],[119.3,179.3],
  [60.2,199.7],[123.0,63.3],[118.3,128.0],[166.8,175.2],[128.3,122.7],[226.5,88.9],[162.6,114.0],[149.4,179.3],[80.3,199.1],[71.8,130.3],
  [74.5,77.8],[230.2,156.0],[70.2,169.4],[180.0,68.5],[261.9,141.4],[80.3,90.7],[105.1,140.8],[111.9,155.4],[245.0,178.7],[77.6,182.2],
  [153.6,100.0],[156.3,64.4],[220.2,74.3],[201.2,152.5],[124.1,111.7],[122.5,51.0],[104.5,83.1],[201.7,185.7],[72.3,103.5],[107.2,209.6],
  [73.9,116.9],[80.8,158.3],[252.9,110.5],[217.0,179.3],[184.8,137.3],[170.0,213.1],[146.8,125.1],[180.6,153.1],[94.5,160.1],[132.5,156.6],
  [160.0,30.6],[231.2,36.4],[203.3,77.3],[183.2,116.9],[96.6,218.4],[114.6,233.6],[76.6,46.3],[103.0,228.9],[128.8,268.0],[75.0,62.7],
  [34.3,82.5],[306.2,107.6],[203.8,173.5],[307.8,191.0],[120.9,195.1],[191.1,209.6],[236.0,191.6],[158.4,207.3],[243.9,72.6],[145.7,114.0],
  [126.7,101.8],[294.1,107.6],[227.5,121.0],[198.5,124.5],[279.3,188.1],[186.4,195.1],[240.7,233.6],[44.9,200.3],[212.2,229.5],[166.8,261.6],
  [121.4,37.0],[289.8,195.6],[238.1,266.2],[44.4,82.5],[224.9,105.8],[205.9,111.7],[223.9,163.0],[60.7,135.6],[95.0,206.1],[262.9,153.1],
  [90.3,184.6],[165.8,201.5],[123.6,208.5],[161.0,183.4],[36.4,229.5],[28.0,182.8],
]

const HOT_IDX = new Set([0,5,9,22,23,29,31,34,55,63,72,82,91,92,101,108,111,112,124,125])

const ZONES = [
  { name: 'Lobul frontal', sub: 'Decizie · Planificare', cx: 85, cy: 110, r: 52, col: '#2962FF', pinX: 87, pinY: 80 },
  { name: 'Lobul parietal', sub: 'Mișcare · Senzații', cx: 190, cy: 95, r: 55, col: '#00E5FF', pinX: 155, pinY: 30 },
  { name: 'Lobul temporal', sub: 'Memorie · Auz', cx: 100, cy: 175, r: 45, col: '#2962FF', pinX: 87, pinY: 178 },
  { name: 'Lobul occipital', sub: 'Vizual · Chart', cx: 240, cy: 145, r: 48, col: '#00E5FF', pinX: 253, pinY: 125 },
  { name: 'Cerebelul', sub: 'Echilibru · SL/TP', cx: 195, cy: 215, r: 42, col: '#FFB000', pinX: 218, pinY: 248 },
  { name: 'Trunchi cerebral', sub: 'AutoTrade · Kill-switch', cx: 140, cy: 215, r: 35, col: '#C1121F', pinX: 127, pinY: 232 },
]

const ACCENT_COLS = ['#00E5FF','#2962FF','#FFB000','#C1121F','#B0BEC5']

const LOB_DOTS: [number, number, string, string, string][] = [
  [0, 14, 'ldot-frontal', 'POLICY: BALANCED', 'ok'],
  [1, 14, 'ldot-parietal', '', 'ok'],
  [2, 14, 'ldot-temporal', 'MEMORY: OK', 'ok'],
  [3, 14, 'ldot-occipital', 'VISION: CLEAR', 'ok'],
  [4, 14, 'ldot-cerebel', 'EXEC: —', 'warn'],
  [5, 14, 'ldot-trunchi', 'SURVIVAL: STABLE', 'ok'],
]
const DOT_COLORS: Record<string, string> = { ok: '#00ff88', bad: '#ff3355', warn: '#f0c040' }

function buildEdges(nodes: [number, number][], maxDist = 50, maxPer = 3): [number, number][] {
  const edges: [number, number][] = []
  const used = new Set<string>()
  for (let i = 0; i < nodes.length; i++) {
    const [ax, ay] = nodes[i]
    const dists = nodes.map(([bx, by], j) => ({ j, d: Math.hypot(bx - ax, by - ay) }))
      .filter(({ j, d }) => j !== i && d < maxDist)
      .sort((a, b) => a.d - b.d)
      .slice(0, maxPer)
    for (const { j } of dists) {
      const key = Math.min(i, j) + '-' + Math.max(i, j)
      if (!used.has(key)) { used.add(key); edges.push([i, j]) }
    }
  }
  return edges
}

function starPath(cx: number, cy: number, rCore: number, nSpikes: number, spikeLen: number): string {
  let d = ''
  for (let s = 0; s < nSpikes; s++) {
    const ang = (s / nSpikes) * Math.PI * 2
    const angB = ang + Math.PI / nSpikes
    const ox1 = cx + Math.cos(ang) * rCore
    const oy1 = cy + Math.sin(ang) * rCore
    const ox2 = cx + Math.cos(ang) * (rCore + spikeLen)
    const oy2 = cy + Math.sin(ang) * (rCore + spikeLen)
    const mx = cx + Math.cos(angB) * rCore * 0.45
    const my = cy + Math.sin(angB) * rCore * 0.45
    d += `M${ox1.toFixed(2)},${oy1.toFixed(2)} L${ox2.toFixed(2)},${oy2.toFixed(2)} L${mx.toFixed(2)},${my.toFixed(2)} `
  }
  return d.trim()
}

/** Generate brain SVG content — 1:1 from initAriaBrain() in deepdive.js */
function generateBrainSVG(svgEl: SVGSVGElement) {
  const EDGES = buildEdges(BRAIN_NODES, 50, 3)

  // Seeded PRNG — same as deepdive.js line 3270
  let _cSeed = 0x7F3A9C21
  function _cPrng() { _cSeed ^= _cSeed << 13; _cSeed ^= _cSeed >> 17; _cSeed ^= _cSeed << 5; return ((_cSeed >>> 0) / 0xFFFFFFFF) }

  const NODE_ACCENT = BRAIN_NODES.map((_, i) => {
    const hot = HOT_IDX.has(i)
    if (hot) return ACCENT_COLS[Math.floor(_cPrng() * ACCENT_COLS.length)]
    return _cPrng() < 0.22 ? ACCENT_COLS[Math.floor(_cPrng() * ACCENT_COLS.length)] : null
  })

  let svg = `
  <defs>
    <filter id="abFN" x="-150%" y="-150%" width="400%" height="400%">
      <feGaussianBlur stdDeviation="4" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="abHot" x="-150%" y="-150%" width="400%" height="400%">
      <feGaussianBlur stdDeviation="6" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <radialGradient id="abPink" cx="32%" cy="58%" r="40%">
      <stop offset="0%" stop-color="#cc224488"/>
      <stop offset="100%" stop-color="transparent"/>
    </radialGradient>
    <radialGradient id="abBlue" cx="70%" cy="40%" r="45%">
      <stop offset="0%" stop-color="#0044aa44"/>
      <stop offset="100%" stop-color="transparent"/>
    </radialGradient>
  </defs>
  <ellipse cx="90" cy="155" rx="80" ry="70" fill="url(#abPink)"
    style="animation:ariaZone 3.5s ease-in-out infinite"/>
  <ellipse cx="230" cy="120" rx="85" ry="75" fill="url(#abBlue)"
    style="animation:ariaZone 4.2s ease-in-out infinite 0.8s"/>
  `

  // Zone highlights
  ZONES.forEach((z, zi) => {
    const dur = (2.8 + zi * 0.45).toFixed(1)
    const del = (zi * 0.6).toFixed(1)
    svg += `
    <ellipse cx="${z.cx}" cy="${z.cy}" rx="${z.r}" ry="${z.r * 0.72}"
    fill="none" stroke="${z.col}" stroke-width="1" stroke-opacity="0.35"
    stroke-dasharray="5 4"
    style="animation:ariaZone ${dur}s ease-in-out infinite ${del}s"/>`
  })

  // Edges
  EDGES.forEach(([a, b], i) => {
    const [ax, ay] = BRAIN_NODES[a], [bx, by] = BRAIN_NODES[b]
    const hot = HOT_IDX.has(a) || HOT_IDX.has(b)
    const op = hot ? '0.55' : '0.22'
    const lw = hot ? 1.0 : 0.55
    const dur = (2.5 + (i % 8) * 0.4).toFixed(1)
    svg += `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}"
    stroke="white" stroke-width="${lw}" stroke-opacity="${op}"
    ${hot ? `stroke-dasharray="6 3" style="animation:ariaEdge ${dur}s linear infinite ${(i * 0.05 % 2).toFixed(2)}s"` : ''}/>`
  })

  // 136 nodes — neuron-star shape
  BRAIN_NODES.forEach(([x, y], i) => {
    const hot = HOT_IDX.has(i)
    const rCore = hot ? 2.8 : 1.6
    const nSpikes = hot ? 6 : 4
    const spikeL = hot ? 3.5 : 2.2
    const baseOp = hot ? 0.70 : 0.28
    const accentCol = NODE_ACCENT[i]
    const fillCol = accentCol || 'white'
    const glowCol = accentCol || '#aaccff'
    const starD = starPath(x, y, rCore, nSpikes, spikeL)
    svg += `
  <circle id="abn-g${i}" cx="${x}" cy="${y}" r="${rCore + 5}" fill="${fillCol}" opacity="0.03" filter="url(#abFN)"/>
  <circle id="abn-c${i}" cx="${x}" cy="${y}" r="${rCore}" fill="${fillCol}" opacity="${baseOp}"
    style="filter:drop-shadow(0 0 ${hot ? 9 : 3}px ${glowCol}) drop-shadow(0 0 ${hot ? 16 : 6}px ${glowCol})"/>
  <path  id="abn-${i}"  d="${starD}" fill="${fillCol}" opacity="${(baseOp * 0.7).toFixed(2)}"
    stroke="${fillCol}" stroke-width="0.3" stroke-opacity="0.5"/>`
  })

  // Particles on hot edges
  EDGES.filter((_, i) => HOT_IDX.has(EDGES[i]?.[0]) || HOT_IDX.has(EDGES[i]?.[1])).slice(0, 20).forEach(([a, b], i) => {
    const [ax, ay] = BRAIN_NODES[a], [bx, by] = BRAIN_NODES[b]
    const dur = (1.4 + i * 0.18).toFixed(1)
    svg += `<circle r="2" fill="white" opacity="0.85"
    style="filter:drop-shadow(0 0 5px white)">
    <animateMotion dur="${dur}s" repeatCount="indefinite" begin="${(i * 0.3).toFixed(1)}s"
      path="M${ax},${ay} L${bx},${by}"/>
  </circle>`
  })

  // Zone labels with pin + line
  ZONES.forEach((z, zi) => {
    const dur = (3.0 + zi * 0.5).toFixed(1)
    const del = (zi * 0.55).toFixed(1)
    const isLeft = z.pinX < 130
    const isBottom = z.pinY > 250
    const ta = isLeft ? 'end' : isBottom ? 'middle' : 'start'
    const lx2 = isLeft ? z.pinX + 32 : isBottom ? z.pinX : z.pinX - 32
    const ly2 = isBottom ? z.pinY - 12 : z.pinY
    svg += `
  <circle cx="${z.cx}" cy="${z.cy}" r="3.5" fill="${z.col}"
    style="filter:drop-shadow(0 0 6px ${z.col});animation:ariaHot ${dur}s ease-in-out infinite ${del}s"/>
  <line x1="${z.cx}" y1="${z.cy}" x2="${lx2}" y2="${ly2}"
    stroke="${z.col}" stroke-width="0.8" stroke-opacity="0.7" stroke-dasharray="4 3"/>
  <text x="${z.pinX}" y="${isBottom ? z.pinY + 12 : z.pinY - 8}" text-anchor="${ta}"
    font-family="monospace" font-size="7" font-weight="900"
    fill="${z.col}" style="filter:drop-shadow(0 0 5px ${z.col})88;opacity:0.88">${z.name}</text>
  <text x="${z.pinX}" y="${isBottom ? z.pinY + 21 : z.pinY + 2}" text-anchor="${ta}"
    font-family="monospace" font-size="5" fill="${z.col}" opacity="0.62">${z.sub}</text>`
  })

  // Lobe status dots
  LOB_DOTS.forEach(([zi, offY, dotId, txt, lvl]) => {
    const z = ZONES[zi]
    const isB = z.pinY > 250
    const isL = z.pinX < 130
    const ta = isL ? 'end' : isB ? 'middle' : 'start'
    const baseY = isB ? z.pinY + 21 : z.pinY + 2
    const dotY = baseY + offY
    const col = DOT_COLORS[lvl] || DOT_COLORS.warn

    if (zi === 1) {
      // Parietal: CONSCIOUSNESS cu 3 dots
      svg += `
  <circle id="ldot-c0" cx="${z.pinX + (isL ? -6 : 6)}" cy="${dotY - 1}" r="2.2" fill="#00ff88" opacity="0.85"
    style="filter:drop-shadow(0 0 3px #00ff88)"/>
  <text id="ldot-parietal-seed" x="${z.pinX + (isL ? -11 : 11)}" y="${dotY + 1}" text-anchor="${ta}"
    font-family="monospace" font-size="5" fill="#00ff88" opacity="0.82">SEED</text>
  <circle id="ldot-c1" cx="${z.pinX + (isL ? -6 : 6)}" cy="${dotY + 8}" r="2.2" fill="#555577" opacity="0.6"/>
  <text id="ldot-parietal-ascent" x="${z.pinX + (isL ? -11 : 11)}" y="${dotY + 10}" text-anchor="${ta}"
    font-family="monospace" font-size="5" fill="#7788aa" opacity="0.55">ASCENT</text>
  <circle id="ldot-c2" cx="${z.pinX + (isL ? -6 : 6)}" cy="${dotY + 16}" r="2.2" fill="#555577" opacity="0.6"/>
  <text id="ldot-parietal-sovereign" x="${z.pinX + (isL ? -11 : 11)}" y="${dotY + 18}" text-anchor="${ta}"
    font-family="monospace" font-size="5" fill="#7788aa" opacity="0.55">SOVEREIGN</text>`
    } else {
      svg += `
  <circle id="${dotId}-c" cx="${z.pinX + (isL ? -6 : 6)}" cy="${dotY - 1}" r="2.2" fill="${col}" opacity="0.85"
    style="filter:drop-shadow(0 0 3px ${col})"/>
  <text id="${dotId}" x="${z.pinX + (isL ? -11 : 11)}" y="${dotY + 1}" text-anchor="${ta}"
    font-family="monospace" font-size="5" fill="${col}" opacity="0.75">${txt}</text>`
    }
  })

  svgEl.innerHTML = svg
}

/**
 * ARESPanel scaffold.
 *
 * [R28.2] Migration in progress. Narrow subtrees are progressively
 * moved to store-subscribing memo'd children (StripBadge, StripConf,
 * ImmSpan, EmotionSpan, CognitiveBar, StatsRow, ...). The parent
 * itself does NOT subscribe — only mounted children re-render on
 * their own slices of `useAresStore((s) => s.ui.…)`. The sync
 * adapter `engine/aresStoreSync.ts` populates those slices on every
 * aresUI render tick.
 *
 * The strip open/close toggle still uses a ref + `classList.toggle`
 * and will move to the store in R28.2-H.
 */
export function ARESPanel() {
  const coreSvgRef = useRef<SVGSVGElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)

  // Generate brain SVG on mount — 1:1 from initAriaBrain() in deepdive.js
  useEffect(() => {
    if (coreSvgRef.current) generateBrainSVG(coreSvgRef.current)
  }, [])

  const toggleOpen = useCallback(() => {
    stripRef.current?.classList.toggle('open')
  }, [])

  return (
    <div id="ares-strip" ref={stripRef} className="open">
      {/* ── Strip Bar (collapsible header) — 1:1 from deepdive.js line 3579 ── */}
      <div id="ares-strip-bar" onClick={toggleOpen}>
        <div className="v6-accent">
          <div className="v6-ico">
            <svg viewBox="0 0 24 24">
              <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5"/>
              <circle cx="12" cy="12" r="4"/>
              <line x1="12" y1="2" x2="12" y2="8"/>
              <line x1="22" y1="8.5" x2="16" y2="12"/>
              <line x1="12" y1="22" x2="12" y2="16"/>
              <line x1="2" y1="8.5" x2="8" y2="12"/>
            </svg>
          </div>
          <span className="v6-lbl">ARES</span>
        </div>
        <div className="v6-content">
          <div id="ares-strip-title">
            <span>ARES</span>
            <span style={{ fontSize: 11, color: '#00d9ff44', letterSpacing: 1 }}>NEURAL COMMAND</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <StripBadge />
            <StripConf />
            <ImmSpan />
            <EmotionSpan />
            <span id="ares-strip-chev">▼</span>
          </div>
        </div>
      </div>

      {/* Wound line + Decision line — from template lines 3593-3594 */}
      <div id="ares-wound-line">⚠ —</div>
      <div id="ares-decision-line" style={{ display: 'none', fontSize: 12, padding: '2px 8px', fontFamily: 'monospace' }}></div>

      <div id="ares-strip-panel">
        <div id="ares-panel">

      {/* ── META ROW: Stage + Wallet + Objectives (R28.2-D store-driven) ── */}
      <div id="ares-meta-row">
        <StageCol />
        <WalletCol />
        <ObjectivesCol />
      </div>

      {/* ── POSITIONS ── */}
      <div id="ares-positions-wrap" style={{ margin: '4px 12px 0', padding: '4px 0 2px', borderTop: '1px solid rgba(0,150,255,0.12)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
          <div className="ares-meta-title" style={{ margin: 0 }}>POSITIONS</div>
          <button id="ares-close-all-btn" onClick={() => {
            const w = window as any
            if (typeof w.ARES !== 'undefined' && w.ARES.positions) { w.ARES.positions.closeAll(); setTimeout(() => _aresRender(), 100) }
          }} style={{
            display: 'none', background: 'rgba(255,50,50,0.15)', border: '1px solid rgba(255,50,50,0.4)',
            color: 'rgba(255,100,100,0.85)', fontFamily: 'monospace', fontSize: '11px', padding: '2px 7px',
            cursor: 'pointer', borderRadius: '2px', letterSpacing: '1px',
          }}>CLOSE ALL</button>
        </div>
        <div id="ares-positions-list" style={{ maxHeight: '220px', overflowY: 'auto' }}>
          <div style={{ color: 'rgba(255,255,255,0.25)', fontSize: '12px', fontFamily: 'monospace', padding: '2px 0' }}>— none —</div>
        </div>
      </div>

      {/* ── ARC SVG ── */}
      <div id="ares-arc-wrap">
        <svg id="ares-arc-svg" viewBox="0 0 260 56" preserveAspectRatio="xMidYMid meet"></svg>
      </div>

      {/* ── CORE NEURAL BRAIN SVG — generated by initAriaBrain() ── */}
      <div id="ares-core-wrap">
        <svg ref={coreSvgRef} id="ares-core-svg" viewBox="0 0 336 280" preserveAspectRatio="xMidYMid meet">
          <text x="160" y="155" textAnchor="middle" fontFamily="monospace" fontSize="8" fill="#0080ff44">INITIALIZING NEURAL BRAIN...</text>
        </svg>
      </div>

      {/* ── COGNITIVE CLARITY BAR (R28.2-C store-driven) ── */}
      <CognitiveBar />

      {/* ── STATS ROW (R28.2-C store-driven) ── */}
      <StatsRow />

      {/* ── THOUGHT LOG ── */}
      <div id="ares-thought-wrap">
        <div id="ares-thought-inner">
          <div className="ares-thought-line new">› ARES 1.0 — Neural Command Center online</div>
          <div className="ares-thought-line">› AUTONOMOUS mode — managing positions independently</div>
          <div className="ares-thought-line">› Awaiting market data...</div>
        </div>
      </div>

      {/* ── LESSON FROM MEMORY ── */}
      <div id="ares-lesson-wrap">
        <div id="ares-lesson-label">◈ LAST LESSON FROM MEMORY</div>
        <div id="ares-lesson-text">Awaiting first trade analysis...</div>
        <div id="ares-history-bar"></div>
      </div>

        </div>
      </div>
    </div>
  )
}
