import { ModalOverlay, ModalHeader } from './ModalOverlay'
import { useState } from 'react'

interface Props { visible: boolean; onClose: () => void }

const inputStyle: React.CSSProperties = {
  background: '#0a121a', border: '1px solid #2a3a4a', color: 'var(--txt)',
  padding: '4px 8px', borderRadius: 2, fontFamily: 'var(--ff)', fontSize: 9
}

const tabs = ['FILTERS', 'DISPLAY', 'CLUSTER', 'APPEARANCE'] as const

export function LiqSettingsModal({ visible, onClose }: Props) {
  const [tab, setTab] = useState<typeof tabs[number]>('FILTERS')

  return (
    <ModalOverlay id="mliq" visible={visible} onClose={onClose}>
      <ModalHeader title="LIQ CHART SETTINGS" onClose={onClose} />

      <div style={{ padding: '12px 16px' }}>
        {/* Tabs */}
        <div className="qbs" style={{ marginBottom: 12 }}>
          {tabs.map(t => (
            <div key={t} className={`qb${tab === t ? ' act' : ''}`} onClick={() => setTab(t)}>{t}</div>
          ))}
        </div>

        {/* FILTERS tab */}
        {tab === 'FILTERS' && (
          <div>
            <div className="msec" style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 6 }}>Symbol Filter</div>
              <div className="qbs">
                <div className="qb act">BTC</div>
                <div className="qb">ETH</div>
                <div className="qb">SOL</div>
                <div className="qb">ALL</div>
              </div>
            </div>

            <div className="msec" style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 6 }}>Min Size USD</div>
              <div className="qbs">
                <div className="qb">OFF</div>
                <div className="qb">$500</div>
                <div className="qb act">$10K</div>
                <div className="qb">$100K</div>
                <div className="qb">$1M</div>
              </div>
            </div>

            <div className="msec" style={{ marginBottom: 10 }}>
              <div className="mrow">
                <span className="mlbl">Min Size BTC</span>
                <input type="range" min={0} max={100} defaultValue={1} style={{ flex: 1 }} />
              </div>
            </div>

            <div className="msec" style={{ marginBottom: 10 }}>
              <div className="mrow">
                <span className="mlbl">Time Window</span>
                <input type="range" min={1} max={1440} defaultValue={60} style={{ flex: 1 }} />
              </div>
              <div className="qbs" style={{ marginTop: 6 }}>
                <div className="qb">5m</div>
                <div className="qb">15m</div>
                <div className="qb act">1h</div>
                <div className="qb">4h</div>
                <div className="qb">24h</div>
              </div>
            </div>
          </div>
        )}

        {/* DISPLAY tab */}
        {tab === 'DISPLAY' && (
          <div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
              <label className="mchk"><input type="checkbox" defaultChecked /> Show Rectangles</label>
              <label className="mchk"><input type="checkbox" defaultChecked /> Show Labels</label>
              <label className="mchk"><input type="checkbox" defaultChecked /> Show Lines</label>
              <label className="mchk"><input type="checkbox" /> Show Zones</label>
              <label className="mchk"><input type="checkbox" /> Show Distance</label>
              <label className="mchk"><input type="checkbox" /> Show Executed</label>
            </div>
            <div className="msec" style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 6 }}>Label Format</div>
              <div className="qbs">
                <div className="qb act">USD</div>
                <div className="qb">BTC</div>
                <div className="qb">BOTH</div>
              </div>
            </div>
          </div>
        )}

        {/* CLUSTER tab */}
        {tab === 'CLUSTER' && (
          <div>
            <div className="msec" style={{ marginBottom: 10 }}>
              <div className="mrow">
                <span className="mlbl">Cluster Distance</span>
                <input type="range" min={1} max={100} defaultValue={20} style={{ flex: 1 }} />
              </div>
            </div>
            <div className="msec" style={{ marginBottom: 10 }}>
              <div className="mrow">
                <span className="mlbl">Min Cluster Size</span>
                <input type="range" min={1} max={50} defaultValue={3} style={{ flex: 1 }} />
              </div>
            </div>
            <div className="msec" style={{ marginBottom: 10 }}>
              <div className="mrow">
                <span className="mlbl">Lookback</span>
                <input type="number" defaultValue={100} style={{ ...inputStyle, width: 60 }} />
              </div>
            </div>
            <div className="msec" style={{ marginBottom: 10 }}>
              <div className="mrow">
                <span className="mlbl">Pivot</span>
                <input type="number" defaultValue={5} style={{ ...inputStyle, width: 60 }} />
              </div>
            </div>
            <div className="msec" style={{ marginBottom: 10 }}>
              <div className="mrow">
                <span className="mlbl">ATR</span>
                <input type="number" defaultValue={14} style={{ ...inputStyle, width: 60 }} />
              </div>
            </div>
            <div className="msec" style={{ marginBottom: 10 }}>
              <div className="mrow">
                <span className="mlbl">Band</span>
                <input type="number" defaultValue={2} step={0.1} style={{ ...inputStyle, width: 60 }} />
              </div>
            </div>
            <div className="msec" style={{ marginBottom: 10 }}>
              <div className="mrow">
                <span className="mlbl">Weight</span>
                <input type="number" defaultValue={1} step={0.1} style={{ ...inputStyle, width: 60 }} />
              </div>
            </div>
            <div className="msec" style={{ marginBottom: 10 }}>
              <div className="mrow">
                <span className="mlbl">Extend</span>
                <input type="number" defaultValue={50} style={{ ...inputStyle, width: 60 }} />
              </div>
            </div>
          </div>
        )}

        {/* APPEARANCE tab */}
        {tab === 'APPEARANCE' && (
          <div>
            <div className="msec" style={{ marginBottom: 10 }}>
              <div className="mrow">
                <span className="mlbl">Long Color</span>
                <input type="color" defaultValue="#00e676" style={{ width: 28, height: 20, border: 'none', background: 'none', cursor: 'pointer' }} />
              </div>
            </div>
            <div className="msec" style={{ marginBottom: 10 }}>
              <div className="mrow">
                <span className="mlbl">Short Color</span>
                <input type="color" defaultValue="#ff3355" style={{ width: 28, height: 20, border: 'none', background: 'none', cursor: 'pointer' }} />
              </div>
            </div>
            <div className="msec" style={{ marginBottom: 10 }}>
              <div className="mrow">
                <span className="mlbl">Rect Opacity</span>
                <input type="range" min={0} max={100} defaultValue={30} style={{ flex: 1 }} />
              </div>
            </div>
            <div className="msec" style={{ marginBottom: 10 }}>
              <div className="mrow">
                <span className="mlbl">Line Opacity</span>
                <input type="range" min={0} max={100} defaultValue={60} style={{ flex: 1 }} />
              </div>
            </div>
            <div className="msec" style={{ marginBottom: 10 }}>
              <div className="mrow">
                <span className="mlbl">Label Opacity</span>
                <input type="range" min={0} max={100} defaultValue={80} style={{ flex: 1 }} />
              </div>
            </div>

            <div style={{
              background: '#0d1018', border: '1px solid #1e2530', borderRadius: 4,
              padding: 8, fontSize: 8, color: 'var(--dim)', marginBottom: 12
            }}>
              Colors apply to the liquidation chart overlay. Long = green tones, Short = red tones.
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
