import { useState, useMemo } from 'react'

// Seeded PRNG so bubbles/drops are deterministic but look random (same as JS Math.random output)
function seededRandom(seed: number) {
  let s = seed
  return () => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647 }
}

/** 1:1 port of #dslZone from public/index.html lines 1573-1681
 *  + initDSLBubbles() from dsl.js lines 181-204 */
export function DSLZonePanel() {
  const [dslOn, setDslOn] = useState(false)

  // Generate 12 floating bubbles (same logic as dsl.js initDSLBubbles)
  const bubbles = useMemo(() => {
    const rng = seededRandom(42)
    return Array.from({ length: 12 }, (_, i) => {
      const size = 4 + rng() * 8
      const left = 5 + rng() * 90
      const dur = 3 + rng() * 5
      const delay = rng() * 4
      const col = rng() > 0.5 ? '#00ffcc' : '#0066ff'
      return (
        <div key={`b${i}`} className="dsl-bubble" style={{
          width: `${size}px`, height: `${size}px`, left: `${left}%`,
          background: col, opacity: 0.15,
          animationDuration: `${dur}s`, animationDelay: `${delay}s`,
          boxShadow: `0 0 ${size}px ${col}44`,
        }} />
      )
    })
  }, [])

  // Generate 20 cascade drops (same logic as dsl.js initDSLBubbles)
  const drops = useMemo(() => {
    const rng = seededRandom(99)
    return Array.from({ length: 20 }, (_, i) => {
      const h = 4 + rng() * 10
      const dur = 0.4 + rng() * 0.6
      const del = rng() * 1.5
      const col = rng() > 0.4 ? '#00ffcc' : '#0088ff'
      return (
        <div key={`d${i}`} className="dsl-drop" style={{
          height: `${h}px`, background: col,
          animationDuration: `${dur}s`, animationDelay: `${del}s`,
          opacity: 0.7,
        }} />
      )
    })
  }, [])

  return (
    <div className={`dsl-zone${dslOn ? '' : ' dsl-zone-locked'}`} id="dslZone">
      {/* Liquid background bubbles (12 — from initDSLBubbles in dsl.js) */}
      <div className="dsl-liquid-bg" id="dslLiquidBg">{bubbles}</div>

      {/* Neon pipes */}
      <div className="dsl-tubes">
        <div className="dsl-pipe-h" style={{ top: '28%', left: 0, right: 0, animationDelay: '.3s' }}></div>
        <div className="dsl-pipe-h" style={{ top: '72%', left: 0, right: 0, animationDelay: '1.1s' }}></div>
        <div className="dsl-pipe-v" style={{ left: '18%', top: 0, bottom: 0, animationDelay: '.7s' }}></div>
        <div className="dsl-pipe-v" style={{ left: '55%', top: 0, bottom: 0, animationDelay: '1.5s' }}></div>
        <div className="dsl-pipe-v" style={{ right: '15%', top: 0, bottom: 0, animationDelay: '.2s' }}></div>
      </div>

      {/* Header */}
      <div className="dsl-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span className="dsl-status-dot" id="dslStatusDot" style={{ color: '#00ffcc', background: '#00ffcc' }}></span>
          <span className="dsl-title">⬡ DYNAMIC SL ZONE ○ BRAIN TRAILING ENGINE — by OVI</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span id="dslActiveCount" style={{ fontSize: '7px', color: '#00ffcc44' }}>0 active</span>
          <button className={`dsl-toggle${dslOn ? '' : ' off'}`} id="dslToggleBtn" onClick={() => setDslOn(!dslOn)}>
            {dslOn ? 'DSL ENGINE ON' : 'DSL ENGINE OFF'}
          </button>
        </div>
      </div>

      {/* AUTO LOCK OVERLAY */}
      <div className="dsl-lock-overlay" id="dslLockOverlay">
        <div className="dsl-lock-badge">LOCKED BY AI</div>
        <div className="dsl-lock-sub">AUTO MODE — DSL ENGINE CONTROLAT DE BRAIN</div>
      </div>

      {/* ASSIST ARM BAR */}
      <div className="dsl-assist-bar" id="dslAssistBar">
        <span className="dsl-assist-status" id="dslAssistStatus">ASSIST — necesită armare pentru execuție</span>
        <button className="dsl-assist-arm" id="dslAssistArmBtn">ARM ASSIST</button>
      </div>

      {/* Cascade drops (20 — neon rain from initDSLBubbles in dsl.js) */}
      <div className="dsl-cascade" id="dslCascade">{drops}</div>

      {/* Config */}
      <div className="dsl-config" style={{ display: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span className="dsl-lbl" style={{ minWidth: '62px', color: '#f0c040bb' }}>OPEN DSL:</span>
          <input className="dsl-inp" type="number" defaultValue={40} id="dslActivatePct" min={0.1} max={100} step={0.1} style={{ width: '58px', borderColor: '#f0c04044' }} />
          <span className="dsl-lbl" style={{ color: '#f0c04077' }}>% TP</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span className="dsl-lbl" style={{ minWidth: '68px', color: '#ff69b4' }}>PIVOT LEFT:</span>
          <input className="dsl-inp" type="number" defaultValue={0.8} id="dslTrailPct" min={0.1} max={10} step={0.1} style={{ width: '58px', borderColor: '#ff69b444' }} />
          <span className="dsl-lbl" style={{ color: '#ff69b477' }}>% ↓</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span className="dsl-lbl" style={{ minWidth: '62px', color: '#aa44ffbb' }}>IMPULSE V:</span>
          <input className="dsl-inp" type="number" defaultValue={2} id="dslExtendPct" min={0.1} max={100} step={0.1} style={{ width: '58px', borderColor: '#aa44ff44' }} />
          <span className="dsl-lbl" style={{ color: '#aa44ff77' }}>% TP</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span className="dsl-lbl" style={{ minWidth: '68px', color: '#39ff14' }}>PIVOT RIGHT:</span>
          <input className="dsl-inp" type="number" defaultValue={1.0} id="dslTrailSusPct" min={0.1} max={10} step={0.1} style={{ width: '58px', borderColor: '#39ff1444' }} />
          <span className="dsl-lbl" style={{ color: '#39ff1477' }}>% ↑</span>
        </div>
      </div>

      {/* Dynamic position cards + waiting radar */}
      <div id="dslPositionCards">
        <div className="dsl-waiting" id="dslWaitingState">
          <div className="dsl-radar">
            <svg className="dsl-radar-svg" viewBox="0 0 80 80">
              <circle cx="40" cy="40" r="36" fill="none" stroke="#00ffcc11" strokeWidth="1" />
              <circle cx="40" cy="40" r="26" fill="none" stroke="#00ffcc0d" strokeWidth="1" />
              <circle cx="40" cy="40" r="16" fill="none" stroke="#00ffcc0a" strokeWidth="1" />
              <g className="dsl-radar-sweep">
                <path d="M40,40 L76,40 A36,36,0,0,0,40,4 Z" fill="url(#radarGrad)" opacity=".6" />
              </g>
              <defs>
                <radialGradient id="radarGrad" cx="50%" cy="50%">
                  <stop offset="0%" stopColor="#00ffcc" stopOpacity=".4" />
                  <stop offset="100%" stopColor="#00ffcc" stopOpacity="0" />
                </radialGradient>
              </defs>
              <circle cx="40" cy="40" r="3" fill="#00ffcc" opacity=".8">
                <animate attributeName="opacity" values="1;0.2;1" dur="1.5s" repeatCount="indefinite" />
              </circle>
            </svg>
          </div>
          <div>
            <div className="dsl-radar-txt">WAITING DYNAMIC SL...</div>
            <div style={{ fontSize: '6px', color: '#00ffcc22', marginTop: '3px', letterSpacing: '1px' }}>SCANEZ POZITII PENTRU ACTIVARE</div>
          </div>
        </div>
      </div>
    </div>
  )
}
