/** Welcome Modal — 1:1 from #mwelcome in index.html lines 4756-4810
 *  Uses .wlc-modal class (not standard .modal), no ModalOverlay */
import { useState, useRef } from 'react'
interface Props { visible: boolean; onClose: () => void }

export function WelcomeModal({ visible, onClose }: Props) {
  const [snoozeOpen, setSnoozeOpen] = useState(false)
  const [snoozePicked, setSnoozePicked] = useState<number | null>(null)
  // [BUG-UI-CMP-7] Synchronous double-click guard — useRef immune to React state batching.
  const snoozeBusyRef = useRef(false)
  function snooze(hours: number) {
    try { localStorage.setItem('zeus_wlc_snoozeUntil', String(Date.now() + hours * 3600 * 1000)) } catch (_) {}
    setSnoozePicked(hours)
    setTimeout(() => { setSnoozeOpen(false); setSnoozePicked(null); onClose() }, 650)
  }
  const onSnooze = (hours: number) => {
    if (snoozeBusyRef.current) return
    snoozeBusyRef.current = true
    snooze(hours)
  }
  return (
    <div className="mover" id="mwelcome" style={{ display: visible ? 'flex' : 'none' }} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal wlc-modal">
        <div className="wlc-header">
          <div className="wlc-logo">
            <svg className="z-i z-i--xl" viewBox="0 0 16 16" style={{ color: '#f0c040', width: 32, height: 32 }}>
              <path d="M9 1L4 9h4l-1 6 5-8H8l1-6" />
            </svg>
          </div>
          <div className="wlc-greeting" id="wlcGreeting">Welcome back</div>
          <div className="wlc-mode-badge" id="wlcModeBadge"></div>
          <div className="wlc-version" id="wlcVersion"></div>
        </div>
        <div className="wlc-body">
          {/* Row 1: Balance + Daily PnL */}
          <div className="wlc-row">
            <div className="wlc-card">
              <div className="wlc-label">BALANCE</div>
              <div className="wlc-value" id="wlcBalance">—</div>
            </div>
            <div className="wlc-card">
              <div className="wlc-label">PnL TODAY</div>
              <div className="wlc-value" id="wlcDailyPnl">—</div>
            </div>
          </div>
          {/* Row 2: Trades + Win Rate */}
          <div className="wlc-row">
            <div className="wlc-card">
              <div className="wlc-label">TRADES TODAY</div>
              <div className="wlc-value" id="wlcTrades">—</div>
            </div>
            <div className="wlc-card">
              <div className="wlc-label">WIN RATE</div>
              <div className="wlc-value" id="wlcWinRate">—</div>
            </div>
          </div>
          {/* Row 3: Status cards */}
          <div className="wlc-row wlc-row-3">
            <div className="wlc-card wlc-mini">
              <div className="wlc-label">POSITIONS</div>
              <div className="wlc-value" id="wlcPositions">0</div>
            </div>
            <div className="wlc-card wlc-mini">
              <div className="wlc-label">AUTOTRADE</div>
              <div className="wlc-value" id="wlcAT">OFF</div>
            </div>
            <div className="wlc-card wlc-mini">
              <div className="wlc-label">BRAIN</div>
              <div className="wlc-value" id="wlcBrain">—</div>
            </div>
          </div>
        </div>
        <button className="wlc-enter" id="wlcEnterBtn" onClick={onClose}>
          ENTER TERMINAL{' '}
          <svg className="z-i" viewBox="0 0 16 16"><path d="M9 1L4 9h4l-1 6 5-8H8l1-6" /></svg>
        </button>
        <div className="wlc-snooze-wrap">
          {!snoozeOpen ? (
            <button type="button" className="wlc-snooze-link" onClick={() => setSnoozeOpen(true)}>Don't show for…</button>
          ) : (
            <div className="wlc-snooze-opts">
              <button type="button" disabled={snoozePicked !== null} className={'wlc-snooze-pill' + (snoozePicked === 5 ? ' wlc-snooze-active' : '')} onClick={() => onSnooze(5)}>5h</button>
              <button type="button" disabled={snoozePicked !== null} className={'wlc-snooze-pill' + (snoozePicked === 12 ? ' wlc-snooze-active' : '')} onClick={() => onSnooze(12)}>12h</button>
              <button type="button" disabled={snoozePicked !== null} className={'wlc-snooze-pill' + (snoozePicked === 24 ? ' wlc-snooze-active' : '')} onClick={() => onSnooze(24)}>24h</button>
              <button type="button" disabled={snoozePicked !== null} className="wlc-snooze-cancel" onClick={() => setSnoozeOpen(false)}>cancel</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
