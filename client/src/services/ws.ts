/**
 * Zeus Terminal — WebSocket manager
 * Connects to /ws/sync for real-time server pushes
 */

import type { WsMessage } from '../types'

type WsListener = (msg: WsMessage) => void

let _ws: WebSocket | null = null
let _listeners: Set<WsListener> = new Set()
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null
let _reconnectDelay = 1000
let _intentionalClose = false
// [Phase 3E] Track whether we've ever been connected. First open is NOT a "reconnect" —
// only subsequent opens (after a prior close) should trigger canonical-truth re-pull.
let _everConnected = false

function getWsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}/ws/sync`
}

function _onMessage(ev: MessageEvent) {
  try {
    const msg = JSON.parse(ev.data) as WsMessage
    _listeners.forEach((fn) => fn(msg))
  } catch {
    // ignore malformed messages
  }
}

function _onClose() {
  _ws = null
  if (!_intentionalClose) {
    _reconnectTimer = setTimeout(() => {
      _reconnectDelay = Math.min(_reconnectDelay * 1.5, 15000)
      connect()
    }, _reconnectDelay)
  }
}

function _onOpen() {
  _reconnectDelay = 1000
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

export function isConnected(): boolean {
  return _ws !== null && _ws.readyState === WebSocket.OPEN
}

export const wsService = { connect, disconnect, subscribe, isConnected }
