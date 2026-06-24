import { useState, useEffect, useRef } from 'react'
import { ModalOverlay, ModalHeader } from './ModalOverlay'
import { useUiStore } from '../../stores'
import { useSupportStore } from '../../stores/supportStore'
import { pinActivate, pinRemove, _pinUpdateUI } from '../../core/bootstrapMisc'
import { BiometricToggle } from './BiometricToggle'
import { hubCloudSave, hubCloudLoad, hubCloudClear, hubSaveAll, hubLoadAll, hubResetDefaults, hubTgSave, hubTgTest, hubToggleDev, devClearLog, devExportLog } from '../../utils/dev'
import { zeusApplyTheme, zeusGetTheme } from '../../ui/theme'
import { OmegaMemorySection } from '../settings/OmegaMemorySection'
import { SupportChat } from './SupportChat'

const w = window as any

// [2026-06-13] Support — categorised mailto with auto diagnostics so users can
// report issues fast and we get context (version/symbol/mode/device).
const SUPPORT_EMAIL = 'support@zeus-terminal.com'
const SUPPORT_CATEGORIES = [
  { ico: '🐞', label: 'App broke / black screen / froze', subj: 'App broke or froze' },
  { ico: '📊', label: 'Chart or price not loading / wrong', subj: 'Chart or price issue' },
  { ico: '🤖', label: 'AutoTrade / Brain / orders issue', subj: 'AutoTrade / Brain issue' },
  { ico: '🔌', label: 'Exchange API / connection problem', subj: 'Exchange API / connection' },
  { ico: '🔐', label: 'Login / account / 2FA / PIN', subj: 'Login / account / 2FA' },
  { ico: '💾', label: 'Settings not saving / sync', subj: 'Settings / sync issue' },
  { ico: '💡', label: 'Suggestion / feedback', subj: 'Suggestion / feedback' },
  { ico: '❓', label: 'Something else', subj: 'Other' },
]
function _supportMailto(subj: string): string {
  let diag = ''
  try {
    const ver = (w.BUILD && w.BUILD.version) || 'v1.7.164'
    const sym = (w.S && w.S.symbol) || '—'
    const env = w._resolvedEnv || (w.S && w.S.mode) || '—'
    diag = [
      'Version: ' + ver,
      'Symbol: ' + sym,
      'Mode: ' + env,
      'When: ' + new Date().toString(),
      'Device: ' + (navigator.userAgent || '—'),
    ].join('\n')
  } catch (_) { /* best effort */ }
  const body = 'Describe what happened (steps, what you expected, what you saw):\n\n\n'
    + '────────── please keep the details below ──────────\n' + diag
  return 'mailto:' + SUPPORT_EMAIL + '?subject=' + encodeURIComponent('[Zeus] ' + subj) + '&body=' + encodeURIComponent(body)
}

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
  const supportUnread = useSupportStore((s) => s.userUnread)
  const openModal = useUiStore((s) => s.openModal)

  // [BATCH3-S] When Security tab opens, sync PIN UI (show/hide Current PIN field).
  useEffect(() => {
    if (tab !== 'security') return
    const t = setTimeout(() => { _pinUpdateUI?.() }, 50)
    return () => clearTimeout(t)
  }, [tab])

  async function chpwRequest() {
    const r = await apiFetch('/auth/change-password/request', { currentPassword: val('chpwCurrent') })
    setMsg('chpw-msg', r.message || r.error || '', !!r.ok)
    if (r.ok) { showEl('chpw-code-form', true); showEl('chpw-form', false) }
  }

  async function chpwConfirm() {
    // [BUG-UI-CMP-9] Pre-POST length check — empty/short codes wasted server roundtrips.
    const code = (val('chpwCode') || '').trim()
    if (code.length < 6) {
      setMsg('chpw-code-msg', 'Enter the 6-digit code from email', false)
      return
    }
    const r = await apiFetch('/auth/change-password/confirm', { code, newPassword: val('chpwNew') })
    setMsg('chpw-code-msg', r.message || r.error || '', !!r.ok)
    if (r.ok) setTimeout(() => { showEl('chpw-code-form', false); showEl('chpw-form', true) }, 1500)
  }

  async function chemRequest() {
    const r = await apiFetch('/auth/change-email/request', { currentPassword: val('chemPassword'), newEmail: val('chemNewEmail') })
    setMsg('chem-msg', r.message || r.error || '', !!r.ok)
    if (r.ok) { showEl('chem-code-form', true); showEl('chem-form', false) }
  }

  async function chemConfirm() {
    // [BUG-UI-CMP-9] Pre-POST length check — empty/short codes wasted server roundtrips.
    const code = (val('chemCode') || '').trim()
    if (code.length < 6) {
      setMsg('chem-code-msg', 'Enter the 6-digit code from email', false)
      return
    }
    const r = await apiFetch('/auth/change-email/confirm', { code })
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

  // [BUG-UI-CMP-2] Hard double-click guard for irreversible DELETE ACCOUNT button.
  // useRef provides synchronous block (React state updates may be batched/async).
  // useState only drives UI disabled/loading visual.
  // Reset on error so user can retry; do NOT reset on success (redirect unmounts).
  const clacBusyRef = useRef(false)
  const [clacBusy, setClacBusy] = useState(false)
  const onClacConfirm = async () => {
    if (clacBusyRef.current) return
    clacBusyRef.current = true
    setClacBusy(true)
    try {
      await clacConfirm()
    } catch (err) {
      clacBusyRef.current = false
      setClacBusy(false)
      throw err
    }
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
        <div className={`mtab${tab==='omega'?' act':''}`} onClick={()=>setTab('omega')}>OMEGA</div>
        <div className={`mtab${tab==='security'?' act':''}`} onClick={()=>setTab('security')}><svg className="z-i" viewBox="0 0 16 16"><path d="M5 7V5a3 3 0 016 0v2M4 7h8v7H4z" /></svg> ACCOUNT &amp; SECURITY</div>
        <div className={`mtab${tab==='support'?' act':''}`} onClick={()=>setTab('support')}>SUPPORT{supportUnread > 0 && <span className="mtab-badge">{supportUnread > 9 ? '9+' : supportUnread}</span>}</div>
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
          <select id="themeSelect" style={{flex:1,background:'var(--sf-input,#0a121a)',border:'1px solid var(--brd)',color:'var(--whi)',padding:'6px 8px',borderRadius:'var(--r-sm)',fontFamily:'var(--ff)',fontSize:'10px'}} defaultValue={zeusGetTheme()} onChange={(e) => zeusApplyTheme?.(e.target.value)}>
            <option value="native">⬛ Obsidian</option>
            <option value="dark">🌑 Onyx</option>
            <option value="light">☀️ Ivory</option>
          </select>
        </div>
        {/* [2026-06-13] UI SCALE removed — the control set --ui-scale but nothing
            consumed it (0 var(--ui-scale) anywhere), so it never resized anything. */}
      </div>

      {/* ══ CONT & SECURITY ══ */}
      <div className="mbody" id="set-account" style={{display:tab==='security'?'block':'none'}}>
        <div className="msec">APP LOCK (PIN)</div>
        <div style={{fontSize:'10px',color:'#556',marginBottom:'8px',lineHeight:'1.6'}}>
          Protect the terminal with a local PIN. You will be prompted for the PIN each time the app opens, before you can see your data.
        </div>
        <div className="mrow"><span className="mlbl">Status</span>
          <span id="pinStatus" style={{fontSize:'11px',color:'#556',fontWeight:700}}>DISABLED</span>
        </div>
        <div id="pinSetupForm">
          {/* [BATCH3-S] Current PIN — only shown when PIN already active. Reused for both Change and Deactivate. */}
          <div className="mrow" id="pinCurrentRow" style={{marginBottom:'6px',display:'none'}}>
            <span className="mlbl">Current PIN</span>
            <input type="password" id="pinCurrent" placeholder="Current PIN" maxLength={8} style={pinInp} autoComplete="off" />
          </div>
          <div className="mrow" style={{marginBottom:'6px'}}>
            <span className="mlbl" id="pinInputLabel">PIN (4–8 digits/letters)</span>
            <input type="password" id="pinInput" placeholder="Enter PIN" maxLength={8} style={pinInp} autoComplete="off" />
          </div>
          <div className="mrow" style={{marginBottom:'6px'}}>
            <span className="mlbl">Confirm PIN</span>
            <input type="password" id="pinConfirm" placeholder="Repeat PIN" maxLength={8} style={pinInp} autoComplete="off" />
          </div>
          <div style={{display:'flex',gap:'6px',marginTop:'6px'}}>
            <button className="hub-sbtn pri" id="pinActivateBtn" onClick={() => pinActivate?.()}>ACTIVATE PIN</button>
            <button className="hub-sbtn" id="pinRemoveBtn" style={{display:'none',borderColor:'#ff335533',color:'#ff6655'}} onClick={() => pinRemove?.()}><svg className="z-i" viewBox="0 0 16 16"><path d="M3 4h10M6 2h4v2M5 4v9h6V4m-4 2v5m2-5v5" /></svg> DEACTIVATE</button>
          </div>
          <div id="pin-msg" style={{marginTop:'6px',fontSize:'10px',minHeight:'16px'}}></div>
        </div>

        <BiometricToggle />

        <div className="msec" style={{marginTop:'16px'}}>CHANGE PASSWORD</div>
        <div id="chpw-form">
          <div className="mrow" style={{marginBottom:'6px'}}><span className="mlbl">Current password</span><input type="password" id="chpwCurrent" placeholder="Current password" style={inp} /></div>
          <div className="mrow" style={{marginBottom:'6px'}}><span className="mlbl">New password</span><input type="password" id="chpwNew" placeholder="Min 12 characters (A-z, 0-9)" style={inp} /></div>
          <div className="mrow" style={{marginBottom:'6px'}}><span className="mlbl">Confirm password</span><input type="password" id="chpwConfirm" placeholder="Repeat new password" style={inp} /></div>
          <button className="hub-sbtn pri" id="chpwRequestBtn" style={{marginTop:'6px'}} onClick={chpwRequest}><svg className="z-i" viewBox="0 0 16 16"><path d="M2 4h12v8H2V4zm0 0l6 4 6-4" /></svg> Send verification code</button>
          <div id="chpw-msg" style={{marginTop:'6px',fontSize:'10px',minHeight:'16px'}}></div>
        </div>
        <div id="chpw-code-form" style={{display:'none',marginTop:'10px'}}>
          <div className="msec"><svg className="z-i" viewBox="0 0 16 16"><path d="M14 8L2 3v4l7 1-7 1v4z" /></svg> VERIFICATION CODE</div>
          <div style={{fontSize:'10px',color:'#556',marginBottom:'8px'}}>We sent a code to your email. Enter it below:</div>
          <div className="mrow" style={{marginBottom:'6px'}}><span className="mlbl">6-digit code</span><input type="text" id="chpwCode" maxLength={6} placeholder="000000" style={codeInp} /></div>
          <button className="hub-sbtn pri" id="chpwConfirmBtn" onClick={chpwConfirm}><svg className="z-i" viewBox="0 0 16 16"><path d="M3 8l4 4 6-7" /></svg> Confirm change</button>
          <div id="chpw-code-msg" style={{marginTop:'6px',fontSize:'10px',minHeight:'16px'}}></div>
        </div>

        <div className="msec" style={{marginTop:'16px'}}>CHANGE EMAIL</div>
        <div id="chem-form">
          <div className="mrow" style={{marginBottom:'6px'}}><span className="mlbl">New email</span><input type="email" id="chemNewEmail" placeholder="email@example.com" style={inp} /></div>
          <div className="mrow" style={{marginBottom:'6px'}}><span className="mlbl">Current password</span><input type="password" id="chemPassword" placeholder="Confirm with password" style={inp} /></div>
          <button className="hub-sbtn pri" id="chemRequestBtn" style={{marginTop:'6px'}} onClick={chemRequest}><svg className="z-i" viewBox="0 0 16 16"><path d="M2 4h12v8H2V4zm0 0l6 4 6-4" /></svg> Send code to new email</button>
          <div id="chem-msg" style={{marginTop:'6px',fontSize:'10px',minHeight:'16px'}}></div>
        </div>
        <div id="chem-code-form" style={{display:'none',marginTop:'10px'}}>
          <div className="msec"><svg className="z-i" viewBox="0 0 16 16"><path d="M14 8L2 3v4l7 1-7 1v4z" /></svg> VERIFICATION CODE</div>
          <div style={{fontSize:'10px',color:'#556',marginBottom:'8px'}}>We sent a code to the new email. Enter it below:</div>
          <div className="mrow" style={{marginBottom:'6px'}}><span className="mlbl">6-digit code</span><input type="text" id="chemCode" maxLength={6} placeholder="000000" style={codeInp} /></div>
          <button className="hub-sbtn pri" id="chemConfirmBtn" onClick={chemConfirm}><svg className="z-i" viewBox="0 0 16 16"><path d="M3 8l4 4 6-7" /></svg> Confirm change</button>
          <div id="chem-code-msg" style={{marginTop:'6px',fontSize:'10px',minHeight:'16px'}}></div>
        </div>

        <div className="msec" style={{marginTop:'16px'}}>ACCOUNT INFO</div>
        <div style={{fontSize:'10px',color:'#556'}}>
          <div style={{marginBottom:'4px'}}>Email: <span style={{color:'#ccc'}} id="chpwUserEmail">—</span></div>
          <div>Role: <span style={{color:'#00afff'}} id="chpwUserRole">—</span></div>
        </div>

        <div className="msec" style={{marginTop:'24px',color:'#ff4444'}}><svg className="z-i" viewBox="0 0 16 16" style={{color:'#ff4444'}}><path d="M8 2L1 14h14L8 2zM8 6v4m0 2h.01" /></svg> CLOSE ACCOUNT</div>
        <div style={{fontSize:'10px',color:'#664444',marginBottom:'8px'}}>This action is permanent and cannot be undone. All your data will be deleted.</div>
        <div id="clac-form">
          <div className="mrow" style={{marginBottom:'6px'}}><span className="mlbl">Current password</span><input type="password" id="clacPassword" placeholder="Confirm with password" style={{...inp, borderColor:'#ff444444'}} /></div>
          <button className="hub-sbtn" id="clacRequestBtn" style={{marginTop:'6px',background:'#ff444422',color:'#ff6655',border:'1px solid #ff444444'}} onClick={clacRequest}><svg className="z-i" viewBox="0 0 16 16"><path d="M3 4h10M6 2h4v2M5 4v9h6V4m-4 2v5m2-5v5" /></svg> Send confirmation code</button>
          <div id="clac-msg" style={{marginTop:'6px',fontSize:'10px',minHeight:'16px'}}></div>
        </div>
        <div id="clac-code-form" style={{display:'none',marginTop:'10px'}}>
          <div className="msec" style={{color:'#ff4444'}}><svg className="z-i" viewBox="0 0 16 16"><path d="M14 8L2 3v4l7 1-7 1v4z" /></svg> DELETION CONFIRMATION CODE</div>
          <div style={{fontSize:'10px',color:'#664444',marginBottom:'8px'}}>Enter the code from your email to confirm account deletion:</div>
          <div className="mrow" style={{marginBottom:'6px'}}><span className="mlbl">6-digit code</span><input type="text" id="clacCode" maxLength={6} placeholder="000000" style={dangerCodeInp} /></div>
          <button className="hub-sbtn" id="clacConfirmBtn" disabled={clacBusy} style={{background:'#ff444422',color:'#ff6655',border:'1px solid #ff444444',opacity:clacBusy?0.5:1,cursor:clacBusy?'not-allowed':'pointer'}} onClick={onClacConfirm}><svg className="z-i" viewBox="0 0 16 16" style={{color:'#ff6655'}}><path d="M8 2L1 14h14L8 2zM8 6v4m0 2h.01" /></svg> {clacBusy ? 'DELETING...' : 'DELETE ACCOUNT PERMANENTLY'}</button>
          <div id="clac-code-msg" style={{marginTop:'6px',fontSize:'10px',minHeight:'16px'}}></div>
        </div>
      </div>

      {/* ══ ALERTS ══ */}
      <div className="mbody" id="set-alerts" style={{display:tab==='alerts'?'block':'none'}}>
        <div style={{marginBottom:'10px'}}>
          <button className="hub-sbtn pri" style={{width:'100%',padding:'8px',fontSize:'10px'}} onClick={() => { onClose(); openModal('alerts', 'settings') }}>
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
          Receive alerts via Telegram: orders, risk blocks, kill switch, reconciliation.<br/>
          Create a bot with <span style={{color:'#4fc3f7'}}>@BotFather</span> → copy the token → add the bot to a group → get the Chat ID.
        </div>
        <div className="mrow"><span className="mlbl">Bot Token</span><input type="password" id="hubTgBotToken" placeholder="123456:ABC-DEF..." style={inp} /></div>
        <div className="mrow"><span className="mlbl">Chat ID</span><input type="text" id="hubTgChatId" placeholder="-100123456789" style={inp} /></div>
        <div style={{display:'flex',gap:'6px',marginTop:'8px'}}>
          <button id="hubTgSave" className="hub-sbtn pri" onClick={() => hubTgSave?.()}><svg className="z-i" viewBox="0 0 16 16"><path d="M4 2h5l3 3v9H4V2zm5 0v3h3M6 9h4m-4 2h3" /></svg> SAVE</button>
          <button id="hubTgTest" className="hub-sbtn" onClick={() => hubTgTest?.()}><svg className="z-i" viewBox="0 0 16 16"><path d="M14 8L2 3v4l7 1-7 1v4z" /></svg> SEND TEST</button>
        </div>
        <div id="hubTgStatus" style={{marginTop:'6px',fontSize:'8px',color:'var(--dim)',minHeight:'14px'}}></div>
        <div className="msec">HOW TO GET IT</div>
        <div style={{fontSize:'7px',color:'#556677',lineHeight:'1.8'}}>
          1. Open Telegram → search <b>@BotFather</b> → <code>/newbot</code> → copy the token<br/>
          2. Create a group or use a private chat with the bot<br/>
          3. Send a message in the group, then visit:<br/>
          <code style={{color:'#4fc3f7'}}>{'https://api.telegram.org/bot<TOKEN>/getUpdates'}</code><br/>
          4. Look for <code>{'"chat":{"id":-100...}'}</code> — that is your Chat ID
        </div>
      </div>

      {/* ══ DEVELOPER ══ */}
      <div className="mbody" id="set-dev" style={{display:tab==='developer'?'block':'none'}}>
        {/* [2026-06-13] Removed duplicate 'Enable Developer Mode' toggle — the single
            source is the General tab (#hubDevEnabled). Two checkboxes desynced. */}
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
          Collects: atLog + devLog + async errors (safeAsync).<br/>
          Max 400 entries · dedup 2s · export without server.
        </div>
        <div className="msec">BUILD INFO</div>
        <div id="hub-build-info" style={{fontSize:'8px',color:'#7fa0b0',lineHeight:'1.8'}}>{'Zeus Terminal ' + ((w.BUILD && w.BUILD.version) || 'v1.7.164') + ((w.BUILD && w.BUILD.date) ? ' · ' + w.BUILD.date : '')}</div>
      </div>

      {/* ══ OMEGA — Sub-A chat persistence + Sub-C.1 long-term memory ══ */}
      <div className="mbody" id="set-omega" style={{display:tab==='omega'?'block':'none', padding:'12px 16px', overflowY:'auto', flex:'1 1 auto'}}>
        <OmegaMemorySection />
      </div>

      {/* ══ EXCHANGE API ══ */}
      <div id="set-exchange" style={{display:tab==='exchange'?'block':'none', padding:'24px 16px', overflowY:'auto', flex:'1 1 auto'}}>
        <div style={{textAlign:'center', padding:'24px 16px', background:'#0a1018', border:'1px solid #00d4ff33', borderRadius:'6px'}}>
          <div style={{fontFamily:'Orbitron, sans-serif', fontWeight:900, fontSize:'18px', letterSpacing:'3px', color:'#00d4ff', marginBottom:'10px'}}>
            ₿ MULTIEXCHANGE
          </div>
          <div style={{fontSize:'11px', color:'#94a3b8', lineHeight:'1.6', marginBottom:'16px', fontFamily:'JetBrains Mono, monospace'}}>
            Exchange API settings moved to the dedicated MultiExchange page.
            <br />
            Open from the dock icon ₿ next to Ω.
          </div>
          <button
            className="hub-sbtn pri"
            style={{fontWeight:700, padding:'8px 16px'}}
            onClick={() => {
              onClose()
              const ev = new CustomEvent('zeus:dock-activate', { detail: { id: 'multi-exchange' } })
              window.dispatchEvent(ev)
            }}
          >
            OPEN MULTIEXCHANGE →
          </button>
        </div>
      </div>

      {/* ══ SUPPORT ══ */}
      <div className="mbody" id="set-support" style={{display:tab==='support'?'block':'none'}}>
        <div className="msec">CONTACT</div>
        <div style={{fontSize:'10px',color:'#b3a2d4',lineHeight:1.6,marginBottom:'8px'}}>
          Having trouble? Reach the Zeus team at <b style={{color:'#d9c7ff'}}>{SUPPORT_EMAIL}</b>. Pick a category below — your email opens pre-filled with a few diagnostics so we can help faster.
        </div>
        <a className="hub-sbtn pri" href={_supportMailto('General support')} style={{width:'100%',padding:'9px',justifyContent:'center',textDecoration:'none',display:'flex',alignItems:'center',gap:'6px'}}>
          <svg className="z-i" viewBox="0 0 16 16"><path d="M2 4h12v8H2V4zm0 0l6 4 6-4" /></svg> Email Support
        </a>

        <SupportChat active={tab === 'support'} />

        <div className="msec">REPORT A PROBLEM</div>
        <div style={{display:'flex',flexDirection:'column',gap:'5px'}}>
          {SUPPORT_CATEGORIES.map(c => (
            <a key={c.subj} className="hub-sbtn" href={_supportMailto(c.subj)} style={{display:'flex',alignItems:'center',gap:'8px',textDecoration:'none',padding:'8px 10px'}}>
              <span style={{fontSize:'13px'}}>{c.ico}</span> {c.label}
            </a>
          ))}
        </div>

        <div className="msec">BEFORE YOU WRITE</div>
        <div style={{fontSize:'10px',color:'#9a8cb8',lineHeight:1.8}}>
          • New accounts need manual admin approval — it can take a little while.<br/>
          • For 2FA / verification emails, check your spam / junk folder.<br/>
          • For exchange API issues, verify your key permissions + IP whitelist.<br/>
          • A hard refresh (fully close &amp; reopen Zeus) clears most temporary glitches.
        </div>

        <div className="msec">SAFETY</div>
        <div style={{fontSize:'10px',color:'#9a8cb8',lineHeight:1.6}}>
          We will <b style={{color:'#d9c7ff'}}>never</b> ask for your password, 2FA codes, or exchange API secrets by email.
        </div>

        <div style={{marginTop:'14px',display:'flex',gap:'14px',flexWrap:'wrap',fontSize:'10px'}}>
          <a href="/support.html" target="_blank" rel="noopener" style={{color:'#c9a8ff'}}>Support page ↗</a>
          <a href="/terms.html" target="_blank" rel="noopener" style={{color:'#c9a8ff'}}>Terms ↗</a>
          <a href="/privacy.html" target="_blank" rel="noopener" style={{color:'#c9a8ff'}}>Privacy ↗</a>
        </div>
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
