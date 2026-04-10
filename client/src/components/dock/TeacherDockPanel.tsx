/** Teacher dock page view — 1:1 from index.html lines 647-664 + teacherPanel.js
 *  Strip bar + full panel body with hero, status, stats, controls, 5 tabs. */
import { useState } from 'react'

export function TeacherDockPanel() {
  const [isOpen, setIsOpen] = useState(true)

  return (
    <div id="teacher-strip" data-panel="teacher" className={isOpen ? 'teacher-open' : ''}>
      {/* ── Strip bar (always visible) — 1:1 from index.html line 648 ── */}
      <div className="teacher-strip-bar" onClick={() => setIsOpen(o => !o)}>
        <div className="v6-accent">
          <div className="v6-ico">
            <svg viewBox="0 0 24 24">
              <polyline points="22,9 12,4 2,9 12,14 22,9" />
              <line x1="6" y1="11.5" x2="6" y2="18" />
              <line x1="18" y1="11.5" x2="18" y2="18" />
              <path d="M6 18 Q12 21 18 18" />
            </svg>
          </div>
          <span className="v6-lbl">TEACH</span>
        </div>
        <div className="v6-content">
          <span className="teacher-strip-title">THE TEACHER</span>
          <span className="teacher-strip-sep">&mdash;</span>
          <span id="teacher-bar-info">IDLE · sandbox</span>
          <span id="teacher-bar-summary" style={{ display: 'none' }}></span>
          <span className="teacher-strip-chev">▼</span>
        </div>
      </div>

      {/* ── Expanded panel ── */}
      <div id="teacher-strip-panel">
        <div id="teacher-panel-content">
          <div id="teacher-panel-body">

            {/* ── CAPABILITY HERO ── */}
            <div id="teacher-cap-hero" className="teacher-cap-hero">
              <div id="teacher-cap-score" className="teacher-cap-score">0</div>
              <div id="teacher-cap-label" className="teacher-cap-label">WEAK</div>
              <div id="teacher-cap-subtitle" className="teacher-cap-sub">TEACHER CAPABILITY</div>
            </div>

            {/* ── STATUS BAR ── */}
            <div id="teacher-status-bar" className="teacher-bar">
              <span id="teacher-v2-status-icon" className="teacher-status-dot">●</span>
              <span id="teacher-v2-status-text" style={{ fontSize: '10px', color: '#88aacc' }}>IDLE</span>
              <span id="teacher-v2-status-detail" style={{ fontSize: '13px', color: '#556677', marginLeft: 'auto' }}></span>
            </div>

            {/* ── QUICK STATS ROW ── */}
            <div className="teacher-quick-stats">
              <div className="teacher-qs"><span className="teacher-qs-lbl">CAPITAL</span><span id="teacher-v2-capital" className="teacher-qs-val">$10,000</span></div>
              <div className="teacher-qs"><span className="teacher-qs-lbl">SESSIONS</span><span id="teacher-v2-sessions" className="teacher-qs-val">0</span></div>
              <div className="teacher-qs"><span className="teacher-qs-lbl">TRADES</span><span id="teacher-v2-trades" className="teacher-qs-val">0</span></div>
              <div className="teacher-qs"><span className="teacher-qs-lbl">FAILS</span><span id="teacher-v2-fails" className="teacher-qs-val">0</span></div>
            </div>

            {/* ── CONTROL BUTTONS ── */}
            <div className="teacher-controls">
              <button id="teacher-v2-teach-btn" className="teacher-btn teacher-btn-teach" onClick={() => (window as any).teacherUITeach?.()}>▶ TEACH</button>
              <button id="teacher-v2-stop-btn" className="teacher-btn teacher-btn-stop" onClick={() => (window as any).teacherUIStopV2?.()} style={{ display: 'none' }}>■ STOP</button>
              <button className="teacher-btn teacher-btn-sm" onClick={() => (window as any).teacherExport?.()}>EXPORT</button>
              <button className="teacher-btn teacher-btn-sm teacher-btn-danger" onClick={() => (window as any).teacherReset?.()}>RESET</button>
            </div>

            {/* ── TABS ── */}
            <div id="teacher-tabs" className="teacher-tabs">
              <button className="teacher-tab active" data-tab="replay" onClick={(e) => { const tabs = e.currentTarget.parentElement; if (tabs) { tabs.querySelectorAll('.teacher-tab').forEach(t => t.classList.remove('active')); e.currentTarget.classList.add('active') }; const p = document.getElementById('teacher-tab-replay'); if (p) { (p.parentElement as HTMLElement)?.querySelectorAll('.teacher-tab-content').forEach((c: any) => c.style.display = 'none'); p.style.display = '' } }}>REPLAY</button>
              <button className="teacher-tab" data-tab="trades" onClick={(e) => { const tabs = e.currentTarget.parentElement; if (tabs) { tabs.querySelectorAll('.teacher-tab').forEach(t => t.classList.remove('active')); e.currentTarget.classList.add('active') }; const p = document.getElementById('teacher-tab-trades'); if (p) { (p.parentElement as HTMLElement)?.querySelectorAll('.teacher-tab-content').forEach((c: any) => c.style.display = 'none'); p.style.display = '' } }}>TRADES</button>
              <button className="teacher-tab" data-tab="stats" onClick={(e) => { const tabs = e.currentTarget.parentElement; if (tabs) { tabs.querySelectorAll('.teacher-tab').forEach(t => t.classList.remove('active')); e.currentTarget.classList.add('active') }; const p = document.getElementById('teacher-tab-stats'); if (p) { (p.parentElement as HTMLElement)?.querySelectorAll('.teacher-tab-content').forEach((c: any) => c.style.display = 'none'); p.style.display = '' } }}>STATS</button>
              <button className="teacher-tab" data-tab="memory" onClick={(e) => { const tabs = e.currentTarget.parentElement; if (tabs) { tabs.querySelectorAll('.teacher-tab').forEach(t => t.classList.remove('active')); e.currentTarget.classList.add('active') }; const p = document.getElementById('teacher-tab-memory'); if (p) { (p.parentElement as HTMLElement)?.querySelectorAll('.teacher-tab-content').forEach((c: any) => c.style.display = 'none'); p.style.display = '' } }}>MEMORY</button>
              <button className="teacher-tab" data-tab="review" onClick={(e) => { const tabs = e.currentTarget.parentElement; if (tabs) { tabs.querySelectorAll('.teacher-tab').forEach(t => t.classList.remove('active')); e.currentTarget.classList.add('active') }; const p = document.getElementById('teacher-tab-review'); if (p) { (p.parentElement as HTMLElement)?.querySelectorAll('.teacher-tab-content').forEach((c: any) => c.style.display = 'none'); p.style.display = '' } }}>REVIEW</button>
            </div>

            {/* ══ TAB: REPLAY — Live autonomous session view ══ */}
            <div id="teacher-tab-replay" className="teacher-tab-content">
              <div className="teacher-section">
                <div className="teacher-section-title">CURRENT SESSION</div>
                <div className="teacher-grid-4">
                  <div className="teacher-cell"><span className="teacher-cell-lbl">TF</span><span id="teacher-v2-tf">—</span></div>
                  <div className="teacher-cell"><span className="teacher-cell-lbl">PROFILE</span><span id="teacher-v2-profile">—</span></div>
                  <div className="teacher-cell"><span className="teacher-cell-lbl">REGIME</span><span id="teacher-v2-regime">—</span></div>
                  <div className="teacher-cell"><span className="teacher-cell-lbl">BARS</span><span id="teacher-v2-bars">0</span></div>
                </div>
              </div>

              <div className="teacher-section">
                <div className="teacher-section-title">LAST DECISION</div>
                <div id="teacher-v2-decision" className="teacher-decision-box">Waiting for session...</div>
              </div>

              <div className="teacher-section">
                <div className="teacher-section-title">ACTIVITY</div>
                <div id="teacher-v2-activity" className="teacher-activity-feed" style={{ maxHeight: '150px', overflowY: 'auto' }}></div>
              </div>
            </div>

            {/* ══ TAB: TRADES — Trade history ══ */}
            <div id="teacher-tab-trades" className="teacher-tab-content" style={{ display: 'none' }}>
              <div id="teacher-v2-trades-empty" className="teacher-empty">No trades yet.</div>
              <div id="teacher-v2-trades-list" style={{ display: 'none', maxHeight: '350px', overflowY: 'auto' }}></div>
            </div>

            {/* ══ TAB: STATS — Lifetime statistics ══ */}
            <div id="teacher-tab-stats" className="teacher-tab-content" style={{ display: 'none' }}>
              <div id="teacher-v2-stats-empty" className="teacher-empty">No statistics available.</div>
              <div id="teacher-v2-stats-body" style={{ display: 'none' }}></div>
            </div>

            {/* ══ TAB: MEMORY — Lessons + patterns ══ */}
            <div id="teacher-tab-memory" className="teacher-tab-content" style={{ display: 'none' }}>
              <div id="teacher-v2-memory-empty" className="teacher-empty">Memory is empty.</div>
              <div id="teacher-v2-memory-body" style={{ display: 'none' }}></div>
            </div>

            {/* ══ TAB: REVIEW — Capability breakdown + cross-validation ══ */}
            <div id="teacher-tab-review" className="teacher-tab-content" style={{ display: 'none' }}>
              <div id="teacher-v2-review-body"></div>
            </div>

          </div>
        </div>
      </div>
    </div>
  )
}
