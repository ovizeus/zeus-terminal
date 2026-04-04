import { ModalOverlay, ModalHeader } from './ModalOverlay'
import { useState } from 'react'

interface Props { visible: boolean; onClose: () => void }

const inputStyle: React.CSSProperties = {
  background: '#0a121a', border: '1px solid #2a3a4a', color: 'var(--txt)',
  padding: '4px 8px', borderRadius: 2, fontFamily: 'var(--ff)', fontSize: 9
}

const tabs = ['MAIN', 'SESSIONS', 'PIVOT', 'VWAP'] as const

const sessions = [
  { name: 'Asia', color: '#f0c040' },
  { name: 'Sydney', color: '#4fc3f7' },
  { name: 'Tokyo', color: '#ff7043' },
  { name: 'Shanghai', color: '#ef5350' },
  { name: 'Frankfurt', color: '#66bb6a' },
  { name: 'London', color: '#42a5f5' },
  { name: 'NYC', color: '#ab47bc' },
  { name: 'NYSE', color: '#26a69a' },
] as const

export function SupremusModal({ visible, onClose }: Props) {
  const [tab, setTab] = useState<typeof tabs[number]>('MAIN')

  return (
    <ModalOverlay id="mzs" visible={visible} onClose={onClose}>
      <ModalHeader title="ZEUS SUPREMUS SETTINGS" onClose={onClose} />

      <div style={{ padding: '12px 16px', overflowY: 'auto', maxHeight: '75vh' }}>
        {/* Tabs */}
        <div className="qbs" style={{ marginBottom: 12 }}>
          {tabs.map(t => (
            <div key={t} className={`qb${tab === t ? ' act' : ''}`} onClick={() => setTab(t)}>{t}</div>
          ))}
        </div>

        {/* MAIN tab */}
        {tab === 'MAIN' && (
          <div>
            {/* Market Structure */}
            <div className="msec" style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 6 }}>MARKET STRUCTURE</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {['HH', 'HL', 'LH', 'LL'].map(label => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <label className="mchk" style={{ flex: 1 }}>
                      <input type="checkbox" defaultChecked /> {label}
                    </label>
                    <input type="color" defaultValue={label.startsWith('H') ? '#00e676' : '#ff3355'}
                      style={{ width: 22, height: 16, border: 'none', background: 'none', cursor: 'pointer' }} />
                  </div>
                ))}
              </div>
            </div>

            {/* Nova Zones */}
            <div className="msec" style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 6 }}>NOVA ZONES</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label className="mchk"><input type="checkbox" defaultChecked /> Show Zones</label>
                <label className="mchk"><input type="checkbox" /> Extend Zones</label>
              </div>
              <div className="mrow" style={{ marginTop: 6 }}>
                <span className="mlbl">Width</span>
                <input type="number" defaultValue={2} style={{ ...inputStyle, width: 50 }} />
              </div>
              <div className="mrow" style={{ marginTop: 6 }}>
                <span className="mlbl">Bull Color</span>
                <input type="color" defaultValue="#00e676" style={{ width: 22, height: 16, border: 'none', background: 'none', cursor: 'pointer' }} />
              </div>
              <div className="mrow" style={{ marginTop: 6 }}>
                <span className="mlbl">Bear Color</span>
                <input type="color" defaultValue="#ff3355" style={{ width: 22, height: 16, border: 'none', background: 'none', cursor: 'pointer' }} />
              </div>
              <div className="mrow" style={{ marginTop: 6 }}>
                <span className="mlbl">Pivot</span>
                <input type="number" defaultValue={5} style={{ ...inputStyle, width: 50 }} />
              </div>
            </div>

            {/* Nova Pivot Detector */}
            <div className="msec" style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 6 }}>NOVA PIVOT DETECTOR</div>
              <label className="mchk"><input type="checkbox" defaultChecked /> Enable</label>
            </div>

            {/* Signals */}
            <div className="msec" style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 6 }}>SIGNALS</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label className="mchk"><input type="checkbox" defaultChecked /> Buy Signals</label>
                <label className="mchk"><input type="checkbox" defaultChecked /> Sell Signals</label>
                <label className="mchk"><input type="checkbox" /> Reversal Signals</label>
                <label className="mchk"><input type="checkbox" /> Continuation Signals</label>
              </div>
            </div>
          </div>
        )}

        {/* SESSIONS tab */}
        {tab === 'SESSIONS' && (
          <div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
              {sessions.map(s => (
                <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    fontSize: 8, fontWeight: 700, color: s.color, background: s.color + '18',
                    padding: '2px 6px', borderRadius: 3, minWidth: 52, textAlign: 'center'
                  }}>
                    {s.name}
                  </span>
                  <label className="mchk" style={{ flex: 1 }}>
                    <input type="checkbox" defaultChecked />
                  </label>
                  <input type="color" defaultValue={s.color}
                    style={{ width: 22, height: 16, border: 'none', background: 'none', cursor: 'pointer' }} />
                </div>
              ))}
            </div>

            <div className="msec" style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 6 }}>LINE SETTINGS</div>
              <div className="mrow">
                <span className="mlbl">Line Width</span>
                <input type="number" defaultValue={1} min={1} max={5} style={{ ...inputStyle, width: 50 }} />
              </div>
              <div className="mrow" style={{ marginTop: 6 }}>
                <span className="mlbl">Line Style</span>
                <select style={inputStyle} defaultValue="dashed">
                  <option value="solid">Solid</option>
                  <option value="dashed">Dashed</option>
                  <option value="dotted">Dotted</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* PIVOT tab */}
        {tab === 'PIVOT' && (
          <div>
            <div className="msec" style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 6 }}>NOVA TREND LINES</div>
              <label className="mchk"><input type="checkbox" defaultChecked /> Show Labels</label>
              <div className="mrow" style={{ marginTop: 6 }}>
                <span className="mlbl">Up Color</span>
                <input type="color" defaultValue="#00e676" style={{ width: 22, height: 16, border: 'none', background: 'none', cursor: 'pointer' }} />
              </div>
              <div className="mrow" style={{ marginTop: 6 }}>
                <span className="mlbl">Down Color</span>
                <input type="color" defaultValue="#ff3355" style={{ width: 22, height: 16, border: 'none', background: 'none', cursor: 'pointer' }} />
              </div>
              <div className="mrow" style={{ marginTop: 6 }}>
                <span className="mlbl">Width</span>
                <input type="number" defaultValue={1} min={1} max={5} style={{ ...inputStyle, width: 50 }} />
              </div>
              <div className="mrow" style={{ marginTop: 6 }}>
                <span className="mlbl">Style</span>
                <select style={inputStyle} defaultValue="solid">
                  <option value="solid">Solid</option>
                  <option value="dashed">Dashed</option>
                  <option value="dotted">Dotted</option>
                </select>
              </div>
            </div>

            <div className="msec" style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 6 }}>ALPHA MAX LEVEL</div>
              <label className="mchk"><input type="checkbox" defaultChecked /> Enable</label>
              <div className="mrow" style={{ marginTop: 6 }}>
                <span className="mlbl">Color</span>
                <input type="color" defaultValue="#f0c040" style={{ width: 22, height: 16, border: 'none', background: 'none', cursor: 'pointer' }} />
              </div>
            </div>
          </div>
        )}

        {/* VWAP tab */}
        {tab === 'VWAP' && (
          <div>
            {['Daily', 'Weekly', 'Monthly'].map(period => (
              <div key={period} className="msec" style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 6 }}>{period.toUpperCase()} VWAP</div>
                <label className="mchk"><input type="checkbox" defaultChecked={period === 'Daily'} /> Enable</label>
                <div className="mrow" style={{ marginTop: 6 }}>
                  <span className="mlbl">Color</span>
                  <input type="color"
                    defaultValue={period === 'Daily' ? '#f0c040' : period === 'Weekly' ? '#4fc3f7' : '#ab47bc'}
                    style={{ width: 22, height: 16, border: 'none', background: 'none', cursor: 'pointer' }} />
                </div>
                <div className="mrow" style={{ marginTop: 6 }}>
                  <span className="mlbl">Width</span>
                  <input type="number" defaultValue={1} min={1} max={5} style={{ ...inputStyle, width: 50 }} />
                </div>
              </div>
            ))}

            <div className="msec" style={{ marginBottom: 12 }}>
              <label className="mchk"><input type="checkbox" /> Show Status Line</label>
            </div>

            <div className="srow" style={{ justifyContent: 'flex-end' }}>
              <button className="sbtn2 pri">SAVE</button>
              <button className="sbtn2 sec" onClick={onClose}>CLOSE</button>
            </div>
          </div>
        )}
      </div>
    </ModalOverlay>
  )
}
