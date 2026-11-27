// [2026-11-27] Settings › Security › Anti-phishing code (ca la Binance): un cuvant ales de utilizator apare
// in FIECARE email Zeus catre el. Un email „de la Zeus" fara cuvant = fals.
import { useEffect, useState } from 'react'

const note = { fontSize: '10px', color: '#556', marginBottom: '8px', lineHeight: '1.6' } as const
const inp = { flex: 1, minWidth: 0, background: '#0a0f16', border: '1px solid #1e2a38', color: '#cde', padding: '5px 7px', borderRadius: '3px', fontSize: '11px' } as const

export function AntiPhishingSection() {
  const [code, setCode] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch('/auth/security/anti-phishing', { credentials: 'same-origin' })
      .then((r) => r.json()).then((j) => { if (j && j.ok) setCode(j.code || '') }).catch(() => {})
  }, [])

  async function save() {
    setBusy(true); setMsg('')
    try {
      const r = await fetch('/auth/security/anti-phishing', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Zeus-Request': '1' },
        body: JSON.stringify({ code: code.trim() }),
      })
      const j = await r.json().catch(() => ({}))
      if (j && j.ok) setMsg(j.code ? 'Saved. Every email from Zeus now shows this code.' : 'Removed.')
      else setMsg((j && j.error) || 'Not saved — try again.')
    } catch { setMsg('Not saved — try again.') } finally { setBusy(false) }
  }

  return (
    <div>
      <div className="msec" style={{ marginTop: '16px' }}>ANTI-PHISHING CODE</div>
      <div style={note}>Pick a word only you know. Every email from Zeus will show it at the top — an email without it is not from us.</div>
      <div className="mrow" style={{ marginBottom: '6px' }}><span className="mlbl">Your code</span>
        <input type="text" data-antiphish value={code} maxLength={20} onChange={(e) => setCode(e.target.value)} style={inp} placeholder="e.g. Blue Fox" />
      </div>
      <button className="hub-sbtn pri" disabled={busy} onClick={save}>Save code</button>
      {msg && <div role="status" style={{ marginTop: '6px', fontSize: '10px', color: '#8aa' }}>{msg}</div>}
    </div>
  )
}
