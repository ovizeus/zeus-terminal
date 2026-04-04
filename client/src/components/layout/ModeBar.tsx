/** Zeus Mode Bar — 1:1 from initModeBar() + updateModeBar() in modebar.js
 *  Shows execution mode (DEMO / TESTNET / LIVE / LOCKED).
 *  Switch toggles demo ↔ live via POST /api/mode. */
import { useUiStore } from '../../stores'

export function ModeBar() {
  const resolvedEnv = useUiStore((s) => s.resolvedEnv)
  const apiConfigured = useUiStore((s) => s.apiConfigured)
  const exchangeMode = useUiStore((s) => s.exchangeMode)
  const patch = useUiStore((s) => s.patch)
  const openModal = useUiStore((s) => s.openModal)

  // Derive mode from store (same logic as modebar.js updateModeBar)
  const mode = exchangeMode || 'demo'

  let barClass = 'zeus-mode-bar'
  let modeText = ''
  let btnText = ''
  let btnClass = 'zmb-btn'
  let indClass = 'zmb-indicator'

  if (mode === 'demo') {
    barClass += ' zmb-demo'
    modeText = 'DEMO MODE'
    btnText = 'EXIT DEMO'
    btnClass += ' zmb-btn-exit'
    indClass += ' zmb-ind-demo'
  } else if (resolvedEnv === 'TESTNET') {
    barClass += ' zmb-testnet'
    modeText = 'LIVE — TESTNET'
    btnText = 'ACTIVATE DEMO'
    btnClass += ' zmb-btn-demo'
    indClass += ' zmb-ind-testnet'
  } else if (!apiConfigured && mode === 'live') {
    barClass += ' zmb-locked'
    modeText = 'LIVE — LOCKED'
    btnText = 'CONFIGURE LIVE'
    btnClass += ' zmb-btn-locked'
    indClass += ' zmb-ind-locked'
  } else {
    barClass += ' zmb-real'
    modeText = 'LIVE — REAL'
    btnText = 'ACTIVATE DEMO'
    btnClass += ' zmb-btn-demo'
    indClass += ' zmb-ind-real'
  }

  function handleSwitch() {
    // LOCKED: no API keys — guide user to settings
    if (mode === 'live' && !apiConfigured) {
      openModal('settings')
      return
    }
    const newMode = mode === 'demo' ? 'live' : 'demo'
    // Optimistic UI update
    patch({ exchangeMode: newMode, resolvedEnv: newMode === 'demo' ? 'DEMO' : resolvedEnv })
    // Notify server (fire-and-forget, server is source of truth on next sync)
    fetch('/api/mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ mode: newMode }),
    }).catch(() => { /* server sync will correct if needed */ })
  }

  return (
    <div id="zeus-mode-bar" className={barClass}>
      <div className="zmb-status">
        <div className={indClass} id="zmbIndicator"></div>
        <div className="zmb-info">
          <span className="zmb-label" id="zmbLabel">EXECUTION MODE</span>
          <span className="zmb-mode" id="zmbMode">{modeText}</span>
        </div>
      </div>
      <button className={btnClass} id="zmbBtn" onClick={handleSwitch}>{btnText}</button>
    </div>
  )
}
