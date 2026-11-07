/**
 * [2026-11-07] Telling a live socket from an open one.
 *
 * The bug this exists for: when a phone backgrounds the app the OS freezes the
 * WebView. The connection dies — the server drops it on timeout — but the
 * frozen client never receives the close frame. On resume the browser still
 * reports readyState OPEN, so `onclose` never fires, nothing reconnects, and
 * the status dot cheerfully says CONNECTED while no data arrives. Only a page
 * refresh helps, because that throws the socket away and builds a new one.
 *
 * Pure on purpose: these are the decisions, and decisions about whether to tear
 * down a working connection deserve tests that do not need a browser.
 */

/** Browser WebSocket readyState values, named so the logic reads. */
export const WS_CONNECTING = 0
export const WS_OPEN = 1
export const WS_CLOSING = 2
export const WS_CLOSED = 3

/**
 * The server sends an application-level heartbeat every 30s (server.js, the
 * same interval that already pings at protocol level). Protocol pings are
 * answered by the browser itself and are invisible to JavaScript, which is
 * exactly why an application frame is needed: without one, a quiet market
 * would look identical to a dead socket.
 *
 * 75s tolerates one missed beat plus jitter. Lower than ~65s would start
 * tearing down healthy sockets on a slow network.
 */
export const SILENCE_LIMIT_MS = 75000

/** How often to check while the app is in front. */
export const LIVENESS_CHECK_MS = 15000

/**
 * Hidden for less than this, do not force anything: a glance at a notification
 * should not cost a reconnect. Longer, and the socket is assumed dead whatever
 * readyState claims, because that is the case this whole module exists for.
 */
export const RESUME_FORCE_AFTER_MS = 10000

export interface SocketSnapshot {
  /** null when there is no socket object at all. */
  readyState: number | null
  /** Last time anything arrived, or the socket opened — whichever is later. */
  lastSignalAt: number
  now: number
}

export function silentFor(s: SocketSnapshot): number {
  if (!Number.isFinite(s.lastSignalAt) || s.lastSignalAt <= 0) return 0
  return Math.max(0, s.now - s.lastSignalAt)
}

/** Open, but has not said a word for too long. The zombie. */
export function isZombie(s: SocketSnapshot, limitMs: number = SILENCE_LIMIT_MS): boolean {
  if (s.readyState !== WS_OPEN) return false
  if (!Number.isFinite(s.lastSignalAt) || s.lastSignalAt <= 0) return false
  return silentFor(s) > limitMs
}

/**
 * Should we tear down and rebuild?
 *
 * CONNECTING is left alone — a handshake in flight is not a fault, and
 * interrupting it would turn a slow network into a reconnect loop. CLOSING and
 * CLOSED mean the socket is gone; after a background freeze `onclose` may never
 * have fired, so nobody else is going to notice.
 */
export function needsReconnect(s: SocketSnapshot, limitMs: number = SILENCE_LIMIT_MS): boolean {
  if (s.readyState === null) return true
  if (s.readyState === WS_CONNECTING) return false
  if (s.readyState === WS_CLOSING || s.readyState === WS_CLOSED) return true
  return isZombie(s, limitMs)
}

/**
 * What the status dot should say. The old answer was readyState === OPEN,
 * which is why the dot stayed green on a dead socket. A connection that has
 * gone quiet past the limit is not connected, whatever the browser thinks.
 */
export function looksConnected(s: SocketSnapshot, limitMs: number = SILENCE_LIMIT_MS): boolean {
  return s.readyState === WS_OPEN && !isZombie(s, limitMs)
}

/**
 * On returning to the foreground. A brief glance away changes nothing; a real
 * absence means the socket is presumed dead without waiting for the silence
 * timer, because the timer itself was frozen along with everything else.
 */
export function shouldForceOnResume(hiddenSinceMs: number, thresholdMs: number = RESUME_FORCE_AFTER_MS): boolean {
  if (!Number.isFinite(hiddenSinceMs) || hiddenSinceMs < 0) return false
  return hiddenSinceMs >= thresholdMs
}

/**
 * [2026-11-07] True only inside the Capacitor WebView.
 *
 * Guards the `@capacitor/app` import. Loading that plugin in a browser builds
 * its web implementation, which touches `document` — and it does so inside
 * Capacitor's own promise, so a failure there escapes any `.catch` we attach.
 * On the web the import buys nothing: the DOM visibility/focus events and the
 * 15s liveness timer already cover resume. Anything it cannot prove is native
 * counts as web, because losing the native listener is harmless while an
 * exception at startup is not.
 */
export function isNativeShell(g: unknown): boolean {
  try {
    const cap = (g as { Capacitor?: { isNativePlatform?: () => boolean } } | null | undefined)?.Capacitor
    return typeof cap?.isNativePlatform === 'function' && cap.isNativePlatform() === true
  } catch {
    return false
  }
}
