// Zeus — components/modals/SecurityNudgeModal.tsx
// [BATCH3-R] First-run security suggestion shown on native (Android) launches
// when neither a PIN nor biometric unlock is configured. Mirrors the nudge
// pattern used by banking / broker apps: you're protecting live-trading state
// from whoever picks up the unlocked phone.
// Snooze: 48h local-only (zeus_security_nudge_snooze_ts). Dismiss = snooze.
import { useEffect, useState } from 'react'
import { _pinIsSet } from '../../core/bootstrapMisc'
import { isNative, isPluginInstalled, isAvailable as bioIsAvailable, isEnabled as bioIsEnabled } from '../../services/biometric'
import { useUiStore } from '../../stores/uiStore'

const SNOOZE_KEY = 'zeus_security_nudge_snooze_ts'
const SNOOZE_MS = 48 * 60 * 60 * 1000

export function SecurityNudgeModal() {
  const [visible, setVisible] = useState(false)
  const [hasBio, setHasBio] = useState(false)
  const openModal = useUiStore((s) => s.openModal)

  useEffect(() => {
    if (!isNative()) return
    let cancelled = false
    let pollTimer: any = null
    async function decide() {
      try {
        const snoozeRaw = localStorage.getItem(SNOOZE_KEY)
        if (snoozeRaw) {
          const snoozeTs = Number(snoozeRaw)
          if (Number.isFinite(snoozeTs) && Date.now() < snoozeTs) return
        }
      } catch (_) {}
      const pinOn = await _pinIsSet()
      if (cancelled) return
      if (pinOn) return
      if (bioIsEnabled()) return
      let bioReady = false
      if (isPluginInstalled()) {
        const r = await bioIsAvailable()
        if (cancelled) return
        bioReady = !!r.available
      }
      setHasBio(bioReady)
      // [BATCH3-T] Wait for Welcome Commander modal to close before showing the
      // security nudge — otherwise both sit stacked on top of each other on
      // first-launch. Welcome opens at boot+2.5s; nudge must come *after*
      // user dismisses it. Safety cap: 30s absolute max wait.
      const deadline = Date.now() + 30000
      function isWelcomeOpen(): boolean {
        try {
          const el = document.getElementById('mwelcome')
          if (!el) return false
          const d = (el as HTMLElement).style.display
          if (d === 'none' || d === '') return false
          return true
        } catch (_) { return false }
      }
      function tryShow() {
        if (cancelled) return
        if (!isWelcomeOpen() || Date.now() > deadline) {
          setVisible(true)
          return
        }
        pollTimer = setTimeout(tryShow, 500)
      }
      // Initial delay so we don't race the Welcome modal's own 2.5s open.
      pollTimer = setTimeout(tryShow, 4000)
    }
    decide()
    return () => { cancelled = true; if (pollTimer) clearTimeout(pollTimer) }
  }, [])

  if (!visible) return null

  function snooze() {
    try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS)) } catch (_) {}
    setVisible(false)
  }

  function goActivate() {
    try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS)) } catch (_) {}
    setVisible(false)
    openModal('settings' as any)
  }

  return (
    <div className="zsn-backdrop" onClick={snooze}>
      <div className="zsn-card" onClick={(e) => e.stopPropagation()}>
        <div className="zsn-icon">
          <svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="#f0c040" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
        </div>
        <div className="zsn-title">SECURE YOUR TERMINAL</div>
        <div className="zsn-body">
          Zeus holds live balances, open positions and trade history. Add a PIN{hasBio ? ' or fingerprint' : ''} so nobody can open the app from your unlocked phone.
        </div>
        <button className="zsn-btn zsn-btn-pri" onClick={goActivate}>
          ACTIVATE {hasBio ? 'PIN OR FINGERPRINT' : 'PIN'}
        </button>
        <button className="zsn-btn zsn-btn-sec" onClick={snooze}>
          REMIND ME LATER
        </button>
      </div>
    </div>
  )
}
