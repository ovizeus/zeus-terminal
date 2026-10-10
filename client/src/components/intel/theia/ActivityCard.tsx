import { useATStore } from '../../../stores/atStore'

/**
 * [2026-10-10] Was the "ACTIVITY LOG" block at the foot of the Auto Trade panel.
 *
 * Source, unchanged: `useATStore(s => s.ui.logEntries)` — the panel read it as
 * `ui.logEntries`, filled by trading/autotrade.ts from AT.log. Entry fields
 * `time`, `type`, `msg` are rendered as before; `type` drives the same
 * `at-log-msg <type>` class so the existing colours still apply.
 * Real data only: with no entries the card says so with an em dash.
 */
export function ActivityCard() {
  const entries = useATStore((s) => s.ui?.logEntries) || []
  return (
    <div className="theia-card">
      <h4>Activity log</h4>
      <div className="at-log">
        {entries.length === 0 && <div className="at-log-row"><span className="at-log-msg">—</span></div>}
        {entries.map((entry, idx) => (
          <div className="at-log-row" key={idx}>
            <span className="at-log-time">{entry.time}</span>
            <span className={`at-log-msg ${entry.type}`}>{entry.msg}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
