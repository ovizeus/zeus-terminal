/** Zeus Mode Bar — engine-mode-driven execution toggle.
 *  Phase 2C: env semantics read from canonical executionEnv (server truth).
 *  null + non-demo → LOCKED. Click delegates to switchGlobalMode() legacy. */
import { useATStore, useUiStore } from '../../stores'
import { switchGlobalMode } from '../../data/marketDataTrading'
import { toast } from '../../data/marketDataHelpers'
import { _ZI } from '../../constants/icons'

export function ModeBar() {
  const engineMode = useATStore((s) => s.mode) || 'demo'
  const executionEnv = useUiStore((s) => s.executionEnv)
  const executionBlockedReason = useUiStore((s) => s.executionBlockedReason)
  const openModal = useUiStore((s) => s.openModal)

  let barClass = 'zeus-mode-bar'
  let modeText = ''
  let btnText = ''
  let btnClass = 'zmb-btn'
  let indClass = 'zmb-indicator'

  if (engineMode === 'demo' || executionEnv === 'DEMO') {
    barClass += ' zmb-demo'
    modeText = 'DEMO MODE'
    btnText = 'EXIT DEMO'
    btnClass += ' zmb-btn-exit'
    indClass += ' zmb-ind-demo'
  } else if (executionEnv === null) {
    barClass += ' zmb-locked'
    modeText = 'LIVE \u2014 LOCKED'
    btnText = 'CONFIGURE LIVE'
    btnClass += ' zmb-btn-locked'
    indClass += ' zmb-ind-locked'
  } else if (executionEnv === 'TESTNET') {
    barClass += ' zmb-testnet'
    modeText = 'LIVE \u2014 TESTNET'
    btnText = 'ACTIVATE DEMO'
    btnClass += ' zmb-btn-demo'
    indClass += ' zmb-ind-testnet'
  } else {
    barClass += ' zmb-real'
    modeText = 'LIVE \u2014 REAL'
    btnText = 'ACTIVATE DEMO'
    btnClass += ' zmb-btn-demo'
    indClass += ' zmb-ind-real'
  }

  function handleSwitch() {
    if (engineMode === 'demo') {
      if (executionEnv === null) {
        toast('LIVE MODE LOCKED: ' + (executionBlockedReason === 'INVALID_ACTIVE_API_CONFIGURATION' ? 'Invalid active API configuration' : 'No valid API credentials configured'), 3500, _ZI.w)
        openModal('settings')
        return
      }
      switchGlobalMode('live')
    } else {
      if (executionEnv === null) {
        toast('LIVE MODE LOCKED: ' + (executionBlockedReason === 'INVALID_ACTIVE_API_CONFIGURATION' ? 'Invalid active API configuration' : 'No valid API credentials configured'), 3500, _ZI.w)
        openModal('settings')
        return
      }
      switchGlobalMode('demo')
    }
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
