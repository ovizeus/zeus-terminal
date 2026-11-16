// [2026-11-16] Butonul plutitor ⇅: apare doar cand pagina e lunga (multi
// indicatori sub chart). Un tap te duce jos, apoi sus — ca sa nu cauti un loc
// liber de unde sa derulezi. Ascuns cand o fereastra blocheaza derularea.
import { useEffect, useState } from 'react'

export function jumpTarget(scrollY: number, maxScroll: number): 'top' | 'bottom' {
  return scrollY > maxScroll / 2 ? 'top' : 'bottom'
}

export function ScrollJumpButton() {
  const [show, setShow] = useState(false)
  const [dir, setDir] = useState<'top' | 'bottom'>('bottom')
  useEffect(() => {
    let raf = 0
    const check = () => {
      raf = 0
      const se = document.scrollingElement || document.documentElement
      const max = se.scrollHeight - window.innerHeight
      const locked = getComputedStyle(document.documentElement).overflowY === 'hidden' || getComputedStyle(document.body).overflowY === 'hidden'
      setShow(!locked && se.scrollHeight > window.innerHeight * 2)
      setDir(jumpTarget(window.scrollY || se.scrollTop || 0, max))
    }
    const onAny = () => { if (!raf) raf = requestAnimationFrame(check) }
    window.addEventListener('scroll', onAny, { passive: true })
    window.addEventListener('resize', onAny, { passive: true })
    const iv = setInterval(onAny, 1500)        // indicatori adaugati / scosi
    check()
    return () => { window.removeEventListener('scroll', onAny); window.removeEventListener('resize', onAny); clearInterval(iv); if (raf) cancelAnimationFrame(raf) }
  }, [])
  if (!show) return null
  const go = () => {
    const se = document.scrollingElement || document.documentElement
    window.scrollTo({ top: dir === 'top' ? 0 : se.scrollHeight, behavior: 'smooth' })
  }
  return (
    <button type="button" className="zscroll-jump" onClick={go} aria-label={dir === 'top' ? 'Scroll to top' : 'Scroll to bottom'}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {dir === 'top' ? <path d="M6 15l6-6 6 6" /> : <path d="M6 9l6 6 6-6" />}
      </svg>
    </button>
  )
}
