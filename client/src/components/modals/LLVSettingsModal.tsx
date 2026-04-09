import { ModalOverlay, ModalHeader } from './ModalOverlay'
import { useState } from 'react'

const w = window as any
interface Props { visible: boolean; onClose: () => void }

const tabs = ['DISPLAY', 'APPEARANCE'] as const

export function LLVSettingsModal({ visible, onClose }: Props) {
  const [tab, setTab] = useState<typeof tabs[number]>('DISPLAY')

  return (
    <ModalOverlay id="mllv" visible={visible} onClose={onClose}>
      <ModalHeader title="LIQ LEVELS V2" titleStyle={{ color: '#f0c040' }} onClose={onClose} />

      <div style={{ padding: '12px 16px' }}>
        {/* Tabs */}
        <div className="qbs" style={{ marginBottom: 12 }}>
          {tabs.map(t => (
            <div key={t} className={`qb${tab === t ? ' act' : ''}`} onClick={() => setTab(t)}>{t}</div>
          ))}
        </div>

        {/* DISPLAY tab */}
        {tab === 'DISPLAY' && (
          <div>
            <div className="msec" style={{ marginBottom: 10 }}>
              <div className="mrow">
                <span className="mlbl">Price Bucket %</span>
                <input type="range" min={1} max={20} step={1} defaultValue={3} style={{ flex: 1, accentColor: '#f0c040' }} onChange={() => {}} />
              </div>
            </div>
            <div className="msec" style={{ marginBottom: 10 }}>
              <div className="mrow">
                <span className="mlbl">Min Size $</span>
                <input type="range" min={0} max={50} step={1} defaultValue={0} style={{ flex: 1, accentColor: '#f0c040' }} onChange={() => {}} />
              </div>
            </div>
            <div className="msec" style={{ marginBottom: 10 }}>
              <div className="mrow">
                <span className="mlbl">Time Window</span>
                <select id="llvTimeWindow" style={{
                  background: '#0d1a26', border: '1px solid #1e2a3a', color: '#e0e8f0',
                  padding: '3px', fontSize: 8, fontFamily: 'var(--ff)', flex: 1
                }} defaultValue="7d" onChange={(e) => { if ((window as any).S?.llvSettings) (window as any).S.llvSettings.timeWindow = e.target.value }}>
                  <option value="1d">1 Day</option>
                  <option value="3d">3 Days</option>
                  <option value="7d">7 Days</option>
                  <option value="14d">14 Days</option>
                  <option value="30d">30 Days</option>
                </select>
              </div>
            </div>
            <div className="msec" style={{ marginBottom: 10 }}>
              <label className="mchk"><input type="checkbox" id="llvShowLabels" defaultChecked onChange={(e) => { if ((window as any).S?.llvSettings) (window as any).S.llvSettings.showLabels = e.target.checked }} /> Show BTC Labels</label>
            </div>
          </div>
        )}

        {/* APPEARANCE tab */}
        {tab === 'APPEARANCE' && (
          <div>
            <div className="msec" style={{ marginBottom: 10 }}>
              <div className="mrow">
                <span className="mlbl">Long Liq Color</span>
                <input type="color" defaultValue="#00d4aa" style={{ width: 44, height: 26, border: '1px solid #333', borderRadius: 3, cursor: 'pointer' }}
                  onChange={(e) => { if (w.S?.llvSettings) w.S.llvSettings.longCol = e.target.value }} />
              </div>
            </div>
            <div className="msec" style={{ marginBottom: 10 }}>
              <div className="mrow">
                <span className="mlbl">Short Liq Color</span>
                <input type="color" defaultValue="#ff4466" style={{ width: 44, height: 26, border: '1px solid #333', borderRadius: 3, cursor: 'pointer' }}
                  onChange={(e) => { if (w.S?.llvSettings) w.S.llvSettings.shortCol = e.target.value }} />
              </div>
            </div>
            <div className="msec" style={{ marginBottom: 10 }}>
              <div className="mrow">
                <span className="mlbl">Max Bar Width %</span>
                <input type="range" min={5} max={60} step={1} defaultValue={30} style={{ flex: 1, accentColor: '#f0c040' }}
                  onChange={(e) => { if (w.S?.llvSettings) w.S.llvSettings.maxBarWidthPct = +e.target.value }} />
              </div>
            </div>
            <div className="msec" style={{ marginBottom: 10 }}>
              <div className="mrow">
                <span className="mlbl">Opacity %</span>
                <input type="range" min={5} max={100} step={1} defaultValue={70} style={{ flex: 1, accentColor: '#f0c040' }}
                  onChange={(e) => { if (w.S?.llvSettings) w.S.llvSettings.opacity = +e.target.value }} />
              </div>
            </div>

            <div className="msec" style={{ marginBottom: 10 }}>DATA</div>
            <button className="sbtn2 sec" style={{ width: '100%', color: '#ff4466', borderColor: '#ff446644', marginTop: 4 }}
              onClick={() => { w.llvClearCanvas?.(); if (w.S?.llvBuckets) w.S.llvBuckets = {} }}>
              RESET &amp; CLEAR ALL DATA
            </button>
            <button className="sbtn2" style={{ width: '100%', marginTop: 8, background: '#f0c04022', borderColor: '#f0c04055', color: '#f0c040' }}
              onClick={() => { w.llvSaveSettings?.(); onClose() }}>
              SAVE &amp; CLOSE
            </button>
          </div>
        )}
      </div>
    </ModalOverlay>
  )
}
