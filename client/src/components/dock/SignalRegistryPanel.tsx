/** Signal Registry dock page view — 1:1 from index.html lines 2540-2573 + config.js
 *  Strip bar + expanded panel — forced open when in pageview. */
import { useState } from 'react'

export function SignalRegistryPanel() {
  const [isOpen, setIsOpen] = useState(true)

  return (
    <>
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
            <div className="sr-empty">No signal registered yet</div>
          </div>
        </div>
      </div>
    </div>

    {/* ===== DAY / HOUR WIN RATE FILTER =====
        [UI-COMPACT 2026-06-06] Moved here 1:1 from AnalysisSections.tsx (home
        scroll zone) — operator wants the home page shorter; this widget now
        lives under Signals. IDs, checkbox handler and structure unchanged:
        isCurrentTimeOK() (the client-AT time gate) and renderDHF() find these
        by getElementById, and dock panel wrappers stay in the DOM at all
        times (only CSS-hidden), so the AT gate behaves identically.
        Paired change: bootstrapInit.ts no longer mv()'s #dhfSec. */}
    <div className="sec" id="dhfSec">
      <div className="slbl" style={{ justifyContent: 'space-between' }}>
        <span>DAY / HOUR WIN RATE FILTER</span>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <span id="dhfCurrentSlot" style={{ fontSize: '8px', color: '#00ff88' }}>&mdash;</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '7px', cursor: 'pointer' }}>
            <input type="checkbox" id="dhfEnabled" defaultChecked onChange={() => (window as any).renderDHF?.()} />
            <span style={{ color: '#aa44ff' }}>Filter active</span>
          </label>
        </div>
      </div>
      <div style={{ fontSize: '7px', letterSpacing: '1px', color: 'var(--dim)', padding: '4px 10px' }}>
        WEEKDAYS &mdash; avg WR across symbols
      </div>
      <div className="dhf-grid" id="dhfDayGrid">
        {/* filled by JS */}
      </div>
      <div style={{ fontSize: '7px', letterSpacing: '1px', color: 'var(--dim)', padding: '4px 10px' }}>
        HOURS ROMANIA (UTC+2/+3) &mdash; Avoid red hours
      </div>
      <div className="dhf-hours" id="dhfHourGrid">
        {/* filled by JS */}
      </div>
      <div style={{ padding: '4px 10px 8px', fontSize: '7px', color: 'var(--dim)' }}>
        <span style={{ color: '#00d97a' }}>&#9632;</span> WR&ge;60% &mdash; Trade &nbsp;
        <span style={{ color: '#f0c040' }}>&#9632;</span> WR 45-60% &mdash; Caution &nbsp;
        <span style={{ color: '#ff4466' }}>&#9632;</span> WR&lt;45% &mdash; Avoid
      </div>
    </div>
    </>
  )
}
