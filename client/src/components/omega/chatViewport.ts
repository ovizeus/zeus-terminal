// [2026-11-04] Soft-keyboard compensation for the full-page OMEGA chat.
//
// When the on-screen keyboard opens, the LAYOUT viewport does not change --
// only the VISUAL viewport shrinks. The chat page is sized from its layout
// ancestors (height: 100%), so without this the input row sits underneath
// the keyboard and the operator types blind.
//
// b354 removed the previous protection (a `:has(.omega-chat-expanded)` mobile
// pin) when the chat moved out of the sticky bar, and nothing replaced it.

/** Below this, the delta is browser chrome settling, not a keyboard. */
export const KB_MIN_INSET_PX = 90

/** Never give away more than this share of the window to the inset. */
export const KB_MAX_INSET_RATIO = 0.75

export interface ViewportMetrics {
    /** window.innerHeight -- the layout viewport. */
    innerHeight: number
    /** visualViewport.height -- what the user can actually see. */
    viewportHeight: number
    /** visualViewport.offsetTop -- how far the visual viewport is scrolled down. */
    offsetTop?: number
}

/**
 * Height, in px, that the keyboard is covering. 0 when no keyboard is up,
 * when the numbers are not usable, or when the delta is too small to be one.
 */
export function keyboardInset(m: ViewportMetrics | null | undefined): number {
    if (!m) return 0
    const inner = m.innerHeight
    const visual = m.viewportHeight
    // Number.isFinite does not coerce, so it already rejects null/undefined/'' --
    // no typeof guard needed here (that trap belongs to the GLOBAL isFinite).
    if (!Number.isFinite(inner) || inner <= 0) return 0
    if (!Number.isFinite(visual) || visual <= 0) return 0
    const top = Number.isFinite(m.offsetTop) ? (m.offsetTop as number) : 0
    const raw = inner - visual - top
    if (!Number.isFinite(raw) || raw < KB_MIN_INSET_PX) return 0
    const cap = Math.floor(inner * KB_MAX_INSET_RATIO)
    return Math.min(Math.round(raw), cap)
}

/** Reads the live visual viewport. Returns null where the API is absent. */
export function readViewport(win: Window | undefined = typeof window !== 'undefined' ? window : undefined): ViewportMetrics | null {
    if (!win) return null
    const vv = win.visualViewport
    if (!vv) return null
    return { innerHeight: win.innerHeight, viewportHeight: vv.height, offsetTop: vv.offsetTop }
}
