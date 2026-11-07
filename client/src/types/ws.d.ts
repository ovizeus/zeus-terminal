/**
 * [2026-11-07] Minimal types for the `ws` package.
 *
 * `ws` ships no declarations and @types/ws is not installed; adding a package
 * to a live box at three in the morning for a types-only dependency is not a
 * trade worth making. This declares ONLY what the real-socket test uses, and
 * says so plainly so nobody mistakes it for a complete definition — if more of
 * `ws` is ever needed, install @types/ws rather than growing this file.
 */
declare module 'ws' {
  import type { AddressInfo } from 'node:net'

  class WebSocket {
    constructor(url: string)
    readyState: number
    close(): void
    send(data: string): void
    onopen: (() => void) | null
    onmessage: ((e: { data: unknown }) => void) | null
    onclose: (() => void) | null
    onerror: (() => void) | null
  }

  class WebSocketServer {
    constructor(opts: { port: number })
    clients: Set<WebSocket>
    address(): AddressInfo | string | null
    on(event: 'connection', cb: (socket: WebSocket) => void): this
    once(event: 'listening', cb: () => void): this
    close(cb?: () => void): void
  }

  export { WebSocket, WebSocketServer }
}
