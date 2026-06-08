import { useState } from 'react'
import { useATStore } from '../stores'
import { api } from '../services/api'

/**
 * [T-MAXTRADES 2026-06-07] On-screen control for the server-side daily
 * max-trades protection. Shows ONLY while actively blocking (at the daily cap,
 * armed) with a DISABLE button.
 * [MTP-DISMISS 2026-06-08] Operator: once disabled the badge must disappear
 * COMPLETELY (no lingering "OFF / Re-enable" chip — it was annoying on screen).
 * Disabling resets the counter to 0 server-side and keeps the cap off until the
 * next UTC day (auto-re-arm), so `blocking` goes false → this renders nothing.
 * Disabling NEVER closes open positions — they keep running under DSL.
 * Server truth comes from atStore.maxDayProtect (getFullState); the toggle hits
 * POST /api/at/maxday-protect.
 */
export function MaxTradesProtectBadge() {
  const mp = useATStore((s) => s.maxDayProtect)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Render ONLY while the protection is actively blocking new entries. Disabled
  // (disabledToday) or under cap → render nothing (badge gone).
  if (!mp || !mp.configured) return null
  if (!mp.blocking) return null

  async function toggle(enabled: boolean) {
    setBusy(true); setError(null)
    try {
      const res: any = await api.post('/api/at/maxday-protect', { enabled })
      if (res && res.ok === false) { setError(res.error || 'Failed — try again') }
      // success: atStore.maxDayProtect updates on the next server sync → blocking
      // becomes false → this component unmounts (badge disappears).
    } catch (e: any) {
      setError(e?.message || 'Failed — try again')
    } finally {
      setBusy(false)
    }
  }

  // blocking (at cap, armed)
  return (
    <div className="mtp-badge mtp-on" role="alert" title="Daily max-trades protection is blocking new auto-entries">
      <span className="mtp-label">PROTECT: MAX TRADES/DAY ({mp.dailyEntries}/{mp.maxDay})</span>
      <button className="mtp-btn" disabled={busy} onClick={() => toggle(false)}>{busy ? '…' : 'Disable for today'}</button>
      {error && <span className="mtp-err">{error}</span>}
    </div>
  )
}
