// [2026-11-27] Admin › Users: inscrierile on/off + stergerea tuturor conturilor blocate, odata.
// Dupa atacul cu boti (13–27 nov): in locul unui link cu parola in adresa, un comutator in panou;
// in locul stergerii unul cate unul a zeci de conturi-bot, o singura actiune cu confirmare scrisa.
import { useEffect, useState } from 'react'
import { ConfirmDialog } from '../shared/components'

const POST = (url: string, body: unknown) => fetch(url, {
  method: 'POST', credentials: 'include',
  headers: { 'Content-Type': 'application/json', 'X-Zeus-Request': '1' },
  body: JSON.stringify(body),
})

export function SignupControls({ blockedCount, onChanged }: { blockedCount: number; onChanged: () => void }) {
  const [open, setOpen] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [ask, setAsk] = useState(false)
  const [askToggle, setAskToggle] = useState(false)   // [2026-11-28] comutarea cere confirmare
  const [msg, setMsg] = useState('')

  useEffect(() => {
    let alive = true
    fetch('/auth/admin/registration', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && j && j.ok) setOpen(!!j.open) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  async function toggle() {
    setAskToggle(false)
    if (open === null) return
    setBusy(true)
    try {
      const r = await POST('/auth/admin/registration', { open: !open })
      const j = r.ok ? await r.json() : null
      if (j && j.ok) { setOpen(!!j.open); setMsg(j.open ? 'Sign-ups opened.' : 'Sign-ups closed — new accounts are refused.') }
      else setMsg('Not saved — try again.')
    } catch { setMsg('Not saved — try again.') } finally { setBusy(false) }
  }

  async function deleteBlocked() {
    setAsk(false); setBusy(true)
    try {
      const r = await POST('/auth/admin/delete-blocked', { confirm: 'DELETE BLOCKED' })
      const j = r.ok ? await r.json() : null
      if (j && j.ok) { setMsg(`${j.deleted} blocked accounts deleted.`); onChanged() }
      else setMsg('Delete failed — try again.')
    } catch { setMsg('Delete failed — try again.') } finally { setBusy(false) }
  }

  return (
    <div className="zac-filters" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
      <span style={{ fontWeight: 700, color: open === false ? '#ff6b81' : '#3ddc97' }}>
        Sign-ups: {open === null ? '…' : open ? 'OPEN' : 'CLOSED'}
      </span>
      <button className="zac-btn" disabled={busy || open === null} onClick={() => setAskToggle(true)}>
        {open ? 'Close sign-ups' : 'Open sign-ups'}
      </button>
      <button className="zac-btn zac-btn-danger" disabled={busy || blockedCount === 0} onClick={() => setAsk(true)}>
        Delete all blocked ({blockedCount})
      </button>
      {msg && <span role="status" style={{ fontSize: 12, color: 'var(--dim, #8aa)' }}>{msg}</span>}
      {askToggle && open !== null && (
        <ConfirmDialog
          title={open ? 'Close sign-ups?' : 'Open sign-ups?'}
          message={open
            ? 'New accounts will be refused until you open sign-ups again. Existing accounts keep signing in as usual.'
            : 'Anyone will be able to create a new account again.'}
          confirmText={open ? 'Close' : 'Open'} tone={open ? 'danger' : 'default'}
          onConfirm={toggle} onCancel={() => setAskToggle(false)}
        />
      )}
      {ask && (
        <ConfirmDialog
          title="Delete all blocked accounts?"
          message={`${blockedCount} blocked accounts will be deleted permanently, with their data. Admin accounts are never touched. This cannot be undone.`}
          confirmText="Delete" tone="danger" requireType="DELETE BLOCKED"
          onConfirm={deleteBlocked} onCancel={() => setAsk(false)}
        />
      )}
    </div>
  )
}
