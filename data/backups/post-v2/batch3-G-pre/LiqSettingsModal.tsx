import { ModalOverlay, ModalHeader } from './ModalOverlay'
import { useState } from 'react'
import { toast } from '../../data/marketDataHelpers'

const w = window as any
interface Props { visible: boolean; onClose: () => void }

const inputStyle: React.CSSProperties = {
  background: '#0a121a', border: '1px solid #2a3a4a', color: 'var(--txt)',
  padding: '4px 8px', borderRadius: 2, fontFamily: 'var(--ff)', fontSize: 9
}

const tabs = ['FILTERS', 'DISPLAY', 'CLUSTER', 'APPEARANCE'] as const

export function LiqSettingsModal({ visible, onClose }: Props) {
  const [tab, setTab] = useState<typeof tabs[number]>('FILTERS')
  const [symFilter, setSymFilter] = useState('BTC')
  const [minSize, setMinSize] = useState('$500')
  const [timeWindow, setTimeWindow] = useState('24h')
  const [labelFormat, setLabelFormat] = useState('$USD')

  function saveAndApply() {
    if (w.S) {
      w.S.liqSettings = w.S.liqSettings || {}
      w.S.liqSettings.symFilter = symFilter
      w.S.liqSettings.minSize = minSize
      w.S.liqSettings.timeWindow = timeWindow
      w.S.liqSettings.labelFormat = labelFormat
    }
    toast('Liq settings applied')
    onClose()
  }

  return (
    <ModalOverlay id="mliq" visible={visible} onClose={onClose} zIndex={9500}>
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
              <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 6 }}>SYMBOL FILTER</div>
              <div className="qbs">
                {['BTC', 'ETH', 'SOL', 'ALL'].map(s => (
                  <div key={s} className={`qb${symFilter === s ? ' act' : ''}`} onClick={() => setSymFilter(s)}>{s}</div>
                ))}
              </div>
            </div>

            <div className="msec" style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 6 }}>MIN SIZE (USD)</div>
              <div className="qbs">
                {['OFF', '$500', '$10K', '$100K', '$1M'].map(s => (
                  <div key={s} className={`qb${minSize === s ? ' act' : ''}`} onClick={() => setMinSize(s)}>{s}</div>
                ))}
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
                <input type="range" min={1} max={48} defaultValue={24} style={{ flex: 1 }} />
              </div>
              <div className="qbs" style={{ marginTop: 6 }}>
                {['1h', '6h', '12h', '24h', '48h'].map(t => (
                  <div key={t} className={`qb${timeWindow === t ? ' act' : ''}`} onClick={() => setTimeWindow(t)}>{t}</div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* DISPLAY tab */}
        {tab === 'DISPLAY' && (
          <div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
              <label className="mchk"><input type="checkbox" defaultChecked /> Liquidation Rectangles</label>
              <label className="mchk"><input type="checkbox" defaultChecked /> Size Labels ($USD)</label>
              <label className="mchk"><input type="checkbox" defaultChecked /> Level Lines</label>
              <label className="mchk"><input type="checkbox" defaultChecked /> Heatmap Zones</label>
              <label className="mchk"><input type="checkbox" defaultChecked /> % Distance to Price</label>
              <label className="mchk"><input type="checkbox" defaultChecked /> % Executed</label>
            </div>
            <div className="msec" style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 6 }}>LABEL FORMAT</div>
              <div className="qbs">
                {['$USD', 'BTC', 'BOTH'].map(f => (
                  <div key={f} className={`qb${labelFormat === f ? ' act' : ''}`} onClick={() => setLabelFormat(f)}>{f}</div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* CLUSTER tab */}
        {tab === 'CLUSTER' && (
          <div>
            <div className="msec" style={{ marginBottom: 10 }}>
              <div className="mrow"><span className="mlbl">Cluster Distance</span><input type="range" min={0.1} max={5} step={0.1} defaultValue={0.5} style={{ flex: 1 }} /></div>
            </div>
            <div className="msec" style={{ marginBottom: 10 }}>
              <div className="mrow"><span className="mlbl">Min Cluster Size (BTC)</span><input type="range" min={1} max={500} defaultValue={50} style={{ flex: 1 }} /></div>
            </div>
            <div className="msec" style={{ marginBottom: 10 }}>
              <div className="mrow"><span className="mlbl">Lookback Bars</span><input type="number" defaultValue={1000} min={100} max={5000} style={{ ...inputStyle, width: 60 }} /></div>
            </div>
            <div className="msec" style={{ marginBottom: 10 }}>
              <div className="mrow"><span className="mlbl">Pivot Width</span><input type="number" defaultValue={5} min={1} max={20} style={{ ...inputStyle, width: 60 }} /></div>
            </div>
            <div className="msec" style={{ marginBottom: 10 }}>
              <div className="mrow"><span className="mlbl">ATR Length</span><input type="number" defaultValue={121} min={10} max={500} style={{ ...inputStyle, width: 60 }} /></div>
            </div>
            <div className="msec" style={{ marginBottom: 10 }}>
              <div className="mrow"><span className="mlbl">ATR Band %</span><input type="number" defaultValue={0.5} step={0.1} min={0.1} max={5} style={{ ...inputStyle, width: 60 }} /></div>
            </div>
            <div className="msec" style={{ marginBottom: 10 }}>
              <div className="mrow"><span className="mlbl">Min Level Weight</span><input type="number" defaultValue={1} min={1} max={10} style={{ ...inputStyle, width: 60 }} /></div>
            </div>
            <div className="msec" style={{ marginBottom: 10 }}>
              <div className="mrow"><span className="mlbl">Extend Unhit Levels (bars)</span><input type="number" defaultValue={50} min={0} max={200} style={{ ...inputStyle, width: 60 }} /></div>
            </div>
          </div>
        )}

        {/* APPEARANCE tab */}
        {tab === 'APPEARANCE' && (
          <div>
            <div className="msec" style={{ marginBottom: 10 }}>
              <div className="mrow"><span className="mlbl">Long Liq Colors</span>
                <input type="color" defaultValue="#ff3355" style={{ width: 28, height: 20, border: 'none', background: 'none', cursor: 'pointer' }} />
                <input type="color" defaultValue="#ff0000" style={{ width: 28, height: 20, border: 'none', background: 'none', cursor: 'pointer' }} />
              </div>
            </div>
            <div className="msec" style={{ marginBottom: 10 }}>
              <div className="mrow"><span className="mlbl">Short Liq Colors</span>
                <input type="color" defaultValue="#00d97a" style={{ width: 28, height: 20, border: 'none', background: 'none', cursor: 'pointer' }} />
                <input type="color" defaultValue="#00ff44" style={{ width: 28, height: 20, border: 'none', background: 'none', cursor: 'pointer' }} />
              </div>
            </div>
            <div className="msec" style={{ marginBottom: 10 }}>
              <div className="mrow"><span className="mlbl">Rectangle Opacity</span><input type="range" min={10} max={100} defaultValue={80} style={{ flex: 1 }} /></div>
            </div>
            <div className="msec" style={{ marginBottom: 10 }}>
              <div className="mrow"><span className="mlbl">Line Opacity</span><input type="range" min={10} max={100} defaultValue={60} style={{ flex: 1 }} /></div>
            </div>
            <div className="msec" style={{ marginBottom: 10 }}>
              <div className="mrow"><span className="mlbl">Heatmap Opacity</span><input type="range" min={10} max={100} defaultValue={70} style={{ flex: 1 }} /></div>
            </div>

            <div style={{
              background: '#0d1018', border: '1px solid #f0c04022', borderRadius: 4,
              padding: 10, fontSize: 9, color: 'var(--dim)', lineHeight: 1.7, marginBottom: 12
            }}>
              <span style={{ color: '#ff3355' }}>Long Liqs</span>: Bulls liquidated → Price dropped<br />
              <span style={{ color: '#00d97a' }}>Short Liqs</span>: Bears liquidated → Price pumped<br />
              Heatmap Zones: Clusters at similar price levels<br />
              % Distance: How far price is from the cluster<br />
              % Executed: How much of the liq cluster was hit
            </div>

            <div className="srow" style={{ justifyContent: 'flex-end' }}>
              <button className="sbtn2 pri" onClick={saveAndApply}>SAVE &amp; APPLY</button>
              <button className="sbtn2 sec" onClick={onClose}>CLOSE</button>
            </div>
          </div>
        )}
      </div>
    </ModalOverlay>
  )
}
