import { useState } from 'react'
import { ModalOverlay, ModalHeader } from './ModalOverlay'

interface Props { visible: boolean; onClose: () => void }

const inputStyle: React.CSSProperties = { background:'#0a121a', border:'1px solid #2a3a4a', color:'var(--txt)', padding:'4px 8px', borderRadius:'2px', fontFamily:'var(--ff)', fontSize:'9px', width:'100%' }
const colorStyle: React.CSSProperties = { ...inputStyle, padding:'2px', height:'24px', cursor:'pointer' }

export function SRSettingsModal({ visible, onClose }: Props) {
  const [tab, setTab] = useState('main')

  return (
    <ModalOverlay id="msr" visible={visible} onClose={onClose}>
      <ModalHeader title="ZEUS S/R SETTINGS" onClose={onClose} />

      <div className="mtabs">
        <div className={`mtab${tab==='main'?' act':''}`} onClick={()=>setTab('main')}>MAIN</div>
        <div className={`mtab${tab==='style'?' act':''}`} onClick={()=>setTab('style')}>STYLE</div>
        <div className={`mtab${tab==='filter'?' act':''}`} onClick={()=>setTab('filter')}>FILTER</div>
      </div>

      {/* MAIN TAB */}
      <div className="mbody" style={{display:tab==='main'?'block':'none', padding:'12px'}}>
        <label className="mchk"><input type="checkbox" defaultChecked /> Enable S/R</label>

        <div style={{marginTop:'10px'}}>
          <label className="mchk"><input type="checkbox" defaultChecked /> Show Support</label>
          <label className="mchk"><input type="checkbox" defaultChecked /> Show Resistance</label>
          <label className="mchk"><input type="checkbox" defaultChecked /> Show Labels</label>
          <label className="mchk"><input type="checkbox" defaultChecked /> Width by Strength</label>
          <label className="mchk"><input type="checkbox" /> Extend Lines</label>
        </div>

        <div style={{marginTop:'10px'}}>
          <div className="mrow"><span className="mlbl">Pivot Length</span><input type="number" defaultValue={10} style={inputStyle} /></div>
          <div className="mrow"><span className="mlbl">Max Levels</span><input type="number" defaultValue={8} style={inputStyle} /></div>
          <div className="mrow"><span className="mlbl">Min Strength</span><input type="number" defaultValue={2} style={inputStyle} /></div>
          <div className="mrow"><span className="mlbl">Zone Width ($)</span><input type="number" defaultValue={150} min={10} max={2000} style={inputStyle} /></div>
        </div>

        <div style={{marginTop:'10px'}}>
          <div className="mrow"><span className="mlbl">Timeframe</span></div>
          <div className="qbs" style={{marginTop:'4px'}}>
            <button className="qb act">AUTO</button>
            <button className="qb">1H</button>
            <button className="qb">4H</button>
            <button className="qb">1D</button>
            <button className="qb">1W</button>
          </div>
        </div>
      </div>

      {/* STYLE TAB */}
      <div className="mbody" style={{display:tab==='style'?'block':'none', padding:'12px'}}>
        <div className="mrow"><span className="mlbl">Support Color</span><input type="color" defaultValue="#00d97a" style={colorStyle} /></div>
        <div className="mrow"><span className="mlbl">Resistance Color</span><input type="color" defaultValue="#ff3355" style={colorStyle} /></div>
        <div className="mrow"><span className="mlbl">Line Opacity</span><input type="range" min={0} max={100} defaultValue={70} style={{width:'100%'}} /></div>
        <div className="mrow"><span className="mlbl">Zone Opacity</span><input type="range" min={0} max={100} defaultValue={20} style={{width:'100%'}} /></div>
        <div className="mrow"><span className="mlbl">Min Width</span><input type="number" defaultValue={1} style={inputStyle} /></div>
        <div className="mrow"><span className="mlbl">Max Width</span><input type="number" defaultValue={4} style={inputStyle} /></div>
      </div>

      {/* FILTER TAB */}
      <div className="mbody" style={{display:tab==='filter'?'block':'none', padding:'12px'}}>
        <div className="mrow"><span className="mlbl">Min Volume</span><input type="range" min={0} max={100} defaultValue={0} style={{width:'100%'}} /></div>

        <label className="mchk"><input type="checkbox" defaultChecked /> Show Touched</label>
        <label className="mchk"><input type="checkbox" /> Hide Weak</label>

        <div style={{marginTop:'10px'}}>
          <div className="mrow"><span className="mlbl">Display Period</span></div>
          <div className="qbs" style={{marginTop:'4px'}}>
            <button className="qb act">Session</button>
            <button className="qb">Today</button>
            <button className="qb">This Week</button>
            <button className="qb">All Time</button>
          </div>
        </div>

        <div style={{marginTop:'12px', display:'flex', gap:'6px', justifyContent:'flex-end'}}>
          <button className="hub-sbtn pri">SAVE</button>
          <button className="hub-sbtn" onClick={onClose}>CLOSE</button>
        </div>
      </div>
    </ModalOverlay>
  )
}
