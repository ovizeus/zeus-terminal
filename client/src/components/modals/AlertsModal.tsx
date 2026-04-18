/** Price Alerts Modal — wired to window.* functions */
import { useEffect } from 'react'
import { ModalOverlay, ModalHeader } from './ModalOverlay'
import { useUiStore, useMarketStore } from '../../stores'
import { toggleAlerts, isSoundMuted } from '../../ui/dom2'
import { injectFakeWhale, toggleSnd, saveAlerts, testNotification, _syncSndIcon } from '../../data/marketDataWS'

const w = window as any

interface Props { visible: boolean; onClose: () => void }

export function AlertsModal({ visible, onClose }: Props) {
  const openModal = useUiStore((s) => s.openModal)
  const symbol = useMarketStore((s) => s.market.symbol)

  // [BUG7] Sync the Sound Notifications button icon with the BUG5 master mute
  // flag every time the modal opens, so the button never lies about state.
  useEffect(() => {
    if (!visible) return
    const id = setTimeout(() => _syncSndIcon(), 0)
    return () => clearTimeout(id)
  }, [visible])

  const toggleMaster = (checked: boolean) => {
    if (typeof toggleAlerts === 'function') toggleAlerts(checked)
    // Also update visual toggle
    const slider = document.getElementById('alertToggleSlider') as HTMLElement | null
    const dot = document.getElementById('alertToggleDot') as HTMLElement | null
    if (slider) slider.style.background = checked ? '#00d97a' : '#1e2530'
    if (dot) { dot.style.transform = checked ? 'translateX(20px)' : 'translateX(0)'; dot.style.background = checked ? '#fff' : '#555' }
  }

  return (
    <ModalOverlay id="malerts" visible={visible} onClose={onClose}>
      <ModalHeader title={`PRICE ALERTS — ${symbol}`} onClose={onClose} />

      <div style={{ padding: '12px 16px', overflowY: 'auto', maxHeight: '75vh' }}>

        {/* Master switch */}
        <div style={{
          background: '#0d1810', border: '1px solid #00d97a33', borderRadius: 6,
          padding: 10, marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between'
        }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--grn)', fontWeight: 700 }}>Enable Alerts</div>
            <div style={{ fontSize: 8, color: 'var(--dim)', marginTop: 2 }}>Browser notifications required</div>
          </div>
          <label style={{ position: 'relative', display: 'inline-block', width: 44, height: 24, cursor: 'pointer' }}>
            <input type="checkbox" id="alertMaster" style={{ opacity: 0, width: 0, height: 0 }}
              onChange={(e) => toggleMaster(e.target.checked)} />
            <span id="alertToggleSlider" style={{
              position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
              background: '#1e2530', borderRadius: 24, transition: '.3s', border: '1px solid #333'
            }}>
              <span id="alertToggleDot" style={{
                position: 'absolute', height: 18, width: 18, left: 2, bottom: 2,
                background: '#555', borderRadius: '50%', transition: '.3s'
              }} />
            </span>
          </label>
        </div>

        {/* Notification Center quick access */}
        <div style={{
          background: '#0d1018', border: '1px solid #aa44ff33', borderRadius: 6,
          padding: 10, marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer'
        }} onClick={() => { onClose(); openModal('notifications') }}>
          <div>
            <div style={{ fontSize: 11, color: '#aa88ff', fontWeight: 700 }}>Notification Center</div>
            <div style={{ fontSize: 8, color: 'var(--dim)', marginTop: 2 }}>View all system notifications</div>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#aa88ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </div>

        {/* Sound toggle */}
        <div style={{
          background: '#0d1018', border: '1px solid #1e2530', borderRadius: 6,
          padding: 10, marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between'
        }}>
          <div>
            <div style={{ fontSize: 11, color: '#8899aa', fontWeight: 700 }}>
              <svg className="z-i" viewBox="0 0 16 16"><path d="M2 6h2l3-3v10l-3-3H2zM12 5.5c2 1 2 4 0 5" /></svg>
              {' '}Sound Notifications
            </div>
            <div style={{ fontSize: 8, color: 'var(--dim)', marginTop: 2 }}>Alert sounds on/off</div>
          </div>
          <button className="sndbtn" id="snd" style={{ fontSize: 14, padding: '4px 10px', borderRadius: 6 }}
            onClick={() => toggleSnd()}>&#128277;</button>
        </div>

        {/* Volume Alerts */}
        <div style={{ background: '#0d1018', border: '1px solid #333', borderRadius: 6, padding: 10, marginBottom: 8 }}>
          <div style={{ color: 'var(--gold)', fontSize: 10, fontWeight: 700, marginBottom: 8 }}>Volume Alerts</div>
          <label className="mchk"><input type="checkbox" id="aVolSpike" defaultChecked
            onChange={(e) => { if (w.S?.alerts) w.S.alerts.volSpike = e.target.checked }} /> Enable Volume Spike Alerts</label>
          <div className="mrow"><span className="mlbl">Threshold (BTC per candle)</span></div>
          <input type="number" id="aVolThresh" defaultValue={500} min={10} max={10000} style={{ width: 120, margin: '4px 0' }}
            onChange={(e) => { if (w.S?.alerts) w.S.alerts.volThreshold = +e.target.value }} />
          <div style={{ fontSize: 8, color: 'var(--dim)', marginTop: 3 }}>Alert when candle volume ≥ threshold BTC</div>
        </div>

        {/* Whale Order Alerts */}
        <div style={{ background: '#0d1018', border: '1px solid #333', borderRadius: 6, padding: 10, marginBottom: 8 }}>
          <div style={{ color: 'var(--gold)', fontSize: 10, fontWeight: 700, marginBottom: 8 }}>
            <svg className="z-i z-i--lg" viewBox="0 0 16 16" style={{ color: 'var(--gold)' }}>
              <path d="M2 8c0-3 3-5 6-5s4 1 5 3c1-1 2 0 2 1s-1 2-3 2H5c-2 0-3-1-3-1" />
            </svg> Whale Order Alerts
          </div>
          <label className="mchk"><input type="checkbox" id="aWhaleOrders" defaultChecked
            onChange={(e) => { if (w.S?.alerts) w.S.alerts.whaleOrders = e.target.checked }} /> Enable Whale Order Alerts</label>
          <div className="mrow"><span className="mlbl">Min Size (BTC)</span></div>
          <select id="aWhaleMin" defaultValue="100" style={{ margin: '4px 0', minWidth: 120 }}
            onChange={(e) => { if (w.S?.alerts) w.S.alerts.whaleMinBtc = +e.target.value }}>
            <option value="50">50 BTC</option>
            <option value="100">100 BTC</option>
            <option value="200">200 BTC</option>
            <option value="500">500 BTC</option>
          </select>
          <div style={{ marginTop: 6, fontSize: 8, color: 'var(--dim)' }}>
            Alert When:<br />
            <label className="mchk" style={{ margin: '3px 0' }}><input type="checkbox" id="aWhaleBid" defaultChecked
              onChange={(e) => { if (w.S?.alerts) w.S.alerts.whaleBid = e.target.checked }} /> <span className="z-dot z-dot--grn"></span> Large BIDs Added (Bullish)</label>
            <label className="mchk" style={{ margin: '3px 0' }}><input type="checkbox" id="aWhaleAsk" defaultChecked
              onChange={(e) => { if (w.S?.alerts) w.S.alerts.whaleAsk = e.target.checked }} /> <span className="z-dot z-dot--red"></span> Large ASKs Added (Bearish)</label>
            <label className="mchk" style={{ margin: '3px 0' }}><input type="checkbox" id="aWhaleRem" defaultChecked
              onChange={(e) => { if (w.S?.alerts) w.S.alerts.whaleRem = e.target.checked }}>
            </input>
              <svg className="z-i" viewBox="0 0 16 16"><path d="M5 2c-2 1-3 3-3 5v5l2-1 2 1 2-1 2 1v-5c0-2-1-4-3-5m1 4h.01m4 0h.01" /></svg>
              {' '}Large Orders Removed
            </label>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button style={{
              flex: 1, padding: 8, background: 'var(--gold)', color: '#000', border: 'none',
              borderRadius: 4, fontSize: 9, cursor: 'pointer', fontFamily: 'var(--ff)'
            }} onClick={() => testNotification()}>Test Notification</button>
            <button style={{
              flex: 1, padding: 8, background: '#00b8d4', color: '#000', border: 'none',
              borderRadius: 4, fontSize: 9, cursor: 'pointer', fontFamily: 'var(--ff)'
            }} onClick={() => injectFakeWhale()}>Inject Fake Whale</button>
          </div>
        </div>

        {/* Liquidation Alerts */}
        <div style={{ background: '#0d1018', border: '1px solid #333', borderRadius: 6, padding: 10, marginBottom: 8 }}>
          <div style={{ color: 'var(--gold)', fontSize: 10, fontWeight: 700, marginBottom: 8 }}>Liquidation Alerts</div>
          <label className="mchk"><input type="checkbox" id="aLiqEn" defaultChecked
            onChange={(e) => { if (w.S?.alerts) w.S.alerts.liqAlerts = e.target.checked }} /> Enable Liquidation Alerts</label>
          <div className="mrow"><span className="mlbl">Minimum Size (BTC)</span></div>
          <select id="aLiqMin" defaultValue="1" style={{ margin: '4px 0', minWidth: 120 }}
            onChange={(e) => { if (w.S?.alerts) w.S.alerts.liqMinBtc = +e.target.value }}>
            <option value="0.5">0.5 BTC</option>
            <option value="1">1 BTC</option>
            <option value="5">5 BTC</option>
            <option value="10">10 BTC</option>
            <option value="50">50 BTC</option>
          </select>
        </div>

        {/* Divergence Alerts */}
        <div style={{ background: '#0d1018', border: '1px solid #333', borderRadius: 6, padding: 10, marginBottom: 8 }}>
          <div style={{ color: 'var(--gold)', fontSize: 10, fontWeight: 700, marginBottom: 8 }}>↗↘ Divergence Alerts</div>
          <label className="mchk"><input type="checkbox" id="aDivEn" defaultChecked
            onChange={(e) => { if (w.S?.alerts) w.S.alerts.divergence = e.target.checked }} /> Enable Divergence Alerts</label>
          <div style={{ fontSize: 8, color: 'var(--dim)', margin: '4px 0' }}>Indicators:</div>
          <label className="mchk"><input type="checkbox" id="aDivRSI" defaultChecked onChange={(e) => { if (w.S?.alerts) w.S.alerts.divRSI = e.target.checked }} /> RSI Divergences</label>
          <label className="mchk"><input type="checkbox" id="aDivMACD" defaultChecked onChange={(e) => { if (w.S?.alerts) w.S.alerts.divMACD = e.target.checked }} /> MACD Divergences</label>
          <div style={{ fontSize: 8, color: 'var(--dim)', margin: '4px 0' }}>Types:</div>
          <label className="mchk"><input type="checkbox" id="aDivBull" defaultChecked onChange={(e) => { if (w.S?.alerts) w.S.alerts.divBull = e.target.checked }} /> Bullish (price LL + indicator HL)</label>
          <label className="mchk"><input type="checkbox" id="aDivBear" defaultChecked onChange={(e) => { if (w.S?.alerts) w.S.alerts.divBear = e.target.checked }} /> Bearish (price HH + indicator LH)</label>
          <label className="mchk"><input type="checkbox" id="aDivHid" onChange={(e) => { if (w.S?.alerts) w.S.alerts.divHidden = e.target.checked }} /> Hidden Divergences</label>
        </div>

        {/* Pivot Level Alerts */}
        <div style={{ background: '#0d1018', border: '1px solid #333', borderRadius: 6, padding: 10, marginBottom: 8 }}>
          <div style={{ color: 'var(--gold)', fontSize: 10, fontWeight: 700, marginBottom: 8 }}>Pivot Level Alerts</div>
          <label className="mchk"><input type="checkbox" id="aPivotEn" onChange={(e) => { if (w.S?.alerts) w.S.alerts.pivotAlerts = e.target.checked }} /> Enable Pivot Level Crossing Alerts</label>
          <div style={{ fontSize: 8, color: 'var(--dim)', marginTop: 4 }}>Alerts when price crosses S/R pivot levels</div>
        </div>

        {/* RSI Alerts */}
        <div style={{ background: '#0d1018', border: '1px solid #333', borderRadius: 6, padding: 10, marginBottom: 8 }}>
          <div style={{ color: 'var(--gold)', fontSize: 10, fontWeight: 700, marginBottom: 8 }}>RSI Alerts</div>
          <label className="mchk"><input type="checkbox" id="aRSIEn" defaultChecked
            onChange={(e) => { if (w.S?.alerts) w.S.alerts.rsiAlerts = e.target.checked }} /> Enable RSI Alerts</label>
          <label className="mchk"><input type="checkbox" id="aRSIOB" defaultChecked onChange={(e) => { if (w.S?.alerts) w.S.alerts.rsiOB = e.target.checked }} /> Alert when RSI &gt; 70 (Overbought)</label>
          <label className="mchk"><input type="checkbox" id="aRSIOS" defaultChecked onChange={(e) => { if (w.S?.alerts) w.S.alerts.rsiOS = e.target.checked }} /> Alert when RSI &lt; 30 (Oversold)</label>
        </div>

        {/* Save / Close */}
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <button className="sbtn2 pri" style={{ flex: 1 }}
            onClick={() => { saveAlerts(); onClose() }}>
            <svg className="z-i" viewBox="0 0 16 16"><path d="M4 2h5l3 3v9H4V2zm5 0v3h3M6 9h4m-4 2h3" /></svg> SAVE
          </button>
          <button className="sbtn2 sec" style={{ flex: 1 }} onClick={onClose}>CLOSE</button>
        </div>
      </div>
    </ModalOverlay>
  )
}
