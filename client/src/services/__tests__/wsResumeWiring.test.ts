/**
 * [2026-11-07] The WIRING, not the function.
 *
 * I had tests for forceReconnect and for the liveness maths, but none that a
 * real resume event actually reaches them. That gap is the whole feature: a
 * perfect rebuild nobody triggers is the bug I set out to fix. The phone test
 * is still his, but everything short of a frozen WebView is checked here.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

class FakeSocket {
  static made: FakeSocket[] = []
  readyState = 0
  closed = false
  onopen: (() => void) | null = null
  onmessage: ((e: MessageEvent) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  url: string
  constructor(url: string) { this.url = url; FakeSocket.made.push(this) }
  open() { this.readyState = 1; this.onopen?.() }
  close() { this.closed = true; this.readyState = 3 }
  send() { /* noop */ }
}

let ws: typeof import('../ws')
let visibility = 'visible'

function setVisibility(v: 'visible' | 'hidden') {
  visibility = v
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(async () => {
  FakeSocket.made = []
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { get: () => visibility, configurable: true })
  vi.stubGlobal('WebSocket', Object.assign(FakeSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 }))
  vi.resetModules()
  ws = await import('../ws')
  ws.connect()
  FakeSocket.made[0].open()
  ws.startLivenessWatch()
})
afterEach(() => { ws.stopLivenessWatch(); vi.useRealTimers() })

describe('coming back after a long absence', () => {
  it('rebuilds the socket, even though it still claims to be OPEN', () => {
    vi.useFakeTimers()
    setVisibility('hidden')
    // the socket reports OPEN the whole time — that is the failure being fixed
    vi.setSystemTime(Date.now() + 5 * 60 * 1000)
    setVisibility('visible')
    expect(FakeSocket.made.length).toBeGreaterThan(1)
    expect(FakeSocket.made[0].closed).toBe(true)
  })

  it('a glance away costs nothing', () => {
    vi.useFakeTimers()
    setVisibility('hidden')
    vi.setSystemTime(Date.now() + 2000)   // under the ten-second floor
    setVisibility('visible')
    expect(FakeSocket.made).toHaveLength(1)
  })

  it('window focus is wired too, for the case visibilitychange misses', () => {
    vi.useFakeTimers()
    setVisibility('hidden')
    vi.setSystemTime(Date.now() + 5 * 60 * 1000)
    window.dispatchEvent(new Event('focus'))
    expect(FakeSocket.made.length).toBeGreaterThan(1)
  })

  it('the network coming back forces a rebuild on its own', () => {
    window.dispatchEvent(new Event('online'))
    expect(FakeSocket.made.length).toBeGreaterThan(1)
  })
})

describe('while you are looking at it', () => {
  // The interval is created by startLivenessWatch, so the clock has to be
  // faked BEFORE it is wired — otherwise the timer is a real one and advancing
  // a fake clock drives nothing. My first version missed that and the test
  // failed for its own reason rather than the code's.
  function rewireUnderFakeTimers() {
    ws.stopLivenessWatch()
    vi.useFakeTimers()
    ws.startLivenessWatch()
  }

  it('a silent socket is rebuilt by the heartbeat, without any resume', async () => {
    rewireUnderFakeTimers()
    ws._internals.setLastSignalAt(Date.now() - 10 * 60 * 1000)
    await vi.advanceTimersByTimeAsync(20000)   // past the 15s check
    expect(FakeSocket.made.length).toBeGreaterThan(1)
  })

  it('a talking socket is left alone by the heartbeat', async () => {
    rewireUnderFakeTimers()
    ws._internals.setLastSignalAt(Date.now())
    await vi.advanceTimersByTimeAsync(20000)
    expect(FakeSocket.made).toHaveLength(1)
  })
})

describe('stopping and starting again', () => {
  // [2026-11-07] The first version of stopLivenessWatch cleared the interval
  // but left the "already wired" flag set, so a later start returned early and
  // the app ran on with NO heartbeat and NO resume handling. Nothing in the app
  // calls stop today, which is exactly why it would have sat there unnoticed
  // until the day something did.
  it('a stop followed by a start leaves the heartbeat alive', async () => {
    ws.stopLivenessWatch()
    vi.useFakeTimers()
    ws.startLivenessWatch()
    ws._internals.setLastSignalAt(Date.now() - 10 * 60 * 1000)
    await vi.advanceTimersByTimeAsync(20000)
    expect(FakeSocket.made.length).toBeGreaterThan(1)
  })

  it('a stop really detaches the resume handlers', () => {
    // No clock at all. `online` forces a rebuild unconditionally when wired,
    // so it answers "are the listeners still attached" without depending on
    // timers — which is what made an earlier version of this test pass alone
    // and fail inside the full suite, where another file had left fake timers
    // behind. A test that needs the clock to be in a particular state is a
    // test that will lie eventually.
    window.dispatchEvent(new Event('online'))
    expect(FakeSocket.made).toHaveLength(2)   // proves it WAS wired

    ws.stopLivenessWatch()
    window.dispatchEvent(new Event('online'))
    window.dispatchEvent(new Event('focus'))
    expect(FakeSocket.made).toHaveLength(2)   // and now nothing is listening
  })
})

describe('the server heartbeat is what keeps it honest', () => {
  it('an hb frame counts as a sign of life', () => {
    ws._internals.setLastSignalAt(1)
    FakeSocket.made[0].onmessage?.({ data: JSON.stringify({ type: 'hb', t: Date.now() }) } as MessageEvent)
    expect(ws._internals.getLastSignalAt()).toBeGreaterThan(1)
    expect(ws.isConnected()).toBe(true)
  })

  it('without it the socket would be judged dead — which is why the server sends one', () => {
    ws._internals.setLastSignalAt(Date.now() - 10 * 60 * 1000)
    expect(ws.isConnected()).toBe(false)
  })
})
