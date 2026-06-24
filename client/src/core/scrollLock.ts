import { useEffect } from 'react'

/**
 * Ref-counted background scroll lock for modals / overlays.
 *
 * Bug it fixes: mobile browsers let a touch-scroll gesture pass THROUGH a fixed
 * overlay to the page behind it. With a centered modal open (SELECT INDICATOR,
 * Settings…) the chart page kept scrolling behind it into the empty space below
 * the content and got stuck there ("black at the bottom") until scrolled all the
 * way back to the top. Locking the document scroller (html + body) while any
 * overlay is open prevents the background from moving at all.
 *
 * Ref-counted so stacked overlays (e.g. a settings modal opened over a panel)
 * don't unlock the scroll while another is still open.
 */
let _locks = 0

// [2026-06-24 bug#13] Remember scroll position so we can restore it after the
// iOS position:fixed pin (which otherwise jumps the page to the top).
let _savedScrollY = 0

export function lockScroll(): void {
  if (_locks === 0) {
    _savedScrollY = window.scrollY || window.pageYOffset || 0
    const b = document.body, h = document.documentElement
    h.style.overflow = 'hidden'
    b.style.overflow = 'hidden'
    // overflow:hidden is ignored by iOS Safari for touch-scroll — pin the body so
    // the background can't scroll through the overlay. Scroll pos restored on unlock.
    b.style.position = 'fixed'
    b.style.top = '-' + _savedScrollY + 'px'
    b.style.left = '0'
    b.style.right = '0'
    b.style.width = '100%'
  }
  _locks++
}

export function unlockScroll(): void {
  // [2026-06-24 bug#13] Guard against negative counts from out-of-order React
  // cleanup (error boundaries / Suspense remounts) — never go below 0.
  if (_locks <= 0) { _locks = 0; return }
  _locks--
  if (_locks === 0) {
    const b = document.body, h = document.documentElement
    h.style.overflow = ''
    b.style.overflow = ''
    b.style.position = ''
    b.style.top = ''
    b.style.left = ''
    b.style.right = ''
    b.style.width = ''
    window.scrollTo(0, _savedScrollY)
  }
}

/** Lock the page scroll for as long as `active` is true. */
export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return
    lockScroll()
    return () => unlockScroll()
  }, [active])
}
