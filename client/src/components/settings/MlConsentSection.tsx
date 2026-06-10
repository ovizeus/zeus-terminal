/**
 * [REAL-GATE P0-3 2026-06-09] ML Live Influence consent.
 * Real-money ML influence requires explicit, audited, per-user opt-in —
 * enforced server-side at influence-eligibility level (live_optin_missing).
 * This chip is the only UI that flips it.
 * [2026-06-10 v2] Single rendering: Omega page header chip (the Settings
 * modal that hosted the full section was dead code and has been deleted).
 * [2026-06-10 v3 operator feedback] Confirm step is a dedicated modal
 * (zr-modal house classes, same as the old SettingsModal) instead of inline
 * text squeezed into the header row; buttons are OPT IN ML / REVOKE ML.
 * BOTH opt-in AND revoke require the explicit confirm, each with a
 * one-sentence explanation of what ON / OFF means for real-money trades.
 * Overlay click and CANCEL both close without POSTing.
 * Fail-closed: UNKNOWN (GET failed) renders the badge only, no buttons.
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { toast } from '../../data/marketDataHelpers'

const CONFIRM_COPY = {
    optin: {
        title: 'Enable ML on REAL',
        body: 'Once REAL trading is enabled, ML may adjust the confidence of your real-money trades. Every change is audited. You can turn it off anytime.',
    },
    revoke: {
        title: 'Disable ML on REAL',
        body: 'ML immediately stops influencing your REAL-money trades. You can opt in again anytime.',
    },
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
            {optedIn === false && (
                <button type="button" className="omega-nav-button" disabled={busy} onClick={() => setConfirming('optin')}>
                    OPT IN ML
                </button>
            )}
            {optedIn === true && (
                <button type="button" className="omega-nav-button" disabled={busy} onClick={() => setConfirming('revoke')}>
                    REVOKE ML
                </button>
            )}
            {confirming !== null && createPortal(
                <div
                    className="zr-modal-overlay"
                    data-testid="ml-consent-overlay"
                    /* portal + z-index: the chip lives inside .zpv (z-index 900,
                       its own stacking context) — rendered inline, the fixed
                       overlay was trapped under the Omega orb artwork. */
                    style={{ zIndex: 9999 }}
                    onClick={e => { if (e.target === e.currentTarget) setConfirming(null) }}
                >
                    <div className="zr-modal" role="dialog" aria-modal="true" aria-label={CONFIRM_COPY[confirming].title}>
                        <div className="zr-modal__header">
                            <span>{CONFIRM_COPY[confirming].title}</span>
                            <button type="button" className="zr-modal__close" aria-label="Close" onClick={() => setConfirming(null)}>✕</button>
                        </div>
                        <div className="zr-modal__body">
                            <p style={{ margin: '0 0 16px', fontSize: 12, lineHeight: 1.6, color: 'var(--txt)' }}>
                                {CONFIRM_COPY[confirming].body}
                            </p>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                                <button type="button" className="sbtn2 pri" disabled={busy} onClick={() => apply(confirming === 'optin')}>
                                    CONFIRM
                                </button>
                                <button type="button" className="sbtn2 sec" disabled={busy} onClick={() => setConfirming(null)}>
                                    CANCEL
                                </button>
                            </div>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </>
    )
}
