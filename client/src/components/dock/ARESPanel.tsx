/** ARES dock page view — 1:1 from initARES() in deepdive.js
 *  Entire panel is JS-generated in original. This is the visual shell. */
export function ARESPanel() {
  return (
    <>
      {/* Wound line + Decision line — from template lines 3593-3594 */}
      <div id="ares-wound-line">⚠ —</div>
      <div id="ares-decision-line" style={{ display: 'none', fontSize: 12, padding: '2px 8px', fontFamily: 'monospace' }}></div>

      <div id="ares-panel">

      {/* ── META ROW: Stage + Wallet + Objectives ── */}
      <div id="ares-meta-row">
        {/* Stage Progress */}
        <div id="ares-stage-col">
          <div className="ares-meta-title">STAGE PROGRESS</div>
          <div className="ares-stage-name" id="ares-stage-name">SEED</div>
          <div className="ares-prog-bar" id="ares-prog-bar">██░░░░░░░░ 0%</div>
          <div className="ares-prog-next" id="ares-prog-next">Next: 1,000</div>
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
            <button id="ares-wallet-add-btn" style={{
              background: 'rgba(0,255,136,0.1)', border: '1px solid rgba(0,255,136,0.35)',
              color: '#00ff88', fontFamily: 'monospace', fontSize: '11px', padding: '2px 8px',
              cursor: 'pointer', borderRadius: '2px', letterSpacing: '1px',
            }}>[+] ADD</button>
            <button id="ares-wallet-withdraw-btn" style={{
              background: 'rgba(255,80,80,0.08)', border: '1px solid rgba(255,80,80,0.3)',
              color: 'rgba(255,110,110,0.8)', fontFamily: 'monospace', fontSize: '11px', padding: '2px 8px',
              cursor: 'pointer', borderRadius: '2px', letterSpacing: '1px',
            }}>[-] WITHDRAW</button>
          </div>
          <div id="ares-wallet-withdraw-tip" style={{
            display: 'none', fontFamily: 'monospace', fontSize: '10px', color: '#ff555566', marginTop: '2px',
          }}>withdraw disabled while positions active</div>
          <span id="ares-wallet-fail" style={{
            display: 'none', background: 'rgba(255,40,40,0.18)', border: '1px solid rgba(255,50,50,0.45)',
            color: '#ff5555', fontFamily: 'monospace', fontSize: '11px', padding: '1px 5px',
            borderRadius: '2px', letterSpacing: '1px', marginTop: '3px',
          }}>NO FUNDS</span>
        </div>

        {/* Objectives */}
        <div id="ares-obj-col">
          <div className="ares-meta-title" id="ares-obj-title" style={{ textAlign: 'right' }}>OBJECTIVES</div>
          <div className="ares-obj-item" id="aobj-0">100 → 1,000</div>
          <div className="ares-obj-bar" id="aobj-0b" style={{ textAlign: 'right' }}></div>
          <div className="ares-obj-item" id="aobj-1">1,000 → 10,000</div>
          <div className="ares-obj-bar" id="aobj-1b" style={{ textAlign: 'right' }}></div>
          <div className="ares-obj-item" id="aobj-2">10,000 → 1M</div>
          <div className="ares-obj-bar" id="aobj-2b" style={{ textAlign: 'right' }}></div>
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
      <div id="ares-arc-wrap">
        <svg id="ares-arc-svg" viewBox="0 0 260 56" preserveAspectRatio="xMidYMid meet"></svg>
      </div>

      {/* ── CORE NEURAL BRAIN SVG ── */}
      <div id="ares-core-wrap">
        <svg id="ares-core-svg" viewBox="0 0 336 280" preserveAspectRatio="xMidYMid meet">
          <text x="160" y="155" textAnchor="middle" fontFamily="monospace" fontSize="8" fill="#0080ff44">INITIALIZING NEURAL BRAIN...</text>
        </svg>
      </div>

      {/* ── COGNITIVE CLARITY BAR ── */}
      <div id="ares-cog-bar">
        <span id="ares-cog-label">CLARITATE COGNITIVĂ</span>
        <div id="ares-cog-track"><div id="ares-cog-fill" style={{ width: '0%' }}></div></div>
        <span id="ares-cog-pct">—</span>
      </div>

      {/* ── STATS ROW ── */}
      <div id="ares-stats-row">
        <div className="ares-stat-cell">
          <div className="ares-stat-label">TRAJECTORY Δ</div>
          <div className="ares-stat-val" id="ares-stat-delta" style={{ color: '#00d9ff' }}>—</div>
          <div className="ares-stat-sub">vs curve</div>
        </div>
        <div className="ares-stat-cell">
          <div className="ares-stat-label">MISSION DAY</div>
          <div className="ares-stat-val" id="ares-stat-day" style={{ color: '#00d9ff' }}>— / 365</div>
          <div className="ares-stat-sub">elapsed</div>
        </div>
        <div className="ares-stat-cell">
          <div className="ares-stat-label">WIN RATE</div>
          <div className="ares-stat-val" id="ares-stat-wr" style={{ color: '#00d9ff' }}>—%</div>
          <div className="ares-stat-sub">last 10</div>
        </div>
        <div className="ares-stat-cell">
          <div className="ares-stat-label">PRED ACC</div>
          <div className="ares-stat-val" id="ares-stat-pred" style={{ color: '#0080ff' }}>—</div>
          <div className="ares-stat-sub">5min pred</div>
        </div>
      </div>

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
    </>
  )
}
