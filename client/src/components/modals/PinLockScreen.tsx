// Zeus — components/modals/PinLockScreen.tsx
// [BATCH3-Q] React-rendered PIN lock gate. Replaces the legacy static HTML
// div#pinLockScreen that was never ported to the React tree (root cause of
// "PIN never prompts on entry" bug).
// [BATCH3-R] Biometric unlock path — if enabled + plugin available, the
// fingerprint prompt auto-triggers when the screen opens; a "Use Fingerprint"
// button also lets the user retry manually.
import { useEffect, useRef, useState } from 'react'
import { usePinLockStore } from '../../stores/pinLockStore'
import { pinUnlock, pinMarkUnlockedFromBiometric } from '../../core/bootstrapMisc'
import { authenticate as bioAuth, isAvailable as bioIsAvailable, isEnabled as bioIsEnabled, isPluginInstalled } from '../../services/biometric'

export function PinLockScreen() {
  const visible = usePinLockStore((s) => s.visible)
  const message = usePinLockStore((s) => s.message)
  const shaking = usePinLockStore((s) => s.shaking)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [bioReady, setBioReady] = useState(false)
  const bioTriggeredRef = useRef(false)

  // Detect biometric availability + enrollment on mount of a visible gate.
  useEffect(() => {
    if (!visible) { bioTriggeredRef.current = false; setBioReady(false); return }
    if (!isPluginInstalled() || !bioIsEnabled()) { setBioReady(false); return }
    let cancelled = false
    bioIsAvailable().then((res) => {
      if (!cancelled && res.available) setBioReady(true)
    })
    return () => { cancelled = true }
  }, [visible])

  // Auto-trigger biometric prompt once per visible cycle — if the user cancels
  // they fall back to PIN input without being nagged again until next relaunch.
  useEffect(() => {
    if (!visible || !bioReady || bioTriggeredRef.current) return
    bioTriggeredRef.current = true
    runBiometric()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, bioReady])

  useEffect(() => {
    if (visible) {
      const t = setTimeout(() => inputRef.current?.focus(), 100)
      return () => clearTimeout(t)
    }
  }, [visible])

  async function runBiometric() {
    const ok = await bioAuth({ title: 'Unlock Zeus', subtitle: 'Use your fingerprint to unlock' })
    if (ok) pinMarkUnlockedFromBiometric()
  }

  if (!visible) return null

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); pinUnlock() }
  }

  return (
    <div id="pinLockScreen" style={{ display: 'flex' }}>
      <div className="pin-lock-inner">
        <div className="pin-lock-logo">
          <svg className="z-i z-i--xl" viewBox="0 0 16 16" style={{ color: '#f0c040', width: 28, height: 28 }}>
            <path d="M9 1L4 9h4l-1 6 5-8H8l1-6" />
          </svg>
        </div>
        <div className="pin-lock-title">ZEUS TERMINAL</div>
        <div className="pin-lock-sub">Enter PIN to unlock</div>
        <input
          ref={inputRef}
          type="password"
          id="pinLockInput"
          maxLength={8}
          placeholder="• • • •"
          autoComplete="off"
          className={'pin-lock-field' + (shaking ? ' pin-lock-shake' : '')}
          onKeyDown={onKeyDown}
        />
        <button onClick={() => pinUnlock()} className="pin-lock-btn">
          UNLOCK{' '}
          <svg className="z-i" viewBox="0 0 16 16" style={{ color: '#f0c040' }}>
            <path d="M9 1L4 9h4l-1 6 5-8H8l1-6" />
          </svg>
        </button>
        {bioReady && (
          <button onClick={runBiometric} className="pin-lock-bio-btn" type="button">
            <svg className="z-i" viewBox="0 0 24 24" style={{ color: '#f0c040', width: 18, height: 18, verticalAlign: 'middle' }} fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M12 3c-3 0-5.5 1.2-7.5 3M12 3c3 0 5.5 1.2 7.5 3M4.2 9.3C4.7 6.7 7.5 5 12 5s7.3 1.7 7.8 4.3M6 14c.3-3 2.5-5 6-5s5.7 2 6 5M9 17c0-2 1.2-3.5 3-3.5s3 1.5 3 3.5M11 20.5c0-1.5.5-2.5 1-3" strokeLinecap="round"/>
            </svg>
            &nbsp;USE FINGERPRINT
          </button>
        )}
        <div id="pinLockMsg" className="pin-lock-msg">{message}</div>
        <div className="pin-lock-hint">PIN configured from Settings → Account &amp; Security</div>
      </div>
    </div>
  )
}
