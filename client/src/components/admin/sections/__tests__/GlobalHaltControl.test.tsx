import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { GlobalHaltControl } from '../GlobalHaltControl'

// Mock global fetch. GET /api/admin/halt → returns `getResp`; POST → {ok:true}.
function installFetch(getResp: any) {
  const calls: any[] = []
  const fn = vi.fn((url: string, opts?: any) => {
    calls.push({ url, opts })
    if (opts && opts.method === 'POST') {
      const body = JSON.parse(opts.body)
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, halt: { active: body.active } }) })
    }
    return Promise.resolve({ json: () => Promise.resolve(getResp) })
  })
  ;(globalThis as any).fetch = fn
  return { fn, calls }
}

afterEach(() => { vi.restoreAllMocks() })

describe('GlobalHaltControl', () => {
  it('loads state and shows TRADING ACTIVE when not halted', async () => {
    installFetch({ active: false, by: null, ts: null, reason: null })
    render(<GlobalHaltControl />)
    await waitFor(() => expect(screen.getByText('TRADING ACTIVE')).toBeInTheDocument())
    expect(screen.getByText(/Arm global halt/i)).toBeInTheDocument()
  })

  it('shows TRADING HALTED + reason when armed', async () => {
    installFetch({ active: true, by: 1, ts: 123, reason: 'emergency_admin_panel' })
    render(<GlobalHaltControl />)
    await waitFor(() => expect(screen.getByText('TRADING HALTED')).toBeInTheDocument())
    expect(screen.getByText(/Disarm — resume trading/i)).toBeInTheDocument()
    expect(screen.getByText(/emergency_admin_panel/i)).toBeInTheDocument()
  })

  it('arming POSTs active:true after confirm', async () => {
    const { fn } = installFetch({ active: false, by: null, ts: null, reason: null })
    render(<GlobalHaltControl />)
    await waitFor(() => expect(screen.getByText('TRADING ACTIVE')).toBeInTheDocument())

    fireEvent.click(screen.getByText(/Arm global halt/i))            // opens confirm
    fireEvent.click(screen.getByText('Arm halt'))                    // confirms

    await waitFor(() => {
      const post = fn.mock.calls.find((c: any[]) => c[1] && c[1].method === 'POST') as any
      expect(post).toBeTruthy()
      const body = JSON.parse(post[1].body)
      expect(body.active).toBe(true)
      expect(post[1].headers['X-Zeus-Request']).toBe('1')
    })
  })

  it('disarming POSTs active:false after confirm', async () => {
    const { fn } = installFetch({ active: true, by: 1, ts: 1, reason: 'x' })
    render(<GlobalHaltControl />)
    await waitFor(() => expect(screen.getByText('TRADING HALTED')).toBeInTheDocument())

    fireEvent.click(screen.getByText(/Disarm — resume trading/i))    // opens confirm
    fireEvent.click(screen.getByText('Disarm'))                      // confirms

    await waitFor(() => {
      const post = fn.mock.calls.find((c: any[]) => c[1] && c[1].method === 'POST') as any
      expect(post).toBeTruthy()
      expect(JSON.parse(post[1].body).active).toBe(false)
    })
  })
})
