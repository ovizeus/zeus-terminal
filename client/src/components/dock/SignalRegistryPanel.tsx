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
            <span className="sr-strip-stat" id="sr-strip-total">&mdash; signals</span>
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

    {/* ===== PERFORMANCE TRACKER — PER INDICATOR =====
        [UI-COMPACT 2026-06-06] Moved 1:1 from AnalysisSections.tsx, same
        operation as dhfSec above — filled by legacy JS via getElementById
        (#perfTrackerBody/#perfUpdTime), position-agnostic. */}
    <div className="sec" id="perfSec">
      <div className="slbl" style={{ justifyContent: 'space-between' }}>
        <span>PERFORMANCE TRACKER &mdash; PER INDICATOR</span>
        <span id="perfUpdTime" style={{ fontSize: '9px', color: 'var(--dim)' }}>Live from trades</span>
      </div>
      <div style={{ padding: '4px 10px 4px', fontSize: '9px', color: 'var(--dim)', display: 'flex', justifyContent: 'space-between' }}>
        <span>INDICATOR</span><span>WIN RATE | TRADES | WEIGHT AI</span>
      </div>
      <div id="perfTrackerBody">
        <div style={{ padding: '16px', textAlign: 'center', fontSize: '10px', color: 'var(--dim)' }}>
          Collecting data from Auto Trade...
        </div>
      </div>
      <div style={{ padding: '6px 10px', fontSize: '9px', color: 'var(--dim)', borderTop: '1px solid #0d1520', lineHeight: 1.8 }}>
        Zeus Brain auto-weights the Confluence Score based on each indicator's real performance.<br />
        Indicators with higher WR get more weight in entry decisions.
      </div>
    </div>

    {/* ===== BACKTEST ENGINE =====
        [UI-COMPACT 2026-06-06] Moved 1:1 from AnalysisSections.tsx — button
        calls window.runBacktest, all elements found by id, position-agnostic. */}
    <div className="sec" id="btSec">
      <div className="slbl" style={{ justifyContent: 'space-between' }}>
        <span>BACKTEST ENGINE &mdash; INDICATOR PRECISION</span>
        <span id="btLastRun" style={{ fontSize: '9px', color: 'var(--dim)' }}>Not run yet</span>
      </div>
      <div className="bt-wrap">
        {/* Controls */}
        <div className="bt-controls">
          <button className="bt-btn bt-btn-run" id="btRunBtn" onClick={() => (window as any).runBacktest?.()}>&#9654; RUN BACKTEST</button>
          <select className="bt-sel" id="btLookback" defaultValue="500" onChange={() => {}}>
            <option value="100">100 bars</option>
            <option value="200">200 bars</option>
            <option value="500">500 bars</option>
            <option value="1000">1000 bars (max)</option>
          </select>
          <select className="bt-sel" id="btFwdBars" defaultValue="5" onChange={() => {}}>
            <option value="3">+3 bars</option>
            <option value="5">+5 bars</option>
            <option value="10">+10 bars</option>
            <option value="20">+20 bars</option>
          </select>
          <select className="bt-sel" id="btMinMove" defaultValue="0.5" onChange={() => {}}>
            <option value="0.2">&ge;0.2% move</option>
            <option value="0.5">&ge;0.5% move</option>
            <option value="1.0">&ge;1.0% move</option>
          </select>
        </div>

        {/* Progress */}
        <div className="bt-progress" id="btProgress" style={{ display: 'none' }}>
          <div>Calculating... <span id="btProgressPct">0</span>%</div>
          <div className="bt-progress-bar">
            <div className="bt-progress-fill" id="btProgressFill" style={{ width: '0%' }}></div>
          </div>
        </div>

        {/* Results */}
        <div id="btResults" style={{ display: 'none' }}>
          {/* Summary row */}
          <div className="bt-summary">
            <div className="bt-sum-cell">
              <div className="bt-sum-lbl">BEST INDICATOR</div>
              <div className="bt-sum-val" id="btBestInd" style={{ color: 'var(--gold)', fontSize: '11px' }}>&mdash;</div>
            </div>
            <div className="bt-sum-cell">
              <div className="bt-sum-lbl">AVG WIN RATE</div>
              <div className="bt-sum-val" id="btAvgWR" style={{ color: 'var(--whi)' }}>&mdash;</div>
            </div>
            <div className="bt-sum-cell">
              <div className="bt-sum-lbl">TOTAL SIGNALS</div>
              <div className="bt-sum-val" id="btTotalSig" style={{ color: 'var(--blu)' }}>&mdash;</div>
            </div>
            <div className="bt-sum-cell">
              <div className="bt-sum-lbl">CONFLUENCE WR</div>
              <div className="bt-sum-val" id="btConfWR" style={{ color: 'var(--pur)' }}>&mdash;</div>
            </div>
          </div>

          {/* Table header */}
          <div className="bt-ind-row bt-hdr">
            <span>INDICATOR</span>
            <span>WIN RATE</span>
            <span style={{ textAlign: 'center' }}>SIGNALS</span>
            <span style={{ textAlign: 'right' }}>R:R</span>
            <span style={{ textAlign: 'center' }}>GRADE</span>
          </div>

          {/* Results rows */}
          <div className="bt-result-grid" id="btResultGrid"></div>

          {/* Equity curve */}
          <div className="bt-equity">
            <div className="bt-equity-lbl">EQUITY CURVE &mdash; CONFLUENCE (simulated $1000)</div>
            <div className="bt-equity-chart">
              <svg className="bt-eq-svg" id="btEquitySvg" viewBox="0 0 400 50" preserveAspectRatio="none"></svg>
            </div>
          </div>

          {/* Detail note */}
          <div className="bt-detail" id="btDetailNote">
            <svg className="z-i" viewBox="0 0 16 16">
              <circle cx="8" cy="4" r="1" fill="currentColor" stroke="none" />
              <path d="M7 7h2v6H7z" fill="currentColor" stroke="none" />
            </svg> Backtest verifies whether, after every signal detected in history, the price confirmed the direction in
            the following bars.
            Win Rate &gt; 55% = useful signal. Win Rate &gt; 65% = excellent signal. Results are on the historical data
            available.
          </div>
        </div>

        {/* Empty state */}
        <div id="btEmpty" style={{ padding: '16px', textAlign: 'center', fontSize: '9px', color: 'var(--dim)' }}>
          Press <strong style={{ color: 'var(--gold)' }}>&#9654; RUN BACKTEST</strong> to analyze indicator precision on the
          current historical data.
        </div>
      </div>
    </div>
    </>
  )
}
