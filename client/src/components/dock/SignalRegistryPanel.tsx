/** Signal Registry dock page view — 1:1 from index.html lines 2540-2573 + config.js
 *  Strip bar + expanded panel — forced open when in pageview. */
import { useState } from 'react'

export function SignalRegistryPanel() {
  const [isOpen, setIsOpen] = useState(true)

  return (
    <div id="sr-strip" className={isOpen ? 'sr-strip-open' : ''}>
      {/* ── Bar (always visible) — 1:1 from index.html line 2541 ── */}
      <div id="sr-strip-bar" onClick={() => setIsOpen(o => !o)}>
        <div className="v6-accent">
          <div className="v6-ico">
            <svg viewBox="0 0 24 24">
              <rect x="4" y="3" width="16" height="18" rx="2" />
              <line x1="8" y1="8" x2="16" y2="8" />
              <line x1="8" y1="12" x2="16" y2="12" />
              <line x1="8" y1="16" x2="13" y2="16" />
            </svg>
          </div>
          <span className="v6-lbl">SR</span>
        </div>
        <div className="v6-content">
          <div id="sr-strip-title"><span>SIGNAL REGISTRY</span></div>
          <div id="sr-strip-info">
            <span className="sr-strip-stat" id="sr-strip-total">&mdash; semnale</span>
            <span className="sr-strip-stat" id="sr-strip-wr"></span>
            <span className="sr-strip-stat" id="sr-strip-last"></span>
            <span className="sr-strip-chev">▲</span>
          </div>
        </div>
      </div>

      {/* ── Expanded panel ── */}
      <div id="sr-strip-panel">
        <div id="sr-sec">
          <div id="sr-stats"></div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '3px 8px 0' }}>
            <button
              style={{
                background: 'none',
                border: '1px solid #0a1a2a',
                color: 'var(--dim)',
                fontSize: '7px',
                padding: '1px 6px',
                borderRadius: '2px',
                cursor: 'pointer',
                fontFamily: 'var(--ff)',
              }}
            >
              ↺ refresh
            </button>
          </div>
          <div id="sr-list">
            <div className="sr-empty">Niciun semnal înregistrat încă</div>
          </div>
        </div>
      </div>
    </div>
  )
}
