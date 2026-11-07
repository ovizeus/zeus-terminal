/**
 * [2026-11-07] The forced rebuild.
 *
 * The one that matters: connect() begins with
 *     if (_ws && _ws.readyState <= WebSocket.OPEN) return
 * so against a frozen socket that still reports OPEN it does nothing. That
 * early return is the reason "just reconnect when the app comes back" would
 * have changed nothing at all, and it is what these tests pin down.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

class FakeSocket {
  static made: FakeSocket[] = []
  readyState = 0
  closed = false
  onopen: (() => void) | null = null
  onmessage: ((e: MessageEvent) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(public url: string) { FakeSocket.made.push(this) }
  open() { this.readyState = 1; this.onopen?.() }
  close() { this.closed = true; this.readyState = 3; this.onclose?.() }
  send() { /* noop */ }
}

let ws: typeof import('../ws')

beforeEach(async () => {
  FakeSocket.made = []
  vi.stubGlobal('WebSocket', Object.assign(FakeSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 }))
  vi.resetModules()
  ws = await import('../ws')
})
afterEach(() => { ws.stopLivenessWatch() })

describe('connect() on its own cannot replace a zombie', () => {
  it('returns early against a socket that merely claims to be OPEN', () => {
    ws.connect()
    FakeSocket.made[0].open()
    expect(FakeSocket.made).toHaveLength(1)
    ws.connect() // the naive "reconnect on resume"
    expect(FakeSocket.made).toHaveLength(1) // nothing happened — this is the bug
  })
})

describe('forceReconnect', () => {
  it('builds a new socket even though the old one says OPEN', () => {
    ws.connect()
    FakeSocket.made[0].open()
    ws.forceReconnect('test')
    expect(FakeSocket.made).toHaveLength(2)
  })

  it('closes the old socket rather than leaking it', () => {
    ws.connect()
    const first = FakeSocket.made[0]
    first.open()
    ws.forceReconnect('test')
    expect(first.closed).toBe(true)
  })

  it('detaches the old handlers, so its close cannot schedule a rival reconnect', () => {
    ws.connect()
    const first = FakeSocket.made[0]
    first.open()
    ws.forceReconnect('test')
    // the old object must be inert; if onclose survived, its close would
    // queue another connect and we would race two sockets
    expect(first.onclose).toBeNull()
    expect(first.onmessage).toBeNull()
  })
})

describe('the true zombie: close() does not even work', () => {
  /**
   * A frozen socket may not honour close(): readyState can stay OPEN. My first
   * pass at these tests missed this, because the fake socket flipped its own
   * state on close and so connect() got past its early return by accident. A
   * mutation that removed the defence still passed — which meant the test was
   * proving nothing. This is the case the defence actually exists for.
   */
  class StuckSocket extends FakeSocket {
    close() { /* the OS froze us; nothing happens, readyState stays OPEN */ }
  }

  it('still builds a new socket when the old one refuses to close', async () => {
    vi.stubGlobal('WebSocket', Object.assign(StuckSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 }))
    vi.resetModules()
    const w = await import('../ws')
    // the constructor records into FakeSocket.made, which the subclass shares
    FakeSocket.made = []
    w.connect()
    FakeSocket.made[0].open()
    expect(FakeSocket.made[0].readyState).toBe(1)
    w.forceReconnect('stuck')
    // the old socket is STILL reporting OPEN here. Without clearing the
    // reference first, connect()'s `readyState <= OPEN` early return would
    // see a live socket and do nothing at all.
    expect(FakeSocket.made[0].readyState).toBe(1)
    expect(FakeSocket.made).toHaveLength(2)
    w.stopLivenessWatch()
  })
})

describe('isConnected stops lying', () => {
  it('is true on a socket that has just spoken', () => {
    ws.connect()
    FakeSocket.made[0].open()
    expect(ws.isConnected()).toBe(true)
  })

  it('is FALSE on an open socket that has gone silent past the limit', () => {
    ws.connect()
    FakeSocket.made[0].open()
    ws._internals.setLastSignalAt(Date.now() - 10 * 60 * 1000)
    expect(ws.isConnected()).toBe(false) // the green dot on a dead socket
  })

  it('is false when there is no socket', () => {
    expect(ws.isConnected()).toBe(false)
  })
})

describe('checkLiveness', () => {
  it('leaves a healthy socket alone', () => {
    ws.connect()
    FakeSocket.made[0].open()
    expect(ws.checkLiveness()).toBe(false)
    expect(FakeSocket.made).toHaveLength(1)
  })

  it('rebuilds a silent one', () => {
    ws.connect()
    FakeSocket.made[0].open()
    ws._internals.setLastSignalAt(Date.now() - 10 * 60 * 1000)
    expect(ws.checkLiveness()).toBe(true)
    expect(FakeSocket.made).toHaveLength(2)
  })

  it('does nothing after an intentional disconnect', () => {
    ws.connect()
    FakeSocket.made[0].open()
    ws.disconnect()
    expect(ws.checkLiveness()).toBe(false)
    expect(FakeSocket.made).toHaveLength(1)
  })
})

describe('any frame counts as a sign of life', () => {
  it('a malformed frame still proves the pipe is open', () => {
    ws.connect()
    const s = FakeSocket.made[0]
    s.open()
    ws._internals.setLastSignalAt(1)
    s.onmessage?.({ data: 'not json at all' } as MessageEvent)
    expect(ws._internals.getLastSignalAt()).toBeGreaterThan(1)
  })
})

describe('startLivenessWatch is idempotent', () => {
  it('wiring it twice does not double the listeners', () => {
    const spy = vi.spyOn(document, 'addEventListener')
    ws.startLivenessWatch()
    const after = spy.mock.calls.length
    ws.startLivenessWatch()
    expect(spy.mock.calls.length).toBe(after)
  })
})
