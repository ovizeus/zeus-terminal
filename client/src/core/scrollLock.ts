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

export function lockScroll(): void {
  if (_locks === 0) {
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
  }
  _locks++
}

export function unlockScroll(): void {
  if (_locks === 0) return
  _locks--
  if (_locks === 0) {
    document.documentElement.style.overflow = ''
    document.body.style.overflow = ''
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
