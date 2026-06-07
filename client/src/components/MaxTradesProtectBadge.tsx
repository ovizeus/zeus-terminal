import { useState } from 'react'
import { useATStore } from '../stores'
import { api } from '../services/api'

/**
 * [T-MAXTRADES 2026-06-07] On-screen control for the server-side daily
 * max-trades protection. Mirrors the kill-switch UX: shows when the protection
 * is blocking (at the daily cap, armed) with a DISABLE button; when the
 * operator disables it, it stays off until the next UTC day (auto-re-arms) and
 * shows a small RE-ENABLE control. Server truth comes from atStore.maxDayProtect
 * (getFullState); the toggle hits POST /api/at/maxday-protect.
 */
export function MaxTradesProtectBadge() {
  const mp = useATStore((s) => s.maxDayProtect)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Only relevant when the cap is configured AND either blocking or disabled
  // today. Otherwise render nothing (under cap / not configured).
  if (!mp || !mp.configured) return null
  if (!mp.blocking && !mp.disabledToday) return null

  async function toggle(enabled: boolean) {
    setBusy(true); setError(null)
    try {
      const res: any = await api.post('/api/at/maxday-protect', { enabled })
      if (res && res.ok === false) { setError(res.error || 'Failed — try again') }
      // success: atStore.maxDayProtect updates on the next server sync
    } catch (e: any) {
      setError(e?.message || 'Failed — try again')
    } finally {
      setBusy(false)
    }
  }

  if (mp.disabledToday) {
    return (
      <div className="mtp-badge mtp-off" role="status" title="Max trades/day protection is OFF until the next UTC day">
        <span className="mtp-label">MAX TRADES/DAY — OFF until tomorrow ({mp.dailyEntries}/{mp.maxDay})</span>
        <button className="mtp-btn" disabled={busy} onClick={() => toggle(true)}>{busy ? '…' : 'Re-enable'}</button>
        {error && <span className="mtp-err">{error}</span>}
      </div>
    )
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
