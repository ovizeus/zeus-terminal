// [2026-11-28] Settings › Security › Passkeys — intrare cu amprenta / fata / PIN-ul dispozitivului.
// Adaugarea cere parola (+ codul 2FA daca e pornit): o sesiune furata nu poate lasa in urma o usa noua.
// Doar pe web si doar cand serverul are PASSKEY_ENABLED — altfel sectiunea nu apare deloc.
import { useEffect, useState } from 'react'
import { api } from '../../services/api'
import { addPasskey, deviceName, passkeySupported, type PasskeyInfo } from '../../services/passkey'

type Step = 'idle' | 'add' | 'remove'
const inp = { flex: 1, minWidth: 0, background: '#0a0f16', border: '1px solid #1e2a38', color: '#cde', padding: '5px 7px', borderRadius: '3px', fontSize: '11px' } as const
const note = { fontSize: '10px', color: '#556', marginBottom: '8px', lineHeight: '1.6' } as const
const fmt = (t: number | null) => (t ? new Date(t).toISOString().slice(0, 10) : 'never')

export function PasskeySection() {
  const [supported] = useState(passkeySupported)
  const [enabled, setEnabled] = useState(false)
  const [needsCode, setNeedsCode] = useState(false)
  const [list, setList] = useState<PasskeyInfo[]>([])
  const [step, setStep] = useState<Step>('idle')
  const [target, setTarget] = useState<PasskeyInfo | null>(null)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function load() {
    const r: any = await api.get('/api/passkeys').catch(() => null)
    if (r && r.ok) { setEnabled(!!r.enabled); setNeedsCode(!!r.needsCode); setList(Array.isArray(r.passkeys) ? r.passkeys : []) }
  }
  useEffect(() => { if (supported) void load() }, [supported])

  function reset(next: Step, t: PasskeyInfo | null = null) {
    setStep(next); setTarget(t); setPassword(''); setCode(''); setMsg('')
    if (next === 'add') setName(deviceName())
  }

  async function add() {
    setBusy(true); setMsg('')
    try {
      const r = await addPasskey(password, code, name)
      if (!r.ok) { setMsg(r.error); return }
      reset('idle'); await load(); setMsg('Passkey added. Next time, choose “Sign in with a passkey”.')
    } finally { setBusy(false) }
  }

  async function remove() {
    if (!target) return
    setBusy(true); setMsg('')
    try {
      const r: any = await api.post('/api/passkeys/remove', { id: target.id, password }).catch(() => null)
      if (!r || !r.ok) { setMsg((r && r.error) || 'Not removed — try again.'); return }
      reset('idle'); await load(); setMsg('Passkey removed.')
    } finally { setBusy(false) }
  }

  if (!supported || !enabled) return null
  return (
    <div data-passkey="section">
      <div className="msec" style={{ marginTop: '16px' }}>PASSKEYS</div>
      <div style={note}>
        Sign in with your fingerprint, face or screen lock instead of a password and code. A passkey works only on zeus-terminal.com, so a fake site can’t steal it.
      </div>

      {list.length === 0 && step === 'idle' && <div style={note}>No passkeys yet.</div>}
      {list.map((p) => (
        <div key={p.id} className="mrow" data-passkey="row" style={{ alignItems: 'center' }}>
          <span className="mlbl" style={{ color: '#cde' }}>{p.name}</span>
          <span style={{ fontSize: '10px', color: '#556', marginRight: '8px' }}>added {fmt(p.createdAt)} · last used {fmt(p.lastUsedAt)}</span>
          {step === 'idle' && (
            <button className="hub-sbtn" style={{ borderColor: '#ff335533', color: '#ff6655' }} onClick={() => reset('remove', p)}>Remove</button>
          )}
        </div>
      ))}

      {step === 'idle' && <button className="hub-sbtn pri" onClick={() => reset('add')}>Add a passkey</button>}

      {step === 'add' && (
        <div>
          <div className="mrow" style={{ marginBottom: '6px' }}><span className="mlbl">Name</span>
            <input type="text" data-passkey="name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} style={inp} />
          </div>
          <div className="mrow" style={{ marginBottom: '6px' }}><span className="mlbl">Current password</span>
            <input type="password" data-passkey="password" value={password} onChange={(e) => setPassword(e.target.value)} style={inp} autoComplete="current-password" />
          </div>
          {needsCode && (
            <div className="mrow" style={{ marginBottom: '6px' }}><span className="mlbl">2FA code</span>
              <input type="text" data-passkey="code" inputMode="numeric" autoComplete="one-time-code" maxLength={11} value={code} onChange={(e) => setCode(e.target.value)} style={inp} placeholder="000000" />
            </div>
          )}
          <div style={{ display: 'flex', gap: '6px' }}>
            <button className="hub-sbtn pri" disabled={busy || !password || (needsCode && !code.trim())} onClick={add}>Continue</button>
            <button className="hub-sbtn" onClick={() => reset('idle')}>Cancel</button>
          </div>
        </div>
      )}

      {step === 'remove' && target && (
        <div>
          <div style={note}>Remove “{target.name}”? It will no longer sign you in.</div>
          <div className="mrow" style={{ marginBottom: '6px' }}><span className="mlbl">Current password</span>
            <input type="password" data-passkey="password" value={password} onChange={(e) => setPassword(e.target.value)} style={inp} autoComplete="current-password" />
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button className="hub-sbtn" style={{ borderColor: '#ff335533', color: '#ff6655' }} disabled={busy || !password} onClick={remove}>Remove passkey</button>
            <button className="hub-sbtn" onClick={() => reset('idle')}>Cancel</button>
          </div>
        </div>
      )}

      {msg && <div role="status" style={{ marginTop: '6px', fontSize: '10px', color: '#8aa' }}>{msg}</div>}
    </div>
  )
}
