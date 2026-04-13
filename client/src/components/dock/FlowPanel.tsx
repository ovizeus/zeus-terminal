/** Flow dock panel — 1:1 from index.html lines 949-970
 *  Strip header + empty body (orderflow.ts _create() populates it dynamically) */
import { memo } from 'react'

export const FlowPanel = memo(function FlowPanel() {
  return (
    <div id="flow-panel" className="collapsed">
      {/* ── Header (always visible) — 1:1 from index.html line 950 ── */}
      <div id="flow-panel-hdr" onClick={() => (window as any).flowPanelToggle?.()}>
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

      {/* ── Body — empty, orderflow.ts _create() populates dynamically ── */}
      <div id="flow-panel-body"></div>
    </div>
  )
})
