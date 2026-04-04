/** Flow dock page view — 1:1 from index.html lines 949-970 + orderflow.js _buildDom()
 *  Strip header + of-hud body with compact row, mv-row, detail section, expand-hint.
 *  All chip text/classes match the initial _render() output exactly. */
import { useState } from 'react'

const TS_STYLE: React.CSSProperties = { marginLeft: 'auto', fontSize: '12px', color: '#334', flexShrink: 0 }

export function FlowPanel() {
  const [isOpen, setIsOpen] = useState(true)
  const [expanded, setExpanded] = useState(false)

  return (
    <div id="flow-panel" className={isOpen ? 'expanded' : 'collapsed'}>
      {/* ── Header (always visible) — 1:1 from index.html line 950 ── */}
      <div id="flow-panel-hdr" onClick={() => setIsOpen(o => !o)}>
        <div className="v6-accent">
          <div className="v6-ico">
            <svg viewBox="0 0 24 24">
              <polyline points="13 2 13 9 19 9" />
              <polyline points="11 15 11 22" />
              <line x1="8" y1="22" x2="14" y2="22" />
              <polyline points="7 9 13 2 19 9" />
              <line x1="11" y1="9" x2="11" y2="15" />
            </svg>
          </div>
          <span className="v6-lbl">FLOW</span>
        </div>
        <div className="v6-content">
          <span id="flow-panel-title">FLOW</span>
          <div id="flow-panel-badges">
            <span id="of-health-badge" className="of-badge ok" title="Orderflow feed status" style={{ display: 'none' }}>FLOW:OK</span>
          </div>
          <span id="flow-panel-chev">▼</span>
        </div>
      </div>

      {/* ── Body — of-hud 1:1 from orderflow.js _buildDom() ── */}
      <div id="flow-panel-body">
        <div id="of-hud" onClick={() => setExpanded(e => !e)}>

          {/* Grip header (display:none in CSS — kept for DOM parity) */}
          <div className="hdr" id="of-hud-grip">
            <span className="grip">⋮⋮</span>
            <span className="hdr-title">FLOW</span>
            <span className="hdr-close" onClick={(e) => { e.stopPropagation() }}>✕</span>
          </div>

          {/* Compact row (always visible) */}
          <div className="row">
            <span className="chip dead">DEAD</span>
            <span className="chip thin">0 t/s</span>
            <span className="chip thin">smp 300</span>
            <span className="chip dbg-on" style={{ display: 'none' }}></span>
            <span></span>
            <span className="chip mm-flow-chip mm-flow-neut">FLOW NEUT</span>
          </div>

          {/* MAGNET/VOID compact row */}
          <div className="mv-row">
            <span className="chip mv-slot mv-magnet">MAGNET —</span>
            <span className="chip mv-slot mv-void">VOID —</span>
          </div>

          {/* Detail section (toggled) */}
          <div className="detail" id="of-hud-detail" style={{ display: expanded ? '' : 'none' }}>

            {/* REG row (custom) */}
            <div className="row">
              <span className="lbl">REG</span>
              <span style={{ fontSize: '10px', fontWeight: 700 }}></span>
              <span className="chip muted"></span>
              <span style={{ marginLeft: 'auto' }}>
                <span className="chip muted" style={{ fontSize: '12px', color: '#334', cursor: 'pointer' }}></span>
              </span>
            </div>

            {/* TRAP — state | dir | CONF | PEND | FAIL | movePct */}
            <div className="row">
              <span className="lbl">TRAP</span>
              <span className="chip idle" style={{ display: 'none' }}></span>
              <span className="chip idle" style={{ display: 'none' }}></span>
              <span className="chip idle" style={{ display: 'none' }}></span>
              <span className="chip idle" style={{ display: 'none' }}></span>
              <span className="chip idle" style={{ display: 'none' }}></span>
              <span className="chip idle" style={{ display: 'none' }}></span>
              <span style={TS_STYLE}></span>
            </div>

            {/* VAC — state | dir | movePct | tps | vol */}
            <div className="row">
              <span className="lbl">VAC</span>
              <span className="chip idle" style={{ display: 'none' }}></span>
              <span className="chip idle" style={{ display: 'none' }}></span>
              <span className="chip idle" style={{ display: 'none' }}></span>
              <span className="chip idle" style={{ display: 'none' }}></span>
              <span className="chip idle" style={{ display: 'none' }}></span>
              <span style={TS_STYLE}></span>
            </div>

            {/* ICE — state | side | topShare | top2Share */}
            <div className="row">
              <span className="lbl">ICE</span>
              <span className="chip idle" style={{ display: 'none' }}></span>
              <span className="chip idle" style={{ display: 'none' }}></span>
              <span className="chip idle" style={{ display: 'none' }}></span>
              <span className="chip idle" style={{ display: 'none' }}></span>
              <span style={TS_STYLE}></span>
            </div>

            {/* FLIP — state | dir | prevDPct | curDPct | z */}
            <div className="row">
              <span className="lbl">FLIP</span>
              <span className="chip idle" style={{ display: 'none' }}></span>
              <span className="chip idle" style={{ display: 'none' }}></span>
              <span className="chip idle" style={{ display: 'none' }}></span>
              <span className="chip idle" style={{ display: 'none' }}></span>
              <span className="chip idle" style={{ display: 'none' }}></span>
              <span style={TS_STYLE}></span>
            </div>

            {/* ABS/EXH row (custom — two modules in one row) */}
            <div className="row">
              <span className="lbl">ABS</span>
              <span className="chip idle"></span>
              <span className="chip active" style={{ display: 'none' }}></span>
              <span className="lbl">EXH</span>
              <span className="chip idle"></span>
              <span className="chip muted" style={{ display: 'none' }}></span>
              <span style={TS_STYLE}></span>
            </div>

            {/* P10: MMTRAP — state | level | bias | ts */}
            <div className="row mm-trap-row">
              <span className="lbl">MMTRAP</span>
              <span className="chip idle"></span>
              <span className="chip muted" style={{ display: 'none' }}></span>
              <span className="chip muted"></span>
              <span style={TS_STYLE}></span>
            </div>

            {/* P11: ABSORB — state | vol | δ% | mv% | ts */}
            <div className="row p11-abs-row">
              <span className="lbl">ABSORB</span>
              <span className="chip idle"></span>
              <span className="chip idle" style={{ display: 'none' }}></span>
              <span className="chip idle" style={{ display: 'none' }}></span>
              <span className="chip idle" style={{ display: 'none' }}></span>
              <span style={TS_STYLE}></span>
            </div>

            {/* P11: EXHAUST — state | mv% | peak→now | ts */}
            <div className="row p11-exh-row">
              <span className="lbl">EXHAUST</span>
              <span className="chip idle"></span>
              <span className="chip muted" style={{ display: 'none' }}></span>
              <span className="chip muted" style={{ display: 'none' }}></span>
              <span style={TS_STYLE}></span>
            </div>

            {/* P12: SWEEP — state | move% | vol | tps | ts */}
            <div className="row p12-swp-row">
              <span className="lbl">SWEEP</span>
              <span className="chip idle"></span>
              <span className="chip idle" style={{ display: 'none' }}></span>
              <span className="chip idle" style={{ display: 'none' }}></span>
              <span className="chip idle" style={{ display: 'none' }}></span>
              <span style={TS_STYLE}></span>
            </div>

            {/* P12: CASCADE — state | tps | vol | move | ts */}
            <div className="row p12-cas-row">
              <span className="lbl">CASCADE</span>
              <span className="chip idle"></span>
              <span className="chip idle" style={{ display: 'none' }}></span>
              <span className="chip idle" style={{ display: 'none' }}></span>
              <span className="chip idle" style={{ display: 'none' }}></span>
              <span style={TS_STYLE}></span>
            </div>

            {/* P13: MAGNET — state | target | dist% | str× | conf% | ts */}
            <div className="row p13-mag-row">
              <span className="lbl">MAGNET</span>
              <span className="chip idle"></span>
              <span className="chip muted" style={{ display: 'none' }}></span>
              <span className="chip muted" style={{ display: 'none' }}></span>
              <span className="chip muted" style={{ display: 'none' }}></span>
              <span className="chip p13-conf" style={{ display: 'none' }}></span>
              <span style={TS_STYLE}></span>
            </div>

            {/* P14: VOID — state | score | trades | vol | move | ts */}
            <div className="row p14-voi-row">
              <span className="lbl">VOID</span>
              <span className="chip idle"></span>
              <span className="chip idle" style={{ display: 'none' }}></span>
              <span className="chip idle" style={{ display: 'none' }}></span>
              <span className="chip idle" style={{ display: 'none' }}></span>
              <span className="chip idle" style={{ display: 'none' }}></span>
              <span style={TS_STYLE}></span>
            </div>

            {/* P15 QUANT: WALL — side | str | dist% */}
            <div className="row p15-wall-row">
              <span className="lbl">WALL</span>
              <span className="chip idle"></span>
              <span className="chip idle" style={{ display: 'none' }}></span>
              <span className="chip idle" style={{ display: 'none' }}></span>
              <span style={TS_STYLE}></span>
            </div>

            {/* P15 QUANT: STOP — dir | lvl | cls */}
            <div className="row p15-stop-row">
              <span className="lbl">STOP</span>
              <span className="chip idle"></span>
              <span className="chip idle" style={{ display: 'none' }}></span>
              <span className="chip idle" style={{ display: 'none' }}></span>
              <span style={TS_STYLE}></span>
            </div>

            {/* P15 QUANT: SMF — bias | acc | ltr | DIV */}
            <div className="row p15-smf-row">
              <span className="lbl">SMF</span>
              <span className="chip idle"></span>
              <span className="chip idle" style={{ display: 'none' }}></span>
              <span className="chip idle" style={{ display: 'none' }}></span>
              <span className="chip idle" style={{ display: 'none' }}></span>
              <span style={TS_STYLE}></span>
            </div>
          </div>

          {/* Expand hint */}
          <div className="expand-hint">{expanded ? '▲ tap to collapse' : '▼ tap to expand'}</div>
        </div>
      </div>
    </div>
  )
}
