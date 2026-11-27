/**
 * [2026-11-27] Admin › Users: „Reset 2FA" pe un cont (telefon + coduri de rezerva pierdute).
 * Confirmare scrisa „RESET 2FA"; serverul refuza oricum pe propriul cont.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { UsersSection } from '../UsersSection'
import { useAdminStore } from '../../../../stores/adminStore'

afterEach(() => vi.unstubAllGlobals())
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

describe('Reset 2FA', () => {
  it('butonul cere „RESET 2FA" scris, apoi trimite cererea pentru contul ales', async () => {
    const calls: any[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
      calls.push({ url, body: init && init.body ? JSON.parse(init.body) : null })
      return { ok: true, json: async () => ({ ok: true, open: true, users: [], report: null }) }
    }))
    useAdminStore.setState({ users: [{ id: 2, email: 'ana@x.ro', role: 'user', approved: true, status: 'active', createdAt: '2026-11-01' } as any], usersLoading: false })
    render(<UsersSection />)
    await tick()
    fireEvent.click(screen.getByTitle(/Reset two-factor/))
    expect(screen.getByText(/Reset two-factor authentication/)).toBeTruthy()
    const box = document.querySelector('input[placeholder*="RESET 2FA"], .zac-confirm input, input[type="text"]:last-of-type') as HTMLInputElement
    fireEvent.change(box, { target: { value: 'RESET 2FA' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Reset 2FA$/ })) })
    await tick()
    const c = calls.find((x) => x.url === '/auth/admin/reset-2fa')
    expect(c.body).toEqual({ email: 'ana@x.ro', confirm: 'RESET 2FA' })
  })
})
