/** NOVA dock page view — 1:1 from index.html lines 869-919 + arianova.js
 *  Verdict Logic Strip v1.0
 *  Strip bar + expanded panel — forced open when in pageview. */
import { useState } from 'react'

export function NovaPanel() {
  const [isOpen, setIsOpen] = useState(true)

  function handleCopyLog() {
    const logEl = document.getElementById('nova-log')
    if (!logEl || !logEl.textContent?.trim()) return
    const rows = logEl.querySelectorAll('.nova-log-row')
    if (!rows.length) return
    const txt = Array.from(rows).map(r => {
      const ts = r.querySelector('.nova-log-ts')?.textContent || ''
      const msg = r.querySelector('.nova-log-msg')?.textContent || ''
      return `[${ts}] ${msg}`
    }).join('\n')
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).catch(() => {})
    }
  }

  return (
    <div id="nova-strip" data-panel="nova" className={isOpen ? 'nova-open' : ''}>
      {/* ── Bar (always visible) — 1:1 from index.html line 871 ── */}
      <div className="nova-bar" onClick={() => setIsOpen(o => !o)}>
        <div className="v6-accent">
          <div className="v6-ico">
            <svg viewBox="0 0 24 24">
              <circle cx="12" cy="6" r="2" />
              <circle cx="6" cy="18" r="2" />
              <circle cx="18" cy="18" r="2" />
              <circle cx="6" cy="12" r="1.5" />
              <circle cx="18" cy="12" r="1.5" />
              <line x1="12" y1="8" x2="6" y2="16" />
              <line x1="12" y1="8" x2="18" y2="16" />
              <line x1="6" y1="13.5" x2="6" y2="16" />
              <line x1="18" y1="13.5" x2="18" y2="16" />
              <line x1="7.5" y1="12" x2="16.5" y2="12" />
            </svg>
          </div>
          <span className="v6-lbl">NOVA</span>
        </div>
        <div className="v6-content">
          <span className="nova-title">NOVA</span>
          <span className="nova-sep">&mdash;</span>
          <span id="nova-bar-txt">idle</span>
          <span id="nova-bar-aria" style={{ marginLeft: 6, fontSize: 8, opacity: 0.6 }}></span>
          <span className="nova-chev">▼</span>
        </div>
      </div>

      {/* ── Expanded panel ── */}
      <div className="nova-panel" id="nova-panel">
        {/* ARIA Mini-Summary */}
        <div
          id="nova-aria-summary"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 8px 2px',
            fontSize: '9px',
            color: '#00ffcc66',
            borderBottom: '1px solid #00ffcc11',
            marginBottom: '2px',
          }}
        >
          <span style={{ opacity: 0.5 }}>ARIA:</span>
          <span id="nova-aria-name" style={{ color: '#00ffccaa' }}>—</span>
          <span id="nova-aria-dir" style={{ fontSize: '8px' }}></span>
          <span id="nova-aria-conf" style={{ fontSize: '8px', opacity: 0.7 }}></span>
          <span id="nova-aria-tf" style={{ fontSize: '7px', opacity: 0.4, marginLeft: 'auto' }}></span>
        </div>
        <div id="nova-log" className="nova-log">
          <div className="nova-empty">No verdicts yet — monitoring market…</div>
        </div>
        {/* ARIA History in NOVA */}
        <div style={{ borderTop: '1px solid #00ffcc11', padding: '3px 6px 2px', marginTop: '2px' }}>
          <div style={{ fontSize: '7px', opacity: 0.35, letterSpacing: '1px', marginBottom: '1px' }}>PATTERN HISTORY</div>
          <div id="nova-aria-hist" style={{ fontSize: '8px', maxHeight: '48px', overflow: 'hidden' }}></div>
        </div>
        <div style={{ textAlign: 'right', padding: '2px 6px 4px' }}>
          <button
            id="nova-copy-btn"
            onClick={(e) => { e.stopPropagation(); handleCopyLog() }}
            style={{
              background: 'none',
              border: '1px solid #00ffcc33',
              color: '#00ffcc88',
              fontSize: '9px',
              padding: '1px 6px',
              borderRadius: '3px',
              cursor: 'pointer',
            }}
            title="Copy NOVA log to clipboard"
          >
            Copy Log
          </button>
        </div>
      </div>
    </div>
  )
}
