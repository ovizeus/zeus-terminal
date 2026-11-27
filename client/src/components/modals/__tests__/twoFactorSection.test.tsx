/**
 * [2026-11-27] Settings › Security › Two-factor authentication (aplicatie de autentificare).
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { TwoFactorSection } from '../TwoFactorSection'

vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,QR' } }))
afterEach(() => vi.unstubAllGlobals())
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

function server(state: { enabled: boolean }) {
  const calls: any[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
    calls.push({ url, body: init && init.body ? JSON.parse(init.body) : null, headers: init && init.headers })
    const j = (b: any, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => b, text: async () => JSON.stringify(b) })
    if (url === '/api/2fa/status') return j({ ok: true, enabled: state.enabled, recoveryLeft: state.enabled ? 10 : 0 })
    if (url === '/api/2fa/setup') return j({ ok: true, secret: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', uri: 'otpauth://totp/x' })
    if (url === '/api/2fa/confirm') {
      const b = JSON.parse(init.body)
      if (b.code !== '123456') return j({ ok: false, error: 'Wrong code — check the time on your phone and try again.' }, false)
      state.enabled = true
      return j({ ok: true, recoveryCodes: ['AAAAA-BBBBB', 'CCCCC-DDDDD'] })
    }
    if (url === '/api/2fa/disable') { state.enabled = false; return j({ ok: true }) }
    return j({ ok: false }, false)
  }))
  return calls
}

describe('Two-factor authentication', () => {
  it('oprit: arata starea si butonul de pornire', async () => {
    server({ enabled: false })
    render(<TwoFactorSection />)
    await tick()
    expect(screen.getByText('OFF')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Turn on/ })).toBeTruthy()
  })
  it('pornire: parola → QR + cheie → cod → codurile de rezerva, apoi ON', async () => {
    const calls = server({ enabled: false })
    const { container } = render(<TwoFactorSection />)
    await tick()
    fireEvent.click(screen.getByRole('button', { name: /Turn on/ }))
    fireEvent.change(container.querySelector('input[data-2fa="password"]')!, { target: { value: 'pw' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Continue/ })) })
    await tick()
    const setup = calls.find((c) => c.url === '/api/2fa/setup')
    expect(setup.body).toEqual({ password: 'pw' })
    expect(setup.headers['X-Zeus-Request']).toBe('1')
    expect((container.querySelector('img[data-2fa="qr"]') as HTMLImageElement).src).toContain('data:image/png')
    expect(screen.getByText(/ABCD EFGH IJKL/)).toBeTruthy()
    fireEvent.change(container.querySelector('input[data-2fa="code"]')!, { target: { value: '123 456' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Turn on 2FA/ })) })
    await tick()
    expect(calls.find((c) => c.url === '/api/2fa/confirm').body).toEqual({ code: '123456' })
    expect(screen.getByText('AAAAA-BBBBB')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /I saved them/ }))
    await tick()
    expect(screen.getByText('ON')).toBeTruthy()
  })
  it('cod gresit la pornire → mesajul serverului, ramane pe pasul de cod', async () => {
    server({ enabled: false })
    const { container } = render(<TwoFactorSection />)
    await tick()
    fireEvent.click(screen.getByRole('button', { name: /Turn on/ }))
    fireEvent.change(container.querySelector('input[data-2fa="password"]')!, { target: { value: 'pw' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Continue/ })) })
    await tick()
    fireEvent.change(container.querySelector('input[data-2fa="code"]')!, { target: { value: '999999' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Turn on 2FA/ })) })
    await tick()
    expect(screen.getByText(/Wrong code/)).toBeTruthy()
    expect(container.querySelector('input[data-2fa="code"]')).toBeTruthy()
  })
  it('pornit: oprirea cere parola si un cod', async () => {
    const calls = server({ enabled: true })
    const { container } = render(<TwoFactorSection />)
    await tick()
    expect(screen.getByText('ON')).toBeTruthy()
    expect(screen.getByText(/10 backup codes left/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Turn off/ }))
    fireEvent.change(container.querySelector('input[data-2fa="password"]')!, { target: { value: 'pw' } })
    fireEvent.change(container.querySelector('input[data-2fa="code"]')!, { target: { value: 'AAAAA-BBBBB' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Turn off 2FA/ })) })
    await tick()
    expect(calls.find((c) => c.url === '/api/2fa/disable').body).toEqual({ password: 'pw', code: 'AAAAA-BBBBB' })
    expect(screen.getByText('OFF')).toBeTruthy()
  })
})
