/** Zeus Status Bar — 1:1 from old app: first element in .page content area.
 *  Shows: Mode, AT state, WS, Data, Kill, Positions, Daily PnL.
 *  In old app this was OUTSIDE header, INSIDE .page (above watchlist).
 *
 *  [R8] Fully React/store-owned. Zero imperative DOM writes from engine.
 *  Source of truth: useUiStore (fields sbMode, sbAtEnabled, sbWsReady,
 *  sbDataState, sbKillActive, sbPosCount, sbPnl). The engine polls
 *  AT/TP/_SAFETY once per 2s and calls useUiStore.getState().patch(...)
 *  — see bootstrapError._updateStatusBar. */
import { useUiStore } from '../../stores'

export function StatusBar() {
  const sbMode = useUiStore((s) => s.sbMode)
  const sbModeClass = useUiStore((s) => s.sbModeClass)
  const sbAtEnabled = useUiStore((s) => s.sbAtEnabled)
  const sbWsReady = useUiStore((s) => s.sbWsReady)
  const sbDataState = useUiStore((s) => s.sbDataState)
  const sbKillActive = useUiStore((s) => s.sbKillActive)
  const sbPosCount = useUiStore((s) => s.sbPosCount)
  const sbPnl = useUiStore((s) => s.sbPnl)
  const openModal = useUiStore((s) => s.openModal)

  const dataDot = sbDataState === 'stale' ? 'zsb-warn' : sbDataState === 'degraded' ? 'zsb-stale' : 'zsb-on'
  const dataTxt = sbDataState === 'stale' ? 'STALE' : sbDataState === 'degraded' ? 'DEGRADED' : 'DATA'

  const pnlColor = sbPnl > 0 ? 'var(--grn-bright)' : sbPnl < 0 ? 'var(--red-bright)' : '#555'
  const posColor = sbPosCount > 0 ? 'var(--cyan)' : '#555'

  return (
    <div className="zeus-status-bar" id="zeusStatusBar">
      <div className={`zsb-item zsb-mode ${sbModeClass}`} id="zsbMode" title="Trading Mode">{sbMode}</div>
      <div className="zsb-sep"></div>
      <div className="zsb-item" id="zsbAT" title="AutoTrade State">
        <span className={`zsb-dot ${sbAtEnabled ? 'zsb-on' : 'zsb-off'}`}></span>AT {sbAtEnabled ? 'ON' : 'OFF'}
      </div>
      <div className="zsb-sep"></div>
      <div className="zsb-item" id="zsbWS" title="WebSocket Connection">
        <span className={`zsb-dot ${sbWsReady ? 'zsb-on' : 'zsb-warn'}`}></span>{sbWsReady ? 'WS' : 'WS...'}
      </div>
      <div className="zsb-sep"></div>
      <div className="zsb-item" id="zsbData" title="Data Freshness">
        <span className={`zsb-dot ${dataDot}`}></span>{dataTxt}
      </div>
      <div className="zsb-sep"></div>
      {sbKillActive && (
        <>
          <div className="zsb-item" id="zsbKill" title="Kill Switch">
            <span className="zsb-dot zsb-warn"></span>KILL ACTIVE
          </div>
          <div className="zsb-sep" id="zsbKillSep"></div>
        </>
      )}
      <div
        className="zsb-item"
        id="zsbPos"
        title="Open Positions — tap for Exposure"
        style={{ cursor: 'pointer', color: posColor }}
        onClick={() => openModal('exposure')}
      >
        {sbPosCount} pos
      </div>
      <div className="zsb-sep"></div>
      <div className="zsb-item" id="zsbPnl" title="Daily PnL" style={{ color: pnlColor }}>
        ${sbPnl.toFixed(2)}
      </div>
    </div>
  )
}
