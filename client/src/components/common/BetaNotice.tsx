// [BETA-GATE 2026-11-13] Mesajul aratat cand un cont 'viewer' atinge o functie
// sub lacat, si eticheta discreta din antet. O singura fereastra pentru toata
// aplicatia: oriunde ar fi butonul, raspunsul arata la fel.
import { useEffect, useState } from 'react'
import { BETA_MESSAGE, BETA_BADGE, currentBetaNotice, hideBetaNotice, onBetaNotice } from '../../core/betaGate'
import { useAuthStore } from '../../stores'

export function BetaNotice() {
  const [feature, setFeature] = useState<string | null>(currentBetaNotice())
  useEffect(() => onBetaNotice(setFeature), [])
  useEffect(() => {
    if (!feature) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hideBetaNotice() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [feature])
  if (!feature) return null
  return (
    <div className="zbeta-ov" role="dialog" aria-modal="true" aria-labelledby="zbeta-t" onClick={hideBetaNotice}>
      <div className="zbeta-box" onClick={(e) => e.stopPropagation()}>
        <div className="zbeta-lock" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="26" height="26">
            <rect x="5" y="10.5" width="14" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
            <path d="M8 10.5V7.6a4 4 0 018 0v2.9" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            <circle cx="12" cy="15.4" r="1.4" fill="currentColor" />
          </svg>
        </div>
        <div className="zbeta-t" id="zbeta-t">{feature} is locked during beta</div>
        <div className="zbeta-m">{BETA_MESSAGE}</div>
        <div className="zbeta-s">You have full access to the chart, indicators, market data and the liquidation map.</div>
        <button className="zbeta-ok" autoFocus onClick={hideBetaNotice}>Got it</button>
      </div>
    </div>
  )
}

/** Eticheta din antet, doar pentru viewer. */
export function BetaBadge() {
  const level = useAuthStore((s) => s.accessLevel)
  const known = useAuthStore((s) => s.accessKnown)
  const authed = useAuthStore((s) => s.authenticated)
  if (!authed || !known || level === 'full') return null
  return <span className="zbeta-badge" title={BETA_MESSAGE}>{BETA_BADGE}</span>
}
