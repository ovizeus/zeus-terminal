/** Post-Mortem dock page view — 1:1 from initPMPanel() in deepdive.js
 *  Strip bar + expanded panel — forced open when in pageview. */
import { useState } from 'react'

export function PostMortemPanel() {
  const [isOpen, setIsOpen] = useState(true)

  return (
    <div id="pm-strip" data-panel="pm" className={isOpen ? 'pm-open' : ''}>
      {/* ── Bar (always visible) — 1:1 from deepdive.js initPMPanel() line 310 ── */}
      <div id="pm-strip-bar" className="pm-bar" onClick={() => setIsOpen(o => !o)}>
        <div className="v6-accent">
          <div className="v6-ico">
            <svg viewBox="0 0 24 24">
              <circle cx="12" cy="10" r="6" />
              <line x1="12" y1="16" x2="12" y2="22" />
              <line x1="8" y1="20" x2="16" y2="20" />
              <line x1="10" y1="8" x2="10" y2="12" />
              <line x1="14" y1="8" x2="14" y2="12" />
            </svg>
          </div>
          <span className="v6-lbl">POST<br />MORT</span>
        </div>
        <div className="v6-content">
          <div id="pm-strip-title"><span>POST-MORTEM</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span id="pm-strip-stat" style={{ fontSize: '11px', color: '#f0c04066', letterSpacing: '.5px' }}></span>
            <span id="pm-strip-chev" className="pm-chev">▼</span>
          </div>
        </div>
      </div>

      {/* ── Expanded panel ── */}
      <div id="pm-strip-panel">
        <div id="pm-panel-body">
          <div style={{
            padding: '12px',
            textAlign: 'center',
            fontSize: '12px',
            color: '#445566',
            letterSpacing: '1px',
          }}>
            No trade analyzed yet.
          </div>
        </div>
      </div>
    </div>
  )
}
