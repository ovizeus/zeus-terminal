/**
 * [2026-11-28] LoginPage (in aplicatie): butonul „Sign in with a passkey".
 */
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

const pk = vi.hoisted(() => ({ enabled: true, signIn: vi.fn() }))
vi.mock('../../../services/passkey', () => ({
  passkeyLoginEnabled: async () => pk.enabled,
  signInWithPasskey: () => pk.signIn(),
}))
vi.mock('../../../core/turnstile', () => ({ getTurnstileToken: async () => undefined }))
const checkAuth = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('../../../stores', () => ({ useAuthStore: (sel: any) => sel({ checkAuth }) }))
import { LoginPage } from '../LoginPage'

const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
beforeEach(() => {
  pk.enabled = true; pk.signIn.mockReset(); checkAuth.mockClear()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => '' })))
})
afterEach(() => vi.unstubAllGlobals())

describe('LoginPage — passkey', () => {
  it('pornit pe server + browser compatibil → butonul apare; reusita → checkAuth', async () => {
    pk.signIn.mockResolvedValue({ ok: true })
    render(<LoginPage />)
    await tick()
    const btn = screen.getByRole('button', { name: 'Sign in with a passkey' })
    expect(btn.getAttribute('type')).toBe('button')   // nu trimite formularul cu parola
    await act(async () => { fireEvent.click(btn) })
    await tick()
    expect(pk.signIn).toHaveBeenCalled()
    expect(checkAuth).toHaveBeenCalled()
  })
  it('esec → mesajul de eroare, fara checkAuth', async () => {
    pk.signIn.mockResolvedValue({ ok: false, error: 'Cancelled or timed out — try again.' })
    render(<LoginPage />)
    await tick()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign in with a passkey' })) })
    await tick()
    expect(screen.getByText('Cancelled or timed out — try again.')).toBeTruthy()
    expect(checkAuth).not.toHaveBeenCalled()
  })
  it('oprit (sau aplicatia Android) → fara buton', async () => {
    pk.enabled = false
    render(<LoginPage />)
    await tick()
    expect(screen.queryByRole('button', { name: 'Sign in with a passkey' })).toBeNull()
  })
})
