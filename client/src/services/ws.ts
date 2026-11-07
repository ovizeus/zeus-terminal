/**
 * Zeus Terminal — WebSocket manager
 * Connects to /ws/sync for real-time server pushes
 */

import type { WsMessage } from '../types'
import {
  needsReconnect, looksConnected, shouldForceOnResume,
  LIVENESS_CHECK_MS, RESUME_FORCE_AFTER_MS, isNativeShell } from './wsLiveness'

type WsListener = (msg: WsMessage) => void

let _ws: WebSocket | null = null
let _listeners: Set<WsListener> = new Set()
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null
let _reconnectDelay = 1000
let _intentionalClose = false
// [Phase 3E] Track whether we've ever been connected. First open is NOT a "reconnect" —
// only subsequent opens (after a prior close) should trigger canonical-truth re-pull.
let _everConnected = false
// [2026-11-07] Last time anything arrived, or the socket opened — whichever is
// later. Without this the manager cannot tell a live socket from one the OS
// froze: readyState says OPEN in both cases.
let _lastSignalAt = 0
let _livenessTimer: ReturnType<typeof setInterval> | null = null
let _hiddenAt = 0
let _resumeWired = false
let _teardown: (() => void) | null = null

// [2026-11-07] Test seam. A test can point the manager at a real local socket
// so the freeze can be reproduced against genuine TCP rather than a fake class.
// Null in every build; nothing in the app ever sets it.
let _urlOverride: string | null = null

function getWsUrl(): string {
  if (_urlOverride) return _urlOverride
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}/ws/sync`
}

function _onMessage(ev: MessageEvent) {
  // Recorded before parsing: a frame we cannot read is still proof the pipe is
  // alive, and the heartbeat must not depend on the payload being valid.
  _lastSignalAt = Date.now()
  try {
    const msg = JSON.parse(ev.data) as WsMessage
    _listeners.forEach((fn) => fn(msg))
    // [LIQ-FEED PROXY 2026-05-14] Mirror parsed frame to global CustomEvent
    // so module subscribers (e.g. liqFeedClient) can react without joining
    // the typed _listeners pipeline. Cheap fire-and-forget — no impact on
    // existing listeners. Frame shape: { type: '...', data: ... }.
    try { window.dispatchEvent(new CustomEvent('zeus:wsFrame', { detail: msg })) } catch (_) { /* defensive */ }
  } catch {
    // ignore malformed messages
  }
}

function _onClose() {
  // [WS-6] Defensive try/catch — _onClose runs as a WebSocket event
  // handler, so any throw inside (setTimeout queue full, connect() chain
  // failing, _reconnectDelay arithmetic on corrupt module state) becomes
  // an unhandled rejection that bubbles up through the browser without
  // a stack trace pointing to this file. Catch + console.warn keeps the
  // reconnect path resilient — at worst we lose one reconnect cycle.
  try {
    _ws = null
    if (!_intentionalClose) {
      _reconnectTimer = setTimeout(() => {
        _reconnectDelay = Math.min(_reconnectDelay * 1.5, 15000)
        connect()
      }, _reconnectDelay)
    }
  } catch (e: any) {
    console.warn('[WS] _onClose handler threw:', e && e.message)
  }
}

function _onOpen() {
  _reconnectDelay = 1000
  _lastSignalAt = Date.now()
  // [Phase 3E] Only signal 'reconnect' on re-open (not first connect). Subscribers
  // use this to trigger canonical-truth refresh so ownership/env state doesn't stay
  // stale until the next server-initiated push or 30s polling tick.
  if (_everConnected) {
    const ev: WsMessage = { type: 'reconnect' }
    _listeners.forEach((fn) => {
      try { fn(ev) } catch { /* ignore subscriber errors */ }
    })
  }
  _everConnected = true
}

export function connect() {
  if (_ws && _ws.readyState <= WebSocket.OPEN) return
  _intentionalClose = false
  try {
    _ws = new WebSocket(getWsUrl())
    _ws.onopen = _onOpen
    _ws.onmessage = _onMessage
    _ws.onclose = _onClose
    _ws.onerror = () => _ws?.close()
  } catch {
    // will retry via onclose
  }
}

function _snapshot() {
  return { readyState: _ws ? _ws.readyState : null, lastSignalAt: _lastSignalAt, now: Date.now() }
}

/**
 * [2026-11-07] Tear the socket down and build a new one, even when the old one
 * insists it is OPEN.
 *
 * connect() alone cannot do this: it begins with `if (_ws && readyState <=
 * OPEN) return`, so against a frozen socket that still reports OPEN it is a
 * no-op. That early return is why "just reconnect when the app comes back"
 * would have changed nothing.
 *
 * The old socket's handlers are detached first. Left attached, its eventual
 * close would schedule a second reconnect and we would end up with two
 * sockets racing.
 */
export function forceReconnect(reason: string): void {
  try {
    const old = _ws
    _ws = null
    if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null }
    if (old) {
      old.onclose = null
      old.onmessage = null
      old.onerror = null
      old.onopen = null
      try { old.close() } catch { /* already gone */ }
    }
    _intentionalClose = false
    _reconnectDelay = 1000
    _lastSignalAt = 0
    console.info('[WS] forced reconnect:', reason)
    connect()
  } catch (e: unknown) {
    console.warn('[WS] forceReconnect threw:', (e as Error)?.message)
  }
}

/** Rebuild if the socket is gone, closing, or open-but-silent. */
export function checkLiveness(): boolean {
  if (_intentionalClose) return false
  if (!needsReconnect(_snapshot())) return false
  forceReconnect('liveness check')
  return true
}

/**
 * Wires the moments a frozen socket becomes visible again. Idempotent, so a
 * remount cannot stack duplicate listeners.
 *
 * Both the DOM visibility event and Capacitor's app state are used: inside the
 * Android WebView visibilitychange is not reliably delivered on resume, and
 * missing the resume is the whole failure being fixed.
 */
export function startLivenessWatch(): void {
  if (_resumeWired || typeof document === 'undefined') return
  _resumeWired = true

  const onResume = () => {
    const hiddenFor = _hiddenAt ? Date.now() - _hiddenAt : 0
    _hiddenAt = 0
    if (shouldForceOnResume(hiddenFor)) {
      // Deliberately not conditional on readyState. After a freeze the socket
      // lies, and the timer that would have caught it was frozen too.
      forceReconnect(`resumed after ${Math.round(hiddenFor / 1000)}s`)
      return
    }
    checkLiveness()
  }
  const onHide = () => { _hiddenAt = Date.now() }
  const onVisibility = () => { if (document.visibilityState === 'visible') onResume(); else onHide() }
  const onOnline = () => forceReconnect('network came back')

  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('focus', onResume)
  window.addEventListener('online', onOnline)
  // [2026-11-07] Kept so stop can undo exactly what start did. The first
  // version only cleared the interval and left _resumeWired set, which meant a
  // stop followed by a start silently left the app with NO heartbeat at all —
  // found by a test that stopped and restarted the watch.
  _teardown = () => {
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('focus', onResume)
    window.removeEventListener('online', onOnline)
  }

  // Capacitor: more dependable than visibilitychange inside the WebView. Asked
  // for ONLY there — see isNativeShell: loading the plugin on the web throws
  // inside Capacitor's own promise, out of reach of the catch below.
  try {
    if (isNativeShell(globalThis)) import('@capacitor/app').then(({ App }) => {
      App.addListener('appStateChange', ({ isActive }) => { if (isActive) onResume(); else onHide() })
    }).catch(() => { /* web build has no native layer — the DOM events cover it */ })
  } catch { /* ignore */ }

  if (_livenessTimer) clearInterval(_livenessTimer)
  _livenessTimer = setInterval(() => {
    // Frozen along with everything else while hidden, which is fine: the
    // resume path does not depend on it.
    if (document.visibilityState === 'visible') checkLiveness()
  }, LIVENESS_CHECK_MS)
}

export function stopLivenessWatch(): void {
  if (_livenessTimer) { clearInterval(_livenessTimer); _livenessTimer = null }
  if (_teardown) { try { _teardown() } catch { /* listeners already gone */ } _teardown = null }
  // Symmetry matters: without clearing this, a later start() returns early and
  // the app runs on with no heartbeat and no resume handling.
  _resumeWired = false
}

export function disconnect() {
  _intentionalClose = true
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer)
    _reconnectTimer = null
  }
  if (_ws) {
    _ws.close()
    _ws = null
  }
}

export function subscribe(fn: WsListener): () => void {
  _listeners.add(fn)
  return () => {
    _listeners.delete(fn)
  }
}

/**
 * [2026-11-07] Was `readyState === OPEN`, which is exactly why the dot stayed
 * green on a dead socket and the app never healed itself. A connection silent
 * past the limit is not connected, whatever the browser reports.
 */
export function isConnected(): boolean {
  return _ws !== null && looksConnected(_snapshot())
}

export function send(msg: Record<string, unknown>): boolean {
  if (!_ws || _ws.readyState !== WebSocket.OPEN) return false
  try { _ws.send(JSON.stringify(msg)); return true } catch { return false }
}

export const wsService = {
  connect, disconnect, subscribe, isConnected, send,
  forceReconnect, checkLiveness, startLivenessWatch, stopLivenessWatch,
}

/** Test seam: lets a test drive the clock without a real socket. */
export const _internals = {
  setLastSignalAt: (t: number) => { _lastSignalAt = t },
  setUrlOverride: (u: string | null) => { _urlOverride = u },
  getLastSignalAt: () => _lastSignalAt,
  RESUME_FORCE_AFTER_MS,
}
