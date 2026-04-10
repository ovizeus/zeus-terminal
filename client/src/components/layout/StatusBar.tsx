/** Zeus Status Bar — 1:1 from old app: first element in .page content area.
 *  Shows: Mode, AT state, WS, Data, Kill, Positions, Daily PnL.
 *  In old app this was OUTSIDE header, INSIDE .page (above watchlist). */
import { useUiStore } from '../../stores'

export function StatusBar() {
  const connected = useUiStore((s) => s.connected)
  const resolvedEnv = useUiStore((s) => s.resolvedEnv)
  const openModal = useUiStore((s) => s.openModal)

  const modeClass = resolvedEnv === 'DEMO' ? 'zsb-demo'
    : resolvedEnv === 'TESTNET' ? 'zsb-testnet'
    : 'zsb-live'

  return (
    <div className="zeus-status-bar" id="zeusStatusBar">
      <div className={`zsb-item zsb-mode ${modeClass}`} id="zsbMode" title="Trading Mode">{resolvedEnv || 'DEMO'}</div>
      <div className="zsb-sep"></div>
      <div className="zsb-item" id="zsbAT" title="AutoTrade State"><span className="zsb-dot zsb-off"></span>AT OFF</div>
      <div className="zsb-sep"></div>
      <div className="zsb-item" id="zsbWS" title="WebSocket Connection"><span className={`zsb-dot ${connected ? 'zsb-on' : 'zsb-off'}`}></span>WS</div>
      <div className="zsb-sep"></div>
      <div className="zsb-item" id="zsbData" title="Data Freshness"><span className={`zsb-dot ${connected ? 'zsb-on' : 'zsb-off'}`}></span>DATA</div>
      <div className="zsb-sep"></div>
      <div className="zsb-item" id="zsbKill" title="Kill Switch" style={{ display: 'none' }}><span className="zsb-dot zsb-warn"></span>KILL</div>
      <div className="zsb-sep" id="zsbKillSep" style={{ display: 'none' }}></div>
      <div className="zsb-item" id="zsbPos" title="Open Positions — tap for Exposure" style={{ cursor: 'pointer' }} onClick={() => openModal('exposure')}>0 pos</div>
      <div className="zsb-sep"></div>
      <div className="zsb-item" id="zsbPnl" title="Daily PnL">$0.00</div>
    </div>
  )
}
