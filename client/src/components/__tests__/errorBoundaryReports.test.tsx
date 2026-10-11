import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ErrorBoundary } from '../ErrorBoundary'

// [2026-10-11] The operator hit "Cannot read properties of null (reading
// 'toFixed')" after opening a manual demo position on b270, and the server
// learned nothing: the log shows [CLIENT_ERR] unknown with no message, no
// filename, no line.
//
// Two reasons, both fixed here and in bootstrapError:
//
//  1. ErrorBoundary.componentDidCatch only did console.error. A panel could
//     crash in front of the operator and leave no trace on the server at all.
//
//  2. The window.onerror reporter only reported when the filename contained
//     /brain/, /core/, /trading/, /data/, /engine/ or /bridge/. In a production
//     bundle every error's filename is index-<hash>.js, so that test is never
//     true and detail never gets sent. It was written for the unbundled dev
//     tree and silently stopped working in production.
//
// A crash the operator can see but the logs cannot is the worst shape a bug can
// take, so the boundary now reports what it caught.

const fetchMock = vi.fn((_url: string, _init?: Record<string, unknown>) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) }))

function Boom() {
  const n: number | null = null
  // The operator's exact failure, reproduced.
  return <div>{(n as unknown as number).toFixed(2)}</div>
}

beforeEach(() => {
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('a crashed panel tells the server what happened', () => {
  it('still shows the operator a Retry', () => {
    render(<ErrorBoundary><Boom /></ErrorBoundary>)
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy()
  })

  it('POSTs the error to /api/client-error', () => {
    render(<ErrorBoundary><Boom /></ErrorBoundary>)
    expect(fetchMock).toHaveBeenCalled()
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/client-error')
  })

  it('sends the message, so the log is not just "unknown"', () => {
    render(<ErrorBoundary><Boom /></ErrorBoundary>)
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body)
    expect(body.reason).toMatch(/toFixed/)
    expect(body.kind).toBe('react-boundary')
  })

  it('sends the component stack, which names the panel that crashed', () => {
    // Without this the message alone cannot tell Auto Trade from Manual Trade.
    render(<ErrorBoundary><Boom /></ErrorBoundary>)
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body)
    expect(typeof body.componentStack).toBe('string')
    expect(body.componentStack.length).toBeGreaterThan(0)
    expect(body.componentStack).toContain('Boom')
  })

  it('never lets a failing report take the app down with it', () => {
    vi.stubGlobal('fetch', () => { throw new Error('offline') })
    expect(() => render(<ErrorBoundary><Boom /></ErrorBoundary>)).not.toThrow()
  })
})
