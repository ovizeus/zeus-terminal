/** Zeus Mode Bar — engine-mode-driven execution toggle.
 *  Phase 2C: env semantics read from canonical executionEnv (server truth).
 *  null + non-demo → LOCKED. Click delegates to switchGlobalMode() legacy.
 *  [MODEBAR NEON PULSE 2026-05-14] data-zmb-mode attribute drives CSS
 *  variants in app.css (#zeus-mode-bar[data-zmb-mode="demo|testnet|locked|real"]).
 */
import { useATStore, useUiStore } from '../../stores'
import { switchGlobalMode } from '../../data/marketDataTrading'
import { toast } from '../../data/marketDataHelpers'
import { _ZI } from '../../constants/icons'

export function ModeBar() {
  const engineMode = useATStore((s) => s.mode) || 'demo'
  const executionEnv = useUiStore((s) => s.executionEnv)
  const executionBlockedReason = useUiStore((s) => s.executionBlockedReason)
  // [Phase 12.A — Batch D2] Append exchange identity to TESTNET/REAL labels.
  const activeExchange = useUiStore((s) => s.activeExchange)
  const openModal = useUiStore((s) => s.openModal)

  const _exchSuffix = activeExchange === 'binance' ? ' · BINANCE' : activeExchange === 'bybit' ? ' · BYBIT' : ''

  let barClass = 'zeus-mode-bar'
  let modeText = ''
  let btnText = ''
  let btnClass = 'zmb-btn'
  let indClass = 'zmb-indicator'
  // [MODEBAR NEON PULSE 2026-05-14] modeKey drives data-zmb-mode attribute
  // for CSS targeting (#zeus-mode-bar[data-zmb-mode="..."]). Single source
  // of truth for the 4-way visual variant. Logic duplicates legacy barClass
  // branching but exposes a stable key without parsing className strings.
  let modeKey: 'demo' | 'testnet' | 'locked' | 'real' = 'demo'

  if (engineMode === 'demo' || executionEnv === 'DEMO') {
    barClass += ' zmb-demo'
    modeText = 'DEMO MODE'
    btnText = 'EXIT DEMO'
    btnClass += ' zmb-btn-exit'
    indClass += ' zmb-ind-demo'
    modeKey = 'demo'
  } else if (executionEnv === null) {
    barClass += ' zmb-locked'
    modeText = 'LIVE — LOCKED'
    btnText = 'CONFIGURE LIVE'
    btnClass += ' zmb-btn-locked'
    indClass += ' zmb-ind-locked'
    modeKey = 'locked'
  } else if (executionEnv === 'TESTNET') {
    barClass += ' zmb-testnet'
    modeText = 'TESTNET' + _exchSuffix
    btnText = 'ACTIVATE DEMO'
    btnClass += ' zmb-btn-demo'
    indClass += ' zmb-ind-testnet'
    modeKey = 'testnet'
  } else {
    barClass += ' zmb-real'
    modeText = 'REAL' + _exchSuffix
    btnText = 'ACTIVATE DEMO'
    btnClass += ' zmb-btn-demo'
    indClass += ' zmb-ind-real'
    modeKey = 'real'
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
    <div id="zeus-mode-bar" className={barClass} data-zmb-mode={modeKey}>
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
