/** ARES dock page view — 1:1 from initARES() in deepdive.js
 *  Entire panel is JS-generated in original. This is the visual shell. */
export function ARESPanel() {
  return (
    <>
      {/* Wound line + Decision line — from template lines 3593-3594 */}
      <div id="ares-wound-line">⚡ —</div>
      <div id="ares-decision-line" style={{ display: 'none', fontSize: 12, padding: '2px 8px', fontFamily: 'monospace' }}></div>

      <div id="ares-panel" style={{
      background: 'linear-gradient(180deg,#00050f 0%,#000818 60%,#000d20 100%)',
      padding: 0,
      fontFamily: 'monospace',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Radial glow overlay */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(ellipse at 50% 20%,#0080ff0a 0%,#00d9ff04 40%,transparent 75%)',
        pointerEvents: 'none', zIndex: 0,
      }} />

      {/* ── META ROW: Stage + Wallet + Objectives ── */}
      <div id="ares-meta-row" style={{ display: 'flex', gap: 0, padding: '8px 12px', position: 'relative', zIndex: 1 }}>
        {/* Stage Progress */}
        <div id="ares-stage-col" style={{ flex: 1 }}>
          <div className="ares-meta-title">STAGE PROGRESS</div>
          <div className="ares-stage-name" id="ares-stage-name" style={{ fontSize: '14px', fontWeight: 700, color: '#00d9ff', letterSpacing: '2px' }}>SEED</div>
          <div className="ares-prog-bar" id="ares-prog-bar" style={{ fontSize: '11px', color: '#0080ff', letterSpacing: '1px', fontFamily: 'monospace' }}>██░░░░░░░░ 0%</div>
          <div className="ares-prog-next" id="ares-prog-next" style={{ fontSize: '10px', color: '#556677', marginTop: '2px' }}>Next: 1,000</div>
        </div>

        {/* Wallet */}
        <div id="ares-wallet-col" style={{
          flex: '0 0 auto', minWidth: '110px', textAlign: 'center',
          borderLeft: '1px solid rgba(0,150,255,0.12)',
          borderRight: '1px solid rgba(0,150,255,0.12)',
          padding: '0 8px',
        }}>
          <div className="ares-meta-title" style={{ textAlign: 'center' }}>WALLET</div>
          <div id="ares-wallet-balance" style={{ fontFamily: 'monospace', fontSize: '11px', fontWeight: 700, color: '#00ff88', letterSpacing: '1px' }}>$0.00</div>
          <div id="ares-wallet-avail" style={{ fontFamily: 'monospace', fontSize: '11px', color: '#6a9a7a', marginTop: '1px' }}>
            Avail: <span id="ares-wallet-avail-val">$0</span> · Rest To Trade: <span id="ares-wallet-lock-val">$0</span>
          </div>
          <div style={{ marginTop: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', flexWrap: 'wrap' }}>
            <button style={{
              background: 'rgba(0,255,136,0.1)', border: '1px solid rgba(0,255,136,0.35)',
              color: '#00ff88', fontFamily: 'monospace', fontSize: '11px', padding: '2px 8px',
              cursor: 'pointer', borderRadius: '2px', letterSpacing: '1px',
            }}>[+] ADD</button>
            <button style={{
              background: 'rgba(255,80,80,0.08)', border: '1px solid rgba(255,80,80,0.3)',
              color: 'rgba(255,110,110,0.8)', fontFamily: 'monospace', fontSize: '11px', padding: '2px 8px',
              cursor: 'pointer', borderRadius: '2px', letterSpacing: '1px',
            }}>[-] WITHDRAW</button>
          </div>
          <span id="ares-wallet-fail" style={{
            display: 'none', background: 'rgba(255,40,40,0.18)', border: '1px solid rgba(255,50,50,0.45)',
            color: '#ff5555', fontFamily: 'monospace', fontSize: '11px', padding: '1px 5px',
            borderRadius: '2px', letterSpacing: '1px', marginTop: '3px',
          }}>NO FUNDS</span>
        </div>

        {/* Objectives */}
        <div id="ares-obj-col" style={{ flex: 1 }}>
          <div className="ares-meta-title" style={{ textAlign: 'right' }}>OBJECTIVES</div>
          <div className="ares-obj-item" style={{ textAlign: 'right', fontSize: '11px', color: '#556677', fontFamily: 'monospace' }}>100 → 1,000</div>
          <div className="ares-obj-bar" style={{ textAlign: 'right' }}></div>
          <div className="ares-obj-item" style={{ textAlign: 'right', fontSize: '11px', color: '#556677', fontFamily: 'monospace' }}>1,000 → 10,000</div>
          <div className="ares-obj-bar" style={{ textAlign: 'right' }}></div>
          <div className="ares-obj-item" style={{ textAlign: 'right', fontSize: '11px', color: '#556677', fontFamily: 'monospace' }}>10,000 → 1M</div>
          <div className="ares-obj-bar" style={{ textAlign: 'right' }}></div>
        </div>
      </div>

      {/* ── POSITIONS ── */}
      <div id="ares-positions-wrap" style={{ margin: '4px 12px 0', padding: '4px 0 2px', borderTop: '1px solid rgba(0,150,255,0.12)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
          <div className="ares-meta-title" style={{ margin: 0 }}>POSITIONS</div>
          <button id="ares-close-all-btn" style={{
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
      <div id="ares-arc-wrap" style={{ padding: '4px 12px' }}>
        <svg id="ares-arc-svg" viewBox="0 0 260 56" preserveAspectRatio="xMidYMid meet" style={{ width: '100%' }}></svg>
      </div>

      {/* ── CORE NEURAL BRAIN SVG ── */}
      <div id="ares-core-wrap" style={{ padding: '0 12px' }}>
        <svg id="ares-core-svg" viewBox="0 0 336 280" preserveAspectRatio="xMidYMid meet" style={{ width: '100%' }}>
          <text x="160" y="155" textAnchor="middle" fontFamily="monospace" fontSize="8" fill="#0080ff44">INITIALIZING NEURAL BRAIN...</text>
        </svg>
      </div>

      {/* ── COGNITIVE CLARITY BAR ── */}
      <div id="ares-cog-bar" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 12px', fontSize: '10px' }}>
        <span id="ares-cog-label" style={{ color: '#556677', letterSpacing: '1px' }}>CLARITATE COGNITIVĂ</span>
        <div id="ares-cog-track" style={{ flex: 1, height: '4px', background: '#0a1a2a', borderRadius: '2px', overflow: 'hidden' }}>
          <div id="ares-cog-fill" style={{ width: '0%', height: '100%', background: '#00d9ff', borderRadius: '2px', transition: 'width 1s' }}></div>
        </div>
        <span id="ares-cog-pct" style={{ color: '#00d9ff', fontFamily: 'monospace', fontWeight: 700 }}>—</span>
      </div>

      {/* ── STATS ROW ── */}
      <div id="ares-stats-row" style={{ display: 'flex', gap: 0, padding: '4px 12px', borderTop: '1px solid rgba(0,150,255,0.08)' }}>
        {[
          { label: 'TRAJECTORY Δ', id: 'ares-stat-delta', sub: 'vs curve' },
          { label: 'MISSION DAY', id: 'ares-stat-day', sub: 'elapsed', val: '— / 365' },
          { label: 'WIN RATE', id: 'ares-stat-wr', sub: 'last 10', val: '—%' },
          { label: 'PRED ACC', id: 'ares-stat-pred', sub: '5min pred', color: '#0080ff' },
        ].map((s) => (
          <div className="ares-stat-cell" key={s.id} style={{ flex: 1, textAlign: 'center', padding: '4px 0' }}>
            <div className="ares-stat-label" style={{ fontSize: '8px', color: '#445566', letterSpacing: '1.5px' }}>{s.label}</div>
            <div className="ares-stat-val" id={s.id} style={{ fontSize: '14px', fontWeight: 700, color: s.color || '#00d9ff', fontFamily: 'monospace' }}>{s.val || '—'}</div>
            <div className="ares-stat-sub" style={{ fontSize: '8px', color: '#334455' }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* ── THOUGHT LOG ── */}
      <div id="ares-thought-wrap" style={{ padding: '4px 12px', borderTop: '1px solid rgba(0,150,255,0.08)', maxHeight: '120px', overflowY: 'auto' }}>
        <div id="ares-thought-inner" style={{ fontSize: '11px', fontFamily: 'monospace', lineHeight: 1.8 }}>
          <div className="ares-thought-line new" style={{ color: '#00d9ff' }}>› ARES 1.0 — Neural Command Center online</div>
          <div className="ares-thought-line" style={{ color: '#445566' }}>› AUTONOMOUS mode — managing positions independently</div>
          <div className="ares-thought-line" style={{ color: '#445566' }}>› Awaiting market data...</div>
        </div>
      </div>

      {/* ── LESSON FROM MEMORY ── */}
      <div id="ares-lesson-wrap" style={{ padding: '6px 12px 8px', borderTop: '1px solid rgba(0,150,255,0.08)' }}>
        <div id="ares-lesson-label" style={{ fontSize: '9px', color: '#445566', letterSpacing: '1.5px', marginBottom: '3px' }}>◈ LAST LESSON FROM MEMORY</div>
        <div id="ares-lesson-text" style={{ fontSize: '11px', color: '#667788', fontFamily: 'monospace', lineHeight: 1.6 }}>Awaiting first trade analysis...</div>
        <div id="ares-history-bar"></div>
      </div>
    </div>
    </>
  )
}
