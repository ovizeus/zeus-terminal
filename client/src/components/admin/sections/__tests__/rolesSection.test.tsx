/**
 * [2026-11-27] Roles & Permissions — reală: membrii pe roluri din baza, matricea serverului,
 * atribuirea rolurilor de staff (doar Super Admin; serverul verifică oricum).
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { RolesSection } from '../RolesSection'
import { useAdminStore } from '../../../../stores/adminStore'
import { ROLE_PERMS } from '../../adminRoles'

afterEach(() => vi.unstubAllGlobals())
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const USERS = [
  { id: 1, email: 'boss@x.ro', role: 'admin', staffRole: null, approved: true, status: 'active' },
  { id: 4, email: 'sup@x.ro', role: 'user', staffRole: 'support', approved: true, status: 'active' },
  { id: 7, email: 'ana@x.ro', role: 'user', staffRole: null, approved: true, status: 'active' },
]

describe('Roles & Permissions', () => {
  it('numără membrii reali pe fiecare rol și nu mai e machetă', () => {
    useAdminStore.setState({ users: USERS as any })
    const { container } = render(<RolesSection />)
    expect(container.querySelector('[data-role-count="superadmin"]')!.textContent).toBe('1')
    expect(container.querySelector('[data-role-count="support"]')!.textContent).toBe('1')
    expect(container.querySelector('[data-role-count="analyst"]')!.textContent).toBe('0')
    expect(screen.queryByText(/Scaffold/)).toBeNull()
  })
  it('matricea e cea a serverului (support nu șterge)', () => {
    useAdminStore.setState({ users: USERS as any })
    const { container } = render(<RolesSection />)
    expect(container.querySelector('[data-perm="support:users.delete"]')!.textContent).toBe('○')
    expect(container.querySelector('[data-perm="admin:users.delete"]')!.textContent).toBe('●')
    expect(ROLE_PERMS.support).not.toContain('users.delete')
  })
  it('atribuire: alegi un cont și un rol → POST staff-role; Super Adminul nu apare în listă', async () => {
    const calls: any[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
      calls.push({ url, body: init && init.body ? JSON.parse(init.body) : null, headers: init && init.headers })
      return { ok: true, json: async () => ({ ok: true, staffRole: 'analyst', users: USERS }) }
    }))
    useAdminStore.setState({ users: USERS as any })
    const { container } = render(<RolesSection />)
    const who = container.querySelector('select[data-assign="user"]') as HTMLSelectElement
    expect(Array.from(who.options).map((o) => o.value)).not.toContain('boss@x.ro')
    fireEvent.change(who, { target: { value: 'ana@x.ro' } })
    fireEvent.change(container.querySelector('select[data-assign="role"]')!, { target: { value: 'analyst' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Save role/ })) })
    await tick()
    const c = calls.find((x) => x.url === '/auth/admin/staff-role')
    expect(c.body).toEqual({ email: 'ana@x.ro', staffRole: 'analyst' })
    expect(c.headers['X-Zeus-Request']).toBe('1')
  })
  it('„No role" trimite null (scoate rolul)', async () => {
    const calls: any[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => { calls.push({ url, body: init && init.body ? JSON.parse(init.body) : null }); return { ok: true, json: async () => ({ ok: true, users: USERS }) } }))
    useAdminStore.setState({ users: USERS as any })
    const { container } = render(<RolesSection />)
    fireEvent.change(container.querySelector('select[data-assign="user"]')!, { target: { value: 'sup@x.ro' } })
    fireEvent.change(container.querySelector('select[data-assign="role"]')!, { target: { value: '' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Save role/ })) })
    expect(calls.find((x) => x.url === '/auth/admin/staff-role').body).toEqual({ email: 'sup@x.ro', staffRole: null })
  })
})
