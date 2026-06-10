/**
 * [REAL-GATE P0-3 2026-06-09] ML Live Influence consent.
 * Real-money ML influence requires explicit, audited, per-user opt-in —
 * enforced server-side at influence-eligibility level (live_optin_missing).
 * This section is the only UI that flips it. Opt-in needs a confirm step;
 * revoking is one click (withdrawing consent must always be easy).
 * [2026-06-10] Lives in the Omega page header (compact mode) — the Settings
 * modal that originally hosted it is dead code (never opened).
 */
import { useEffect, useState } from 'react'
import { toast } from '../../data/marketDataHelpers'

export function MlConsentSection({ compact = false }: { compact?: boolean } = {}) {
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

    if (compact) {
        // Omega header rendering — same state machine + fetch logic, header-chip
        // markup. Fail-closed: UNKNOWN renders the badge only, no buttons.
        return (
            <>
                <span
                    className="omega-meta-item"
                    title="ML influence on REAL-money trades requires your explicit, audited consent. Revocable at any time."
                >
                    <span className="omega-meta-label">ML·REAL</span>
                    <span className="omega-meta-val">{badge}</span>
                </span>
                {optedIn === false && !confirming && (
                    <button type="button" className="omega-nav-button" disabled={busy} onClick={() => setConfirming(true)}>
                        OPT IN
                    </button>
                )}
                {confirming && (
                    <>
                        <span className="omega-meta-val">Are you sure?</span>
                        <button type="button" className="omega-nav-button" disabled={busy} onClick={() => apply(true)}>
                            CONFIRM
                        </button>
                        <button type="button" className="omega-nav-button" disabled={busy} onClick={() => setConfirming(false)}>
                            CANCEL
                        </button>
                    </>
                )}
                {optedIn === true && (
                    <button type="button" className="omega-nav-button" disabled={busy} onClick={() => apply(false)}>
                        REVOKE
                    </button>
                )}
            </>
        )
    }

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
