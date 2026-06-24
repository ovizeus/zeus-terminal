import { useState, useRef } from 'react'
import { Header } from './Header'
import { ProfilePanel } from './ProfilePanel'

// [2026-06-24] Flip header — front is the untouched trading header, back is the profile panel.
// Click the Zeus logo to flip to the profile; tap the avatar to flip back. The container owns the
// (mobile) fixed positioning so the 3D transform on the faces never breaks the fixed header.
export function FlipHeader() {
  const [flipped, setFlipped] = useState(false)
  const [sweeping, setSweeping] = useState(false)
  const tRef = useRef<number | null>(null)

  const doFlip = (to: boolean) => {
    setFlipped(to)
    setSweeping(true)
    if (tRef.current) window.clearTimeout(tRef.current)
    tRef.current = window.setTimeout(() => setSweeping(false), 650)
  }

  return (
    <div className={'flip-header' + (flipped ? ' is-flipped' : '') + (sweeping ? ' is-flipping' : '')}>
      <div className="flip-face flip-front"><Header onLogoClick={() => doFlip(true)} /></div>
      <div className="flip-face flip-back"><ProfilePanel onAvatarClick={() => doFlip(false)} /></div>
    </div>
  )
}
