/** PnL Lab dock page view — 1:1 from index.html lines 673-696 + panels.js renderPnlLab()
 *  Strip bar + expanded panel — forced open when in pageview. */
import { useState } from 'react'

export function PnlLabPanel() {
  const [isOpen, setIsOpen] = useState(true)

  return (
    <div id="pnl-lab-strip" data-panel="pnllab" className={isOpen ? 'pnllab-open' : ''}>
      {/* ── Bar (always visible) — 1:1 from index.html line 674 ── */}
      <div id="pnl-lab-bar" className="pnllab-bar" onClick={() => setIsOpen(o => !o)}>
        <div className="v6-accent">
          <div className="v6-ico">
            <svg viewBox="0 0 24 24">
              <line x1="3" y1="20" x2="21" y2="20" />
              <rect x="4" y="14" width="4" height="6" rx="1" />
              <rect x="10" y="8" width="4" height="12" rx="1" />
              <rect x="16" y="4" width="4" height="16" rx="1" />
            </svg>
          </div>
          <span className="v6-lbl">PNL<br />LAB</span>
        </div>
        <div className="v6-content">
          <span>PNL LAB</span>
          <div id="pnl-lab-condensed">
            <span className="pnl-lab-pill" id="pnl-lab-cum">PnL: &mdash;</span>
            <span className="pnl-lab-pill" id="pnl-lab-dd">DD: &mdash;</span>
            <span className="pnl-lab-pill" id="pnl-lab-exp">E: &mdash;</span>
          </div>
          <span className="pnl-lab-chev" id="pnl-lab-chev">▼</span>
        </div>
      </div>

      {/* ── Expanded panel ── */}
      <div id="pnlLabWrap">
        <div id="pnlLabBody">
          {/* Empty-state banner — 1:1 from renderPnlLab() in panels.js */}
          <div className="pnl-lab-section" style={{ textAlign: 'center', padding: '16px 10px' }}>
            <div style={{ fontSize: '28px', marginBottom: '6px' }}>📊</div>
            <div style={{ color: '#00d9ff', fontSize: '13px', fontWeight: 700, marginBottom: '4px' }}>PnL Lab — No Data Yet</div>
            <div style={{ color: '#3a5068', fontSize: '11px', lineHeight: 1.5 }}>
              PnL Lab will populate automatically after your first closed trade.<br />
              Drawdown, Expectancy, Daily stats — everything appears here.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
