// [2026-11-16] Butonul plutitor ⇅: apare cat DERULEZI pe o pagina lunga si dispare
// dupa ~1,5 s de pauza (cerut de operator: „se activeaza, sta un pic, dispare").
// „Jos" duce la CAPATUL CONTINUTULUI (bara de jos a aplicatiei, `.bot`), nu la
// capatul documentului — pagina are uneori o coada goala sub continut si butonul
// arunca in negru. Coada o masoara sonda din core/layoutTailProbe.ts.
import { useEffect, useRef, useState } from 'react'
import { contentBottom, reportLayoutTail } from '../../core/layoutTailProbe'

export const IDLE_HIDE_MS = 1500

export function jumpTarget(scrollY: number, maxScroll: number): 'top' | 'bottom' {
  return scrollY > maxScroll / 2 ? 'top' : 'bottom'
}

export function ScrollJumpButton() {
  const [show, setShow] = useState(false)
  const [dir, setDir] = useState<'top' | 'bottom'>('bottom')
  const hideT = useRef<any>(null)
  useEffect(() => {
    let raf = 0
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const se = document.scrollingElement || document.documentElement
        const end = contentBottom()
        const max = Math.max(0, end - window.innerHeight)
        const locked = getComputedStyle(document.documentElement).overflowY === 'hidden' || getComputedStyle(document.body).overflowY === 'hidden'
        const long = end > window.innerHeight * 2
        if (locked || !long) { setShow(false); return }
        setDir(jumpTarget(window.scrollY || se.scrollTop || 0, max))
        setShow(true)
        if (hideT.current) clearTimeout(hideT.current)
        hideT.current = setTimeout(() => setShow(false), IDLE_HIDE_MS)
        reportLayoutTail()
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { window.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf); if (hideT.current) clearTimeout(hideT.current) }
  }, [])
  const go = () => {
    const target = dir === 'top' ? 0 : Math.max(0, contentBottom() - window.innerHeight)
    window.scrollTo({ top: target, behavior: 'smooth' })
    if (hideT.current) clearTimeout(hideT.current)
    hideT.current = setTimeout(() => setShow(false), IDLE_HIDE_MS)
  }
  return (
    <button type="button" className={'zscroll-jump' + (show ? ' on' : '')} onClick={go} tabIndex={show ? 0 : -1}
      aria-hidden={!show} aria-label={dir === 'top' ? 'Scroll to top' : 'Scroll to bottom'}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {dir === 'top' ? <path d="M6 15l6-6 6 6" /> : <path d="M6 9l6 6 6-6" />}
      </svg>
    </button>
  )
}
