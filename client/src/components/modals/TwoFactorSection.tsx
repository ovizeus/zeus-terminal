// [2026-11-27] Settings › Security › Two-factor authentication (aplicatie de autentificare).
// Securitate etapa 2: cu 2FA pornit, login-ul cere codul din telefon IN LOCUL codului pe email —
// cine are emailul si parola nu mai intra. Pornirea cere parola (o sesiune furata nu poate porni 2FA
// cu telefonul altcuiva); codurile de rezerva se arata o singura data; oprirea cere parola + un cod.
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { api } from '../../services/api'

type Step = 'idle' | 'password' | 'scan' | 'codes' | 'disable'
const inp = { flex: 1, minWidth: 0, background: '#0a0f16', border: '1px solid #1e2a38', color: '#cde', padding: '5px 7px', borderRadius: '3px', fontSize: '11px' } as const
const note = { fontSize: '10px', color: '#556', marginBottom: '8px', lineHeight: '1.6' } as const

export function TwoFactorSection() {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [left, setLeft] = useState(0)
  const [step, setStep] = useState<Step>('idle')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [secret, setSecret] = useState('')
  const [qr, setQr] = useState('')
  const [codes, setCodes] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function load() {
    const r: any = await api.get('/api/2fa/status').catch(() => null)
    if (r && r.ok) { setEnabled(!!r.enabled); setLeft(Number(r.recoveryLeft) || 0) }
  }
  useEffect(() => { void load() }, [])

  function reset(next: Step) { setStep(next); setPassword(''); setCode(''); setMsg('') }

  async function startSetup() {
    setBusy(true); setMsg('')
    try {
      const r: any = await api.post('/api/2fa/setup', { password })
      if (!r || !r.ok) { setMsg((r && r.error) || 'Not started — try again.'); return }
      setSecret(r.secret)
      setQr(await QRCode.toDataURL(r.uri, { margin: 1, width: 180 }).catch(() => ''))
      setPassword(''); setStep('scan')
    } finally { setBusy(false) }
  }

  async function confirm() {
    setBusy(true); setMsg('')
    try {
      const r: any = await api.post('/api/2fa/confirm', { code: code.replace(/\s/g, '') })
      if (!r || !r.ok) { setMsg((r && r.error) || 'Wrong code — try again.'); return }
      setCodes(r.recoveryCodes || []); setSecret(''); setQr(''); setCode(''); setStep('codes')
    } finally { setBusy(false) }
  }

  async function disable() {
    setBusy(true); setMsg('')
    try {
      const r: any = await api.post('/api/2fa/disable', { password, code: code.trim() })
      if (!r || !r.ok) { setMsg((r && r.error) || 'Not turned off — try again.'); return }
      reset('idle'); await load(); setMsg('Two-factor authentication is off.')
    } finally { setBusy(false) }
  }

  const status = enabled === null ? '…' : enabled ? 'ON' : 'OFF'
  return (
    <div data-2fa="section">
      <div className="msec" style={{ marginTop: '16px' }}>TWO-FACTOR AUTHENTICATION</div>
      <div style={note}>
        Sign in with a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, Authy…) instead of a code sent by email. Someone who gets into your email still can’t sign in.
      </div>
      <div className="mrow"><span className="mlbl">Status</span>
        <span style={{ fontSize: '11px', fontWeight: 700, color: enabled ? '#3ddc97' : '#556' }}>{status}</span>
      </div>
      {enabled && step === 'idle' && <div style={note}>{left} backup codes left.</div>}

      {step === 'idle' && enabled === false && (
        <button className="hub-sbtn pri" onClick={() => reset('password')}>Turn on</button>
      )}
      {step === 'idle' && enabled === true && (
        <button className="hub-sbtn" style={{ borderColor: '#ff335533', color: '#ff6655' }} onClick={() => reset('disable')}>Turn off</button>
      )}

      {step === 'password' && (
        <div>
          <div className="mrow" style={{ marginBottom: '6px' }}><span className="mlbl">Current password</span>
            <input type="password" data-2fa="password" value={password} onChange={(e) => setPassword(e.target.value)} style={inp} autoComplete="current-password" />
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button className="hub-sbtn pri" disabled={busy || !password} onClick={startSetup}>Continue</button>
            <button className="hub-sbtn" onClick={() => reset('idle')}>Cancel</button>
          </div>
        </div>
      )}

      {step === 'scan' && (
        <div>
          <div style={note}>1. Scan this code with your authenticator app, or type the key by hand.</div>
          {qr && <img data-2fa="qr" src={qr} alt="QR code for your authenticator app" width={180} height={180} style={{ background: '#fff', borderRadius: '4px', display: 'block', marginBottom: '6px' }} />}
          <div style={{ fontFamily: 'monospace', fontSize: '11px', color: '#cde', letterSpacing: '1px', marginBottom: '10px', wordBreak: 'break-all' }}>
            {secret.replace(/(.{4})/g, '$1 ').trim()}
          </div>
          <div style={note}>2. Enter the 6-digit code the app shows.</div>
          <div className="mrow" style={{ marginBottom: '6px' }}><span className="mlbl">Code</span>
            <input type="text" data-2fa="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))} style={inp} placeholder="000000" />
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button className="hub-sbtn pri" disabled={busy || code.replace(/\s/g, '').length !== 6} onClick={confirm}>Turn on 2FA</button>
            <button className="hub-sbtn" onClick={() => { setSecret(''); setQr(''); reset('idle') }}>Cancel</button>
          </div>
        </div>
      )}

      {step === 'codes' && (
        <div>
          <div style={{ ...note, color: '#e8b04a' }}>
            Two-factor authentication is on. Save these backup codes somewhere safe — each one signs you in once if you lose your phone. They are shown only now.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, max-content)', gap: '4px 16px', fontFamily: 'monospace', fontSize: '12px', color: '#cde', marginBottom: '10px' }}>
            {codes.map((c) => <span key={c}>{c}</span>)}
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button className="hub-sbtn" onClick={() => { try { void navigator.clipboard.writeText(codes.join('\n')); setMsg('Copied.') } catch { /* fara clipboard */ } }}>Copy codes</button>
            <button className="hub-sbtn pri" onClick={() => { setCodes([]); reset('idle'); void load() }}>I saved them</button>
          </div>
        </div>
      )}

      {step === 'disable' && (
        <div>
          <div className="mrow" style={{ marginBottom: '6px' }}><span className="mlbl">Current password</span>
            <input type="password" data-2fa="password" value={password} onChange={(e) => setPassword(e.target.value)} style={inp} autoComplete="current-password" />
          </div>
          <div className="mrow" style={{ marginBottom: '6px' }}><span className="mlbl">Code or backup code</span>
            <input type="text" data-2fa="code" autoComplete="one-time-code" maxLength={11} value={code} onChange={(e) => setCode(e.target.value)} style={inp} placeholder="000000" />
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button className="hub-sbtn" style={{ borderColor: '#ff335533', color: '#ff6655' }} disabled={busy || !password || !code.trim()} onClick={disable}>Turn off 2FA</button>
            <button className="hub-sbtn" onClick={() => reset('idle')}>Cancel</button>
          </div>
        </div>
      )}

      {msg && <div role="status" style={{ marginTop: '6px', fontSize: '10px', color: '#8aa' }}>{msg}</div>}
    </div>
  )
}
