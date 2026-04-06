import { ModalOverlay, ModalHeader } from './ModalOverlay'
import { useState } from 'react'

interface Props { visible: boolean; onClose: () => void }

const inputStyle: React.CSSProperties = {
  background: '#0a121a', border: '1px solid #2a3a4a', color: 'var(--txt)',
  padding: '4px 8px', borderRadius: 2, fontFamily: 'var(--ff)', fontSize: 9
}

const tabs = ['MAIN', 'SESSIONS', 'PIVOT', 'VWAP'] as const

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
              <label className="mchk"><input type="checkbox" defaultChecked id="zshh" /> HH — Higher High</label>
              <div className="mrow"><span className="mlbl">HH Color</span>
                <input type="color" defaultValue="#00d97a" id="zshhCol" style={{ width: 22, height: 16, border: 'none', background: 'none', cursor: 'pointer' }} /></div>
              <label className="mchk"><input type="checkbox" defaultChecked id="zshl" /> HL — Higher Low</label>
              <div className="mrow"><span className="mlbl">HL Color</span>
                <input type="color" defaultValue="#44aaff" id="zshlCol" style={{ width: 22, height: 16, border: 'none', background: 'none', cursor: 'pointer' }} /></div>
              <label className="mchk"><input type="checkbox" defaultChecked id="zslh" /> LH — Lower High</label>
              <div className="mrow"><span className="mlbl">LH Color</span>
                <input type="color" defaultValue="#ff8800" id="zslhCol" style={{ width: 22, height: 16, border: 'none', background: 'none', cursor: 'pointer' }} /></div>
              <label className="mchk"><input type="checkbox" defaultChecked id="zsll" /> LL — Lower Low</label>
              <div className="mrow"><span className="mlbl">LL Color</span>
                <input type="color" defaultValue="#ff3355" id="zsllCol" style={{ width: 22, height: 16, border: 'none', background: 'none', cursor: 'pointer' }} /></div>
            </div>

            {/* Nova Zones */}
            <div className="msec" style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 6 }}>NOVA ZONES</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label className="mchk"><input type="checkbox" defaultChecked id="zsShowZones" /> Show Zones</label>
                <label className="mchk"><input type="checkbox" id="zsExtendZones" /> Extend Zones</label>
              </div>
              <div className="mrow" style={{ marginTop: 6 }}>
                <span className="mlbl">Zone Width</span>
                <input type="number" defaultValue={6} min={1} max={20} id="zsZoneWidth" style={{ ...inputStyle, width: 50 }} />
              </div>
              <div className="mrow" style={{ marginTop: 6 }}>
                <span className="mlbl">Upper Zone Color</span>
                <input type="color" defaultValue="#00b8d4" id="zsUpperCol" style={{ width: 22, height: 16, border: 'none', background: 'none', cursor: 'pointer' }} />
              </div>
              <div className="mrow" style={{ marginTop: 6 }}>
                <span className="mlbl">Lower Zone Color</span>
                <input type="color" defaultValue="#aa44ff" id="zsLowerCol" style={{ width: 22, height: 16, border: 'none', background: 'none', cursor: 'pointer' }} />
              </div>
              <div className="mrow" style={{ marginTop: 6 }}>
                <span className="mlbl">Pivot Length</span>
                <input type="number" defaultValue={8} min={2} max={50} id="zsPivotLen" style={{ ...inputStyle, width: 50 }} />
              </div>
              <div className="mrow" style={{ marginTop: 6 }}>
                <span className="mlbl">Pivot Count</span>
                <input type="number" defaultValue={3} min={1} max={10} id="zsPivotCount" style={{ ...inputStyle, width: 50 }} />
              </div>
            </div>

            {/* Nova Pivot Detector */}
            <div className="msec" style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 6 }}>NOVA PIVOT DETECTOR</div>
              <div className="mrow"><span className="mlbl">Pivot Length</span>
                <input type="number" defaultValue={10} style={{ ...inputStyle, width: 50 }} /></div>
              <div className="mrow" style={{ marginTop: 6 }}><span className="mlbl">Max Pivots</span>
                <input type="number" defaultValue={3} style={{ ...inputStyle, width: 50 }} /></div>
              <div className="mrow" style={{ marginTop: 6 }}><span className="mlbl">Sensitivity</span>
                <input type="number" defaultValue={0.25} step={0.01} style={{ ...inputStyle, width: 50 }} /></div>
              <div className="mrow" style={{ marginTop: 6 }}><span className="mlbl">Strength Factor</span>
                <input type="number" defaultValue={5} style={{ ...inputStyle, width: 50 }} /></div>
            </div>

            {/* Signals */}
            <div className="msec" style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 6 }}>SIGNALS</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label className="mchk"><input type="checkbox" /> Channel Break Signals</label>
                <label className="mchk"><input type="checkbox" defaultChecked /> Pivot HH/LL Signals</label>
                <label className="mchk"><input type="checkbox" /> Open Signals</label>
                <label className="mchk"><input type="checkbox" /> Exit Signals</label>
              </div>
            </div>
          </div>
        )}

        {/* SESSIONS tab */}
        {tab === 'SESSIONS' && (
          <div>
            <div style={{ fontSize: 8, color: 'var(--dim)', marginBottom: 8 }}>Zones highlighted on chart during session hours (UTC)</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
              {[
                { abbr: 'ASI', name: 'Asia (23:00-06:00)', checked: true, color: '#ffffff15', badgeClass: 'z-badge z-badge--cyan' },
                { abbr: 'SYD', name: 'Sydney (23:00-05:00)', checked: false, color: '#6600cc33', badgeClass: 'z-badge z-badge--pur' },
                { abbr: 'TKY', name: 'Tokyo (00:00-06:00)', checked: true, color: '#ff44aa33', badgeStyle: { color: '#ff44aa', borderColor: '#ff44aa33', background: '#ff44aa12' } },
                { abbr: 'SHG', name: 'Shanghai (01:30-06:57)', checked: false, color: '#ffaa0033', badgeStyle: { color: '#ffaa00', borderColor: '#ffaa0033', background: '#ffaa0012' } },
                { abbr: 'FRA', name: 'Frankfurt (07:00-16:30)', checked: true, color: '#ffff0033', badgeClass: 'z-badge z-badge--gold' },
                { abbr: 'LON', name: 'London (08:00-16:30)', checked: true, color: '#0044ff44', badgeStyle: { color: '#4488ff', borderColor: '#4488ff33', background: '#4488ff12' } },
                { abbr: 'NYC', name: 'New York (13:00-22:00)', checked: true, color: '#00aa0033', badgeClass: 'z-badge z-badge--grn' },
                { abbr: 'NYSE', name: 'NYSE (14:30-22:00)', checked: false, color: '#00cc4422', badgeClass: 'z-badge z-badge--grn' },
              ].map(s => (
                <div key={s.abbr} className="mrow">
                  <span className="mlbl">
                    <span className={s.badgeClass || 'z-badge'} style={{ fontSize: 6, padding: '0 3px', ...(s.badgeStyle || {}) }}>{s.abbr}</span>{' '}
                    {s.name}
                  </span>
                  <label className="mchk" style={{ margin: 0 }}>
                    <input type="checkbox" defaultChecked={s.checked} /> ON
                  </label>
                  <input type="color" defaultValue={s.color} />
                </div>
              ))}
            </div>

            <div className="msec" style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 6 }}>LINE SETTINGS</div>
              <div className="mrow">
                <span className="mlbl">Line Length (min)</span>
                <input type="number" defaultValue={400} style={{ ...inputStyle, width: 60 }} />
              </div>
              <div className="mrow" style={{ marginTop: 6 }}>
                <span className="mlbl">Line Offset Right (min)</span>
                <input type="number" defaultValue={2000} style={{ ...inputStyle, width: 60 }} />
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
                <span className="mlbl">Pivot Label Lookback</span>
                <input type="number" defaultValue={4} style={{ ...inputStyle, width: 50 }} />
              </div>
              <div className="mrow" style={{ marginTop: 6 }}>
                <span className="mlbl">Active UP Color</span>
                <input type="color" defaultValue="#00b8d4" style={{ width: 22, height: 16, border: 'none', background: 'none', cursor: 'pointer' }} />
              </div>
              <div className="mrow" style={{ marginTop: 6 }}>
                <span className="mlbl">Active DOWN Color</span>
                <input type="color" defaultValue="#ff44aa" style={{ width: 22, height: 16, border: 'none', background: 'none', cursor: 'pointer' }} />
              </div>
              <div className="mrow" style={{ marginTop: 6 }}>
                <span className="mlbl">Line Width</span>
                <input type="number" defaultValue={2} min={1} max={5} style={{ ...inputStyle, width: 50 }} />
              </div>
              <div className="mrow" style={{ marginTop: 6 }}>
                <span className="mlbl">Style</span>
                <select style={inputStyle} defaultValue="Dashed">
                  <option value="Dashed">Dashed</option>
                  <option value="Solid">Solid</option>
                  <option value="Dotted">Dotted</option>
                </select>
              </div>
            </div>

            <div className="msec" style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 6 }}>ALPHA MAX LEVEL</div>
              <div className="mrow">
                <span className="mlbl">Timeframe</span>
                <select style={inputStyle} defaultValue="Day">
                  <option value="Day">Day</option>
                  <option value="Week">Week</option>
                  <option value="Month">Month</option>
                </select>
              </div>
              <label className="mchk"><input type="checkbox" defaultChecked /> Show Current Levels</label>
              <label className="mchk"><input type="checkbox" /> Show Previous Levels</label>
              <label className="mchk"><input type="checkbox" /> Show Extra Levels (3.5-6)</label>
              <div className="mrow" style={{ marginTop: 6 }}>
                <span className="mlbl">Label Offset (Bars)</span>
                <input type="number" defaultValue={3} style={{ ...inputStyle, width: 50 }} />
              </div>
            </div>
          </div>
        )}

        {/* VWAP tab */}
        {tab === 'VWAP' && (
          <div>
            <div className="msec" style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 6 }}>VWAP</div>
              <label className="mchk"><input type="checkbox" defaultChecked id="zsVwapD" /> Daily VWAP</label>
              <div className="mrow" style={{ marginTop: 6 }}>
                <span className="mlbl">Daily Color</span>
                <input type="color" defaultValue="#f0c040" id="zsVwapDc" style={{ width: 22, height: 16, border: 'none', background: 'none', cursor: 'pointer' }} />
              </div>
              <label className="mchk"><input type="checkbox" defaultChecked id="zsVwapW" /> Weekly VWAP</label>
              <div className="mrow" style={{ marginTop: 6 }}>
                <span className="mlbl">Weekly Color</span>
                <input type="color" defaultValue="#00d97a" id="zsVwapWc" style={{ width: 22, height: 16, border: 'none', background: 'none', cursor: 'pointer' }} />
              </div>
              <label className="mchk"><input type="checkbox" id="zsVwapM" /> Monthly VWAP</label>
              <div className="mrow" style={{ marginTop: 6 }}>
                <span className="mlbl">Monthly Color</span>
                <input type="color" defaultValue="#aa44ff" id="zsVwapMc" style={{ width: 22, height: 16, border: 'none', background: 'none', cursor: 'pointer' }} />
              </div>
              <div className="mrow" style={{ marginTop: 6 }}>
                <span className="mlbl">VWAP Line Width</span>
                <input type="number" defaultValue={1} min={1} max={4} style={{ ...inputStyle, width: 50 }} />
              </div>
              <label className="mchk"><input type="checkbox" defaultChecked /> Show in Status Line</label>
            </div>

            <div className="srow" style={{ justifyContent: 'flex-end' }}>
              <button className="sbtn2 pri" onClick={() => { (window as any).applyZS?.(); onClose() }}>SAVE &amp; APPLY</button>
              <button className="sbtn2 sec" onClick={onClose}>CLOSE</button>
            </div>
          </div>
        )}
      </div>
    </ModalOverlay>
  )
}
