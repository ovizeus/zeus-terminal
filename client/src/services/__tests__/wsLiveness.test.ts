import { describe, it, expect } from 'vitest'
import {
  isZombie, needsReconnect, looksConnected, shouldForceOnResume, silentFor,
  SILENCE_LIMIT_MS, RESUME_FORCE_AFTER_MS,
  WS_CONNECTING, WS_OPEN, WS_CLOSING, WS_CLOSED,
  isNativeShell,
} from '../wsLiveness'

const NOW = 1_000_000
const snap = (readyState: number | null, silentMs: number) => ({
  readyState, lastSignalAt: NOW - silentMs, now: NOW,
})

describe('the zombie: open but dead', () => {
  it('an open socket that keeps talking is fine', () => {
    expect(isZombie(snap(WS_OPEN, 5000))).toBe(false)
    expect(isZombie(snap(WS_OPEN, SILENCE_LIMIT_MS))).toBe(false)
  })

  it('an open socket silent past the limit is a zombie', () => {
    expect(isZombie(snap(WS_OPEN, SILENCE_LIMIT_MS + 1))).toBe(true)
    expect(isZombie(snap(WS_OPEN, 10 * 60 * 1000))).toBe(true)
  })

  it('only an OPEN socket can be a zombie — the others are honestly dead', () => {
    for (const st of [WS_CONNECTING, WS_CLOSING, WS_CLOSED]) {
      expect(isZombie(snap(st, 10 * 60 * 1000))).toBe(false)
    }
  })

  it('a socket that has never signalled is not yet judged', () => {
    // a fresh object with no open time must not be torn down on sight
    expect(isZombie({ readyState: WS_OPEN, lastSignalAt: 0, now: NOW })).toBe(false)
    expect(silentFor({ readyState: WS_OPEN, lastSignalAt: 0, now: NOW })).toBe(0)
  })
})

describe('when to rebuild', () => {
  it('rebuilds when there is no socket at all', () => {
    expect(needsReconnect({ readyState: null, lastSignalAt: NOW, now: NOW })).toBe(true)
  })

  it('leaves a handshake in flight alone', () => {
    // interrupting CONNECTING turns a slow network into a reconnect loop
    expect(needsReconnect(snap(WS_CONNECTING, 10 * 60 * 1000))).toBe(false)
  })

  it('rebuilds a closing or closed socket, because onclose may never have fired', () => {
    expect(needsReconnect(snap(WS_CLOSING, 0))).toBe(true)
    expect(needsReconnect(snap(WS_CLOSED, 0))).toBe(true)
  })

  it('rebuilds a zombie, and leaves a healthy socket be', () => {
    expect(needsReconnect(snap(WS_OPEN, SILENCE_LIMIT_MS + 1))).toBe(true)
    expect(needsReconnect(snap(WS_OPEN, 1000))).toBe(false)
  })
})

describe('what the status dot should say', () => {
  it('green only while the socket is open AND talking', () => {
    expect(looksConnected(snap(WS_OPEN, 1000))).toBe(true)
  })

  it('NOT green on a zombie — this is the lie that started all of it', () => {
    expect(looksConnected(snap(WS_OPEN, SILENCE_LIMIT_MS + 1))).toBe(false)
  })

  it('not green while connecting or closed', () => {
    expect(looksConnected(snap(WS_CONNECTING, 0))).toBe(false)
    expect(looksConnected(snap(WS_CLOSED, 0))).toBe(false)
  })
})

describe('coming back to the foreground', () => {
  it('a glance away costs nothing', () => {
    expect(shouldForceOnResume(0)).toBe(false)
    expect(shouldForceOnResume(2000)).toBe(false)
    expect(shouldForceOnResume(RESUME_FORCE_AFTER_MS - 1)).toBe(false)
  })

  it('a real absence forces a rebuild without waiting for any timer', () => {
    // the silence timer was frozen along with the rest of the app, so it
    // cannot be trusted to notice
    expect(shouldForceOnResume(RESUME_FORCE_AFTER_MS)).toBe(true)
    expect(shouldForceOnResume(30 * 60 * 1000)).toBe(true)
  })

  it('nonsense input does not force anything', () => {
    expect(shouldForceOnResume(NaN)).toBe(false)
    expect(shouldForceOnResume(-1)).toBe(false)
  })
})

describe('the limits are deliberate', () => {
  it('tolerates a missed heartbeat — the server beats every 30s', () => {
    expect(SILENCE_LIMIT_MS).toBeGreaterThan(60000)
  })
  it('does not punish a quick glance away', () => {
    expect(RESUME_FORCE_AFTER_MS).toBeGreaterThanOrEqual(5000)
  })
})

/**
 * [2026-11-07] Found by the suite's exit code, not by a failing test: the full
 * run reported 1803 passed AND exited 1 on an unhandled rejection.
 *
 * The resume wiring did `import('@capacitor/app')` unconditionally. Loading the
 * plugin constructs its WEB implementation, which touches `document`; when that
 * import resolved after the test environment was torn down it threw inside
 * Capacitor's own promise, where our `.catch` could never reach it. On a browser
 * the import buys nothing anyway - the DOM events and the 15s timer cover it.
 */
describe('the native bridge is asked for only when it exists', () => {
  it('a plain browser is not a native shell', () => {
    expect(isNativeShell({})).toBe(false)
    expect(isNativeShell({ Capacitor: {} })).toBe(false)
    expect(isNativeShell(undefined)).toBe(false)
    expect(isNativeShell(null)).toBe(false)
  })

  it('a bridge that reports web is not a native shell', () => {
    expect(isNativeShell({ Capacitor: { isNativePlatform: () => false } })).toBe(false)
  })

  it('the WebView inside the APK is', () => {
    expect(isNativeShell({ Capacitor: { isNativePlatform: () => true } })).toBe(true)
  })

  it('a bridge that throws is treated as web, not as a crash', () => {
    // fail-safe: losing the native listener costs nothing, the timer still heals
    expect(isNativeShell({ Capacitor: { isNativePlatform: () => { throw new Error('x') } } })).toBe(false)
  })
})
