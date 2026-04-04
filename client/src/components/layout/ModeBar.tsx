/** Zeus Mode Bar — 1:1 from initModeBar() in modebar.js
 *  Shows execution mode (DEMO / TESTNET / LIVE / LOCKED).
 *  Logic (switching) = category B — wired later. */
export function ModeBar() {
  // Default state: DEMO mode (matches original init behavior)
  return (
    <div id="zeus-mode-bar" className="zeus-mode-bar zmb-demo">
      <div className="zmb-status">
        <div className="zmb-indicator zmb-ind-demo" id="zmbIndicator"></div>
        <div className="zmb-info">
          <span className="zmb-label" id="zmbLabel">EXECUTION MODE</span>
          <span className="zmb-mode" id="zmbMode">DEMO MODE</span>
        </div>
      </div>
      <button className="zmb-btn zmb-btn-exit" id="zmbBtn">EXIT DEMO</button>
    </div>
  )
}
