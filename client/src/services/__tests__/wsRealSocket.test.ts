/**
 * [2026-11-07] The freeze, against REAL sockets.
 *
 * Every other test here uses a fake WebSocket class, which means they prove
 * the manager's logic and nothing about TCP. The failure in production is
 * specifically a socket the operating system froze: the connection is gone,
 * the server has given up, and the client never receives the close frame, so
 * readyState sits at OPEN forever.
 *
 * This reproduces that with a real ws server and a real client, through a TCP
 * proxy that simply STOPS FORWARDING without closing anything. No close frame
 * is ever delivered, exactly as on a phone that was suspended.
 *
 * It is the closest this machine can get to a frozen Android WebView.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import net from 'node:net'
import { WebSocketServer, WebSocket as NodeWebSocket } from 'ws'

let wss: WebSocketServer
let proxy: net.Server
let proxyPort = 0
let pipes: Array<{ from: net.Socket; to: net.Socket }> = []
let forwarding = true

beforeAll(async () => {
  wss = new WebSocketServer({ port: 0 })
  await new Promise<void>((r) => wss.once('listening', () => r()))
  const upstreamPort = (wss.address() as net.AddressInfo).port

  // A proxy we can silence. Stopping the flow without closing either side is
  // what a suspended phone looks like from the server's point of view.
  proxy = net.createServer((client) => {
    const up = net.createConnection({ port: upstreamPort, host: '127.0.0.1' })
    pipes.push({ from: client, to: up })
    client.on('data', (d) => { if (forwarding) up.write(d) })
    up.on('data', (d) => { if (forwarding) client.write(d) })
    client.on('error', () => {}); up.on('error', () => {})
  })
  await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', () => r()))
  proxyPort = (proxy.address() as net.AddressInfo).port

  wss.on('connection', (sock) => { sock.send(JSON.stringify({ type: 'hb', t: Date.now() })) })
})

afterAll(async () => {
  for (const p of pipes) { try { p.from.destroy() } catch { /* gone */ } try { p.to.destroy() } catch { /* gone */ } }
  await new Promise<void>((r) => proxy.close(() => r()))
  await new Promise<void>((r) => wss.close(() => r()))
})

describe('a genuinely frozen connection', () => {
  it('reports OPEN with nothing flowing, and is rebuilt anyway', async () => {
    vi.resetModules()
    vi.stubGlobal('WebSocket', NodeWebSocket)
    const ws = await import('../ws')
    ws._internals.setUrlOverride(`ws://127.0.0.1:${proxyPort}/ws/sync`)
    forwarding = true

    const connections: number[] = []
    wss.on('connection', () => connections.push(Date.now()))

    ws.connect()
    await vi.waitFor(() => expect(ws.isConnected()).toBe(true), { timeout: 4000 })
    const firstCount = wss.clients.size
    expect(firstCount).toBeGreaterThan(0)

    // the freeze: packets stop moving, nobody closes anything
    forwarding = false
    // and the clock moves on, as it does while a phone sleeps
    ws._internals.setLastSignalAt(Date.now() - 10 * 60 * 1000)

    // the socket STILL claims to be open — this is the whole bug
    expect(ws.isConnected()).toBe(false)   // the manager no longer believes it

    // now let it heal
    forwarding = true
    const rebuilt = ws.checkLiveness()
    expect(rebuilt).toBe(true)
    await vi.waitFor(() => expect(ws.isConnected()).toBe(true), { timeout: 4000 })

    ws._internals.setUrlOverride(null)
    ws.disconnect()
    ws.stopLivenessWatch()
  }, 20000)

  it('a healthy real socket is left alone', async () => {
    vi.resetModules()
    vi.stubGlobal('WebSocket', NodeWebSocket)
    const ws = await import('../ws')
    ws._internals.setUrlOverride(`ws://127.0.0.1:${proxyPort}/ws/sync`)
    forwarding = true

    ws.connect()
    await vi.waitFor(() => expect(ws.isConnected()).toBe(true), { timeout: 4000 })
    const before = wss.clients.size
    expect(ws.checkLiveness()).toBe(false)   // nothing to fix
    expect(wss.clients.size).toBe(before)

    ws._internals.setUrlOverride(null)
    ws.disconnect()
    ws.stopLivenessWatch()
  }, 20000)

  it('the server heartbeat really does reach the client over the wire', async () => {
    vi.resetModules()
    vi.stubGlobal('WebSocket', NodeWebSocket)
    const ws = await import('../ws')
    ws._internals.setUrlOverride(`ws://127.0.0.1:${proxyPort}/ws/sync`)
    forwarding = true

    const seen: string[] = []
    const off = ws.subscribe((m) => seen.push(m.type))
    ws.connect()
    await vi.waitFor(() => expect(seen).toContain('hb'), { timeout: 4000 })
    // and it counted as a sign of life, which is the point of sending it
    expect(ws.isConnected()).toBe(true)

    off()
    ws._internals.setUrlOverride(null)
    ws.disconnect()
    ws.stopLivenessWatch()
  }, 20000)
})
