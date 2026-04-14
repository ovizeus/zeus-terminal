import { useState, useEffect } from 'react'
import { ModalOverlay, ModalHeader } from './ModalOverlay'
import { useUiStore } from '../../stores'
import { pinActivate, pinRemove } from '../../core/bootstrapMisc'
import { hubCloudSave, hubCloudLoad, hubCloudClear, hubSaveAll, hubLoadAll, hubResetDefaults, hubTgSave, hubTgTest, setUiScale, hubToggleDev, devClearLog, devExportLog } from '../../utils/dev'
import { zeusApplyTheme } from '../../ui/theme'

const w = window as any

interface Props { visible: boolean; onClose: () => void }

const inp: React.CSSProperties = { flex:1, background:'#0a121a', border:'1px solid #2a3a4a', color:'var(--txt)', padding:'4px 8px', borderRadius:'2px', fontFamily:'var(--ff)', fontSize:'9px' }
const pinInp: React.CSSProperties = { flex:1, maxWidth:'140px', background:'#0a121a', border:'1px solid #2a3a4a', color:'var(--txt)', padding:'5px 8px', borderRadius:'4px', fontFamily:'var(--ff)', fontSize:'12px', textAlign:'center', letterSpacing:'3px' }
const codeInp: React.CSSProperties = { flex:1, maxWidth:'120px', background:'#0a121a', border:'1px solid #00afff44', color:'#00ff88', padding:'6px 10px', borderRadius:'4px', fontFamily:'var(--ff)', fontSize:'14px', textAlign:'center', letterSpacing:'4px' }
const dangerCodeInp: React.CSSProperties = { flex:1, maxWidth:'120px', background:'#0a121a', border:'1px solid #ff444444', color:'#ff6655', padding:'6px 10px', borderRadius:'4px', fontFamily:'var(--ff)', fontSize:'14px', textAlign:'center', letterSpacing:'4px' }

async function apiFetch(url: string, body: Record<string, string>) {
  const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return r.json()
}

function setMsg(id: string, text: string, ok: boolean) {
  const el = document.getElementById(id)
  if (el) { el.textContent = text; el.style.color = ok ? '#00d97a' : '#ff5566' }
}

function showEl(id: string, show: boolean) {
  const el = document.getElementById(id)
  if (el) el.style.display = show ? 'block' : 'none'
}

function val(id: string) {
  return (document.getElementById(id) as HTMLInputElement)?.value || ''
}

export function SettingsHubModal({ visible, onClose }: Props) {
  const [tab, setTab] = useState('general')
  const openModal = useUiStore((s) => s.openModal)
  type ExInfo = { connected: boolean; mode: 'live'|'testnet'; maskedKey: string; balance: number; lastVerified: string }
  const [exAccounts, setExAccounts] = useState<Record<string, ExInfo>>({})
  const [exModeFor, setExModeFor] = useState<Record<string, 'live'|'testnet'>>({ binance: 'testnet', bybit: 'testnet' })
  const [exLoadingFor, setExLoadingFor] = useState<Record<string, boolean>>({})
  const [exMsgFor, setExMsgFor] = useState<Record<string, {text: string; ok: boolean}>>({})

  useEffect(() => {
    if (tab !== 'exchange') return
    fetch('/api/exchange/status', { credentials: 'same-origin' })
      .then(r => r.json())
      .then(d => {
        if (!d.ok) return
        const map: Record<string, ExInfo> = {}
        for (const a of (d.accounts || [])) {
          map[a.exchange] = { connected: true, mode: a.mode, maskedKey: a.maskedKey, balance: 0, lastVerified: a.lastVerified }
        }
        setExAccounts(map)
      })
      .catch(() => {})
  }, [tab])

  function exSetMsg(ex: string, text: string, ok: boolean) { setExMsgFor(p => ({ ...p, [ex]: { text, ok } })) }

  async function exSave(ex: string) {
    setExLoadingFor(p => ({ ...p, [ex]: true }))
    const r = await apiFetch('/api/exchange/save', { apiKey: val(`${ex}ApiKey`), apiSecret: val(`${ex}ApiSecret`), mode: exModeFor[ex] || 'testnet', exchange: ex })
    setExLoadingFor(p => ({ ...p, [ex]: false }))
    exSetMsg(ex, r.ok ? `✓ Conectat! Balance: $${(r.balance||0).toFixed(2)}` : (r.error || 'Eroare'), !!r.ok)
    if (r.ok) setExAccounts(p => ({ ...p, [ex]: { connected: true, mode: r.mode, maskedKey: r.maskedKey, balance: r.balance, lastVerified: r.lastVerified } }))
  }

  async function exVerify(ex: string) {
    const r = await apiFetch('/api/exchange/verify', { exchange: ex })
    exSetMsg(ex, r.ok ? `✓ Verificat! Balance: $${(r.balance||0).toFixed(2)}` : (r.error || 'Eroare'), !!r.ok)
    if (r.ok) setExAccounts(p => ({ ...p, [ex]: { ...p[ex], balance: r.balance, lastVerified: r.lastVerified } }))
  }

  async function exDisconnect(ex: string) {
    if (!confirm(`Deconectezi ${ex}?`)) return
    const r = await apiFetch('/api/exchange/disconnect', { exchange: ex })
    if (r.ok) setExAccounts(p => { const n = { ...p }; delete n[ex]; return n })
    else exSetMsg(ex, r.error || 'Eroare', false)
  }

  async function chpwRequest() {
    const r = await apiFetch('/auth/change-password/request', { currentPassword: val('chpwCurrent') })
    setMsg('chpw-msg', r.message || r.error || '', !!r.ok)
    if (r.ok) { showEl('chpw-code-form', true); showEl('chpw-form', false) }
  }

  async function chpwConfirm() {
    const r = await apiFetch('/auth/change-password/confirm', { code: val('chpwCode'), newPassword: val('chpwNew') })
    setMsg('chpw-code-msg', r.message || r.error || '', !!r.ok)
    if (r.ok) setTimeout(() => { showEl('chpw-code-form', false); showEl('chpw-form', true) }, 1500)
  }

  async function chemRequest() {
    const r = await apiFetch('/auth/change-email/request', { currentPassword: val('chemPassword'), newEmail: val('chemNewEmail') })
    setMsg('chem-msg', r.message || r.error || '', !!r.ok)
    if (r.ok) { showEl('chem-code-form', true); showEl('chem-form', false) }
  }

  async function chemConfirm() {
    const r = await apiFetch('/auth/change-email/confirm', { code: val('chemCode') })
    setMsg('chem-code-msg', r.message || r.error || '', !!r.ok)
    if (r.ok) setTimeout(() => { showEl('chem-code-form', false); showEl('chem-form', true) }, 1500)
  }

  async function clacRequest() {
    const r = await apiFetch('/auth/close-account/request', { currentPassword: val('clacPassword') })
    setMsg('clac-msg', r.message || r.error || '', !!r.ok)
    if (r.ok) { showEl('clac-code-form', true); showEl('clac-form', false) }
  }

  async function clacConfirm() {
    const r = await apiFetch('/auth/close-account/confirm', { code: val('clacCode') })
    setMsg('clac-code-msg', r.message || r.error || '', !!r.ok)
    if (r.ok) setTimeout(() => {
      try { localStorage.clear() } catch {}
      try { sessionStorage.clear() } catch {}
      window.location.href = '/login.html'
    }, 1500)
  }

  return (
    <ModalOverlay id="msettings" visible={visible} onClose={onClose} maxWidth="500px">
      <ModalHeader title="SETTINGS HUB" onClose={onClose} />

      <div className="mtabs" id="settings-tabs" style={{ flex: 'none' }}>
        <div className={`mtab${tab==='general'?' act':''}`} onClick={()=>setTab('general')}>GENERAL</div>
        <div className={`mtab${tab==='alerts'?' act':''}`} onClick={()=>setTab('alerts')}>ALERTS</div>
        <div className={`mtab${tab==='telegram'?' act':''}`} onClick={()=>setTab('telegram')}>TELEGRAM</div>
        <div className={`mtab${tab==='exchange'?' act':''}`} onClick={()=>setTab('exchange')}>EXCHANGE API</div>
        <div className={`mtab${tab==='developer'?' act':''}`} onClick={()=>setTab('developer')}>DEVELOPER</div>
        <div className={`mtab${tab==='security'?' act':''}`} onClick={()=>setTab('security')}><svg className="z-i" viewBox="0 0 16 16"><path d="M5 7V5a3 3 0 016 0v2M4 7h8v7H4z" /></svg> CONT &amp; SECURITY</div>
      </div>

      {/* ══ GENERAL ══ */}
      <div className={`mbody${tab==='general'?' act':''}`} id="set-general" style={{display:tab==='general'?'block':'none'}}>
        <div className="msec">CLOUD SYNC</div>
        <div className="mrow"><span className="mlbl">Email</span><input type="email" id="hubCloudEmail" placeholder="your@email.com" style={inp} /></div>
        <div style={{display:'flex',gap:'4px',marginTop:'6px'}}>
          <button className="hub-sbtn pri" onClick={() => hubCloudSave?.()}><svg className="z-i" viewBox="0 0 16 16"><path d="M4 2h5l3 3v9H4V2zm5 0v3h3M6 9h4m-4 2h3" /></svg> Save to Cloud</button>
          <button className="hub-sbtn" onClick={() => hubCloudLoad?.()}><svg className="z-i" viewBox="0 0 16 16"><path d="M8 2v8m-3-3l3 3 3-3M3 14h10" /></svg> Load</button>
          <button className="hub-sbtn" style={{borderColor:'#ff335533',color:'#ff6655'}} onClick={() => hubCloudClear?.()}><svg className="z-i" viewBox="0 0 16 16"><path d="M3 4h10M6 2h4v2M5 4v9h6V4m-4 2v5m2-5v5" /></svg> Clear</button>
        </div>
        <div className="msec">NOTIFICATIONS</div>
        <label className="mchk"><input type="checkbox" id="hubNotifyEnabled" defaultChecked onChange={(e) => { if (w.S?.alerts) w.S.alerts.enabled = e.target.checked }} /> Enable alerts &amp; notifications</label>
        <div className="msec">DEVELOPER MODE</div>
        <label className="mchk"><input type="checkbox" id="hubDevEnabled" onChange={(e) => hubToggleDev(e.target.checked)} /> Enable Developer Mode panel</label>
        <div className="hub-disabled-notice">Developer panel appears in Market Intelligence when enabled.</div>
        <div className="msec">APPEARANCE</div>
        <div className="mrow" style={{display:'flex',alignItems:'center',gap:'8px'}}>
          <span className="mlbl" style={{flex:'0 0 70px'}}>Theme</span>
          <select id="themeSelect" style={{flex:1,background:'var(--sf-input,#0a121a)',border:'1px solid var(--brd)',color:'var(--whi)',padding:'6px 8px',borderRadius:'var(--r-sm)',fontFamily:'var(--ff)',fontSize:'10px'}} defaultValue="native" onChange={(e) => zeusApplyTheme?.(e.target.value)}>
            <option value="native">⬛ Obsidian</option>
            <option value="dark">🌑 Onyx</option>
            <option value="light">☀️ Ivory</option>
          </select>
        </div>
        <div className="msec">UI SCALE</div>
        <div className="mrow"><span className="mlbl">Interface size</span>
          <select id="hubUiScale" style={{flex:1,maxWidth:'90px',background:'#0a121a',border:'1px solid #2a3a4a',color:'var(--txt)',padding:'4px 8px',borderRadius:'2px',fontFamily:'var(--ff)',fontSize:'9px'}} defaultValue="1" onChange={(e) => setUiScale?.(e.target.value)}>
            <option value="0.9">0.9×</option>
            <option value="1">1.0×</option>
            <option value="1.1">1.1×</option>
            <option value="1.2">1.2×</option>
            <option value="1.3">1.3×</option>
            <option value="1.5">1.5×</option>
          </select>
        </div>
      </div>

      {/* ══ CONT & SECURITY ══ */}
      <div className="mbody" id="set-account" style={{display:tab==='security'?'block':'none'}}>
        <div className="msec">APP LOCK (PIN)</div>
        <div style={{fontSize:'10px',color:'#556',marginBottom:'8px',lineHeight:'1.6'}}>
          Protejează terminalul cu un PIN local. La fiecare deschidere a aplicației, vei fi întrebat PIN-ul înainte să vezi datele.
        </div>
        <div className="mrow"><span className="mlbl">Status</span>
          <span id="pinStatus" style={{fontSize:'11px',color:'#556',fontWeight:700}}>DEZACTIVAT</span>
        </div>
        <div id="pinSetupForm">
          <div className="mrow" style={{marginBottom:'6px'}}>
            <span className="mlbl">PIN (4–8 cifre/litere)</span>
            <input type="password" id="pinInput" placeholder="Introdu PIN" maxLength={8} style={pinInp} />
          </div>
          <div className="mrow" style={{marginBottom:'6px'}}>
            <span className="mlbl">Confirmă PIN</span>
            <input type="password" id="pinConfirm" placeholder="Repetă PIN" maxLength={8} style={pinInp} />
          </div>
          <div style={{display:'flex',gap:'6px',marginTop:'6px'}}>
            <button className="hub-sbtn pri" id="pinActivateBtn" onClick={() => pinActivate?.()}>ACTIVEAZĂ PIN</button>
            <button className="hub-sbtn" id="pinRemoveBtn" style={{display:'none',borderColor:'#ff335533',color:'#ff6655'}} onClick={() => pinRemove?.()}><svg className="z-i" viewBox="0 0 16 16"><path d="M3 4h10M6 2h4v2M5 4v9h6V4m-4 2v5m2-5v5" /></svg> DEZACTIVEAZĂ</button>
          </div>
          <div id="pin-msg" style={{marginTop:'6px',fontSize:'10px',minHeight:'16px'}}></div>
        </div>

        <div className="msec" style={{marginTop:'16px'}}>SCHIMBĂ PAROLA</div>
        <div id="chpw-form">
          <div className="mrow" style={{marginBottom:'6px'}}><span className="mlbl">Parola curentă</span><input type="password" id="chpwCurrent" placeholder="Parola actuală" style={inp} /></div>
          <div className="mrow" style={{marginBottom:'6px'}}><span className="mlbl">Parola nouă</span><input type="password" id="chpwNew" placeholder="Min 12 caractere (A-z, 0-9)" style={inp} /></div>
          <div className="mrow" style={{marginBottom:'6px'}}><span className="mlbl">Confirmă parola</span><input type="password" id="chpwConfirm" placeholder="Repetă parola nouă" style={inp} /></div>
          <button className="hub-sbtn pri" id="chpwRequestBtn" style={{marginTop:'6px'}} onClick={chpwRequest}><svg className="z-i" viewBox="0 0 16 16"><path d="M2 4h12v8H2V4zm0 0l6 4 6-4" /></svg> Trimite cod de verificare</button>
          <div id="chpw-msg" style={{marginTop:'6px',fontSize:'10px',minHeight:'16px'}}></div>
        </div>
        <div id="chpw-code-form" style={{display:'none',marginTop:'10px'}}>
          <div className="msec"><svg className="z-i" viewBox="0 0 16 16"><path d="M14 8L2 3v4l7 1-7 1v4z" /></svg> COD DE VERIFICARE</div>
          <div style={{fontSize:'10px',color:'#556',marginBottom:'8px'}}>Am trimis un cod pe emailul tău. Introdu-l mai jos:</div>
          <div className="mrow" style={{marginBottom:'6px'}}><span className="mlbl">Cod 6 cifre</span><input type="text" id="chpwCode" maxLength={6} placeholder="000000" style={codeInp} /></div>
          <button className="hub-sbtn pri" id="chpwConfirmBtn" onClick={chpwConfirm}><svg className="z-i" viewBox="0 0 16 16"><path d="M3 8l4 4 6-7" /></svg> Confirmă schimbarea</button>
          <div id="chpw-code-msg" style={{marginTop:'6px',fontSize:'10px',minHeight:'16px'}}></div>
        </div>

        <div className="msec" style={{marginTop:'16px'}}>SCHIMBĂ EMAIL</div>
        <div id="chem-form">
          <div className="mrow" style={{marginBottom:'6px'}}><span className="mlbl">Email nou</span><input type="email" id="chemNewEmail" placeholder="email@exemplu.com" style={inp} /></div>
          <div className="mrow" style={{marginBottom:'6px'}}><span className="mlbl">Parola curentă</span><input type="password" id="chemPassword" placeholder="Confirmă cu parola" style={inp} /></div>
          <button className="hub-sbtn pri" id="chemRequestBtn" style={{marginTop:'6px'}} onClick={chemRequest}><svg className="z-i" viewBox="0 0 16 16"><path d="M2 4h12v8H2V4zm0 0l6 4 6-4" /></svg> Trimite cod pe noul email</button>
          <div id="chem-msg" style={{marginTop:'6px',fontSize:'10px',minHeight:'16px'}}></div>
        </div>
        <div id="chem-code-form" style={{display:'none',marginTop:'10px'}}>
          <div className="msec"><svg className="z-i" viewBox="0 0 16 16"><path d="M14 8L2 3v4l7 1-7 1v4z" /></svg> COD DE VERIFICARE</div>
          <div style={{fontSize:'10px',color:'#556',marginBottom:'8px'}}>Am trimis un cod pe noul email. Introdu-l mai jos:</div>
          <div className="mrow" style={{marginBottom:'6px'}}><span className="mlbl">Cod 6 cifre</span><input type="text" id="chemCode" maxLength={6} placeholder="000000" style={codeInp} /></div>
          <button className="hub-sbtn pri" id="chemConfirmBtn" onClick={chemConfirm}><svg className="z-i" viewBox="0 0 16 16"><path d="M3 8l4 4 6-7" /></svg> Confirmă schimbarea</button>
          <div id="chem-code-msg" style={{marginTop:'6px',fontSize:'10px',minHeight:'16px'}}></div>
        </div>

        <div className="msec" style={{marginTop:'16px'}}>INFORMAȚII CONT</div>
        <div style={{fontSize:'10px',color:'#556'}}>
          <div style={{marginBottom:'4px'}}>Email: <span style={{color:'#ccc'}} id="chpwUserEmail">—</span></div>
          <div>Rol: <span style={{color:'#00afff'}} id="chpwUserRole">—</span></div>
        </div>

        <div className="msec" style={{marginTop:'24px',color:'#ff4444'}}><svg className="z-i" viewBox="0 0 16 16" style={{color:'#ff4444'}}><path d="M8 2L1 14h14L8 2zM8 6v4m0 2h.01" /></svg> ÎNCHIDE CONTUL</div>
        <div style={{fontSize:'10px',color:'#664444',marginBottom:'8px'}}>Această acțiune este permanentă și nu poate fi anulată. Toate datele tale vor fi șterse.</div>
        <div id="clac-form">
          <div className="mrow" style={{marginBottom:'6px'}}><span className="mlbl">Parola curentă</span><input type="password" id="clacPassword" placeholder="Confirmă cu parola" style={{...inp, borderColor:'#ff444444'}} /></div>
          <button className="hub-sbtn" id="clacRequestBtn" style={{marginTop:'6px',background:'#ff444422',color:'#ff6655',border:'1px solid #ff444444'}} onClick={clacRequest}><svg className="z-i" viewBox="0 0 16 16"><path d="M3 4h10M6 2h4v2M5 4v9h6V4m-4 2v5m2-5v5" /></svg> Trimite cod de confirmare</button>
          <div id="clac-msg" style={{marginTop:'6px',fontSize:'10px',minHeight:'16px'}}></div>
        </div>
        <div id="clac-code-form" style={{display:'none',marginTop:'10px'}}>
          <div className="msec" style={{color:'#ff4444'}}><svg className="z-i" viewBox="0 0 16 16"><path d="M14 8L2 3v4l7 1-7 1v4z" /></svg> COD DE CONFIRMARE ȘTERGERE</div>
          <div style={{fontSize:'10px',color:'#664444',marginBottom:'8px'}}>Introdu codul primit pe email pentru a confirma ștergerea contului:</div>
          <div className="mrow" style={{marginBottom:'6px'}}><span className="mlbl">Cod 6 cifre</span><input type="text" id="clacCode" maxLength={6} placeholder="000000" style={dangerCodeInp} /></div>
          <button className="hub-sbtn" id="clacConfirmBtn" style={{background:'#ff444422',color:'#ff6655',border:'1px solid #ff444444'}} onClick={clacConfirm}><svg className="z-i" viewBox="0 0 16 16" style={{color:'#ff6655'}}><path d="M8 2L1 14h14L8 2zM8 6v4m0 2h.01" /></svg> ȘTERGE CONTUL DEFINITIV</button>
          <div id="clac-code-msg" style={{marginTop:'6px',fontSize:'10px',minHeight:'16px'}}></div>
        </div>
      </div>

      {/* ══ ALERTS ══ */}
      <div className="mbody" id="set-alerts" style={{display:tab==='alerts'?'block':'none'}}>
        <div style={{marginBottom:'10px'}}>
          <button className="hub-sbtn pri" style={{width:'100%',padding:'8px',fontSize:'10px'}} onClick={() => { onClose(); openModal('alerts') }}>
            <svg className="z-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:'14px',height:'14px',verticalAlign:'middle',marginRight:'4px'}}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg> OPEN FULL ALERTS PANEL
          </button>
        </div>
        <div className="msec">ALERT TRIGGERS</div>
        <label className="mchk"><input type="checkbox" id="hubAlertMaster" onChange={(e) => { if (w.S?.alerts) w.S.alerts.enabled = e.target.checked }} /> Master: enable all alerts</label>
        <label className="mchk"><input type="checkbox" id="hubAlertVol" onChange={(e) => { if (w.S?.alerts) w.S.alerts.volSpike = e.target.checked }} /> Volume spikes</label>
        <label className="mchk"><input type="checkbox" id="hubAlertWhale" onChange={(e) => { if (w.S?.alerts) w.S.alerts.whaleOrders = e.target.checked }} /> Whale orders</label>
        <label className="mchk"><input type="checkbox" id="hubAlertLiq" onChange={(e) => { if (w.S?.alerts) w.S.alerts.liqAlerts = e.target.checked }} /> Liquidation alerts</label>
        <label className="mchk"><input type="checkbox" id="hubAlertDiv" onChange={(e) => { if (w.S?.alerts) w.S.alerts.divergence = e.target.checked }} /> RSI divergences</label>
        <label className="mchk"><input type="checkbox" id="hubAlertRsi" onChange={(e) => { if (w.S?.alerts) w.S.alerts.rsiAlerts = e.target.checked }} /> RSI extremes (&lt;30 / &gt;70)</label>
        <div className="msec">THRESHOLDS</div>
        <div className="mrow"><span className="mlbl">Min whale size (BTC)</span><input type="number" id="hubWhaleMin" defaultValue={100} min={10} style={{width:'80px',background:'#0a121a',border:'1px solid #2a3a4a',color:'var(--txt)',padding:'3px 6px',borderRadius:'2px',fontFamily:'var(--ff)'}} onChange={(e) => { if (w.S?.alerts) w.S.alerts.whaleMinBtc = +e.target.value }} /></div>
        <div className="mrow"><span className="mlbl">Min liquidation (BTC)</span><input type="number" id="hubLiqMin" defaultValue={1} min={0.1} step={0.1} style={{width:'80px',background:'#0a121a',border:'1px solid #2a3a4a',color:'var(--txt)',padding:'3px 6px',borderRadius:'2px',fontFamily:'var(--ff)'}} onChange={(e) => { if (w.S?.alerts) w.S.alerts.liqMinBtc = +e.target.value }} /></div>
      </div>

      {/* ══ TELEGRAM ══ */}
      <div className="mbody" id="set-telegram" style={{display:tab==='telegram'?'block':'none'}}>
        <div className="msec">TELEGRAM BOT</div>
        <div style={{fontSize:'8px',color:'#6a9080',lineHeight:'1.6',marginBottom:'8px'}}>
          Primești alerte pe Telegram: ordine, risk blocks, kill switch, reconciliation.<br/>
          Creează un bot cu <span style={{color:'#4fc3f7'}}>@BotFather</span> → copiază token-ul → adaugă bot-ul în grup → ia Chat ID.
        </div>
        <div className="mrow"><span className="mlbl">Bot Token</span><input type="password" id="hubTgBotToken" placeholder="123456:ABC-DEF..." style={inp} /></div>
        <div className="mrow"><span className="mlbl">Chat ID</span><input type="text" id="hubTgChatId" placeholder="-100123456789" style={inp} /></div>
        <div style={{display:'flex',gap:'6px',marginTop:'8px'}}>
          <button id="hubTgSave" className="hub-sbtn pri" onClick={() => hubTgSave?.()}><svg className="z-i" viewBox="0 0 16 16"><path d="M4 2h5l3 3v9H4V2zm5 0v3h3M6 9h4m-4 2h3" /></svg> SAVE</button>
          <button id="hubTgTest" className="hub-sbtn" onClick={() => hubTgTest?.()}><svg className="z-i" viewBox="0 0 16 16"><path d="M14 8L2 3v4l7 1-7 1v4z" /></svg> SEND TEST</button>
        </div>
        <div id="hubTgStatus" style={{marginTop:'6px',fontSize:'8px',color:'var(--dim)',minHeight:'14px'}}></div>
        <div className="msec">CUM OBȚII</div>
        <div style={{fontSize:'7px',color:'#556677',lineHeight:'1.8'}}>
          1. Deschide Telegram → caută <b>@BotFather</b> → <code>/newbot</code> → copiază token<br/>
          2. Creează un grup sau folosește chat privat cu bot-ul<br/>
          3. Trimite un mesaj în grup, apoi vizitează:<br/>
          <code style={{color:'#4fc3f7'}}>{'https://api.telegram.org/bot<TOKEN>/getUpdates'}</code><br/>
          4. Caută <code>{'"chat":{"id":-100...}'}</code> — ăla e Chat ID-ul tău
        </div>
      </div>

      {/* ══ DEVELOPER ══ */}
      <div className="mbody" id="set-dev" style={{display:tab==='developer'?'block':'none'}}>
        <div className="msec">DEVELOPER MODE</div>
        <label className="mchk"><input type="checkbox" id="hubDevEnabled2" onChange={(e) => hubToggleDev(e.target.checked)} /> Enable Developer Mode</label>
        <div className="hub-disabled-notice">Shows test harness panel in Market Intelligence.</div>
        <div className="msec">DEV LOG ACTIONS</div>
        <div style={{display:'flex',gap:'6px',flexWrap:'wrap',marginTop:'4px'}}>
          <button className="hub-sbtn" onClick={() => devClearLog()}><svg className="z-i" viewBox="0 0 16 16"><path d="M3 4h10M6 2h4v2M5 4v9h6V4m-4 2v5m2-5v5" /></svg> Clear Dev Log</button>
          <button className="hub-sbtn" onClick={() => devExportLog()}><svg className="z-i" viewBox="0 0 16 16"><path d="M8 2v8m-3-3l3 3 3-3M3 14h10" /></svg> Export CSV</button>
        </div>
        <div className="msec">ZLOG — CENTRAL LOG (v90)</div>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'6px',padding:'4px 0'}}>
          <span id="zlog-counter" style={{fontSize:'7px',color:'#6a9080',letterSpacing:'1px',fontFamily:'var(--ff)'}}>ZLOG: 0 / 400</span>
          <span id="zlog-stats" style={{fontSize:'6px',color:'#445566'}}></span>
        </div>
        <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
          <button className="hub-sbtn" onClick={() => w.ZLOG?.copyCSV?.()}>Copy CSV</button>
          <button className="hub-sbtn" onClick={() => w.ZLOG?.copyJSON?.()}>Copy JSON</button>
          <button className="hub-sbtn" onClick={() => w.ZLOG?.exportCSV?.()}><svg className="z-i" viewBox="0 0 16 16"><path d="M8 2v8m-3-3l3 3 3-3M3 14h10" /></svg> Export CSV</button>
          <button className="hub-sbtn" onClick={() => w.ZLOG?.exportJSON?.()}><svg className="z-i" viewBox="0 0 16 16"><path d="M8 2v8m-3-3l3 3 3-3M3 14h10" /></svg> Export JSON</button>
          <button className="hub-sbtn" style={{borderColor:'#ff335533',color:'#ff8866'}} onClick={() => w.ZLOG?.clear?.()}><svg className="z-i" viewBox="0 0 16 16"><path d="M3 4h10M6 2h4v2M5 4v9h6V4m-4 2v5m2-5v5" /></svg> Clear ZLOG</button>
        </div>
        <div style={{marginTop:'4px',fontSize:'6px',color:'#3a4a5a',lineHeight:'1.6'}}>
          Colectează: atLog + devLog + erori async (safeAsync).<br/>
          Max 400 entries · dedup 2s · export fără server.
        </div>
        <div className="msec">BUILD INFO</div>
        <div id="hub-build-info" style={{fontSize:'7px',color:'#556677',lineHeight:'1.8'}}>ZeuS v108 — FIX: chart negru la schimb simbol/TF + _adaptClamp + PostMortem + RegimeWatch</div>
      </div>

      {/* ══ EXCHANGE API ══ */}
      <div id="set-exchange" style={{display:tab==='exchange'?'block':'none', padding:'12px 16px', overflowY:'auto', flex:'1 1 auto'}}>
        <div style={{fontSize:'8px',color:'#ff8800',marginBottom:'10px',lineHeight:'1.6'}}>
          Cheile sunt criptate la server · Folosește READ + TRADE only (fără withdrawal) · Restricționează IP
        </div>
        {(['binance', 'bybit'] as const).map(ex => {
          const info = exAccounts[ex]
          const mode = exModeFor[ex] || 'testnet'
          const loading = exLoadingFor[ex]
          const msg = exMsgFor[ex]
          const accentColor = ex === 'binance' ? '#f0c040' : '#aa44ff'
          const label = ex === 'binance' ? 'BINANCE FUTURES' : 'BYBIT DERIVATIVES'
          return (
            <div key={ex} style={{background:'#0a1018',border:`1px solid ${accentColor}33`,borderRadius:'6px',padding:'12px',marginBottom:'10px'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'8px'}}>
                <span style={{fontSize:'10px',fontWeight:700,color:accentColor,letterSpacing:'1px'}}>{label}</span>
                <span style={{fontSize:'9px',color: info ? '#00d97a' : '#556'}}>
                  {info ? `● CONECTAT · ${info.mode.toUpperCase()} · ${info.maskedKey}` : '○ deconectat'}
                </span>
              </div>
              {info ? (
                <div style={{fontSize:'9px',color:'#8899aa',marginBottom:'8px'}}>
                  Balance: <span style={{color:'#00d97a'}}>${(info.balance||0).toFixed(2)}</span>
                  {info.lastVerified && <span style={{color:'#445',marginLeft:'8px'}}>· {new Date(info.lastVerified).toLocaleString('ro-RO')}</span>}
                </div>
              ) : (
                <>
                  <div style={{marginBottom:'6px'}}>
                    <div style={{fontSize:'8px',color:'#6a9080',marginBottom:'2px'}}>API KEY</div>
                    <input type="password" id={`${ex}ApiKey`} placeholder="Paste API Key" style={{width:'100%',background:'#060c14',border:'1px solid #2a3a4a',color:'var(--txt)',padding:'5px 8px',borderRadius:'3px',fontFamily:'var(--ff)',fontSize:'9px',boxSizing:'border-box'}} />
                  </div>
                  <div style={{marginBottom:'8px'}}>
                    <div style={{fontSize:'8px',color:'#6a9080',marginBottom:'2px'}}>SECRET KEY</div>
                    <input type="password" id={`${ex}ApiSecret`} placeholder="Paste Secret Key" style={{width:'100%',background:'#060c14',border:'1px solid #2a3a4a',color:'var(--txt)',padding:'5px 8px',borderRadius:'3px',fontFamily:'var(--ff)',fontSize:'9px',boxSizing:'border-box'}} />
                  </div>
                  <div style={{display:'flex',gap:'6px',marginBottom:'8px'}}>
                    <button className="hub-sbtn" style={{flex:1,fontWeight:700,color:'#ff6655',background:mode==='live'?'#ff444433':'transparent',border:`1px solid ${mode==='live'?'#ff4444':'#ff444433'}`}} onClick={() => setExModeFor(p=>({...p,[ex]:'live'}))}>● LIVE</button>
                    <button className="hub-sbtn" style={{flex:1,fontWeight:700,background:mode==='testnet'?`${accentColor}22`:'transparent',border:`1px solid ${mode==='testnet'?accentColor:`${accentColor}33`}`}} onClick={() => setExModeFor(p=>({...p,[ex]:'testnet'}))}>◎ TESTNET</button>
                  </div>
                </>
              )}
              <div style={{display:'flex',gap:'6px'}}>
                {info ? (
                  <>
                    <button className="hub-sbtn" style={{flex:1}} onClick={() => exVerify(ex)}>RE-VERIFY</button>
                    <button className="hub-sbtn" style={{flex:1,borderColor:'#ff335533',color:'#ff6655'}} onClick={() => exDisconnect(ex)}>DISCONNECT</button>
                  </>
                ) : (
                  <button className="hub-sbtn pri" style={{flex:1,fontWeight:700}} onClick={() => exSave(ex)} disabled={!!loading}>
                    {loading ? 'SE VERIFICĂ...' : 'VERIFY & SAVE'}
                  </button>
                )}
              </div>
              {msg && <div style={{marginTop:'6px',fontSize:'9px',color: msg.ok ? '#00d97a' : '#ff5566',textAlign:'center'}}>{msg.text}</div>}
            </div>
          )
        })}
      </div>

      {/* ══ Footer ══ */}
      <div style={{padding:'12px 16px',display:'flex',gap:'6px',flexWrap:'wrap',borderTop:'1px solid #1e2530',flex:'none'}}>
        <button id="hubSaveAll" className="hub-sbtn pri" onClick={() => hubSaveAll?.()}><svg className="z-i" viewBox="0 0 16 16"><path d="M4 2h5l3 3v9H4V2zm5 0v3h3M6 9h4m-4 2h3" /></svg> SAVE ALL</button>
        <button id="hubLoadAll" className="hub-sbtn" onClick={() => hubLoadAll?.()}><svg className="z-i" viewBox="0 0 16 16"><path d="M2 5h5l2 2h5v6H2V5z" /></svg> LOAD SAVED</button>
        <button id="hubResetDefaults" className="hub-sbtn" style={{borderColor:'#ff335533',color:'#ff8866'}} onClick={() => hubResetDefaults?.()}>↺ RESET DEFAULTS</button>
        <button className="hub-sbtn" onClick={onClose} style={{marginLeft:'auto'}}>✕ CLOSE</button>
      </div>
    </ModalOverlay>
  )
}
