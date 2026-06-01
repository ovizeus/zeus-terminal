import { useEffect, useState } from 'react'
import { useATStore } from '../stores'
import { api } from '../services/api'

export function KillSwitchOverlay() {
  const killTriggered = useATStore((s) => s.killTriggered)
  const killReason = useATStore((s) => s.killReason)
  const killLoss = useATStore((s) => s.killLoss)
  const killLimit = useATStore((s) => s.killLimit)
  const [minimized, setMinimized] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset to the expanded state each time the kill switch newly activates.
  useEffect(() => {
    if (killTriggered) { setMinimized(false); setConfirming(false); setError(null); setBusy(false) }
  }, [killTriggered])

  if (!killTriggered) return null

  const lossStr = `$${Math.abs(Number(killLoss) || 0).toFixed(2)}`
  const limitStr = `$${Math.abs(Number(killLimit) || 0).toFixed(2)}`
  const why =
    killReason === 'daily_loss' ? `Your daily loss (${lossStr}) reached the limit (${limitStr}).`
    : killReason === 'manual' ? 'Trading was halted by a manual stop.'
    : 'Automated trading has been halted by the kill switch.'

  async function deactivate() {
    setBusy(true); setError(null)
    try {
      const res: any = await api.post('/api/at/kill/reset')
      if (res && res.ok === false) { setError(res.error || 'Reset failed — try again'); setBusy(false) }
      // success: killTriggered flips false on the next server sync → overlay unmounts
    } catch (e: any) {
      setError(e?.message || 'Reset failed — try again'); setBusy(false)
    }
  }

  if (minimized) {
    return (
      <button className="ks-badge" onClick={() => setMinimized(false)}
        title="Kill switch active — click to manage">KILL SWITCH</button>
    )
  }

  return (
    <div className="ks-overlay" role="alertdialog" aria-label="Kill switch active">
      <button className="ks-min" aria-label="Minimize" title="Minimize" onClick={() => setMinimized(true)}>▁</button>
      <div className="ks-title">KILL SWITCH</div>
      <div className="ks-msg">
        <p><strong>The kill switch is ACTIVE — all automated trading is stopped.</strong></p>
        <p>{why}</p>
      </div>
      {!confirming ? (
        <button className="ks-deact" onClick={() => setConfirming(true)}>Deactivate</button>
      ) : (
        <div className="ks-confirm">
          <p><strong>Deactivate the kill switch?</strong></p>
          <p>{why}</p>
          <p>This re-enables automated trading. It will NOT trigger again at this level — only if you lose a further {limitStr} this trading day.</p>
          {error && <p className="ks-err">{error}</p>}
          <div className="ks-confirm-btns">
            <button className="ks-deact" disabled={busy} onClick={deactivate}>{busy ? '…' : 'Confirm deactivate'}</button>
            <button className="ks-cancel" disabled={busy} onClick={() => { setConfirming(false); setError(null) }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
