import { useState } from 'react'
import { ModalOverlay, ModalHeader } from './ModalOverlay'

interface Props { visible: boolean; onClose: () => void }

const inputStyle: React.CSSProperties = { background:'#0a121a', border:'1px solid #2a3a4a', color:'var(--txt)', padding:'4px 8px', borderRadius:'2px', fontFamily:'var(--ff)', fontSize:'9px', width:'100%' }

export function SettingsHubModal({ visible, onClose }: Props) {
  const [tab, setTab] = useState('general')

  return (
    <ModalOverlay id="msettings" visible={visible} onClose={onClose} maxWidth="500px">
      <ModalHeader title="SETTINGS HUB" onClose={onClose} />

      <div className="mtabs">
        <div className={`mtab${tab==='general'?' act':''}`} onClick={()=>setTab('general')}>GENERAL</div>
        <div className={`mtab${tab==='alerts'?' act':''}`} onClick={()=>setTab('alerts')}>ALERTS</div>
        <div className={`mtab${tab==='telegram'?' act':''}`} onClick={()=>setTab('telegram')}>TELEGRAM</div>
        <div className={`mtab${tab==='exchange'?' act':''}`} onClick={()=>setTab('exchange')}>EXCHANGE API</div>
        <div className={`mtab${tab==='developer'?' act':''}`} onClick={()=>setTab('developer')}>DEVELOPER</div>
        <div className={`mtab${tab==='security'?' act':''}`} onClick={()=>setTab('security')}>CONT &amp; SECURITY</div>
      </div>

      {/* GENERAL TAB */}
      <div className="mbody" style={{display:tab==='general'?'block':'none', padding:'12px'}}>
        <div style={{fontSize:'9px',color:'var(--dim)',marginBottom:'6px',textTransform:'uppercase',letterSpacing:'1px'}}>Cloud Sync</div>
        <div className="mrow"><span className="mlbl">Email</span><input type="text" placeholder="email@example.com" style={inputStyle} /></div>
        <div style={{display:'flex', gap:'4px', marginTop:'6px'}}>
          <button className="hub-sbtn">SAVE</button>
          <button className="hub-sbtn">LOAD</button>
          <button className="hub-sbtn">CLEAR</button>
        </div>

        <div style={{marginTop:'10px'}}>
          <label className="mchk"><input type="checkbox" defaultChecked /> Notifications</label>
          <label className="mchk"><input type="checkbox" /> Developer Mode</label>
        </div>

        <div style={{marginTop:'10px'}}>
          <div className="mrow">
            <span className="mlbl">Appearance</span>
            <select style={inputStyle} defaultValue="obsidian">
              <option value="obsidian">Obsidian</option>
              <option value="onyx">Onyx</option>
              <option value="ivory">Ivory</option>
            </select>
          </div>
          <div className="mrow">
            <span className="mlbl">UI Scale</span>
            <select style={inputStyle} defaultValue="1.0">
              <option value="0.9">0.9x</option>
              <option value="1.0">1.0x</option>
              <option value="1.1">1.1x</option>
              <option value="1.2">1.2x</option>
              <option value="1.3">1.3x</option>
              <option value="1.4">1.4x</option>
              <option value="1.5">1.5x</option>
            </select>
          </div>
        </div>
      </div>

      {/* ALERTS TAB */}
      <div className="mbody" style={{display:tab==='alerts'?'block':'none', padding:'12px'}}>
        <button className="hub-sbtn pri" style={{width:'100%',marginBottom:'10px'}}>Open Full Alerts Panel</button>

        <div style={{fontSize:'9px',color:'var(--dim)',marginBottom:'6px',textTransform:'uppercase',letterSpacing:'1px'}}>Alert Triggers</div>
        <label className="mchk"><input type="checkbox" defaultChecked /> Master Enable</label>
        <label className="mchk"><input type="checkbox" defaultChecked /> Volume Spike</label>
        <label className="mchk"><input type="checkbox" defaultChecked /> Whale Activity</label>
        <label className="mchk"><input type="checkbox" defaultChecked /> Liquidation Cascade</label>
        <label className="mchk"><input type="checkbox" /> Divergence</label>
        <label className="mchk"><input type="checkbox" /> RSI Extreme</label>

        <div style={{fontSize:'9px',color:'var(--dim)',marginTop:'10px',marginBottom:'6px',textTransform:'uppercase',letterSpacing:'1px'}}>Thresholds</div>
        <div className="mrow"><span className="mlbl">Whale Min ($)</span><input type="number" defaultValue={100000} style={inputStyle} /></div>
        <div className="mrow"><span className="mlbl">Liq Min ($)</span><input type="number" defaultValue={50000} style={inputStyle} /></div>
      </div>

      {/* TELEGRAM TAB */}
      <div className="mbody" style={{display:tab==='telegram'?'block':'none', padding:'12px'}}>
        <div className="mrow"><span className="mlbl">Bot Token</span><input type="password" placeholder="Enter bot token" style={inputStyle} /></div>
        <div className="mrow"><span className="mlbl">Chat ID</span><input type="password" placeholder="Enter chat ID" style={inputStyle} /></div>

        <div style={{display:'flex', gap:'4px', marginTop:'8px'}}>
          <button className="hub-sbtn pri">SAVE</button>
          <button className="hub-sbtn">TEST</button>
        </div>

        <div style={{marginTop:'12px', padding:'8px', background:'#0a121a', border:'1px solid #2a3a4a', borderRadius:'2px', fontSize:'9px', color:'var(--dim)', lineHeight:'1.5'}}>
          <strong style={{color:'var(--txt)'}}>How to set up:</strong><br/>
          1. Message @BotFather on Telegram<br/>
          2. Send /newbot and follow instructions<br/>
          3. Copy the bot token here<br/>
          4. Start a chat with your bot<br/>
          5. Get your Chat ID from @userinfobot<br/>
          6. Paste the Chat ID above and click TEST
        </div>
      </div>

      {/* EXCHANGE API TAB */}
      <div className="mbody" style={{display:tab==='exchange'?'block':'none', padding:'12px'}}>
        <div style={{padding:'6px 8px', background:'#0a121a', border:'1px solid #2a3a4a', borderRadius:'2px', fontSize:'9px', color:'var(--dim)', marginBottom:'10px'}}>
          Status: <span style={{color:'#ff9800'}}>Loading...</span>
        </div>

        <div className="mrow">
          <span className="mlbl">Exchange</span>
          <select style={inputStyle} defaultValue="binance_futures">
            <option value="binance_futures">Binance Futures</option>
          </select>
        </div>
        <div className="mrow"><span className="mlbl">API Key</span><input type="password" placeholder="Enter API key" style={inputStyle} /></div>
        <div className="mrow"><span className="mlbl">API Secret</span><input type="password" placeholder="Enter API secret" style={inputStyle} /></div>

        <div style={{marginTop:'8px'}}>
          <div style={{fontSize:'9px',color:'var(--dim)',marginBottom:'4px',textTransform:'uppercase',letterSpacing:'1px'}}>Mode</div>
          <div className="qbs">
            <button className="qb act">LIVE</button>
            <button className="qb">TESTNET</button>
          </div>
        </div>

        <div style={{marginTop:'8px', padding:'6px', background:'#1a0a0a', border:'1px solid #3a1a1a', borderRadius:'2px', fontSize:'8px', color:'#ff6666'}}>
          Security: API keys are encrypted and stored locally. Never share your keys.
        </div>

        <button className="hub-sbtn pri" style={{width:'100%',marginTop:'8px'}}>VERIFY &amp; SAVE</button>

        <div style={{marginTop:'10px', padding:'6px 8px', background:'#0a121a', border:'1px solid #2a3a4a', borderRadius:'2px', fontSize:'9px', color:'var(--dim)'}}>
          <div style={{marginBottom:'4px'}}>Connected: <span style={{color:'var(--dim)'}}>—</span></div>
          <div style={{display:'flex', gap:'4px'}}>
            <button className="hub-sbtn">Re-verify</button>
            <button className="hub-sbtn">Disconnect</button>
          </div>
        </div>
      </div>

      {/* DEVELOPER TAB */}
      <div className="mbody" style={{display:tab==='developer'?'block':'none', padding:'12px'}}>
        <label className="mchk"><input type="checkbox" /> Developer Mode</label>

        <div style={{fontSize:'9px',color:'var(--dim)',marginTop:'10px',marginBottom:'6px',textTransform:'uppercase',letterSpacing:'1px'}}>Dev Log Actions</div>
        <div style={{display:'flex', gap:'4px'}}>
          <button className="hub-sbtn">CLEAR</button>
          <button className="hub-sbtn">EXPORT</button>
        </div>

        <div style={{fontSize:'9px',color:'var(--dim)',marginTop:'10px',marginBottom:'6px',textTransform:'uppercase',letterSpacing:'1px'}}>ZLOG</div>
        <div style={{padding:'6px 8px', background:'#0a121a', border:'1px solid #2a3a4a', borderRadius:'2px', fontSize:'9px', color:'var(--dim)', marginBottom:'6px'}}>
          <div>Entries: <span style={{color:'var(--txt)'}}>0</span></div>
          <div>Errors: <span style={{color:'#ff1744'}}>0</span> | Warns: <span style={{color:'#ff9800'}}>0</span> | Info: <span style={{color:'#4fc3f7'}}>0</span></div>
        </div>
        <div style={{display:'flex', gap:'4px'}}>
          <button className="hub-sbtn">COPY</button>
          <button className="hub-sbtn">EXPORT</button>
          <button className="hub-sbtn">CLEAR</button>
        </div>

        <div style={{fontSize:'9px',color:'var(--dim)',marginTop:'10px',marginBottom:'6px',textTransform:'uppercase',letterSpacing:'1px'}}>Build Info</div>
        <div style={{padding:'6px 8px', background:'#0a121a', border:'1px solid #2a3a4a', borderRadius:'2px', fontSize:'8px', color:'var(--dim)'}}>
          Version: — | Build: — | Env: —
        </div>
      </div>

      {/* CONT & SECURITY TAB */}
      <div className="mbody" style={{display:tab==='security'?'block':'none', padding:'12px'}}>
        {/* PIN Lock */}
        <div style={{fontSize:'9px',color:'var(--dim)',marginBottom:'6px',textTransform:'uppercase',letterSpacing:'1px'}}>PIN Lock</div>
        <div style={{padding:'6px 8px', background:'#0a121a', border:'1px solid #2a3a4a', borderRadius:'2px', fontSize:'9px', color:'var(--dim)', marginBottom:'6px'}}>
          Status: <span style={{color:'#ff9800'}}>Inactive</span>
        </div>
        <div className="mrow"><span className="mlbl">PIN</span><input type="password" placeholder="Enter PIN" maxLength={6} style={inputStyle} /></div>
        <div className="mrow"><span className="mlbl">Confirm</span><input type="password" placeholder="Confirm PIN" maxLength={6} style={inputStyle} /></div>
        <div style={{display:'flex', gap:'4px', marginTop:'4px'}}>
          <button className="hub-sbtn pri">ACTIVATE</button>
          <button className="hub-sbtn">DEACTIVATE</button>
        </div>

        {/* Change Password */}
        <div style={{fontSize:'9px',color:'var(--dim)',marginTop:'12px',marginBottom:'6px',textTransform:'uppercase',letterSpacing:'1px'}}>Change Password</div>
        <div className="mrow"><span className="mlbl">Current</span><input type="password" placeholder="Current password" style={inputStyle} /></div>
        <div className="mrow"><span className="mlbl">New</span><input type="password" placeholder="New password" style={inputStyle} /></div>
        <div className="mrow"><span className="mlbl">Confirm</span><input type="password" placeholder="Confirm new password" style={inputStyle} /></div>
        <button className="hub-sbtn" style={{marginTop:'4px'}}>SEND CODE</button>

        {/* Change Email */}
        <div style={{fontSize:'9px',color:'var(--dim)',marginTop:'12px',marginBottom:'6px',textTransform:'uppercase',letterSpacing:'1px'}}>Change Email</div>
        <div className="mrow"><span className="mlbl">New Email</span><input type="text" placeholder="New email" style={inputStyle} /></div>
        <div className="mrow"><span className="mlbl">Password</span><input type="password" placeholder="Current password" style={inputStyle} /></div>
        <button className="hub-sbtn" style={{marginTop:'4px'}}>SEND CODE</button>

        {/* Account Info */}
        <div style={{fontSize:'9px',color:'var(--dim)',marginTop:'12px',marginBottom:'6px',textTransform:'uppercase',letterSpacing:'1px'}}>Account Info</div>
        <div style={{padding:'6px 8px', background:'#0a121a', border:'1px solid #2a3a4a', borderRadius:'2px', fontSize:'9px', color:'var(--dim)'}}>
          <div>Email: <span style={{color:'var(--txt)'}}>—</span></div>
          <div>Role: <span style={{color:'var(--txt)'}}>—</span></div>
        </div>

        {/* Close Account */}
        <div style={{fontSize:'9px',color:'#ff1744',marginTop:'12px',marginBottom:'6px',textTransform:'uppercase',letterSpacing:'1px'}}>Danger Zone — Close Account</div>
        <div style={{padding:'8px', background:'#1a0a0a', border:'1px solid #3a1a1a', borderRadius:'2px'}}>
          <div className="mrow"><span className="mlbl" style={{color:'#ff6666'}}>Password</span><input type="password" placeholder="Confirm password" style={inputStyle} /></div>
          <button className="hub-sbtn" style={{marginTop:'4px', background:'#3a1a1a', color:'#ff1744', border:'1px solid #ff1744'}}>SEND CODE</button>
        </div>
      </div>

      {/* Bottom row */}
      <div style={{display:'flex', gap:'4px', padding:'8px 12px', borderTop:'1px solid #1e2a3a', justifyContent:'flex-end'}}>
        <button className="hub-sbtn pri">SAVE ALL</button>
        <button className="hub-sbtn">LOAD SAVED</button>
        <button className="hub-sbtn">RESET DEFAULTS</button>
        <button className="hub-sbtn" onClick={onClose}>CLOSE</button>
      </div>
    </ModalOverlay>
  )
}
