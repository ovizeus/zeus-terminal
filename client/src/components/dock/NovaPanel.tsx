/** NOVA dock page view — 1:1 from index.html lines 869-919 + arianova.js
 *  Verdict Logic Strip v1.0
 *  Strip bar + expanded panel — forced open when in pageview. */
import { useState } from 'react'
import { useQexitRiskStore } from '../../stores/qexitRiskStore'

// [UI-COMPACT 2026-06-06] Moved 1:1 together with #scenario-sec from
// AnalysisSections.tsx (it lived inside the SCENARIO ENGINE section) —
// pure store-driven strip, position-agnostic.
function QexitRiskStrip() {
  const snap = useQexitRiskStore((s) => s.snapshot)
  return (
    <div className="qexit-bar-wrap" id="qexit-risk-strip" style={{ display: snap.visible ? 'block' : 'none' }}>
      <div className="qexit-bar-row">
        <span className="qexit-bar-label">EXIT RISK</span>
        <div className="qexit-bar-track">
          <div className="qexit-bar-fill" id="qexit-bar-fill" style={{ width: snap.risk + '%', background: snap.fillColor }}></div>
        </div>
        <span className="qexit-risk-val" id="qexit-risk-val" style={{ color: snap.valueColor }}>{snap.risk}</span>
        <span className={'qexit-action ' + snap.action} id="qexit-action-badge">{snap.action}</span>
      </div>
      <div className="qexit-sigs" id="qexit-sigs-detail">
        {snap.signals.map((sig, i) => (
          <div key={i} className="qexit-sig-row">
            <span className="qexit-sig-name">{sig.name}</span>{' '}
            <span dangerouslySetInnerHTML={{ __html: sig.valueHtml }} />
          </div>
        ))}
      </div>
      <div className="qexit-advisory" id="qexit-advisory" style={{ color: snap.advisoryColor }} dangerouslySetInnerHTML={{ __html: snap.advisoryHtml }} />
    </div>
  )
}

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
    <>
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

    {/* ===== SCENARIO ENGINE =====
        [UI-COMPACT 2026-06-06] Moved 1:1 from AnalysisSections.tsx (home
        scroll zone) — operator wants the home shorter; filled by forecast.ts
        via getElementById (#scenario-content/#scenario-upd), position-agnostic.
        Paired change: bootstrapInit.ts no longer mv()'s #scenario-sec. */}
    <div className="sec" id="scenario-sec">
      <div className="slbl" style={{ justifyContent: 'space-between' }}>
        <span>SCENARIO ENGINE</span>
        <span id="scenario-upd" style={{ fontSize: '9px', color: 'var(--dim)' }}></span>
      </div>
      <QexitRiskStrip />
      <div className="scenario-content" id="scenario-content">
        <div style={{ textAlign: 'center', padding: '14px', color: 'var(--dim)', fontSize: '10px', letterSpacing: '1px' }}>
          Waiting for market data...
        </div>
      </div>
    </div>

    {/* ===== CYCLE INTELLIGENCE =====
        [UI-COMPACT 2026-06-06] Moved 1:1 from AnalysisSections.tsx — filled by
        legacy JS via getElementById (#macro-*), position-agnostic.
        Paired change: bootstrapInit.ts no longer mv()'s #macro-sec. */}
    <div className="sec" id="macro-sec">
      <div className="slbl" style={{ justifyContent: 'space-between' }}>
        <span>CYCLE INTELLIGENCE</span>
        <span id="macro-upd" style={{ fontSize: '9px', color: 'var(--dim)' }}></span>
      </div>
      <div style={{ padding: '8px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
          <span id="macro-phase-badge" style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '2px', background: '#0a1a2a', border: '1px solid #2a3a4a', color: '#f0c040', letterSpacing: '1px' }}>NEUTRAL</span>
          <span id="macro-conf" style={{ fontSize: '9px', color: 'var(--dim)' }}>conf &mdash;</span>
          <span id="macro-adapt-status" style={{ fontSize: '8px', color: '#3a4a5a', letterSpacing: '1px' }}>ADAPT OFF</span>
        </div>
        <div style={{ marginBottom: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '8px', color: 'var(--dim)', marginBottom: '2px' }}>
            <span>COMPOSITE SCORE</span><span id="macro-composite-val">0</span>
          </div>
          <div style={{ height: '5px', background: '#0d1520', borderRadius: '3px', overflow: 'hidden' }}>
            <div id="macro-composite-bar" style={{ height: '100%', borderRadius: '3px', background: '#f0c040', width: '0%', transition: 'width .6s ease' }}></div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px', fontSize: '9px', color: '#6a8090', marginBottom: '6px' }}>
          <span>Regime: <b id="macro-cycle-val" style={{ color: '#9ab' }}>&mdash;</b></span>
          <span>Flow: <b id="macro-flow-val" style={{ color: '#9ab' }}>&mdash;</b></span>
          <span>Sentiment: <b id="macro-sent-val" style={{ color: '#9ab' }}>&mdash;</b></span>
          <span>Slope: <b id="macro-slope-val" style={{ color: '#9ab' }}>&mdash;</b></span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', borderTop: '1px solid #0a1a2a', paddingTop: '5px' }}>
          <span style={{ color: 'var(--dim)' }}>SIZE MULT</span>
          <span id="macro-size-mult" style={{ color: '#f0c040', fontWeight: 700 }}>&times;1.00</span>
          <span style={{ color: 'var(--dim)' }}>PERF MULT</span>
          <span id="macro-perf-mult" style={{ color: '#9ab' }}>&times;1.00</span>
        </div>
        <div style={{ marginTop: '6px', borderTop: '1px solid #0a1a2a', paddingTop: '5px' }}>
          <div style={{ fontSize: '8px', letterSpacing: '1.5px', color: 'var(--dim)', marginBottom: '4px' }}>PERFORMANCE BY REGIME</div>
          <div id="macro-perf-table" style={{ fontSize: '10px', color: '#6a8090', lineHeight: 1.8 }}></div>
        </div>
      </div>
    </div>
    </>
  )
}
