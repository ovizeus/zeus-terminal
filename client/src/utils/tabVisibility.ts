/**
 * [Phase C 2026-05-19] Tab visibility helper.
 * Wraps Page Visibility API for use across polling/sync code.
 * Foreground tabs drive real polling; background tabs receive updates
 * via BroadcastChannel (see tabSync.ts).
 */

export function isTabVisible(): boolean {
    if (typeof document === 'undefined') return true  // SSR safety
    return document.visibilityState === 'visible'
}

export type VisibilityCallback = (isVisible: boolean) => void

/**
 * Subscribe to visibility changes. Returns a function to unsubscribe.
 * Callback receives the current isVisible state on every change.
 */
export function onVisibilityChange(cb: VisibilityCallback): () => void {
    if (typeof document === 'undefined') return () => {}
    const handler = () => cb(isTabVisible())
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
}
