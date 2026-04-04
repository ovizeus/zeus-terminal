import { ModalOverlay, ModalHeader } from './ModalOverlay'
import { useState } from 'react'

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
                <span className="mlbl">Bucket Size</span>
                <input type="range" min={1} max={100} defaultValue={10} style={{ flex: 1 }} />
              </div>
            </div>
            <div className="msec" style={{ marginBottom: 10 }}>
              <div className="mrow">
                <span className="mlbl">Min Size</span>
                <input type="range" min={0} max={500} defaultValue={50} style={{ flex: 1 }} />
              </div>
            </div>
            <div className="msec" style={{ marginBottom: 10 }}>
              <div className="mrow">
                <span className="mlbl">Time Window</span>
                <select style={{
                  background: '#0a121a', border: '1px solid #2a3a4a', color: 'var(--txt)',
                  padding: '4px 8px', borderRadius: 2, fontFamily: 'var(--ff)', fontSize: 9
                }} defaultValue="60">
                  <option value="5">5 min</option>
                  <option value="15">15 min</option>
                  <option value="60">1 hour</option>
                  <option value="240">4 hours</option>
                  <option value="1440">24 hours</option>
                </select>
              </div>
            </div>
            <div className="msec" style={{ marginBottom: 10 }}>
              <label className="mchk"><input type="checkbox" defaultChecked /> Show Labels</label>
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
                <span className="mlbl">Max Bar Width</span>
                <input type="range" min={10} max={200} defaultValue={80} style={{ flex: 1 }} />
              </div>
            </div>
            <div className="msec" style={{ marginBottom: 10 }}>
              <div className="mrow">
                <span className="mlbl">Opacity</span>
                <input type="range" min={0} max={100} defaultValue={60} style={{ flex: 1 }} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="sbtn2 red">RESET</button>
              <button className="sbtn2 pri" style={{ background: '#f0c040', color: '#000' }}>SAVE</button>
            </div>
          </div>
        )}
      </div>
    </ModalOverlay>
  )
}
