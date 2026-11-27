// [2026-11-27] Settings › Security › Sign-ins: ultimele 10 intrari (ora UTC, IP, dispozitiv) si
// „Sign out everywhere else" — toate celelalte sesiuni se inchid, aceasta ramane (token nou de la server).
import { useEffect, useState } from 'react'
import { appConfirm } from '../common/confirmDialog'

type SignIn = { ip: string | null; at: string; device: string | null }
const note = { fontSize: '10px', color: '#556', marginBottom: '8px', lineHeight: '1.6' } as const

export function SessionsSection() {
  const [rows, setRows] = useState<SignIn[] | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    try {
      const r = await fetch('/auth/security/recent-signins', { credentials: 'same-origin' })
      const j = await r.json()
      if (j && j.ok) setRows(j.signins || [])
    } catch { /* fara lista */ }
  }
  useEffect(() => { void load() }, [])

  async function signOutOthers() {
    const { confirmed } = await appConfirm({
      title: 'Sign out everywhere else', tone: 'danger', confirmLabel: 'Sign out others', cancelLabel: 'Cancel',
      body: 'Every other phone, tablet or browser signed in to this account is signed out now. This one stays signed in.',
    })
    if (!confirmed) return
    setBusy(true); setMsg('')
    try {
      const r = await fetch('/auth/security/logout-others', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Zeus-Request': '1' }, body: '{}',
      })
      const j = await r.json().catch(() => ({}))
      setMsg(j && j.ok ? 'Done — you are signed out everywhere else.' : 'Not done — try again.')
    } catch { setMsg('Not done — try again.') } finally { setBusy(false) }
  }

  return (
    <div>
      <div className="msec" style={{ marginTop: '16px' }}>SIGN-INS</div>
      <div style={note}>The last sign-ins to your account. If you don’t recognise one, change your password and sign out everywhere else.</div>
      {rows && rows.length === 0 && <div style={note}>No sign-ins recorded yet.</div>}
      {rows && rows.length > 0 && (
        <div style={{ fontSize: '10px', color: '#8aa', marginBottom: '8px', lineHeight: '1.7' }}>
          {rows.map((r, i) => (
            <div key={i}>{String(r.at).slice(0, 16)} UTC · {r.ip || 'unknown IP'} · {r.device || 'unknown device'}</div>
          ))}
        </div>
      )}
      <button className="hub-sbtn" style={{ borderColor: '#ff335533', color: '#ff6655' }} disabled={busy} onClick={signOutOthers}>Sign out everywhere else</button>
      {msg && <div role="status" style={{ marginTop: '6px', fontSize: '10px', color: '#8aa' }}>{msg}</div>}
    </div>
  )
}
