/** Zeus Mode Bar — engine-mode-driven execution toggle.
 *  Shows DEMO / LIVE—TESTNET / LIVE—REAL / LIVE—LOCKED based on server state.
 *  Click delegates to switchGlobalMode() (legacy): confirm dialog +
 *  POST /api/at/mode + preLiveChecklist handling + toast feedback.
 *  When no API configured and user tries to exit demo, opens Settings modal. */
import { useATStore, useUiStore } from '../../stores'
import { switchGlobalMode } from '../../data/marketDataTrading'
import { toast } from '../../data/marketDataHelpers'
import { _ZI } from '../../constants/icons'

export function ModeBar() {
  const engineMode = useATStore((s) => s.mode) || 'demo'
  const apiConfigured = useUiStore((s) => s.apiConfigured)
  const exchangeMode = useUiStore((s) => s.exchangeMode)
  const openModal = useUiStore((s) => s.openModal)

  let barClass = 'zeus-mode-bar'
  let modeText = ''
  let btnText = ''
  let btnClass = 'zmb-btn'
  let indClass = 'zmb-indicator'

  if (engineMode === 'demo') {
    barClass += ' zmb-demo'
    modeText = 'DEMO MODE'
    btnText = 'EXIT DEMO'
    btnClass += ' zmb-btn-exit'
    indClass += ' zmb-ind-demo'
  } else if (!apiConfigured) {
    barClass += ' zmb-locked'
    modeText = 'LIVE \u2014 LOCKED'
    btnText = 'CONFIGURE LIVE'
    btnClass += ' zmb-btn-locked'
    indClass += ' zmb-ind-locked'
  } else if (exchangeMode === 'testnet') {
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
      if (!apiConfigured) {
        toast('Configure API keys in Settings \u2192 Exchange API first', 3500, _ZI.w)
        openModal('settings')
        return
      }
      switchGlobalMode('live')
    } else {
      if (!apiConfigured) {
        toast('Configure API keys in Settings \u2192 Exchange API first', 3500, _ZI.w)
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
