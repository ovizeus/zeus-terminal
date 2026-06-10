/**
 * [REAL-GATE P0-3 2026-06-09] ML Live Influence consent.
 * Real-money ML influence requires explicit, audited, per-user opt-in —
 * enforced server-side at influence-eligibility level (live_optin_missing).
 * This chip is the only UI that flips it.
 * [2026-06-10 v2] Single rendering: Omega page header chip (the Settings
 * modal that hosted the full section was dead code and has been deleted).
 * BOTH opt-in AND revoke require an explicit confirm step, each with a
 * one-sentence explanation of what ON / OFF means for real-money trades.
 * Fail-closed: UNKNOWN (GET failed) renders the badge only, no buttons.
 */
import { useEffect, useState } from 'react'
import { toast } from '../../data/marketDataHelpers'

const CONFIRM_TEXT = {
    optin: 'Turn ON: once REAL trading is enabled, ML may adjust the confidence of your real-money trades. Every change is audited. You can turn it off anytime.',
    revoke: 'Turn OFF: ML immediately stops influencing your REAL-money trades. You can opt in again anytime.',
} as const

export function MlConsentSection() {
    const [optedIn, setOptedIn] = useState<boolean | null>(null)
    const [busy, setBusy] = useState(false)
    const [confirming, setConfirming] = useState<null | 'optin' | 'revoke'>(null)

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
        finally { setBusy(false); setConfirming(null) }
    }

    const badge = optedIn === null ? 'UNKNOWN' : optedIn ? 'OPTED IN' : 'NOT OPTED IN'

    return (
        <>
            <span
                className="omega-meta-item"
                title="ML influence on REAL-money trades requires your explicit, audited consent. Revocable at any time."
            >
                <span className="omega-meta-label">ML·REAL</span>
                <span className="omega-meta-val">{badge}</span>
            </span>
            {optedIn === false && confirming === null && (
                <button type="button" className="omega-nav-button" disabled={busy} onClick={() => setConfirming('optin')}>
                    OPT IN
                </button>
            )}
            {optedIn === true && confirming === null && (
                <button type="button" className="omega-nav-button" disabled={busy} onClick={() => setConfirming('revoke')}>
                    REVOKE
                </button>
            )}
            {confirming !== null && (
                <>
                    <span className="omega-meta-val">{CONFIRM_TEXT[confirming]}</span>
                    <button type="button" className="omega-nav-button" disabled={busy} onClick={() => apply(confirming === 'optin')}>
                        CONFIRM
                    </button>
                    <button type="button" className="omega-nav-button" disabled={busy} onClick={() => setConfirming(null)}>
                        CANCEL
                    </button>
                </>
            )}
        </>
    )
}
