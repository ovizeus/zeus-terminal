// [BETA-GATE 2026-11-13] Mesajul aratat cand un cont 'viewer' apasa pe o functie
// sub lacat, si eticheta discreta din antet. O singura fereastra pentru toata
// aplicatia: oriunde ar fi butonul, raspunsul arata la fel.
//
// Apare DOAR la o apasare a utilizatorului, niciodata dintr-o cerere de fundal.
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
        <div className="zbeta-hd">
          <span className="zbeta-lock" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18">
              <rect x="5" y="10.5" width="14" height="10" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path d="M8.2 10.5V7.7a3.8 3.8 0 017.6 0v2.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </span>
          <span className="zbeta-kicker">Beta access</span>
        </div>
        <h2 className="zbeta-t" id="zbeta-t">{feature} opens at launch</h2>
        <p className="zbeta-m">{BETA_MESSAGE}</p>
        <div className="zbeta-inc">
          <span className="zbeta-inc-l">Included in your account</span>
          <span className="zbeta-inc-v">Chart · Indicators · Market data · Liquidation map</span>
        </div>
        <button className="zbeta-ok" autoFocus onClick={hideBetaNotice}>Understood</button>
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
