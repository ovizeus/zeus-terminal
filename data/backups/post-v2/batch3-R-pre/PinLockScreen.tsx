// Zeus — components/modals/PinLockScreen.tsx
// [BATCH3-Q] React-rendered PIN lock gate. Replaces the legacy static HTML
// div#pinLockScreen that was never ported to the React tree (root cause of
// "PIN never prompts on entry" bug).
// Visibility + error state are driven by usePinLockStore.
import { useEffect, useRef } from 'react'
import { usePinLockStore } from '../../stores/pinLockStore'
import { pinUnlock } from '../../core/bootstrapMisc'

export function PinLockScreen() {
  const visible = usePinLockStore((s) => s.visible)
  const message = usePinLockStore((s) => s.message)
  const shaking = usePinLockStore((s) => s.shaking)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (visible) {
      const t = setTimeout(() => inputRef.current?.focus(), 100)
      return () => clearTimeout(t)
    }
  }, [visible])

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
        <div id="pinLockMsg" className="pin-lock-msg">{message}</div>
        <div className="pin-lock-hint">PIN configured from Settings → Account &amp; Security</div>
      </div>
    </div>
  )
}
