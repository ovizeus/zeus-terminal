import { useEffect, useState } from 'react'

/** Emergency — Global Trading Lock.
 *  Real binding to the server halt API (GET/POST /api/admin/halt → serverAT
 *  setGlobalHalt/getGlobalHaltState). Arming blocks ALL new trade entries for
 *  every user and engine, server-side, until disarmed. Open positions are NOT
 *  force-closed. Admin-only route; the global fetch patch adds the CSRF header
 *  (we also set X-Zeus-Request explicitly for safety). */

interface HaltState { active: boolean; by: number | null; ts: number | null; reason: string | null }

export function GlobalHaltControl() {
  const [state, setState] = useState<HaltState | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirm, setConfirm] = useState<null | boolean>(null) // target `active` awaiting confirmation
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')

  const load = () => {
    setLoading(true)
    fetch('/api/admin/halt', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d) => {
        setState({ active: !!d.active, by: d.by ?? null, ts: d.ts ?? null, reason: d.reason ?? null })
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const apply = async (active: boolean) => {
    setBusy(true)
    try {
      const r = await fetch('/api/admin/halt', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Zeus-Request': '1' },
        body: JSON.stringify({ active, reason: active ? 'emergency_admin_panel' : 'admin_panel_resume' }),
      })
      const d = await r.json()
      if (d.ok) { setToast(active ? '⛔ Global halt ARMED — all trading stopped' : '✓ Halt disarmed — trading resumed'); load() }
      else setToast('✕ ' + (d.error || 'Failed'))
    } catch (e: any) { setToast('✕ ' + (e.message || 'Network error')) }
    setBusy(false)
    setTimeout(() => setToast(''), 4000)
  }

  const armed = state?.active === true

  return (
    <div className="zac-panel" id="globalHalt">
      <div className="zac-panel-header">
        <div className="zac-panel-title">Emergency — Global Trading Lock</div>
        <button className="zac-btn zac-btn-sm zac-btn-ghost" onClick={load} title="Refresh">↻</button>
      </div>

      <div style={{ padding: '14px 18px' }}>
        {loading && !state && <div style={{ fontSize: 11, color: 'var(--ac-fg-mute)' }}>Loading…</div>}
        {state && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{
                width: 10, height: 10, borderRadius: '50%',
                background: armed ? 'var(--ac-danger)' : 'var(--ac-success)',
                boxShadow: armed ? '0 0 10px var(--ac-danger)' : '0 0 8px var(--ac-success)',
              }} />
              <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1, color: armed ? 'var(--ac-danger)' : 'var(--ac-success)' }}>
                {armed ? 'TRADING HALTED' : 'TRADING ACTIVE'}
              </div>
            </div>
            <div style={{ fontSize: 10, color: 'var(--ac-fg-dim)', marginBottom: 14, lineHeight: 1.6 }}>
              {armed
                ? `Global halt is ARMED — every new entry (all users, all engines) is blocked server-side.${state.by ? ` By uid ${state.by}.` : ''}${state.reason ? ` Reason: ${state.reason}.` : ''}`
                : 'When armed, the server blocks ALL new trade entries for every user and engine until you disarm it. Open positions are not force-closed.'}
            </div>
            <button
              className={`zac-btn ${armed ? 'zac-btn-primary' : 'zac-btn-danger'}`}
              disabled={busy}
              onClick={() => setConfirm(!armed)}
            >
              {armed ? 'Disarm — resume trading' : '⛔ Arm global halt (stop all trading)'}
            </button>
          </>
        )}
      </div>

      {confirm !== null && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 9900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#0d1520', border: '1px solid var(--ac-danger)', borderRadius: 8, padding: 22, maxWidth: 460 }}>
            <div style={{ color: 'var(--ac-danger)', fontSize: 12, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 10 }}>
              {confirm ? 'Arm global trading halt?' : 'Disarm global halt?'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--ac-fg-dim)', marginBottom: 14, lineHeight: 1.6 }}>
              {confirm
                ? 'This immediately blocks ALL new trade entries for every user and engine, server-side. Open positions stay open. Use only in an emergency.'
                : 'This resumes normal trading — new entries will be allowed again for all users and engines.'}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="zac-btn zac-btn-ghost zac-btn-sm" onClick={() => setConfirm(null)}>Cancel</button>
              <button
                className={`zac-btn zac-btn-sm ${confirm ? 'zac-btn-danger' : 'zac-btn-primary'}`}
                onClick={() => { const target = confirm; setConfirm(null); apply(target as boolean) }}
              >
                {confirm ? 'Arm halt' : 'Disarm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24,
          background: toast.startsWith('✕') ? '#3a0020' : '#2a2400',
          border: '1px solid ' + (toast.startsWith('✕') ? '#ff4d4d' : '#f0c040'),
          color: toast.startsWith('✕') ? '#ff8888' : '#ffe08a',
          padding: '10px 16px', borderRadius: 6, fontSize: 11, letterSpacing: 1, zIndex: 9800,
          boxShadow: '0 4px 16px rgba(0,0,0,.5)',
        }}>{toast}</div>
      )}
    </div>
  )
}
