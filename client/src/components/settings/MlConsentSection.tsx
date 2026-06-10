/**
 * [REAL-GATE P0-3 2026-06-09] ML Live Influence consent.
 * Real-money ML influence requires explicit, audited, per-user opt-in —
 * enforced server-side at influence-eligibility level (live_optin_missing).
 * This section is the only UI that flips it. Opt-in needs a confirm step;
 * revoking is one click (withdrawing consent must always be easy).
 */
import { useEffect, useState } from 'react'
import { toast } from '../../data/marketDataHelpers'

export function MlConsentSection() {
    const [optedIn, setOptedIn] = useState<boolean | null>(null)
    const [busy, setBusy] = useState(false)
    const [confirming, setConfirming] = useState(false)

    useEffect(() => {
        let alive = true
        fetch('/api/ring5/live-optin', { credentials: 'same-origin' })
            .then(r => r.json())
            .then(d => { if (alive && d && d.ok) setOptedIn(!!d.optedIn) })
            .catch(() => { /* stays null = UNKNOWN */ })
        return () => { alive = false }
    }, [])

    const apply = async (next: boolean) => {
        setBusy(true)
        try {
            const r = await fetch('/api/ring5/live-optin', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', 'X-Zeus-Request': '1' },
                body: JSON.stringify({ optedIn: next }),
            })
            const d = await r.json()
            if (d && d.ok) setOptedIn(!!d.optedIn)
            else toast('Failed to update ML consent')
        } catch { toast('Failed to update ML consent') /* keep previous state */ }
        finally { setBusy(false); setConfirming(false) }
    }

    const badge = optedIn === null ? 'UNKNOWN' : optedIn ? 'OPTED IN' : 'NOT OPTED IN'

    return (
        <div className="zr-settings-subsection">
            <h4>ML Influence on REAL (consent)</h4>
            <p className="zr-settings-desc">
                When REAL trading goes live, the ML layer may adjust decision
                confidence only if you have explicitly opted in here. Stored
                server-side, audited, revocable at any time.
            </p>
            <p className="zr-settings-meta">Status: <strong>{badge}</strong></p>
            {optedIn === false && !confirming && (
                <button className="zr-btn" disabled={busy} onClick={() => setConfirming(true)}>
                    Opt in
                </button>
            )}
            {confirming && (
                <div className="zr-confirm-block">
                    <p>Are you sure? This allows ML to influence REAL-money trade confidence once REAL trading is enabled.</p>
                    <button className="zr-btn zr-btn-danger" disabled={busy} onClick={() => apply(true)}>
                        Confirm opt-in
                    </button>
                    <button className="zr-btn" disabled={busy} onClick={() => setConfirming(false)}>
                        Cancel
                    </button>
                </div>
            )}
            {optedIn === true && (
                <button className="zr-btn" disabled={busy} onClick={() => apply(false)}>
                    Revoke consent
                </button>
            )}
        </div>
    )
}
