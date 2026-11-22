// [2026-11-22] Alerts › Phone notifications — ce trimite serverul pe telefon (aplicatia Android).
// Fiecare casuta se salveaza IMEDIAT pe server (nu depinde de SAVE — serverul trimite notificarile
// si cu aplicatia inchisa, deci alegerea trebuie sa fie acolo).
import { useEffect, useState } from 'react'

type Prefs = { support: boolean; price: boolean; atEntry: boolean; atExit: boolean; safety: boolean }
const ROWS: Array<{ key: keyof Prefs; label: string; hint: string }> = [
  { key: 'support', label: 'Support & admin messages', hint: 'Replies from support; for admins, new messages and accounts to approve' },
  { key: 'atEntry', label: 'Auto-trade entries', hint: 'When auto-trade opens a position' },
  { key: 'atExit', label: 'Auto-trade exits', hint: 'When auto-trade closes a position, with the P&L' },
  { key: 'price', label: 'Big price moves', hint: 'BTC, ETH, SOL, BNB, XRP, DOGE, LINK move 3% or more within an hour (once per 3 h per coin)' },
  { key: 'safety', label: 'Safety alerts', hint: 'Kill switch, a position without stop loss, a failed emergency close' },
]

export function PhoneNotifySection() {
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/notify/prefs', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive) { if (j && j.ok) setPrefs(j.prefs); else setErr('Could not load your phone notification settings.') } })
      .catch(() => { if (alive) setErr('Could not load your phone notification settings.') })
    return () => { alive = false }
  }, [])

  function toggle(key: keyof Prefs, value: boolean) {
    if (!prefs) return
    const prev = prefs
    setPrefs({ ...prefs, [key]: value })
    fetch('/api/notify/prefs', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Zeus-Request': '1' },
      body: JSON.stringify({ [key]: value }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j && j.ok) { setPrefs(j.prefs); setErr(null) } else { setPrefs(prev); setErr('Not saved — try again.') } })
      .catch(() => { setPrefs(prev); setErr('Not saved — try again.') })
  }

  return (
    <div id="phoneNotifySection" style={{ background: '#0d1018', border: '1px solid #4da3ff33', borderRadius: 6, padding: 10, marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: '#7cc0ff', fontWeight: 700 }}>Phone notifications</div>
      <div style={{ fontSize: 8, color: 'var(--dim)', margin: '2px 0 8px' }}>
        Sent to the Zeus Android app, even when it is closed. Checked every 15 minutes. Each change is saved right away.
      </div>
      {err && <div role="alert" style={{ fontSize: 9, color: '#ff6b81', marginBottom: 6 }}>{err}</div>}
      {!prefs && !err && <div style={{ fontSize: 9, color: 'var(--dim)' }}>Loading…</div>}
      {prefs && ROWS.map((r) => (
        <label key={r.key} className="mchk" style={{ display: 'block', margin: '4px 0' }}>
          <input type="checkbox" data-notify-key={r.key} checked={prefs[r.key]}
            onChange={(e) => toggle(r.key, e.target.checked)} /> {r.label}
          <div style={{ fontSize: 8, color: 'var(--dim)', marginLeft: 20 }}>{r.hint}</div>
        </label>
      ))}
    </div>
  )
}
