/** Activity Feed dock page view — 1:1 from index.html lines 801-816 + bootstrap.js
 *  Strip bar + expanded panel — forced open when in pageview. */
import { useState } from 'react'

export function ActivityFeedPanel() {
  const [isOpen, setIsOpen] = useState(true)

  return (
    <div id="actfeed-strip" data-panel="actfeed" className={isOpen ? 'actfeed-open' : ''}>
      {/* ── Bar (always visible) — 1:1 from index.html line 803 ── */}
      <div className="actfeed-bar" onClick={() => setIsOpen(o => !o)}>
        <div className="v6-accent">
          <div className="v6-ico">
            <svg viewBox="0 0 24 24">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </div>
          <span className="v6-lbl">FEED</span>
        </div>
        <div className="v6-content">
          <span style={{ fontWeight: 700, letterSpacing: '1.5px', color: '#aa44ff', marginRight: '4px' }}>ACTIVITY</span>
          <span id="actfeedBadge" style={{ color: '#555', fontSize: '9px' }}>0 events</span>
          <span className="actfeed-chev" style={{ marginLeft: 'auto', color: '#333', fontSize: '10px' }}>&#9660;</span>
        </div>
      </div>

      {/* ── Expanded panel ── */}
      <div id="actfeed-panel">
        <div id="actfeedList" className="actfeed-list">
          <div className="actfeed-empty">No activity yet — events will appear here as the system operates.</div>
        </div>
      </div>
    </div>
  )
}
