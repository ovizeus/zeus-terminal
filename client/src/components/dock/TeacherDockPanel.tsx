/** Teacher dock page view — 1:1 from #teacher-strip-panel + _teacherBuildHTML() in teacherPanel.js */
export function TeacherDockPanel() {
  return (
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

          {/* ─��� QUICK STATS ROW ── */}
          <div className="teacher-quick-stats">
            <div className="teacher-qs"><span className="teacher-qs-lbl">CAPITAL</span><span id="teacher-v2-capital" className="teacher-qs-val">$10,000</span></div>
            <div className="teacher-qs"><span className="teacher-qs-lbl">SESSIONS</span><span id="teacher-v2-sessions" className="teacher-qs-val">0</span></div>
            <div className="teacher-qs"><span className="teacher-qs-lbl">TRADES</span><span id="teacher-v2-trades" className="teacher-qs-val">0</span></div>
            <div className="teacher-qs"><span className="teacher-qs-lbl">FAILS</span><span id="teacher-v2-fails" className="teacher-qs-val">0</span></div>
          </div>

          {/* ── CONTROL BUTTONS ── */}
          <div className="teacher-controls">
            <button id="teacher-v2-teach-btn" className="teacher-btn teacher-btn-teach">▶ TEACH</button>
            <button id="teacher-v2-stop-btn" className="teacher-btn teacher-btn-stop" style={{ display: 'none' }}>■ STOP</button>
            <button className="teacher-btn teacher-btn-sm">EXPORT</button>
            <button className="teacher-btn teacher-btn-sm teacher-btn-danger">RESET</button>
          </div>

          {/* ── TABS ── */}
          <div id="teacher-tabs" className="teacher-tabs">
            <button className="teacher-tab active" data-tab="replay">REPLAY</button>
            <button className="teacher-tab" data-tab="trades">TRADES</button>
            <button className="teacher-tab" data-tab="stats">STATS</button>
            <button className="teacher-tab" data-tab="memory">MEMORY</button>
            <button className="teacher-tab" data-tab="review">REVIEW</button>
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
  )
}
